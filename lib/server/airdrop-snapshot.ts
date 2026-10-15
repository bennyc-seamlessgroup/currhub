import "server-only";
import { Contract, Interface, JsonRpcProvider, getAddress, id } from "ethers";
import { TCURR_SEPOLIA_ADDRESS, TCURR_SEPOLIA_DEPLOYMENT_BLOCK } from "@/lib/tcurr";

const ZERO = "0x0000000000000000000000000000000000000000";
const transferInterface = new Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const transferTopic = id("Transfer(address,address,uint256)");

export function airdropRpc() {
  return new JsonRpcProvider(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", 11155111, { staticNetwork: true });
}

export async function findTCurrDeploymentBlock() {
  return TCURR_SEPOLIA_DEPLOYMENT_BLOCK;
}

export async function takeTCurrSnapshot(start: number, end: number) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || end - start > 50000) {
    throw new Error("Choose a valid snapshot range of at most 50,000 blocks.");
  }
  const provider = airdropRpc();
  const latest = await provider.getBlockNumber();
  if (end > latest - 6) throw new Error("Choose a snapshot block at least six blocks behind the chain tip.");
  const [before, atBlock, block] = await Promise.all([
    start > 0 ? provider.getCode(TCURR_SEPOLIA_ADDRESS, start - 1) : Promise.resolve("0x"),
    provider.getCode(TCURR_SEPOLIA_ADDRESS, end),
    provider.getBlock(end),
  ]);
  if (before !== "0x") throw new Error("The start block is after tCURR deployment; earlier holders would be missed.");
  if (atBlock === "0x" || !block) throw new Error("tCURR was not deployed at the snapshot block.");
  const balances = new Map<string, bigint>();
  for (let fromBlock = start; fromBlock <= end; fromBlock += 1000) {
    const logs = await provider.getLogs({ address: TCURR_SEPOLIA_ADDRESS, topics: [transferTopic], fromBlock, toBlock: Math.min(end, fromBlock + 999) });
    for (const log of logs) {
      const event = transferInterface.parseLog(log);
      if (!event) continue;
      const from = (event.args[0] as string).toLowerCase();
      const to = (event.args[1] as string).toLowerCase();
      const amount = event.args[2] as bigint;
      if (from !== ZERO) balances.set(from, (balances.get(from) || 0n) - amount);
      if (to !== ZERO) balances.set(to, (balances.get(to) || 0n) + amount);
    }
  }
  if ([...balances.values()].some((balance) => balance < 0n)) throw new Error("Snapshot is incomplete; check the start block and RPC provider.");
  const holders = [...balances.entries()].filter(([, shares]) => shares > 0n)
    .map(([address, shares]) => ({ address: getAddress(address), shares: shares.toString() }))
    .sort((a, b) => a.address.toLowerCase().localeCompare(b.address.toLowerCase()));
  if (holders.length > 500) throw new Error("This pilot supports up to 500 holder wallets per round.");
  const token = new Contract(TCURR_SEPOLIA_ADDRESS, ["function totalSupply() view returns (uint256)"], provider);
  const supply = await token.totalSupply({ blockTag: end }) as bigint;
  if (holders.reduce((sum, row) => sum + BigInt(row.shares), 0n) !== supply) throw new Error("Snapshot supply did not match tCURR; check the start block and RPC provider.");
  return { blockHash: block.hash!, holders };
}
