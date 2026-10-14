"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "ethers";
import { readWalletSession, saveWalletSession } from "@/lib/wallet-session";

const SOLANA_DEVNET_RPC = process.env.NEXT_PUBLIC_SOLANA_DEVNET_RPC || "https://api.devnet.solana.com";
const SOLANA_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

type JsonRpcResponse<T> = { result?: T; error?: { message?: string } };

async function solanaRpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(SOLANA_DEVNET_RPC, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) throw new Error("Solana Devnet is busy. Try refreshing your balances in a moment.");
  const body = await response.json() as JsonRpcResponse<T>;
  if (body.error || body.result === undefined) throw new Error(body.error?.message || "Could not read Solana Devnet.");
  return body.result;
}

type TokenAccounts = { value: Array<{ account: { data: { parsed?: { info?: { tokenAmount?: { amount?: string } } } } } }> };

async function readBalances(address: string) {
  const [sol, usdc] = await Promise.all([
    solanaRpc<{ value: number }>("getBalance", [address, { commitment: "confirmed" }]),
    solanaRpc<TokenAccounts>("getTokenAccountsByOwner", [address, { mint: SOLANA_USDC_MINT }, { encoding: "jsonParsed", commitment: "confirmed" }]),
  ]);
  const rawUsdc = usdc.value.reduce((total, item) => total + BigInt(item.account.data.parsed?.info?.tokenAmount?.amount || "0"), 0n);
  return { sol: formatUnits(BigInt(sol.value), 9), usdc: formatUnits(rawUsdc, 6) };
}

export default function SolanaSetup() {
  const [wallet, setWallet] = useState("");
  const [sol, setSol] = useState<string | null>(null);
  const [usdc, setUsdc] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const saved = readWalletSession();
    if (saved?.chain !== "solana") return;
    const phantom = window.phantom?.solana || (window.solana?.isPhantom ? window.solana : undefined);
    if (!phantom) return;
    let active = true;
    phantom.connect({ onlyIfTrusted: true }).then(async (result) => {
      const address = result.publicKey?.toString();
      if (!active || address !== saved.address || readWalletSession()?.address !== saved.address) return;
      setWallet(address);
      const balances = await readBalances(address);
      if (active && readWalletSession()?.address === saved.address) { setSol(balances.sol); setUsdc(balances.usdc); }
    }).catch(() => { /* A manual connection remains available. */ });
    return () => { active = false; };
  }, []);

  async function refresh(address: string) {
    const balances = await readBalances(address);
    setSol(balances.sol);
    setUsdc(balances.usdc);
  }

  async function connect() {
    const phantom = window.phantom?.solana || (window.solana?.isPhantom ? window.solana : undefined);
    if (!phantom) { setMessage("Open this page in a browser with Phantom installed, then try again."); return; }
    setBusy(true);
    setMessage("");
    try {
      const result = await phantom.connect();
      const address = result.publicKey.toString();
      setWallet(address);
      saveWalletSession({ chain: "solana", address, id: "phantom-solana", name: "Phantom" });
      setSol(null);
      setUsdc(null);
      await refresh(address);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Phantom could not connect."); }
    finally { setBusy(false); }
  }

  async function copyAddress() {
    try { await navigator.clipboard.writeText(wallet); setMessage("Solana wallet address copied."); }
    catch { setMessage("Copy your public Solana address from Phantom."); }
  }

  async function refreshCurrent() {
    if (!wallet) return;
    setBusy(true);
    setMessage("");
    try { await refresh(wallet); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not read Solana Devnet."); }
    finally { setBusy(false); }
  }

  return <div className="solana-guide">
    <section className="setup-intro"><span className="setup-step">1</span><div>
      <h2>Connect Phantom and get Devnet SOL</h2>
      <p>In Phantom, open Settings → Developer Settings, turn on Testnet Mode, and choose <strong>Solana Devnet</strong>. Connect your Solana wallet below, then use its public address at Solana&apos;s Devnet faucet. Devnet SOL pays test transaction fees.</p>
      {wallet ? <div className="setup-wallet"><strong>{wallet.slice(0, 6)}…{wallet.slice(-4)}</strong><span>{sol ?? "Reading…"} Devnet SOL</span><button className="text-button" onClick={copyAddress}>Copy address</button><button className="text-button" onClick={refreshCurrent} disabled={busy}>Refresh balances</button><button className="text-button" onClick={connect} disabled={busy}>Reconnect Phantom</button></div> : <button className="primary-button" onClick={connect} disabled={busy}>{busy ? "Connecting…" : "Connect Phantom"}</button>}
      <div className="setup-links"><a className="setup-link" href="https://faucet.solana.com/" target="_blank" rel="noopener noreferrer">Get Devnet SOL ↗</a><a className="text-button" href="https://help.phantom.com/articles/use-testnets-in-phantom-5997313271699" target="_blank" rel="noopener noreferrer">How to turn on Phantom testnet mode ↗</a></div>
      {message && <p className="pool-message" role="status">{message}</p>}
    </div></section>
    <section className="setup-intro"><span className="setup-step">2</span><div>
      <h2>Create Solana tCURR and uCURR</h2>
      <p>Solana needs its own tCURR and uCURR token mint addresses; the Ethereum contracts cannot be used here. The planned setup will create Devnet mints controlled by your Phantom wallet, mint test balances, and save the public mint addresses for this portal.</p>
      <p className="setup-pending">This step is not live yet. Solana&apos;s guide below uses a separate Playground wallet by default. The Ethereum tCURR transfer approval rule also needs a Solana program before it can work here.</p>
      <a className="setup-link" href="https://solana.com/docs/tokens/quickstart" target="_blank" rel="noopener noreferrer">Read Solana&apos;s token setup guide ↗</a>
    </div></section>
    <section className="setup-intro"><span className="setup-step">3</span><div>
      <h2>Get Solana Devnet test USDC</h2>
      <p>At Circle&apos;s faucet, choose <strong>USDC</strong> and <strong>Solana Devnet</strong>. Paste the public Solana address from Phantom. Test USDC on Solana is separate from the Sepolia test USDC in MetaMask.</p>
      <a className="setup-link" href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer">Open Circle testnet faucet ↗</a>
      <div className="setup-contract"><span>Solana Devnet USDC mint</span><a href={`https://explorer.solana.com/address/${SOLANA_USDC_MINT}?cluster=devnet`} target="_blank" rel="noopener noreferrer">{SOLANA_USDC_MINT.slice(0, 6)}…{SOLANA_USDC_MINT.slice(-4)} ↗</a></div>
      {wallet && <div className="setup-wallet setup-usdc-balance"><span>Your Devnet test USDC</span><strong>{usdc ?? "Reading…"} USDC</strong><button className="text-button" onClick={refreshCurrent} disabled={busy}>{busy ? "Reading…" : "Refresh balance"}</button></div>}
    </div></section>
    <section className="setup-intro"><span className="setup-step">4</span><div>
      <h2>Start Solana swaps</h2>
      <p>Once Solana uCURR is available, a Devnet uCURR/USDC pool can support swaps confirmed in Phantom. Raydium has a Devnet pool integration path; Jupiter&apos;s published Swap API is intended for its main Solana market.</p>
      <p className="setup-pending">Solana swaps are not available in CURR Hub yet. The Solana tokens and pool still need to be created.</p>
    </div></section>
    <p className="setup-disclaimer">Solana Devnet SOL and test USDC have no cash value. Never enter a recovery phrase or private key in this site.</p>
  </div>;
}
