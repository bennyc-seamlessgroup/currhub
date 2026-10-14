"use client";

import { useEffect, useRef } from "react";

export type WalletChoice = {
  id: string;
  name: string;
  onSelect: () => void;
};

type Props = {
  open: boolean;
  chain: "ethereum" | "solana" | "all";
  ethereum: WalletChoice[];
  solana: WalletChoice[];
  onClose: () => void;
  onRefresh: () => void;
};

export default function WalletPicker({ open, chain, ethereum, solana, onClose, onRefresh }: Props) {
  const dialog = useRef<HTMLDivElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    if (!open) return;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
      if (event.key === "Tab") {
        const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") || []);
        const first = buttons[0];
        const last = buttons[buttons.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus();
    };
  }, [open]);

  if (!open) return null;
  const showEthereum = chain === "all" || chain === "ethereum";
  const showSolana = chain === "all" || chain === "solana";

  return <div className="wallet-picker-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className="wallet-picker" role="dialog" aria-modal="true" aria-labelledby="wallet-picker-title">
      <div className="wallet-picker-header">
        <div><div className="eyebrow">WALLET CONNECTION</div><h2 id="wallet-picker-title">Choose your wallet</h2></div>
        <button ref={closeButton} className="wallet-picker-close" onClick={onClose} aria-label="Close wallet picker">×</button>
      </div>
      <p className="wallet-picker-intro">Select a wallet installed in this browser. Your wallet will ask you to approve the connection; you never need to type your wallet address here.</p>
      {showEthereum && <section className="wallet-picker-group" aria-label="Ethereum Sepolia wallets">
        <strong>Ethereum Sepolia</strong>
        {ethereum.length ? ethereum.map((wallet) => <button className="wallet-picker-option" key={wallet.id} onClick={wallet.onSelect}><span className="wallet-picker-icon">◆</span><span>{wallet.name}<small>Connect on Ethereum Sepolia</small></span><span aria-hidden="true">↗</span></button>) : <p className="wallet-picker-empty">No Ethereum wallet detected in this browser. Install and unlock a compatible wallet, then refresh the list.</p>}
      </section>}
      {showSolana && <section className="wallet-picker-group" aria-label="Solana Devnet wallets">
        <strong>Solana Devnet</strong>
        {solana.length ? solana.map((wallet) => <button className="wallet-picker-option" key={wallet.id} onClick={wallet.onSelect}><span className="wallet-picker-icon sol">≋</span><span>{wallet.name}<small>Connect a Solana address</small></span><span aria-hidden="true">↗</span></button>) : <p className="wallet-picker-empty">No Solana wallet detected in this browser. Install and unlock a compatible wallet, then refresh the list.</p>}
      </section>}
      <button className="wallet-picker-refresh" onClick={onRefresh}>Refresh installed wallets</button>
      <p className="fine-print">This browser picker supports installed wallet extensions. Connecting lets the Portal read public testnet balances; it does not request a transaction signature.</p>
    </div>
  </div>;
}
