#!/usr/bin/env bash
#
# Deploy the crowdfund Soroban contract to Stellar testnet and initialize a
# campaign. Prints the contract address + tx hashes for the README.
#
# Prereqs: stellar CLI, a funded testnet identity. Usage:
#   ./scripts/deploy.sh
#
set -euo pipefail

NETWORK="testnet"
IDENTITY="${STELLAR_IDENTITY:-crowdfund}"
WASM="contracts/target/wasm32v1-none/release/crowdfund.wasm"
# Fallback for older toolchains that emit to wasm32-unknown-unknown.
[ -f "$WASM" ] || WASM="contracts/target/wasm32-unknown-unknown/release/crowdfund.wasm"

# The token pledges are denominated in — native XLM Stellar Asset Contract.
TOKEN_CONTRACT="CDLZFC3SYJYDZT7K67VZ75HPJVIEUVNIXF47ZG2FB2RMQQVU2HHGCYSC"

echo "==> Ensuring identity '$IDENTITY' exists and is funded"
stellar keys generate "$IDENTITY" --network "$NETWORK" --fund 2>/dev/null || true
ADMIN_ADDR="$(stellar keys address "$IDENTITY")"
echo "    admin/beneficiary: $ADMIN_ADDR"

echo "==> Building optimized wasm"
(cd contracts && stellar contract build)

echo "==> Uploading + deploying contract"
CONTRACT_ID="$(stellar contract deploy \
  --wasm "$WASM" \
  --source "$IDENTITY" \
  --network "$NETWORK")"
echo "    CROWDFUND_CONTRACT_ID: $CONTRACT_ID"

# Campaign: goal 500 XLM (in stroops), deadline 30 days out.
GOAL_STROOPS=5000000000
DEADLINE=$(( $(date +%s) + 60*60*24*30 ))

echo "==> Initializing campaign (goal=500 XLM, +30d deadline)"
stellar contract invoke \
  --id "$CONTRACT_ID" \
  --source "$IDENTITY" \
  --network "$NETWORK" \
  -- initialize \
  --admin "$ADMIN_ADDR" \
  --beneficiary "$ADMIN_ADDR" \
  --token "$TOKEN_CONTRACT" \
  --goal "$GOAL_STROOPS" \
  --deadline "$DEADLINE"

echo ""
echo "=================================================================="
echo "Deployed crowdfund contract:"
echo "  Contract ID : $CONTRACT_ID"
echo "  Admin       : $ADMIN_ADDR"
echo "  Token       : $TOKEN_CONTRACT"
echo "  Goal        : 500 XLM"
echo "  Explorer    : https://stellar.expert/explorer/testnet/contract/$CONTRACT_ID"
echo "=================================================================="
echo ""
echo "Set NEXT_PUBLIC_CROWDFUND_CONTRACT_ID=$CONTRACT_ID in your env / Vercel."
