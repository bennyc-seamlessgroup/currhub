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
type PoolAction = "add" | "remove" | "reset";
type ActionFeedback = { text: string; txHash?: string; error?: boolean };

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
  const [activeAction, setActiveAction] = useState<PoolAction>("add");
  const [feedback, setFeedback] = useState<Partial<Record<PoolAction | "status", ActionFeedback>>>({});

  function report(action: PoolAction | "status", text: string, error = false, txHash?: string) {
    setFeedback((current) => ({ ...current, [action]: { text, error, txHash: txHash || current[action]?.txHash } }));
  }
  function clear(action: PoolAction | "status") {
    setFeedback((current) => ({ ...current, [action]: undefined }));
  }
  function note(action: PoolAction | "status") {
    const item = feedback[action];
    return item && <><p className={item.error ? "setup-error" : "pool-message"} role={item.error ? "alert" : "status"}>{item.text}</p>{item.txHash && <p className="setup-tx">Transaction: <a href={`https://sepolia.etherscan.io/tx/${item.txHash}`} target="_blank" rel="noopener noreferrer">View on Etherscan ↗</a></p>}</>;
  }

  useEffect(() => {
    if (!provider || !wallet) { setData(null); setLoading(false); return; }
    let active = true;
    setData(null);
    setLoading(true);
    clear("status");
    loadPoolData(provider, wallet)
      .then((result) => { if (active) setData(result); })
      .catch((error) => { if (active) report("status", swapError(error), true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [provider, wallet, refreshKey]);

  async function refresh() {
    if (!provider || !wallet) return;
    setLoading(true);
    clear("status");
    try { setData(await loadPoolData(provider, wallet)); }
    catch (error) { report("status", swapError(error), true); }
    finally { setLoading(false); }
  }

  const live = Boolean(data && data.pool.reserveUCurr > 0n && data.pool.reserveUSDC > 0n);
  const lowLiquidity = Boolean(live && data && (data.pool.reserveUCurr < 10n ** 18n || data.pool.reserveUSDC < 10n ** 6n));
  const resetPlan = assessPoolReset(data?.reset || null);
  const resetPending = resetPlan.stage === "transfer" || resetPlan.stage === "sync";
  const resetBlocksDeposit = lowLiquidity && resetPlan.stage !== "complete";
  useEffect(() => {
    if (lowLiquidity && resetPending) setActiveAction("reset");
  }, [lowLiquidity, resetPending]);
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
    clear("add");
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
      report("add", "Waiting for Sepolia confirmation…", false, transaction.hash);
      await transaction.wait();
      await refresh();
      report("add", nextStep === "create" ? "Liquidity added to the uCURR/USDC pool." : nextStep === "approve-u" ? "Step 1 complete. Step 2, approve test USDC, is ready below." : "Step 2 complete. Step 3, add liquidity, is ready below.");
    } catch (error) { report("add", swapError(error), true); }
    finally { setBusy(false); }
  }

  async function withdraw() {
    if (!provider || !wallet || !data?.pool.pair || data.lpBalance <= 0n || busy || smartAccount) return;
    setBusy(true);
    clear("remove");
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
      report("remove", "Waiting for Sepolia confirmation…", false, transaction.hash);
      await transaction.wait();
      await refresh();
      report("remove", needsApproval ? "Step 1 complete. Step 2, remove liquidity, is ready below." : "Your liquidity has been returned to this wallet.");
    } catch (error) { report("remove", swapError(error), true); }
    finally { setBusy(false); }
  }

  async function resetRatio() {
    if (!provider || !wallet || !data?.reset?.pair || !resetPending || busy || smartAccount) return;
    setBusy(true);
    clear("reset");
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
      report("reset", "Waiting for Sepolia confirmation…", false, transaction.hash);
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
      report("reset", latestPlan.stage === "transfer"
        ? "The small uCURR transfer is confirmed. Update the pool price with the next button."
        : "Pool ratio updated to 10 uCURR per 1 test USDC. You can add liquidity below.");
    } catch (error) { report("reset", swapError(error), true); }
    finally { setBusy(false); }
  }

  const approvedUCurr = Boolean(data && !amountError && ucurrAmount > 0n && data.ucurrAllowance >= ucurrAmount);
  const approvedUSDC = Boolean(data && !amountError && usdcAmount > 0n && data.usdcAllowance >= usdcAmount);

  return <section className="setup-done pool-setup">
    <div className="setup-stage-head"><span className="setup-step">4</span><div><h2>Manage swap liquidity</h2><p>Choose what you want to do with the uCURR and test USDC pool.</p></div></div>
    {loading && <p>Checking pool and wallet balances…</p>}
    {data && <>
      <div className="setup-contract"><span>Pool status</span><strong>{lowLiquidity ? "Very low liquidity" : live ? "Funded" : "Not funded yet"}</strong></div>
      {data.pool.pair && <div className="setup-contract"><span>Pool contract</span><a href={"https://sepolia.etherscan.io/address/" + data.pool.pair} target="_blank" rel="noopener noreferrer">View on Etherscan ↗</a></div>}
      {live && <p>Pool holds {displayTokenAmount(data.pool.reserveUCurr, "uCURR", 12)} uCURR and {displayTokenAmount(data.pool.reserveUSDC, "USDC")} test USDC. {currentRate !== null && Number.isFinite(currentRate) && <>1 uCURR ≈ {currentRate.toLocaleString("en-US", { maximumFractionDigits: 6 })} test USDC.</>}</p>}
      <div className="pool-action-tabs" aria-label="Liquidity actions">
        <button type="button" aria-pressed={activeAction === "add"} className={activeAction === "add" ? "active" : ""} onClick={() => setActiveAction("add")}>＋ Add liquidity</button>
        <button type="button" aria-pressed={activeAction === "remove"} className={activeAction === "remove" ? "active" : ""} onClick={() => setActiveAction("remove")}>↙ Remove liquidity</button>
        <button type="button" aria-pressed={activeAction === "reset"} className={activeAction === "reset" ? "active" : ""} onClick={() => setActiveAction("reset")}>↺ Reset ratio</button>
      </div>
      {activeAction === "add" && <div className="pool-action-panel">
        <h3>Add liquidity</h3>
        {resetBlocksDeposit && <p className="setup-error">The remaining pool ratio needs attention before adding liquidity. Open Reset ratio above to review the next step.</p>}
        <div className="pool-deposit-grid">
          <label className="setup-amount">uCURR to add<input type="number" min="0" step="0.01" value={ucurrInput} onChange={(event) => setUCurrInput(event.target.value)} disabled={busy} /><small>In your wallet: {displayTokenAmount(data.ucurrBalance, "uCURR")} uCURR</small></label>
          <label className="setup-amount">Test USDC to add<input type={live ? "text" : "number"} min={live ? undefined : "0"} step={live ? undefined : "0.01"} value={live ? amountError ? "—" : displayTokenAmount(usdcAmount, "USDC") : usdcInput} onChange={(event) => setUsdcInput(event.target.value)} disabled={busy || live} /><small>{live ? "Set by the current pool ratio · " : ""}In your wallet: {displayTokenAmount(data.usdcBalance, "USDC")} USDC</small></label>
        </div>
        {!live && !amountError && Number.isFinite(impliedRate) && <p>Starting rate: 1 test USDC = {impliedRate.toLocaleString("en-US", { maximumFractionDigits: 6 })} uCURR.</p>}
        {(amountError || insufficientUCurr || insufficientUSDC) && <p className="setup-error">{amountError || (insufficientUCurr ? "Not enough uCURR. Mint more above or enter a smaller deposit." : "Not enough test USDC. Enter a smaller deposit.")}</p>}
        <div className="pool-step-list">
          <div className={nextStep === "approve-u" ? "pool-step current" : "pool-step"}>
            <span>1</span><div><strong>Approve uCURR</strong><small>{approvedUCurr ? "Approved for this amount" : "Confirm token spending in MetaMask"}</small></div>
            <button className="outline-button" disabled={nextStep !== "approve-u" || busy || loading || smartAccount || resetBlocksDeposit} onClick={proceed}>{approvedUCurr ? "✓ Approved" : busy && nextStep === "approve-u" ? "Waiting…" : "Approve uCURR"}</button>
          </div>
          <div className={nextStep === "approve-c" ? "pool-step current" : "pool-step"}>
            <span>2</span><div><strong>Approve test USDC</strong><small>{approvedUSDC ? "Approved for this amount" : "Confirm token spending in MetaMask"}</small></div>
            <button className="outline-button" disabled={nextStep !== "approve-c" || busy || loading || smartAccount || resetBlocksDeposit} onClick={proceed}>{approvedUSDC ? "✓ Approved" : busy && nextStep === "approve-c" ? "Waiting…" : "Approve USDC"}</button>
          </div>
          <div className={nextStep === "create" ? "pool-step current" : "pool-step"}>
            <span>3</span><div><strong>{live ? "Add to pool" : "Create pool"}</strong><small>Review both amounts and confirm in MetaMask</small></div>
            <button className="primary-button" disabled={nextStep !== "create" || busy || loading || smartAccount || resetBlocksDeposit} onClick={proceed}>{busy && nextStep === "create" ? "Waiting…" : live ? "Add liquidity" : "Create pool"}</button>
          </div>
        </div>
        <p className="transaction-note">Adding liquidity follows the current pool ratio. Swaps can change the price at any time.</p>
        {note("add")}
      </div>}
      {activeAction === "remove" && <div className="pool-action-panel">
        <h3>Remove liquidity</h3>
        {data.lpBalance <= 0n ? <p>This wallet has no removable pool position. The pool can still exist because its minimum liquidity is permanently locked.</p> : <>
          <p>Your position represents about {displayTokenAmount(withdrawUCurr, "uCURR")} uCURR and {displayTokenAmount(withdrawUSDC, "USDC")} test USDC.</p>
          <div className="pool-step-list">
            <div className={data.lpAllowance < data.lpBalance ? "pool-step current" : "pool-step"}><span>1</span><div><strong>Authorize pool position</strong><small>{data.lpAllowance >= data.lpBalance ? "Authorized" : "Confirm in MetaMask"}</small></div><button className="outline-button" disabled={busy || smartAccount || data.lpAllowance >= data.lpBalance} onClick={withdraw}>{data.lpAllowance >= data.lpBalance ? "✓ Authorized" : "Authorize"}</button></div>
            <div className={data.lpAllowance >= data.lpBalance ? "pool-step current" : "pool-step"}><span>2</span><div><strong>Remove all my liquidity</strong><small>Tokens return to this wallet</small></div><button className="primary-button" disabled={busy || smartAccount || data.lpAllowance < data.lpBalance} onClick={withdraw}>{busy && data.lpAllowance >= data.lpBalance ? "Waiting…" : "Remove liquidity"}</button></div>
          </div>
        </>}
        {note("remove")}
      </div>}
      {activeAction === "reset" && <div className="pool-action-panel">
        <h3>Reset to 10 uCURR = 1 test USDC</h3>
        {resetPlan.stage === "transfer" && <p>Only locked minimum liquidity remains. A small transfer of exactly {formatUnits(resetPlan.donation, 18)} uCURR will set up the new ratio. It stays in the pool.</p>}
        {resetPlan.stage === "sync" && <p>The uCURR transfer is confirmed. One more transaction will update the pool ratio.</p>}
        {resetPlan.stage === "complete" && <p className="admin-ready">The current pool ratio is 10 uCURR per 1 test USDC. You can add liquidity in the Add tab.</p>}
        {resetPlan.stage === "unavailable" && <p>{resetPlan.reason}</p>}
        <div className="pool-step-list">
          <div className={resetPlan.stage === "transfer" ? "pool-step current" : "pool-step"}><span>1</span><div><strong>Send small uCURR amount</strong><small>Confirm transfer in MetaMask</small></div><button className="outline-button" disabled={busy || loading || smartAccount || resetPlan.stage !== "transfer"} onClick={resetRatio}>{resetPlan.stage === "sync" || resetPlan.stage === "complete" ? "✓ Sent" : "Send uCURR"}</button></div>
          <div className={resetPlan.stage === "sync" ? "pool-step current" : "pool-step"}><span>2</span><div><strong>Update pool price</strong><small>Confirm pool update in MetaMask</small></div><button className="primary-button" disabled={busy || loading || smartAccount || resetPlan.stage !== "sync"} onClick={resetRatio}>{resetPlan.stage === "complete" ? "✓ Updated" : "Update price"}</button></div>
        </div>
        {resetPending && <p className="transaction-note">The pool is public. Complete both steps promptly and recheck balances if interrupted.</p>}
        {note("reset")}
      </div>}
      <button className="text-button" disabled={busy || loading} onClick={refresh}>Refresh pool status</button>
    </>}
    {note("status")}
  </section>;
}
