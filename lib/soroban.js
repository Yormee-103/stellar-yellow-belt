// All Soroban / Stellar contract interaction lives here.
// Uses @stellar/stellar-sdk v14's `rpc` client against Soroban testnet.
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
  CAMPAIGN_ADDRESS,
  CAMPAIGN_BASELINE_XLM,
  EXCLUDED_SENDERS,
} from "./config";

const server = new rpc.Server(SOROBAN_RPC_URL);
const STROOPS_PER_XLM = 10_000_000n;
const BASELINE_STROOPS = BigInt(CAMPAIGN_BASELINE_XLM) * STROOPS_PER_XLM;

// ---- typed errors (drive the three required error states in the UI) ----
export class WalletError extends Error {
  constructor(msg) {
    super(msg);
    this.type = "wallet";
  }
}
export class RejectedError extends Error {
  constructor(msg = "You rejected the request in your wallet.") {
    super(msg);
    this.type = "rejected";
  }
}
export class InsufficientBalanceError extends Error {
  constructor(msg) {
    super(msg);
    this.type = "insufficient";
  }
}

// ---- unit helpers ----
export function xlmToStroops(xlm) {
  const [whole, frac = ""] = String(xlm).trim().split(".");
  const fracPadded = (frac + "0000000").slice(0, 7);
  return BigInt(whole || "0") * STROOPS_PER_XLM + BigInt(fracPadded || "0");
}
export function stroopsToXlm(stroops) {
  const bi = typeof stroops === "bigint" ? stroops : BigInt(stroops);
  return Number(bi) / Number(STROOPS_PER_XLM);
}

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
// the contract WE deployed.
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

// Read how much the campaign has raised = current balance minus the starting
// baseline. Returns stroops (BigInt, never negative).
export async function readRaisedStroops() {
  const bal = await readXlmBalanceStroops(CAMPAIGN_ADDRESS);
  const raised = bal - BASELINE_STROOPS;
  return raised > 0n ? raised : 0n;
}

// Fetch recent `transfer` events sent TO the campaign — the live activity feed.
// Best-effort: returns [] if the RPC event window/query fails.
export async function fetchPledgeEvents() {
  try {
    const latest = await server.getLatestLedger();
    const startLedger = Math.max(latest.sequence - 9000, 1);

    const transferTopic = nativeToScVal("transfer", { type: "symbol" }).toXDR(
      "base64"
    );
    const toTopic = new Address(CAMPAIGN_ADDRESS).toScVal().toXDR("base64");

    const resp = await server.getEvents({
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds: [XLM_SAC_CONTRACT_ID],
          // Native SAC transfer events have 4 topics:
          // [Symbol("transfer"), from(Address), to(Address), asset(Symbol)]
          topics: [[transferTopic, "*", toTopic, "*"]],
        },
      ],
      limit: 30,
    });

    const decode = (v) => {
      if (v == null) return null;
      if (typeof v === "string") return scValToNative(xdr.ScVal.fromXDR(v, "base64"));
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
          const from = decode(topics[1]); // topic[1] = sender address
          const amount = decode(ev.value); // data = i128 amount
          return {
            id: ev.id,
            from,
            amountStroops: typeof amount === "bigint" ? amount : BigInt(amount ?? 0),
            ledger: ev.ledger,
            at: ev.ledgerClosedAt,
            txHash: ev.txHash || null,
          };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .filter((ev) => !EXCLUDED_SENDERS.includes(ev.from)) // hide the initial funding
      .reverse(); // newest first
  } catch {
    return [];
  }
}

// Normalize wallet/SDK errors into our typed errors so the UI can show the
// right message. Covers the three required error categories.
function classifyError(e) {
  const msg = (e?.message || String(e) || "").toLowerCase();
  if (
    msg.includes("reject") ||
    msg.includes("declined") ||
    msg.includes("denied") ||
    msg.includes("user_cancel") ||
    msg.includes("cancelled") ||
    msg.includes("wallet_modal_closed")
  ) {
    return new RejectedError();
  }
  if (
    msg.includes("insufficient") ||
    msg.includes("underfunded") ||
    msg.includes("balance") ||
    msg.includes("tx_insufficient")
  ) {
    return new InsufficientBalanceError(
      "Insufficient XLM balance to cover this pledge plus fees."
    );
  }
  if (
    msg.includes("not found") ||
    msg.includes("no account") ||
    msg.includes("not installed") ||
    msg.includes("no wallet")
  ) {
    return new WalletError(
      "Wallet or account not found. Make sure your wallet is installed, unlocked, and funded on testnet."
    );
  }
  return e instanceof Error ? e : new Error(String(e));
}

// Build → sign → submit a pledge (a `transfer` contract call on the native
// token contract), then poll transaction status. `onStatus` reports each phase.
export async function submitPledge({ from, amountXlm, signFn, onStatus }) {
  const amountStroops = xlmToStroops(amountXlm);
  if (amountStroops <= 0n) {
    throw new InsufficientBalanceError("Enter an amount greater than zero.");
  }

  try {
    // Error type #3 — insufficient balance (checked before we ever build a tx).
    const balance = await readXlmBalanceStroops(from);
    const feeBuffer = 2_000_000n; // ~0.2 XLM headroom for fee + base reserve
    if (balance < amountStroops + feeBuffer) {
      throw new InsufficientBalanceError(
        `Not enough XLM. You have ${stroopsToXlm(balance).toFixed(
          4
        )} XLM but need ~${stroopsToXlm(amountStroops + feeBuffer).toFixed(4)}.`
      );
    }

    onStatus?.({ state: "building" });
    const source = await server.getAccount(from);
    const contract = new Contract(XLM_SAC_CONTRACT_ID);
    const op = contract.call(
      "transfer",
      new Address(from).toScVal(),
      new Address(CAMPAIGN_ADDRESS).toScVal(),
      nativeToScVal(amountStroops, { type: "i128" })
    );

    let tx = new TransactionBuilder(source, {
      fee: BASE_FEE,
      networkPassphrase: NETWORK_PASSPHRASE,
    })
      .addOperation(op)
      .setTimeout(120)
      .build();

    // Simulate + assemble the Soroban footprint/resource fees.
    tx = await server.prepareTransaction(tx);

    onStatus?.({ state: "signing" });
    const signedXdr = await signFn(tx.toXDR());

    const signedTx = TransactionBuilder.fromXDR(signedXdr, NETWORK_PASSPHRASE);

    onStatus?.({ state: "submitting" });
    const sent = await server.sendTransaction(signedTx);
    if (sent.status === "ERROR") {
      throw new Error(
        `Submission rejected: ${JSON.stringify(sent.errorResult?._attributes ?? sent)}`
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
    throw new Error(`Transaction did not succeed (status: ${result.status}).`);
  } catch (e) {
    throw classifyError(e);
  }
}
