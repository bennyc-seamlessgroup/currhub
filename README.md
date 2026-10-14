# CURR Hub

A simple, wallet-first Web3 portal for test networks. The homepage has four tabs: **Wallet balance**, **Swap**, **Buy**, and **Airdrop**. There is no separate registration account or admin menu in the user interface.

## What works today

- Users choose MetaMask, Phantom, or another detected browser wallet from a popup. The wallet itself asks for connection approval. The website does not ask users to type their wallet address.
- An Ethereum wallet connects on **Sepolia** and shows its live Sepolia ETH balance. Given deployed Sepolia tCURR and uCURR ERC-20 contract addresses, the site reads the connected wallet's live `balanceOf` for both tokens and can suggest adding them to the wallet display.
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

The token **contract** addresses are different from the user's **wallet** address. After deployment, either set `NEXT_PUBLIC_TCURR_SEPOLIA_ADDRESS` and `NEXT_PUBLIC_UCURR_SEPOLIA_ADDRESS` in `.env.local` and restart the server, or enter the addresses under **Set up test tokens** on the Wallet balance tab. The latter are stored only in that browser. If no contract exists yet, the balance remains unavailable; the portal never invents token holdings.

Only use public RPC URLs and contract addresses in `NEXT_PUBLIC_` variables. Never put private keys, recovery phrases, API secrets, or admin credentials in frontend environment variables.

## Test contracts

`contracts/TCURRTest.sol` is an integer-unit restricted ERC-20 test token. Its owner may allowlist addresses and mint tokens. `contracts/UCURRTest.sol` is a capped ERC-20 test utility token. **This repository has not deployed either contract or minted either token.** The tCURR test contract does not itself establish legal share ownership.

### Set up with MetaMask

1. Obtain free **Sepolia test ETH** for the MetaMask account you will use. Mainnet ETH is not needed. Contract deployment and minting each use Sepolia test ETH for network fees.
2. Open [`/setup`](http://localhost:3000/setup) in the same browser as MetaMask. Connect MetaMask on Sepolia.
3. Click **Deploy tCURR** and approve the request in MetaMask. Wait for the contract address to appear. Repeat for **Deploy uCURR**. Each deployment is a separate Sepolia transaction.
4. Set the test amount for each token and click **Mint … to my wallet**. Approve each transaction in MetaMask. tCURR uses whole units; uCURR can use decimals. The connected wallet becomes owner of both contracts, and the tCURR constructor allowlists that owner.
5. Return to **Wallet balance** and reconnect MetaMask. Both live balances should appear. You can optionally use **Show in wallet** to ask MetaMask to display the token. Importing a token does not mint it.

The setup page stores deployed addresses in the current browser so the portal can read them immediately. For other users or devices, configure the public contract addresses in deployment environment variables and rebuild/redeploy the site. The setup page does not transfer tokens to other people. tCURR transfers require both sender and recipient to be allowlisted by the contract owner.

```bash
npm run contracts:compile
npm run contracts:check-artifacts
```

The committed public ABI and bytecode in `lib/test-contract-artifacts.json` power the setup page; regenerate them with `npm run contracts:artifacts` after editing either Solidity file. Compilation and artifact checks do not submit a blockchain transaction. Deployment and minting require the user's MetaMask approval.

## Verification

```bash
npm run typecheck
npm test
npm run contracts:compile
npm run contracts:check-artifacts
npm run build
```

The automated tests cover the standalone airdrop calculation library retained for possible future rules. The live wallet popup and on-chain balance require a browser extension and deployed test token to check end to end. No real KYC, swap provider, payment provider, or claim contract is connected.

## Release boundaries

This is a testnet prototype. The site is marked `noindex` and has basic response security headers. Public release of wallet-gated actions needs an identity verification provider, server-side authorization, audited contracts, payment and swap integrations, and approved airdrop rules. The final airdrop method and snapshot policy await management approval.
