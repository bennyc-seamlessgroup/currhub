import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const names = ["UCURRTest.sol", "TCURRTest.sol", "UCURRAirdrop.sol"];
const sources = Object.fromEntries(names.map((name) => [name, { content: fs.readFileSync(path.join(root, "contracts", name), "utf8") }]));
const input = { language: "Solidity", sources, settings: { optimizer: { enabled: true, runs: 200 }, outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } } } };
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: (importPath) => {
  const resolved = path.join(root, "node_modules", importPath);
  try { return { contents: fs.readFileSync(resolved, "utf8") }; }
  catch { return { error: `Cannot resolve ${importPath}` }; }
} }));
for (const issue of output.errors ?? []) {
  if (issue.severity === "error") console.error(issue.formattedMessage);
}
if ((output.errors ?? []).some((issue) => issue.severity === "error")) process.exit(1);
const artifacts = {};
for (const [file, contracts] of Object.entries(output.contracts ?? {})) {
  if (!names.includes(file)) continue;
  for (const [name, artifact] of Object.entries(contracts)) {
    if (!artifact.evm?.bytecode?.object) throw new Error(`Missing bytecode for ${name}`);
    artifacts[name] = { abi: artifact.abi, bytecode: `0x${artifact.evm.bytecode.object}` };
    console.log(`${name}: compiled (${artifact.abi.length} ABI entries)`);
  }
}
const target = path.join(root, "lib", "test-contract-artifacts.json");
const generated = `${JSON.stringify(artifacts)}\n`;
if (process.argv.includes("--write-artifacts")) {
  fs.writeFileSync(target, generated);
  console.log(`Wrote ${path.relative(root, target)}`);
} else if (process.argv.includes("--check-artifacts")) {
  if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== generated) {
    console.error("Test contract artifacts are stale. Run npm run contracts:artifacts.");
    process.exit(1);
  }
  console.log("Test contract artifacts match source.");
}
