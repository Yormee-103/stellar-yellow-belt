import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TxStatus from "@/components/TxStatus";

describe("<TxStatus />", () => {
  it("renders nothing when there is no status", () => {
    const { container } = render(<TxStatus status={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the stepper labels while a tx is pending", () => {
    render(<TxStatus status={{ state: "pending", hash: "abc123" }} />);
    expect(screen.getByText("Building")).toBeInTheDocument();
    expect(screen.getByText("Signing")).toBeInTheDocument();
    expect(screen.getByText("Confirmed")).toBeInTheDocument();
    // The pending hash is shown so the user can track it.
    expect(screen.getByText("abc123")).toBeInTheDocument();
  });

  it("shows a success confirmation with an explorer link", () => {
    const hash = "deadbeefcafe";
    render(<TxStatus status={{ state: "success", hash }} />);
    expect(screen.getByText(/confirmed on testnet/i)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /stellar expert/i });
    expect(link).toHaveAttribute("href", expect.stringContaining(hash));
  });

  it("renders an error state with the failure message", () => {
    render(
      <TxStatus status={{ state: "error", message: "Transaction reverted" }} />
    );
    expect(screen.getByText(/transaction failed/i)).toBeInTheDocument();
    expect(screen.getByText("Transaction reverted")).toBeInTheDocument();
  });
});
