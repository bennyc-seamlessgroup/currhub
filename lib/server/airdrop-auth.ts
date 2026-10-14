import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { getAddress, verifyMessage } from "ethers";
import type { NextRequest } from "next/server";
import { adminWallets } from "@/lib/server/airdrop-db";

export const SESSION_COOKIE = "curr_airdrop_session";
export const CHALLENGE_COOKIE = "curr_airdrop_challenge";
const SESSION_SECONDS = 60 * 60 * 12;
const CHALLENGE_SECONDS = 60 * 5;

type SignedPayload = { address: string; expires: number; message?: string };

function secret() {
  const value = process.env.AIRDROP_AUTH_SECRET;
  if (!value || value.length < 32) throw new Error("Airdrop authentication is not configured.");
  return value;
}

function signature(payload: string) {
  return createHmac("sha256", secret()).update(payload).digest("base64url");
}

export function seal(payload: SignedPayload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signature(body)}`;
}

export function unseal(value: string | undefined): SignedPayload | null {
  if (!value) return null;
  const [body, mac, extra] = value.split(".");
  if (!body || !mac || extra) return null;
  const expected = signature(body);
  const actualBytes = Buffer.from(mac);
  const expectedBytes = Buffer.from(expected);
  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as SignedPayload;
    if (typeof payload.address !== "string" || !Number.isSafeInteger(payload.expires) || payload.expires < Date.now()) return null;
    return payload;
  } catch { return null; }
}

export function cookieOptions(maxAge: number) {
  return { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict" as const, path: "/", maxAge };
}

export function sameOrigin(request: NextRequest) {
  return request.headers.get("origin") === request.nextUrl.origin;
}

export function createChallenge(address: string, origin: string) {
  const checksummed = getAddress(address);
  const nonce = randomBytes(16).toString("hex");
  const issued = new Date().toISOString();
  const expires = Date.now() + CHALLENGE_SECONDS * 1000;
  const message = `${new URL(origin).host} wants you to sign in with your Ethereum account:\n${checksummed}\n\nCheck CURR Hub rewards. Authorized admin wallets may also manage test airdrops.\n\nURI: ${origin}\nVersion: 1\nChain ID: 11155111\nNonce: ${nonce}\nIssued At: ${issued}\nExpiration Time: ${new Date(expires).toISOString()}`;
  return { message, cookie: seal({ address: checksummed, message, expires }) };
}

export function verifyChallenge(value: string | undefined, signatureText: string, address: string) {
  const payload = unseal(value);
  if (!payload?.message || payload.address.toLowerCase() !== getAddress(address).toLowerCase()) return null;
  if (verifyMessage(payload.message, signatureText).toLowerCase() !== payload.address.toLowerCase()) return null;
  return seal({ address: payload.address, expires: Date.now() + SESSION_SECONDS * 1000 });
}

export function sessionAddress(request: NextRequest) {
  return unseal(request.cookies.get(SESSION_COOKIE)?.value)?.address ?? null;
}

export function isAdmin(address: string | null) {
  return Boolean(address && adminWallets().includes(address.toLowerCase()));
}
