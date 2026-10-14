"use client";

import { useEffect, useMemo, useState } from "react";
import { brand } from "@/lib/brand";
import { addressKey, calculateAirdrop, claimAllocation } from "@/lib/airdrop.mjs";

type Chain = "ethereum" | "solana";
type Tab = "overview" | "wallets" | "airdrop" | "swap" | "buy" | "account" | "admin";
type Holding = { address: string; shares: number; eligible: boolean };
type Allocation = { address: string; shares: number; amount: number };
type Snapshot = { id: string; at: string; pool: number; allocations: Allocation[]; claims: string[] };
type Activity = { id: string; title: string; detail: string; at: string };
type Order = { id: string; usd: number; amount: number; at: string };
type Profile = { name: string; email: string; country: string; kyc: "not_started" | "approved_demo" };
type DemoState = {
  holdings: Holding[];
  pool: number;
  snapshot: Snapshot | null;
  balances: { uCURR: number; USDC: number };
  orders: Order[];
  profile: Profile | null;
  activity: Activity[];
};
type Wallet = { address: string; balance: string };

const STORAGE_KEY = "currhub-mvp-v1";
const SEPOLIA_CHAIN_ID = "0xaa36a7";
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC || "https://api.devnet.solana.com";
const nav: { id: Tab; label: string; icon: string; group: string }[] = [
  { id: "overview", label: "Overview", icon: "◫", group: "WORKSPACE" },
  { id: "wallets", label: "My wallets", icon: "◇", group: "WORKSPACE" },
  { id: "airdrop", label: "Airdrop", icon: "✳", group: "EXPLORE" },
  { id: "swap", label: "Swap demo", icon: "⇄", group: "EXPLORE" },
  { id: "buy", label: "Buy sandbox", icon: "▣", group: "EXPLORE" },
  { id: "account", label: "Account & KYC", icon: "◎", group: "MANAGE" },
  { id: "admin", label: "Admin simulator", icon: "▤", group: "MANAGE" },
];

