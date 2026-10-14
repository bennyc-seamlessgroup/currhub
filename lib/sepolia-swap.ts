import { Contract, ZeroAddress, formatUnits, getAddress, parseUnits } from "ethers";
import { sepoliaProvider, UCURR_SEPOLIA_ADDRESS, type InjectedEthereum } from "@/lib/tcurr";

// The token and Uniswap v2 addresses are fixed to Ethereum Sepolia (chain 11155111).
export const SEPOLIA_USDC_ADDRESS = "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238";
export const UNISWAP_V2_FACTORY = "0xF62c03E08ada871A0bEb309762E260a7a6a880E6";
export const UNISWAP_V2_ROUTER = "0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3";
export type SwapToken = "uCURR" | "USDC";
export type PoolState = { pair: string | null; reserveUCurr: bigint; reserveUSDC: bigint };

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
const FACTORY_ABI = ["function getPair(address,address) view returns (address)"];
const PAIR_ABI = [
  "function token0() view returns (address)",
  "function getReserves() view returns (uint112 reserve0,uint112 reserve1,uint32 blockTimestampLast)",
  "function balanceOf(address) view returns (uint256)",
  "function totalSupply() view returns (uint256)",
  "function allowance(address,address) view returns (uint256)",
  "function approve(address,uint256) returns (bool)",
];
const ROUTER_ABI = [
  "function getAmountsOut(uint256,address[]) view returns (uint256[])",
  "function addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256) returns (uint256,uint256,uint256)",
  "function removeLiquidity(address,address,uint256,uint256,uint256,address,uint256) returns (uint256,uint256)",
  "function swapExactTokensForTokens(uint256,uint256,address[],address,uint256) returns (uint256[])",
];

export function tokenAddress(token: SwapToken): string {
  return token === "uCURR" ? UCURR_SEPOLIA_ADDRESS : SEPOLIA_USDC_ADDRESS;
}

export function tokenDecimals(token: SwapToken): number {
  return token === "uCURR" ? 18 : 6;
}

export function parseTokenAmount(value: string, token: SwapToken): bigint {
  const trimmed = value.trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(trimmed)) throw new Error(`Enter a valid ${token} amount.`);
  let amount: bigint;
  try { amount = parseUnits(trimmed, tokenDecimals(token)); }
  catch { throw new Error(`${token} supports at most ${tokenDecimals(token)} decimal places.`); }
  if (amount <= 0n) throw new Error(`Enter an amount greater than zero ${token}.`);
  return amount;
}

export function displayTokenAmount(amount: bigint, token: SwapToken, fractionDigits = 6): string {
  const [whole, fraction = ""] = formatUnits(amount, tokenDecimals(token)).split(".");
  const visibleFraction = fraction.slice(0, fractionDigits).replace(/0+$/, "");
  return `${BigInt(whole).toLocaleString("en-US")}${visibleFraction ? `.${visibleFraction}` : ""}`;
}

export function minimumAfterSlippage(amount: bigint): bigint {
  return amount * 99n / 100n; // 1% maximum movement after the displayed quote.
}

export async function swapSigner(injected: InjectedEthereum, wallet: string) {
  const provider = await sepoliaProvider(injected);
  const accounts = await injected.request({ method: "eth_accounts" }) as string[];
  if (!accounts.some((account) => account.toLowerCase() === wallet.toLowerCase())) {
    throw new Error("The connected wallet changed. Reconnect it before continuing.");
  }
  return provider.getSigner(getAddress(wallet));
}

export async function readPool(injected: InjectedEthereum): Promise<PoolState> {
  const provider = await sepoliaProvider(injected);
  const factory = new Contract(UNISWAP_V2_FACTORY, FACTORY_ABI, provider);
  const pair = getAddress(await factory.getPair(UCURR_SEPOLIA_ADDRESS, SEPOLIA_USDC_ADDRESS) as string);
  if (pair === ZeroAddress) return { pair: null, reserveUCurr: 0n, reserveUSDC: 0n };
  const contract = new Contract(pair, PAIR_ABI, provider);
  const [token0, reserves] = await Promise.all([
    contract.token0() as Promise<string>,
    contract.getReserves() as Promise<[bigint, bigint, bigint]>,
  ]);
  const ucurrFirst = token0.toLowerCase() === UCURR_SEPOLIA_ADDRESS.toLowerCase();
  return {
    pair,
    reserveUCurr: ucurrFirst ? reserves[0] : reserves[1],
    reserveUSDC: ucurrFirst ? reserves[1] : reserves[0],
  };
}

