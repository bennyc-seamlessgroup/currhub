import { isAddress } from "ethers";
import { NextRequest, NextResponse } from "next/server";
import { airdropConfigured } from "@/lib/server/airdrop-db";
import { CHALLENGE_COOKIE, SESSION_COOKIE, adminRole, cookieOptions, createChallenge, sameOrigin, sessionAddress, verifyChallenge } from "@/lib/server/airdrop-auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const address = airdropConfigured() ? sessionAddress(request) : null;
  try {
    const role = address ? await adminRole(address) : null;
    return NextResponse.json({ configured: airdropConfigured(), address, admin: Boolean(role), role }, { headers: { "Cache-Control": "no-store" } });
  } catch { return NextResponse.json({ error: "Could not check admin access." }, { status: 503 }); }
}

export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "Request origin did not match." }, { status: 403 });
  try {
    const body = await request.json() as { action?: string; address?: string; signature?: string };
    if (body.action === "logout") {
      const response = NextResponse.json({ ok: true });
      response.cookies.delete(SESSION_COOKIE);
      response.cookies.delete(CHALLENGE_COOKIE);
      return response;
    }
    if (!airdropConfigured()) return NextResponse.json({ error: "Airdrop is not open yet." }, { status: 503 });
    if (!body.address || !isAddress(body.address)) throw new Error("Connect a valid Ethereum wallet.");
    if (body.action === "challenge") {
      const challenge = createChallenge(body.address, request.nextUrl.origin);
      const response = NextResponse.json({ message: challenge.message });
      response.cookies.set(CHALLENGE_COOKIE, challenge.cookie, cookieOptions(300));
      return response;
    }
    if (body.action === "verify" && typeof body.signature === "string" && body.signature.length <= 300) {
      const session = verifyChallenge(request.cookies.get(CHALLENGE_COOKIE)?.value, body.signature, body.address);
      if (!session) return NextResponse.json({ error: "Wallet signature could not be verified. Try again." }, { status: 401 });
      const role = await adminRole(body.address);
      const response = NextResponse.json({ ok: true, address: body.address, admin: Boolean(role), role });
      response.cookies.set(SESSION_COOKIE, session, cookieOptions(43200));
      response.cookies.delete(CHALLENGE_COOKIE);
      return response;
    }
    return NextResponse.json({ error: "Invalid sign-in request." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not sign in." }, { status: 400 });
  }
}
