-- Run once in the Supabase SQL Editor. Only the server-side service role may read these tables.
create extension if not exists pgcrypto;

create table if not exists public.airdrop_settings (
  id boolean primary key default true check (id),
  contract_address text,
  updated_at timestamptz not null default now()
);
insert into public.airdrop_settings (id) values (true) on conflict (id) do nothing;

create table if not exists public.airdrop_campaigns (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(title) between 1 and 80),
  snapshot_start bigint not null check (snapshot_start >= 0),
  snapshot_block bigint not null check (snapshot_block >= snapshot_start),
  snapshot_hash text not null,
  pool_wei text not null check (pool_wei ~ '^[1-9][0-9]*$'),
  deadline timestamptz not null,
  status text not null default 'draft' check (status in ('draft', 'prepared', 'published')),
  merkle_root text,
  onchain_id bigint unique,
  publish_tx text unique,
  created_by text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.airdrop_allocations (
  campaign_id uuid not null references public.airdrop_campaigns(id) on delete cascade,
  wallet text not null check (wallet = lower(wallet)),
  shares text not null check (shares ~ '^[1-9][0-9]*$'),
  amount_wei text not null default '0' check (amount_wei ~ '^[0-9]+$'),
  primary key (campaign_id, wallet)
);

create table if not exists public.airdrop_identity_reviews (
  wallet text primary key check (wallet = lower(wallet)),
  full_name text not null,
  email text not null,
  country text not null,
  status text not null default 'submitted' check (status in ('submitted', 'approved', 'rejected')),
  consent_at timestamptz not null default now(),
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text
);

create table if not exists public.airdrop_admin_events (
  id bigint generated always as identity primary key,
  wallet text not null,
  action text not null,
  subject text not null,
  created_at timestamptz not null default now()
);

alter table public.airdrop_settings enable row level security;
alter table public.airdrop_campaigns enable row level security;
alter table public.airdrop_allocations enable row level security;
alter table public.airdrop_identity_reviews enable row level security;
alter table public.airdrop_admin_events enable row level security;

revoke all on public.airdrop_settings from anon, authenticated;
revoke all on public.airdrop_campaigns from anon, authenticated;
revoke all on public.airdrop_allocations from anon, authenticated;
revoke all on public.airdrop_identity_reviews from anon, authenticated;
revoke all on public.airdrop_admin_events from anon, authenticated;
