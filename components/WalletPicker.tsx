"use client";

import { useEffect, useRef } from "react";

export type WalletChoice = {
  id: string;
  name: string;
  network: string;
  icon?: string;
  kind: "metamask" | "phantom" | "other";
  onSelect?: () => void;
  installUrl?: string;
};

type Props = {
  open: boolean;
  choices: WalletChoice[];
  onClose: () => void;
  onRefresh: () => void;
};

function WalletIcon({ choice }: { choice: WalletChoice }) {
  if (choice.icon?.startsWith("data:image/")) {
    // Wallet-provided EIP-6963 icons are data URLs, not remote image requests.
    // eslint-disable-next-line @next/next/no-img-element
    return <img className="wallet-logo" src={choice.icon} alt="" />;
  }
  if (choice.kind === "metamask") return <span className="wallet-logo fox-icon" aria-hidden="true">🦊</span>;
  if (choice.kind === "phantom") return <span className="wallet-logo phantom-icon" aria-hidden="true"><svg viewBox="0 0 48 48" fill="none"><path d="M9 27a15 15 0 0 1 30 0v10c-2.5-2.5-4.7-2.5-7.2 0-2.5-2.5-4.7-2.5-7.2 0-2.5-2.5-4.7-2.5-7.2 0-2.5-2.5-4.7-2.5-7.4 0V27Z" fill="white"/><circle cx="20" cy="26" r="2" fill="#7258db"/><circle cx="30" cy="26" r="2" fill="#7258db"/></svg></span>;
  return <span className="wallet-logo other-icon" aria-hidden="true">◈</span>;
}

export default function WalletPicker({ open, choices, onClose, onRefresh }: Props) {
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
      if (event.key !== "Tab") return;
      const focusable = Array.from(dialog.current?.querySelectorAll<HTMLElement>("button:not(:disabled), a[href]") || []);
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      previousFocus.current?.focus();
    };
  }, [open]);

  if (!open) return null;
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div ref={dialog} className="wallet-modal" role="dialog" aria-modal="true" aria-labelledby="wallet-modal-title">
      <div className="modal-header"><div><h2 id="wallet-modal-title">Connect a wallet</h2><p>Choose a wallet, then approve the request in its popup.</p></div><button ref={closeButton} className="icon-button" onClick={onClose} aria-label="Close">×</button></div>
      <div className="wallet-choice-list">{choices.map((choice) => choice.onSelect ?
        <button className="wallet-choice" key={choice.id} onClick={choice.onSelect}><WalletIcon choice={choice} /><span><strong>{choice.name}</strong><small>{choice.network}</small></span><span className="choice-end">Connect <span aria-hidden="true">↗</span></span></button> :
        <a className="wallet-choice" key={choice.id} href={choice.installUrl} target="_blank" rel="noopener noreferrer"><WalletIcon choice={choice} /><span><strong>{choice.name}</strong><small>{choice.network}</small></span><span className="choice-end">Get wallet <span aria-hidden="true">↗</span></span></a>
      )}</div>
      <button className="text-button" onClick={onRefresh}>Refresh wallet list</button>
      <p className="modal-note">You never need to enter your wallet address or recovery phrase here.</p>
    </div>
  </div>;
}
