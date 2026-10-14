"use client";

import type { TCurrBalance } from "@/lib/tcurr";

type Props = {
  walletAddress?: string;
  contractAddress: string;
  draftAddress: string;
  onDraftAddress: (value: string) => void;
  onSaveAddress: () => void;
  balance: TCurrBalance | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onAddToWallet: () => void;
};

function short(value: string) {
  return value.length > 18 ? `${value.slice(0, 8)}…${value.slice(-6)}` : value;
}

export default function TCurrHoldingCard({
  walletAddress, contractAddress, draftAddress, onDraftAddress, onSaveAddress,
  balance, loading, error, onRefresh, onAddToWallet,
}: Props) {
  return <section className="panel onchain-panel">
    <div className="panel-heading">
      <div><div className="eyebrow">LIVE WALLET HOLDING</div><h3>tCURR on Ethereum Sepolia</h3></div>
      <span className="badge badge-green"><span className="badge-dot" />On-chain read</span>
    </div>
    <div className="onchain-grid">
      <div>
        <div className="onchain-balance">
          {loading ? "Reading…" : balance ? balance.display : "—"}
          <small>tCURR</small>
        </div>
        <p className="onchain-caption">
          {!walletAddress ? "Connect an Ethereum wallet to read its holdings." :
            !contractAddress ? "Set the existing Sepolia tCURR contract address below." :
            error ? error : balance ?
              `Read from contract ${short(balance.address)} for ${short(walletAddress)}.` :
              "Reading the connected wallet's Sepolia balance."}
        </p>
        {balance && <div className="onchain-actions">
          <button className="secondary-button" onClick={onRefresh} disabled={loading}>Refresh balance</button>
          <button className="secondary-button" onClick={onAddToWallet}>Add token to wallet</button>
        </div>}
      </div>
      <div className="contract-setting">
        <label className="field-label">Sepolia tCURR contract address
          <input value={draftAddress} onChange={(event) => onDraftAddress(event.target.value)} placeholder="0x…" spellCheck={false} autoComplete="off" />
        </label>
        <button className="secondary-button" onClick={onSaveAddress}>Use this contract</button>
        {contractAddress && <p className="fine-print">Active: <span className="mono">{contractAddress}</span></p>}
        <p className="fine-print">This is the token contract address, not your wallet address. The Portal gets your wallet address when you connect. It checks for contract code and reads the balance from Sepolia. Adding a token to a wallet does not mint any tokens.</p>
      </div>
    </div>
  </section>;
}
