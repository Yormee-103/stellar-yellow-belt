// Central testnet configuration for the crowdfunding dApp.
// These are the on-chain facts produced when we deployed with the Stellar CLI.

export const NETWORK_PASSPHRASE = "Test SDF Network ; September 2015";
export const SOROBAN_RPC_URL = "https://soroban-testnet.stellar.org";
export const HORIZON_URL = "https://horizon-testnet.stellar.org";

// The FUND token contract WE deployed (Stellar Asset Contract). The UI reads
// its on-chain metadata (name/symbol/decimals) to prove a real contract read.
export const FUND_TOKEN_CONTRACT_ID =
  "CDIYLEBXTJKNTJF56AFXOMOANHNZZW6SHQ7AB6B2KJZ7TSNLCUEC6IJE";

// The custom Soroban CROWDFUND contract WE wrote & deployed (Rust). Pledges are
// escrowed here; it performs inter-contract `transfer` calls into the token
// contract. Set via NEXT_PUBLIC_CROWDFUND_CONTRACT_ID at build time, with the
// deployed testnet address as the default.
export const CROWDFUND_CONTRACT_ID =
  process.env.NEXT_PUBLIC_CROWDFUND_CONTRACT_ID ||
  "CAOBIEYX3QTUV3AKZ2XEPWZIXJRGTGJ7YM3GDK3BTXJ4DTOGSLF2ZWPH";

// The native XLM Stellar Asset Contract on testnet. Pledges are made by
// invoking its `transfer` function — a genuine Soroban contract call that
// emits `transfer` events (no trustline required, so anyone can pledge).
export const XLM_SAC_CONTRACT_ID =
  "CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC";

// Dedicated account that receives pledges — the crowdfunding beneficiary.
// (Also used as the source for read-only contract simulations.)
export const CAMPAIGN_ADDRESS =
  "GBIYZWNE6HGKGGT2G73W6F7ZXXRQ2LP3RGLYIOOTZH6557A3EEBB4S7D";

// Fallback display goal, in XLM. The live goal is READ from the crowdfund
// contract's `goal()`; this is only shown before the first read resolves.
export const CAMPAIGN_GOAL_XLM = 500;

// Explorer helpers.
export const explorerTx = (hash) =>
  `https://stellar.expert/explorer/testnet/tx/${hash}`;
export const explorerContract = (id) =>
  `https://stellar.expert/explorer/testnet/contract/${id}`;
export const explorerAccount = (addr) =>
  `https://stellar.expert/explorer/testnet/account/${addr}`;
