// All Soroban / Stellar contract interaction lives here.
// Uses @stellar/stellar-sdk v14's `rpc` client against Soroban testnet.
//
// Pledges now flow through OUR custom `crowdfund` contract (Rust): the frontend
// calls `crowdfund.pledge(donor, amount)`, and the contract makes an
// inter-contract `transfer` into the token contract to escrow the funds. The
// campaign total and per-donor amounts are READ from the crowdfund contract.
"use client";

import {
  rpc,
  Contract,
  TransactionBuilder,
  BASE_FEE,
  Address,
  nativeToScVal,
  scValToNative,
  xdr,
} from "@stellar/stellar-sdk";
import {
  SOROBAN_RPC_URL,
  NETWORK_PASSPHRASE,
  XLM_SAC_CONTRACT_ID,
  FUND_TOKEN_CONTRACT_ID,
  CROWDFUND_CONTRACT_ID,
  CAMPAIGN_ADDRESS,
} from "./config";
import { xlmToStroops, stroopsToXlm } from "./units";
import {
  classifyError,
  InsufficientBalanceError,
  WalletError,
} from "./errors";

export { stroopsToXlm, xlmToStroops } from "./units";
export {
  WalletError,
  RejectedError,
  InsufficientBalanceError,
  ContractError,
} from "./errors";

