"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { brand } from "@/lib/brand";
import { readTCurrBalance, readTokenBalance, readTokenOwner, suggestTokenInWallet, TCURR_SEPOLIA_ADDRESS, UCURR_SEPOLIA_ADDRESS, type TokenBalance, type TCurrBalance } from "@/lib/tcurr";
import WalletPicker, { type WalletChoice } from "@/components/WalletPicker";
import SwapPanel from "@/components/SwapPanel";

type Tab = "balance" | "swap" | "buy" | "airdrop";
type Chain = "ethereum" | "solana";
type Wallet = { address: string; balance: string; name: string };
type EvmProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
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
function walletImportError(error: unknown): string {
  if (error && typeof error === "object") {
    const details = error as { code?: unknown; message?: unknown };
    if (details.code === 4001) return "Token import was cancelled in your wallet.";
    if (typeof details.message === "string" && details.message.trim()) return details.message;
  }
  return "Could not add token to wallet. Try importing its contract address in MetaMask.";
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
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const walletMenuRef = useRef<HTMLDivElement>(null);
  const [kycAction, setKycAction] = useState<"airdrop" | null>(null);
  const [tokenOwnerWallet, setTokenOwnerWallet] = useState("");
  const tcurrAddress = TCURR_SEPOLIA_ADDRESS;
  const [tcurrBalance, setTcurrBalance] = useState<TCurrBalance | null>(null);
  const [tcurrLoading, setTcurrLoading] = useState(false);
  const [tcurrError, setTcurrError] = useState("");
  const ucurrAddress = UCURR_SEPOLIA_ADDRESS;
  const [ucurrBalance, setUcurrBalance] = useState<TokenBalance | null>(null);
  const [ucurrLoading, setUcurrLoading] = useState(false);
  const [ucurrError, setUcurrError] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [buyAmount, setBuyAmount] = useState("50");

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
      setUcurrBalance(null);
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
    if (!walletMenuOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !walletMenuRef.current?.contains(event.target)) setWalletMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWalletMenuOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [walletMenuOpen]);

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

  useEffect(() => {
    if (!selectedEvm || !wallets.ethereum || !ucurrAddress) {
      setUcurrBalance(null);
      setUcurrError("");
      setUcurrLoading(false);
      return;
    }
    let active = true;
    setUcurrBalance(null);
    setUcurrLoading(true);
    setUcurrError("");
    readTokenBalance(selectedEvm.provider, ucurrAddress, wallets.ethereum.address, "uCURR")
      .then((balance) => { if (active) setUcurrBalance(balance); })
      .catch((error) => { if (active) setUcurrError(error instanceof Error ? error.message : "Could not read uCURR."); })
      .finally(() => { if (active) setUcurrLoading(false); });
    return () => { active = false; };
  }, [selectedEvm, wallets.ethereum?.address, ucurrAddress]);

  useEffect(() => {
    if (!selectedEvm || !wallets.ethereum) { setTokenOwnerWallet(""); return; }
    let active = true;
    const address = wallets.ethereum.address.toLowerCase();
    setTokenOwnerWallet("");
    Promise.all([
      readTokenOwner(selectedEvm.provider, tcurrAddress),
      readTokenOwner(selectedEvm.provider, ucurrAddress),
    ]).then((owners) => {
      if (active) setTokenOwnerWallet(owners.some((owner) => owner.toLowerCase() === address) ? address : "");
    }).catch(() => { if (active) setTokenOwnerWallet(""); });
    return () => { active = false; };
  }, [selectedEvm, wallets.ethereum?.address, tcurrAddress, ucurrAddress]);

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
      setWallets({ ethereum: { address: accounts[0], balance: `${displayAmount(Number(BigInt(raw)) / 1e18)} ETH`, name: wallet.name } });
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
      setSelectedEvm(null);
      setWallets({ solana: { address, balance, name: wallet.name } });
      setTab("balance");
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not connect wallet."); }
    finally { setBusy(false); }
  }

  async function refreshBalance() {
    if (!selectedEvm || !wallets.ethereum) return;
    setTcurrLoading(true);
    setUcurrLoading(true);
    setTcurrError("");
    setUcurrError("");
    const provider = selectedEvm.provider;
    const address = wallets.ethereum.address;
    await Promise.allSettled([
      provider.request({ method: "eth_getBalance", params: [address, "latest"] })
        .then((raw) => setWallets((current) => ({ ...current, ethereum: current.ethereum && { ...current.ethereum, balance: `${displayAmount(Number(BigInt(raw as string)) / 1e18)} ETH` } })))
        .catch(() => setNotice("Could not refresh Sepolia ETH right now.")),
      tcurrAddress ? readTCurrBalance(provider, tcurrAddress, address)
        .then(setTcurrBalance).catch((error) => setTcurrError(error instanceof Error ? error.message : "Could not refresh tCURR.")) : Promise.resolve(),
      ucurrAddress ? readTokenBalance(provider, ucurrAddress, address, "uCURR")
        .then(setUcurrBalance).catch((error) => setUcurrError(error instanceof Error ? error.message : "Could not refresh uCURR.")) : Promise.resolve(),
    ]);
    setTcurrLoading(false);
    setUcurrLoading(false);
  }

  async function addTokenToWallet() {
    if (!selectedEvm || !tcurrBalance) return;
    try {
      await suggestTokenInWallet(selectedEvm.provider, tcurrBalance);
      setNotice("Token import accepted. Check your Sepolia token list in your wallet.");
    } catch (error) { setNotice(walletImportError(error)); }
  }

  async function addUcurrToWallet() {
    if (!selectedEvm || !ucurrBalance) return;
    try {
      await suggestTokenInWallet(selectedEvm.provider, ucurrBalance, "uCURR");
      setNotice("Token import accepted. Check your Sepolia token list in your wallet.");
    } catch (error) { setNotice(walletImportError(error)); }
  }

  function requestAirdrop() {
    if (!wallets.ethereum && !wallets.solana) { setPickerOpen(true); return; }
    setKycAction("airdrop");
  }

  function disconnectWallet() {
    setWalletMenuOpen(false);
    setWallets({});
    setSelectedEvm(null);
    setTcurrBalance(null);
    setUcurrBalance(null);
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
  const isTokenOwner = Boolean(wallets.ethereum && tokenOwnerWallet === wallets.ethereum.address.toLowerCase());
  const balanceLabel = !wallets.ethereum ? "—" : tcurrLoading ? "Reading…" : tcurrError ? "Unavailable" : tcurrBalance ? tcurrBalance.display : "—";
  const utilityBalanceLabel = !wallets.ethereum ? "—" : ucurrLoading ? "Reading…" : ucurrError ? "Unavailable" : ucurrBalance ? ucurrBalance.display : "—";
  const ethereumOnlyNote = "Available on Ethereum Sepolia. Switch to an Ethereum wallet to view this token.";

  return <div className="app-shell">
    <header className="site-header"><div className="header-inner">
      <button className="brand-button" onClick={() => setTab("balance")} aria-label="CURR Hub, wallet balance"><BrandMark /><span>{brand.name}</span></button>
      <nav className="top-nav" aria-label="Main navigation">{tabs.map((item) => <button key={item.id} className={tab === item.id ? "tab active" : "tab"} onClick={() => { setTab(item.id); setNotice(""); }}>{item.label}</button>)}</nav>
      <div className="header-wallet-menu" ref={walletMenuRef}>
        <button className="header-wallet-button" onClick={() => { if (connected) setWalletMenuOpen((open) => !open); else { refreshWalletOptions(); setPickerOpen(true); } }} disabled={busy} aria-expanded={connected ? walletMenuOpen : undefined} aria-controls={connected ? "wallet-menu" : undefined}>{busy ? "Connecting…" : connected ? <>{shortAddress(wallets.ethereum?.address || wallets.solana!.address)} <span aria-hidden="true">⌄</span></> : "Connect wallet"}</button>
        {connected && walletMenuOpen && <div className="wallet-dropdown" id="wallet-menu"><div className="wallet-dropdown-info"><strong>{wallets.ethereum?.name || wallets.solana?.name}</strong><span>{wallets.ethereum ? "Ethereum Sepolia" : "Solana Devnet"}</span></div><button onClick={() => { setWalletMenuOpen(false); refreshWalletOptions(); setPickerOpen(true); }}>Switch wallet</button><button onClick={disconnectWallet}>Disconnect</button></div>}
      </div>
    </div></header>
    <main className="main-container">
      <div className="page-top"><div><span className="network-label"><span className="status-dot" />TEST NETWORKS</span><h1>{tab === "balance" ? connected ? "Your tokenized shares and rewards" : "Connect your tokenized shares wallet" : tab === "swap" ? "Swap tokens" : tab === "buy" ? "Buy uCURR" : "Airdrop"}</h1><p>{tab === "balance" ? wallets.solana ? "tCURR and uCURR are currently on Ethereum Sepolia. Switch to an Ethereum wallet to view them." : "View your tCURR and uCURR test token balances. Future uCURR rewards are not open yet." : tab === "swap" ? "Swap uCURR and test USDC on Sepolia when the pool is funded." : tab === "buy" ? "Explore the purchase flow. No payment will be taken." : "Your tCURR balance is visible now. Airdrop claims will open after the rules are approved."}</p></div>{tab === "balance" && connected && <div className="page-top-actions">{wallets.ethereum && <div className="native-balance"><span className="native-balance-label"><span className="coin-symbol eth-symbol">◆</span> Sepolia ETH</span><strong>{wallets.ethereum.balance}</strong></div>}{wallets.solana && <div className="native-balance"><span className="native-balance-label"><span className="coin-symbol sol-symbol">≋</span> Devnet SOL</span><strong>{wallets.solana.balance}</strong></div>}{wallets.ethereum && <button className="outline-button" onClick={refreshBalance} disabled={tcurrLoading || ucurrLoading}>Refresh balances</button>}</div>}</div>
      {notice && <div className="notice" role="status"><span>{notice}</span><button onClick={() => setNotice("")} aria-label="Dismiss message">×</button></div>}

      {tab === "balance" && <>
        {!connected && <section className="connect-hero"><div className="hero-symbol" aria-hidden="true"><BrandMark /></div><div><h2>Choose your wallet</h2><p>MetaMask shows tCURR and uCURR on Sepolia. Phantom shows your Solana Devnet balance.</p><button className="primary-button" onClick={() => { refreshWalletOptions(); setPickerOpen(true); }}>Connect wallet <ArrowIcon /></button></div></section>}
        <div className="balance-grid">
          <section className="balance-card token-card featured"><div className="card-kicker"><span className="token-emblem">t</span> tCURR <span className="card-network">SEPOLIA</span></div><div className={wallets.ethereum && tcurrBalance ? "large-balance" : "large-balance empty-balance"}>{balanceLabel}</div><div className="balance-caption">{wallets.solana ? ethereumOnlyNote : tcurrBalance ? "Your tCURR test token balance" : tcurrError || "Tokenized shares test token"}</div>{wallets.ethereum && tcurrBalance && <button className="import-button" onClick={addTokenToWallet}>Not showing in your wallet? Add tCURR <span aria-hidden="true">↗</span></button>}</section>
          <section className="balance-card token-card utility-card"><div className="card-kicker"><span className="coin-symbol utility-symbol">u</span> uCURR <span className="card-network">SEPOLIA</span></div><div className={wallets.ethereum && ucurrBalance ? "large-balance" : "large-balance empty-balance"}>{utilityBalanceLabel}</div><div className="balance-caption">{wallets.solana ? ethereumOnlyNote : ucurrError || (ucurrBalance ? "Your uCURR test token balance" : "Utility token for future rewards")}</div>{wallets.ethereum && ucurrBalance && <button className="import-button" onClick={addUcurrToWallet}>Not showing in your wallet? Add uCURR <span aria-hidden="true">↗</span></button>}</section>
        </div>
        {isTokenOwner && <a className="token-guide-link" href="/setup">New to test tokens? Follow the Sepolia ETH and token setup guide <span aria-hidden="true">→</span></a>}
        {wallets.solana && <a className="token-guide-link" href="/setup?chain=solana">Prepare Solana Devnet test tokens <span aria-hidden="true">→</span></a>}
      </>}

      {tab === "swap" && <SwapPanel provider={selectedEvm?.provider || null} wallet={wallets.ethereum?.address || ""} connectedToSolana={Boolean(wallets.solana)} onConnect={() => { refreshWalletOptions(); setPickerOpen(true); }} onSuccess={refreshBalance} />}

      {tab === "buy" && <div className="feature-layout"><section className="feature-card"><div className="feature-card-title"><h2>Purchase preview</h2><span className="preview-pill">SANDBOX</span></div><label className="amount-box"><span>You pay</span><div><input type="number" min="0" step="0.01" value={buyAmount} onChange={(event) => setBuyAmount(event.target.value)} aria-label="Purchase amount in US dollars" /><strong>USD</strong></div></label><div className="quote-line"><span>Illustrative uCURR amount</span><strong>{displayAmount(Math.max(0, Number(buyAmount) || 0) * 10, 2)} uCURR</strong></div><div className="quote-line"><span>Charged today</span><strong>$0.00</strong></div><p className="transaction-note">Preview only. No card details are collected, and no charge or token delivery occurs.</p></section><aside className="feature-aside"><div className="aside-icon">◈</div><h3>A safe first look</h3><p>Card checkout is not connected yet. This page only shows an example amount.</p></aside></div>}

      {tab === "airdrop" && <div className="feature-layout"><section className="feature-card airdrop-card"><span className="preview-pill">NOT OPEN YET</span><h2>Your tCURR matters here</h2><p>When the airdrop rules are approved, this page will show eligibility for your connected wallet.</p><div className="airdrop-holding"><span>Your tCURR on Sepolia</span><strong>{tcurrBalance ? `${tcurrBalance.display} tCURR` : wallets.ethereum ? tcurrLoading ? "Reading…" : tcurrError ? "Unavailable" : "—" : "Connect wallet"}</strong></div><button className="primary-button full-button" onClick={requestAirdrop}>{connected ? "Check airdrop status" : "Connect wallet"}<ArrowIcon /></button><p className="transaction-note">No allocation or claim is available yet.</p></section><aside className="feature-aside"><div className="aside-icon">✦</div><h3>What happens next?</h3><p>Eligibility rules, the snapshot, and the claim process are awaiting approval. Identity verification will be required to claim.</p></aside></div>}
    </main>
    <WalletPicker open={pickerOpen} choices={walletChoices} onClose={() => setPickerOpen(false)} onRefresh={refreshWalletOptions} />
    {kycAction && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setKycAction(null); }}><div className="status-modal" role="dialog" aria-modal="true" aria-labelledby="kyc-modal-title"><button className="icon-button modal-close" onClick={() => setKycAction(null)} aria-label="Close">×</button><span className="status-modal-icon">◎</span><h2 id="kyc-modal-title">Identity check required</h2><p>Airdrop claims will require identity verification. Verification is not available in this test version, so no action was submitted.</p><button className="primary-button full-button" onClick={() => setKycAction(null)}>Got it</button></div></div>}
  </div>;
}
