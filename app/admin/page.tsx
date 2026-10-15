"use client";

import { useEffect, useState } from "react";
import { BrowserProvider, Contract, ContractFactory, formatUnits } from "ethers";
import { airdropRequest, signInForAirdrop } from "@/lib/airdrop-client";
import { TCURR_SEPOLIA_DEPLOYMENT_BLOCK, UCURR_SEPOLIA_ADDRESS } from "@/lib/tcurr";
import artifacts from "@/lib/test-contract-artifacts.json";

type Injected = { request: (args: { method: string; params?: unknown[] | Record<string, unknown> }) => Promise<unknown>; on?: (event: string, listener: () => void) => void; removeListener?: (event: string, listener: () => void) => void; isMetaMask?: boolean; providers?: Injected[] };
type Campaign = { id: string; title: string; status: string; snapshot_block: number; snapshot_start: number; pool_wei: string; deadline: string; merkle_root: string | null; onchain_id: number | null; publish_tx: string | null };
type Identity = { wallet: string; full_name: string; email: string; country: string; status: string; submitted_at: string };
type Allocation = { wallet: string; shares: string; amount_wei: string };
type AdminData = { configured: boolean; contractAddress: string | null; campaigns: Campaign[]; identities: Identity[]; allocations: Allocation[] };