const server = new rpc.Server(SOROBAN_RPC_URL);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Read-only contract call via simulation. Any existing account works as the
// simulation source; we use the campaign account (guaranteed to exist).
async function simulateRead(contractId, method, args = []) {
  const source = await server.getAccount(CAMPAIGN_ADDRESS);
  const contract = new Contract(contractId);
  const tx = new TransactionBuilder(source, {
    fee: BASE_FEE,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  const sim = await server.simulateTransaction(tx);
  if (rpc.Api.isSimulationError(sim)) {
    throw new Error(`Simulation failed for ${method}: ${sim.error}`);
  }
  return scValToNative(sim.result.retval);
}

// Read the FUND token contract's on-chain metadata — proves a real read of
// the token contract WE deployed.
export async function readFundTokenMetadata() {
  const [name, symbol, decimals] = await Promise.all([
    simulateRead(FUND_TOKEN_CONTRACT_ID, "name"),
    simulateRead(FUND_TOKEN_CONTRACT_ID, "symbol"),
    simulateRead(FUND_TOKEN_CONTRACT_ID, "decimals"),
  ]);
  return { name, symbol, decimals: Number(decimals) };
}

// Read an account's XLM balance (in stroops) from the native token contract.
export async function readXlmBalanceStroops(address) {
  try {
    const bal = await simulateRead(XLM_SAC_CONTRACT_ID, "balance", [
      new Address(address).toScVal(),
    ]);
    return typeof bal === "bigint" ? bal : BigInt(bal ?? 0);
  } catch {
    return 0n; // account not funded / not found
  }
}

// --- reads from OUR crowdfund contract ---

// Total raised so far, read straight from the crowdfund contract's state.
export async function readRaisedStroops() {
  try {
    const raised = await simulateRead(CROWDFUND_CONTRACT_ID, "total_raised");
    return typeof raised === "bigint" ? raised : BigInt(raised ?? 0);
  } catch {
    return 0n;
  }
}

// Campaign config (goal + deadline) read from the contract.
export async function readCampaignInfo() {
  try {
    const [goal, deadline, reached] = await Promise.all([
      simulateRead(CROWDFUND_CONTRACT_ID, "goal"),
      simulateRead(CROWDFUND_CONTRACT_ID, "deadline"),
      simulateRead(CROWDFUND_CONTRACT_ID, "goal_reached"),
    ]);
    return {
      goalStroops: typeof goal === "bigint" ? goal : BigInt(goal ?? 0),
      deadline: Number(deadline ?? 0),
      goalReached: Boolean(reached),
    };
  } catch {
    return null;
  }
}

// How much a given donor has pledged (stroops), read from the contract.
export async function readPledgedBy(address) {
  try {
    const amt = await simulateRead(CROWDFUND_CONTRACT_ID, "pledged_by", [
      new Address(address).toScVal(),
    ]);
    return typeof amt === "bigint" ? amt : BigInt(amt ?? 0);
  } catch {
    return 0n;
  }
}

// Fetch recent `pledge` events emitted by the crowdfund contract — the live
// activity feed. Event shape (from the Rust contract):
//   topics: [Symbol("pledge"), donor(Address)],  data: (amount:i128, raised:i128)
// Best-effort: returns [] if the RPC event window/query fails.
export async function fetchPledgeEvents() {
  try {
    const latest = await server.getLatestLedger();
    const startLedger = Math.max(latest.sequence - 9000, 1);

    const pledgeTopic = nativeToScVal("pledge", { type: "symbol" }).toXDR(
      "base64"
    );

    const resp = await server.getEvents({
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds: [CROWDFUND_CONTRACT_ID],
          topics: [[pledgeTopic, "*"]],
        },
      ],
      limit: 30,
    });

    const decode = (v) => {
      if (v == null) return null;
      if (typeof v === "string")
        return scValToNative(xdr.ScVal.fromXDR(v, "base64"));
      if (v.xdr) return scValToNative(xdr.ScVal.fromXDR(v.xdr, "base64"));
      try {
        return scValToNative(v);
      } catch {
        return null;
      }
    };

    return (resp.events || [])
      .map((ev) => {
        try {
          const topics = ev.topic || ev.topics || [];
          const donor = decode(topics[1]); // topic[1] = donor address
          const data = decode(ev.value); // [amount, raised]
          const amount = Array.isArray(data) ? data[0] : data;
          return {
            id: ev.id,
            from: donor,
            amountStroops:
              typeof amount === "bigint" ? amount : BigInt(amount ?? 0),
            ledger: ev.ledger,
            at: ev.ledgerClosedAt,
            txHash: ev.txHash || null,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse(); // newest first
  } catch {
    return [];
  }
}

// Build → sign → submit a pledge by invoking OUR crowdfund contract's
// `pledge(donor, amount)`. The contract authorizes and performs the
// inter-contract token transfer to escrow the funds. `onStatus` reports phases.
export async function submitPledge({ from, amountXlm, signFn, onStatus }) {
  const amountStroops = xlmToStroops(amountXlm);
  if (amountStroops <= 0n) {
    throw new InsufficientBalanceError("Enter an amount greater than zero.");
  }

  try {
    // Pre-flight balance check (error type: insufficient) before building a tx.
    const balance = await readXlmBalanceStroops(from);
    const feeBuffer = 3_000_000n; // ~0.3 XLM headroom for fees + escrow auth
    if (balance < amountStroops + feeBuffer) {
      throw new InsufficientBalanceError(
        `Not enough XLM. You have ${stroopsToXlm(balance).toFixed(
          4
        )} XLM but need ~${stroopsToXlm(amountStroops + feeBuffer).toFixed(4)}.`
      );
    }

    onStatus?.({ state: "building" });
    const source = await server.getAccount(from);
    const contract = new Contract(CROWDFUND_CONTRACT_ID);
    const op = contract.call(
      "pledge",
      new Address(from).toScVal(),
      nativeToScVal(amountStroops, { type: "i128" })
    );

    let tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(120)
      .build();

    // Simulate + assemble the Soroban footprint, auth entries, and resource fees.
    tx = await server.prepareTransaction(tx);

    onStatus?.({ state: "signing" });
    const signedXdr = await signFn(tx.toXDR());
    const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

    onStatus?.({ state: "submitting" });
    const sent = await server.sendTransaction(signedTx);
    if (sent.status === "ERROR") {
      throw new Error(
        `Submission rejected: ${JSON.stringify(
          sent.errorResult?._attributes ?? sent
        )}`
      );
    }

    const hash = sent.hash;
    onStatus?.({ state: "pending", hash });

    // Poll until the transaction leaves NOT_FOUND (pending → success/fail).
    let result = await server.getTransaction(hash);
    let tries = 0;
    while (result.status === "NOT_FOUND" && tries < 30) {
      await sleep(1500);
      result = await server.getTransaction(hash);
      tries++;
    }

    if (result.status === "SUCCESS") {
      onStatus?.({ state: "success", hash });
      return { hash };
    }
    // Surface the contract's own diagnostic (maps to a typed ContractError).
    const diag =
      result.resultXdr?.toString?.() ||
      `Transaction did not succeed (status: ${result.status}).`;
    throw new Error(diag);
  } catch (e) {
    throw classifyError(e);
  }
}

// Guard export so the UI can warn if the contract id wasn't configured.
export const CROWDFUND_CONFIGURED =
  CROWDFUND_CONTRACT_ID && !CROWDFUND_CONTRACT_ID.startsWith("__");
