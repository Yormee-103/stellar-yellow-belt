"use client";

import { useEffect, useState, useCallback } from "react";
import WalletGrid from "@/components/WalletGrid";
import TxStatus from "@/components/TxStatus";
import {
  listWallets,
  connectWallet,
  disconnectWallet,
  signWithWallet,
} from "@/lib/wallet";
import {
  readFundTokenMetadata,
  readRaisedStroops,
  readXlmBalanceStroops,
  readCampaignInfo,
  readPledgedBy,
  fetchPledgeEvents,
  submitPledge,
  stroopsToXlm,
  CROWDFUND_CONFIGURED,
} from "@/lib/soroban";
import { shortenAddress, fundedPercent } from "@/lib/units";
import {
  CAMPAIGN_GOAL_XLM,
  CAMPAIGN_ADDRESS,
  FUND_TOKEN_CONTRACT_ID,
  CROWDFUND_CONTRACT_ID,
  XLM_SAC_CONTRACT_ID,
  explorerContract,
  explorerAccount,
} from "@/lib/config";

const short = shortenAddress;

function formatDeadline(unix) {
  if (!unix) return null;
  try {
    return new Date(unix * 1000).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return null;
  }
}

export default function Home() {
  const [wallets, setWallets] = useState([]);
  const [address, setAddress] = useState(null);
  const [walletName, setWalletName] = useState(null);
  const [balance, setBalance] = useState(null);

  const [raised, setRaised] = useState(0);
  const [goal, setGoal] = useState(CAMPAIGN_GOAL_XLM);
  const [deadline, setDeadline] = useState(null);
  const [goalReached, setGoalReached] = useState(false);
  const [myPledge, setMyPledge] = useState(0);
  const [fundMeta, setFundMeta] = useState(null);
  const [events, setEvents] = useState([]);

  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const pct = fundedPercent(raised, goal);

  // ---- initial load: wallet list + FUND metadata + campaign config ----
  useEffect(() => {
    // Wallet extensions inject asynchronously, so `isAvailable` can be a false
    // negative right after load. Re-poll a few times so the badges self-correct.
    let tries = 0;
    const refreshWallets = () =>
      listWallets()
        .then(setWallets)
        .catch(() => {});
    refreshWallets();
    const id = setInterval(() => {
      tries++;
      refreshWallets();
      if (tries >= 4) clearInterval(id);
    }, 600);

    readFundTokenMetadata()
      .then(setFundMeta)
      .catch(() => setFundMeta(null));

    readCampaignInfo()
      .then((info) => {
        if (!info) return;
        setGoal(stroopsToXlm(info.goalStroops) || CAMPAIGN_GOAL_XLM);
        setDeadline(info.deadline || null);
        setGoalReached(info.goalReached);
      })
      .catch(() => {});

    return () => clearInterval(id);
  }, []);

  // ---- real-time state sync: poll contract total + events ----
  const syncChainState = useCallback(async () => {
    try {
      const [r, ev, info] = await Promise.all([
        readRaisedStroops(),
        fetchPledgeEvents(),
        readCampaignInfo(),
      ]);
      setRaised(stroopsToXlm(r));
      setEvents(ev);
      if (info) setGoalReached(info.goalReached);
    } catch {
      /* transient RPC hiccup — keep last known state */
    }
  }, []);

  useEffect(() => {
    syncChainState();
    const id = setInterval(syncChainState, 5000);
    return () => clearInterval(id);
  }, [syncChainState]);

  const refreshMine = useCallback(async (addr) => {
    if (!addr) return;
    const [b, mine] = await Promise.all([
      readXlmBalanceStroops(addr),
      readPledgedBy(addr),
    ]);
    setBalance(stroopsToXlm(b));
    setMyPledge(stroopsToXlm(mine));
  }, []);

  // ---- connect / disconnect ----
  async function handlePick(w) {
    setError(null);
    setBusy(true);
    try {
      const { address: addr } = await connectWallet(w.id);
      setAddress(addr);
      setWalletName(w.name);
      await refreshMine(addr);
    } catch (e) {
      // Error type #1 — wallet not found / access problem.
      const raw = (e?.message || "").toLowerCase();
      const notInstalled =
        raw.includes("not installed") ||
        raw.includes("not available") ||
        raw.includes("no wallet") ||
        raw.includes("could not") ||
        raw.includes("undefined");
      setError({
        type: "wallet",
        message: notInstalled
          ? `${w.name} isn't responding. Make sure the extension is installed, unlocked, and set to Testnet, then reload the page.`
          : e?.message ||
            `Could not connect to ${w.name}. Make sure it's unlocked and on Testnet.`,
      });
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect() {
    await disconnectWallet();
    setAddress(null);
    setWalletName(null);
    setBalance(null);
    setMyPledge(0);
    setStatus(null);
    setError(null);
  }

  // ---- pledge (the contract call) ----
  async function handlePledge(e) {
    e.preventDefault();
    setError(null);
    setStatus(null);

    if (!address) {
      setError({ type: "wallet", message: "Connect a wallet first." });
      return;
    }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setError({
        type: "insufficient",
        message: "Enter a valid amount greater than 0.",
      });
      return;
    }

    setBusy(true);
    try {
      await submitPledge({
        from: address,
        amountXlm: amount,
        signFn: (xdr) => signWithWallet(xdr, address),
        onStatus: (s) => setStatus(s),
      });
      await Promise.all([refreshMine(address), syncChainState()]);
    } catch (err) {
      // Error types #2 (rejected), #3 (insufficient), and mapped contract errors.
      setStatus({ state: "error", message: err.message, hash: null });
      setError({ type: err.type || "error", message: err.message });
    } finally {
      setBusy(false);
    }
  }

  const deadlineStr = formatDeadline(deadline);

  return (
    <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:py-10">
      {/* header */}
      <header className="mb-6 text-center sm:mb-8">
        <span className="inline-block rounded-full border border-orange-400/40 bg-orange-400/10 px-3 py-1 text-xs font-semibold text-orange-300">
          🥋 Orange Belt · Stellar Testnet
        </span>
        <h1 className="mt-3 text-2xl font-bold sm:text-4xl">Stellar Crowdfund</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-white/60">
          A custom Soroban escrow contract. Pledge testnet XLM — the contract
          escrows it via an inter-contract token transfer, tracks every donor on
          chain, and streams live events to this page.
        </p>
      </header>

      {!CROWDFUND_CONFIGURED && (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          ⚠️ The crowdfund contract address isn&apos;t configured. Set{" "}
          <code>NEXT_PUBLIC_CROWDFUND_CONTRACT_ID</code> to the deployed testnet
          contract.
        </div>
      )}

      {/* campaign progress */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/50">
              Raised
            </p>
            <p className="text-2xl font-bold text-white sm:text-3xl">
              {raised.toFixed(2)}{" "}
              <span className="text-base font-medium text-white/60 sm:text-lg">
                XLM
              </span>
            </p>
          </div>
          <div className="text-right text-sm text-white/60">
            <p>Goal {goal} XLM</p>
            {deadlineStr && (
              <p className="text-xs text-white/45">by {deadlineStr}</p>
            )}
          </div>
        </div>

        <div className="mt-4 h-4 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-orange-400 to-emerald-400 transition-[width] duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-1 text-xs text-white/50">
          <span>
            {pct.toFixed(1)}% funded
            {goalReached && (
              <span className="ml-2 rounded bg-emerald-500/20 px-1.5 py-0.5 font-semibold text-emerald-300">
                goal reached 🎉
              </span>
            )}
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            live · syncing every 5s
          </span>
        </div>

        <p className="mt-3 break-all text-xs text-white/40">
          Escrow contract{" "}
          <a
            className="underline hover:text-white/70"
            href={explorerContract(CROWDFUND_CONTRACT_ID)}
            target="_blank"
            rel="noreferrer"
          >
            {short(CROWDFUND_CONTRACT_ID)}
          </a>
        </p>
      </section>

      {/* wallet + pledge */}
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl sm:p-6">
        {!address ? (
          <>
            <h2 className="text-lg font-semibold">Choose a wallet</h2>
            <p className="mb-4 mt-1 text-sm text-white/55">
              Connect any supported Stellar wallet to pledge.
            </p>
            <WalletGrid wallets={wallets} onPick={handlePick} busy={busy} />
          </>
        ) : (
          <>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs uppercase tracking-wide text-white/50">
                  Connected · {walletName}
                </p>
                <a
                  className="block truncate font-mono text-sm underline hover:text-white/80"
                  href={explorerAccount(address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  {short(address)}
                </a>
                <p className="mt-1 text-sm text-white/70">
                  Balance:{" "}
                  <span className="font-semibold text-white">
                    {balance == null ? "…" : `${balance.toFixed(4)} XLM`}
                  </span>
                </p>
                {myPledge > 0 && (
                  <p className="mt-0.5 text-xs text-emerald-300/90">
                    You&apos;ve pledged {myPledge.toFixed(2)} XLM
                  </p>
                )}
              </div>
              <button
                onClick={handleDisconnect}
                className="shrink-0 rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:bg-white/10"
              >
                Disconnect
              </button>
            </div>

            <form onSubmit={handlePledge} className="mt-5">
              <label className="text-sm font-medium text-white/80">
                Pledge amount (XLM)
              </label>
              <div className="mt-2 flex flex-col gap-2 sm:flex-row">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white outline-none focus:border-orange-400"
                  placeholder="10"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="whitespace-nowrap rounded-lg bg-orange-500 px-5 py-2 font-semibold text-white transition hover:bg-orange-400 disabled:opacity-50"
                >
                  {busy ? "Working…" : "Pledge XLM"}
                </button>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {[5, 10, 25, 50].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setAmount(String(v))}
                    disabled={busy}
                    className="rounded-md border border-white/10 px-3 py-1 text-xs text-white/60 hover:bg-white/10"
                  >
                    {v}
                  </button>
                ))}
              </div>
            </form>

            <TxStatus status={status} />
          </>
        )}

        {error && (
          <div className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
            <span className="font-semibold capitalize">{error.type} error:</span>{" "}
            {error.message}
          </div>
        )}
      </section>

      {/* live event feed */}
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-5 shadow-xl sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-1">
          <h2 className="text-lg font-semibold">Live pledges</h2>
          <span className="text-xs text-white/45">
            from contract <code>pledge</code> events
          </span>
        </div>
        {events.length === 0 ? (
          <p className="mt-3 text-sm text-white/50">
            No pledges yet — be the first. New pledges appear here within seconds.
          </p>
        ) : (
          <ul className="mt-3 divide-y divide-white/5">
            {events.map((ev) => (
              <li
                key={ev.id}
                className="flex items-center justify-between py-2 text-sm"
              >
                <span className="font-mono text-white/70">{short(ev.from)}</span>
                <span className="font-semibold text-emerald-300">
                  +{stroopsToXlm(ev.amountStroops).toFixed(2)} XLM
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* contract info footer */}
      <footer className="mt-8 space-y-2 rounded-2xl border border-white/10 bg-black/20 p-5 text-xs text-white/50">
        <p className="font-semibold text-white/70">On-chain details (testnet)</p>
        <p className="break-all">
          Crowdfund escrow contract (Rust, deployed by us):{" "}
          <a
            className="font-mono underline hover:text-white/80"
            href={explorerContract(CROWDFUND_CONTRACT_ID)}
            target="_blank"
            rel="noreferrer"
          >
            {short(CROWDFUND_CONTRACT_ID)}
          </a>
        </p>
        <p className="break-all">
          FUND token contract:{" "}
          <a
            className="font-mono underline hover:text-white/80"
            href={explorerContract(FUND_TOKEN_CONTRACT_ID)}
            target="_blank"
            rel="noreferrer"
          >
            {short(FUND_TOKEN_CONTRACT_ID)}
          </a>
          {fundMeta && (
            <span className="text-white/40">
              {" "}
              · read live: {fundMeta.name} ({fundMeta.symbol}, {fundMeta.decimals}{" "}
              decimals)
            </span>
          )}
        </p>
        <p className="break-all">
          Pledge token (native XLM SAC):{" "}
          <a
            className="font-mono underline hover:text-white/80"
            href={explorerContract(XLM_SAC_CONTRACT_ID)}
            target="_blank"
            rel="noreferrer"
          >
            {short(XLM_SAC_CONTRACT_ID)}
          </a>
        </p>
      </footer>
    </main>
  );
}
