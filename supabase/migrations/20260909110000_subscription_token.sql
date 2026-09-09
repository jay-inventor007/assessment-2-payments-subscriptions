-- Disabling a Paystack subscription needs both its code and an email
-- token (see docs/paystack-reference.md - this is deliberate on Paystack's
-- side, so a leaked subscription code alone can't cancel someone).
alter table subscriptions add column paystack_email_token text;
