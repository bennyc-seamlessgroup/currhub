export type Holding = { address: string; shares: number; eligible: boolean };
export type Allocation = { address: string; shares: number; amount: number };
export function calculateAirdrop(holdings: Holding[], pool: number): Allocation[];
export function claimAllocation(snapshot: { allocations: Allocation[] } | null, address: string): Allocation | null;
export function addressKey(address: string): string;
