export type HoldingRow = { address: string; shares: string | bigint; approved: boolean };
export type RewardRow = { address: string; shares: bigint; amount: bigint };
export function allocateRewardPool(holdings: HoldingRow[], poolWei: string | bigint): RewardRow[];
export function allocationLeaf(address: string, amount: string | bigint): string;
export function buildClaimTree(allocations: { address: string; amount: string | bigint }[]): {
  root: string;
  total: string;
  proofs: { address: string; amount: string; proof: string[] }[];
};
