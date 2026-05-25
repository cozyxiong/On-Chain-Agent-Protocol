create table if not exists public.aap_intents (
  intent_id text primary key,
  user_id text,
  agent_id text,
  smart_account text,
  intent_type text,
  status text,
  tx_hash text,
  gas_used bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.aap_batches (
  batch_id text primary key,
  status text,
  size int not null default 0,
  tx_hash text,
  gas_used bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

create table if not exists public.aap_coordinator_jobs (
  job_id text primary key,
  kind text,
  batch_group_id text,
  status text,
  run_at timestamptz,
  attempts int not null default 0,
  tx_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  data jsonb not null default '{}'::jsonb
);

create index if not exists aap_intents_user_id_idx on public.aap_intents (user_id);
create index if not exists aap_intents_smart_account_idx on public.aap_intents (smart_account);
create index if not exists aap_intents_status_idx on public.aap_intents (status);
create index if not exists aap_batches_status_idx on public.aap_batches (status);
create index if not exists aap_coordinator_jobs_status_idx on public.aap_coordinator_jobs (status);
create index if not exists aap_coordinator_jobs_run_at_idx on public.aap_coordinator_jobs (run_at);
create index if not exists aap_coordinator_jobs_batch_group_idx on public.aap_coordinator_jobs (batch_group_id);

alter table public.aap_intents enable row level security;
alter table public.aap_batches enable row level security;
alter table public.aap_coordinator_jobs enable row level security;
