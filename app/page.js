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
  fetchPledgeEvents,
  submitPledge,
  stroopsToXlm,
} from "@/lib/soroban";
import {
  CAMPAIGN_GOAL_XLM,
  CAMPAIGN_ADDRESS,
  FUND_TOKEN_CONTRACT_ID,
  XLM_SAC_CONTRACT_ID,
  explorerContract,
  explorerAccount,
} from "@/lib/config";

const short = (a) => (a ? `${a.slice(0, 5)}…${a.slice(-5)}` : "");

export default function Home() {
  const [wallets, setWallets] = useState([]);
  const [address, setAddress] = useState(null);
  const [walletName, setWalletName] = useState(null);
  const [balance, setBalance] = useState(null);

  const [raised, setRaised] = useState(0);
  const [fundMeta, setFundMeta] = useState(null);
  const [events, setEvents] = useState([]);

  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  const goal = CAMPAIGN_GOAL_XLM;
  const pct = Math.min(100, (raised / goal) * 100);

  // ---- initial load: wallet list + FUND contract metadata ----
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

    return () => clearInterval(id);
  }, []);

  // ---- real-time state sync: poll campaign balance + contract events ----
  const syncChainState = useCallback(async () => {
    try {
      const [r, ev] = await Promise.all([
        readRaisedStroops(),
        fetchPledgeEvents(),
      ]);
      setRaised(stroopsToXlm(r));
      setEvents(ev);
    } catch {
      /* transient RPC hiccup — keep last known state */
    }
  }, []);

  useEffect(() => {
    syncChainState();
    const id = setInterval(syncChainState, 5000);
    return () => clearInterval(id);
  }, [syncChainState]);

  const refreshBalance = useCallback(async (addr) => {
    if (!addr) return;
    const b = await readXlmBalanceStroops(addr);
    setBalance(stroopsToXlm(b));
  }, []);

  // ---- connect / disconnect ----
  async function handlePick(w) {
    setError(null);
    // NOTE: we do NOT block on `w.isAvailable` — that flag can be a false
    // negative if the extension injected late. We attempt the connection and
    // only report an error if it genuinely fails.
    setBusy(true);
    try {
      const { address: addr } = await connectWallet(w.id);
      setAddress(addr);
      setWalletName(w.name);
      await refreshBalance(addr);
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
      // success — refresh balances + progress immediately
      await Promise.all([refreshBalance(address), syncChainState()]);
    } catch (err) {
      // Error types #2 (rejected) and #3 (insufficient) are classified in the lib.
      setStatus({ state: "error", message: err.message, hash: null });
      setError({ type: err.type || "error", message: err.message });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {/* header */}
      <header className="mb-8 text-center">
        <span className="inline-block rounded-full border border-yellow-400/40 bg-yellow-400/10 px-3 py-1 text-xs font-semibold text-yellow-300">
          🥋 Yellow Belt · Stellar Testnet
        </span>
        <h1 className="mt-3 text-3xl font-bold sm:text-4xl">Stellar Crowdfund</h1>
        <p className="mx-auto mt-2 max-w-xl text-sm text-white/60">
          Multi-wallet Soroban dApp. Pledge testnet XLM through the token
          contract, watch the progress bar sync from on-chain events in real
          time, and track your transaction to confirmation.
        </p>
      </header>

      {/* campaign progress */}
      <section className="rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl">
        <div className="flex items-end justify-between">
          <div>
            <p className="text-xs uppercase tracking-wide text-white/50">Raised</p>
            <p className="text-3xl font-bold text-white">
              {raised.toFixed(2)}{" "}
              <span className="text-lg font-medium text-white/60">XLM</span>
            </p>
          </div>
          <p className="text-sm text-white/60">Goal {goal} XLM</p>
        </div>

        <div className="mt-4 h-4 w-full overflow-hidden rounded-full bg-white/10">
          <div
            className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-emerald-400 transition-[width] duration-700"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-2 flex items-center justify-between text-xs text-white/50">
          <span>{pct.toFixed(1)}% funded</span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            live · syncing every 5s
          </span>
        </div>

        <p className="mt-3 text-xs text-white/40">
          Beneficiary{" "}
          <a
            className="underline hover:text-white/70"
            href={explorerAccount(CAMPAIGN_ADDRESS)}
            target="_blank"
            rel="noreferrer"
          >
            {short(CAMPAIGN_ADDRESS)}
          </a>
        </p>
      </section>

      {/* wallet + pledge */}
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl">
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
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs uppercase tracking-wide text-white/50">
                  Connected · {walletName}
                </p>
                <a
                  className="font-mono text-sm underline hover:text-white/80"
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
              </div>
              <button
                onClick={handleDisconnect}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm text-white/70 hover:bg-white/10"
              >
                Disconnect
              </button>
            </div>

            <form onSubmit={handlePledge} className="mt-5">
              <label className="text-sm font-medium text-white/80">
                Pledge amount (XLM)
              </label>
              <div className="mt-2 flex gap-2">
                <input
                  type="number"
                  min="0"
                  step="0.5"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  disabled={busy}
                  className="w-full rounded-lg border border-white/15 bg-black/30 px-3 py-2 text-white outline-none focus:border-indigo-400"
                  placeholder="10"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="whitespace-nowrap rounded-lg bg-indigo-500 px-5 py-2 font-semibold text-white transition hover:bg-indigo-400 disabled:opacity-50"
                >
                  {busy ? "Working…" : "Pledge XLM"}
                </button>
              </div>
              <div className="mt-2 flex gap-2">
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
      <section className="mt-6 rounded-2xl border border-white/10 bg-white/5 p-6 shadow-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Live pledges</h2>
          <span className="text-xs text-white/45">
            from contract <code>transfer</code> events
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

      {/* contract info footer — proves deployed contract + real reads */}
      <footer className="mt-8 space-y-2 rounded-2xl border border-white/10 bg-black/20 p-5 text-xs text-white/50">
        <p className="font-semibold text-white/70">On-chain details (testnet)</p>
        <p>
          FUND token contract (deployed by us):{" "}
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
        <p>
          Pledge token contract (native XLM SAC):{" "}
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
