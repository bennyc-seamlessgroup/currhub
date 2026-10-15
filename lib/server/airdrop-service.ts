import "server-only";
import { Contract, getAddress } from "ethers";
import { airdropDb } from "@/lib/server/airdrop-db";
import { airdropRpc } from "@/lib/server/airdrop-snapshot";
import { buildClaimTree } from "@/lib/airdrop-chain.mjs";
import { UCURR_SEPOLIA_ADDRESS } from "@/lib/tcurr";

export const CLAIM_ABI = [
  "function token() view returns (address)",
  "function owner() view returns (address)",
  "function claimed(uint256,address) view returns (bool)",
  "function campaigns(uint256) view returns (bytes32 root,uint256 total,uint256 paid,uint64 deadline,bool paused)",
  "function createCampaign(bytes32 root,uint256 total,uint64 deadline) returns (uint256)",
  "function claim(uint256 id,uint256 amount,bytes32[] proof)",
  "event CampaignCreated(uint256 indexed campaignId,bytes32 root,uint256 total,uint64 deadline)",
];

export async function claimContractAddress() {
  const { data, error } = await airdropDb().from("airdrop_settings").select("contract_address").eq("id", true).single();
  if (error) throw error;
  return data.contract_address ? getAddress(data.contract_address as string) : null;
}

export async function validateClaimContract(address: string, adminAddress: string) {
  const provider = airdropRpc();
  const checksummed = getAddress(address);
  if (await provider.getCode(checksummed) === "0x") throw new Error("No claim contract exists at that Sepolia address.");
  const contract = new Contract(checksummed, CLAIM_ABI, provider);
  const [token, owner] = await Promise.all([contract.token() as Promise<string>, contract.owner() as Promise<string>]);
  if (getAddress(token) !== getAddress(UCURR_SEPOLIA_ADDRESS) || getAddress(owner) !== getAddress(adminAddress)) {
    throw new Error("The claim contract must use the CURR Hub uCURR token and be owned by this admin wallet.");
  }
  return checksummed;
}

export async function preparedTree(campaignId: string, poolWei: string, onlyStored: boolean) {
  const db = airdropDb();
  const { data: rows, error: rowsError } = await db.from("airdrop_allocations").select("wallet,shares,amount_wei").eq("campaign_id", campaignId).order("wallet");
  if (rowsError) throw rowsError;
  const eligible = (rows || []).filter((row) => BigInt(row.amount_wei) > 0n);
  const tree = buildClaimTree(eligible.map((row) => ({ address: row.wallet, amount: row.amount_wei })));
  if (BigInt(tree.total) > BigInt(poolWei)) throw new Error("Calculated rewards exceed this round's budget.");
  if (onlyStored) return tree;
  return { ...tree, shares: eligible.map((row) => ({ wallet: row.wallet, shares: row.shares, amount_wei: row.amount_wei })) };
}
