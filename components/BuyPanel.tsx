"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "ethers";
import { displayTokenAmount } from "@/lib/sepolia-swap";

type MarketQuote = { amountOut: bigint; usdcPerUCurr: number; updatedAt: number };
type QuoteResponse = { error?: string; amountOut?: string; reserveUCurr?: string; reserveUSDC?: string };

export default function BuyPanel() {
  const [amount, setAmount] = useState("50");
  const [quote, setQuote] = useState<MarketQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(() => { if (!document.hidden) setRefresh((current) => current + 1); }, 15_000);
    const onVisible = () => { if (!document.hidden) setRefresh((current) => current + 1); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, []);

  useEffect(() => {
    setQuote(null);
    if (!/^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/.test(amount) || Number(amount) <= 0 || amount.length > 24) {
      setLoading(false);
      setError("Enter an amount greater than zero, with up to two decimal places.");
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/swap-quote?input=USDC&amount=${encodeURIComponent(amount)}`, {
          cache: "no-store", signal: controller.signal,
        });
        const result = await response.json() as QuoteResponse;
        if (!response.ok) throw new Error(result.error || "Price is temporarily unavailable.");
        const amountOut = BigInt(result.amountOut || "0");
        const reserveUCurr = BigInt(result.reserveUCurr || "0");
        const reserveUSDC = BigInt(result.reserveUSDC || "0");
        if (amountOut <= 0n || reserveUCurr <= 0n || reserveUSDC <= 0n) throw new Error("Price is temporarily unavailable.");
        const usdcPerUCurr = Number(formatUnits(reserveUSDC, 6)) / Number(formatUnits(reserveUCurr, 18));
        if (!Number.isFinite(usdcPerUCurr) || usdcPerUCurr <= 0) throw new Error("Price is temporarily unavailable.");
        setQuote({ amountOut, usdcPerUCurr, updatedAt: Date.now() });
      } catch (cause) {
        if (!controller.signal.aborted) {
          setQuote(null);
          setError(cause instanceof Error ? cause.message : "Price is temporarily unavailable.");
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, 300);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [amount, refresh]);

  return <div className="feature-layout"><section className="feature-card buy-card">
    <div className="feature-card-title"><h2>Purchase estimate</h2><span className="preview-pill">COMING SOON</span></div>
    <label className="amount-box"><span>Amount to spend</span><div><input type="text" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} aria-label="Amount to spend in US dollars" /><strong>USD</strong></div></label>
    <div className="amount-box result-box buy-result"><span>Estimated uCURR</span><div><b>{loading ? "…" : quote ? displayTokenAmount(quote.amountOut, "uCURR", 3) : "—"}</b><strong>uCURR</strong></div></div>
    <div className="swap-details"><span>Current pool rate</span><strong>{quote ? `1 uCURR ≈ ${quote.usdcPerUCurr.toLocaleString("en-US", { maximumSignificantDigits: 6 })} USDC` : "—"}</strong></div>
    {quote && <div className="swap-details"><span>Price refreshed</span><strong>{new Date(quote.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</strong></div>}
    {error && <p className="setup-error" role="status">{error}</p>}
    <button className="primary-button full-button buy-disabled" disabled>Buy uCURR <span>Coming soon</span></button>
    <p className="transaction-note">Card purchases are not available yet. No payment or token delivery will occur.</p>
  </section><aside className="feature-aside"><div className="aside-icon">◈</div><h3>How pricing works</h3><p>This estimate follows the uCURR/USDC pool and refreshes about every 15 seconds. The amount reflects pool pricing for the size entered.</p><p>For this preview, $1 is mapped to 1 test USDC. A card provider will show the final USD price and fees when purchases launch.</p></aside></div>;
}
