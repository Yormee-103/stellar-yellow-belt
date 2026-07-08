// Multi-wallet integration via StellarWalletsKit.
// One kit instance is shared across the app; it supports Freighter, xBull,
// Albedo, Lobstr, Rabet, Hana and more via allowAllModules().
"use client";

import {
  StellarWalletsKit,
  WalletNetwork,
  allowAllModules,
  FREIGHTER_ID,
} from "@creit.tech/stellar-wallets-kit";
import { NETWORK_PASSPHRASE } from "./config";

let kit = null;

// Lazily build the kit (only in the browser — it touches window/DOM).
export function getKit() {
  if (typeof window === "undefined") return null;
  if (!kit) {
    kit = new StellarWalletsKit({
      network: WalletNetwork.TESTNET,
      selectedWalletId: FREIGHTER_ID,
      modules: allowAllModules(),
    });
  }
  return kit;
}

// List every wallet the kit knows about, flagged with whether it's installed.
// Used to render the "wallet options available" screen.
export async function listWallets() {
  const k = getKit();
  if (!k) return [];
  return k.getSupportedWallets();
}

// Open the built-in wallet-picker modal and resolve with the chosen address.
// Throws if no Freighter/other wallet is available or the user cancels.
export function openWalletModal() {
  const k = getKit();
  if (!k) throw new Error("Wallet kit is not available in this environment.");

  return new Promise((resolve, reject) => {
    k.openModal({
      onWalletSelected: async (option) => {
        try {
          k.setWallet(option.id);
          const { address } = await k.getAddress();
          if (!address) {
            throw new Error(
              `No account found in ${option.name}. Unlock the wallet and try again.`
            );
          }
          resolve({ address, walletId: option.id, walletName: option.name });
        } catch (e) {
          reject(e);
        }
      },
      onClosed: () => reject(new Error("WALLET_MODAL_CLOSED")),
    });
  });
}

// Connect directly to a specific wallet id (used by our custom wallet grid).
export async function connectWallet(walletId) {
  const k = getKit();
  if (!k) throw new Error("Wallet kit is not available in this environment.");
  k.setWallet(walletId);
  const { address } = await k.getAddress();
  if (!address) {
    throw new Error("No account returned. Unlock your wallet and try again.");
  }
  return { address, walletId };
}

// Ask the active wallet to sign a transaction XDR on testnet.
export async function signWithWallet(xdr, address) {
  const k = getKit();
  if (!k) throw new Error("Wallet kit is not available.");
  const { signedTxXdr } = await k.signTransaction(xdr, {
    address,
    networkPassphrase: NETWORK_PASSPHRASE,
  });
  return signedTxXdr;
}

export async function disconnectWallet() {
  const k = getKit();
  if (!k) return;
  try {
    await k.disconnect();
  } catch {
    // Some wallets have no disconnect concept — ignore.
  }
}
