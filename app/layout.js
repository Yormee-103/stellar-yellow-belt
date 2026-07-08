import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

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
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        {children}
      </body>
    </html>
  );
}
