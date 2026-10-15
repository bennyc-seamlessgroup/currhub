-- Run after airdrop.sql. ADMIN_WALLETS remains the immutable recovery-owner list.
create table if not exists public.airdrop_admin_wallets (
  wallet text primary key check (wallet = lower(wallet) and wallet ~ '^0x[0-9a-f]{40}$'),
  role text not null check (role in ('owner', 'team')),
  label text not null default '' check (length(label) <= 80),
  added_by text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.airdrop_admin_wallets enable row level security;
revoke all on public.airdrop_admin_wallets from anon, authenticated;
