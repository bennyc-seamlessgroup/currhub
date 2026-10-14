import test from "node:test";
import assert from "node:assert/strict";
import { addressKey, calculateAirdrop, claimAllocation } from "../lib/airdrop.mjs";

test("allocates the entire pool proportionally and deterministically", () => {
  const rows = [
    { address: "0xB", shares: 2, eligible: true },
    { address: "0xA", shares: 1, eligible: true },
    { address: "0xC", shares: 8, eligible: false },
  ];
  const result = calculateAirdrop(rows, 100);
  assert.deepEqual(result.map(({ address, amount }) => [address, amount]), [["0xA", 34], ["0xB", 66]]);
  assert.equal(result.reduce((sum, row) => sum + row.amount, 0), 100);
});

test("excludes zero holdings and rejects duplicate addresses", () => {
  assert.deepEqual(calculateAirdrop([{ address: "a", shares: 0, eligible: true }], 10), []);
  assert.throws(() => calculateAirdrop([
    { address: "0xA", shares: 1, eligible: true },
    { address: "0xa", shares: 1, eligible: true },
  ], 10), /Duplicate/);
});

test("claim lookup is case insensitive and does not mutate a snapshot", () => {
  const snapshot = { allocations: [{ address: "0xAbC", amount: 25 }] };
  assert.equal(claimAllocation(snapshot, "0xabc")?.amount, 25);
  assert.equal(claimAllocation(snapshot, "0xdef"), null);
  assert.equal(snapshot.allocations[0].amount, 25);
});

test("Solana addresses remain case sensitive", () => {
  assert.notEqual(addressKey("AbCd"), addressKey("abcd"));
  assert.equal(addressKey("0xAbCd"), addressKey("0xabcd"));
});