export async function readSwapBalance(injected: InjectedEthereum, wallet: string, token: SwapToken): Promise<bigint> {
  const provider = await sepoliaProvider(injected);
  return new Contract(tokenAddress(token), ERC20_ABI, provider).balanceOf(getAddress(wallet)) as Promise<bigint>;
}

export async function readSwapAllowance(injected: InjectedEthereum, wallet: string, token: SwapToken): Promise<bigint> {
  const provider = await sepoliaProvider(injected);
  return new Contract(tokenAddress(token), ERC20_ABI, provider).allowance(getAddress(wallet), UNISWAP_V2_ROUTER) as Promise<bigint>;
}

export async function readLiquidityPosition(injected: InjectedEthereum, wallet: string, pair: string) {
  const provider = await sepoliaProvider(injected);
  const contract = new Contract(getAddress(pair), PAIR_ABI, provider);
  const [balance, totalSupply, allowance] = await Promise.all([
    contract.balanceOf(getAddress(wallet)) as Promise<bigint>,
    contract.totalSupply() as Promise<bigint>,
    contract.allowance(getAddress(wallet), UNISWAP_V2_ROUTER) as Promise<bigint>,
  ]);
  return { balance, totalSupply, allowance };
}

export async function quoteSwap(injected: InjectedEthereum, input: SwapToken, amountIn: bigint): Promise<bigint> {
  if (amountIn <= 0n) throw new Error("Enter an amount greater than zero.");
  const provider = await sepoliaProvider(injected);
  const router = new Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, provider);
  const output: SwapToken = input === "uCURR" ? "USDC" : "uCURR";
  const amounts = await router.getAmountsOut(amountIn, [tokenAddress(input), tokenAddress(output)]) as bigint[];
  return amounts[1];
}

export async function approveForSwap(injected: InjectedEthereum, wallet: string, token: SwapToken, amount: bigint) {
  const signer = await swapSigner(injected, wallet);
  return new Contract(tokenAddress(token), ERC20_ABI, signer).approve(UNISWAP_V2_ROUTER, amount);
}

export async function createSwapPool(injected: InjectedEthereum, wallet: string, ucurrAmount: bigint, usdcAmount: bigint) {
  const signer = await swapSigner(injected, wallet);
  const router = new Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, signer);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  return router.addLiquidity(
    UCURR_SEPOLIA_ADDRESS, SEPOLIA_USDC_ADDRESS,
    ucurrAmount, usdcAmount,
    minimumAfterSlippage(ucurrAmount), minimumAfterSlippage(usdcAmount),
    getAddress(wallet), deadline,
  );
}

export async function approveLiquidityWithdrawal(injected: InjectedEthereum, wallet: string, pair: string, amount: bigint) {
  const signer = await swapSigner(injected, wallet);
  return new Contract(getAddress(pair), PAIR_ABI, signer).approve(UNISWAP_V2_ROUTER, amount);
}

export async function removeLiquidity(injected: InjectedEthereum, wallet: string, liquidity: bigint, minimumUCurr: bigint, minimumUSDC: bigint) {
  const signer = await swapSigner(injected, wallet);
  const router = new Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, signer);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  return router.removeLiquidity(UCURR_SEPOLIA_ADDRESS, SEPOLIA_USDC_ADDRESS, liquidity, minimumUCurr, minimumUSDC, getAddress(wallet), deadline);
}

export async function executeSwap(injected: InjectedEthereum, wallet: string, input: SwapToken, amountIn: bigint, minimumOut: bigint) {
  const signer = await swapSigner(injected, wallet);
  const output: SwapToken = input === "uCURR" ? "USDC" : "uCURR";
  const router = new Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, signer);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60);
  return router.swapExactTokensForTokens(amountIn, minimumOut, [tokenAddress(input), tokenAddress(output)], getAddress(wallet), deadline);
}

export function swapError(error: unknown): string {
  if (error && typeof error === "object" && "code" in error) {
    if (error.code === "ACTION_REJECTED" || error.code === 4001) return "You cancelled the request in your wallet.";
    if (error.code === "CALL_EXCEPTION") return "The Sepolia transaction failed. Check its Etherscan link below.";
  }
  if (error instanceof Error && error.message.length < 220) return error.message;
  return "The wallet could not complete this Sepolia step. Check your network and token balances.";
}
