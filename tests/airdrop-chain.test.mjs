import test from "node:test";
import assert from "node:assert/strict";
import { allocateRewardPool, allocationLeaf, buildClaimTree } from "../lib/airdrop-chain.mjs";
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
