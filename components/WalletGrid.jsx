"use client";

// Grid of every wallet the kit supports, showing install status.
// Doubles as the "wallet options available" screen for the submission.
export default function WalletGrid({ wallets, onPick, busy }) {
  if (!wallets?.length) {
    return (
      <p className="text-sm text-white/60">Loading available wallets…</p>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {wallets.map((w) => (
        <button
          key={w.id}
          disabled={busy}
          onClick={() => onPick(w)}
          className={[
            "group flex flex-col items-center gap-2 rounded-xl border p-4 transition",
            w.isAvailable
              ? "border-white/10 bg-white/5 hover:border-indigo-400/60 hover:bg-indigo-500/10"
              : "border-white/5 bg-white/[0.02] opacity-60",
            busy ? "cursor-not-allowed" : "cursor-pointer",
          ].join(" ")}
          title={w.isAvailable ? `Connect ${w.name}` : `${w.name} not detected`}
        >
          {w.icon ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={w.icon} alt={w.name} className="h-9 w-9 rounded" />
          ) : (
            <div className="flex h-9 w-9 items-center justify-center rounded bg-white/10 text-sm font-bold">
              {w.name.slice(0, 2)}
            </div>
          )}
          <span className="text-xs font-medium text-white/90">{w.name}</span>
          <span
            className={[
              "rounded-full px-2 py-0.5 text-[10px] font-semibold",
              w.isAvailable
                ? "bg-emerald-500/20 text-emerald-300"
                : "bg-white/10 text-white/45",
            ].join(" ")}
          >
            {w.isAvailable ? "Detected" : "Not installed"}
          </span>
        </button>
      ))}
    </div>
  );
}
