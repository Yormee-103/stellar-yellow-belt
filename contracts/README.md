# Crowdfund — Soroban smart contract

A crowdfunding **escrow** contract for Soroban (Stellar). Donors pledge a token
toward a goal before a deadline; the contract escrows the funds through
**inter-contract calls** into the token contract and resolves the campaign one
of two ways:

- **Goal met →** the beneficiary can `withdraw` the whole pot.
- **Deadline passes, goal unmet →** each donor can `refund` their exact
  contribution.

## Why this is more than a demo

- **Inter-contract communication.** `pledge`, `withdraw`, and `refund` all call
  `token::Client::transfer(...)` on a *separate* token contract — the contract
  moves real tokens into and out of its own address (`env.current_contract_address()`).
- **On-chain per-donor accounting.** Each donor's contribution is stored under
  `DataKey::Pledge(Address)` so refunds are exact and independent.
- **Typed errors.** A `#[contracterror]` enum (10 variants) gives the frontend
  precise failure reasons instead of opaque reverts.
- **Events for real-time UIs.** Every state change publishes a contract event
  (`init` / `pledge` / `withdraw` / `refund`) the dApp streams live.
- **Checks-effects-interactions.** `refund` zeroes the ledger entry *before*
  the outgoing transfer.

## Interface

| Function | Auth | Description |
|---|---|---|
| `initialize(admin, beneficiary, token, goal, deadline)` | admin | One-time campaign setup. |
| `pledge(donor, amount) -> raised` | donor | Escrows `amount` of the token via inter-contract transfer. |
| `withdraw() -> amount` | beneficiary | Sends the pot to the beneficiary once the goal is met. |
| `refund(donor) -> amount` | donor | Returns a donor's contribution after a failed deadline. |
| `total_raised() -> i128` | — | Running total. |
| `pledged_by(donor) -> i128` | — | A donor's contribution. |
| `goal() / deadline() / beneficiary() / token()` | — | Campaign config. |
| `goal_reached() -> bool` | — | Whether the goal has been met. |

## Build & test

```bash
# from contracts/
cargo test            # run the Rust unit tests
stellar contract build # produce the optimized wasm
```

The test suite (`crowdfund/src/test.rs`) registers a real Stellar Asset Contract
as the token and exercises the full lifecycle — pledging, escrow balances,
withdrawal, refunds, and every error path — using `env.mock_all_auths()` and a
controllable ledger clock.

## Deploy

See [`../scripts/deploy.sh`](../scripts/deploy.sh), which builds, deploys, and
initializes a campaign on testnet, then prints the contract address and the
`NEXT_PUBLIC_CROWDFUND_CONTRACT_ID` value for the frontend.
