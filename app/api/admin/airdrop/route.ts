import { Contract, isAddress, parseUnits } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import { airdropConfigured, airdropDb } from "@/lib/server/airdrop-db";
import { adminRole, sameOrigin, sessionAddress } from "@/lib/server/airdrop-auth";
import { airdropRpc, findTCurrDeploymentBlock } from "@/lib/server/airdrop-snapshot";
import { processDueSnapshot } from "@/lib/server/airdrop-scheduler";
import { CLAIM_ABI, claimContractAddress, preparedTree, validateClaimContract } from "@/lib/server/airdrop-service";

export const runtime = "nodejs";
export const maxDuration = 60;

function failure(error: unknown) {
  const message = error && typeof error === "object" && "message" in error && typeof error.message === "string" ? error.message : "Airdrop request failed.";
  return NextResponse.json({ error: message }, { status: 400 });
}

async function audit(wallet: string, action: string, subject: string) {
  await airdropDb().from("airdrop_admin_events").insert({ wallet: wallet.toLowerCase(), action, subject });
}

export async function GET(request: NextRequest) {
  if (!airdropConfigured()) return NextResponse.json({ configured: false, error: "Set up the airdrop database first." }, { status: 503 });
  const admin = sessionAddress(request);
  const role = await adminRole(admin);
  if (!role) return NextResponse.json({ error: "Admin wallet sign-in required." }, { status: 403 });
  try {
    const db = airdropDb();
    const [{ data: campaigns, error: campaignsError }, { data: profiles, error: profilesError }, contractAddress] = await Promise.all([
      db.from("airdrop_campaigns").select("*").order("created_at", { ascending: false }).limit(20),
      db.from("airdrop_stakeholder_profiles").select("wallet,full_name,email,company,role,country,relationship,marketing_opt_in,updated_at").order("updated_at", { ascending: false }).limit(500),
      claimContractAddress(),
    ]);
    if (campaignsError) throw campaignsError;
    if (profilesError) throw profilesError;
    const campaignId = request.nextUrl.searchParams.get("campaign") || campaigns?.[0]?.id;
    const { data: allocations, error: allocationsError } = campaignId
      ? await db.from("airdrop_allocations").select("wallet,shares,amount_wei").eq("campaign_id", campaignId).order("wallet")
      : { data: [], error: null };
    if (allocationsError) throw allocationsError;
    return NextResponse.json({ configured: true, role, contractAddress, campaigns, profiles, allocations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin did not match." }, { status: 403 });
  if (!airdropConfigured()) return NextResponse.json({ error: "Airdrop database is not configured." }, { status: 503 });
  const admin = sessionAddress(request);
  const role = await adminRole(admin);
  if (!role || !admin) return NextResponse.json({ error: "Admin wallet sign-in required." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const db = airdropDb();
    if (body.action === "run_due") return NextResponse.json(await processDueSnapshot());
    if (body.action === "find_start") return NextResponse.json({ startBlock: await findTCurrDeploymentBlock() });
    if (body.action === "set_contract") {
      if (role !== "owner") return NextResponse.json({ error: "Owner access required." }, { status: 403 });
      if (typeof body.address !== "string" || !isAddress(body.address)) throw new Error("Enter a valid contract address.");
      const existing = await claimContractAddress();
      if (existing && existing.toLowerCase() !== body.address.toLowerCase()) throw new Error("A claim contract is already configured.");
      const address = await validateClaimContract(body.address, admin);
      const { error } = await db.from("airdrop_settings").update({ contract_address: address, updated_at: new Date().toISOString() }).eq("id", true);
      if (error) throw error;
      await audit(admin, "set_contract", address);
      return NextResponse.json({ contractAddress: address });
    }
    if (body.action === "create") {
      const title = typeof body.title === "string" ? body.title.trim() : "";
      const snapshotAt = typeof body.snapshotAt === "string" ? new Date(body.snapshotAt) : new Date(NaN);
      const deadline = typeof body.deadline === "string" ? new Date(body.deadline) : new Date(NaN);
      const ratioShares = Number(body.ratioShares);
      const amount = (value: unknown, label: string) => {
        if (typeof value !== "string" || !/^\d+(\.\d{1,18})?$/.test(value.trim())) throw new Error(`Enter a valid ${label}.`);
        const wei = parseUnits(value.trim(), 18);
        if (wei <= 0n || wei > parseUnits("1000000000", 18)) throw new Error(`Choose ${label} above zero and within the uCURR cap.`);
        return wei;
      };
      const ratioRewardWei = amount(body.ratioReward, "reward ratio");
      const poolWei = amount(body.pool, "uCURR budget");
      const minimum = body.minimum === "" ? null : amount(body.minimum, "minimum reward");
      const maximum = body.maximum === "" ? null : amount(body.maximum, "maximum reward");
      if (!title || title.length > 80 || !Number.isSafeInteger(ratioShares) || ratioShares <= 0 || ratioShares > 1000000000000) throw new Error("Enter a title and a valid tCURR ratio.");
      if (minimum !== null && maximum !== null && minimum > maximum) throw new Error("Minimum reward cannot exceed maximum reward.");
      if (Number.isNaN(snapshotAt.valueOf()) || snapshotAt.valueOf() < Date.now() + 120000) throw new Error("Choose a snapshot time at least two minutes from now.");
      if (Number.isNaN(deadline.valueOf()) || deadline.valueOf() < snapshotAt.valueOf() + 86400000) throw new Error("Set a claim deadline at least one day after the snapshot.");
      const { data: campaign, error } = await db.from("airdrop_campaigns").insert({ title, status: "scheduled", snapshot_at: snapshotAt.toISOString(), ratio_shares: ratioShares, ratio_reward_wei: ratioRewardWei.toString(), minimum_wei: minimum?.toString() || null, maximum_wei: maximum?.toString() || null, pool_wei: poolWei.toString(), deadline: deadline.toISOString(), created_by: admin.toLowerCase() }).select("id").single();
      if (error || !campaign) throw error || new Error("Could not schedule reward round.");
      await audit(admin, "schedule_campaign", campaign.id);
      return NextResponse.json({ id: campaign.id });
    }
    if (body.action === "update_budget") {
      if (typeof body.campaignId !== "string" || typeof body.pool !== "string") throw new Error("Choose a round and enter a budget.");
      const { data: campaign, error: readError } = await db.from("airdrop_campaigns").select("id,status,allocated_wei").eq("id", body.campaignId).single();
      if (readError || !campaign || campaign.status !== "needs_budget") throw new Error("This round is not waiting for a larger budget.");
      if (!/^\d+(\.\d{1,18})?$/.test(body.pool.trim())) throw new Error("Enter a valid uCURR budget.");
      const poolWei = parseUnits(body.pool.trim(), 18);
      if (poolWei < BigInt(campaign.allocated_wei) || poolWei > parseUnits("1000000000", 18)) throw new Error("Budget must cover all calculated rewards and stay within the uCURR cap.");
      const tree = await preparedTree(campaign.id, poolWei.toString(), true);
      const { error } = await db.from("airdrop_campaigns").update({ pool_wei: poolWei.toString(), merkle_root: tree.root, status: "prepared" }).eq("id", campaign.id).eq("status", "needs_budget");
      if (error) throw error;
      await audit(admin, "increase_budget", campaign.id);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "finalize") {
      if (role !== "owner") return NextResponse.json({ error: "Owner access required." }, { status: 403 });
      if (typeof body.campaignId !== "string") throw new Error("Choose a campaign.");
      const { data: campaign, error: campaignError } = await db.from("airdrop_campaigns").select("*").eq("id", body.campaignId).single();
      if (campaignError || !campaign) throw campaignError || new Error("Campaign was not found.");
      if (campaign.status !== "prepared" || typeof body.txHash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(body.txHash)) throw new Error("Enter the confirmed publish transaction hash.");
      const contractAddress = await claimContractAddress();
      if (!contractAddress) throw new Error("Claim contract is not configured.");
      const provider = airdropRpc();
      const receipt = await provider.getTransactionReceipt(body.txHash);
      if (!receipt || receipt.status !== 1 || receipt.to?.toLowerCase() !== contractAddress.toLowerCase() || receipt.from.toLowerCase() !== admin.toLowerCase()) throw new Error("This is not a confirmed campaign transaction from your admin wallet.");
      const contract = new Contract(contractAddress, CLAIM_ABI, provider);
      const created = receipt.logs.filter((log) => log.address.toLowerCase() === contractAddress.toLowerCase()).map((log) => { try { return contract.interface.parseLog(log); } catch { return null; } }).find((event) => event?.name === "CampaignCreated");
      if (!created) throw new Error("The transaction did not create an airdrop campaign.");
      const tree = await preparedTree(campaign.id, campaign.pool_wei, true);
      if (created.args.root.toLowerCase() !== campaign.merkle_root.toLowerCase() || created.args.root.toLowerCase() !== tree.root.toLowerCase() || created.args.total !== BigInt(tree.total) || Number(created.args.deadline) !== Math.floor(new Date(campaign.deadline).valueOf() / 1000)) throw new Error("The on-chain allocation does not match the prepared round.");
      const { error: updateError } = await db.from("airdrop_campaigns").update({ status: "published", onchain_id: Number(created.args.campaignId), publish_tx: body.txHash }).eq("id", campaign.id).eq("status", "prepared");
      if (updateError) throw updateError;
      await audit(admin, "publish_campaign", campaign.id);
      return NextResponse.json({ ok: true, onchainId: Number(created.args.campaignId) });
    }
    return NextResponse.json({ error: "Unknown admin action." }, { status: 400 });
  } catch (error) { return failure(error); }
}
