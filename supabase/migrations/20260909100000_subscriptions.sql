-- One row per user: the plan is a flag on the user's account, not a
-- separate thing they can have many of. authorization_code/_email are the
-- saved-card reference used to charge again later (upgrades, our own
-- proration logic) - never a card number, only Paystack's own token.
create table subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references users(id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'monthly', 'yearly')),
  status text not null default 'active' check (status in ('active', 'non_renewing', 'past_due', 'cancelled')),
  paystack_customer_code text,
  paystack_subscription_code text,
  authorization_code text,
  authorization_email text,
  currency text not null default 'NGN',
  current_period_end timestamptz,
  pending_plan_change text check (pending_plan_change in ('monthly', 'yearly')),
  cancellation_reason text,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Append-only: what actually happened, in order, at each stage of a
-- payment's lifecycle. Never updated or deleted - this is what gets shown
-- in a dispute, not whatever the mutable subscriptions row says right now.
create table payment_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references users(id) on delete cascade,
  subscription_id uuid references subscriptions(id) on delete set null,
  stage text not null check (stage in ('initiated', 'verified', 'fulfilled', 'failed')),
  amount integer,
  currency text,
  paystack_reference text,
  description text,
  metadata jsonb,
  created_at timestamptz not null default now()
);

create index payment_log_user_id_idx on payment_log (user_id);

-- The idempotency mechanism: (event_type, provider_reference) is unique,
-- so inserting a row for a webhook already processed fails outright,
-- exactly like the users.email unique constraint catches a duplicate
-- signup - the database refuses the duplicate rather than the application
-- code having to remember to check first.
create table webhook_events (
  id bigint generated always as identity primary key,
  event_type text not null,
  provider_reference text not null,
  payload jsonb not null,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_type, provider_reference)
);

-- Same reasoning as Assessment 1: only Edge Functions (service role, always
-- bypasses RLS) ever touch these tables, so RLS with zero policies turns
-- off the REST API's default "readable via the anon key" exposure entirely.
alter table subscriptions enable row level security;
alter table payment_log enable row level security;
alter table webhook_events enable row level security;
