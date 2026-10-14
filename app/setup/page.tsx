"use client";

import { useEffect, useState } from "react";
import { BrowserProvider, Contract, ContractFactory, getAddress, parseUnits } from "ethers";
import { readTokenBalance, type TokenBalance } from "@/lib/tcurr";
import artifacts from "@/lib/test-contract-artifacts.json";

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
const keys: Record<SymbolName, string> = { tCURR: "currhub-tcurr-sepolia-contract", uCURR: "currhub-ucurr-sepolia-contract" };
const source = { tCURR: artifacts.TCURRTest, uCURR: artifacts.UCURRTest };

function short(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function errorText(error: unknown) {
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "CALL_EXCEPTION") return "This Sepolia transaction failed. No tokens were added. Check the transaction link below.";
  if (code === "ACTION_REJECTED" || code === 4001) return "You cancelled the transaction in MetaMask.";
  if (error instanceof Error && error.message.length < 220) return error.message;
  return "The wallet could not complete this step. Check MetaMask and the transaction link below.";
}
async function usesMetaMaskSmartAccount(provider: EvmProvider, wallet: string) {
  const code = await provider.request({ method: "eth_getCode", params: [wallet, "latest"] });
  return typeof code === "string" && code.toLowerCase() === METAMASK_SMART_ACCOUNT_CODE;
}

