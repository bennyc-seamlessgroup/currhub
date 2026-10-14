# CURR Hub

A simple, wallet-first Web3 portal for test networks. The homepage has four tabs: **Wallet balance**, **Swap**, **Buy**, and **Airdrop**. There is no separate registration account or admin menu in the user interface.

## What works today

- Users choose MetaMask, Phantom, or another detected browser wallet from a popup. The wallet itself asks for connection approval. The website does not ask users to type their wallet address.
- An Ethereum wallet connects on **Sepolia** and shows its live Sepolia ETH balance. The site reads the connected wallet's live `balanceOf` for the fixed tCURR and uCURR contracts and can suggest adding them to the wallet display.
- A Solana wallet connects and shows its **Devnet** SOL balance via the configured public RPC. The site reads Devnet data; it does not change the Solana wallet's selected network.
- Swap previews either uCURR → USDC or USDC → uCURR at a clearly illustrative rate. Buy shows a sample amount only. Neither makes a transaction or opens an identity check. Airdrop shows the live tCURR holding when available; checking its status opens the identity verification notice. No identity verification provider is connected, so no claim can be submitted.
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

The token **contract** addresses are different from a user's **wallet** address. The deployed Sepolia addresses are fixed in `lib/tcurr.ts`; visitors cannot edit them in the site. The **New to test tokens?** setup link appears only after an owner wallet connects and the site checks the contracts' live owner addresses. The top-right wallet button contains **Switch wallet** and **Disconnect**. Disconnect clears the site's current wallet view; it does not revoke the wallet extension's site permission.

Only use public RPC URLs and contract addresses in `NEXT_PUBLIC_` variables. Never put private keys, recovery phrases, API secrets, or admin credentials in frontend environment variables.

## Test contracts

`contracts/TCURRTest.sol` is an integer-unit restricted ERC-20 test token. Its owner may allowlist addresses and mint tokens. `contracts/UCURRTest.sol` is a capped ERC-20 test utility token. Their deployed Sepolia addresses are:

| Token | Contract address |
| --- | --- |
| tCURR | [`0x8a362AC747eB9751e18f7a7D94da2130A7772E2c`](https://sepolia.etherscan.io/address/0x8a362AC747eB9751e18f7a7D94da2130A7772E2c) |
| uCURR | [`0xB7E470175c2f271394c5e5F7348d46A1F5EfCbc1`](https://sepolia.etherscan.io/address/0xB7E470175c2f271394c5e5F7348d46A1F5EfCbc1) |

These contracts have owner-only minting. The tCURR test token does not itself establish legal share ownership.

### Set up with MetaMask

1. Open [`/setup`](http://localhost:3000/setup) in the same browser as MetaMask. Connect MetaMask on Sepolia. The page shows your public wallet address and Sepolia ETH balance.
2. If you need Sepolia ETH for network fees, copy the public address and open the [Sepolia PoW faucet](https://sepolia-faucet.pk910.de/). Paste the address, run its browser mining task, stop it, then claim test ETH. Mainnet ETH is not required. Receiving tokens does not require ETH.
3. In the second section of `/setup`, the contract owner can choose an amount and click **Mint … to my wallet**. Approve each transaction in MetaMask. tCURR uses whole units; uCURR can use decimals. Other wallets cannot mint these contracts.
4. To send tCURR to another test wallet, enter that wallet's public address in the setup page and click **Allow tCURR**. The owner approves this Sepolia transaction, then sends tCURR from MetaMask. uCURR can be sent normally. tCURR transfers require both sender and recipient to be allowlisted.
5. The recipient connects their wallet on the main page to see live balances. **Not showing in your wallet?** asks MetaMask to display a token; this does not mint it.

The setup page never deploys new contracts or transfers tokens. Minting and allowlisting require the contract owner's connected MetaMask wallet and that user's approval. Other visitors can connect a wallet and see tokens sent to them.

```bash
npm run contracts:compile
npm run contracts:check-artifacts
```

The committed public ABI and bytecode in `lib/test-contract-artifacts.json` remain available for contract development; regenerate them with `npm run contracts:artifacts` after editing either Solidity file. The live site uses the deployed addresses above. Compilation and artifact checks do not submit a blockchain transaction.

## Verification

```bash
npm run typecheck
npm test
npm run contracts:compile
npm run contracts:check-artifacts
npm run build
```

The automated tests cover the standalone airdrop calculation library retained for possible future rules. The live wallet popup and on-chain balance require a browser extension and deployed test token to check end to end. No real KYC, swap provider, payment provider, or claim contract is connected.

## Future live swaps

The current swap rate is illustrative. A real Sepolia swap needs a known test USDC contract, a uCURR/USDC liquidity pool with both tokens supplied, live quotes, spending approval for the input token, slippage controls, and a wallet-confirmed swap transaction. Uniswap is one possible protocol; its contracts are deployed on Sepolia. The portal does not yet connect to a pool or submit swap transactions.

## Release boundaries

This is a testnet prototype. The site is marked `noindex` and has basic response security headers. Live swaps and payments need their respective integrations and review. Airdrop claims need approved rules, a snapshot policy, and the planned identity verification flow. The final airdrop method and snapshot policy await management approval.
