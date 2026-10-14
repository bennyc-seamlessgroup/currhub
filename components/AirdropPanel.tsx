"use client";

import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract, formatUnits } from "ethers";
import { airdropRequest, signInForAirdrop } from "@/lib/airdrop-client";
import type { InjectedEthereum } from "@/lib/tcurr";

type Campaign = { id: string; title: string; status: "draft" | "prepared" | "published"; snapshotBlock: number; deadline: string; shares: string; amountWei: string; claimed: boolean; paused: boolean; onchainId: number | null; proof: string[]; txHash: string | null };
type Status = { configured: boolean; contractAddress?: string | null; identityStatus: string; campaigns: Campaign[] };
const CLAIM_ABI = ["function claim(uint256 id,uint256 amount,bytes32[] proof)"];

function amount(wei: string) {
  const [whole, decimals = ""] = formatUnits(BigInt(wei), 18).split(".");
  const fraction = decimals.slice(0, 3).replace(/0+$/, "");
  return `${BigInt(whole).toLocaleString("en-US")}${fraction ? `.${fraction}` : ""}`;
}

export default function AirdropPanel({ provider, address, solanaConnected, onConnect, currentTCurr, onClaim }: {
  provider: InjectedEthereum | null;
  address: string;
  solanaConnected: boolean;
  onConnect: () => void;
  currentTCurr: string | null;
  onClaim: () => Promise<void>;
}) {
  const [status, setStatus] = useState<Status | null>(null);
  const [signedIn, setSignedIn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [country, setCountry] = useState("");
  const [consent, setConsent] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) { setStatus(null); setSignedIn(false); return; }
    setLoading(true);
    setError("");
    try {
      const session = await airdropRequest("/api/airdrop/auth");
      if (!session.configured) { setStatus({ configured: false, campaigns: [], identityStatus: "none" }); setSignedIn(false); return; }
      if (typeof session.address !== "string" || session.address.toLowerCase() !== address.toLowerCase()) { setSignedIn(false); setStatus(null); return; }
      setSignedIn(true);
      setStatus(await airdropRequest("/api/airdrop/status") as Status);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not check airdrops."); }
    finally { setLoading(false); }
  }, [address]);

  useEffect(() => { void refresh(); }, [refresh]);

  async function signIn() {
    if (!provider || !address) return;
    setBusy(true); setError("");
    try { await signInForAirdrop(provider, address); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign in."); }
    finally { setBusy(false); }
  }

  async function submitIdentity(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await airdropRequest("/api/airdrop/status", { fullName, email, country, consent });
      setFullName(""); setEmail(""); setCountry(""); setConsent(false);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not submit review."); }
    finally { setBusy(false); }
  }

  async function claim(campaign: Campaign) {
    if (!provider || !status?.contractAddress || !campaign.onchainId) return;
    setBusy(true); setError("");
    try {
      const chainId = await provider.request({ method: "eth_chainId" });
      if (chainId !== "0xaa36a7") throw new Error("Select Ethereum Sepolia in your wallet.");
      const signer = await new BrowserProvider(provider).getSigner(address);
      const contract = new Contract(status.contractAddress, CLAIM_ABI, signer);
      const transaction = await contract.claim(campaign.onchainId, BigInt(campaign.amountWei), campaign.proof);
      const receipt = await transaction.wait();
      if (receipt?.status !== 1) throw new Error("Claim was not confirmed. Check MetaMask transaction history.");
      await Promise.all([refresh(), onClaim()]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Claim did not complete."); }
    finally { setBusy(false); }
  }

  const hasHolding = status?.campaigns.some((campaign) => BigInt(campaign.shares) > 0n) || false;

  return <div className="feature-layout"><section className="feature-card airdrop-card">
    <h2>Check your rewards</h2>
    {!address && <><p>Connect your Ethereum wallet to see whether uCURR rewards are available.</p><button className="primary-button full-button" onClick={onConnect}>Connect wallet →</button></>}
    {solanaConnected && <p>uCURR airdrops are currently on Ethereum Sepolia. Switch to your Ethereum wallet to check rewards.</p>}
    {address && <div className="airdrop-holding"><span>Your current tCURR balance</span><strong>{currentTCurr === null ? "Reading…" : `${currentTCurr} tCURR`}</strong></div>}
    {address && status && !status.configured && <p>No airdrop is open yet. Please check back later.</p>}
    {address && !status && !signedIn && !loading && <><p>Sign a wallet message to check your eligibility. This has no network fee.</p><button className="primary-button full-button" disabled={busy} onClick={signIn}>{busy ? "Waiting for wallet…" : "Check eligibility →"}</button></>}
    {loading && <p>Checking airdrops…</p>}
    {address && status?.configured && signedIn && <>
      {status.campaigns.length === 0 && <p>No airdrop is available yet.</p>}
      {status.campaigns.map((campaign) => <div className="airdrop-round" key={campaign.id}>
        <div className="airdrop-round-head"><strong>{campaign.title}</strong><span>Snapshot block {campaign.snapshotBlock.toLocaleString("en-US")}</span></div>
        {BigInt(campaign.shares) === 0n ? <p>This wallet was not in this round&apos;s tCURR snapshot.</p>
          : campaign.status === "draft" ? <p>Your snapshot has {campaign.shares} tCURR. Rewards will be shown after this round is approved.</p>
          : campaign.status === "prepared" ? <p>This round is being prepared. Check back for the published reward amount.</p>
          : BigInt(campaign.amountWei) === 0n ? <p>No reward was allocated to this wallet in this round.</p>
          : campaign.claimed ? <p><strong>{amount(campaign.amountWei)} uCURR claimed</strong></p>
          : <><p><strong>{amount(campaign.amountWei)} uCURR available</strong></p><button className="primary-button full-button" disabled={busy || campaign.paused || Date.now() > new Date(campaign.deadline).valueOf()} onClick={() => claim(campaign)}>{campaign.paused ? "Claims paused" : Date.now() > new Date(campaign.deadline).valueOf() ? "Claim period ended" : busy ? "Waiting for MetaMask…" : "Claim uCURR →"}</button></>}
      </div>)}
      {hasHolding && status.identityStatus === "none" && <form className="airdrop-identity-form" onSubmit={submitIdentity}><h3>Identity review for rewards</h3><p>This test review is checked by an admin. It is not formal identity verification.</p><label>Full name<input required maxLength={100} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label><label>Email (optional)<input type="email" maxLength={200} value={email} onChange={(event) => setEmail(event.target.value)} /></label><label>Country code<input required maxLength={2} placeholder="HK" value={country} onChange={(event) => setCountry(event.target.value.toUpperCase())} /></label><label className="airdrop-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> I confirm this information is mine and agree to its use for this test airdrop review.</label><button className="outline-button" disabled={busy || !consent}>Submit for review</button></form>}
      {hasHolding && status.identityStatus === "submitted" && <p className="airdrop-review-status">Identity review submitted. The admin will review it before rewards can be published.</p>}
      {hasHolding && status.identityStatus === "rejected" && <p className="airdrop-review-status">Your identity review needs attention. Please contact the CURR Hub administrator.</p>}
      {hasHolding && status.identityStatus === "approved" && <p className="airdrop-review-status">Identity review approved for this test.</p>}
    </>}
    {error && <p className="swap-message" role="alert">{error}</p>}
  </section><aside className="feature-aside"><div className="aside-icon">✦</div><h3>How it works</h3><p>We record tCURR holdings at one fixed block. Once a reward round opens, eligible wallets can claim uCURR directly into MetaMask.</p></aside></div>;
}
