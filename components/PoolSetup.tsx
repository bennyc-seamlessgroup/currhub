"use client";

import { useEffect, useState } from "react";
import type { InjectedEthereum } from "@/lib/tcurr";
import {
  approveForSwap, approveLiquidityWithdrawal, createSwapPool, displayTokenAmount,
  minimumAfterSlippage, parseTokenAmount, readLiquidityPosition, readPool,
  readSwapAllowance, readSwapBalance, removeLiquidity, swapError,
  type PoolState,
} from "@/lib/sepolia-swap";

type Props = {
  provider: InjectedEthereum | null;
  wallet: string;
  smartAccount: boolean;
  refreshKey: string;
};

type PoolData = {
  pool: PoolState;
  ucurrBalance: bigint;
  usdcBalance: bigint;
  ucurrAllowance: bigint;
  usdcAllowance: bigint;
  lpBalance: bigint;
  lpSupply: bigint;
  lpAllowance: bigint;
};

async function loadPoolData(provider: InjectedEthereum, wallet: string): Promise<PoolData> {
  const [pool, ucurrBalance, usdcBalance, ucurrAllowance, usdcAllowance] = await Promise.all([
    readPool(provider),
    readSwapBalance(provider, wallet, "uCURR"),
    readSwapBalance(provider, wallet, "USDC"),
    readSwapAllowance(provider, wallet, "uCURR"),
    readSwapAllowance(provider, wallet, "USDC"),
  ]);
  const position = pool.pair
    ? await readLiquidityPosition(provider, wallet, pool.pair)
    : { balance: 0n, totalSupply: 0n, allowance: 0n };
  return {
    pool, ucurrBalance, usdcBalance, ucurrAllowance, usdcAllowance,
    lpBalance: position.balance, lpSupply: position.totalSupply, lpAllowance: position.allowance,
  };
}

