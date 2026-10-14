import {
  BrowserProvider,
  Contract,
  formatUnits,
  getAddress,
  isAddress,
} from "ethers";

const ERC20_READ_ABI = [
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

export const SEPOLIA_ID = 11155111n;

export type InjectedEthereum = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
};

export type TokenBalance = {
  address: string;
  balance: bigint;
  display: string;
  decimals: number;
};
export type TCurrBalance = TokenBalance;

export function validEthereumAddress(value: string): boolean {
  return isAddress(value);
}

export async function sepoliaProvider(injected: InjectedEthereum): Promise<BrowserProvider> {
  const chainId = await injected.request({ method: "eth_chainId" });
  if (typeof chainId !== "string" || BigInt(chainId) !== SEPOLIA_ID) {
    throw new Error("Select Ethereum Sepolia in your wallet, then reconnect.");
  }
  return new BrowserProvider(injected);
}

export async function readTokenBalance(
  injected: InjectedEthereum,
  contractAddress: string,
  walletAddress: string,
  expectedSymbol: "tCURR" | "uCURR",
): Promise<TokenBalance> {
  if (!isAddress(contractAddress)) throw new Error(`Enter a valid ${expectedSymbol} contract address.`);
  if (!isAddress(walletAddress)) throw new Error("Wallet address is invalid.");
  const provider = await sepoliaProvider(injected);
  const address = getAddress(contractAddress);
  const code = await provider.getCode(address);
  if (code === "0x") throw new Error(`No ${expectedSymbol} contract was found at this address on Sepolia.`);
  const contract = new Contract(address, ERC20_READ_ABI, provider);
  const [symbol, decimalsRaw, balance] = await Promise.all([
    contract.symbol() as Promise<string>,
    contract.decimals() as Promise<bigint>,
    contract.balanceOf(getAddress(walletAddress)) as Promise<bigint>,
  ]);
  const decimals = Number(decimalsRaw);
  if (symbol !== expectedSymbol || !Number.isInteger(decimals) || decimals < 0 || decimals > 36) {
    throw new Error(`This Sepolia contract did not return valid ${expectedSymbol} token metadata.`);
  }
  const display = decimals === 0 ? balance.toLocaleString("en-US") : formatUnits(balance, decimals);
  return {
    address,
    balance,
    display,
    decimals,
  };
}

export function readTCurrBalance(injected: InjectedEthereum, contractAddress: string, walletAddress: string): Promise<TCurrBalance> {
  return readTokenBalance(injected, contractAddress, walletAddress, "tCURR");
}

export async function suggestTokenInWallet(
  injected: InjectedEthereum,
  token: TokenBalance,
  symbol: "tCURR" | "uCURR" = "tCURR",
): Promise<void> {
  await sepoliaProvider(injected);
  await injected.request({
    method: "wallet_watchAsset",
    params: [{
      type: "ERC20",
      options: {
        address: token.address,
        chainId: Number(SEPOLIA_ID),
        symbol,
        decimals: token.decimals,
      },
    }],
  });
}
