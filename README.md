# CURR Hub

A simple, wallet-first Web3 portal for test networks. The homepage has four tabs: **Wallet balance**, **Swap**, **Buy**, and **Airdrop**. There is no separate registration account or admin menu in the user interface.

## What works today

- Users choose MetaMask, Phantom, or another detected browser wallet from a popup. The wallet itself asks for connection approval. The website does not ask users to type their wallet address.
- An Ethereum wallet connects on **Sepolia** and shows its live Sepolia ETH balance. The site reads the connected wallet's live `balanceOf` for the fixed tCURR and uCURR contracts and can suggest adding them to the wallet display.
- A Solana wallet connects and shows its **Devnet** SOL balance via the configured public RPC. The site reads Devnet data; it does not change the Solana wallet's selected network.
- Swap reads live Sepolia uCURR ↔ test USDC quotes from the [Uniswap v2 Sepolia router](https://developers.uniswap.org/docs/protocols/v2/deployments). It asks the connected wallet to approve exactly the input amount, then to confirm a real testnet swap. Swaps are available after the uCURR/USDC pool has liquidity. Buy shows a sample amount only and makes no transaction. Neither Swap nor Buy opens an identity check. Airdrop shows the live tCURR holding when available; checking its status opens the identity verification notice. No identity verification provider is connected, so no claim can be submitted.
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
| Test USDC | [`0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`](https://developers.circle.com/stablecoins/usdc-contract-addresses) |

These contracts have owner-only minting. The tCURR test token does not itself establish legal share ownership.

### Set up with MetaMask

1. Open [`/setup`](http://localhost:3000/setup) in the same browser as MetaMask. Connect MetaMask on Sepolia. The page shows your public wallet address and Sepolia ETH balance.
2. If you need Sepolia ETH for network fees, copy the public address and open the [Sepolia PoW faucet](https://sepolia-faucet.pk910.de/). Paste the address, run its browser mining task, stop it, then claim test ETH. Mainnet ETH is not required. Receiving tokens does not require ETH.
3. In the second section of `/setup`, the contract owner can choose an amount and click **Mint … to my wallet**. Approve each transaction in MetaMask. tCURR uses whole units; uCURR can use decimals. Other wallets cannot mint these contracts.
4. To start swaps, the uCURR owner enters the amounts to place in the **Start real Sepolia swaps** section. With 50 uCURR and 20 test USDC, the suggested starting amounts are 40 uCURR and 4 test USDC. This starts the pool at 10 uCURR per test USDC and leaves both tokens in the wallet for testing. The owner confirms three separate Sepolia transactions in MetaMask: authorize uCURR, authorize test USDC, then create the pool and deposit. The page reads back the live pool status after confirmation. It also lets the owner approve and withdraw their pool position later.
5. Open **Swap** on the main page, enter an amount, and review the live quote and minimum received. Confirm an exact spending approval if asked, then confirm the swap in MetaMask. The swap has 1% slippage tolerance and a 20-minute deadline. Small pools can have large price changes, so try small amounts first.
6. To send tCURR to another test wallet, enter that wallet's public address in the setup page and click **Allow tCURR**. The owner approves this Sepolia transaction, then sends tCURR from MetaMask. uCURR can be sent normally. tCURR transfers require both sender and recipient to be allowlisted.
7. The recipient connects their wallet on the main page to see live balances. **Not showing in your wallet?** asks MetaMask to display a token; this does not mint it.

The setup page never deploys new token contracts or transfers tokens without wallet confirmation. Creating a liquidity pool deposits the amounts the owner chooses into the Uniswap v2 pair and gives that wallet a pool position. Minting, allowlisting, and pool funding require the contract owner's connected MetaMask wallet and that user's approval. Other visitors can connect a wallet and see tokens sent to them.

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

The automated tests cover the standalone airdrop calculation library retained for possible future rules. The live wallet popup and transactions require a browser extension and testnet tokens to check end to end. There is no real KYC, payment provider, or claim contract. All swaps and liquidity actions use Sepolia test tokens; no mainnet funds are involved.

## Swap contracts and status

The site uses the [official Uniswap v2 Sepolia factory and Router02](https://developers.uniswap.org/docs/protocols/v2/deployments) and [Circle's Sepolia test USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses). Factory: `0xF62c03E08ada871A0bEb309762E260a7a6a880E6`; router: `0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3`. These addresses are fixed in `lib/sepolia-swap.ts`. The page queries the factory for the pair and its reserves instead of assuming a pair already exists. An owner still has to approve both token deposits and fund the pool in MetaMask before any visitor can swap. Test USDC has no cash value.

## Release boundaries

This is a testnet prototype. The site is marked `noindex` and has basic response security headers. Before any mainnet use, the token contracts, liquidity policy, wallet flow, and swap integration need dedicated review. Payments are not integrated. Airdrop claims need approved rules, a snapshot policy, and the planned identity verification flow. The final airdrop method and snapshot policy await management approval.
