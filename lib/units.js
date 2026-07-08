// Pure unit-conversion helpers (no SDK / DOM dependency) so they can be unit
// tested in isolation and reused across the app.

export const STROOPS_PER_XLM = 10_000_000n;

// Convert a human XLM string/number to integer stroops (BigInt), the base unit
// used by both the token contract and our crowdfund contract.
export function xlmToStroops(xlm) {
  const [whole, frac = ""] = String(xlm).trim().split(".");
  const fracPadded = (frac + "0000000").slice(0, 7);
  return BigInt(whole || "0") * STROOPS_PER_XLM + BigInt(fracPadded || "0");
}

// Convert stroops (BigInt | number | string) back to a decimal XLM Number.
export function stroopsToXlm(stroops) {
  const bi = typeof stroops === "bigint" ? stroops : BigInt(stroops);
  return Number(bi) / Number(STROOPS_PER_XLM);
}

// Abbreviate a Stellar address / hash for display: GABC…WXYZ.
export function shortenAddress(a) {
  return a ? `${a.slice(0, 5)}…${a.slice(-5)}` : "";
}

// Clamp a raised/goal ratio to a 0–100 percentage.
export function fundedPercent(raised, goal) {
  if (!goal || goal <= 0) return 0;
  return Math.min(100, (raised / goal) * 100);
}
