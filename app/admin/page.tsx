"use client";

import { useEffect, useState } from "react";
import { BrowserProvider, Contract, ContractFactory, formatUnits, isAddress } from "ethers";
import { airdropRequest, signInForAirdrop } from "@/lib/airdrop-client";
import { UCURR_SEPOLIA_ADDRESS } from "@/lib/tcurr";
import TokenSetupPanel from "@/components/TokenSetupPanel";
import artifacts from "@/lib/test-contract-artifacts.json";

type Injected = { request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>; on?: (event: string, listener: () => void) => void; removeListener?: (event: string, listener: () => void) => void; isMetaMask?: boolean; providers?: Injected[] };
type Campaign = { id: string; title: string; status: string; snapshot_at: string | null; snapshot_block: number | null; snapshot_cursor_block: number | null; snapshot_error: string | null; ratio_shares: number | null; ratio_reward_wei: string | null; minimum_wei: string | null; maximum_wei: string | null; pool_wei: string; allocated_wei: string; deadline: string; merkle_root: string | null; onchain_id: number | null; publish_tx: string | null };
type Profile = { wallet: string; full_name: string; email: string; company: string; role: string; country: string; relationship: string; marketing_opt_in: boolean; updated_at: string };
type Allocation = { wallet: string; shares: string; amount_wei: string };
type AdminRole = "owner" | "team";
type AdminData = { configured: boolean; role: AdminRole; contractAddress: string | null; campaigns: Campaign[]; profiles: Profile[]; allocations: Allocation[] };
type TeamWallet = { wallet: string; role: AdminRole; label: string; created_at: string };
type WalletData = { recoveryOwners: string[]; wallets: TeamWallet[] };
type Section = "tokens" | "airdrop" | "team";

const claimAbi = ["function reserved() view returns (uint256)", "function owner() view returns (address)", "function createCampaign(bytes32,uint256,uint64) returns (uint256)"];
const rewardAbi = ["function balanceOf(address) view returns (uint256)", "function owner() view returns (address)", "function mint(address,uint256)", "function transfer(address,uint256) returns (bool)"];

function short(value: string) { return `${value.slice(0, 6)}…${value.slice(-4)}`; }
function tokens(wei: string | bigint) { return Number(formatUnits(wei, 18)).toLocaleString("en-US", { maximumFractionDigits: 3 }); }
function errorText(error: unknown) { return error instanceof Error ? error.message : "The action could not be completed."; }
async function ensureSepolia(provider: Injected) {
  if (await provider.request({ method: "eth_chainId" }) !== "0xaa36a7") throw new Error("Select Ethereum Sepolia in MetaMask.");
}

