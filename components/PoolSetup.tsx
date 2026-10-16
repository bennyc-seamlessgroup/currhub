"use client";

import { useEffect, useState } from "react";
import { formatUnits } from "ethers";
import { readTokenOwner, UCURR_SEPOLIA_ADDRESS, type InjectedEthereum } from "@/lib/tcurr";
import {
  approveForSwap, approveLiquidityWithdrawal, assessPoolReset, createSwapPool, displayTokenAmount,
  minimumAfterSlippage, parseTokenAmount, readLiquidityPosition, readPool,
  readPoolResetState, readSwapAllowance, readSwapBalance, removeLiquidity,
  samePoolResetState, swapError, syncPoolReset, transferPoolResetUCurr,
  type PoolResetState, type PoolState,
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
  reset: PoolResetState | null;
};

async function loadPoolData(provider: InjectedEthereum, wallet: string): Promise<PoolData> {
  const [pool, reset, ucurrBalance, usdcBalance, ucurrAllowance, usdcAllowance] = await Promise.all([
    readPool(provider),
    readPoolResetState(provider),
    readSwapBalance(provider, wallet, "uCURR"),
    readSwapBalance(provider, wallet, "USDC"),
    readSwapAllowance(provider, wallet, "uCURR"),
    readSwapAllowance(provider, wallet, "USDC"),
  ]);
  const currentPool = reset || pool;
  const position = currentPool.pair
    ? await readLiquidityPosition(provider, wallet, currentPool.pair)
    : { balance: 0n, totalSupply: 0n, allowance: 0n };
  return {
    pool: currentPool, reset, ucurrBalance, usdcBalance, ucurrAllowance, usdcAllowance,
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

  const live = Boolean(data && data.pool.reserveUCurr > 0n && data.pool.reserveUSDC > 0n);
  const lowLiquidity = Boolean(live && data && (data.pool.reserveUCurr < 10n ** 18n || data.pool.reserveUSDC < 10n ** 6n));
  const resetPlan = assessPoolReset(data?.reset || null);
  const resetPending = resetPlan.stage === "transfer" || resetPlan.stage === "sync";
  const resetBlocksDeposit = lowLiquidity && resetPlan.stage !== "complete";
  const currentRate = live && data
    ? Number(formatUnits(data.pool.reserveUSDC, 6)) / Number(formatUnits(data.pool.reserveUCurr, 18))
    : null;
  let ucurrAmount = 0n;
  let usdcAmount = 0n;
  let amountError = "";
  try {
    ucurrAmount = parseTokenAmount(ucurrInput, "uCURR");
    // An existing pair fixes the deposit ratio. Round up to a USDC base unit;
    // the router applies the exact reserve ratio when the transaction executes.
    usdcAmount = live && data
      ? (ucurrAmount * data.pool.reserveUSDC + data.pool.reserveUCurr - 1n) / data.pool.reserveUCurr
      : parseTokenAmount(usdcInput, "USDC");
    if (usdcAmount <= 0n) throw new Error("Choose a larger uCURR amount for this pool.");
  } catch (error) { amountError = swapError(error); }

  const insufficientUCurr = Boolean(data && ucurrAmount > data.ucurrBalance);
  const insufficientUSDC = Boolean(data && usdcAmount > data.usdcBalance);
  const nextStep = data && !amountError && !insufficientUCurr && !insufficientUSDC
    ? data.ucurrAllowance < ucurrAmount ? "approve-u" : data.usdcAllowance < usdcAmount ? "approve-c" : "create"
    : "";
  const impliedRate = Number(usdcInput) > 0 ? Number(ucurrInput) / Number(usdcInput) : 0;
  const withdrawUCurr = data && data.lpSupply > 0n ? data.pool.reserveUCurr * data.lpBalance / data.lpSupply : 0n;
  const withdrawUSDC = data && data.lpSupply > 0n ? data.pool.reserveUSDC * data.lpBalance / data.lpSupply : 0n;

  async function proceed() {
    if (!provider || !wallet || !data || !nextStep || busy || smartAccount || resetBlocksDeposit) return;
    setBusy(true);
    setMessage("");
    setTxHash("");
    try {
      if (nextStep === "create") {
        const latest = await loadPoolData(provider, wallet);
        if (latest.pool.reserveUCurr !== data.pool.reserveUCurr || latest.pool.reserveUSDC !== data.pool.reserveUSDC) {
          setData(latest);
          throw new Error("The pool balance changed. Review the updated deposit amounts before continuing.");
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
      setMessage(nextStep === "create" ? "Liquidity added to the uCURR/USDC pool." : "Token spending approved. Continue to the next step.");
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

  async function resetRatio() {
    if (!provider || !wallet || !data?.reset?.pair || !resetPending || busy || smartAccount) return;
    setBusy(true);
    setMessage("");
    setTxHash("");
    try {
      const owner = await readTokenOwner(provider, UCURR_SEPOLIA_ADDRESS);
      if (owner.toLowerCase() !== wallet.toLowerCase()) throw new Error("Connect the uCURR owner wallet to reset the pool ratio.");
      const latest = await readPoolResetState(provider);
      if (!latest || !samePoolResetState(data.reset, latest)) {
        await refresh();
        throw new Error("The pool changed. Review the updated balances before continuing.");
      }
      const latestPlan = assessPoolReset(latest);
      if (latestPlan.stage !== resetPlan.stage || latestPlan.donation !== resetPlan.donation) {
        await refresh();
        throw new Error("The reset amount changed. Review the updated pool before continuing.");
      }
      if (latestPlan.stage === "transfer" && await readSwapBalance(provider, wallet, "uCURR") < latestPlan.donation) {
        throw new Error("This wallet does not have enough uCURR for the reset.");
      }
      const transaction = latestPlan.stage === "transfer"
        ? await transferPoolResetUCurr(provider, wallet, latest.pair!, latestPlan.donation)
        : await syncPoolReset(provider, wallet, latest.pair!);
      setTxHash(transaction.hash);
      setMessage("Waiting for your Sepolia transaction to confirm…");
      await transaction.wait();
      const updated = await loadPoolData(provider, wallet);
      setData(updated);
      const updatedPlan = assessPoolReset(updated.reset);
      if (latestPlan.stage === "transfer" && updatedPlan.stage !== "sync") {
        throw new Error("The transfer confirmed, but the pool changed. Stop here and review the live balances.");
      }
      if (latestPlan.stage === "sync" && updatedPlan.stage !== "complete") {
        throw new Error("The pool update confirmed, but the target ratio was not verified. Review the live balances.");
      }
      setMessage(latestPlan.stage === "transfer"
        ? "The small uCURR transfer is confirmed. Update the pool price with the next button."
        : "Pool ratio updated to 10 uCURR per 1 test USDC. You can add liquidity below.");
    } catch (error) { setMessage(swapError(error)); }
    finally { setBusy(false); }
  }

  return <section className="setup-done pool-setup">
    <div className="setup-stage-head"><span className="setup-step">4</span><div><h2>Manage swap liquidity</h2><p>Add uCURR and test USDC to the Uniswap v2 pool. Each approval and deposit needs your MetaMask confirmation.</p></div></div>
    {loading && <p>Checking pool and wallet balances…</p>}
    {data && <>
      <div className="setup-contract"><span>Pool status</span><strong>{lowLiquidity ? "Very low liquidity" : live ? "Funded" : "Not funded yet"}</strong></div>
      {data.pool.pair && <div className="setup-contract"><span>Pool contract</span><a href={`https://sepolia.etherscan.io/address/${data.pool.pair}`} target="_blank" rel="noopener noreferrer">View on Etherscan ↗</a></div>}
      {live && <><p>Pool reserves: {displayTokenAmount(data.pool.reserveUCurr, "uCURR", 12)} uCURR and {displayTokenAmount(data.pool.reserveUSDC, "USDC")} test USDC. New deposits follow this pool&apos;s current ratio.</p>
        {currentRate !== null && Number.isFinite(currentRate) && <p>Current pool rate: 1 uCURR ≈ {currentRate.toLocaleString("en-US", { maximumFractionDigits: 6 })} test USDC.</p>}
        {lowLiquidity && <p className="setup-error">Almost all liquidity has been removed. This remaining ratio may make a new deposit much more expensive than expected. Check the paired USDC amount before approving.</p>}
        {data.lpBalance > 0n && <details className="pool-withdraw"><summary>Manage my pool position</summary><p>Your share is approximately {displayTokenAmount(withdrawUCurr, "uCURR")} uCURR and {displayTokenAmount(withdrawUSDC, "USDC")} test USDC. Removing it may leave the pool without enough tokens for swaps.</p><button className="outline-button" onClick={withdraw} disabled={busy || smartAccount}>{busy ? "Waiting for MetaMask…" : data.lpAllowance < data.lpBalance ? "Authorize pool position" : "Remove all my liquidity"}</button></details>}
      </>}
      {lowLiquidity && <div className="pool-reset">
        <h3>Set the pool to 10 uCURR = 1 test USDC</h3>
        {resetPlan.stage === "transfer" && <><p>The pool holds only locked minimum liquidity. Send exactly {formatUnits(resetPlan.donation, 18)} uCURR to the pool, then update its reserves. This small amount stays in the pool.</p><button className="outline-button" onClick={resetRatio} disabled={busy || loading || smartAccount}>{busy ? "Waiting for MetaMask…" : "1. Send small uCURR amount"}</button></>}
        {resetPlan.stage === "sync" && <><p>The small uCURR transfer is in the pool. Confirm one more transaction to update its displayed ratio before adding liquidity.</p><button className="outline-button" onClick={resetRatio} disabled={busy || loading || smartAccount}>{busy ? "Waiting for MetaMask…" : "2. Update pool price"}</button></>}
        {resetPlan.stage === "complete" && <p>The current pool ratio is 10 uCURR per 1 test USDC. You can add liquidity below.</p>}
        {resetPlan.stage === "unavailable" && <p>{resetPlan.reason}</p>}
        {resetPending && <small>Confirm each step in MetaMask. The pool is public, so recheck the balances if either step is interrupted.</small>}
      </div>}
      <>
        <div className="pool-deposit-grid">
          <label className="setup-amount">uCURR to add<input type="number" min="0" step="0.01" value={ucurrInput} onChange={(event) => setUCurrInput(event.target.value)} disabled={busy} /><small>In your wallet: {displayTokenAmount(data.ucurrBalance, "uCURR")} uCURR</small></label>
          <label className="setup-amount">Test USDC to add<input type={live ? "text" : "number"} min={live ? undefined : "0"} step={live ? undefined : "0.01"} value={live ? amountError ? "—" : displayTokenAmount(usdcAmount, "USDC") : usdcInput} onChange={(event) => setUsdcInput(event.target.value)} disabled={busy || live} /><small>{live ? "Set by the current pool ratio · " : ""}In your wallet: {displayTokenAmount(data.usdcBalance, "USDC")} USDC</small></label>
        </div>
        {!live && !amountError && Number.isFinite(impliedRate) && <p>Starting rate: 1 test USDC = {impliedRate.toLocaleString("en-US", { maximumFractionDigits: 6 })} uCURR. You will receive the pool position in this wallet.</p>}
        {live && <p>You will receive pool position tokens in this wallet. Check the amounts before confirming; the existing pool price may have changed since your last deposit.</p>}
        {(amountError || insufficientUCurr || insufficientUSDC) && <p className="setup-error">{amountError || (insufficientUCurr ? "Not enough uCURR. Mint more above or enter a smaller deposit." : "Not enough test USDC. Enter a smaller deposit.")}</p>}
        <button className="primary-button" disabled={!nextStep || busy || loading || smartAccount || resetBlocksDeposit} onClick={proceed}>
          {busy ? "Waiting for MetaMask…" : nextStep === "approve-u" ? "1. Authorize uCURR spending" : nextStep === "approve-c" ? "2. Authorize USDC spending" : live ? "3. Add liquidity" : "3. Create pool and add liquidity"}
        </button>
        <p className="transaction-note">{resetBlocksDeposit ? "Complete or review the ratio reset above before adding liquidity." : live ? "Adding liquidity follows the current pool ratio. Swaps can change the price at any time." : "The starting amounts are editable. Keep some uCURR and test USDC in your wallet to try both swap directions. A small pool can move in price quickly."}</p>
      </>
      <button className="text-button" disabled={busy || loading} onClick={refresh}>Refresh pool status</button>
    </>}
    {message && <p className="pool-message" role="status">{message}</p>}
    {txHash && <p className="setup-tx">Transaction: <a href={`https://sepolia.etherscan.io/tx/${txHash}`} target="_blank" rel="noopener noreferrer">View on Etherscan ↗</a></p>}
  </section>;
}
