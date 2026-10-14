# CURR Hub

A simple, wallet-first Web3 portal for test networks. The homepage has four tabs: **Wallet balance**, **Swap**, **Buy**, and **Airdrop**. There is no separate registration account or admin menu in the user interface.

## What works today

- Users choose MetaMask, Phantom, or another detected browser wallet from a popup. The wallet itself asks for connection approval. The website does not ask users to type their wallet address.
- An Ethereum wallet connects on **Sepolia** and shows its live Sepolia ETH balance. Given a deployed Sepolia tCURR ERC-20 contract address, the site reads the connected wallet's live `balanceOf` and can suggest adding tCURR to the wallet display.
- A Solana wallet connects and shows its **Devnet** SOL balance via the configured public RPC. The site reads Devnet data; it does not change the Solana wallet's selected network.
- Swap and Buy show sample quotes only. Airdrop shows the live tCURR holding when available. Pressing an action button opens an identity verification notice. No identity verification provider is connected, so no trade, purchase, or claim can be submitted.
- The Buy tab never asks for a card number and never charges a card.

The previous local demo account, self-approved KYC, sample shareholder balances, admin simulator, local swaps, sandbox orders, and demo claims were removed from the user interface. Their old browser data is not used by the new page.

## Run locally

Requires Node.js 20.9+ and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000` in a browser where the wallet extension is installed. A MetaMask or Phantom browser popup should appear after you choose that wallet and approve connection. On mobile, use the wallet's supported in-app browser.

The tCURR **contract** address is different from the user's **wallet** address. After a tCURR contract is deployed on Ethereum Sepolia, either set `NEXT_PUBLIC_TCURR_SEPOLIA_ADDRESS` in `.env.local` and restart the server, or enter the contract address under **Set up tCURR test token** on the Wallet balance tab. The latter is stored only in that browser. If no contract exists yet, the balance remains unavailable; the portal never invents a tCURR holding.

Only use public RPC URLs and contract addresses in `NEXT_PUBLIC_` variables. Never put private keys, recovery phrases, API secrets, or admin credentials in frontend environment variables.

## Test contracts

`contracts/TCURRTest.sol` is an integer-unit restricted ERC-20 test token. Its owner may allowlist addresses and mint tokens. `contracts/UCURRTest.sol` is a capped ERC-20 test utility token. They are source code only: **this repository has not deployed either contract or minted any tCURR**. The tCURR test contract does not itself establish legal share ownership.

```bash
npm run contracts:compile
```

Compilation checks source in memory. It does not submit a blockchain transaction. Deployment and minting require a user's wallet approval and Sepolia test ETH for network fees.

## Verification

```bash
npm run typecheck
npm test
npm run contracts:compile
npm run build
```

The automated tests cover the standalone airdrop calculation library retained for possible future rules. The live wallet popup and on-chain balance require a browser extension and deployed test token to check end to end. No real KYC, swap provider, payment provider, or claim contract is connected.

## Release boundaries

This is a testnet prototype. The site is marked `noindex` and has basic response security headers. Public release of wallet-gated actions needs an identity verification provider, server-side authorization, audited contracts, payment and swap integrations, and approved airdrop rules. The final airdrop method and snapshot policy await management approval.
