import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import solc from "solc";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const names = ["UCURRTest.sol", "TCURRTest.sol"];
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
for (const [file, contracts] of Object.entries(output.contracts ?? {})) {
  if (!names.includes(file)) continue;
  for (const [name, artifact] of Object.entries(contracts)) {
    if (!artifact.evm?.bytecode?.object) throw new Error(`Missing bytecode for ${name}`);
    console.log(`${name}: compiled (${artifact.abi.length} ABI entries)`);
  }
}
