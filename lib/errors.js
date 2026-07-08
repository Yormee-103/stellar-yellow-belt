// Error handling for contract calls, split out as a pure module so the
// classification logic can be unit tested without the Stellar SDK.
//
// The dApp surfaces (at least) three distinct error categories to the user:
//   1. wallet       — wallet missing / locked / account not found
//   2. rejected     — the user declined the signature in their wallet
//   3. insufficient — not enough balance to cover the pledge + fees
// plus a mapped set of on-chain contract errors (see CONTRACT_ERRORS).

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
export class ContractError extends Error {
  constructor(msg) {
    super(msg);
    this.type = "contract";
  }
}

// Human-readable messages for each `#[contracterror]` variant in the Rust
// crowdfund contract (keyed by its u32 code). Lets the UI explain WHY a
// contract call reverted instead of showing a raw "Error(Contract, #4)".
export const CONTRACT_ERRORS = {
  1: "This campaign has already been initialized.",
  2: "The campaign is not initialized yet.",
  3: "Enter an amount greater than zero.",
  4: "The campaign deadline has passed — pledging is closed.",
  5: "The deadline hasn't been reached yet, so refunds aren't open.",
  6: "The funding goal hasn't been reached yet.",
  7: "The goal was reached — pledges are no longer refundable.",
  8: "Funds have already been withdrawn.",
  9: "You have nothing to refund.",
  10: "You are not authorized to perform this action.",
};

// Try to pull a Soroban contract error code out of an error/message.
// Matches patterns like "Error(Contract, #4)" or "ContractError(4)".
export function contractErrorCode(input) {
  const msg = typeof input === "string" ? input : input?.message || String(input);
  const m = msg.match(/(?:contract[^#]*#|contracterror\()\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}

// Normalize any thrown wallet/SDK/contract error into one of our typed errors.
export function classifyError(e) {
  const raw = e?.message || String(e) || "";
  const msg = raw.toLowerCase();

  // A mapped on-chain contract revert takes priority — it's the most specific.
  const code = contractErrorCode(raw);
  if (code != null && CONTRACT_ERRORS[code]) {
    if (code === 3 || code === 6) {
      // amount / goal related — surface as insufficient-style guidance
      return new ContractError(CONTRACT_ERRORS[code]);
    }
    return new ContractError(CONTRACT_ERRORS[code]);
  }

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
    msg.includes("tx_insufficient") ||
    msg.includes("balance")
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
  return e instanceof Error ? e : new Error(raw);
}
