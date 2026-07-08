import { describe, it, expect } from "vitest";
import {
  classifyError,
  contractErrorCode,
  WalletError,
  RejectedError,
  InsufficientBalanceError,
  ContractError,
  CONTRACT_ERRORS,
} from "@/lib/errors";

describe("errors: contractErrorCode", () => {
  it("parses a Soroban 'Error(Contract, #N)' string", () => {
    expect(contractErrorCode("HostError: Error(Contract, #4)")).toBe(4);
  });

  it("parses a 'ContractError(N)' string", () => {
    expect(contractErrorCode("ContractError(9)")).toBe(9);
  });

  it("returns null when there is no contract code", () => {
    expect(contractErrorCode("some random failure")).toBeNull();
  });
});

describe("errors: classifyError", () => {
  it("classifies a user rejection", () => {
    const e = classifyError(new Error("User declined the request"));
    expect(e).toBeInstanceOf(RejectedError);
    expect(e.type).toBe("rejected");
  });

  it("classifies a modal-closed cancellation as rejected", () => {
    const e = classifyError(new Error("WALLET_MODAL_CLOSED"));
    expect(e.type).toBe("rejected");
  });

  it("classifies an insufficient-balance error", () => {
    const e = classifyError(new Error("tx_insufficient_balance"));
    expect(e).toBeInstanceOf(InsufficientBalanceError);
    expect(e.type).toBe("insufficient");
  });

  it("classifies a wallet-not-found error", () => {
    const e = classifyError(new Error("Freighter is not installed"));
    expect(e).toBeInstanceOf(WalletError);
    expect(e.type).toBe("wallet");
  });

  it("maps an on-chain contract revert to a human message", () => {
    const e = classifyError(new Error("HostError: Error(Contract, #4)"));
    expect(e).toBeInstanceOf(ContractError);
    expect(e.message).toBe(CONTRACT_ERRORS[4]);
    expect(e.type).toBe("contract");
  });

  it("prioritizes a contract code over generic keyword matching", () => {
    // Message contains 'balance' but also a specific contract code #6.
    const e = classifyError(new Error("Error(Contract, #6) low balance"));
    expect(e.message).toBe(CONTRACT_ERRORS[6]);
  });

  it("passes through an unrecognized error unchanged", () => {
    const original = new Error("totally unexpected");
    const e = classifyError(original);
    expect(e.message).toBe("totally unexpected");
  });
});
