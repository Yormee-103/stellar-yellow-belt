"use client";

// Visual tracker for the pending → success/fail lifecycle of a contract call.
import { explorerTx } from "@/lib/config";

const STEPS = [
  { key: "building", label: "Building" },
  { key: "signing", label: "Signing" },
  { key: "submitting", label: "Submitting" },
  { key: "pending", label: "Pending" },
  { key: "success", label: "Confirmed" },
];

const ORDER = { building: 0, signing: 1, submitting: 2, pending: 3, success: 4 };

export default function TxStatus({ status }) {
  if (!status) return null;
  const { state, hash, message } = status;

  if (state === "error") {
    return (
      <div className="mt-4 rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm">
        <p className="font-semibold text-red-300">✕ Transaction failed</p>
        <p className="mt-1 text-red-200/90">{message}</p>
        {hash && (
          <a
            className="mt-2 inline-block text-red-200 underline"
            href={explorerTx(hash)}
            target="_blank"
            rel="noreferrer"
          >
            View on Stellar Expert ↗
          </a>
        )}
      </div>
    );
  }

  const activeIdx = ORDER[state] ?? 0;

  return (
    <div className="mt-4 rounded-xl border border-white/10 bg-white/5 p-4">
      <div className="flex items-center justify-between gap-1">
        {STEPS.map((step, i) => {
          const done = i < activeIdx || state === "success";
          const active = i === activeIdx && state !== "success";
          return (
            <div key={step.key} className="flex flex-1 flex-col items-center">
              <div
                className={[
                  "flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold transition",
                  done
                    ? "bg-emerald-500 text-white"
                    : active
                    ? "bg-indigo-500 text-white animate-pulse"
                    : "bg-white/10 text-white/40",
                ].join(" ")}
              >
                {done ? "✓" : i + 1}
              </div>
              <span
                className={[
                  "mt-1 text-[10px] uppercase tracking-wide",
                  done || active ? "text-white/80" : "text-white/35",
                ].join(" ")}
              >
                {step.label}
              </span>
            </div>
          );
        })}
      </div>

      {state === "success" && hash && (
        <div className="mt-4 rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm">
          <p className="font-semibold text-emerald-300">
            ✓ Pledge confirmed on testnet!
          </p>
          <p className="mt-1 break-all font-mono text-xs text-emerald-100/80">
            {hash}
          </p>
          <a
            className="mt-2 inline-block text-emerald-200 underline"
            href={explorerTx(hash)}
            target="_blank"
            rel="noreferrer"
          >
            Verify on Stellar Expert ↗
          </a>
        </div>
      )}

      {state === "pending" && hash && (
        <p className="mt-3 break-all text-center font-mono text-xs text-indigo-200/80">
          {hash}
        </p>
      )}
    </div>
  );
}
