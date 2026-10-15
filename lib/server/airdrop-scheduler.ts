import "server-only";
import { Contract, Interface, JsonRpcProvider, getAddress, id } from "ethers";
import { airdropDb } from "@/lib/server/airdrop-db";
import { airdropRpc } from "@/lib/server/airdrop-snapshot";
import { buildClaimTree, calculateRatioRewards } from "@/lib/airdrop-chain.mjs";
import { TCURR_SEPOLIA_ADDRESS, TCURR_SEPOLIA_DEPLOYMENT_BLOCK } from "@/lib/tcurr";

const ZERO = "0x0000000000000000000000000000000000000000";
const transfer = new Interface(["event Transfer(address indexed from, address indexed to, uint256 value)"]);
const topic = id("Transfer(address,address,uint256)");
const BLOCKS_PER_RUN = 4000;

type ScheduledRound = {
  id: string; snapshot_at: string; snapshot_block: number | null; snapshot_hash: string | null;
  snapshot_cursor_block: number | null; snapshot_balances: Record<string, string> | null;
  ratio_shares: number; ratio_reward_wei: string; minimum_wei: string | null;
  maximum_wei: string | null; pool_wei: string;
};

async function blockAtTime(provider: JsonRpcProvider, unixSeconds: number) {
  const safeTip = await provider.getBlockNumber() - 6;
  const tip = await provider.getBlock(safeTip);
  if (!tip || tip.timestamp < unixSeconds) return null;
  const deployed = await provider.getBlock(TCURR_SEPOLIA_DEPLOYMENT_BLOCK);
  if (!deployed || deployed.timestamp > unixSeconds) throw new Error("Snapshot time precedes tCURR deployment.");
  let low = TCURR_SEPOLIA_DEPLOYMENT_BLOCK;
  let high = safeTip;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    const block = await provider.getBlock(mid);
    if (!block) throw new Error("Sepolia historical blocks are unavailable from the configured RPC.");
    if (block.timestamp <= unixSeconds) low = mid;
    else high = mid - 1;
  }
  const block = await provider.getBlock(low);
  if (!block?.hash) throw new Error("Could not verify the snapshot block.");
  return { number: low, hash: block.hash };
}

async function applyTransfers(provider: JsonRpcProvider, balances: Map<string, bigint>, first: number, last: number) {
  for (let start = first; start <= last; start += 1000) {
    const logs = await provider.getLogs({ address: TCURR_SEPOLIA_ADDRESS, topics: [topic], fromBlock: start, toBlock: Math.min(start + 999, last) });
    for (const log of logs) {
      const event = transfer.parseLog(log);
      if (!event) continue;
      const from = (event.args[0] as string).toLowerCase();
      const to = (event.args[1] as string).toLowerCase();
      const amount = event.args[2] as bigint;
      if (from !== ZERO) balances.set(from, (balances.get(from) || 0n) - amount);
      if (to !== ZERO) balances.set(to, (balances.get(to) || 0n) + amount);
    }
  }
}

