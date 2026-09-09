-- Called by every rate-limited Edge Function route (signin, signup,
-- password-reset-request, resend-verification) before doing any real work,
-- e.g.:
--   select * from check_rate_limit('signin', client_ip, 10, 60);
--
-- p_identifier is whatever the caller rate-limits by for that route (an IP
-- address for signup/signin, since there's no account yet to key on; an
-- email address for resend-verification and password-reset-request, since
-- those are naturally scoped to one account regardless of which IP asks).
--
-- Returns exactly one row:
--   allowed             - true if this attempt may proceed
--   retry_after_seconds - if not allowed, how long the caller should tell
--                         the client to wait (used for the Retry-After
--                         header on the 429 response)
-- Fixed window, keyed per (route, identifier): count attempts already
-- logged in the trailing p_window_seconds, allow if under p_limit, and log
-- this attempt only when it's allowed - rejected attempts aren't logged
-- again, since the row that tripped the limit is already in the window.
create or replace function check_rate_limit(
  p_route text,
  p_identifier text,
  p_limit integer,
  p_window_seconds integer
) returns table (allowed boolean, retry_after_seconds integer)
language plpgsql
as $$
declare
  v_window_start timestamptz := now() - make_interval(secs => p_window_seconds);
  v_count integer;
  v_oldest timestamptz;
begin
  -- Serializes concurrent calls for the same (route, identifier) so two
  -- requests arriving at the same instant can't both read a count under
  -- the limit and both be let through.
  perform pg_advisory_xact_lock(hashtextextended(p_route || ':' || p_identifier, 0));

  select count(*), min(created_at)
    into v_count, v_oldest
    from rate_limit_attempts
   where route = p_route
     and identifier = p_identifier
     and created_at > v_window_start;

  if v_count >= p_limit then
    return query select
      false,
      greatest(
        1,
        ceil(extract(epoch from (v_oldest + make_interval(secs => p_window_seconds) - now())))::integer
      );
    return;
  end if;

  insert into rate_limit_attempts (route, identifier) values (p_route, p_identifier);

  return query select true, 0;
end;
$$;
