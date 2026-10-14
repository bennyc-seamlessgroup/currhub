export type WalletSession = {
  chain: "ethereum" | "solana";
  address: string;
  id: string;
  name: string;
  rdns?: string;
};

const KEY = "currhub:wallet:v1";

export function readWalletSession(): WalletSession | null {
  try {
    const value = JSON.parse(window.localStorage.getItem(KEY) || "null") as Partial<WalletSession> | null;
    if (value && (value.chain === "ethereum" || value.chain === "solana") &&
      typeof value.address === "string" && typeof value.id === "string" &&
      typeof value.name === "string") return value as WalletSession;
  } catch { /* Storage can be disabled by the browser. */ }
  return null;
}

export function saveWalletSession(value: WalletSession) {
  try { window.localStorage.setItem(KEY, JSON.stringify(value)); }
  catch { /* The current connection still works without browser storage. */ }
}

export function clearWalletSession() {
  try { window.localStorage.removeItem(KEY); }
  catch { /* The current page can still disconnect. */ }
}
