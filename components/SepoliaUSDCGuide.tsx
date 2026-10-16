"use client";

import { useEffect, useState } from "react";
import type { InjectedEthereum } from "@/lib/tcurr";
import { displayTokenAmount, readSwapBalance, SEPOLIA_USDC_ADDRESS, swapError } from "@/lib/sepolia-swap";

type Props = { provider: InjectedEthereum | null; wallet: string };

export default function SepoliaUSDCGuide({ provider, wallet }: Props) {
  const [balance, setBalance] = useState<bigint | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!provider || !wallet) { setBalance(null); return; }
    let active = true;
    setBalance(null);
    readSwapBalance(provider, wallet, "USDC")
      .then((result) => { if (active) setBalance(result); })
      .catch((error) => { if (active) setMessage(swapError(error)); });
    return () => { active = false; };
  }, [provider, wallet]);

  async function refresh() {
    if (!provider || !wallet) return;
    setLoading(true);
    setMessage("");
    try { setBalance(await readSwapBalance(provider, wallet, "USDC")); }
    catch (error) { setMessage(swapError(error)); }
    finally { setLoading(false); }
  }

  async function showInWallet() {
    if (!provider) return;
    setMessage("");
    try {
      const accepted = await provider.request({ method: "wallet_watchAsset", params: {
        type: "ERC20", options: { address: SEPOLIA_USDC_ADDRESS, symbol: "USDC", decimals: 6 },
      } });
      setMessage(accepted === false ? "Token import was cancelled in MetaMask." : "MetaMask was asked to show test USDC.");
    } catch (error) { setMessage(swapError(error)); }
  }

  return <section className="setup-intro" aria-labelledby="sepolia-usdc-title">
    <span className="setup-step">2</span><div>
      <h2 id="sepolia-usdc-title">Get test USDC</h2>
      <p>Open Circle&apos;s testnet faucet. Choose <strong>USDC</strong> and <strong>Ethereum Sepolia</strong>, paste your public MetaMask address, then send test USDC. Use the same wallet you connected above. No mainnet USDC is needed.</p>
      <a className="setup-link" href="https://faucet.circle.com/" target="_blank" rel="noopener noreferrer">Open Circle testnet faucet <span aria-hidden="true">↗</span></a>
      <div className="setup-contract"><span>Sepolia test USDC contract</span><a href={`https://sepolia.etherscan.io/address/${SEPOLIA_USDC_ADDRESS}`} target="_blank" rel="noopener noreferrer">{SEPOLIA_USDC_ADDRESS.slice(0, 6)}…{SEPOLIA_USDC_ADDRESS.slice(-4)} ↗</a></div>
      {wallet && <div className="setup-wallet setup-usdc-balance"><span>Your test USDC</span><strong>{balance === null ? "Reading…" : `${displayTokenAmount(balance, "USDC")} USDC`}</strong><button className="text-button" onClick={refresh} disabled={loading}>{loading ? "Reading…" : "Refresh balance"}</button><button className="text-button" onClick={showInWallet}>Not showing in MetaMask?</button></div>}
      {message && <p className="pool-message" role="status">{message}</p>}
    </div>
  </section>;
}
