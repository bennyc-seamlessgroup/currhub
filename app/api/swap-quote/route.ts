import { JsonRpcProvider } from "ethers";
import { parseTokenAmount, quoteSwapFromProvider, readPoolFromProvider, type SwapToken } from "@/lib/sepolia-swap";

const rpc = new JsonRpcProvider(process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com", 11155111, { staticNetwork: true });

export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = url.searchParams.get("input");
  const amount = url.searchParams.get("amount") || "";
  if ((input !== "uCURR" && input !== "USDC") || amount.length > 32) {
    return Response.json({ error: "Choose a token and enter an amount." }, { status: 400 });
  }
  let amountIn: bigint;
  try { amountIn = parseTokenAmount(amount, input as SwapToken); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Enter a valid amount." }, { status: 400 }); }
  try {
    const pool = await readPoolFromProvider(rpc);
    const amountOut = pool.pair && pool.reserveUCurr > 0n && pool.reserveUSDC > 0n
      ? await quoteSwapFromProvider(rpc, input, amountIn) : 0n;
    return Response.json({
      pair: pool.pair,
      reserveUCurr: pool.reserveUCurr.toString(),
      reserveUSDC: pool.reserveUSDC.toString(),
      amountOut: amountOut.toString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Quote is temporarily unavailable. Please try again." }, { status: 503 });
  }
}