function initialState(): DemoState {
  return {
    holdings: [
      { address: "0x71C7656EC7ab88b098defB751B7401B5f6d8976F", shares: 1200, eligible: true },
      { address: "0x8626f6940E2eb28930eFb4CeF49B2d1F2C9C1199", shares: 800, eligible: true },
      { address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", shares: 500, eligible: false },
    ],
    pool: 10000,
    snapshot: null,
    balances: { uCURR: 1250, USDC: 240 },
    orders: [],
    profile: null,
    activity: [],
  };
}

function shortAddress(value: string) {
  return value.length > 20 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
}
function format(value: number, digits = 0) {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}
function uid(prefix: string) {
  return `${prefix}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}
function now() { return new Date().toISOString(); }
function validAddress(address: string) {
  return /^0x[a-fA-F0-9]{40}$/.test(address) || /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(address);
}
function log(state: DemoState, title: string, detail: string): DemoState {
  return { ...state, activity: [{ id: uid("EVT"), title, detail, at: now() }, ...state.activity].slice(0, 12) };
}

declare global {
  interface Window {
    ethereum?: { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> };
    solana?: { connect: () => Promise<{ publicKey: { toString: () => string } }>; publicKey?: { toString: () => string } };
    phantom?: { solana?: Window["solana"] };
  }
}

function IconMark() {
  return <span className="brand-mark" aria-hidden="true"><span /></span>;
}
function StatusBadge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "green" | "amber" }) {
  return <span className={`badge badge-${tone}`}><span className="badge-dot" />{children}</span>;
}
function EmptyState({ title, body }: { title: string; body: string }) {
  return <div className="empty-state"><div className="empty-icon">◇</div><strong>{title}</strong><p>{body}</p></div>;
}
function SectionHead({ eyebrow, title, body, right }: { eyebrow: string; title: string; body?: string; right?: React.ReactNode }) {
  return <div className="section-head"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2>{body && <p>{body}</p>}</div>{right}</div>;
}

export default function Portal() {
  const [tab, setTab] = useState<Tab>("overview");
  const [state, setState] = useState<DemoState>(initialState);
  const [ready, setReady] = useState(false);
  const [wallets, setWallets] = useState<Partial<Record<Chain, Wallet>>>({});
  const [busy, setBusy] = useState<Chain | null>(null);
  const [notice, setNotice] = useState("");
  const [holdingAddress, setHoldingAddress] = useState("");
  const [holdingShares, setHoldingShares] = useState("100");
  const [holdingEligible, setHoldingEligible] = useState(true);
  const [swapDirection, setSwapDirection] = useState<"u-to-usdc" | "usdc-to-u">("u-to-usdc");
  const [swapAmount, setSwapAmount] = useState("100");
  const [buyUsd, setBuyUsd] = useState("50");
  const [profileForm, setProfileForm] = useState({ name: "", email: "", country: "" });

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as DemoState;
        if (Array.isArray(parsed.holdings) && parsed.balances && Array.isArray(parsed.activity)) setState(parsed);
      }
    } catch { /* Corrupt browser demo data is ignored. */ }
    setReady(true);
  }, []);
  useEffect(() => { if (ready) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* Private browsing may block storage. */ } } }, [ready, state]);
  useEffect(() => {
    if (state.profile) setProfileForm({ name: state.profile.name, email: state.profile.email, country: state.profile.country });
  }, [state.profile?.name, state.profile?.email, state.profile?.country]);

  const allocations = useMemo(() => {
    try { return calculateAirdrop(state.holdings, state.pool) as Allocation[]; }
    catch { return []; }
  }, [state.holdings, state.pool]);
  const eligibleShares = allocations.reduce((sum, row) => sum + row.shares, 0);
  const connectedAddresses = [wallets.ethereum?.address, wallets.solana?.address].filter((x): x is string => Boolean(x));
  const ownClaim = connectedAddresses.map((address) => claimAllocation(state.snapshot, address) as Allocation | null).find(Boolean);
  const hasClaimed = Boolean(ownClaim && state.snapshot?.claims.includes(addressKey(ownClaim.address)));

  function saveProfile() {
    const name = profileForm.name.trim();
    const email = profileForm.email.trim();
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return setNotice("Enter a name and a valid email for the demo account.");
    const profile: Profile = { name, email, country: profileForm.country.trim(), kyc: state.profile?.kyc ?? "not_started" };
    setState((previous) => log({ ...previous, profile }, "Account saved", "Demo registration stored in this browser only."));
    setNotice("Demo account saved on this device.");
  }
  function approveDemoKyc() {
    if (!state.profile) return setNotice("Create a demo account first.");
    if (!profileForm.country.trim()) return setNotice("Enter a country or region for the demo KYC step.");
    setState((previous) => log({ ...previous, profile: { ...previous.profile!, country: profileForm.country.trim(), kyc: "approved_demo" } }, "Demo KYC approved", "Self-attested simulator; no identity verification occurred."));
    setNotice("Demo KYC marked approved. No identity verification occurred.");
  }
  async function connectEthereum() {
    if (!window.ethereum) return setNotice("No EVM wallet detected. Install a browser wallet that supports Sepolia.");
    setBusy("ethereum"); setNotice("");
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts?.[0]) throw new Error("Wallet did not return an address.");
      let chainId = await window.ethereum.request({ method: "eth_chainId" }) as string;
      if (chainId.toLowerCase() !== SEPOLIA_CHAIN_ID) {
        await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID }] });
        chainId = await window.ethereum.request({ method: "eth_chainId" }) as string;
      }
      if (chainId.toLowerCase() !== SEPOLIA_CHAIN_ID) throw new Error("Select Ethereum Sepolia in your wallet.");
      const raw = await window.ethereum.request({ method: "eth_getBalance", params: [accounts[0], "latest"] }) as string;
      const eth = Number(BigInt(raw)) / 1e18;
      setWallets((current) => ({ ...current, ethereum: { address: accounts[0], balance: `${format(eth, 5)} Sepolia ETH` } }));
      setNotice("Ethereum wallet connected on Sepolia.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not connect Ethereum wallet."); }
    finally { setBusy(null); }
  }
  async function connectSolana() {
    const provider = window.phantom?.solana || window.solana;
    if (!provider) return setNotice("No Solana wallet detected. Install Phantom or another injected Solana wallet.");
    setBusy("solana"); setNotice("");
    try {
      const result = await provider.connect();
      const address = result.publicKey?.toString() || provider.publicKey?.toString();
      if (!address) throw new Error("Wallet did not return an address.");
      const response = await fetch(SOLANA_RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "confirmed" }] }) });
      const payload = await response.json() as { result?: { value?: number }; error?: { message?: string } };
      if (!response.ok || payload.error || typeof payload.result?.value !== "number") throw new Error(payload.error?.message || "Devnet RPC balance check failed.");
      setWallets((current) => ({ ...current, solana: { address, balance: `${format(payload.result!.value! / 1e9, 5)} Devnet SOL` } }));
      setNotice("Solana address connected and checked against Devnet RPC. This does not change the wallet's own network setting.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not connect Solana wallet."); }
    finally { setBusy(null); }
  }
  function saveHolding() {
    const address = holdingAddress.trim();
    const shares = Number(holdingShares);
    if (!validAddress(address)) return setNotice("Enter a valid Ethereum or Solana wallet address.");
    if (!Number.isSafeInteger(shares) || shares < 0) return setNotice("Holdings must be a whole number of zero or more.");
    setState((previous) => {
      const holdings = [...previous.holdings.filter((row) => addressKey(row.address) !== addressKey(address)), { address, shares, eligible: holdingEligible }];
      return log({ ...previous, holdings }, "Holding updated", `${shortAddress(address)} · ${format(shares)} ${brand.sharesSymbol}`);
    });
    setHoldingAddress(""); setNotice("Simulated holding saved. Create a new snapshot to apply it to allocations.");
  }
  function createSnapshot() {
    if (allocations.length === 0) return setNotice("Add at least one eligible holding before creating a snapshot.");
    const snapshot: Snapshot = { id: uid("SNAP"), at: now(), pool: state.pool, allocations: structuredClone(allocations), claims: [] };
    setState((previous) => log({ ...previous, snapshot }, "Snapshot created", `${snapshot.id} · ${format(snapshot.pool)} ${brand.utilitySymbol}`));
    setNotice("New local demo snapshot created. Earlier claims were reset for this snapshot.");
  }
  function claim() {
    if (!state.profile || state.profile.kyc !== "approved_demo") return setNotice("Complete demo registration and KYC before claiming.");
    if (!ownClaim || !state.snapshot) return setNotice("No allocation for a connected wallet in this snapshot.");
    if (hasClaimed) return setNotice("This allocation was already claimed in the demo ledger.");
    setState((previous) => {
      if (!previous.snapshot) return previous;
      return log({ ...previous, snapshot: { ...previous.snapshot, claims: [...previous.snapshot.claims, addressKey(ownClaim.address)] }, balances: { ...previous.balances, uCURR: previous.balances.uCURR + ownClaim.amount } }, "Airdrop claimed", `${format(ownClaim.amount)} ${brand.utilitySymbol} credited to local demo balance.`);
    });
    setNotice("Claim recorded in this browser's demo ledger. No on-chain transfer occurred.");
  }
  function doSwap() {
    const amount = Number(swapAmount);
    if (!Number.isFinite(amount) || amount <= 0 || Math.round(amount * 100) !== amount * 100) return setNotice("Enter an amount greater than zero with at most two decimals.");
    const source = swapDirection === "u-to-usdc" ? "uCURR" : "USDC";
    const target = source === "uCURR" ? "USDC" : "uCURR";
    const received = source === "uCURR" ? amount / 10 : amount * 10;
    if (amount > state.balances[source]) return setNotice(`Insufficient demo ${source} balance.`);
    setState((previous) => log({ ...previous, balances: { ...previous.balances, [source]: Math.round((previous.balances[source] - amount) * 100) / 100, [target]: Math.round((previous.balances[target] + received) * 100) / 100 } }, "Demo swap", `${format(amount, 2)} ${source} → ${format(received, 2)} ${target}`));
    setNotice("Demo balances updated. No DEX or on-chain swap occurred.");
  }
  function doBuy() {
    const usd = Number(buyUsd);
    if (!Number.isFinite(usd) || usd < 1 || usd > 10000 || Math.round(usd * 100) !== usd * 100) return setNotice("Enter a sandbox amount from $1 to $10,000, up to two decimals.");
    const order: Order = { id: uid("SANDBOX"), usd, amount: usd * 10, at: now() };
    setState((previous) => log({ ...previous, orders: [order, ...previous.orders], balances: { ...previous.balances, uCURR: previous.balances.uCURR + order.amount } }, "Sandbox purchase", `${order.id} · ${format(order.amount)} demo ${brand.utilitySymbol}`));
    setNotice("Sandbox order recorded. No card details were requested and no charge was made.");
  }
  function resetDemo() {
    if (!window.confirm("Reset all local demo accounts, holdings, snapshots, claims and balances in this browser?")) return;
    setState(initialState()); setWallets({}); setNotice("Local demo data reset.");
  }

  const currentTitle = nav.find((item) => item.id === tab)?.label ?? "Overview";
  return <div className="app-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><IconMark /><div><strong>{brand.name}</strong><small>PORTAL / TESTNET</small></div></div>
      <div className="sidebar-divider" />
      <nav aria-label="Main navigation">{nav.map((item, index) => <div key={item.id}>{(index === 0 || nav[index - 1].group !== item.group) && <div className="nav-group">{item.group}</div>}<button className={`nav-item ${tab === item.id ? "active" : ""}`} onClick={() => { setTab(item.id); setNotice(""); }}><span className="nav-icon">{item.icon}</span>{item.label}{tab === item.id && <span className="nav-active-dot" />}</button></div>)}</nav>
      <div className="sidebar-bottom"><div className="testnet-card"><div className="testnet-lines"><span className="pulse-dot" /> TEST ENVIRONMENT</div><p>Explore safely with testnet wallets and local demo balances.</p><div className="testnet-foot">Sepolia <span>·</span> Solana Devnet</div></div><div className="sidebar-version">CURR HUB MVP <span>v0.1</span></div></div>
    </aside>
    <main className="main-content">
      <header className="topbar"><div className="breadcrumb">Workspace <span>/</span> <strong>{currentTitle}</strong></div><div className="topbar-actions"><span className="environment-pill"><span className="pulse-dot" /> Sandbox mode</span><button className="avatar-button" onClick={() => setTab("account")} aria-label="Open account">{state.profile?.name?.slice(0, 1).toUpperCase() || "G"}</button></div></header>
      <div className="page-body">
        {notice && <div className="notice" role="status"><span>ⓘ</span>{notice}<button onClick={() => setNotice("")} aria-label="Dismiss notice">×</button></div>}
        {tab === "overview" && <>
          <div className="welcome"><div><div className="eyebrow">YOUR WORKSPACE</div><h1>{state.profile ? `Welcome back, ${state.profile.name.split(" ")[0]}.` : "Your digital assets, in one place."}</h1><p>{brand.description}</p></div><div className="welcome-art" aria-hidden="true"><div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="art-core"><IconMark /></div><span className="art-star star-one">✦</span><span className="art-star star-two">✧</span></div></div>
          <div className="metrics"><div className="metric-card"><div className="metric-top"><span>Demo portfolio</span><span className="metric-symbol">◈</span></div><strong>{format(state.balances.uCURR)} <small>{brand.utilitySymbol}</small></strong><div className="metric-foot">Local demo ledger</div></div><div className="metric-card"><div className="metric-top"><span>Shareholder holdings</span><span className="metric-symbol">▤</span></div><strong>{format(state.holdings.reduce((sum, row) => sum + row.shares, 0))} <small>{brand.sharesSymbol}</small></strong><div className="metric-foot">Simulated across {state.holdings.length} addresses</div></div><div className="metric-card"><div className="metric-top"><span>Current snapshot</span><span className="metric-symbol">✳</span></div><strong className="metric-text">{state.snapshot ? state.snapshot.id : "Not created"}</strong><div className="metric-foot">{state.snapshot ? `${state.snapshot.allocations.length} eligible allocations` : "Awaiting admin simulation"}</div></div></div>
          <div className="two-column"><section className="panel"><div className="panel-heading"><div><div className="eyebrow">GET STARTED</div><h3>Quick actions</h3></div><span className="heading-mark">↗</span></div><div className="quick-grid"><button onClick={() => setTab("wallets")}><span className="quick-icon blue">◇</span><strong>Connect wallet</strong><small>Sepolia or Devnet</small><span className="quick-arrow">↗</span></button><button onClick={() => setTab("airdrop")}><span className="quick-icon purple">✳</span><strong>View airdrop</strong><small>Preview allocations</small><span className="quick-arrow">↗</span></button><button onClick={() => setTab("swap")}><span className="quick-icon peach">⇄</span><strong>Try swap</strong><small>Demo balances only</small><span className="quick-arrow">↗</span></button></div></section><section className="panel"><div className="panel-heading"><div><div className="eyebrow">ACTIVITY</div><h3>Recent events</h3></div><span className="heading-mark">◷</span></div>{state.activity.length ? <div className="activity-list">{state.activity.slice(0, 3).map((item) => <div className="activity-row" key={item.id}><span className="activity-icon">↗</span><div><strong>{item.title}</strong><small>{item.detail}</small></div><time>{new Date(item.at).toLocaleDateString()}</time></div>)}</div> : <EmptyState title="No activity yet" body="Your demo activity will appear here as you explore." />}</section></div>
          <div className="info-strip"><span>ⓘ</span><div><strong>Built for exploration</strong><p>Wallet connections read testnet balances. Token, airdrop, swap, and purchase actions are browser-local simulations.</p></div></div>
        </>}
        {tab === "wallets" && <><SectionHead eyebrow="NETWORK ACCESS" title="Connect your wallets" body="Read balances from Ethereum Sepolia and Solana Devnet. No transaction signing is required." /><div className="network-grid"><section className="panel network-card"><div className="network-icon eth">◆</div><StatusBadge tone="green">Ethereum Sepolia</StatusBadge><h3>Ethereum wallet</h3><p>Connect an injected EVM wallet and read its Sepolia ETH balance.</p>{wallets.ethereum ? <><div className="wallet-address"><small>CONNECTED ADDRESS</small><strong>{shortAddress(wallets.ethereum.address)}</strong><span>{wallets.ethereum.balance}</span></div><button className="secondary-button" onClick={() => setWallets((current) => ({ ...current, ethereum: undefined }))}>Disconnect in portal</button></> : <button className="primary-button" onClick={connectEthereum} disabled={Boolean(busy)}>{busy === "ethereum" ? "Connecting…" : "Connect Ethereum"}<span>↗</span></button>}</section><section className="panel network-card"><div className="network-icon sol">≋</div><StatusBadge tone="green">Solana Devnet</StatusBadge><h3>Solana wallet</h3><p>Connect an injected Solana wallet and read its balance from Devnet RPC.</p>{wallets.solana ? <><div className="wallet-address"><small>CONNECTED ADDRESS</small><strong>{shortAddress(wallets.solana.address)}</strong><span>{wallets.solana.balance}</span></div><button className="secondary-button" onClick={() => setWallets((current) => ({ ...current, solana: undefined }))}>Disconnect in portal</button></> : <button className="primary-button" onClick={connectSolana} disabled={Boolean(busy)}>{busy === "solana" ? "Connecting…" : "Connect Solana"}<span>↗</span></button>}</section></div><div className="info-strip"><span>ⓘ</span><div><strong>Testnet connection only</strong><p>uCURR and tCURR have no deployed contract or mint in this MVP. Shown token amounts live in this browser&apos;s demo ledger.</p></div></div></>}
        {tab === "airdrop" && <><SectionHead eyebrow="DISTRIBUTION SIMULATOR" title="Airdrop overview" body="Review a proportional distribution based on simulated tCURR holdings. The final method awaits management approval." right={<StatusBadge tone="amber">Policy pending</StatusBadge>} /><div className="metrics metrics-two"><div className="metric-card"><div className="metric-top"><span>Proposed demo pool</span><span className="metric-symbol">✳</span></div><strong>{format(state.pool)} <small>{brand.utilitySymbol}</small></strong><div className="metric-foot">Set in admin simulator</div></div><div className="metric-card"><div className="metric-top"><span>Eligible demo holdings</span><span className="metric-symbol">▤</span></div><strong>{format(eligibleShares)} <small>{brand.sharesSymbol}</small></strong><div className="metric-foot">{allocations.length} eligible addresses</div></div></div><div className="two-column"><section className="panel"><div className="panel-heading"><div><div className="eyebrow">CURRENT SNAPSHOT</div><h3>{state.snapshot?.id || "No snapshot yet"}</h3></div><span className="heading-mark">✳</span></div>{state.snapshot ? <><div className="detail-row"><span>Created</span><strong>{new Date(state.snapshot.at).toLocaleString()}</strong></div><div className="detail-row"><span>Pool</span><strong>{format(state.snapshot.pool)} {brand.utilitySymbol}</strong></div><div className="detail-row"><span>Claims</span><strong>{state.snapshot.claims.length} / {state.snapshot.allocations.length}</strong></div><div className="detail-row"><span>Your allocation</span><strong>{ownClaim ? `${format(ownClaim.amount)} ${brand.utilitySymbol}` : "No matching connected address"}</strong></div><button className="primary-button full" onClick={claim} disabled={!ownClaim || hasClaimed}>{hasClaimed ? "Claimed in demo" : "Claim demo allocation"}<span>↗</span></button><p className="fine-print">Claim updates the browser-local demo ledger only.</p></> : <EmptyState title="Awaiting snapshot" body="Open Admin simulator to record a snapshot of eligible holdings." />}</section><section className="panel"><div className="panel-heading"><div><div className="eyebrow">HOW IT WORKS</div><h3>Proportional preview</h3></div><span className="heading-mark">◎</span></div><div className="steps"><div><span>01</span><p>Admin enters simulated tCURR holdings and eligibility.</p></div><div><span>02</span><p>The pool is divided by each eligible address&apos;s share of total eligible holdings.</p></div><div><span>03</span><p>A snapshot freezes allocations for local demo claims.</p></div></div><div className="formula">Allocation = pool × eligible shares / total eligible shares</div></section></div><section className="panel table-panel"><div className="panel-heading"><div><div className="eyebrow">LIVE PREVIEW</div><h3>Calculated allocations</h3></div><span className="subtle">Before snapshot</span></div><div className="table-wrap"><table><thead><tr><th>Address</th><th>tCURR</th><th>Share</th><th>uCURR preview</th></tr></thead><tbody>{allocations.map((row) => <tr key={row.address}><td className="mono">{shortAddress(row.address)}</td><td>{format(row.shares)}</td><td>{eligibleShares ? format(row.shares / eligibleShares * 100, 1) : 0}%</td><td><strong>{format(row.amount)}</strong></td></tr>)}</tbody></table></div>{!allocations.length && <EmptyState title="No eligible holdings" body="Add eligible holdings in the admin simulator." />}</section></>}
        {tab === "swap" && <><SectionHead eyebrow="TOKEN EXCHANGE" title="Swap demo" body="Explore a fixed-rate swap in the local demo ledger. No liquidity pool or blockchain transaction is involved." right={<StatusBadge>Simulation</StatusBadge>} /><div className="transaction-layout"><section className="panel transaction-card"><div className="transaction-top"><strong>Swap tokens</strong><span>Fixed demo rate</span></div><label className="swap-box"><span>You pay</span><div><input type="number" min="0" step="0.01" value={swapAmount} onChange={(event) => setSwapAmount(event.target.value)} aria-label="Swap amount" /><strong>{swapDirection === "u-to-usdc" ? "uCURR" : "Demo USDC"}</strong></div><small>Available: {format(state.balances[swapDirection === "u-to-usdc" ? "uCURR" : "USDC"], 2)}</small></label><button className="flip-button" onClick={() => setSwapDirection(swapDirection === "u-to-usdc" ? "usdc-to-u" : "u-to-usdc")} aria-label="Reverse swap direction">↓↑</button><div className="swap-box receive"><span>You receive (estimated)</span><div><strong className="receive-amount">{format((Number(swapAmount) || 0) * (swapDirection === "u-to-usdc" ? 0.1 : 10), 2)}</strong><strong>{swapDirection === "u-to-usdc" ? "Demo USDC" : "uCURR"}</strong></div><small>1 uCURR = 0.10 demo USDC</small></div><button className="primary-button full" onClick={doSwap}>Confirm demo swap <span>↗</span></button></section><div className="aside-stack"><div className="panel muted-panel"><div className="eyebrow">YOUR DEMO BALANCES</div><div className="balance-line"><span>uCURR</span><strong>{format(state.balances.uCURR, 2)}</strong></div><div className="balance-line"><span>Demo USDC</span><strong>{format(state.balances.USDC, 2)}</strong></div></div><div className="info-strip compact"><span>ⓘ</span><div><strong>Local simulation</strong><p>Rates and balances are illustrative. tCURR tokenized shares are excluded from swaps.</p></div></div></div></div></>}
        {tab === "buy" && <><SectionHead eyebrow="PAYMENT SANDBOX" title="Buy uCURR" body="Try a purchase flow with a simulated order. No payment provider or card network is connected." right={<StatusBadge tone="amber">No real charges</StatusBadge>} /><div className="transaction-layout"><section className="panel transaction-card"><div className="transaction-top"><strong>Sandbox purchase</strong><span>USD → uCURR</span></div><label className="field-label">Amount in USD<input type="number" min="1" max="10000" step="0.01" value={buyUsd} onChange={(event) => setBuyUsd(event.target.value)} /></label><div className="quote-card"><div><span>Demo rate</span><strong>$1 = 10 uCURR</strong></div><div><span>You receive</span><strong>{format((Number(buyUsd) || 0) * 10, 2)} uCURR</strong></div><div><span>Charge today</span><strong>$0.00</strong></div></div><button className="primary-button full" onClick={doBuy}>Create sandbox order <span>↗</span></button><p className="fine-print">Never enter card details. This flow cannot take payment.</p></section><section className="panel"><div className="panel-heading"><div><div className="eyebrow">ORDER HISTORY</div><h3>Sandbox orders</h3></div><span className="heading-mark">▣</span></div>{state.orders.length ? <div className="activity-list">{state.orders.map((order) => <div className="activity-row" key={order.id}><span className="activity-icon">↗</span><div><strong>{order.id}</strong><small>${format(order.usd, 2)} simulated → {format(order.amount)} uCURR</small></div><time>{new Date(order.at).toLocaleDateString()}</time></div>)}</div> : <EmptyState title="No orders yet" body="Create a sandbox order to see it here." />}</section></div></>}
        {tab === "account" && <><SectionHead eyebrow="YOUR PROFILE" title="Account & demo KYC" body="Create a local profile and explore a sample verification step. No identity documents are collected." /><div className="two-column"><section className="panel form-panel"><div className="panel-heading"><div><div className="eyebrow">REGISTRATION</div><h3>Demo account</h3></div><StatusBadge tone={state.profile ? "green" : "neutral"}>{state.profile ? "Saved" : "Not registered"}</StatusBadge></div><label className="field-label">Display name<input value={profileForm.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} placeholder="Your name" maxLength={60} /></label><label className="field-label">Email address<input type="email" value={profileForm.email} onChange={(event) => setProfileForm({ ...profileForm, email: event.target.value })} placeholder="name@example.com" maxLength={120} /></label><button className="primary-button" onClick={saveProfile}>Save demo account <span>↗</span></button><p className="fine-print">Saved in this browser only. Use a test email address; there is no account server.</p></section><section className="panel form-panel"><div className="panel-heading"><div><div className="eyebrow">IDENTITY STEP</div><h3>KYC simulation</h3></div><StatusBadge tone={state.profile?.kyc === "approved_demo" ? "green" : "amber"}>{state.profile?.kyc === "approved_demo" ? "Demo approved" : "Not started"}</StatusBadge></div><p className="form-intro">This self-attestation models a review result only. It does not verify identity or establish eligibility for real tokenized shares.</p><label className="field-label">Country or region<input value={profileForm.country} onChange={(event) => setProfileForm({ ...profileForm, country: event.target.value })} placeholder="e.g. Hong Kong" maxLength={60} /></label><button className="secondary-button" onClick={approveDemoKyc} disabled={!state.profile}>Mark demo KYC approved</button><p className="fine-print">Do not upload IDs or sensitive documents. No real KYC provider is connected.</p></section></div><div className="danger-zone"><div><strong>Reset local demo data</strong><p>Clear this browser&apos;s profile, holdings, snapshots, claims, swaps and orders.</p></div><button className="secondary-button" onClick={resetDemo}>Reset demo</button></div></>}
        {tab === "admin" && <><SectionHead eyebrow="OPERATIONS SIMULATOR" title="Admin dashboard" body="Model shareholder holdings and freeze a demo snapshot. This screen has no production access control." right={<StatusBadge tone="amber">Demo admin</StatusBadge>} /><div className="admin-warning"><span>!</span><p>Anyone with this demo can change local data. Do not use this route for production administration or real distributions.</p></div><div className="two-column"><section className="panel form-panel"><div className="panel-heading"><div><div className="eyebrow">HOLDING ENTRY</div><h3>Add or update tCURR</h3></div><span className="heading-mark">▤</span></div><label className="field-label">Wallet address<input value={holdingAddress} onChange={(event) => setHoldingAddress(event.target.value)} placeholder="0x… or Solana address" /></label><div className="form-row"><label className="field-label">tCURR units<input type="number" min="0" step="1" value={holdingShares} onChange={(event) => setHoldingShares(event.target.value)} /></label><label className="field-label">Eligible<select value={holdingEligible ? "yes" : "no"} onChange={(event) => setHoldingEligible(event.target.value === "yes")}><option value="yes">Yes</option><option value="no">No</option></select></label></div><div className="button-row"><button className="primary-button" onClick={saveHolding}>Save holding <span>↗</span></button><button className="secondary-button" onClick={() => setHoldingAddress(wallets.ethereum?.address || wallets.solana?.address || "")} disabled={!connectedAddresses.length}>Use connected wallet</button></div></section><section className="panel form-panel"><div className="panel-heading"><div><div className="eyebrow">DISTRIBUTION</div><h3>Snapshot settings</h3></div><span className="heading-mark">✳</span></div><label className="field-label">Demo uCURR pool<input type="number" min="0" step="1" value={state.pool} onChange={(event) => { const value = Number(event.target.value); if (Number.isSafeInteger(value) && value >= 0 && value <= 100000000) setState((previous) => ({ ...previous, pool: value })); }} /></label><div className="snapshot-preview"><div><span>Eligible addresses</span><strong>{allocations.length}</strong></div><div><span>Eligible holdings</span><strong>{format(eligibleShares)} tCURR</strong></div><div><span>Pool to distribute</span><strong>{format(state.pool)} uCURR</strong></div></div><button className="primary-button full" onClick={createSnapshot}>Create demo snapshot <span>↗</span></button><p className="fine-print">New snapshots replace the current local snapshot and reset its claim records.</p></section></div><section className="panel table-panel"><div className="panel-heading"><div><div className="eyebrow">SIMULATED CAP TABLE</div><h3>Shareholder holdings</h3></div><span className="subtle">{state.holdings.length} addresses</span></div><div className="table-wrap"><table><thead><tr><th>Wallet address</th><th>Chain format</th><th>tCURR</th><th>Eligibility</th><th></th></tr></thead><tbody>{state.holdings.map((holding) => <tr key={holding.address}><td className="mono" title={holding.address}>{shortAddress(holding.address)}</td><td>{holding.address.startsWith("0x") ? "Ethereum" : "Solana"}</td><td>{format(holding.shares)}</td><td><StatusBadge tone={holding.eligible ? "green" : "amber"}>{holding.eligible ? "Eligible" : "Excluded"}</StatusBadge></td><td><button className="table-action" onClick={() => { setHoldingAddress(holding.address); setHoldingShares(String(holding.shares)); setHoldingEligible(holding.eligible); }}>Edit</button></td></tr>)}</tbody></table></div></section></>}
      </div>
    </main>
  </div>;
}
