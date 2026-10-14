import { BrowserProvider } from "ethers";
import type { InjectedEthereum } from "@/lib/tcurr";

export async function airdropRequest(path: string, body?: unknown) {
  const response = await fetch(path, body ? { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { credentials: "same-origin", cache: "no-store" });
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "Airdrop service is unavailable.");
  return data;
}

export async function signInForAirdrop(provider: InjectedEthereum, address: string) {
  const chainId = await provider.request({ method: "eth_chainId" });
  if (chainId !== "0xaa36a7") throw new Error("Select Ethereum Sepolia in your wallet.");
  const challenge = await airdropRequest("/api/airdrop/auth", { action: "challenge", address });
  if (typeof challenge.message !== "string") throw new Error("Could not prepare wallet sign-in.");
  const signer = await new BrowserProvider(provider).getSigner(address);
  const signature = await signer.signMessage(challenge.message);
  return airdropRequest("/api/airdrop/auth", { action: "verify", address, signature });
}
