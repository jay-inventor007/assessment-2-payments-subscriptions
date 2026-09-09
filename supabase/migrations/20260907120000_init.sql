-- Core account record. Email uniqueness is enforced here, not just in
-- application code, so a race between two concurrent signups (or a bug in
-- the signup handler) still can't produce two accounts for the same address.
create table users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  password_hash text not null,
  email_verified_at timestamptz,
  created_at timestamptz not null default now()
);

-- Email is always lowercased by the application before it reaches this
-- table, so a plain unique constraint is enough; a case-insensitive citext
-- column was the alternative but adds an extension dependency for a rule
-- the app already has to apply anyway (trimming, basic format checks).

-- One-time codes for verifying an email address. The code itself is stored
-- in plain text, not hashed: it's low-entropy (six digits) and short-lived,
-- so hashing it would protect against a threat model that rate limiting on
-- the verify endpoint already covers, while making the required "screenshot
-- the code in the database" evidence meaningless. Reset tokens below are
-- the opposite case and are hashed.
create table verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  code text not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index verification_codes_user_id_idx on verification_codes(user_id);

-- Password reset tokens are high-entropy and sent by email link, so if this
-- table were ever read by someone who shouldn't have it, a plaintext token
-- would be an immediate account takeover with no further guessing required.
-- Storing only the hash means a database leak alone isn't enough.
create table password_reset_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create index password_reset_tokens_user_id_idx on password_reset_tokens(user_id);

-- Sessions are opaque server-side records, not JWTs: revoking one on sign
-- out just means deleting (or marking revoked) a row, with no need to
-- track a blocklist of not-yet-expired tokens. Same leaked-database
-- argument as reset tokens applies, so only the hash of the session token
-- is stored - the raw token lives only in the browser's cookie.
create table sessions (
  token_hash text primary key,
  user_id uuid not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create index sessions_user_id_idx on sessions(user_id);

-- Append-only log of rate-limited attempts. One row per attempt rather than
-- a mutable counter: a log can't get out of sync with reality the way an
-- increment/decrement counter can, and it doubles as evidence of exactly
-- when a limit was hit. Nothing prunes old rows yet - see DOCUMENTATION.md
-- Section 7 for why that's an accepted gap for this assessment's scope.
create table rate_limit_attempts (
  id bigint generated always as identity primary key,
  route text not null,
  identifier text not null,
  created_at timestamptz not null default now()
);

create index rate_limit_attempts_lookup_idx
  on rate_limit_attempts (route, identifier, created_at desc);
