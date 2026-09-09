# Assessment 2 Plan — Payment and Subscription Slice

Working plan, not the graded deliverable (that's `DOCUMENTATION.md`, written after the slice was functional). Update this file as decisions change. Full Paystack API reference notes live alongside this at `docs/paystack-reference.md` — check there before re-deriving anything about the API.

## Status (2026-09-09)

Scaffolded (auth copied from Assessment 1, builds clean, linked to the shared Supabase project). New tables (`subscriptions`, `payment_log`, `webhook_events`, RLS on) migrated. Plans created in Paystack: monthly `PLN_5xm5kn8vdy0fxrt` (NGN 100), yearly `PLN_c7evnexv7g4aw17` (NGN 1000) — see `_shared/plans.ts`.

**Core payment engine built and proven end-to-end with a real test payment:**
- `checkout-init`, `verify-payment`, `paystack-webhook` deployed and working
- Webhook URL configured in Paystack dashboard (test mode)
- Confirmed: checkout -> real Paystack test payment -> webhook fires `charge.success` -> entitlement granted, all with zero manual intervention
- Confirmed: `verify-payment` independently does the same thing (return-view path, no webhook needed)
- Confirmed: idempotency holds — calling fulfillment again for an already-completed reference returns `"reason":"Already fulfilled"` with zero new `payment_log` rows
- `payment_log` shows exactly 3 rows per successful payment (`initiated`/`verified`/`fulfilled`), never duplicated regardless of which path (webhook or verify-payment) got there first
- Subscription row correctly populated: `plan`, `status`, real `paystack_customer_code`, real `authorization_code` (needed later for upgrade proration charges), `current_period_end` set a month/year out

**Upgrade, downgrade, cancel, and billing-status also built and proven end-to-end with real Paystack calls:**
- Added `current_period_start` (needed for real day-accurate proration, not a flat 30/365 assumption) and `paystack_email_token` (needed to disable a subscription later) columns
- Webhook now also handles `subscription.create`, fetching and storing the real `subscription_code`/`email_token` via `recordSubscriptionCode.ts`, since the auto-subscribe-via-transaction flow never returns these directly
- Confirmed upgrade (monthly -> yearly) with a fresh subscription at day ~0 of its period: credited the full 10000 kobo (NGN 100) monthly amount, charged exactly 90000 kobo (NGN 900) of the 100000 kobo yearly price, real `charge_authorization` call, old subscription disabled, new one created, `current_period_end` correctly set one year out
- Confirmed cancel disables the Paystack subscription immediately but retains `current_period_end` for access; also clears any `pending_plan_change` on cancel (a downgrade scheduled for a period that will now never renew is moot)
- Confirmed `billing-status` correctly reflects plan/status/period end/pending change/cancellation reason after each of the above
- Fixed a real bug caught during testing, not just an incomplete feature: the first downgrade implementation only recorded `pending_plan_change` and left the yearly Paystack subscription untouched, meaning Paystack would have auto-renewed it at the **old yearly price** when the period ended, exactly backwards from what downgrading means. Fixed by having `downgrade-subscription` disable the current Paystack subscription immediately (same as cancel does), while `current_period_end` still keeps access until the paid-for period actually ends
- Fixed a second bug from the same test round: a fresh successful payment didn't clear `cancellation_reason`/`cancelled_at` from an earlier cancellation on the same user, so an actively-paying subscriber could see a stale cancellation reason on their billing page. `fulfillPayment` now clears both on every fresh grant
- Confirmed the fixed downgrade end-to-end: upgrade to yearly, then downgrade, returns `200` (meaning the disable call succeeded), `billing-status` shows `plan: yearly` (unchanged until period end), `status: active` (downgrade isn't cancellation), `pending_plan_change: monthly`

**How the deferred downgrade actually gets applied:** there's no background scheduled job (no `pg_cron`) — instead `_shared/applyPendingPlanChange.ts` is called from `billing-status` on every read, and if `pending_plan_change` is set and `current_period_end` has passed, it applies the switch right then (a fresh charge for the new plan's full price, a new Paystack subscription created, `pending_plan_change` cleared) before returning the now-current status. This is a deliberate simplification — the switch only actually happens once someone (the user's own browser, checking their billing page) triggers a `billing-status` read after the date, not the instant the period ends. Worth stating explicitly in Section 7, not implying it's a true background process.

**Not yet built:** the 4 real frontend screens (currently just the `PlansPage` placeholder) and `DOCUMENTATION.md`.

## Decisions made

- **Stack:** React + TypeScript + Supabase (Postgres + Edge Functions), same pattern as Assessment 1.
- **Payment provider: Paystack.** Chosen over Stripe (Nigeria account-access concerns) and Flutterwave (no recurring-billing primitive at all).
- **Supabase project: reuse Assessment 1's** (`doionclqsqrnshlqrvku`), not a fresh one. Consequence: the auth tables/functions already exist and work there; we only need to write and deploy the new payment-specific migrations/functions. But the auth *source files* (migrations, Edge Functions, shared helpers) still get copied into this folder too, so this repo stands alone for a reviewer who only clones this one.
- **Auth: reuse Assessment 1's actual code and user records.** Since it's the same Supabase project, existing verified users can subscribe directly, no need to re-signup. Disclose the reuse in `DOCUMENTATION.md`.

## Confirmed Paystack mechanics (from official docs + SDK source — see `docs/paystack-reference.md` for the full notes)

**Money:** all amounts in subunits (kobo for NGN). Matches the brief's "money as whole numbers in minor units" requirement directly, no conversion logic of our own needed for storage, just don't forget to multiply/divide by 100 at the API boundary.

**Creating a plan:**
```
POST /plan
{ "name": "Pro Monthly", "interval": "monthly", "amount": 500000 }
```
`interval` options: hourly/daily/weekly/monthly/quarterly/biannually/annually. Monthly quirk worth documenting: a subscription created on the 29th-31st bills on the 28th of subsequent months.

**Subscribing a new customer — simplest path:** attach the plan directly to the initial transaction, Paystack auto-subscribes on successful payment:
```
POST /transaction/initialize
{ "email": "...", "amount": "500000", "plan": "PLN_xxxx" }
```
(the plan's amount overrides whatever `amount` is sent). This is what the "Plans view -> checkout initiation" flow uses for a brand-new subscriber.

**Getting a reusable card token:** the transaction verify response / webhook includes `data.authorization` — `authorization_code` (fresh per charge, use for future charges), `signature` (stable per underlying card, use to dedupe), `reusable` (only charge again if true). Store the whole object plus the email used, since only that email can charge that authorization again.

**No native mid-cycle plan change exists.** `Update Plan` changes a plan's price for *all* subscribers, it is not a per-customer upgrade/downgrade call. Confirmed by reading the SDK source (`Subscription.ts` has create/disable/enable/fetch/list/manageEmail/manageLink only, nothing for changing plans) and the docs. We build upgrade/downgrade ourselves — see below.

**Disabling a subscription:** `POST /subscription/disable` needs both `code` and `token` (an email token — extra layer so a leaked subscription code alone can't cancel someone). Fetch the subscription first to get its `email_token`.

**Charging a saved card directly (for our own proration/upgrade logic):**
```
POST /transaction/charge_authorization
{ "authorization_code": "AUTH_xxx", "email": "...", "amount": "300000" }
```

**Webhook signature verification (security-critical, get this exact):**
```js
const hash = crypto.createHmac('sha512', secretKey)
  .update(JSON.stringify(req.body))
  .digest('hex');
// compare to req.headers['x-paystack-signature']
```
Header: `x-paystack-signature`. Algorithm: HMAC-SHA512, hex digest, keyed with the *secret* key. Must return `200` quickly, do slow work after responding. Note: subscription charges are never retried by Paystack on failure, and **webhooks currently only fire for successful transactions** — failures need to be caught via the Verify endpoint or the redirect flow, not assumed to show up as a webhook.

**Key webhook events for our state machine:**
- `charge.success` — a charge succeeded (initial subscribe, or a renewal, or our manual proration charge)
- `subscription.create` — subscription created
- `invoice.create` — fires 3 days before a renewal charge attempt
- `invoice.payment_failed` / `invoice.update` — renewal outcome
- `subscription.not_renew` — won't renew next cycle (post-cancellation, before period end)
- `subscription.disable` — actually cancelled/ended (fires on the next payment date after `not_renew`, or when we call disable ourselves)
- `subscription.expiring_cards` — sent monthly, lists subscriptions whose card expires that month

**Idempotency:** Paystack's own advice is to reuse the same transaction `reference` on retry rather than minting a new one. Combined with our own `webhook_events` table keyed on the event's provider reference (unique constraint), this covers both directions: we don't double-charge on our own retries, and we don't double-process a webhook Paystack redelivers.

**Test mode:** user already knows this from an existing Paystack integration, no need to re-verify (test/live keys `sk_test_...`/`sk_live_...`, same base URL, key determines environment).

## The proration problem, our own design (Paystack gives us no help here)

**Upgrade (monthly -> yearly mid-cycle), effective immediately:**
1. Calculate credit for unused time on the current plan: `days_remaining / days_in_current_period * amount_paid`
2. New plan's price minus that credit = amount to charge now (never negative, floor at 0)
3. `POST /transaction/charge_authorization` for that difference, using the stored `authorization_code`
4. On success: disable the old subscription (fetch it first for the `email_token`), then create a new subscription on the new plan (`POST /subscription` with `customer`, `plan`, `authorization`)
5. Every step above gets its own row in `payment_log` — this is the "initiation, verification, fulfilment as three separate things" concept, made concrete

**Downgrade, applied at period end per the brief:** don't touch the live Paystack subscription now. Store `pending_plan_change` on our own `subscriptions` row. When the webhook confirms the current cycle's final renewal charge (or, more simply, when a scheduled check finds `current_period_end` has passed), apply the same disable-old/create-new sequence as upgrade, but for the downgrade target, and only then.

**Cancellation:** call `POST /subscription/disable` right away (stops the next auto-renewal charge), but keep our own `access_until = current_period_end` — entitlement logic checks that date, never whether the Paystack subscription is currently "active". This is what makes "keeps access until the period they paid for ends" true even though the subscription itself is already disabled.

## Data model (draft, will firm up while building)

- `subscriptions`: `user_id`, `plan` (`free`/`monthly`/`yearly`), `status`, `paystack_subscription_code`, `paystack_customer_code`, `authorization_code`, `authorization_email` (the email tied to that authorization — required to reuse it), `current_period_end`, `pending_plan_change`, `cancellation_reason`, `cancelled_at`
- `payment_log`: append-only. One row per lifecycle event (`initiated`, `verified`, `fulfilled`, `failed`) per attempt, never mutated, never deleted, this is what a dispute gets shown, not the mutable `subscriptions` row
- `webhook_events`: `paystack_reference` (unique constraint, the actual idempotency mechanism), `event_type`, `processed_at`, raw payload for audit

## Screens (from the brief)

- Plans view (free/monthly/yearly, current plan indicated)
- Checkout initiation (hands off to Paystack via `authorization_url` from Initialize Transaction)
- Return view (after paying — must NOT grant entitlement just from landing here; the brief explicitly traps this. Entitlement only comes from calling Verify Transaction server-side or from the webhook, whichever confirms first)
- Billing view (plan, status, renewal date, cancel control with confirmation + optional reason prompt)
- Minimal signed-in shell (Assessment 1's session system)

## Engineering requirements checklist (from the brief — all must be present)

- [ ] Money as integer minor units + currency stored alongside
- [ ] Payment log table, separate rows per lifecycle stage
- [ ] Server-side verification before any entitlement is granted, never on a redirect/frontend claim
- [ ] Webhook signature verification (HMAC-SHA512, see above) before any processing
- [ ] Idempotency keyed on the provider reference
- [ ] Proration calculated and shown with real numbers
- [ ] Cancellation retains access to period end, with a confirmation step
- [ ] Cancellation reason column, populated from an optional prompt
- [ ] Rate limiting on the checkout initiation endpoint
- [ ] Error handling, never a blank page or 404 anywhere in the payment path
- [ ] No card details stored anywhere in this system (only Paystack's `authorization_code` reference)

## Next steps

1. Scaffold the project: copy Assessment 1's auth source (migrations, Edge Functions, shared helpers, signin/signup pages) into this folder
2. Get the Paystack test secret key set as a Supabase secret (`PAYSTACK_SECRET_KEY`) via the CLI directly, never committed anywhere
3. Write the new migrations (`subscriptions`, `payment_log`, `webhook_events`) and push them to the shared project
4. Build Edge Functions: `checkout-init`, `paystack-webhook`, `verify-payment`, `upgrade-subscription`, `downgrade-subscription`, `cancel-subscription`, `billing-status`
5. Build the 4 screens
6. Test the full lifecycle end-to-end (subscribe -> upgrade with proration -> downgrade -> cancel -> duplicate webhook), curl-first, same approach as Assessment 1
7. Write `DOCUMENTATION.md` once the slice is fully working and tested end to end
