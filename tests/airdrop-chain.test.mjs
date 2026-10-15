import test from "node:test";
import assert from "node:assert/strict";
import { allocateRewardPool, calculateRatioRewards, allocationLeaf, buildClaimTree } from "../lib/airdrop-chain.mjs";
import { concat, keccak256 } from "ethers";

const addresses = [
  "0x0000000000000000000000000000000000000001",
  "0x0000000000000000000000000000000000000002",
  "0x0000000000000000000000000000000000000003",
];

test("the approved snapshot receives the entire integer reward pool", () => {
  const rows = allocateRewardPool([
    { address: addresses[1], shares: "2", approved: true },
    { address: addresses[0], shares: "1", approved: true },
    { address: addresses[2], shares: "9", approved: false },
  ], "100000000000000000000");
  assert.equal(rows.length, 2);
  assert.equal(rows.reduce((sum, row) => sum + row.amount, 0n), 100000000000000000000n);
  assert.equal(rows[0].address, addresses[0]);
});

test("ratio rewards do not shrink when another holder is added", () => {
  const one = calculateRatioRewards([{ address: addresses[0], shares: "500" }], "10", "1000000000000000000");
  const two = calculateRatioRewards([{ address: addresses[0], shares: "500" }, { address: addresses[1], shares: "1000" }], "10", "1000000000000000000");
  assert.equal(one[0].amount, 50n * 10n ** 18n);
  assert.equal(two[0].amount, one[0].amount);
  assert.equal(two[1].amount, 100n * 10n ** 18n);
});

test("minimum excludes small rewards and maximum caps large rewards", () => {
  const rewards = calculateRatioRewards([
    { address: addresses[0], shares: "100" },
    { address: addresses[1], shares: "500" },
    { address: addresses[2], shares: "2000" },
  ], "10", "1000000000000000000", "20000000000000000000", "80000000000000000000");
  assert.deepEqual(rewards.map((row) => row.amount / 10n ** 18n), [0n, 50n, 80n]);
  assert.equal(calculateRatioRewards([{ address: addresses[0], shares: "100" }], "10", "1000000000000000000")[0].amount, 10n ** 19n);
});

test("each proof reconstructs the published root, including an odd final leaf", () => {
  const tree = buildClaimTree(addresses.map((address, i) => ({ address, amount: BigInt(i + 1) })));
  assert.equal(tree.total, "6");
  for (const entry of tree.proofs) {
    let hash = allocationLeaf(entry.address, entry.amount);
    for (const sibling of entry.proof) {
      const pair = hash.toLowerCase() < sibling.toLowerCase() ? [hash, sibling] : [sibling, hash];
      hash = keccak256(concat(pair));
    }
    assert.equal(hash, tree.root);
  }
});
