import { Contract } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import { airdropConfigured, airdropDb } from "@/lib/server/airdrop-db";
import { sameOrigin, sessionAddress } from "@/lib/server/airdrop-auth";
import { airdropRpc } from "@/lib/server/airdrop-snapshot";
import { CLAIM_ABI, claimContractAddress, preparedTree } from "@/lib/server/airdrop-service";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!airdropConfigured()) return NextResponse.json({ configured: false, campaigns: [], profile: null }, { headers: { "Cache-Control": "no-store" } });
  const address = sessionAddress(request);
  if (!address) return NextResponse.json({ error: "Sign in with your connected wallet to check eligibility." }, { status: 401 });
  try {
    const db = airdropDb();
    const wallet = address.toLowerCase();
    const [{ data: campaigns, error: campaignsError }, { data: allocations, error: allocationsError }, { data: profile, error: profileError }, contractAddress] = await Promise.all([
      db.from("airdrop_campaigns").select("id,title,status,snapshot_at,snapshot_block,deadline,pool_wei,merkle_root,onchain_id,publish_tx").order("created_at", { ascending: false }).limit(20),
      db.from("airdrop_allocations").select("campaign_id,shares,amount_wei").eq("wallet", wallet),
      db.from("airdrop_stakeholder_profiles").select("full_name,email,company,role,country,relationship,marketing_opt_in").eq("wallet", wallet).maybeSingle(),
      claimContractAddress(),
    ]);
    if (campaignsError) throw campaignsError;
    if (allocationsError) throw allocationsError;
    if (profileError) throw profileError;
    const byCampaign = new Map((allocations || []).map((row) => [row.campaign_id, row]));
    const contract = contractAddress ? new Contract(contractAddress, CLAIM_ABI, airdropRpc()) : null;
    const results = await Promise.all((campaigns || []).map(async (campaign) => {
      const allocation = byCampaign.get(campaign.id);
      const amountWei = allocation?.amount_wei || "0";
      let claimed = false;
      let paused = false;
      let proof: string[] = [];
      if (campaign.status === "published" && (!contract || !campaign.onchain_id || !campaign.merkle_root)) throw new Error("Published airdrop configuration is incomplete.");
      if (campaign.status === "published" && contract && campaign.onchain_id && BigInt(amountWei) > 0n) {
        const [onchainCampaign, onchainClaimed] = await Promise.all([
          contract.campaigns(campaign.onchain_id) as Promise<[string, bigint, bigint, bigint, boolean]>,
          contract.claimed(campaign.onchain_id, address) as Promise<boolean>,
        ]);
        if (onchainCampaign[0].toLowerCase() !== campaign.merkle_root.toLowerCase()) throw new Error("Published airdrop data did not match the claim contract.");
        claimed = onchainClaimed;
        paused = onchainCampaign[4];
        if (profile) {
          const tree = await preparedTree(campaign.id, campaign.pool_wei, true);
          if (tree.root.toLowerCase() !== campaign.merkle_root.toLowerCase()) throw new Error("Stored rewards did not match the claim contract.");
          proof = tree.proofs.find((row) => row.address.toLowerCase() === wallet)?.proof || [];
        }
      }
      return { id: campaign.id, title: campaign.title, status: campaign.status, snapshotAt: campaign.snapshot_at, snapshotBlock: campaign.snapshot_block, deadline: campaign.deadline, shares: allocation?.shares || "0", amountWei, claimed, paused, onchainId: campaign.onchain_id, proof, txHash: campaign.publish_tx };
    }));
    return NextResponse.json({ configured: true, contractAddress, profile, campaigns: results }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not check airdrops." }, { status: 503 });
  }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin did not match." }, { status: 403 });
  if (!airdropConfigured()) return NextResponse.json({ error: "Airdrop is not open yet." }, { status: 503 });
  const address = sessionAddress(request);
  if (!address) return NextResponse.json({ error: "Sign in with your connected wallet first." }, { status: 401 });
  try {
    const body = await request.json() as { fullName?: string; email?: string; company?: string; role?: string; country?: string; relationship?: string; consent?: boolean; marketingOptIn?: boolean };
    const fullName = body.fullName?.trim() || "";
    const email = body.email?.trim() || "";
    const company = body.company?.trim() || "";
    const role = body.role?.trim() || "";
    const country = body.country?.trim() || "";
    const relationship = body.relationship?.trim() || "";
    if (fullName.length < 2 || fullName.length > 100 || email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !country || country.length > 80 || company.length > 120 || role.length > 100 || relationship.length > 100 || body.consent !== true) {
      return NextResponse.json({ error: "Enter your name, email, country, and confirm the profile declaration." }, { status: 400 });
    }
    const db = airdropDb();
    const wallet = address.toLowerCase();
    const { data: holder, error: holderError } = await db.from("airdrop_allocations").select("campaign_id,amount_wei").eq("wallet", wallet).limit(20);
    if (holderError) throw holderError;
    if (!holder?.some((row) => BigInt(row.amount_wei) > 0n)) return NextResponse.json({ error: "This wallet has no calculated reward in an airdrop round." }, { status: 403 });
    const marketing = body.marketingOptIn === true;
    const now = new Date().toISOString();
    const { error } = await db.from("airdrop_stakeholder_profiles").upsert({ wallet, full_name: fullName, email, company, role, country, relationship, profile_consent_at: now, marketing_opt_in: marketing, marketing_consent_at: marketing ? now : null, updated_at: now });
    if (error) throw error;
    return NextResponse.json({ saved: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save your stakeholder profile." }, { status: 400 });
  }
}
