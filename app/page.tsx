"use client";

import { useEffect, useMemo, useState } from "react";
import { brand } from "@/lib/brand";
import { readTCurrBalance, suggestTokenInWallet, validEthereumAddress, type TCurrBalance } from "@/lib/tcurr";
import WalletPicker, { type WalletChoice } from "@/components/WalletPicker";

type Tab = "balance" | "swap" | "buy" | "airdrop";
type Chain = "ethereum" | "solana";
type Wallet = { address: string; balance: string; name: string };
type EvmProvider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
  isMetaMask?: boolean;
  isPhantom?: boolean;
};
type SolanaProvider = {
  connect: () => Promise<{ publicKey: { toString: () => string } }>;
  publicKey?: { toString: () => string };
  isPhantom?: boolean;
};
type EvmWallet = { id: string; name: string; icon?: string; rdns?: string; provider: EvmProvider };
type SolanaWallet = { id: string; name: string; provider: SolanaProvider };

declare global {
  interface Window {
    ethereum?: EvmProvider;
    solana?: SolanaProvider;
    solflare?: SolanaProvider;
    phantom?: { solana?: SolanaProvider };
  }
}

const TOKEN_ADDRESS_KEY = "currhub-tcurr-sepolia-contract";
const SEPOLIA_CHAIN_ID = "0xaa36a7";
const SOLANA_RPC = process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC || "https://api.devnet.solana.com";
const tabs: { id: Tab; label: string }[] = [
  { id: "balance", label: "Wallet balance" },
  { id: "swap", label: "Swap" },
  { id: "buy", label: "Buy" },
  { id: "airdrop", label: "Airdrop" },
];

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}
function displayAmount(value: number, digits = 5) {
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}
function BrandMark() {
  return <span className="brand-mark" aria-hidden="true">C</span>;
}
function ArrowIcon() {
  return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function Portal() {
  const [tab, setTab] = useState<Tab>("balance");
  const [wallets, setWallets] = useState<Partial<Record<Chain, Wallet>>>({});
  const [evmOptions, setEvmOptions] = useState<EvmWallet[]>([]);
  const [solanaOptions, setSolanaOptions] = useState<SolanaWallet[]>([]);
  const [selectedEvm, setSelectedEvm] = useState<EvmWallet | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [kycAction, setKycAction] = useState<"swap" | "buy" | "airdrop" | null>(null);
  const [tcurrAddress, setTcurrAddress] = useState(process.env.NEXT_PUBLIC_TCURR_SEPOLIA_ADDRESS || "");
  const [tcurrDraft, setTcurrDraft] = useState(process.env.NEXT_PUBLIC_TCURR_SEPOLIA_ADDRESS || "");
  const [tcurrBalance, setTcurrBalance] = useState<TCurrBalance | null>(null);
  const [tcurrLoading, setTcurrLoading] = useState(false);
  const [tcurrError, setTcurrError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [swapAmount, setSwapAmount] = useState("100");
  const [buyAmount, setBuyAmount] = useState("50");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(TOKEN_ADDRESS_KEY);
      if (saved && validEthereumAddress(saved)) { setTcurrAddress(saved); setTcurrDraft(saved); }
    } catch { /* Optional browser storage may be unavailable. */ }
  }, []);

  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<{ info?: { uuid?: string; name?: string; icon?: string; rdns?: string }; provider?: EvmProvider }>).detail;
      if (!detail || typeof detail.info?.uuid !== "string" || typeof detail.info.name !== "string" || typeof detail.provider?.request !== "function") return;
      const wallet: EvmWallet = {
        id: `eip6963:${detail.info.uuid.slice(0, 100)}`,
        name: detail.info.name.trim().slice(0, 50) || "Ethereum wallet",
        icon: detail.info.icon?.startsWith("data:image/") ? detail.info.icon : undefined,
        rdns: detail.info.rdns,
        provider: detail.provider,
      };
      setEvmOptions((current) => current.some((item) => item.id === wallet.id || item.provider === wallet.provider)
        ? current.filter((item) => item.provider !== wallet.provider || item.id !== "legacy-ethereum")
        : [...current.filter((item) => item.provider !== wallet.provider || item.id !== "legacy-ethereum"), wallet]);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    refreshWalletOptions();
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  useEffect(() => {
    const provider = selectedEvm?.provider;
    if (!provider?.on) return;
    const onChange = () => {
      setWallets((current) => ({ ...current, ethereum: undefined }));
      setSelectedEvm(null);
      setTcurrBalance(null);
      setNotice("Wallet changed. Connect again to see the right balance.");
    };
    provider.on("accountsChanged", onChange);
    provider.on("chainChanged", onChange);
    return () => {
      provider.removeListener?.("accountsChanged", onChange);
      provider.removeListener?.("chainChanged", onChange);
    };
  }, [selectedEvm]);

  useEffect(() => {
    if (!selectedEvm || !wallets.ethereum || !tcurrAddress) {
      setTcurrBalance(null);
      setTcurrError("");
      setTcurrLoading(false);
      return;
    }
    let active = true;
    setTcurrBalance(null);
    setTcurrLoading(true);
    setTcurrError("");
    readTCurrBalance(selectedEvm.provider, tcurrAddress, wallets.ethereum.address)
      .then((balance) => { if (active) setTcurrBalance(balance); })
      .catch((error) => { if (active) setTcurrError(error instanceof Error ? error.message : "Could not read tCURR."); })
      .finally(() => { if (active) setTcurrLoading(false); });
    return () => { active = false; };
  }, [selectedEvm, wallets.ethereum?.address, tcurrAddress]);

  function refreshWalletOptions() {
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    const fallback = window.ethereum;
    if (fallback?.request) setEvmOptions((current) => current.some((item) => item.provider === fallback) ? current : [...current, {
      id: "legacy-ethereum", name: fallback.isMetaMask && !fallback.isPhantom ? "MetaMask" : fallback.isPhantom ? "Phantom" : "Browser wallet", provider: fallback,
    }]);
    const candidates: [string, string, SolanaProvider | undefined][] = [
      ["phantom-solana", "Phantom", window.phantom?.solana || (window.solana?.isPhantom ? window.solana : undefined)],
      ["solflare", "Solflare", window.solflare],
      ["browser-solana", "Solana wallet", window.solana],
    ];
    const found: SolanaWallet[] = [];
    for (const [id, name, provider] of candidates) {
      if (provider?.connect && !found.some((item) => item.provider === provider)) found.push({ id, name, provider });
    }
    setSolanaOptions(found);
  }

  async function connectEthereum(wallet: EvmWallet) {
    setPickerOpen(false);
    setBusy(true);
    setNotice("");
    try {
      const accounts = await wallet.provider.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts?.[0]) throw new Error("The wallet did not share an address.");
      let chainId = await wallet.provider.request({ method: "eth_chainId" }) as string;
      if (chainId?.toLowerCase() !== SEPOLIA_CHAIN_ID) {
        await wallet.provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID }] });
        chainId = await wallet.provider.request({ method: "eth_chainId" }) as string;
      }
      if (chainId?.toLowerCase() !== SEPOLIA_CHAIN_ID) throw new Error("Select Sepolia in your wallet and try again.");
      const raw = await wallet.provider.request({ method: "eth_getBalance", params: [accounts[0], "latest"] }) as string;
      setSelectedEvm(wallet);
      setWallets((current) => ({ ...current, ethereum: { address: accounts[0], balance: `${displayAmount(Number(BigInt(raw)) / 1e18)} ETH`, name: wallet.name } }));
      setTab("balance");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not connect wallet."); }
    finally { setBusy(false); }
  }

  async function connectSolana(wallet: SolanaWallet) {
    setPickerOpen(false);
    setBusy(true);
    setNotice("");
    try {
      const result = await wallet.provider.connect();
      const address = result.publicKey?.toString() || wallet.provider.publicKey?.toString();
      if (!address) throw new Error("The wallet did not share an address.");
      let balance = "Balance unavailable";
      try {
        const response = await fetch(SOLANA_RPC, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getBalance", params: [address, { commitment: "confirmed" }] }) });
        const payload = await response.json() as { result?: { value?: number } };
        if (response.ok && typeof payload.result?.value === "number") balance = `${displayAmount(payload.result.value / 1e9)} SOL`;
      } catch { /* Connected wallet remains visible if the public RPC is unavailable. */ }
      setWallets((current) => ({ ...current, solana: { address, balance, name: wallet.name } }));
      setTab("balance");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not connect wallet."); }
    finally { setBusy(false); }
  }

  async function refreshBalance() {
    if (!selectedEvm || !wallets.ethereum) return;
    setTcurrLoading(true);
    setTcurrError("");
    try {
      const raw = await selectedEvm.provider.request({ method: "eth_getBalance", params: [wallets.ethereum.address, "latest"] }) as string;
      setWallets((current) => ({ ...current, ethereum: current.ethereum && { ...current.ethereum, balance: `${displayAmount(Number(BigInt(raw)) / 1e18)} ETH` } }));
      if (tcurrAddress) setTcurrBalance(await readTCurrBalance(selectedEvm.provider, tcurrAddress, wallets.ethereum.address));
    } catch (error) { setTcurrError(error instanceof Error ? error.message : "Could not refresh balance."); }
    finally { setTcurrLoading(false); }
  }

  function saveTcurrAddress() {
    const address = tcurrDraft.trim();
    if (!validEthereumAddress(address)) { setNotice("Enter a valid tCURR contract address."); return; }
    setTcurrAddress(address);
    try { localStorage.setItem(TOKEN_ADDRESS_KEY, address); } catch { /* Optional browser storage may be unavailable. */ }
    setNotice("tCURR contract saved for this browser.");
  }

  async function addTokenToWallet() {
    if (!selectedEvm || !tcurrBalance) return;
    try {
      await suggestTokenInWallet(selectedEvm.provider, tcurrBalance);
      setNotice("Check your wallet to confirm the token import.");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not add token to wallet."); }
  }

  function requestAction(action: "swap" | "buy" | "airdrop") {
    if (!wallets.ethereum && !wallets.solana) { setPickerOpen(true); return; }
    setKycAction(action);
  }

  const walletChoices = useMemo<WalletChoice[]>(() => {
    const metamask = evmOptions.find((wallet) => wallet.rdns === "io.metamask" || /metamask/i.test(wallet.name) && !wallet.provider.isPhantom);
    const phantom = solanaOptions.find((wallet) => wallet.id === "phantom-solana");
    const primary: WalletChoice[] = [
      { id: "metamask", name: "MetaMask", network: "Ethereum Sepolia", kind: "metamask", icon: metamask?.icon, onSelect: metamask ? () => connectEthereum(metamask) : undefined, installUrl: "https://metamask.io/download/" },
      { id: "phantom", name: "Phantom", network: "Solana Devnet", kind: "phantom", onSelect: phantom ? () => connectSolana(phantom) : undefined, installUrl: "https://phantom.com/download" },
    ];
    const otherEvm: WalletChoice[] = evmOptions.filter((wallet) => wallet !== metamask).map((wallet) => ({ id: wallet.id, name: wallet.name, network: "Ethereum Sepolia", kind: "other", icon: wallet.icon, onSelect: () => connectEthereum(wallet) }));
    const otherSolana: WalletChoice[] = solanaOptions.filter((wallet) => wallet !== phantom).map((wallet) => ({ id: wallet.id, name: wallet.name, network: "Solana Devnet", kind: "other", onSelect: () => connectSolana(wallet) }));
    return [...primary, ...otherEvm, ...otherSolana];
  }, [evmOptions, solanaOptions]);

  const connected = Boolean(wallets.ethereum || wallets.solana);
  const balanceLabel = !wallets.ethereum ? "Connect an Ethereum wallet" : !tcurrAddress ? "Token setup pending" : tcurrLoading ? "Reading balance…" : tcurrError ? "Unavailable" : tcurrBalance ? tcurrBalance.display : "—";

  return <div className="app-shell">
    <header className="site-header"><div className="header-inner">
      <button className="brand-button" onClick={() => setTab("balance")} aria-label="CURR Hub, wallet balance"><BrandMark /><span>{brand.name}</span></button>
      <nav className="top-nav" aria-label="Main navigation">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "tab active" : "tab"} onClick={() => { setTab(item.id); setNotice(""); }}>{item.label}</button>)}</nav>
      <button className="header-wallet-button" onClick={() => { refreshWalletOptions(); setPickerOpen(true); }} disabled={busy}>{busy ? "Connecting…" : connected ? shortAddress(wallets.ethereum?.address || wallets.solana!.address) : "Connect wallet"}</button>
    </div></header>
    <main className="main-container">
      <div className="page-top"><div><span className="network-label"><span className="status-dot" />TEST NETWORKS</span><h1>{tab === "balance" ? "Your wallet, made simple." : tab === "swap" ? "Swap tokens" : tab === "buy" ? "Buy uCURR" : "Airdrop"}</h1><p>{tab === "balance" ? "Connect a wallet to see your real testnet balances." : tab === "swap" ? "Preview a swap before this feature goes live." : tab === "buy" ? "Explore the purchase flow. No payment will be taken." : "Your tCURR balance is visible now. Airdrop claims will open after the rules are approved."}</p></div>{tab === "balance" && connected && <button className="outline-button" onClick={refreshBalance} disabled={!wallets.ethereum || tcurrLoading}>Refresh balances</button>}</div>
      {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}

      {tab === "balance" && <>
        {!connected && <section className="connect-hero"><div className="hero-symbol" aria-hidden="true"><BrandMark /></div><div><h2>See what&apos;s in your wallet</h2><p>Your balances appear here after you connect. You don&apos;t need to type an address.</p><button className="primary-button" onClick={() => { refreshWalletOptions(); setPickerOpen(true); }}>Connect wallet <ArrowIcon /></button></div></section>}
        <div className="balance-grid">
          <section className="balance-card featured"><div className="card-kicker"><span className="token-emblem">t</span> tCURR <span className="card-network">ETHEREUM SEPOLIA</span></div><div className={tcurrBalance ? "large-balance" : "large-balance empty-balance"}>{balanceLabel}</div><div className="balance-caption">{tcurrBalance ? "Your live token balance" : tcurrError || (!tcurrAddress && wallets.ethereum ? "A tCURR contract needs to be set up first." : "Tokenized shares · test token")}</div>{tcurrBalance && <button className="light-button" onClick={addTokenToWallet}>Show in wallet <span>↗</span></button>}</section>
          <div className="side-balances"><section className="balance-card"><div className="card-kicker"><span className="coin-symbol eth-symbol">◆</span> Sepolia ETH</div><div className="medium-balance">{wallets.ethereum ? wallets.ethereum.balance : "—"}</div><div className="balance-caption">{wallets.ethereum ? shortAddress(wallets.ethereum.address) : "Connect MetaMask or another Ethereum wallet"}</div></section><section className="balance-card"><div className="card-kicker"><span className="coin-symbol sol-symbol">≋</span> Devnet SOL</div><div className="medium-balance">{wallets.solana ? wallets.solana.balance : "—"}</div><div className="balance-caption">{wallets.solana ? shortAddress(wallets.solana.address) : "Connect Phantom or another Solana wallet"}</div></section></div>
        </div>
        {connected && <section className="connected-panel"><div><span className="panel-label">CONNECTED WALLETS</span>{wallets.ethereum && <p><strong>{wallets.ethereum.name}</strong><span>{shortAddress(wallets.ethereum.address)} · Sepolia</span></p>}{wallets.solana && <p><strong>{wallets.solana.name}</strong><span>{shortAddress(wallets.solana.address)} · Devnet balance</span></p>}</div><div className="connected-actions"><button className="text-button" onClick={() => { refreshWalletOptions(); setPickerOpen(true); }}>Connect another</button><button className="text-button" onClick={() => { setWallets({}); setSelectedEvm(null); setTcurrBalance(null); }}>Disconnect</button></div></section>}
        <details className="token-settings"><summary>Set up tCURR test token <span aria-hidden="true">⌄</span></summary><div><p>After the tCURR contract is deployed on Sepolia, enter its contract address here. This is different from your wallet address.</p><div className="setting-row"><input value={tcurrDraft} onChange={(event) => setTcurrDraft(event.target.value)} placeholder="tCURR contract address (0x…)" aria-label="tCURR contract address" spellCheck={false} autoComplete="off" /><button className="outline-button" onClick={saveTcurrAddress}>Save</button></div>{tcurrAddress && <p className="contract-current">Using {shortAddress(tcurrAddress)}</p>}</div></details>
      </>}

      {tab === "swap" && <div className="feature-layout"><section className="feature-card"><div className="feature-card-title"><h2>Swap preview</h2><span className="preview-pill">PREVIEW ONLY</span></div><label className="amount-box"><span>You pay</span><div><input type="number" min="0" step="0.01" value={swapAmount} onChange={(event) => setSwapAmount(event.target.value)} aria-label="Amount of uCURR to swap" /><strong>uCURR</strong></div></label><div className="swap-arrow" aria-hidden="true">↓</div><div className="amount-box result-box"><span>You receive (estimated)</span><div><b>{displayAmount(Math.max(0, Number(swapAmount) || 0) / 10, 2)}</b><strong>USDC</strong></div></div><button className="primary-button full-button" onClick={() => requestAction("swap")}>{connected ? "Continue to swap" : "Connect wallet"}<ArrowIcon /></button><p className="transaction-note">Illustrative rate only. No swap or token transfer is available yet.</p></section><aside className="feature-aside"><div className="aside-icon">⇄</div><h3>Before you swap</h3><p>Identity verification will be required when swaps become available. Your tCURR shares are not used in this swap.</p></aside></div>}

      {tab === "buy" && <div className="feature-layout"><section className="feature-card"><div className="feature-card-title"><h2>Purchase preview</h2><span className="preview-pill">SANDBOX</span></div><label className="amount-box"><span>You pay</span><div><input type="number" min="0" step="0.01" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} aria-label="Purchase amount in US dollars" /><strong>USD</strong></div></label><div className="quote-line"><span>Illustrative uCURR amount</span><strong>{displayAmount(Math.max(0, Number(buyAmount) || 0) * 10, 2)} uCURR</strong></div><div className="quote-line"><span>Charged today</span><strong>$0.00</strong></div><button className="primary-button full-button" onClick={() => requestAction("buy")}>{connected ? "Continue to buy" : "Connect wallet"}<ArrowIcon /></button><p className="transaction-note">No card details are collected. No charge or token delivery occurs.</p></section><aside className="feature-aside"><div className="aside-icon">◈</div><h3>A safe first look</h3><p>Buying will require identity verification and a payment provider. For now, this page only shows an example quote.</p></aside></div>}

      {tab === "airdrop" && <div className="feature-layout"><section className="feature-card airdrop-card"><span className="preview-pill">NOT OPEN YET</span><h2>Your tCURR matters here</h2><p>When the airdrop rules are approved, this page will show eligibility for your connected wallet.</p><div className="airdrop-holding"><span>Your tCURR on Sepolia</span><strong>{tcurrBalance ? `${tcurrBalance.display} tCURR` : wallets.ethereum ? tcurrLoading ? "Reading…" : tcurrError ? "Unavailable" : "—" : "Connect wallet"}</strong></div><button className="primary-button full-button" onClick={() => requestAction("airdrop")}>{connected ? "Check airdrop status" : "Connect wallet"}<ArrowIcon /></button><p className="transaction-note">No allocation or claim is available yet.</p></section><aside className="feature-aside"><div className="aside-icon">✦</div><h3>What happens next?</h3><p>Eligibility rules, the snapshot, and the claim process are awaiting approval. Identity verification will be required to claim.</p></aside></div>}
    </main>
    <WalletPicker open={pickerOpen} choices={walletChoices} onClose={() => setPickerOpen(false)} onRefresh={refreshWalletOptions} />
    {kycAction && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setKycAction(null); }}><div className="status-modal" role="dialog" aria-modal="true" aria-labelledby="kyc-modal-title"><button className="icon-button modal-close" onClick={() => setKycAction(null)} aria-label="Close">×</button><span className="status-modal-icon">◎</span><h2 id="kyc-modal-title">Identity check required</h2><p>{kycAction === "airdrop" ? "Airdrop claims" : kycAction === "buy" ? "Purchases" : "Swaps"} will require identity verification. Verification is not available in this test version, so no action was submitted.</p><button className="primary-button full-button" onClick={() => setKycAction(null)}>Got it</button></div></div>}
  </div>;
}
