/** Pure, deterministic demo allocation. All amounts use integer token units. */
export function calculateAirdrop(holdings, pool) {
  if (!Number.isSafeInteger(pool) || pool < 0) throw new Error("Invalid pool size");
  const rows = holdings
    .filter((row) => row.eligible && Number.isSafeInteger(row.shares) && row.shares > 0)
    .map((row) => ({ address: row.address.trim(), shares: row.shares }))
    .sort((a, b) => a.address.localeCompare(b.address));
  const seen = new Set();
  for (const row of rows) {
    const key = addressKey(row.address);
    if (!row.address || seen.has(key)) throw new Error("Duplicate or missing address");
    seen.add(key);
  }
  const totalShares = rows.reduce((sum, row) => sum + row.shares, 0);
  if (!Number.isSafeInteger(totalShares)) throw new Error("Share total exceeds safe range");
  if (totalShares === 0) return [];
  const allocations = rows.map((row) => ({
    ...row,
    amount: Number((BigInt(row.shares) * BigInt(pool)) / BigInt(totalShares)),
  }));
  // Distribute rounding remainder in address order so the full pool is accounted for.
  let remainder = pool - allocations.reduce((sum, row) => sum + row.amount, 0);
  for (let i = 0; remainder > 0; i = (i + 1) % allocations.length, remainder--) {
    allocations[i].amount++;
  }
  return allocations;
}

export function claimAllocation(snapshot, address) {
  if (!snapshot || !address) return null;
  return snapshot.allocations.find((row) => addressKey(row.address) === addressKey(address)) ?? null;
}

export function addressKey(address) {
  return address.startsWith("0x") ? address.toLowerCase() : address;
}
