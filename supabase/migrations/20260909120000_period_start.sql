-- Needed to compute real proration (days remaining / actual days in this
-- period), rather than assuming a flat 30 or 365 - a real calendar month
-- isn't always 30 days, and this is meant to be correct to the day.
alter table subscriptions add column current_period_start timestamptz;
