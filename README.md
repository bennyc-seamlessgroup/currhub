# CURR Hub

A simple, wallet-first Web3 portal for test networks. The homepage has four tabs: **Wallet balance**, **Swap**, **Buy**, and **Airdrop**. There is no separate registration account. The restricted `/admin` page manages Sepolia airdrop rounds.

## What works today

- Users choose MetaMask, Phantom, or another detected browser wallet from a popup. The wallet itself asks for connection approval. The website does not ask users to type their wallet address. The site remembers the chosen wallet and public address between pages. Previously approved Ethereum wallets and Phantom reconnect silently when supported; other Solana wallets may need a new click. Disconnect clears the saved preference.
- An Ethereum wallet connects on **Sepolia** and shows its live Sepolia ETH balance. The site reads the connected wallet's live `balanceOf` for the fixed tCURR and uCURR contracts and can suggest adding them to the wallet display.
- A Solana wallet connects and shows its **Devnet** SOL balance via the configured public RPC. The setup page also reads Circle Devnet test USDC for a connected Phantom wallet. The site reads Devnet data; it does not change the Solana wallet's selected network.
- Swap shows live Sepolia uCURR ↔ test USDC quotes from the [Uniswap v2 Sepolia router](https://developers.uniswap.org/docs/protocols/v2/deployments) even before a wallet connects. The public `/api/swap-quote` route reads the pool through a server-side RPC; `SEPOLIA_RPC_URL` can override the default public endpoint. Trading asks the connected wallet to approve exactly the input amount, then to confirm a real testnet swap. Buy shows a sample amount only and makes no transaction. Neither Swap nor Buy opens an identity check.
- Airdrop can show a connected Sepolia wallet's snapshot status, test identity review status, available uCURR reward, and on-chain claimed status. Claiming asks MetaMask to approve a Sepolia transaction. The feature stays closed until the Supabase database is configured, the separate claim contract is deployed and funded, and an admin publishes an approved reward round. No claim contract or round has been deployed or published by this repository change.
- The Buy tab never asks for a card number and never charges a card.

The previous local demo account, self-approved KYC, sample shareholder balances, admin simulator, local swaps, sandbox orders, and demo claims were removed from the user interface. Their old browser data is not used by the new page. The new admin workflow requires a real wallet signature and writes drafts to Supabase rather than browser storage.

## Run locally

Requires Node.js 20.9+ and npm.

```bash
npm ci
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000` in a browser where the wallet extension is installed. A MetaMask or Phantom browser popup should appear after you choose that wallet and approve connection. On mobile, use the wallet's supported in-app browser.

The token **contract** addresses are different from a user's **wallet** address. The deployed Sepolia addresses are fixed in `lib/tcurr.ts`; visitors cannot edit them in the site. The **New to test tokens?** Ethereum setup link appears only after an owner wallet connects and the site checks the contracts' live owner addresses. A connected Solana wallet gets a link to the Solana guide. The setup page has separate **Ethereum Sepolia** and **Solana Devnet** tabs. The top-right wallet button contains **Switch wallet** and **Disconnect**. Disconnect clears the site's current wallet view; it does not revoke the wallet extension's site permission.

Only use public RPC URLs and contract addresses in `NEXT_PUBLIC_` variables. Never put private keys, recovery phrases, API secrets, or admin credentials in frontend environment variables.

## Set up the Sepolia airdrop

The claim contract is separate from the existing uCURR token. The existing owner-only uCURR contract stays at the same address. Nothing in this repository deploys or funds the claim contract automatically; the owner approves those Sepolia transactions in MetaMask.

1. Create a [Supabase](https://supabase.com/dashboard) project. In its **SQL Editor**, run [`supabase/airdrop.sql`](supabase/airdrop.sql). This creates campaign, snapshot, identity-review, and audit tables. Its RLS settings deny browser roles direct access.
2. In Supabase **Settings → API Keys**, create/copy a `sb_secret_…` server key. In **Settings → API**, copy the Project URL. Set `SUPABASE_URL` and `SUPABASE_SECRET_KEY` in local `.env.local` and in Vercel's server environment settings. Never paste either value into the site, commit it, or use a `NEXT_PUBLIC_` name.
3. Generate a random secret of at least 32 characters with `openssl rand -hex 32`, and set `AIRDROP_AUTH_SECRET` on the server. Set `ADMIN_WALLETS` to the public Ethereum address of the admin who owns uCURR (comma-separate addresses if needed). Set `SEPOLIA_RPC_URL` to a reliable **Sepolia** RPC that supports historical `eth_getCode`, `eth_getLogs`, and `eth_call` at the snapshot block. Redeploy after setting Vercel environment variables.
4. Open `/admin`, connect the authorized MetaMask wallet on Sepolia, and sign the no-fee sign-in message. Deploy the `UCURRAirdrop` claim contract there; MetaMask will request one Sepolia transaction. The page saves its address in Supabase after checking that it points to the fixed uCURR token and belongs to the admin wallet. If saving fails, copy the deployed contract address and use **Already deployed?** to reconnect it.
5. Create a **draft** round. The admin page can find the tCURR deployment block and a recent safe snapshot block. It reads tCURR `Transfer` events, reconstructs all holder balances, and checks them against the token's historical total supply. The pilot allows at most 50,000 blocks per snapshot and 500 holder wallets. Use a recent test round or a background indexer for larger histories.
6. Holder wallets open **Airdrop**, sign a no-fee message, and submit the test identity declaration. The admin reviews submissions. This is **manual test review, not regulated KYC**; the app stores name, optional email, country, status, and consent time, but no identity documents. Once management approves the snapshot, proportional reward rule, and uCURR pool, the admin freezes the approved allocations.
7. The uCURR owner funds the claim contract with test uCURR using **Mint … to claim contract**. The admin then publishes the round in MetaMask. The site verifies the confirmed transaction, root, reward total, and deadline before showing claims. Eligible users claim once each from their own wallet and need a little Sepolia ETH for network fees. The contract reserves each round's pool; an expired pool can be reclaimed by its owner on-chain.

The reward rule is configurable per round as a uCURR pool distributed proportionally to snapshot tCURR holdings of approved wallets. Drafting a round does not publish it. The final business rule and identity policy still require management approval. A published Merkle root is immutable, so identity review must finish before freezing allocations. The deployed contract can pause a round if needed.

Wallet sign-in uses an [ERC-4361-style message](https://eips.ethereum.org/EIPS/eip-4361) and a short-lived, server-signed HTTP-only session cookie. The admin API checks the signed wallet against `ADMIN_WALLETS`; hiding the link is not the security boundary. Supabase's secret key stays server-side. The claim contract checks Merkle proofs and one-time claims on-chain; database status alone never transfers tokens.

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
4. In the third section, open [Circle's testnet faucet](https://faucet.circle.com/), choose **USDC** and **Ethereum Sepolia**, paste your public MetaMask address, and send test USDC. The setup page can refresh its live USDC balance and ask MetaMask to display the token. Circle's Sepolia test USDC contract is `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238`.
5. To start swaps in a new pool, the uCURR owner enters the amounts to place in **Start real Sepolia swaps**. The suggested starting amounts are 40 uCURR and 4 test USDC. The owner confirms three separate Sepolia transactions in MetaMask: authorize uCURR, authorize test USDC, then create the pool and deposit. The page reads back the live pool status after confirmation. It also lets the owner approve and withdraw their pool position later.
6. Open **Swap** on the main page, enter an amount, and review the live quote and minimum received. Confirm an exact spending approval if asked, then confirm the swap in MetaMask. The swap has 1% slippage tolerance and a 20-minute deadline. Small pools can have large price changes, so try small amounts first.
7. To send tCURR to another test wallet, enter that wallet's public address in the setup page and click **Allow tCURR**. The owner approves this Sepolia transaction, then sends tCURR from MetaMask. uCURR can be sent normally. tCURR transfers require both sender and recipient to be allowlisted.
8. The recipient connects their wallet on the main page to see live balances. **Not showing in your wallet?** asks MetaMask to display a token; this does not mint it.

### Prepare Solana Devnet with Phantom

The **Solana Devnet** tab gives an honest setup path for the second chain:

1. In Phantom, enable Testnet Mode and select **Solana Devnet** using [Phantom's instructions](https://help.phantom.com/articles/use-testnets-in-phantom-5997313271699). Connect Phantom in the setup page, copy its public Solana address, and request [Devnet SOL](https://faucet.solana.com/) for test fees. The page reads the connected address's Devnet SOL balance.
2. Solana tCURR and uCURR need separate SPL token mints. The [Solana token quickstart](https://solana.com/docs/tokens/quickstart) explains mints, token accounts, and minting; its Playground wallet is separate from Phantom by default. No CURR Solana mints have been deployed or linked to the portal. Matching Ethereum's restricted tCURR transfers requires additional Solana logic.
3. At [Circle's testnet faucet](https://faucet.circle.com/), choose **USDC** and **Solana Devnet** and paste your public Solana address. The page reads this wallet's live test USDC for Circle's Devnet mint `4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`.
4. Solana uCURR/USDC swaps need the Solana uCURR mint, a Devnet liquidity pool, and a wallet confirmed swap integration. [Raydium's official CPMM swap example](https://github.com/raydium-io/raydium-sdk-V2-demo/blob/master/src/cpmm/swap.ts) includes a Devnet integration path. [Jupiter's Swap API](https://developers.jup.ag/docs/swap/index) documents its main Solana routing service, with no Devnet route in the published integration guide; it is a candidate for a later mainnet rollout rather than this Devnet test. No Solana swap transactions are available in CURR Hub yet. Ethereum and Solana test tokens are separate; they do not appear on the other chain automatically.

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

The automated tests cover deterministic proportional allocation and Merkle proof generation. Solidity compilation checks the claim contract and token contracts. The live wallet popup, Supabase workflow, deployment, and transactions require a configured project, browser wallet, and Sepolia test tokens to check end to end. There is no formal KYC or payment provider. No claim contract has been deployed by this code change. All swaps, liquidity, and planned claim actions use Sepolia test tokens; no mainnet funds are involved.

## Swap contracts and status

The site uses the [official Uniswap v2 Sepolia factory and Router02](https://developers.uniswap.org/docs/protocols/v2/deployments) and [Circle's Sepolia test USDC](https://developers.circle.com/stablecoins/usdc-contract-addresses). Factory: `0xF62c03E08ada871A0bEb309762E260a7a6a880E6`; router: `0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3`. These addresses are fixed in `lib/sepolia-swap.ts`. The [uCURR/USDC Sepolia pool](https://sepolia.etherscan.io/address/0x3b9B3Eddcfb179b47BEc17ECCaBe2Ff3f2DCfa26) was funded and live when checked on 14 October 2026. The page reads its current reserves and quotes instead of assuming a fixed price. Test USDC has no cash value.

The Swap screen names and links the Uniswap v2 protocol so users can see where execution occurs. CURR Hub calls the public protocol contracts directly; it does not use the Uniswap Labs API or Uniswap's hosted interface. The [Uniswap Labs API terms](https://support.uniswap.org/hc/en-us/articles/43018872248589-API-Terms-of-Use) have specific attribution and end-user terms obligations for API integrations, which do not describe this direct-contract flow. Before offering a production service, obtain review of CURR Hub's own terms, disclosures, and applicable requirements; a protocol attribution link alone is not a terms of service.

## Release boundaries

This is a testnet prototype. The site is marked `noindex` and has basic response security headers. Before any mainnet use, the token contracts, claim contract, identity process, liquidity policy, wallet flow, and swap integration need dedicated review. Payments are not integrated. Airdrop publishing requires approved rules and a snapshot policy. The final airdrop method and snapshot policy await management approval.
