-- These tables are never queried by anon/authenticated roles - only Edge
-- Functions touch them, using the service role, which bypasses RLS
-- entirely regardless of policies. Enabling RLS with zero policies is
-- exactly what's needed here: it flips the default from "readable by
-- anyone with the anon key via the auto-exposed REST API" to "readable by
-- no one except the service role," with nothing else to configure.
alter table users enable row level security;
alter table verification_codes enable row level security;
alter table password_reset_tokens enable row level security;
alter table sessions enable row level security;
alter table rate_limit_attempts enable row level security;
