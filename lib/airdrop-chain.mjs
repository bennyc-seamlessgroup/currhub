import { AbiCoder, concat, getAddress, keccak256 } from "ethers";

const coder = AbiCoder.defaultAbiCoder();

export function allocateRewardPool(holdings, poolWei) {
  const pool = BigInt(poolWei);
  if (pool <= 0n) throw new Error("Reward pool must be greater than zero.");
  const seen = new Set();
  const rows = holdings.filter((row) => row.approved && BigInt(row.shares) > 0n)
    .map((row) => ({ address: getAddress(row.address), shares: BigInt(row.shares) }))
    .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  for (const row of rows) {
    const key = row.address.toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate wallet in snapshot.");
    seen.add(key);
  }
  if (!rows.length) return [];
  const totalShares = rows.reduce((sum, row) => sum + row.shares, 0n);
  const allocations = rows.map((row) => ({ ...row, amount: row.shares * pool / totalShares }));
  let remainder = pool - allocations.reduce((sum, row) => sum + row.amount, 0n);
  for (let i = 0; remainder > 0n; i++, remainder--) allocations[i % allocations.length].amount++;
  return allocations;
}

// tCURR has zero decimals; uCURR amounts and limits are in wei.
export function calculateRatioRewards(holdings, ratioShares, ratioRewardWei, minimumWei = null, maximumWei = null) {
  const sharesPerRatio = BigInt(ratioShares);
  const rewardPerRatio = BigInt(ratioRewardWei);
  const minimum = minimumWei === null ? null : BigInt(minimumWei);
  const maximum = maximumWei === null ? null : BigInt(maximumWei);
  if (sharesPerRatio <= 0n || rewardPerRatio <= 0n || (minimum !== null && minimum < 0n) ||
      (maximum !== null && maximum <= 0n) || (minimum !== null && maximum !== null && minimum > maximum)) {
    throw new Error("Invalid reward ratio or limits.");
  }
  const seen = new Set();
  return holdings.map((row) => {
    const address = getAddress(row.address);
    const shares = BigInt(row.shares);
    const key = address.toLowerCase();
    if (seen.has(key) || shares < 0n) throw new Error("Duplicate wallet or invalid tCURR balance.");
    seen.add(key);
    let amount = shares * rewardPerRatio / sharesPerRatio;
    if (minimum !== null && amount < minimum) amount = 0n;
    if (maximum !== null && amount > maximum) amount = maximum;
    return { address, shares, amount };
  }).sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
}

export function allocationLeaf(address, amount) {
  return keccak256(keccak256(coder.encode(["address", "uint256"], [getAddress(address), BigInt(amount)])));
}

function hashPair(left, right) {
  const [first, second] = left.toLowerCase() < right.toLowerCase() ? [left, right] : [right, left];
  return keccak256(concat([first, second]));
}

export function buildClaimTree(allocations) {
  if (!allocations.length) throw new Error("No approved allocations.");
  const entries = allocations.map((row) => ({ address: getAddress(row.address), amount: BigInt(row.amount) }));
  if (entries.some((row) => row.amount <= 0n)) throw new Error("Every published allocation must be positive.");
  const leaves = entries.map((row) => allocationLeaf(row.address, row.amount));
  const levels = [leaves];
  while (levels.at(-1).length > 1) {
    const current = levels.at(-1);
    const next = [];
    for (let i = 0; i < current.length; i += 2) next.push(i + 1 < current.length ? hashPair(current[i], current[i + 1]) : current[i]);
    levels.push(next);
  }
  const proofs = entries.map((row, index) => {
    const proof = [];
    let offset = index;
    for (let depth = 0; depth < levels.length - 1; depth++) {
      const sibling = offset ^ 1;
      if (sibling < levels[depth].length) proof.push(levels[depth][sibling]);
      offset = Math.floor(offset / 2);
    }
    return { address: row.address, amount: row.amount.toString(), proof };
  });
  return { root: levels.at(-1)[0], total: entries.reduce((sum, row) => sum + row.amount, 0n).toString(), proofs };
}
