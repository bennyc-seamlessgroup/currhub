import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";
import ts from "typescript";

// Load the actual TypeScript module without adding a second copy of the reset math.
const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../lib/sepolia-swap.ts", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const module = { exports: {} };
vm.runInNewContext(compiled, {
  module, exports: module.exports,
  require: (name) => name === "@/lib/tcurr" ? { UCURR_SEPOLIA_ADDRESS: "0xB7E470175c2f271394c5e5F7348d46A1F5EfCbc1" } : require(name),
});
const { assessPoolReset, samePoolResetState } = module.exports;

const dust = {
  pair: "0x3b9B3Eddcfb179b47BEc17ECCaBe2Ff3f2DCfa26",
  reserveUCurr: 3237134626n,
  reserveUSDC: 1n,
  balanceUCurr: 3237134626n,
  balanceUSDC: 1n,
  lpSupply: 1000n,
  burnedLP: 1000n,
  minimumLiquidity: 1000n,
};

test("calculates the exact tiny transfer for 10 uCURR per test USDC", () => {
  assert.equal(assessPoolReset(dust).stage, "transfer");
  assert.equal(assessPoolReset(dust).donation, 9996762865374n);
  assert.equal(assessPoolReset({ ...dust, balanceUCurr: 10000000000000n }).stage, "sync");
  assert.equal(assessPoolReset({ ...dust, balanceUCurr: 10000000000000n, reserveUCurr: 10000000000000n }).stage, "complete");
});

test("refuses to reset while a wallet owns pool liquidity", () => {
  assert.equal(assessPoolReset({ ...dust, lpSupply: 2000n }).stage, "unavailable");
  assert.equal(assessPoolReset({ ...dust, burnedLP: 999n }).stage, "unavailable");
});

test("refuses unexpected balances or excessive dust", () => {
  assert.equal(assessPoolReset({ ...dust, balanceUSDC: 2n }).stage, "unavailable");
  assert.equal(assessPoolReset({ ...dust, balanceUCurr: dust.balanceUCurr + 1n }).stage, "unavailable");
  assert.equal(assessPoolReset({ ...dust, reserveUSDC: 1001n, balanceUSDC: 1001n }).stage, "unavailable");
  assert.equal(assessPoolReset({ ...dust, reserveUCurr: 11000000000000n, balanceUCurr: 11000000000000n }).stage, "unavailable");
});

test("compares the full pool snapshot before prompting a wallet", () => {
  assert.equal(samePoolResetState(dust, { ...dust }), true);
  assert.equal(samePoolResetState(dust, { ...dust, balanceUCurr: dust.balanceUCurr + 1n }), false);
});
