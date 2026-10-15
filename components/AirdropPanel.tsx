"use client";

import { useCallback, useEffect, useState } from "react";
import { BrowserProvider, Contract, formatUnits } from "ethers";
import { airdropRequest, signInForAirdrop } from "@/lib/airdrop-client";
import type { InjectedEthereum } from "@/lib/tcurr";

type Campaign = { id: string; title: string; status: string; snapshotAt: string | null; snapshotBlock: number | null; deadline: string; shares: string; amountWei: string; claimed: boolean; paused: boolean; onchainId: number | null; proof: string[] };
type Profile = { full_name: string; email: string; company: string; role: string; country: string; relationship: string; marketing_opt_in: boolean };
type Status = { configured: boolean; contractAddress?: string | null; profile: Profile | null; campaigns: Campaign[] };
const CLAIM_ABI = ["function claim(uint256 id,uint256 amount,bytes32[] proof)"];

function amount(wei: string) {
  return Number(formatUnits(BigInt(wei), 18)).toLocaleString("en-US", { maximumFractionDigits: 3 });
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
  const [company, setCompany] = useState("");
  const [role, setRole] = useState("");
  const [country, setCountry] = useState("");
  const [relationship, setRelationship] = useState("Individual holder");
  const [consent, setConsent] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) { setStatus(null); setSignedIn(false); return; }
    setLoading(true); setError("");
    try {
      const session = await airdropRequest("/api/airdrop/auth");
      if (!session.configured) { setStatus({ configured: false, campaigns: [], profile: null }); setSignedIn(false); return; }
      if (typeof session.address !== "string" || session.address.toLowerCase() !== address.toLowerCase()) { setSignedIn(false); setStatus(null); return; }
      setSignedIn(true);
      setStatus(await airdropRequest("/api/airdrop/status") as Status);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not check rewards."); }
    finally { setLoading(false); }
  }, [address]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { setEditingProfile(false); setFullName(""); setEmail(""); setCompany(""); setRole(""); setCountry(""); setConsent(false); setMarketingOptIn(false); }, [address]);

  async function signIn() {
    if (!provider || !address) return;
    setBusy(true); setError("");
    try { await signInForAirdrop(provider, address); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not sign in."); }
    finally { setBusy(false); }
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError("");
    try {
      await airdropRequest("/api/airdrop/status", { fullName, email, company, role, country, relationship, consent, marketingOptIn });
      await refresh();
      setEditingProfile(false);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save your profile."); }
    finally { setBusy(false); }
  }

  async function claim(campaign: Campaign) {
    if (!provider || !status?.contractAddress || !campaign.onchainId || !status.profile) return;
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

  const hasReward = status?.campaigns.some((campaign) => BigInt(campaign.amountWei) > 0n) || false;

  return <div className="feature-layout"><section className="feature-card airdrop-card">
    <h2>Your uCURR rewards</h2>
    {!address && <><p>Connect your Ethereum wallet to see your rewards.</p><button className="primary-button full-button" onClick={onConnect}>Connect wallet →</button></>}
    {solanaConnected && <p>uCURR rewards are currently available to Ethereum wallets.</p>}
    {address && <div className="airdrop-holding"><span>Your current tCURR balance</span><strong>{currentTCurr === null ? "Reading…" : `${currentTCurr} tCURR`}</strong></div>}
    {address && status && !status.configured && <p>No reward round is open yet.</p>}
    {address && !status && !signedIn && !loading && <><p>Sign a wallet message to check your rewards. This has no network fee.</p><button className="primary-button full-button" disabled={busy} onClick={signIn}>{busy ? "Waiting for wallet…" : "Check rewards →"}</button></>}
    {loading && <p>Checking rewards…</p>}
    {address && status?.configured && signedIn && <>
      {status.campaigns.length === 0 && <p>No reward round is available yet.</p>}
      {status.campaigns.map((campaign) => <div className="airdrop-round" key={campaign.id}>
        <div className="airdrop-round-head"><strong>{campaign.title}</strong><span>{campaign.snapshotAt ? new Date(campaign.snapshotAt).toLocaleString() : "Reward round"}</span></div>
        {campaign.status === "scheduled" ? <p>Holdings will be recorded at the scheduled time. Check back for your reward.</p>
          : campaign.status === "failed" ? <p>This round is unavailable.</p>
          : BigInt(campaign.amountWei) === 0n ? <p>No reward is available to this wallet in this round.</p>
          : <><p><strong>{amount(campaign.amountWei)} uCURR {campaign.claimed ? "claimed" : campaign.status === "published" ? "available" : "calculated for you"}</strong></p>
            {campaign.status === "needs_budget" && <p>This round is being prepared.</p>}
            {campaign.status === "prepared" && <p>Claims will open soon.</p>}
            {campaign.status === "published" && !campaign.claimed && <button className="primary-button full-button" disabled={busy || !status.profile || campaign.paused || Date.now() > new Date(campaign.deadline).valueOf()} onClick={() => claim(campaign)}>{campaign.paused ? "Claims paused" : Date.now() > new Date(campaign.deadline).valueOf() ? "Claim period ended" : !status.profile ? "Complete your profile to claim" : busy ? "Waiting for MetaMask…" : "Claim uCURR →"}</button>}
          </>}
      </div>)}
      {hasReward && (!status.profile || editingProfile) && <form className="airdrop-identity-form" onSubmit={saveProfile}><h3>Stakeholder profile</h3><p>Tell us who you are before claiming your reward.</p>
        <label>Full name<input required maxLength={100} value={fullName} onChange={(event) => setFullName(event.target.value)} /></label>
        <label>Email<input required type="email" maxLength={200} value={email} onChange={(event) => setEmail(event.target.value)} /></label>
        <label>Company (optional)<input maxLength={120} value={company} onChange={(event) => setCompany(event.target.value)} /></label>
        <label>Role (optional)<input maxLength={100} value={role} onChange={(event) => setRole(event.target.value)} /></label>
        <label>Country<input required maxLength={80} value={country} onChange={(event) => setCountry(event.target.value)} /></label>
        <label>Connection to CURR<select value={relationship} onChange={(event) => setRelationship(event.target.value)}><option>Individual holder</option><option>Company representative</option><option>Other</option></select></label>
        <label className="airdrop-check"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> I agree to CURR Hub storing this profile with my wallet address to manage rewards and understand its stakeholders.</label>
        <label className="airdrop-check"><input type="checkbox" checked={marketingOptIn} onChange={(event) => setMarketingOptIn(event.target.checked)} /> Send me optional CURR news and updates by email.</label>
        <button className="outline-button" disabled={busy || !consent}>Save profile</button>
      </form>}
      {status.profile && !editingProfile && <p className="airdrop-review-status">Profile saved for {status.profile.full_name}. You can claim any open reward above. <button className="text-button" onClick={() => { setFullName(status.profile!.full_name); setEmail(status.profile!.email); setCompany(status.profile!.company); setRole(status.profile!.role); setCountry(status.profile!.country); setRelationship(status.profile!.relationship); setMarketingOptIn(status.profile!.marketing_opt_in); setConsent(true); setEditingProfile(true); }}>Edit profile</button></p>}
    </>}
    {error && <p className="swap-message" role="alert">{error}</p>}
  </section><aside className="feature-aside"><div className="aside-icon">✦</div><h3>How rewards work</h3><p>Your reward is calculated from the tCURR held in your wallet at the round&apos;s snapshot time. Once claims open, connect the same wallet to receive uCURR.</p></aside></div>;
}