const claimAbi = ["function reserved() view returns (uint256)", "function createCampaign(bytes32,uint256,uint64) returns (uint256)"];
const rewardAbi = ["function balanceOf(address) view returns (uint256)", "function mint(address,uint256)"];

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
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [data, setData] = useState<AdminData | null>(null);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [contractInput, setContractInput] = useState("");
  const [title, setTitle] = useState("uCURR reward round");
  const [startBlock, setStartBlock] = useState(String(TCURR_SEPOLIA_DEPLOYMENT_BLOCK));
  const [snapshotBlock, setSnapshotBlock] = useState("");
  const [pool, setPool] = useState("100");
  const [deadline, setDeadline] = useState("");
  const [ruleApproved, setRuleApproved] = useState(false);
  const [syncHash, setSyncHash] = useState("");
  const [contractAvailable, setContractAvailable] = useState<string | null>(null);

  async function load(campaignId?: string) {
    const suffix = campaignId ? `?campaign=${encodeURIComponent(campaignId)}` : "";
    const next = await airdropRequest(`/api/admin/airdrop${suffix}`) as AdminData;
    setData(next); setConfigured(next.configured);
    setSelected(campaignId || next.campaigns[0]?.id || "");
  }

  useEffect(() => {
    airdropRequest("/api/airdrop/auth").then(async (session) => {
      setConfigured(Boolean(session.configured));
      if (!session.admin || typeof session.address !== "string") return;
      const injected = window.ethereum as Injected | undefined;
      const chosen = injected?.providers?.find((candidate) => candidate.isMetaMask) || injected;
      if (!chosen) return;
      const accounts = await chosen.request({ method: "eth_accounts" }) as string[];
      if (!accounts.some((address) => address.toLowerCase() === (session.address as string).toLowerCase())) return;
      setProvider(chosen); setWallet(session.address as string); setIsAdmin(true);
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
      setIsAdmin(false); setData(null); setWallet(""); setProvider(null);
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
    if (!provider || !data?.contractAddress) { setContractAvailable(null); return; }
    (async () => {
      const signer = await new BrowserProvider(provider).getSigner(wallet);
      const token = new Contract(UCURR_SEPOLIA_ADDRESS, rewardAbi, signer);
      const distributor = new Contract(data.contractAddress!, claimAbi, signer);
      const [balance, reserved] = await Promise.all([token.balanceOf(data.contractAddress!) as Promise<bigint>, distributor.reserved() as Promise<bigint>]);
      setContractAvailable((balance - reserved).toString());
    })().catch(() => setContractAvailable(null));
  }, [provider, wallet, data?.contractAddress, selected]);

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
      setProvider(chosen); setWallet(accounts[0]); setIsAdmin(true);
      await load();
    } catch (error) { setMessage(errorText(error)); }
    finally { setBusy(""); }
  }

  async function action(name: string, payload: Record<string, unknown>) {
    setBusy(name); setMessage("");
    try {
      const result = await airdropRequest("/api/admin/airdrop", { action: name, ...payload });
      setMessage(name === "create" ? `Airdrop plan saved. Found ${result.holders} tCURR holder wallets.` : "Saved.");
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

  async function latestSafeBlock() {
    if (!provider) return;
    try { await ensureSepolia(provider); setSnapshotBlock(String((await new BrowserProvider(provider).getBlockNumber()) - 6)); }
    catch (error) { setMessage(errorText(error)); }
  }

  function findStartBlock() {
    setStartBlock(String(TCURR_SEPOLIA_DEPLOYMENT_BLOCK));
    setMessage(`tCURR started at block ${TCURR_SEPOLIA_DEPLOYMENT_BLOCK.toLocaleString("en-US")}.`);
  }

  async function fund(campaign: Campaign) {
    if (!provider || !data?.contractAddress) return;
    setBusy("fund"); setMessage("");
    try {
      await ensureSepolia(provider);
      const shortfall = BigInt(campaign.pool_wei) - BigInt(contractAvailable || "0");
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

  async function publish(campaign: Campaign) {
    if (!provider || !data?.contractAddress || !campaign.merkle_root) return;
    setBusy("publish"); setMessage("");
    try {
      await ensureSepolia(provider);
      const signer = await new BrowserProvider(provider).getSigner(wallet);
      const contract = new Contract(data.contractAddress, claimAbi, signer);
      const tx = await contract.createCampaign(campaign.merkle_root, BigInt(campaign.pool_wei), BigInt(Math.floor(new Date(campaign.deadline).valueOf() / 1000)));
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
  const approved = new Set(data?.identities.filter((identity) => identity.status === "approved").map((identity) => identity.wallet));
  const eligibleCount = data?.allocations.filter((row) => approved.has(row.wallet)).length || 0;

  return <div className="app-shell setup-shell"><header className="site-header"><div className="header-inner"><a className="brand-button" href="/"><span className="brand-mark">C</span><span>CURR Hub</span></a><a className="outline-button" href="/">← Back to portal</a></div></header><main className="main-container setup-container admin-container"><div className="page-top"><div><span className="network-label"><span className="status-dot" />ETHEREUM SEPOLIA</span><h1>Airdrop admin</h1><p>Create a tCURR snapshot, review test identity submissions, and publish uCURR rewards.</p></div></div>
    {message && <div className="notice" role="status">{message}</div>}
    {configured === false && <section className="feature-card"><h2>Database setup needed</h2><p>Follow the README airdrop setup steps to create Supabase tables and add server settings. No claims are open yet.</p></section>}
    {configured !== false && !isAdmin && <section className="feature-card"><h2>Admin wallet</h2><p>Connect the authorized MetaMask wallet and sign a message. No network fee is charged for sign-in.</p><button className="primary-button" disabled={Boolean(busy)} onClick={connect}>{busy ? "Waiting for wallet…" : "Connect admin wallet →"}</button></section>}
    {isAdmin && data && <div className="admin-stack">
      <section className="feature-card"><div className="feature-card-title"><h2>1. Claim contract</h2><span className="preview-pill">TEST NETWORK</span></div>{data.contractAddress ? <><p>Connected: <a className="admin-link" target="_blank" rel="noopener noreferrer" href={`https://sepolia.etherscan.io/address/${data.contractAddress}`}>{data.contractAddress} ↗</a></p><p>Available for a new reward round: {contractAvailable === null ? "Reading…" : `${tokens(contractAvailable)} uCURR`}</p></> : <><p>Deploy the Sepolia claim contract with your admin MetaMask wallet. Your wallet will ask you to approve the transaction.</p><button className="primary-button" disabled={Boolean(busy)} onClick={deploy}>{busy === "deploy" ? "Waiting for MetaMask…" : "Deploy claim contract →"}</button><div className="admin-setting-row"><input aria-label="Existing claim contract address" placeholder="Already deployed? Paste contract address" value={contractInput} onChange={(event) => setContractInput(event.target.value)} /><button className="outline-button" disabled={Boolean(busy)} onClick={() => action("set_contract", { address: contractInput })}>Use this contract</button></div></>}</section>
      <section className="feature-card"><h2>2. Plan an airdrop</h2><p>A draft round is a saved plan for one airdrop. It records each wallet’s tCURR balance at a chosen block, the proposed uCURR reward pool, and the claim deadline. Click Find automatically and Use latest safe block to fill the block numbers. Saving this plan does not send tokens or open claims.</p><div className="admin-fields"><label>Airdrop name<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label>tCURR start block<input type="number" min="0" value={startBlock} onChange={(event) => setStartBlock(event.target.value)} /><button className="text-button" disabled={Boolean(busy)} onClick={findStartBlock}>{busy === "find_start" ? "Finding…" : "Find automatically"}</button></label><label>Snapshot block<input type="number" min="0" value={snapshotBlock} onChange={(event) => setSnapshotBlock(event.target.value)} /><button className="text-button" onClick={latestSafeBlock}>Use latest safe block</button></label><label>Reward pool (uCURR)<input value={pool} onChange={(event) => setPool(event.target.value)} /></label><label>Claim deadline<input type="datetime-local" value={deadline} onChange={(event) => setDeadline(event.target.value)} /></label></div><button className="primary-button" disabled={Boolean(busy) || !startBlock || !snapshotBlock || !deadline} onClick={() => action("create", { title, startBlock: Number(startBlock), snapshotBlock: Number(snapshotBlock), pool, deadline: new Date(deadline).toISOString() })}>{busy === "create" ? "Reading tCURR history…" : "Save airdrop plan →"}</button></section>
      <section className="feature-card"><h2>3. Review identity submissions</h2><p>This is a manual test review, not formal KYC. Only approved wallets enter the final reward calculation.</p>{data.identities.length ? <div className="admin-list">{data.identities.map((identity) => <div className="admin-list-row" key={identity.wallet}><div><strong>{identity.full_name}</strong><span>{short(identity.wallet)} · {identity.country} · {identity.email || "No email"}</span><small>{identity.status}</small></div>{identity.status === "submitted" && <div className="admin-row-actions"><button className="outline-button" disabled={Boolean(busy)} onClick={() => action("review", { wallet: identity.wallet, status: "approved" })}>Approve</button><button className="outline-button" disabled={Boolean(busy)} onClick={() => action("review", { wallet: identity.wallet, status: "rejected" })}>Reject</button></div>}</div>)}</div> : <p>No submissions yet.</p>}</section>
      <section className="feature-card"><h2>4. Review and publish</h2>{data.campaigns.length === 0 ? <p>Save an airdrop plan first.</p> : <><select className="admin-select" aria-label="Select airdrop" value={selected} onChange={(event) => { setSelected(event.target.value); void load(event.target.value).catch((error) => setMessage(errorText(error))); }}>{data.campaigns.map((item) => <option key={item.id} value={item.id}>{item.title} · {item.status}</option>)}</select>{campaign && <><div className="admin-summary"><span>tCURR holders: <strong>{data.allocations.length}</strong></span><span>Approved holders: <strong>{eligibleCount}</strong></span><span>Reward pool: <strong>{tokens(campaign.pool_wei)} uCURR</strong></span><span>Snapshot: <strong>#{campaign.snapshot_block}</strong></span></div><div className="admin-list">{data.allocations.map((row) => <div className="admin-list-row" key={row.wallet}><span>{short(row.wallet)}</span><span>{row.shares} tCURR</span><strong>{campaign.status === "draft" ? approved.has(row.wallet) ? "Approved" : "Awaiting review" : `${tokens(row.amount_wei)} uCURR`}</strong></div>)}</div>{campaign.status === "draft" && <><label className="airdrop-check admin-confirm"><input type="checkbox" checked={ruleApproved} onChange={(event) => setRuleApproved(event.target.checked)} /> I confirm management approved this snapshot, pool, and proportional reward rule.</label><button className="primary-button" disabled={Boolean(busy) || !ruleApproved || eligibleCount === 0 || !data.contractAddress} onClick={() => action("prepare", { campaignId: campaign.id, ruleApproved })}>Freeze approved allocations →</button></>}{campaign.status === "prepared" && <><p>Allocations are frozen. Fund the claim contract, then publish this round with MetaMask.</p><button className="outline-button" disabled={Boolean(busy) || contractAvailable === null || BigInt(contractAvailable) >= BigInt(campaign.pool_wei)} onClick={() => fund(campaign)}>Mint {tokens(BigInt(campaign.pool_wei) - BigInt(contractAvailable || "0"))} uCURR to claim contract</button><button className="primary-button admin-publish" disabled={Boolean(busy) || contractAvailable === null || BigInt(contractAvailable) < BigInt(campaign.pool_wei)} onClick={() => publish(campaign)}>Publish round on Sepolia →</button><div className="admin-setting-row"><input aria-label="Publish transaction hash" placeholder="Already published? Enter transaction hash" value={syncHash} onChange={(event) => setSyncHash(event.target.value)} /><button className="outline-button" disabled={Boolean(busy) || !syncHash} onClick={() => action("finalize", { campaignId: campaign.id, txHash: syncHash })}>Sync published round</button></div></>}{campaign.status === "published" && <p>Published on Sepolia. Round #{campaign.onchain_id}. <a className="admin-link" href={`https://sepolia.etherscan.io/tx/${campaign.publish_tx}`} target="_blank" rel="noopener noreferrer">View transaction ↗</a></p>}</>}</>}</section>
    </div>}
  </main></div>;
}
