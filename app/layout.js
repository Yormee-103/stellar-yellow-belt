import "./globals.css";

export const metadata = {
  title: "Stellar Crowdfund — Orange Belt dApp",
  description:
    "A custom Soroban crowdfunding escrow contract on Stellar testnet: inter-contract token transfers, on-chain per-donor accounting, real-time contract events, and transaction status tracking.",
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b1020",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
