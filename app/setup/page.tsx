"use client";

import { useEffect, useState } from "react";
import { BrowserProvider, Contract, getAddress, isAddress, parseUnits } from "ethers";
import { readTokenBalance, TCURR_SEPOLIA_ADDRESS, UCURR_SEPOLIA_ADDRESS, type TokenBalance } from "@/lib/tcurr";
import PoolSetup from "@/components/PoolSetup";

type SymbolName = "tCURR" | "uCURR";
type EvmProvider = {
  request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>;
  isMetaMask?: boolean;
  isPhantom?: boolean;
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, listener: (...args: unknown[]) => void) => void;
};

declare global { interface Window { ethereum?: EvmProvider } }

const SEPOLIA_CHAIN_ID = "0xaa36a7";
const METAMASK_SMART_ACCOUNT_CODE = "0xef010063c0c19a282a1b52b07dd5a65b58948a07dae32b";
const tokenAddresses: Record<SymbolName, string> = { tCURR: TCURR_SEPOLIA_ADDRESS, uCURR: UCURR_SEPOLIA_ADDRESS };
const tokenAbi = [
  "function owner() view returns (address)",
  "function mint(address to, uint256 amount)",
  "function allowlisted(address account) view returns (bool)",
  "function setAllowlisted(address account, bool allowed)",
];

function short(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function errorText(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "CALL_EXCEPTION") return "This Sepolia transaction failed. Check the transaction link below.";
  if (code === "ACTION_REJECTED" || code === 4001) return "You cancelled the transaction in MetaMask.";
  if (error instanceof Error && error.message.length < 220) return error.message;
  return "MetaMask could not complete this step. Check the transaction link below.";
}
async function usesMetaMaskSmartAccount(provider: EvmProvider, wallet: string) {
  const code = await provider.request({ method: "eth_getCode", params: [wallet, "latest"] });
  return typeof code === "string" && code.toLowerCase() === METAMASK_SMART_ACCOUNT_CODE;
}

