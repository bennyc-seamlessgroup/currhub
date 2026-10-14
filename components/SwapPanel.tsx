"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "ethers";
import type { InjectedEthereum } from "@/lib/tcurr";
import {
  approveForSwap, displayTokenAmount, executeSwap, minimumAfterSlippage,
  parseTokenAmount, quoteSwap, readSwapAllowance, readSwapBalance,
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
  const rate = poolLive && pool ? Number(formatUnits(inputToken === "uCURR" ? pool.reserveUSDC : pool.reserveUCurr, tokenDecimals(outputToken))) /
    Number(formatUnits(inputToken === "uCURR" ? pool.reserveUCurr : pool.reserveUSDC, tokenDecimals(inputToken))) : null;

  useEffect(() => {
    if (!provider || !wallet) { setBalances(null); return; }
    let active = true;
    setBalances(null);
    Promise.all([
      readSwapBalance(provider, wallet, "uCURR"),
      readSwapBalance(provider, wallet, "USDC"),
    ]).then(([uCURR, USDC]) => {
      if (active) setBalances({ uCURR, USDC });
    }).catch((error) => { if (active) setMessage(swapError(error)); });
    return () => { active = false; };
  }, [provider, wallet]);

  useEffect(() => {
    setQuote(null);
    setQuoteError("");
    try { parseTokenAmount(amountInput, inputToken); }
    catch (error) { setQuoteError(swapError(error)); setQuoteLoading(false); return; }
    let active = true;
    setQuoteLoading(true);
    const timer = window.setTimeout(() => {
      fetch(`/api/swap-quote?input=${inputToken}&amount=${encodeURIComponent(amountInput)}`, { cache: "no-store" })
        .then(async (response) => {
          const result = await response.json() as { error?: string; pair?: string | null; reserveUCurr?: string; reserveUSDC?: string; amountOut?: string };
          if (!response.ok) throw new Error(result.error || "Quote is temporarily unavailable.");
          return result;
        }).then((result) => {
        if (active) {
          setPool({ pair: result.pair || null, reserveUCurr: BigInt(result.reserveUCurr || "0"), reserveUSDC: BigInt(result.reserveUSDC || "0") });
          const nextQuote = BigInt(result.amountOut || "0");
          setQuote(nextQuote);
          if (nextQuote === 0n) setQuoteError("No quote is available for this amount.");
        }
      }).catch((error) => { if (active) { setPool(null); setQuoteError(error instanceof Error ? error.message : "Quote is temporarily unavailable."); } })
        .finally(() => { if (active) setQuoteLoading(false); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [inputToken, amountInput, quoteVersion]);

  useEffect(() => {
    setAllowance(null);
    if (!provider || !wallet) return;
    let active = true;
    readSwapAllowance(provider, wallet, inputToken)
      .then((value) => { if (active) setAllowance(value); })
      .catch(() => { if (active) setAllowance(null); });
    return () => { active = false; };
  }, [provider, wallet, inputToken]);

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
    setQuoteVersion((current) => current + 1);
    if (!provider || !wallet) return;
    try {
      const [uCURR, USDC] = await Promise.all([
        readSwapBalance(provider, wallet, "uCURR"),
        readSwapBalance(provider, wallet, "USDC"),
      ]);
      setBalances({ uCURR, USDC });
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
        setMessage("Waiting for token spending approval…");
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
        setMessage("Waiting for your swap to confirm…");
        await transaction.wait();
        await refresh();
        onSuccess();
        setMessage("Swap completed. Your wallet balances have been refreshed.");
      }
    } catch (error) { setMessage(swapError(error)); }
    finally { setBusy(false); }
  }

  return <div className="feature-layout"><section className="feature-card">
    <div className="feature-card-title"><h2>Swap tokens</h2></div>
    <label className="amount-box"><span>You pay</span><div><input type="number" min="0" step="any" value={amountInput} onChange={(event) => { setAmountInput(event.target.value); setMessage(""); }} aria-label={`Amount of ${inputToken} to swap`} disabled={busy} /><strong>{inputToken}</strong></div></label>
    <button className="swap-arrow" type="button" onClick={reverse} aria-label="Reverse swap direction" title="Reverse swap direction" disabled={busy}>⇅</button>
    <div className="amount-box result-box"><span>Estimated receive</span><div><b>{quoteLoading ? "Getting price…" : quote && quote > 0n ? displayTokenAmount(quote, outputToken) : "—"}</b><strong>{outputToken}</strong></div></div>
    {rate !== null && Number.isFinite(rate) && <div className="swap-details"><span>Current rate</span><strong>1 {inputToken} ≈ {rate.toLocaleString("en-US", { maximumSignificantDigits: 6 })} {outputToken}</strong></div>}
    {wallet && balances && <div className="swap-details"><span>Your {inputToken} balance</span><strong>{displayTokenAmount(balances[inputToken], inputToken)}</strong></div>}
    {quote && quote > 0n && <div className="swap-details"><span>Minimum received (1% tolerance)</span><strong>{displayTokenAmount(minimumAfterSlippage(quote), outputToken)} {outputToken}</strong></div>}
    {quoteError && <p className="setup-error" role="status">{quoteError}</p>}
    {insufficientBalance && <p className="setup-error">Your wallet does not have enough {inputToken} for this swap.</p>}
    {!wallet ? <button className="primary-button full-button" onClick={onConnect}>{connectedToSolana ? "Switch to an Ethereum wallet" : "Connect wallet"}</button>
      : !poolLive ? <button className="primary-button full-button" disabled>Trading is temporarily unavailable</button>
        : <button className="primary-button full-button" onClick={proceed} disabled={!canTrade || busy || quoteLoading}>{busy ? "Waiting for wallet…" : approved ? `Swap ${inputToken} for ${outputToken}` : `Approve ${inputToken} to swap`}</button>}
    {message && <p className="swap-message" role="status">{message}</p>}
    {txHash && <p className="setup-tx">Transaction: <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer">View on Etherscan ↗</a></p>}
    <p className="transaction-note">Review the final amount and network fee in your wallet before confirming.</p>
  </section><aside className="feature-aside"><div className="aside-icon">⇄</div><h3>Exchange at a glance</h3><p>Your quote updates as you change the amount. Prices can move before you confirm.</p><a className="text-button" href="https://docs.uniswap.org/contracts/v2/overview" target="_blank" rel="noopener noreferrer">Swaps use the Uniswap v2 protocol ↗</a>{wallet && <button className="text-button swap-refresh" onClick={refresh} disabled={busy}>Refresh balances</button>}</aside></div>;
}
