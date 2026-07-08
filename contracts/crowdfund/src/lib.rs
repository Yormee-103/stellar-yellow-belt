#![no_std]
//! # Crowdfund
//!
//! A Soroban crowdfunding escrow contract.
//!
//! Donors `pledge` a Stellar token toward a `goal` before a `deadline`. The
//! contract escrows the funds by making an **inter-contract call** into the
//! token contract (`token::Client::transfer`) — pulling tokens from the donor
//! into this contract's own address. Per-donor contributions are tracked on
//! chain so that:
//!
//! * once the goal is reached, the `beneficiary` can `withdraw` the whole pot
//!   (another inter-contract transfer, this time contract -> beneficiary);
//! * if the deadline passes without the goal being met, each donor can `refund`
//!   their exact contribution (contract -> donor).
//!
//! Every state change emits a contract event so a frontend can stream campaign
//! activity in real time.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, Symbol,
};

/// Storage keys. Campaign config lives in instance storage (cheap, always
/// loaded with the contract); per-donor balances live in persistent storage.
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    /// Whether `initialize` has run.
    Init,
    /// Address allowed to administer the campaign (currently unused beyond init,
    /// kept for upgrade/extension paths).
    Admin,
    /// Address that receives funds on a successful withdrawal.
    Beneficiary,
    /// Token contract address pledges are denominated in.
    Token,
    /// Fundraising goal, in the token's smallest unit (stroops for XLM).
    Goal,
    /// Unix timestamp after which pledging stops and refunds open.
    Deadline,
    /// Running total raised so far.
    Raised,
    /// Whether the beneficiary has already withdrawn.
    Withdrawn,
    /// Per-donor contributed amount: DataKey::Pledge(donor) -> i128.
    Pledge(Address),
}

/// Typed errors so the frontend can distinguish failure modes precisely.
#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    InvalidAmount = 3,
    DeadlinePassed = 4,
    DeadlineNotReached = 5,
    GoalNotReached = 6,
    GoalAlreadyReached = 7,
    AlreadyWithdrawn = 8,
    NothingToRefund = 9,
    Unauthorized = 10,
}

#[contract]
pub struct CrowdfundContract;

