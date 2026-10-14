import { Contract, isAddress, parseUnits } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import { airdropConfigured, airdropDb } from "@/lib/server/airdrop-db";
import { isAdmin, sameOrigin, sessionAddress } from "@/lib/server/airdrop-auth";
import { airdropRpc, findTCurrDeploymentBlock, takeTCurrSnapshot } from "@/lib/server/airdrop-snapshot";
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
  if (!isAdmin(admin)) return NextResponse.json({ error: "Admin wallet sign-in required." }, { status: 403 });
  try {
    const db = airdropDb();
    const [{ data: campaigns, error: campaignsError }, { data: identities, error: identitiesError }, contractAddress] = await Promise.all([
      db.from("airdrop_campaigns").select("*").order("created_at", { ascending: false }).limit(20),
      db.from("airdrop_identity_reviews").select("wallet,full_name,email,country,status,submitted_at,reviewed_at").order("submitted_at", { ascending: false }).limit(500),
      claimContractAddress(),
    ]);
    if (campaignsError) throw campaignsError;
    if (identitiesError) throw identitiesError;
    const campaignId = request.nextUrl.searchParams.get("campaign") || campaigns?.[0]?.id;
    const { data: allocations, error: allocationsError } = campaignId
      ? await db.from("airdrop_allocations").select("wallet,shares,amount_wei").eq("campaign_id", campaignId).order("wallet")
      : { data: [], error: null };
    if (allocationsError) throw allocationsError;
    return NextResponse.json({ configured: true, contractAddress, campaigns, identities, allocations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin did not match." }, { status: 403 });
  if (!airdropConfigured()) return NextResponse.json({ error: "Airdrop database is not configured." }, { status: 503 });
  const admin = sessionAddress(request);
  if (!isAdmin(admin) || !admin) return NextResponse.json({ error: "Admin wallet sign-in required." }, { status: 403 });
  try {
    const body = await request.json() as Record<string, unknown>;
    const db = airdropDb();
    if (body.action === "find_start") return NextResponse.json({ startBlock: await findTCurrDeploymentBlock() });
    if (body.action === "set_contract") {
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
      const start = Number(body.startBlock);
      const end = Number(body.snapshotBlock);
      const poolText = typeof body.pool === "string" ? body.pool.trim() : "";
      const deadline = typeof body.deadline === "string" ? new Date(body.deadline) : new Date(NaN);
      if (!title || title.length > 80 || !/^\d+(\.\d{1,18})?$/.test(poolText)) throw new Error("Enter a title and a valid uCURR reward pool.");
      const poolWei = parseUnits(poolText, 18);
      if (poolWei <= 0n || poolWei > parseUnits("1000000000", 18)) throw new Error("Choose a reward pool above zero and within the uCURR cap.");
      if (Number.isNaN(deadline.valueOf()) || deadline.valueOf() < Date.now() + 86400000) throw new Error("Set a claim deadline at least one day from now.");
      const snapshot = await takeTCurrSnapshot(start, end);
      if (!snapshot.holders.length) throw new Error("No tCURR holders were found at this block.");
      const { data: campaign, error: campaignError } = await db.from("airdrop_campaigns").insert({ title, snapshot_start: start, snapshot_block: end, snapshot_hash: snapshot.blockHash, pool_wei: poolWei.toString(), deadline: deadline.toISOString(), created_by: admin.toLowerCase() }).select("id").single();
      if (campaignError || !campaign) throw campaignError || new Error("Could not create campaign.");
      const { error: rowsError } = await db.from("airdrop_allocations").insert(snapshot.holders.map((row) => ({ campaign_id: campaign.id, wallet: row.address.toLowerCase(), shares: row.shares })));
      if (rowsError) {
        await db.from("airdrop_campaigns").delete().eq("id", campaign.id).eq("status", "draft");
        throw rowsError;
      }
      await audit(admin, "create_campaign", campaign.id);
      return NextResponse.json({ id: campaign.id, holders: snapshot.holders.length });
    }
    if (body.action === "review") {
      const wallet = typeof body.wallet === "string" ? body.wallet.toLowerCase() : "";
      const status = body.status;
      if (!isAddress(wallet) || (status !== "approved" && status !== "rejected")) throw new Error("Choose a valid review decision.");
      const { data, error } = await db.from("airdrop_identity_reviews").update({ status, reviewed_at: new Date().toISOString(), reviewed_by: admin.toLowerCase() }).eq("wallet", wallet).eq("status", "submitted").select("wallet").single();
      if (error || !data) throw error || new Error("Identity submission was not found.");
      await audit(admin, `review_${status}`, wallet);
      return NextResponse.json({ ok: true });
    }
    if (body.action === "prepare" || body.action === "finalize") {
      if (typeof body.campaignId !== "string") throw new Error("Choose a campaign.");
      const { data: campaign, error: campaignError } = await db.from("airdrop_campaigns").select("*").eq("id", body.campaignId).single();
      if (campaignError || !campaign) throw campaignError || new Error("Campaign was not found.");
      if (body.action === "prepare") {
        if (campaign.status !== "draft" || body.ruleApproved !== true) throw new Error("Confirm approval of the snapshot and reward rule before preparing.");
        if (!await claimContractAddress()) throw new Error("Deploy and connect the claim contract first.");
        const block = await airdropRpc().getBlock(campaign.snapshot_block);
        if (block?.hash !== campaign.snapshot_hash) throw new Error("Snapshot block changed. Do not publish this round.");
        const tree = await preparedTree(campaign.id, campaign.pool_wei, false);
        const amounts = new Map(("shares" in tree ? tree.shares : []).map((row) => [row.wallet, row.amount_wei]));
        const { data: existing, error: readError } = await db.from("airdrop_allocations").select("wallet,shares").eq("campaign_id", campaign.id);
        if (readError) throw readError;
        const { error: writeError } = await db.from("airdrop_allocations").upsert((existing || []).map((row) => ({ campaign_id: campaign.id, wallet: row.wallet, shares: row.shares, amount_wei: amounts.get(row.wallet) || "0" })));
        if (writeError) throw writeError;
        const { error: updateError } = await db.from("airdrop_campaigns").update({ status: "prepared", merkle_root: tree.root }).eq("id", campaign.id).eq("status", "draft");
        if (updateError) throw updateError;
        await audit(admin, "prepare_campaign", campaign.id);
        return NextResponse.json({ root: tree.root, total: tree.total, deadline: Math.floor(new Date(campaign.deadline).valueOf() / 1000) });
      }
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
      if (created.args.root.toLowerCase() !== campaign.merkle_root.toLowerCase() || created.args.root.toLowerCase() !== tree.root.toLowerCase() || created.args.total !== BigInt(tree.total) || Number(created.args.deadline) !== Math.floor(new Date(campaign.deadline).valueOf() / 1000)) throw new Error("The on-chain allocation does not match the approved draft.");
      const { error: updateError } = await db.from("airdrop_campaigns").update({ status: "published", onchain_id: Number(created.args.campaignId), publish_tx: body.txHash }).eq("id", campaign.id).eq("status", "prepared");
      if (updateError) throw updateError;
      await audit(admin, "publish_campaign", campaign.id);
      return NextResponse.json({ ok: true, onchainId: Number(created.args.campaignId) });
    }
    return NextResponse.json({ error: "Unknown admin action." }, { status: 400 });
  } catch (error) { return failure(error); }
}
