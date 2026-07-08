// Central testnet configuration for the crowdfunding dApp.
// These are the on-chain facts produced when we deployed with the Stellar CLI.

export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
export const HORIZON_URL = "https://horizon-testnet.stellar.org";

// The FUND token contract WE deployed (Stellar Asset Contract). The UI reads
// its on-chain metadata (name/symbol/decimals) to prove a real contract read.
export const FUND_TOKEN_CONTRACT_ID =
  "CDIYLEBXTJKNTJF56AFXOMOANHNZZW6SHQ7AB6B2KJZ7TSNLCUEC6IJE";

// The native XLM Stellar Asset Contract on testnet. Pledges are made by
// invoking its `transfer` function — a genuine Soroban contract call that
// emits `transfer` events (no trustline required, so anyone can pledge).
export const XLM_SAC_CONTRACT_ID =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// Dedicated account that receives pledges — the crowdfunding beneficiary.
export const CAMPAIGN_ADDRESS =
  "GBIYZWNE6HGKGGT2G73W6F7ZXXRQ2LP3RGLYIOOTZH6557A3EEBB4S7D";

// Campaign parameters (display only — the "raised" number is read from chain).
export const CAMPAIGN_GOAL_XLM = 500; // fundraising goal, in XLM
export const CAMPAIGN_BASELINE_XLM = 10000; // account balance at campaign start

// The testnet Friendbot distributor that funded the campaign account. Its
// initial 10,000 XLM transfer emits a `transfer` event too, so we hide it
// from the live "pledges" feed (it's already baked into the baseline).
export const EXCLUDED_SENDERS = [
  "GAIH3ULLFQ4DGSECF2AR555KZ4KNDGEKN4AFI4SU2M7B43MGK3QJZNSR",
];

// Explorer helpers.
export const explorerTx = (hash) =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const explorerContract = (id) =>
  `https://stellar.expert/explorer/testnet/contract/${id}`;
export const explorerAccount = (addr) =>
  `https://stellar.expert/explorer/testnet/account/${addr}`;