#[contractimpl]
impl CrowdfundContract {
    /// Configure the campaign. Callable exactly once.
    ///
    /// * `admin` – deployer/administrator.
    /// * `beneficiary` – receives funds when the goal is met.
    /// * `token` – the token contract pledges are made in.
    /// * `goal` – target amount (token base units); must be > 0.
    /// * `deadline` – unix timestamp; must be in the future.
    pub fn initialize(
        env: Env,
        admin: Address,
        beneficiary: Address,
        token: Address,
        goal: i128,
        deadline: u64,
    ) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Init) {
            return Err(Error::AlreadyInitialized);
        }
        if goal <= 0 {
            return Err(Error::InvalidAmount);
        }
        if deadline <= env.ledger().timestamp() {
            return Err(Error::DeadlinePassed);
        }
        admin.require_auth();

        let storage = env.storage().instance();
        storage.set(&DataKey::Init, &true);
        storage.set(&DataKey::Admin, &admin);
        storage.set(&DataKey::Beneficiary, &beneficiary);
        storage.set(&DataKey::Token, &token);
        storage.set(&DataKey::Goal, &goal);
        storage.set(&DataKey::Deadline, &deadline);
        storage.set(&DataKey::Raised, &0i128);
        storage.set(&DataKey::Withdrawn, &false);

        env.events().publish(
            (Symbol::new(&env, "init"), beneficiary),
            (token, goal, deadline),
        );
        Ok(())
    }

    /// Pledge `amount` of the campaign token. The donor must authorize the call;
    /// this contract then pulls the tokens via an inter-contract `transfer` into
    /// its own address, escrowing them until the campaign resolves.
    pub fn pledge(env: Env, donor: Address, amount: i128) -> Result<i128, Error> {
        Self::require_init(&env)?;
        // Donor authorizes both this invocation and the sub-transfer of tokens.
        donor.require_auth();

        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if env.ledger().timestamp() >= Self::deadline(env.clone()) {
            return Err(Error::DeadlinePassed);
        }

        // --- inter-contract call: pull tokens donor -> this contract ---
        let token_addr = Self::token(env.clone());
        let client = token::Client::new(&env, &token_addr);
        client.transfer(&donor, &env.current_contract_address(), &amount);

        // --- record the pledge ---
        let prior = Self::pledged_by(env.clone(), donor.clone());
        let updated = prior + amount;
        env.storage()
            .persistent()
            .set(&DataKey::Pledge(donor.clone()), &updated);

        let raised = Self::total_raised(env.clone()) + amount;
        env.storage().instance().set(&DataKey::Raised, &raised);

        env.events().publish(
            (Symbol::new(&env, "pledge"), donor),
            (amount, raised),
        );
        Ok(raised)
    }

    /// Beneficiary withdraws the full pot once the goal has been reached.
    /// Transfers escrowed tokens from this contract to the beneficiary
    /// (inter-contract call). Callable once.
    pub fn withdraw(env: Env) -> Result<i128, Error> {
        Self::require_init(&env)?;

        if env.storage().instance().get(&DataKey::Withdrawn).unwrap_or(false) {
            return Err(Error::AlreadyWithdrawn);
        }

        let raised = Self::total_raised(env.clone());
        if raised < Self::goal(env.clone()) {
            return Err(Error::GoalNotReached);
        }

        let beneficiary = Self::beneficiary(env.clone());
        beneficiary.require_auth();

        // --- inter-contract call: contract -> beneficiary ---
        let token_addr = Self::token(env.clone());
        let client = token::Client::new(&env, &token_addr);
        client.transfer(&env.current_contract_address(), &beneficiary, &raised);

        env.storage().instance().set(&DataKey::Withdrawn, &true);

        env.events().publish(
            (Symbol::new(&env, "withdraw"), beneficiary),
            raised,
        );
        Ok(raised)
    }

    /// Refund a donor's full contribution. Only allowed after the deadline has
    /// passed with the goal unmet. Transfers escrowed tokens back to the donor
    /// (inter-contract call) and zeroes their ledger entry.
    pub fn refund(env: Env, donor: Address) -> Result<i128, Error> {
        Self::require_init(&env)?;
        donor.require_auth();

        if env.ledger().timestamp() < Self::deadline(env.clone()) {
            return Err(Error::DeadlineNotReached);
        }
        if Self::total_raised(env.clone()) >= Self::goal(env.clone()) {
            // Goal met — funds belong to the beneficiary, not refundable.
            return Err(Error::GoalAlreadyReached);
        }

        let amount = Self::pledged_by(env.clone(), donor.clone());
        if amount <= 0 {
            return Err(Error::NothingToRefund);
        }

        // Zero the ledger entry BEFORE transferring (checks-effects-interactions).
        env.storage()
            .persistent()
            .set(&DataKey::Pledge(donor.clone()), &0i128);
        let raised = Self::total_raised(env.clone()) - amount;
        env.storage().instance().set(&DataKey::Raised, &raised);

        // --- inter-contract call: contract -> donor ---
        let token_addr = Self::token(env.clone());
        let client = token::Client::new(&env, &token_addr);
        client.transfer(&env.current_contract_address(), &donor, &amount);

        env.events().publish(
            (Symbol::new(&env, "refund"), donor),
            amount,
        );
        Ok(amount)
    }

    // -------------------- read-only views --------------------

    pub fn total_raised(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::Raised).unwrap_or(0)
    }

    pub fn pledged_by(env: Env, donor: Address) -> i128 {
        env.storage()
            .persistent()
            .get(&DataKey::Pledge(donor))
            .unwrap_or(0)
    }

    pub fn goal(env: Env) -> i128 {
        env.storage().instance().get(&DataKey::Goal).unwrap_or(0)
    }

    pub fn deadline(env: Env) -> u64 {
        env.storage().instance().get(&DataKey::Deadline).unwrap_or(0)
    }

    pub fn beneficiary(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Beneficiary)
            .expect("not initialized")
    }

    pub fn token(env: Env) -> Address {
        env.storage()
            .instance()
            .get(&DataKey::Token)
            .expect("not initialized")
    }

    /// True once the running total meets or exceeds the goal.
    pub fn goal_reached(env: Env) -> bool {
        Self::total_raised(env.clone()) >= Self::goal(env)
    }

    // -------------------- internals --------------------

    fn require_init(env: &Env) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Init) {
            Ok(())
        } else {
            Err(Error::NotInitialized)
        }
    }
}

mod test;