export default function AdminAirdrop() {
  const [provider, setProvider] = useState<Injected | null>(null);
  const [wallet, setWallet] = useState("");
  const [isAdmin, setIsAdmin] = useState(false);
  const [role, setRole] = useState<AdminRole | null>(null);
  const [section, setSection] = useState<Section>("airdrop");
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  const [team, setTeam] = useState<WalletData | null>(null);
  const [teamAddress, setTeamAddress] = useState("");
  const [teamLabel, setTeamLabel] = useState("");
  const [teamRole, setTeamRole] = useState<AdminRole>("team");
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [contractInput, setContractInput] = useState("");
  const [title, setTitle] = useState("uCURR reward round");
  const [snapshotAt, setSnapshotAt] = useState("");
  const [ratioShares, setRatioShares] = useState("10");
  const [ratioReward, setRatioReward] = useState("1");
  const [minimum, setMinimum] = useState("");
  const [maximum, setMaximum] = useState("");
  const [pool, setPool] = useState("100");
  const [revisedPool, setRevisedPool] = useState("");
  const [deadline, setDeadline] = useState("");
  const [syncHash, setSyncHash] = useState("");
  const [contractAvailable, setContractAvailable] = useState<string | null>(null);
  const [walletUCurr, setWalletUCurr] = useState<string | null>(null);
  const [canMint, setCanMint] = useState(false);
  const [canPublish, setCanPublish] = useState(false);

  async function load(campaignId?: string) {
    const suffix = campaignId ? `?campaign=${encodeURIComponent(campaignId)}` : "";
    const next = await airdropRequest(`/api/admin/airdrop${suffix}`) as AdminData;
    setData(next); setConfigured(next.configured);
    setRole(next.role);
    setSelected(campaignId || next.campaigns[0]?.id || "");
  }

  async function loadTeam() {
    setTeam(await airdropRequest("/api/admin/wallets") as WalletData);
  }

  function chooseSection(next: Section) {
    setSection(next);
    const url = new URL(window.location.href);
    url.searchParams.set("section", next);
    window.history.replaceState(window.history.state, "", url);
    if (next === "team" && role === "owner") void loadTeam().catch((error) => setMessage(errorText(error)));
  }

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("section");
    if (requested === "tokens" || requested === "airdrop" || requested === "team") setSection(requested);
    airdropRequest("/api/airdrop/auth").then(async (session) => {
      setConfigured(Boolean(session.configured));
      if (!session.admin || typeof session.address !== "string") return;
      const injected = window.ethereum as Injected | undefined;
      const chosen = injected?.providers?.find((candidate) => candidate.isMetaMask) || injected;
      if (!chosen) return;
      const accounts = await chosen.request({ method: "eth_accounts" }) as string[];
      if (!accounts.some((address) => address.toLowerCase() === (session.address as string).toLowerCase())) return;
      setProvider(chosen); setWallet(session.address as string); setIsAdmin(true);
      setRole(session.role === "owner" ? "owner" : "team");
      await load();
    }).catch((error) => setMessage(errorText(error)));
  }, []);

  useEffect(() => {
    if (!provider || !wallet || !isAdmin) return;
    let active = true;
    const checkWallet = async () => {
      try {
        const [accounts, chain] = await Promise.all([
          provider.request({ method: "eth_accounts" }) as Promise<string[]>,
          provider.request({ method: "eth_chainId" }) as Promise<string>,
        ]);
        if (!active || (chain === "0xaa36a7" && accounts.some((address) => address.toLowerCase() === wallet.toLowerCase()))) return;
      } catch { if (!active) return; }
      setIsAdmin(false); setRole(null); setData(null); setTeam(null); setWallet(""); setProvider(null);
      setMessage("Wallet changed. Connect the admin wallet again.");
      void airdropRequest("/api/airdrop/auth", { action: "logout" }).catch(() => {});
    };
    provider.on?.("accountsChanged", checkWallet);
    provider.on?.("chainChanged", checkWallet);
    return () => {
      active = false;
      provider.removeListener?.("accountsChanged", checkWallet);
      provider.removeListener?.("chainChanged", checkWallet);
    };
  }, [provider, wallet, isAdmin]);

  useEffect(() => {
    if (!provider || !data?.contractAddress) { setContractAvailable(null); setWalletUCurr(null); setCanMint(false); setCanPublish(false); return; }
    (async () => {
      const signer = await new BrowserProvider(provider).getSigner(wallet);
      const token = new Contract(UCURR_SEPOLIA_ADDRESS, rewardAbi, signer);
      const distributor = new Contract(data.contractAddress!, claimAbi, signer);
      const [balance, reserved, mine, tokenOwner, contractOwner] = await Promise.all([
        token.balanceOf(data.contractAddress!) as Promise<bigint>, distributor.reserved() as Promise<bigint>,
        token.balanceOf(wallet) as Promise<bigint>, token.owner() as Promise<string>, distributor.owner() as Promise<string>,
      ]);
      setContractAvailable((balance - reserved).toString());
      setWalletUCurr(mine.toString());
      setCanMint(tokenOwner.toLowerCase() === wallet.toLowerCase());
      setCanPublish(contractOwner.toLowerCase() === wallet.toLowerCase());
    })().catch(() => { setContractAvailable(null); setWalletUCurr(null); setCanMint(false); setCanPublish(false); });
  }, [provider, wallet, data?.contractAddress, selected]);

  useEffect(() => {
    if (isAdmin && role === "owner" && section === "team") void loadTeam().catch((error) => setMessage(errorText(error)));
  }, [isAdmin, role, section]);

  async function connect() {
    setBusy("connect"); setMessage("");
    try {
      const injected = window.ethereum as Injected | undefined;
      const chosen = injected?.providers?.find((candidate) => candidate.isMetaMask) || injected;
      if (!chosen) throw new Error("Install MetaMask to manage airdrops.");
      const accounts = await chosen.request({ method: "eth_requestAccounts" }) as string[];
      if (!accounts?.[0]) throw new Error("MetaMask did not share a wallet address.");
      let chain = await chosen.request({ method: "eth_chainId" });
      if (chain !== "0xaa36a7") { await chosen.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0xaa36a7" }] }); chain = await chosen.request({ method: "eth_chainId" }); }
      if (chain !== "0xaa36a7") throw new Error("Select Sepolia in MetaMask.");
      const session = await signInForAirdrop(chosen, accounts[0]);
      if (!session.admin) throw new Error("This wallet is not an airdrop administrator.");
      setProvider(chosen); setWallet(accounts[0]); setIsAdmin(true); setRole(session.role === "owner" ? "owner" : "team");
      await load();
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  async function action(name: string, payload: Record<string, unknown>) {
    setBusy(name); setMessage("");
    try {
      const result = await airdropRequest("/api/admin/airdrop", { action: name, ...payload });
      setMessage(name === "create" ? "Reward round scheduled. Holdings will be recorded at the chosen time." : name === "run_due" ? `Snapshot check: ${result.state || "complete"}.` : "Saved.");
      await load(name === "create" ? result.id as string : selected);
      return result;
    } catch (error) { setMessage(errorText(error)); return null; }
    finally { setBusy(""); }
  }

  async function deploy() {
    if (!provider || !wallet) return;
    setBusy("deploy"); setMessage("");
    try {
      await ensureSepolia(provider);
      const signer = await new BrowserProvider(provider).getSigner(wallet);
      const factory = new ContractFactory(artifacts.UCURRAirdrop.abi, artifacts.UCURRAirdrop.bytecode, signer);
      const contract = await factory.deploy(UCURR_SEPOLIA_ADDRESS, wallet);
      const transaction = contract.deploymentTransaction();
      if (!transaction) throw new Error("MetaMask did not submit the deployment.");
      setMessage(`Deployment submitted: ${transaction.hash}`);
      await contract.waitForDeployment();
      const address = await contract.getAddress();
      setContractInput(address);
      const result = await action("set_contract", { address });
      if (!result) setMessage(`Deployed at ${address}. Save this address in the form below to reconnect it.`);
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  async function fund(campaign: Campaign) {
    if (!provider || !data?.contractAddress || role !== "owner" || !canMint) return;
    setBusy("fund"); setMessage("");
    try {
      await ensureSepolia(provider);
      const shortfall = BigInt(campaign.allocated_wei) - BigInt(contractAvailable || "0");
      if (shortfall <= 0n) throw new Error("The claim contract already has enough unreserved uCURR.");
      const signer = await new BrowserProvider(provider).getSigner(wallet);
      const token = new Contract(UCURR_SEPOLIA_ADDRESS, rewardAbi, signer);
      const tx = await token.mint(data.contractAddress, shortfall);
      setMessage(`Funding submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      if (receipt?.status !== 1) throw new Error("Funding was not confirmed.");
      setContractAvailable((BigInt(contractAvailable || "0") + shortfall).toString());
      setMessage(`${tokens(shortfall)} test uCURR funded.`);
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  async function transferFund(campaign: Campaign) {
    if (!provider || !data?.contractAddress) return;
    setBusy("transfer"); setMessage("");
    try {
      await ensureSepolia(provider);
      const shortfall = BigInt(campaign.allocated_wei) - BigInt(contractAvailable || "0");
      if (shortfall <= 0n) throw new Error("The claim contract already has enough uCURR for this round.");
      if (BigInt(walletUCurr || "0") < shortfall) throw new Error("Your wallet needs more uCURR to fund this round.");
      const signer = await new BrowserProvider(provider).getSigner(wallet);
      const token = new Contract(UCURR_SEPOLIA_ADDRESS, rewardAbi, signer);
      const tx = await token.transfer(data.contractAddress, shortfall);
      setMessage(`Transfer submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      if (receipt?.status !== 1) throw new Error("Transfer was not confirmed.");
      const distributor = new Contract(data.contractAddress, claimAbi, signer);
      const [balance, reserved, mine] = await Promise.all([
        token.balanceOf(data.contractAddress) as Promise<bigint>, distributor.reserved() as Promise<bigint>, token.balanceOf(wallet) as Promise<bigint>,
      ]);
      setContractAvailable((balance - reserved).toString());
      setWalletUCurr(mine.toString());
      setMessage(`${tokens(shortfall)} existing uCURR transferred. The total token supply did not increase.`);
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  async function saveTeamWallet() {
    if (!isAddress(teamAddress.trim())) { setMessage("Enter a valid Ethereum wallet address."); return; }
    setBusy("save-team"); setMessage("");
    try {
      await airdropRequest("/api/admin/wallets", { action: "save", wallet: teamAddress.trim(), role: teamRole, label: teamLabel.trim() });
      await loadTeam();
      setTeamAddress(""); setTeamLabel(""); setTeamRole("team");
      setMessage("Team wallet saved. That wallet can sign in to this admin page.");
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  async function removeTeamWallet(address: string) {
    setBusy("remove-team"); setMessage("");
    try {
      await airdropRequest("/api/admin/wallets", { action: "remove", wallet: address });
      await loadTeam();
      setMessage("Team wallet removed. Its current session no longer grants admin access.");
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  async function publish(campaign: Campaign) {
    if (!provider || !data?.contractAddress || !campaign.merkle_root || role !== "owner" || !canPublish) return;
    setBusy("publish"); setMessage("");
    try {
      await ensureSepolia(provider);
      const signer = await new BrowserProvider(provider).getSigner(wallet);
      const contract = new Contract(data.contractAddress, claimAbi, signer);
      const tx = await contract.createCampaign(campaign.merkle_root, BigInt(campaign.allocated_wei), BigInt(Math.floor(new Date(campaign.deadline).valueOf() / 1000)));
      setSyncHash(tx.hash);
      setMessage(`Publishing submitted: ${tx.hash}`);
      const receipt = await tx.wait();
      if (receipt?.status !== 1) throw new Error("Publishing was not confirmed.");
      const result = await action("finalize", { campaignId: campaign.id, txHash: tx.hash });
      if (!result) setMessage(`Published on Sepolia. Enter this transaction hash below to sync: ${tx.hash}`);
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  const campaign = data?.campaigns.find((item) => item.id === selected);

  return <div className="app-shell setup-shell">
    <header className="site-header"><div className="header-inner"><a className="brand-button" href="/"><span className="brand-mark">C</span><span>CURR Hub</span></a><a className="outline-button" href="/">← Back to portal</a></div></header>
    <main className="main-container setup-container admin-container">
      <div className="page-top"><div><span className="network-label"><span className="status-dot" />ETHEREUM SEPOLIA</span><h1>Admin</h1><p>Manage test tokens, reward rounds, and team access in one place.</p></div><div className="admin-account">{wallet && <><span>{role === "owner" ? "Owner" : "Team"}</span><strong>{short(wallet)}</strong></>}</div></div>
      {message && <div className="notice" role="status">{message}</div>}
      {configured === false && <section className="feature-card"><h2>Database setup needed</h2><p>Complete the airdrop database setup before scheduling rewards.</p></section>}
      {configured !== false && !isAdmin && <section className="feature-card"><h2>Admin wallet</h2><p>Connect the authorized MetaMask wallet and sign a message. Sign-in has no network fee.</p><button className="primary-button" disabled={Boolean(busy)} onClick={connect}>{busy ? "Waiting for wallet…" : "Connect admin wallet →"}</button></section>}
      {isAdmin && data && <><nav className="admin-sections" aria-label="Admin sections"><button className={section === "airdrop" ? "admin-section active" : "admin-section"} onClick={() => chooseSection("airdrop")}>Airdrops</button><button className={section === "tokens" ? "admin-section active" : "admin-section"} onClick={() => chooseSection("tokens")}>Test tokens & setup</button>{role === "owner" && <button className={section === "team" ? "admin-section active" : "admin-section"} onClick={() => chooseSection("team")}>Team wallets</button>}</nav>
      {section === "tokens" && <TokenSetupPanel embedded />}
      {section === "team" && role === "owner" && <div className="admin-stack"><section className="feature-card"><h2>Team access</h2><p>Add Ethereum wallet addresses that may sign in here. App owners can manage access and prepare rounds. Team wallets can prepare rounds and transfer their own uCURR into the pool. Minting and publishing still require the wallet that owns those contracts.</p><div className="admin-fields"><label>Wallet address<input placeholder="0x…" value={teamAddress} onChange={(event) => setTeamAddress(event.target.value)} /></label><label>Display name<input placeholder="Team member" maxLength={80} value={teamLabel} onChange={(event) => setTeamLabel(event.target.value)} /></label><label>Access<select className="admin-select" value={teamRole} onChange={(event) => setTeamRole(event.target.value as AdminRole)}><option value="team">Team</option><option value="owner">App owner</option></select></label></div><button className="primary-button" disabled={Boolean(busy) || !isAddress(teamAddress.trim())} onClick={saveTeamWallet}>{busy === "save-team" ? "Saving…" : "Add or update wallet"}</button></section><section className="feature-card"><h2>Authorized wallets</h2>{!team ? <p>Loading wallets…</p> : <><div className="admin-list">{team.recoveryOwners.map((address) => <div className="admin-list-row" key={address}><div><strong>{short(address)}</strong><span>Recovery owner · managed in server settings</span></div></div>)}{team.wallets.map((entry) => <div className="admin-list-row" key={entry.wallet}><div><strong>{entry.label || short(entry.wallet)}</strong><span>{entry.wallet} · {entry.role === "owner" ? "App owner" : "Team"}</span></div><div className="admin-row-actions"><button className="outline-button" disabled={Boolean(busy)} onClick={() => { setTeamAddress(entry.wallet); setTeamLabel(entry.label); setTeamRole(entry.role); }}>Edit</button><button className="outline-button" disabled={Boolean(busy) || entry.wallet.toLowerCase() === wallet.toLowerCase()} onClick={() => removeTeamWallet(entry.wallet)}>Remove</button></div></div>)}</div><p>Removing a wallet revokes its admin access on its next request.</p></>}</section></div>}
      {section === "airdrop" && <div className="admin-stack">
        <section className="feature-card"><div className="feature-card-title"><h2>Claim contract</h2><span className="preview-pill">TEST NETWORK</span></div>
          {data.contractAddress ? <><p>Connected: <a className="admin-link" target="_blank" rel="noopener noreferrer" href={`https://sepolia.etherscan.io/address/${data.contractAddress}`}>{data.contractAddress} ↗</a></p><p>Available for a new reward round: {contractAvailable === null ? "Reading…" : `${tokens(contractAvailable)} uCURR`}</p></> : role === "owner" ? <><p>Deploy the Sepolia claim contract with the wallet that owns uCURR.</p><button className="primary-button" disabled={Boolean(busy)} onClick={deploy}>{busy === "deploy" ? "Waiting for MetaMask…" : "Deploy claim contract →"}</button><div className="admin-setting-row"><input aria-label="Existing claim contract address" placeholder="Already deployed? Paste contract address" value={contractInput} onChange={(event) => setContractInput(event.target.value)} /><button className="outline-button" disabled={Boolean(busy)} onClick={() => action("set_contract", { address: contractInput })}>Use this contract</button></div></> : <p>An app owner will connect the claim contract.</p>}
        </section>
        <section className="feature-card"><h2>Schedule a reward round</h2><p>Each wallet earns a fixed amount from the tCURR it holds at the scheduled snapshot time. A larger number of holders does not reduce anyone else's rate.</p>
          <div className="admin-fields">
            <label>Round name<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label>Snapshot date and time<input type="datetime-local" value={snapshotAt} onChange={(event) => setSnapshotAt(event.target.value)} /></label>
            <label>tCURR in ratio<input type="number" min="1" step="1" value={ratioShares} onChange={(event) => setRatioShares(event.target.value)} /></label>
            <label>uCURR earned<input inputMode="decimal" value={ratioReward} onChange={(event) => setRatioReward(event.target.value)} /></label>
            <label>Minimum reward (optional)<input inputMode="decimal" placeholder="No minimum" value={minimum} onChange={(event) => setMinimum(event.target.value)} /></label>
            <label>Maximum reward (optional)<input inputMode="decimal" placeholder="No maximum" value={maximum} onChange={(event) => setMaximum(event.target.value)} /></label>
            <label>Maximum round budget (uCURR)<input inputMode="decimal" value={pool} onChange={(event) => setPool(event.target.value)} /></label>
            <label>Claim deadline<input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label>
          </div>
          <p>Example: 10 tCURR earns 1 uCURR, so 500 tCURR earns 50 uCURR. A minimum excludes smaller rewards; a maximum caps each wallet's reward. Leave either blank for no limit.</p>
          <button className="primary-button" disabled={Boolean(busy) || !snapshotAt || !deadline} onClick={() => action("create", { title, snapshotAt: new Date(snapshotAt).toISOString(), ratioShares, ratioReward, minimum, maximum, pool, deadline: new Date(deadline).toISOString() })}>{busy === "create" ? "Scheduling…" : "Schedule reward round →"}</button>
        </section>
        <section className="feature-card"><h2>Review and open claims</h2>
          {data.campaigns.length === 0 ? <p>No reward round has been scheduled.</p> : <>
            <select className="admin-select" aria-label="Select reward round" value={selected} onChange={(event) => { setSelected(event.target.value); void load(event.target.value).catch((error) => setMessage(errorText(error))); }}>{data.campaigns.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.status}</option>)}</select>
            {campaign && <>
              <div className="admin-summary"><span>Snapshot: <strong>{campaign.snapshot_at ? new Date(campaign.snapshot_at).toLocaleString() : "Pending"}</strong></span><span>Rate: <strong>{campaign.ratio_shares} tCURR → {campaign.ratio_reward_wei ? tokens(campaign.ratio_reward_wei) : "—"} uCURR</strong></span><span>Calculated: <strong>{tokens(campaign.allocated_wei)} uCURR</strong></span><span>Budget: <strong>{tokens(campaign.pool_wei)} uCURR</strong></span></div>
              {campaign.status === "scheduled" && <><p>{campaign.snapshot_block === null ? "Waiting for the scheduled time and a confirmed block." : `Reading tCURR history through block ${campaign.snapshot_block.toLocaleString("en-US")}. Progress: ${campaign.snapshot_cursor_block?.toLocaleString("en-US") || "starting"}.`}</p><button className="outline-button" disabled={Boolean(busy) || !campaign.snapshot_at || Date.now() < new Date(campaign.snapshot_at).valueOf()} onClick={() => action("run_due", {})}>Check snapshot now</button></>}
              {campaign.snapshot_error && <p className="swap-message" role="alert">Snapshot: {campaign.snapshot_error}</p>}
              {campaign.status === "needs_budget" && <><p>Calculated rewards exceed the budget. Increase it to at least {tokens(campaign.allocated_wei)} uCURR to open this round.</p><div className="admin-setting-row"><input aria-label="Revised round budget" placeholder="New uCURR budget" value={revisedPool} onChange={(event) => setRevisedPool(event.target.value)} /><button className="outline-button" disabled={Boolean(busy) || !revisedPool} onClick={() => action("update_budget", { campaignId: campaign.id, pool: revisedPool })}>Update budget</button></div></>}
              {data.allocations.length > 0 && <div className="admin-list">{data.allocations.map((row) => <div className="admin-list-row" key={row.wallet}><span>{short(row.wallet)}</span><span>{row.shares} tCURR</span><strong>{tokens(row.amount_wei)} uCURR</strong></div>)}</div>}
              {campaign.status === "prepared" && <><p>Rewards are fixed. Fund the claim contract using one of the options below. The contract needs {tokens(campaign.allocated_wei)} uCURR for this round.</p><div className="admin-funding-options">{role === "owner" && canMint && <button className="outline-button" disabled={Boolean(busy) || contractAvailable === null || BigInt(contractAvailable) >= BigInt(campaign.allocated_wei)} onClick={() => fund(campaign)}>Mint {tokens(BigInt(campaign.allocated_wei) - BigInt(contractAvailable || "0"))} new uCURR</button>}<button className="outline-button" disabled={Boolean(busy) || contractAvailable === null || walletUCurr === null || BigInt(contractAvailable) >= BigInt(campaign.allocated_wei) || BigInt(walletUCurr) < BigInt(campaign.allocated_wei) - BigInt(contractAvailable)} onClick={() => transferFund(campaign)}>Transfer {tokens(BigInt(campaign.allocated_wei) - BigInt(contractAvailable || "0"))} existing uCURR</button></div><p>Your wallet: {walletUCurr === null ? "Reading…" : `${tokens(walletUCurr)} uCURR`}. Available in claim contract: {contractAvailable === null ? "Reading…" : `${tokens(contractAvailable)} uCURR`}.</p>{role === "owner" && <><button className="primary-button admin-publish" disabled={Boolean(busy) || !canPublish || contractAvailable === null || BigInt(contractAvailable) < BigInt(campaign.allocated_wei)} onClick={() => publish(campaign)}>Open claims on Sepolia →</button><div className="admin-setting-row"><input aria-label="Publish transaction hash" placeholder="Already opened? Enter transaction hash" value={syncHash} onChange={(event) => setSyncHash(event.target.value)} /><button className="outline-button" disabled={Boolean(busy) || !syncHash} onClick={() => action("finalize", { campaignId: campaign.id, txHash: syncHash })}>Sync open round</button></div></>}</>}
              {campaign.status === "published" && <p>Claims are open. Round #{campaign.onchain_id}. <a className="admin-link" href={`https://sepolia.etherscan.io/tx/${campaign.publish_tx}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a></p>}
              {campaign.status === "failed" && <p>This round could not open. Schedule a new one with an adjusted ratio or limits.</p>}
            </>}
          </>}
        </section>
        <section className="feature-card"><h2>Stakeholder profiles</h2><p>Connected wallet holders provide their own details. No approval is needed to claim.</p>
          {data.profiles.length ? <div className="admin-list">{data.profiles.map((profile) => <div className="admin-list-row" key={profile.wallet}><div><strong>{profile.full_name}</strong><span>{short(profile.wallet)} · {profile.email} · {profile.country}</span><small>{profile.company || "Individual"}{profile.role ? ` · ${profile.role}` : ""} · {profile.relationship} · Updates: {profile.marketing_opt_in ? "yes" : "no"}</small></div></div>)}</div> : <p>No profiles submitted yet.</p>}
        </section>
      </div>}</>}
    </main>
  </div>;
}