export default function PoolSetup({ provider, wallet, smartAccount, refreshKey }: Props) {
  const [data, setData] = useState<PoolData | null>(null);
  const [ucurrInput, setUCurrInput] = useState("40");
  const [usdcInput, setUsdcInput] = useState("4");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [txHash, setTxHash] = useState("");

  useEffect(() => {
    if (!provider || !wallet) { setData(null); setLoading(false); return; }
    let active = true;
    setData(null);
    setLoading(true);
    loadPoolData(provider, wallet)
      .then((result) => { if (active) setData(result); })
      .catch((error) => { if (active) setMessage(swapError(error)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [provider, wallet, refreshKey]);

  async function refresh() {
    if (!provider || !wallet) return;
    setLoading(true);
    try { setData(await loadPoolData(provider, wallet)); }
    catch (error) { setMessage(swapError(error)); }
    finally { setLoading(false); }
  }

  let ucurrAmount = 0n;
  let usdcAmount = 0n;
  let amountError = "";
  try {
    ucurrAmount = parseTokenAmount(ucurrInput, "uCURR");
    usdcAmount = parseTokenAmount(usdcInput, "USDC");
  } catch (error) { amountError = swapError(error); }

  const live = Boolean(data && data.pool.reserveUCurr > 0n && data.pool.reserveUSDC > 0n);
  const insufficientUCurr = Boolean(data && ucurrAmount > data.ucurrBalance);
  const insufficientUSDC = Boolean(data && usdcAmount > data.usdcBalance);
  const nextStep = data && !amountError && !insufficientUCurr && !insufficientUSDC
    ? data.ucurrAllowance < ucurrAmount ? "approve-u" : data.usdcAllowance < usdcAmount ? "approve-c" : "create"
    : "";
  const impliedRate = Number(usdcInput) > 0 ? Number(ucurrInput) / Number(usdcInput) : 0;
  const withdrawUCurr = data && data.lpSupply > 0n ? data.pool.reserveUCurr * data.lpBalance / data.lpSupply : 0n;
  const withdrawUSDC = data && data.lpSupply > 0n ? data.pool.reserveUSDC * data.lpBalance / data.lpSupply : 0n;

  async function proceed() {
    if (!provider || !wallet || !data || !nextStep || live || busy || smartAccount) return;
    setBusy(true);
    setMessage("");
    setTxHash("");
    try {
      if (nextStep === "create") {
        const latest = await loadPoolData(provider, wallet);
        if (latest.pool.reserveUCurr > 0n || latest.pool.reserveUSDC > 0n) {
          setData(latest);
          throw new Error("A pool is already funded. Review its live price before adding more liquidity.");
        }
        if (latest.ucurrBalance < ucurrAmount || latest.usdcBalance < usdcAmount) throw new Error("Your wallet does not have enough tokens for this deposit.");
        if (latest.ucurrAllowance < ucurrAmount || latest.usdcAllowance < usdcAmount) throw new Error("Approve both token amounts first.");
      }
      const transaction = nextStep === "approve-u"
        ? await approveForSwap(provider, wallet, "uCURR", ucurrAmount)
        : nextStep === "approve-c"
          ? await approveForSwap(provider, wallet, "USDC", usdcAmount)
          : await createSwapPool(provider, wallet, ucurrAmount, usdcAmount);
      setTxHash(transaction.hash);
      setMessage("Waiting for your Sepolia transaction to confirm…");
      await transaction.wait();
      await refresh();
      setMessage(nextStep === "create" ? "The uCURR/USDC pool is live. Test wallets can now swap." : "Token spending approved. Continue to the next step.");
    } catch (error) { setMessage(swapError(error)); }
    finally { setBusy(false); }
  }

  async function withdraw() {
    if (!provider || !wallet || !data?.pool.pair || data.lpBalance <= 0n || busy || smartAccount) return;
    setBusy(true);
    setMessage("");
    setTxHash("");
    try {
      const latest = await loadPoolData(provider, wallet);
      if (!latest.pool.pair || latest.lpBalance <= 0n || latest.lpSupply <= 0n) throw new Error("No pool position remains in this wallet.");
      const needsApproval = latest.lpAllowance < latest.lpBalance;
      const estimatedUCurr = latest.pool.reserveUCurr * latest.lpBalance / latest.lpSupply;
      const estimatedUSDC = latest.pool.reserveUSDC * latest.lpBalance / latest.lpSupply;
      if (!needsApproval && (estimatedUCurr <= 0n || estimatedUSDC <= 0n)) throw new Error("Pool reserves are too low to withdraw through this form.");
      const transaction = needsApproval
        ? await approveLiquidityWithdrawal(provider, wallet, latest.pool.pair, latest.lpBalance)
        : await removeLiquidity(provider, wallet, latest.lpBalance, minimumAfterSlippage(estimatedUCurr), minimumAfterSlippage(estimatedUSDC));
      setTxHash(transaction.hash);
      setMessage("Waiting for your Sepolia transaction to confirm…");
      await transaction.wait();
      await refresh();
      setMessage(needsApproval ? "Pool position approved. Click again to remove your liquidity." : "Your liquidity has been returned to this wallet.");
    } catch (error) { setMessage(swapError(error)); }
    finally { setBusy(false); }
  }

  return <section className="setup-done pool-setup">
    <div className="setup-stage-head"><span className="setup-step">3</span><div><h2>Start real Sepolia swaps</h2><p>Add uCURR and test USDC to a Uniswap v2 pool. Each approval and the final deposit need your MetaMask confirmation.</p></div></div>
    {loading && <p>Checking pool and wallet balances…</p>}
    {data && <>
      <div className="setup-contract"><span>Pool status</span><strong>{live ? "Live" : "Not funded yet"}</strong></div>
      {data.pool.pair && <div className="setup-contract"><span>Pool contract</span><a href={`https://sepolia.etherscan.io/address/${data.pool.pair}`} target="_blank" rel="noopener noreferrer">View on Etherscan ↗</a></div>}
      {live ? <><p>Pool reserves: {displayTokenAmount(data.pool.reserveUCurr, "uCURR")} uCURR and {displayTokenAmount(data.pool.reserveUSDC, "USDC")} test USDC. The Swap tab now uses live quotes.</p>
        {data.lpBalance > 0n && <details className="pool-withdraw"><summary>Manage my pool position</summary><p>Your share is approximately {displayTokenAmount(withdrawUCurr, "uCURR")} uCURR and {displayTokenAmount(withdrawUSDC, "USDC")} test USDC. Removing it may leave the pool without enough tokens for swaps.</p><button className="outline-button" onClick={withdraw} disabled={busy || smartAccount}>{busy ? "Waiting for MetaMask…" : data.lpAllowance < data.lpBalance ? "Authorize pool position" : "Remove all my liquidity"}</button></details>}
      </> : <>
        <div className="pool-deposit-grid">
          <label className="setup-amount">uCURR to add<input type="number" min="0" step="0.01" value={ucurrInput} onChange={(event) => setUCurrInput(event.target.value)} disabled={busy} /><small>In your wallet: {displayTokenAmount(data.ucurrBalance, "uCURR")} uCURR</small></label>
          <label className="setup-amount">Test USDC to add<input type="number" min="0" step="0.01" value={usdcInput} onChange={(event) => setUsdcInput(event.target.value)} disabled={busy} /><small>In your wallet: {displayTokenAmount(data.usdcBalance, "USDC")} USDC</small></label>
        </div>
        {!amountError && Number.isFinite(impliedRate) && <p>Starting rate: 1 test USDC = {impliedRate.toLocaleString("en-US", { maximumFractionDigits: 6 })} uCURR. You will receive the pool position in this wallet.</p>}
        {(amountError || insufficientUCurr || insufficientUSDC) && <p className="setup-error">{amountError || (insufficientUCurr ? "Not enough uCURR. Mint more above or enter a smaller deposit." : "Not enough test USDC. Enter a smaller deposit.")}</p>}
        <button className="primary-button" disabled={!nextStep || busy || loading || smartAccount} onClick={proceed}>
          {busy ? "Waiting for MetaMask…" : nextStep === "approve-u" ? "1. Authorize uCURR spending" : nextStep === "approve-c" ? "2. Authorize USDC spending" : "3. Create pool and add liquidity"}
        </button>
        <p className="transaction-note">The starting amounts are editable. Keep some uCURR and test USDC in your wallet to try both swap directions. A small pool can move in price quickly.</p>
      </>}
      <button className="text-button" disabled={busy || loading} onClick={refresh}>Refresh pool status</button>
    </>}
    {message && <p className="pool-message" role="status">{message}</p>}
    {txHash && <p className="setup-tx">Transaction: <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer">View on Etherscan ↗</a></p>}
  </section>;
}
