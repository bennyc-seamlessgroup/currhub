-- Run after airdrop.sql. Existing test campaigns and identity rows may be
-- removed separately after confirming no published on-chain round uses them.
alter table public.airdrop_campaigns
  alter column snapshot_start drop not null,
  alter column snapshot_block drop not null,
  alter column snapshot_hash drop not null;

alter table public.airdrop_campaigns drop constraint if exists airdrop_campaigns_snapshot_block_check;
alter table public.airdrop_campaigns add constraint airdrop_campaigns_snapshot_block_check
  check (snapshot_block is null or (snapshot_start is not null and snapshot_block >= snapshot_start));
alter table public.airdrop_campaigns drop constraint if exists airdrop_campaigns_status_check;
alter table public.airdrop_campaigns add constraint airdrop_campaigns_status_check
  check (status in ('draft', 'scheduled', 'snapshotted', 'needs_budget', 'prepared', 'published', 'failed'));

alter table public.airdrop_campaigns
  add column if not exists snapshot_at timestamptz,
  add column if not exists ratio_shares bigint,
  add column if not exists ratio_reward_wei text,
  add column if not exists minimum_wei text,
  add column if not exists maximum_wei text,
  add column if not exists allocated_wei text not null default '0',
  add column if not exists snapshot_cursor_block bigint,
  add column if not exists snapshot_balances jsonb not null default '{}'::jsonb,
  add column if not exists snapshot_error text;

create table if not exists public.airdrop_stakeholder_profiles (
  wallet text primary key check (wallet = lower(wallet)),
  full_name text not null check (length(full_name) between 2 and 100),
  email text not null check (length(email) between 3 and 200),
  company text not null default '',
  role text not null default '',
  country text not null,
  relationship text not null default '',
  marketing_opt_in boolean not null default false,
  profile_consent_at timestamptz not null,
  marketing_consent_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table public.airdrop_stakeholder_profiles enable row level security;
revoke all on public.airdrop_stakeholder_profiles from anon, authenticated;

create index if not exists airdrop_campaigns_due_idx
  on public.airdrop_campaigns (snapshot_at) where status = 'scheduled';
