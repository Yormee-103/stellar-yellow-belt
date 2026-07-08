#![cfg(test)]

use crate::{CrowdfundContract, CrowdfundContractClient, Error};
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token, Address, Env,
};

/// Spin up a testnet-like environment with:
/// * a Stellar Asset Contract to act as the pledge token,
/// * the crowdfund contract initialized with `goal`/`deadline`,
/// * two funded donors.
///
/// Returns everything a test needs to drive the flow.
struct Setup<'a> {
    env: Env,
    contract: CrowdfundContractClient<'a>,
    token: token::Client<'a>,
    token_admin: token::StellarAssetClient<'a>,
    contract_id: Address,
    beneficiary: Address,
    donor_a: Address,
    donor_b: Address,
    #[allow(dead_code)]
    goal: i128,
    deadline: u64,
}

fn setup(goal: i128) -> Setup<'static> {
    let env = Env::default();
    env.mock_all_auths();

    // Start the ledger clock at a known time so deadlines are deterministic.
    env.ledger().set_timestamp(1_000);
    let deadline = 1_000 + 86_400; // +1 day

    let admin = Address::generate(&env);
    let beneficiary = Address::generate(&env);

    // Deploy a Stellar Asset Contract as the pledge token.
    let sac = env.register_stellar_asset_contract_v2(admin.clone());
    let token = token::Client::new(&env, &sac.address());
    let token_admin = token::StellarAssetClient::new(&env, &sac.address());

    // Deploy + initialize the crowdfund contract.
    let contract_id = env.register(CrowdfundContract, ());
    let contract = CrowdfundContractClient::new(&env, &contract_id);
    contract.initialize(&admin, &beneficiary, &sac.address(), &goal, &deadline);

    // Fund two donors with tokens.
    let donor_a = Address::generate(&env);
    let donor_b = Address::generate(&env);
    token_admin.mint(&donor_a, &1_000);
    token_admin.mint(&donor_b, &1_000);

    Setup {
        env,
        contract,
        token,
        token_admin,
        contract_id,
        beneficiary,
        donor_a,
        donor_b,
        goal,
        deadline,
    }
}

#[test]
fn pledge_escrows_tokens_and_accumulates_total() {
    let s = setup(500);

    // A pledges 200, B pledges 100.
    let after_a = s.contract.pledge(&s.donor_a, &200);
    assert_eq!(after_a, 200, "running total after first pledge");
    let after_b = s.contract.pledge(&s.donor_b, &100);
    assert_eq!(after_b, 300, "running total after second pledge");

    // Per-donor ledger is tracked independently.
    assert_eq!(s.contract.pledged_by(&s.donor_a), 200);
    assert_eq!(s.contract.pledged_by(&s.donor_b), 100);
    assert_eq!(s.contract.total_raised(), 300);
    assert!(!s.contract.goal_reached());

    // The tokens really moved into the contract's escrow (inter-contract call).
    assert_eq!(s.token.balance(&s.contract_id), 300);
    assert_eq!(s.token.balance(&s.donor_a), 800);
}

#[test]
fn multiple_pledges_from_same_donor_sum() {
    let s = setup(500);
    s.contract.pledge(&s.donor_a, &50);
    s.contract.pledge(&s.donor_a, &75);
    assert_eq!(s.contract.pledged_by(&s.donor_a), 125);
    assert_eq!(s.contract.total_raised(), 125);
}

#[test]
fn withdraw_transfers_pot_to_beneficiary_after_goal() {
    let s = setup(300);

    s.contract.pledge(&s.donor_a, &200);
    s.contract.pledge(&s.donor_b, &100); // exactly hits the goal
    assert!(s.contract.goal_reached());

    let withdrawn = s.contract.withdraw();
    assert_eq!(withdrawn, 300);

    // Beneficiary got the whole pot; escrow is empty.
    assert_eq!(s.token.balance(&s.beneficiary), 300);
    assert_eq!(s.token.balance(&s.contract_id), 0);
}

#[test]
fn refund_returns_contribution_after_failed_deadline() {
    let s = setup(1_000); // goal deliberately unreachable here

    s.contract.pledge(&s.donor_a, &200);
    s.contract.pledge(&s.donor_b, &100);
    assert_eq!(s.token.balance(&s.donor_a), 800);

    // Move past the deadline without meeting the goal.
    s.env.ledger().set_timestamp(s.deadline + 1);

    let refunded = s.contract.refund(&s.donor_a);
    assert_eq!(refunded, 200);
    assert_eq!(s.token.balance(&s.donor_a), 1_000, "donor made whole");
    assert_eq!(s.contract.pledged_by(&s.donor_a), 0);
    // B's escrow untouched.
    assert_eq!(s.token.balance(&s.contract_id), 100);
}

#[test]
fn pledge_after_deadline_fails() {
    let s = setup(500);
    s.env.ledger().set_timestamp(s.deadline + 1);
    let res = s.contract.try_pledge(&s.donor_a, &100);
    assert_eq!(res, Err(Ok(Error::DeadlinePassed)));
}

#[test]
fn withdraw_before_goal_fails() {
    let s = setup(500);
    s.contract.pledge(&s.donor_a, &100); // below goal
    let res = s.contract.try_withdraw();
    assert_eq!(res, Err(Ok(Error::GoalNotReached)));
}

#[test]
fn refund_before_deadline_fails() {
    let s = setup(1_000);
    s.contract.pledge(&s.donor_a, &100);
    let res = s.contract.try_refund(&s.donor_a);
    assert_eq!(res, Err(Ok(Error::DeadlineNotReached)));
}

#[test]
fn refund_blocked_when_goal_reached() {
    let s = setup(300);
    s.contract.pledge(&s.donor_a, &300); // goal met
    s.env.ledger().set_timestamp(s.deadline + 1);
    let res = s.contract.try_refund(&s.donor_a);
    assert_eq!(res, Err(Ok(Error::GoalAlreadyReached)));
}

#[test]
fn double_initialize_fails() {
    let s = setup(500);
    let other = Address::generate(&s.env);
    let res =
        s.contract
            .try_initialize(&other, &other, &s.token.address, &500, &(s.deadline + 10));
    assert_eq!(res, Err(Ok(Error::AlreadyInitialized)));
}

#[test]
fn rejects_non_positive_pledge() {
    let s = setup(500);
    let res = s.contract.try_pledge(&s.donor_a, &0);
    assert_eq!(res, Err(Ok(Error::InvalidAmount)));
    // Silence unused warning for token_admin in this path.
    let _ = &s.token_admin;
}