export default function TokenSetup() {
  const [provider, setProvider] = useState<EvmProvider | null>(null);
  const [wallet, setWallet] = useState("");
  const [eth, setEth] = useState("");
  const [balances, setBalances] = useState<Partial<Record<SymbolName, TokenBalance>>>({});
  const [owned, setOwned] = useState<Partial<Record<SymbolName, boolean>>>({});
  const [amounts, setAmounts] = useState<Record<SymbolName, string>>({ tCURR: "10", uCURR: "100" });
  const [recipient, setRecipient] = useState("");
  const [recipientAllowed, setRecipientAllowed] = useState<boolean | null>(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [pendingTx, setPendingTx] = useState("");
  const [smartAccount, setSmartAccount] = useState(false);

  useEffect(() => {
    const onAnnounce = (event: Event) => {
      const detail = (event as CustomEvent<{ info?: { name?: string; rdns?: string }; provider?: EvmProvider }>).detail;
      if (detail?.provider?.request && (detail.info?.rdns === "io.metamask" || /metamask/i.test(detail.info?.name || "") && !detail.provider.isPhantom)) setProvider(detail.provider);
    };
    window.addEventListener("eip6963:announceProvider", onAnnounce);
    window.dispatchEvent(new Event("eip6963:requestProvider"));
    if (window.ethereum?.request && window.ethereum.isMetaMask && !window.ethereum.isPhantom) setProvider((current) => current || window.ethereum || null);
    return () => window.removeEventListener("eip6963:announceProvider", onAnnounce);
  }, []);

  useEffect(() => {
    if (!provider?.on) return;
    const changed = () => {
      setWallet(""); setEth(""); setBalances({}); setOwned({}); setRecipientAllowed(null); setSmartAccount(false);
      setMessage("Wallet changed. Connect again before continuing.");
    };
    provider.on("accountsChanged", changed);
    provider.on("chainChanged", changed);
    return () => { provider.removeListener?.("accountsChanged", changed); provider.removeListener?.("chainChanged", changed); };
  }, [provider]);

  useEffect(() => {
    if (!wallet || !provider) return;
    let active = true;
    setBalances({});
    setOwned({});
    for (const symbol of ["tCURR", "uCURR"] as const) {
      const address = tokenAddresses[symbol];
      readTokenBalance(provider, address, wallet, symbol)
        .then((balance) => { if (active) setBalances((current) => ({ ...current, [symbol]: balance })); })
        .catch((error) => { if (active) setMessage(`${symbol}: ${errorText(error)}`); });
      const contract = new Contract(address, tokenAbi, new BrowserProvider(provider));
      (contract.owner() as Promise<string>)
        .then((owner) => { if (active) setOwned((current) => ({ ...current, [symbol]: owner.toLowerCase() === wallet.toLowerCase() })); })
        .catch(() => { if (active) setOwned((current) => ({ ...current, [symbol]: false })); });
    }
    return () => { active = false; };
  }, [wallet, provider]);

  useEffect(() => {
    if (!provider || !wallet || !isAddress(recipient.trim())) { setRecipientAllowed(null); return; }
    let active = true;
    const contract = new Contract(TCURR_SEPOLIA_ADDRESS, tokenAbi, new BrowserProvider(provider));
    (contract.allowlisted(getAddress(recipient.trim())) as Promise<boolean>)
      .then((allowed) => { if (active) setRecipientAllowed(allowed); })
      .catch(() => { if (active) setRecipientAllowed(null); });
    return () => { active = false; };
  }, [provider, wallet, recipient]);

  async function refreshEth(address: string, walletProvider: EvmProvider) {
    const raw = await walletProvider.request({ method: "eth_getBalance", params: [address, "latest"] }) as string;
    setEth((Number(BigInt(raw)) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 5 }));
  }

  async function connect() {
    if (!provider) { setMessage("Open this page in the browser where MetaMask is installed, then refresh it."); return; }
    setBusy("connect"); setMessage("");
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts?.[0]) throw new Error("MetaMask did not return an account.");
      let chainId = await provider.request({ method: "eth_chainId" }) as string;
      if (chainId?.toLowerCase() !== SEPOLIA_CHAIN_ID) {
        await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: SEPOLIA_CHAIN_ID }] });
        chainId = await provider.request({ method: "eth_chainId" }) as string;
      }
      if (chainId?.toLowerCase() !== SEPOLIA_CHAIN_ID) throw new Error("Select Sepolia in MetaMask and try again.");
      const address = getAddress(accounts[0]);
      setSmartAccount(await usesMetaMaskSmartAccount(provider, address));
      setWallet(address);
      await refreshEth(address, provider);
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  async function copyWallet() {
    try { await navigator.clipboard.writeText(wallet); setMessage("Wallet address copied. Paste it into the Sepolia PoW faucet."); }
    catch { setMessage("Could not copy automatically. Copy the public address from MetaMask."); }
  }

  async function getSigner() {
    if (!provider || !wallet) throw new Error("Connect MetaMask first.");
    const browserProvider = new BrowserProvider(provider);
    if ((await browserProvider.getNetwork()).chainId !== 11155111n) throw new Error("Switch MetaMask to Sepolia first.");
    if (await usesMetaMaskSmartAccount(provider, wallet)) {
      setSmartAccount(true);
      throw new Error("Turn off Smart account for Sepolia in MetaMask, confirm that change, then reconnect.");
    }
    setSmartAccount(false);
    return browserProvider.getSigner(wallet);
  }

  async function mint(symbol: SymbolName) {
    if (!provider || !wallet || !owned[symbol]) return;
    const input = amounts[symbol].trim();
    if (!/^(?:[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(input) || symbol === "tCURR" && input.includes(".")) {
      setMessage(symbol === "tCURR" ? "Enter a whole number from 1 to 999,999 tCURR." : "Enter 1 to 999,999 uCURR, with up to 6 decimal places.");
      return;
    }
    setBusy(`mint-${symbol}`); setMessage(""); setPendingTx("");
    try {
      const signer = await getSigner();
      const token = new Contract(tokenAddresses[symbol], tokenAbi, signer);
      const value = parseUnits(input, symbol === "tCURR" ? 0 : 18);
      const transaction = await token.mint(wallet, value);
      setPendingTx(transaction.hash);
      setMessage(`Minting ${symbol}. Waiting for Sepolia confirmation…`);
      await transaction.wait();
      const balance = await readTokenBalance(provider, tokenAddresses[symbol], wallet, symbol);
      setBalances((current) => ({ ...current, [symbol]: balance }));
      setMessage(`${input} ${symbol} was minted to your connected wallet on Sepolia.`);
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  async function allowRecipient() {
    if (!provider || !wallet || !owned.tCURR || !isAddress(recipient.trim())) { setMessage("Enter a valid recipient wallet address."); return; }
    setBusy("allowlist"); setMessage(""); setPendingTx("");
    try {
      const address = getAddress(recipient.trim());
      if (recipientAllowed) { setMessage("This wallet can already receive tCURR."); return; }
      const signer = await getSigner();
      const token = new Contract(TCURR_SEPOLIA_ADDRESS, tokenAbi, signer);
      const transaction = await token.setAllowlisted(address, true);
      setPendingTx(transaction.hash);
      setMessage("Waiting for Sepolia to allow this wallet to receive tCURR…");
      await transaction.wait();
      setRecipientAllowed(true);
      setMessage("This wallet can now receive tCURR. You can send tCURR to it from MetaMask.");
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  return <div className="app-shell setup-shell"><header className="site-header"><div className="header-inner"><a className="brand-button" href="/"><span className="brand-mark" aria-hidden="true">C</span><span>CURR Hub</span></a><a className="outline-button" href="/">← Back to wallet</a></div></header><main className="main-container setup-container">
    <div className="page-top"><div><span className="network-label"><span className="status-dot" />ETHEREUM SEPOLIA</span><h1>Get test tokens</h1><p>Get free Sepolia ETH for network fees, then use the existing tCURR and uCURR contracts.</p></div></div>
    <section className="setup-intro"><div className="setup-step">1</div><div><h2>Get free Sepolia ETH</h2><p>Sepolia ETH pays test network fees when you mint or send. Receiving tokens does not require ETH. You do not need mainnet ETH.</p>{wallet ? <div className="setup-wallet"><strong>{short(wallet)}</strong><span>{eth} Sepolia ETH</span><button className="text-button" onClick={copyWallet}>Copy address</button><button className="text-button" disabled={Boolean(busy)} onClick={() => provider && refreshEth(wallet, provider).catch((error) => setMessage(errorText(error)))}>Refresh ETH</button></div> : <button className="primary-button" disabled={Boolean(busy)} onClick={connect}>{busy === "connect" ? "Connecting…" : "Connect MetaMask on Sepolia"}</button>}<ol className="setup-guide-list"><li>Copy your public Sepolia wallet address from MetaMask or the button above.</li><li>Open the PoW faucet. Paste the address and start its browser mining task.</li><li>Stop the task and claim your test ETH, then return here and refresh your balance.</li></ol><a className="setup-link" href="https://sepolia-faucet.pk910.de/" target="_blank" rel="noopener noreferrer">Open Sepolia PoW faucet <span aria-hidden="true">↗</span></a></div></section>
    {wallet && smartAccount && <div className="notice" role="alert"><span>MetaMask Smart account is on for Sepolia. Turn it off in MetaMask and confirm the account update before minting. <a href="https://support.metamask.io/configure/accounts/switch-to-or-revert-from-a-smart-account/" target="_blank" rel="noopener noreferrer">See MetaMask steps ↗</a></span></div>}
    {message && <div className="notice" role="status"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Dismiss message">×</button></div>}
    {pendingTx && <p className="setup-tx">Transaction: <a href={`https://sepolia.etherscan.io/tx/${pendingTx}`} target="_blank" rel="noopener noreferrer">View on Sepolia Etherscan ↗</a></p>}
    <div className="setup-stage-head"><span className="setup-step">2</span><div><h2>Set up tCURR and uCURR</h2><p>Both contracts are already set up on Sepolia. Only their owner can mint. Other testers can receive tokens you send them.</p></div></div>
    <div className="setup-grid">{(["tCURR", "uCURR"] as const).map((symbol) => <section className="setup-token-card" key={symbol}><div className="setup-card-top"><span className={symbol === "tCURR" ? "token-emblem" : "coin-symbol utility-symbol"}>{symbol === "tCURR" ? "t" : "u"}</span><div><h2>{symbol}</h2><p>{symbol === "tCURR" ? "Tokenized shares test token · whole units" : "Utility test token · 18 decimals"}</p></div></div><div className="setup-contract"><span>Fixed Sepolia contract</span><a href={`https://sepolia.etherscan.io/address/${tokenAddresses[symbol]}`} target="_blank" rel="noopener noreferrer">{short(tokenAddresses[symbol])} ↗</a></div><div className="setup-contract"><span>Your live balance</span><strong>{wallet ? balances[symbol]?.display ?? "Reading…" : "Connect MetaMask"} {wallet ? symbol : ""}</strong></div>{wallet && owned[symbol] === false && <p className="setup-error">This wallet is not the contract owner. Ask the owner to send you test tokens.</p>}{owned[symbol] && <><label className="setup-amount">Amount to mint<input type="number" min="1" max="999999" step={symbol === "tCURR" ? "1" : "0.000001"} value={amounts[symbol]} onChange={(event) => setAmounts((current) => ({ ...current, [symbol]: event.target.value }))} /></label><button className="primary-button full-button" disabled={Boolean(busy) || smartAccount} onClick={() => mint(symbol)}>{busy === `mint-${symbol}` ? "Waiting for MetaMask…" : `Mint ${symbol} to my wallet`} <span aria-hidden="true">↗</span></button></>}</section>)}</div>
    {owned.uCURR && <PoolSetup provider={provider} wallet={wallet} smartAccount={smartAccount} refreshKey={balances.uCURR?.balance.toString() || ""} />}
    <div className="setup-done"><strong>Send tokens to another test wallet</strong><p>Send uCURR from MetaMask as usual. Before sending tCURR, the contract owner must allow the recipient wallet below. That approval is a Sepolia transaction.</p>{owned.tCURR && <div className="setup-recipient"><label htmlFor="tcurr-recipient">Recipient&apos;s public wallet address</label><div className="setting-row"><input id="tcurr-recipient" value={recipient} onChange={(event) => setRecipient(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" /><button className="outline-button" disabled={!isAddress(recipient.trim()) || Boolean(busy) || smartAccount || recipientAllowed === true} onClick={allowRecipient}>{busy === "allowlist" ? "Waiting…" : recipientAllowed ? "Allowed" : "Allow tCURR"}</button></div></div>}<p>After minting or receiving tokens, return to Wallet balance. Use the buttons there if the tokens do not appear in MetaMask.</p><a className="outline-button" href="/">View my wallet →</a></div>
    <p className="setup-disclaimer">These are test tokens on Sepolia. tCURR does not create legal share ownership, and uCURR has no real-world value.</p>
  </main></div>;
}
