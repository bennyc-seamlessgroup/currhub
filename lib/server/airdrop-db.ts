import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let client: SupabaseClient | null = null;

export function airdropConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY && (process.env.AIRDROP_AUTH_SECRET?.length || 0) >= 32 && process.env.ADMIN_WALLETS);
}

export function airdropDb() {
  if (!airdropConfigured()) throw new Error("Airdrop service is not configured.");
  client ??= createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SECRET_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
  return client;
}

export function adminWallets() {
  return (process.env.ADMIN_WALLETS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
}