export async function processDueSnapshot() {
  const db = airdropDb();
  const { data: due, error } = await db.from("airdrop_campaigns").select("id,snapshot_at,snapshot_block,snapshot_hash,snapshot_cursor_block,snapshot_balances,ratio_shares,ratio_reward_wei,minimum_wei,maximum_wei,pool_wei")
    .eq("status", "scheduled").lte("snapshot_at", new Date().toISOString()).order("snapshot_at").limit(1);
  if (error) throw error;
  const round = due?.[0] as ScheduledRound | undefined;
  if (!round) return { state: "nothing_due" };
  const provider = airdropRpc();
  try {
    let target = round.snapshot_block;
    let hash = round.snapshot_hash;
    let cursor = round.snapshot_cursor_block;
    if (target === null) {
      const chosen = await blockAtTime(provider, Math.floor(new Date(round.snapshot_at).valueOf() / 1000));
      if (!chosen) return { state: "waiting_for_finality", roundId: round.id };
      target = chosen.number; hash = chosen.hash; cursor = TCURR_SEPOLIA_DEPLOYMENT_BLOCK - 1;
      const { data: updated, error: updateError } = await db.from("airdrop_campaigns").update({ snapshot_start: TCURR_SEPOLIA_DEPLOYMENT_BLOCK, snapshot_block: target, snapshot_hash: hash, snapshot_cursor_block: cursor, snapshot_error: null })
        .eq("id", round.id).eq("status", "scheduled").is("snapshot_block", null).select("id");
      if (updateError) throw updateError;
      if (!updated?.length) return { state: "already_processing", roundId: round.id };
    }
    if (target === null || cursor === null || !hash) throw new Error("Snapshot checkpoint is incomplete.");
    const balances = new Map<string, bigint>(Object.entries(round.snapshot_balances || {}).map(([wallet, balance]) => [wallet, BigInt(balance)]));
    const end = Math.min(target, cursor + BLOCKS_PER_RUN);
    if (cursor < end) await applyTransfers(provider, balances, cursor + 1, end);
    const serialized = Object.fromEntries([...balances].map(([wallet, balance]) => [wallet, balance.toString()]));
    const { data: checkpoint, error: checkpointError } = await db.from("airdrop_campaigns").update({ snapshot_cursor_block: end, snapshot_balances: serialized, snapshot_error: null })
      .eq("id", round.id).eq("status", "scheduled").eq("snapshot_cursor_block", cursor).select("id");
    if (checkpointError) throw checkpointError;
    if (!checkpoint?.length) return { state: "already_processing", roundId: round.id };
    if (end < target) return { state: "scanning", roundId: round.id, scannedThrough: end, target };

    if ([...balances.values()].some((value) => value < 0n)) throw new Error("Transfer history produced a negative tCURR balance.");
    const holders = [...balances].filter(([, value]) => value > 0n).map(([address, shares]) => ({ address: getAddress(address), shares }));
    if (!holders.length || holders.length > 500) throw new Error("Snapshot must contain between 1 and 500 tCURR holders.");
    const token = new Contract(TCURR_SEPOLIA_ADDRESS, ["function totalSupply() view returns (uint256)"], provider);
    const supply = await token.totalSupply({ blockTag: target }) as bigint;
    if (holders.reduce((sum, row) => sum + row.shares, 0n) !== supply) throw new Error("Snapshot does not match historical tCURR supply; check the RPC provider.");
    const block = await provider.getBlock(target);
    if (block?.hash !== hash) throw new Error("Snapshot block changed; retry after the chain settles.");
    const rewards = calculateRatioRewards(holders, BigInt(round.ratio_shares), round.ratio_reward_wei, round.minimum_wei, round.maximum_wei);
    const total = rewards.reduce((sum, row) => sum + row.amount, 0n);
    const rows = rewards.map((row) => ({ campaign_id: round.id, wallet: row.address.toLowerCase(), shares: row.shares.toString(), amount_wei: row.amount.toString() }));
    const { error: rowsError } = await db.from("airdrop_allocations").upsert(rows);
    if (rowsError) throw rowsError;
    const state = total === 0n ? "failed" : total > BigInt(round.pool_wei) ? "needs_budget" : "prepared";
    const tree = total > 0n && state === "prepared" ? buildClaimTree(rewards.filter((row) => row.amount > 0n)) : null;
    const { error: finishError } = await db.from("airdrop_campaigns").update({ status: state, allocated_wei: total.toString(), merkle_root: tree?.root || null, snapshot_balances: {}, snapshot_error: state === "failed" ? "No wallet meets this round's minimum reward." : null })
      .eq("id", round.id).eq("status", "scheduled").eq("snapshot_cursor_block", target);
    if (finishError) throw finishError;
    return { state, roundId: round.id, holders: holders.length, allocationWei: total.toString() };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message.slice(0, 500) : "Snapshot failed.";
    await db.from("airdrop_campaigns").update({ snapshot_error: message }).eq("id", round.id).eq("status", "scheduled");
    throw cause;
  }
}