export default function TokenSetup() {
  const [provider, setProvider] = useState<EvmProvider | null>(null);
  const [wallet, setWallet] = useState("");
  const [eth, setEth] = useState("");
  const [addresses, setAddresses] = useState<Partial<Record<SymbolName, string>>>({});
  const [balances, setBalances] = useState<Partial<Record<SymbolName, TokenBalance>>>({});
  const [owned, setOwned] = useState<Partial<Record<SymbolName, boolean>>>({});
  const [amounts, setAmounts] = useState<Record<SymbolName, string>>({ tCURR: "10", uCURR: "1000" });
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [pendingTx, setPendingTx] = useState("");
  const [smartAccount, setSmartAccount] = useState(false);

  useEffect(() => {
    const saved: Partial<Record<SymbolName, string>> = {};
    for (const symbol of ["tCURR", "uCURR"] as const) {
      const address = localStorage.getItem(keys[symbol]);
      if (address) saved[symbol] = address;
    }
    setAddresses(saved);
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
    const changed = () => { setWallet(""); setEth(""); setBalances({}); setOwned({}); setSmartAccount(false); setMessage("Wallet changed. Connect again before continuing."); };
    provider.on("accountsChanged", changed);
    provider.on("chainChanged", changed);
    return () => { provider.removeListener?.("accountsChanged", changed); provider.removeListener?.("chainChanged", changed); };
  }, [provider]);

  useEffect(() => {
    if (!wallet || !provider) return;
    let active = true;
    for (const symbol of ["tCURR", "uCURR"] as const) {
      const address = addresses[symbol];
      if (!address) continue;
      readTokenBalance(provider, address, wallet, symbol)
        .then((balance) => { if (active) setBalances((current) => ({ ...current, [symbol]: balance })); })
        .catch((error) => { if (active) setMessage(`${symbol}: ${errorText(error)}`); });
      const contract = new Contract(address, ["function owner() view returns (address)"], new BrowserProvider(provider));
      (contract.owner() as Promise<string>)
        .then((owner) => { if (active) setOwned((current) => ({ ...current, [symbol]: owner.toLowerCase() === wallet.toLowerCase() })); })
        .catch(() => { if (active) setOwned((current) => ({ ...current, [symbol]: false })); });
    }
    return () => { active = false; };
  }, [wallet, provider, addresses.tCURR, addresses.uCURR]);

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
      const raw = await provider.request({ method: "eth_getBalance", params: [accounts[0], "latest"] }) as string;
      setSmartAccount(await usesMetaMaskSmartAccount(provider, accounts[0]));
      setWallet(getAddress(accounts[0]));
      setEth((Number(BigInt(raw)) / 1e18).toLocaleString("en-US", { maximumFractionDigits: 5 }));
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  async function deploy(symbol: SymbolName) {
    if (!provider || !wallet || addresses[symbol]) return;
    setBusy(`deploy-${symbol}`); setMessage(""); setPendingTx("");
    try {
      const browserProvider = new BrowserProvider(provider);
      if ((await browserProvider.getNetwork()).chainId !== 11155111n) throw new Error("Switch MetaMask to Sepolia first.");
      if (await usesMetaMaskSmartAccount(provider, wallet)) { setSmartAccount(true); throw new Error("Turn off Smart account for Sepolia in MetaMask, confirm that change, then refresh this page."); }
      setSmartAccount(false);
      const signer = await browserProvider.getSigner(wallet);
      const factory = new ContractFactory(source[symbol].abi, source[symbol].bytecode, signer);
      const contract = await factory.deploy(wallet);
      const transaction = contract.deploymentTransaction();
      if (transaction) setPendingTx(transaction.hash);
      setMessage(`Deploying ${symbol}. Waiting for Sepolia to confirm your MetaMask transaction…`);
      await contract.waitForDeployment();
      const address = await contract.getAddress();
      localStorage.setItem(keys[symbol], address);
      setAddresses((current) => ({ ...current, [symbol]: address }));
      setOwned((current) => ({ ...current, [symbol]: true }));
      setMessage(`${symbol} is deployed on Sepolia. Next, mint a test amount to your wallet.`);
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  async function mint(symbol: SymbolName) {
    const address = addresses[symbol];
    if (!provider || !wallet || !address || !owned[symbol] || !balances[symbol]) return;
    const input = amounts[symbol].trim();
    if (!/^(?:[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(input) || symbol === "tCURR" && input.includes(".")) {
      setMessage(symbol === "tCURR" ? "Enter a whole number from 1 to 999,999 tCURR." : "Enter 1 to 999,999 uCURR, with up to 6 decimal places.");
      return;
    }
    setBusy(`mint-${symbol}`); setMessage(""); setPendingTx("");
    try {
      const browserProvider = new BrowserProvider(provider);
      if ((await browserProvider.getNetwork()).chainId !== 11155111n) throw new Error("Switch MetaMask to Sepolia first.");
      if (await usesMetaMaskSmartAccount(provider, wallet)) { setSmartAccount(true); throw new Error("Turn off Smart account for Sepolia in MetaMask, confirm that change, then refresh this page."); }
      setSmartAccount(false);
      const signer = await browserProvider.getSigner(wallet);
      const token = new Contract(address, source[symbol].abi, signer);
      const owner = await token.owner() as string;
      if (owner.toLowerCase() !== wallet.toLowerCase()) throw new Error("Only the contract owner's wallet can mint this token.");
      const value = parseUnits(input, symbol === "tCURR" ? 0 : 18);
      const transaction = await token.mint(wallet, value);
      setPendingTx(transaction.hash);
      setMessage(`Minting ${symbol}. Waiting for Sepolia confirmation…`);
      await transaction.wait();
      setBalances((current) => ({ ...current, [symbol]: undefined }));
      const balance = await readTokenBalance(provider, address, wallet, symbol);
      setBalances((current) => ({ ...current, [symbol]: balance }));
      setMessage(`${input} ${symbol} was minted to your connected wallet on Sepolia.`);
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  return <div className="app-shell setup-shell"><header className="site-header"><div className="header-inner"><a className="brand-button" href="/"><span className="brand-mark" aria-hidden="true">C</span><span>CURR Hub</span></a><a className="outline-button" href="/">← Back to wallet</a></div></header><main className="main-container setup-container">
    <div className="page-top"><div><span className="network-label"><span className="status-dot" />ETHEREUM SEPOLIA</span><h1>Set up test tokens</h1><p>Create tCURR and uCURR on the test network, then mint test amounts to your wallet.</p></div></div>
    <section className="setup-intro"><div className="setup-step">1</div><div><h2>Connect MetaMask</h2><p>This uses Sepolia test ETH for network fees. It never uses your mainnet ETH.</p>{wallet ? <div className="setup-wallet"><strong>{short(wallet)}</strong><span>{eth} Sepolia ETH</span></div> : <button className="primary-button" disabled={Boolean(busy)} onClick={connect}>{busy === "connect" ? "Connecting…" : "Connect MetaMask"}</button>}</div></section>
    {wallet && smartAccount && <div className="notice" role="alert"><span>MetaMask Smart account is on for Sepolia. Turn it off in MetaMask and confirm the account update before creating or minting tokens. <a href="https://support.metamask.io/configure/accounts/switch-to-or-revert-from-a-smart-account/" target="_blank" rel="noopener noreferrer">See MetaMask steps ↗</a></span></div>}
    {message && <div className="notice" role="status"><span>{message}</span><button onClick={() => setMessage("")} aria-label="Dismiss message">×</button></div>}
    {pendingTx && <p className="setup-tx">Transaction: <a href={`https://sepolia.etherscan.io/tx/${pendingTx}`} target="_blank" rel="noopener noreferrer">View on Sepolia Etherscan ↗</a></p>}
    <div className="setup-grid">{(["tCURR", "uCURR"] as const).map((symbol, index) => <section className="setup-token-card" key={symbol}><div className="setup-card-top"><span className="setup-step">{index + 2}</span><div><h2>{symbol}</h2><p>{symbol === "tCURR" ? "Test tokenized shares · whole units" : "Test utility token · 18 decimals"}</p></div></div>{addresses[symbol] ? <><div className="setup-contract"><span>Deployed contract</span><a href={`https://sepolia.etherscan.io/address/${addresses[symbol]}`} target="_blank" rel="noopener noreferrer">{short(addresses[symbol])} ↗</a></div><div className="setup-contract"><span>Your live balance</span><strong>{balances[symbol]?.display ?? "Reading…"} {symbol}</strong></div>{owned[symbol] === false && <p className="setup-error">This wallet does not own this contract, so it cannot mint.</p>}<label className="setup-amount">Amount to mint<input type="number" min="1" max="999999" step={symbol === "tCURR" ? "1" : "0.000001"} value={amounts[symbol]} onChange={(event) => setAmounts((current) => ({ ...current, [symbol]: event.target.value }))} /></label><button className="primary-button full-button" disabled={!wallet || Boolean(busy) || smartAccount || !owned[symbol] || !balances[symbol]} onClick={() => mint(symbol)}>{busy === `mint-${symbol}` ? "Waiting for MetaMask…" : `Mint ${symbol} to my wallet`} <span aria-hidden="true">↗</span></button></> : <><p className="setup-card-copy">MetaMask will ask you to approve one Sepolia transaction. You will own the new test contract.</p><button className="primary-button full-button" disabled={!wallet || Boolean(busy) || smartAccount} onClick={() => deploy(symbol)}>{busy === `deploy-${symbol}` ? "Waiting for MetaMask…" : `Deploy ${symbol}`} <span aria-hidden="true">↗</span></button></>}</section>)}</div>
    <div className="setup-done"><strong>After minting</strong><p>Return to Wallet balance and reconnect MetaMask to see both token balances. Adding a token to MetaMask&apos;s display is optional and does not change its balance.</p><a className="outline-button" href="/">View my wallet →</a></div>
    <p className="setup-disclaimer">These are test tokens on Sepolia. tCURR does not create legal share ownership, and uCURR has no real-world value.</p>
  </main></div>;
}
