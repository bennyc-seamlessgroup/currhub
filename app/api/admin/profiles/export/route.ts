import { NextRequest, NextResponse } from "next/server";
import { airdropConfigured, airdropDb } from "@/lib/server/airdrop-db";
import { adminRole, sessionAddress } from "@/lib/server/airdrop-auth";
import { profilesCsv } from "@/lib/csv-export.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!airdropConfigured()) return NextResponse.json({ error: "Airdrop database is not configured." }, { status: 503 });
  const role = await adminRole(sessionAddress(request));
  if (!role) return NextResponse.json({ error: "Admin wallet sign-in required." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  try {
    const db = airdropDb();
    const profiles: Record<string, string | boolean | null>[] = [];
    for (let offset = 0; ; offset += 500) {
      const { data, error } = await db.from("airdrop_stakeholder_profiles")
        .select("wallet,full_name,email,company,role,country,relationship,marketing_opt_in,updated_at")
        .order("wallet").range(offset, offset + 499);
      if (error) throw error;
      profiles.push(...(data || []));
      if (!data || data.length < 500) break;
    }
    const filename = `currhub-stakeholders-${new Date().toISOString().slice(0, 10)}.csv`;
    return new Response(profilesCsv(profiles), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "Could not prepare stakeholder download." }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}
