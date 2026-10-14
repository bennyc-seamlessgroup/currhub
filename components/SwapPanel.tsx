"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "ethers";
import type { InjectedEthereum } from "@/lib/tcurr";
import {
  approveForSwap, displayTokenAmount, executeSwap, minimumAfterSlippage,
  parseTokenAmount, quoteSwap, readPool, readSwapAllowance, readSwapBalance,
  swapError, tokenDecimals, type PoolState, type SwapToken,
} from "@/lib/sepolia-swap";

type Props = {
  provider: InjectedEthereum | null;
  wallet: string;
  connectedToSolana: boolean;
  onConnect: () => void;
  onSuccess: () => void;
};

export default function SwapPanel({ provider, wallet, connectedToSolana, onConnect, onSuccess }: Props) {
  const [inputToken, setInputToken] = useState<SwapToken>("uCURR");
  const [amountInput, setAmountInput] = useState("1");
  const [pool, setPool] = useState<PoolState | null>(null);
  const [balances, setBalances] = useState<{ uCURR: bigint; USDC: bigint } | null>(null);
  const [allowance, setAllowance] = useState<bigint | null>(null);
  const [quote, setQuote] = useState<bigint | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);
  const [quoteVersion, setQuoteVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [quoteError, setQuoteError] = useState("");
  const [txHash, setTxHash] = useState("");
  const outputToken: SwapToken = inputToken === "uCURR" ? "USDC" : "uCURR";
  const poolLive = Boolean(pool && pool.reserveUCurr > 0n && pool.reserveUSDC > 0n);

  useEffect(() => {
    if (!provider || !wallet) { setPool(null); setBalances(null); return; }
    let active = true;
    setPool(null);
    setBalances(null);
    Promise.all([
      readPool(provider),
      readSwapBalance(provider, wallet, "uCURR"),
      readSwapBalance(provider, wallet, "USDC"),
    ]).then(([nextPool, uCURR, USDC]) => {
      if (active) { setPool(nextPool); setBalances({ uCURR, USDC }); }
    }).catch((error) => { if (active) setMessage(swapError(error)); });
    return () => { active = false; };
  }, [provider, wallet]);

  useEffect(() => {
    setQuote(null);
    setAllowance(null);
    setQuoteError("");
    if (!provider || !wallet || !poolLive) { setQuoteLoading(false); return; }
    let amount: bigint;
    try { amount = parseTokenAmount(amountInput, inputToken); }
    catch (error) { setQuoteError(swapError(error)); setQuoteLoading(false); return; }
    let active = true;
    setQuoteLoading(true);
    const timer = window.setTimeout(() => {
      Promise.all([
        quoteSwap(provider, inputToken, amount),
        readSwapAllowance(provider, wallet, inputToken),
      ]).then(([nextQuote, nextAllowance]) => {
        if (active) {
          setQuote(nextQuote);
          setAllowance(nextAllowance);
          if (nextQuote === 0n) setQuoteError("This amount is too small for the pool. Enter a larger amount.");
        }
      }).catch(() => { if (active) setQuoteError("Could not get a live quote. Try a smaller amount."); })
        .finally(() => { if (active) setQuoteLoading(false); });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [provider, wallet, poolLive, inputToken, amountInput, quoteVersion]);

  let amount = 0n;
  try { amount = parseTokenAmount(amountInput, inputToken); } catch { /* Error shown with the quote. */ }
  const insufficientBalance = Boolean(balances && amount > balances[inputToken]);
  const approved = allowance !== null && allowance >= amount;
  const canTrade = Boolean(provider && wallet && poolLive && quote && quote > 0n && minimumAfterSlippage(quote) > 0n && !quoteError && !insufficientBalance && allowance !== null && amount > 0n);

  function reverse() {
    if (quote && quote > 0n) setAmountInput(formatUnits(quote, tokenDecimals(outputToken)));
    else setAmountInput("1");
    setInputToken(outputToken);
    setMessage("");
  }

  async function refresh() {
    if (!provider || !wallet) return;
    try {
      const [nextPool, uCURR, USDC] = await Promise.all([
        readPool(provider),
        readSwapBalance(provider, wallet, "uCURR"),
        readSwapBalance(provider, wallet, "USDC"),
      ]);
      setPool(nextPool);
      setBalances({ uCURR, USDC });
      setQuoteVersion((current) => current + 1);
    } catch (error) { setMessage(swapError(error)); }
  }

  async function proceed() {
    if (!provider || !wallet || !canTrade || busy || !quote) return;
    setBusy(true);
    setMessage("");
    setTxHash("");
    try {
      const latestBalance = await readSwapBalance(provider, wallet, inputToken);
      if (latestBalance < amount) throw new Error(`Your wallet does not have enough ${inputToken}.`);
      const latestAllowance = await readSwapAllowance(provider, wallet, inputToken);
      if (latestAllowance < amount) {
        const transaction = await approveForSwap(provider, wallet, inputToken, amount);
        setTxHash(transaction.hash);
        setMessage("Waiting for token spending approval on Sepolia…");
        await transaction.wait();
        setAllowance(await readSwapAllowance(provider, wallet, inputToken));
        setMessage(`${inputToken} spending approved. Review the live quote, then swap.`);
      } else {
        const freshQuote = await quoteSwap(provider, inputToken, amount);
        if (freshQuote < minimumAfterSlippage(quote)) {
          setQuote(freshQuote);
          throw new Error("The price moved. Review the new quote before swapping.");
        }
        const transaction = await executeSwap(provider, wallet, inputToken, amount, minimumAfterSlippage(freshQuote));
        setTxHash(transaction.hash);
        setMessage("Waiting for your Sepolia swap to confirm…");
        await transaction.wait();
        await refresh();
        onSuccess();
        setMessage("Swap completed. Your wallet balances have been refreshed.");
      }
    } catch (error) { setMessage(swapError(error)); }
    finally { setBusy(false); }
  }

  return <div className="feature-layout"><section className="feature-card">
    <div className="feature-card-title"><h2>Swap tokens</h2><span className="preview-pill">SEPOLIA</span></div>
    <label className="amount-box"><span>You pay</span><div><input type="number" min="0" step="any" value={amountInput} onChange={(event) => { setAmountInput(event.target.value); setMessage(""); }} aria-label={`Amount of ${inputToken} to swap`} disabled={busy} /><strong>{inputToken}</strong></div></label>
    <button className="swap-arrow" type="button" onClick={reverse} aria-label="Reverse swap direction" title="Reverse swap direction" disabled={busy}>⇅</button>
    <div className="amount-box result-box"><span>You receive (live quote)</span><div><b>{quoteLoading ? "Reading…" : quote && quote > 0n ? displayTokenAmount(quote, outputToken) : "—"}</b><strong>{outputToken}</strong></div></div>
    {wallet && balances && <div className="swap-details"><span>Your {inputToken} balance</span><strong>{displayTokenAmount(balances[inputToken], inputToken)}</strong></div>}
    {quote && quote > 0n && <div className="swap-details"><span>Minimum received (1% tolerance)</span><strong>{displayTokenAmount(minimumAfterSlippage(quote), outputToken)} {outputToken}</strong></div>}
    {quoteError && <p className="setup-error" role="status">{quoteError}</p>}
    {insufficientBalance && <p className="setup-error">Your wallet does not have enough {inputToken} for this swap.</p>}
    {!wallet ? <button className="primary-button full-button" onClick={onConnect}>{connectedToSolana ? "Switch to an Ethereum wallet" : "Connect wallet"}</button>
      : !poolLive ? <button className="primary-button full-button" disabled>Swap pool is not live yet</button>
        : <button className="primary-button full-button" onClick={proceed} disabled={!canTrade || busy || quoteLoading}>{busy ? "Waiting for MetaMask…" : approved ? `Swap ${inputToken} for ${outputToken}` : `Authorize ${inputToken} spending`}</button>}
    {message && <p className="swap-message" role="status">{message}</p>}
    {txHash && <p className="setup-tx">Transaction: <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer">View on Etherscan ↗</a></p>}
    <p className="transaction-note">Real Sepolia test tokens only. MetaMask confirms token approval and the swap; each uses test ETH for network fees.</p>
  </section><aside className="feature-aside"><div className="aside-icon">⇄</div><h3>Live uCURR ↔ USDC</h3><p>Quotes come from the Uniswap pool and change with trades. Test USDC has no cash value.</p>{pool?.pair && <a className="text-button" href={`https://sepolia.etherscan.io/address/${pool.pair}`} target="_blank" rel="noopener noreferrer">View pool on Etherscan ↗</a>}{wallet && <button className="text-button swap-refresh" onClick={refresh} disabled={busy}>Refresh balances</button>}</aside></div>;
}
