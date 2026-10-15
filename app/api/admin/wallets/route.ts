import { getAddress, isAddress } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import { adminRole, sameOrigin, sessionAddress } from "@/lib/server/airdrop-auth";
import { adminWallets, airdropConfigured, airdropDb } from "@/lib/server/airdrop-db";

export const runtime = "nodejs";

async function ownerAddress(request: NextRequest) {
  const address = sessionAddress(request);
  return address && await adminRole(address) === "owner" ? address.toLowerCase() : null;
}

export async function GET(request: NextRequest) {
  if (!airdropConfigured()) return NextResponse.json({ error: "Admin database is not configured." }, { status: 503 });
  try {
    if (!await ownerAddress(request)) return NextResponse.json({ error: "Owner wallet sign-in required." }, { status: 403 });
    const { data, error } = await airdropDb().from("airdrop_admin_wallets").select("wallet,role,label,created_at,updated_at").order("created_at");
    if (error) throw error;
    return NextResponse.json({ recoveryOwners: adminWallets(), wallets: data || [] }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Could not load team wallets." }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin did not match." }, { status: 403 });
  if (!airdropConfigured()) return NextResponse.json({ error: "Admin database is not configured." }, { status: 503 });
  try {
    const owner = await ownerAddress(request);
    if (!owner) return NextResponse.json({ error: "Owner wallet sign-in required." }, { status: 403 });
    const body = await request.json() as { action?: string; wallet?: string; role?: string; label?: string };
    if (!body.wallet || !isAddress(body.wallet)) return NextResponse.json({ error: "Enter a valid Ethereum wallet address." }, { status: 400 });
    const wallet = getAddress(body.wallet).toLowerCase();
    if (adminWallets().includes(wallet)) return NextResponse.json({ error: "A recovery owner is managed in server settings and cannot be changed here." }, { status: 400 });
    const db = airdropDb();
    if (body.action === "save") {
      if (body.role !== "owner" && body.role !== "team") return NextResponse.json({ error: "Choose Owner or Team." }, { status: 400 });
      const label = typeof body.label === "string" ? body.label.trim() : "";
      if (label.length > 80) return NextResponse.json({ error: "Name must be 80 characters or shorter." }, { status: 400 });
      const { error } = await db.from("airdrop_admin_wallets").upsert({ wallet, role: body.role, label, added_by: owner, updated_at: new Date().toISOString() });
      if (error) throw error;
      await db.from("airdrop_admin_events").insert({ wallet: owner, action: "save_team_wallet", subject: `${wallet}:${body.role}` });
      return NextResponse.json({ ok: true });
    }
    if (body.action === "remove") {
      if (wallet === owner) return NextResponse.json({ error: "You cannot remove your current wallet." }, { status: 400 });
      const { error } = await db.from("airdrop_admin_wallets").delete().eq("wallet", wallet);
      if (error) throw error;
      await db.from("airdrop_admin_events").insert({ wallet: owner, action: "remove_team_wallet", subject: wallet });
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ error: "Unknown wallet action." }, { status: 400 });
  } catch { return NextResponse.json({ error: "Could not update team wallets." }, { status: 503 }); }
}
