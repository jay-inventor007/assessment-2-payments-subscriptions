# Paystack API — Reference Notes

Compiled from https://paystack.com/docs/ as a working reference while building this slice. Covers: API basics, authentication, accepting payments, verifying payments, webhooks, transfers, errors, pagination, identity verification, recurring charges/authorizations, subscriptions, split payments (single & multi), dedicated virtual accounts, refunds, and Terminal (in-person payments).

---

## 1. API Basics

- Base URL: `https://api.paystack.co` (same URL for test and live — your API key determines the environment).
- RESTful, JSON-based API. All requests must be over HTTPS.
- Standard HTTP methods: `POST` (create), `GET` (retrieve), `PUT` (update/create), `DELETE` (delete).
- All requests must include your secret key in the `Authorization` header:
  `Authorization: Bearer YOUR_SECRET_KEY`

### Standard response format

```json
{
  "status": "[boolean]",
  "message": "[string]",
  "data": "[object]"
}
```

- `status`: whether the request succeeded (use alongside HTTP status code).
- `message`: human-readable summary; on error, describes what went wrong.
- `data`: object or array with the actual result payload.

### Meta object (list endpoints / errors)

```json
{
  "meta": {
    "total": 2,
    "skipped": 0,
    "perPage": 50,
    "page": 1,
    "pageCount": 1
  }
}
```

On success (list endpoints): pagination info.
On failure: diagnostic info incl. `next_step`.

### Currency & amounts

- **Amounts must be sent in the subunit of the currency** (multiply base amount by 100).
  Example: to charge NGN 100 → send `10000`.
- ISO 4217 currency codes.

| Currency | Subunit | Symbol | Min transaction | Availability |
|---|---|---|---|---|
| NGN | Kobo | ₦ | 50.00 | Nigeria |
| USD | Cent | $ | 2.00 | Kenya & Nigeria |
| GHS | Pesewa | ₵ | 0.10 | Ghana |
| ZAR | Cent | R | 1.00 | South Africa |
| KES | Cent | Ksh. | 3.00 | Kenya |
| XOF | — (still ×100, no fractions) | XOF | 1.00 | Côte d'Ivoire |

---

## 2. Authentication

- Two key types per environment (test/live):
  - **Public key** (`pk_...`) — frontend / Paystack Inline / mobile SDKs only. Can only *initiate* transactions.
  - **Secret key** (`sk_...`) — backend only, for all API requests. Must be kept secret (never in git, never client-side).
- Test keys: `pk_test_...` / `sk_test_...`. Live keys: `pk_live_...` / `sk_live_...`.
- Keys are found in Dashboard → Settings → **API Keys & Webhooks** (or Canvas → Developers overview).
- No/invalid auth → `401 Unauthorized`.
- Don't disable SSL/TLS peer verification (`VERIFY_PEER=FALSE`) — verify Paystack's SSL connection properly.
- **IP whitelisting** (optional security feature): restrict which IPs can use your secret key. Up to 10 IPv4 addresses per environment (no IPv6, no ranges, no private IPs). Configured in Dashboard/Canvas by admins only.
- Best practices: never embed secret keys in frontend/mobile/public repos; use env vars or a secrets manager; rotate periodically; restrict dashboard access to keys.

---

## 3. Accepting Payments

Three ways to accept a payment: **Popup (Inline JS)**, **Redirect**, or **Charge API** (direct channel, e.g. mobile money/USSD). Mobile apps use the **Android/iOS SDKs**. All flows start with the same backend call:

### Step 1 — Initialize transaction (always from your backend)

```
POST https://api.paystack.co/transaction/initialize
Authorization: Bearer YOUR_SECRET_KEY
Content-Type: application/json

{
  "email": "customer@email.com",
  "amount": "500000"
}
```

- **Never call this from the frontend** — it needs the secret key.
- Required: `email`, `amount` (in subunits). Optional: `callback_url`, `reference` (your own unique transaction ref), `metadata` (arbitrary extra data), `currency`, etc.
- Response `data.access_code` → used to resume checkout in Popup/SDKs.
- Response also includes an `authorization_url` → used for the Redirect flow.

### Option A — Popup (Inline JS)

Install via CDN or package manager:
```html
<script src="https://js.paystack.co/v2/inline.js"></script>
```
or
```js
import PaystackPop from '@paystack/inline-js'
```

Frontend flow:
1. Ask your backend to initialize the transaction → get `access_code`.
2. Resume checkout:
```js
const popup = new PaystackPop()
popup.resumeTransaction(access_code)
```
3. Verify transaction status server-side (webhook or Verify endpoint) before delivering value.

### Option B — Redirect

1. Backend calls Initialize Transaction → gets `authorization_url`.
2. Redirect the user to that URL to pay.
3. After payment, Paystack redirects back to your `callback_url` with `?reference=YOUR_REFERENCE` appended.
4. Your server reads the `reference` from the query string and calls Verify Transaction.
5. If no `callback_url` is set (in the request or Dashboard), users won't be redirected back.
6. Set separate callback URLs for test vs live.
7. **Important:** visiting the callback URL does NOT itself prove success — always call the Verify endpoint.

### Option C — Charge API (direct channel charge)

`POST /charge` — pass transaction details plus a payment-instrument object (e.g. mobile money, USSD, bank transfer) directly, useful for feature phones / custom UX / autofilled OTP flows.

Example payload (mobile money):
```json
{
  "amount": 1000,
  "email": "customer@email.com",
  "currency": "GHS",
  "mobile_money": { "phone": "0553241149", "provider": "MTN" }
}
```

Response `data.status` tells you the next step:

| `data.status` value | Meaning / action |
|---|---|
| `pending` | Processing — call "Check pending charge" ~10s later |
| `success` | Done — deliver value |
| `send_birthday` | Prompt user for DOB, submit to Submit Birthday endpoint |
| `send_otp` | Prompt user for OTP, submit to Submit OTP endpoint |
| `timeout` | Failed — show `data.message`, can start a new charge |
| `failed` | Failed — no retry, show `data.message`, start new charge |

For steps requiring an on-device action (scan QR, dial USSD, 3D Secure redirect) rather than input: show a "I've completed this" confirm button and rely on webhooks for the final result.

### Mobile SDKs (Android / iOS)

- Same backend Initialize call (never call Initialize directly from the mobile app — needs secret key) → get `access_code` → send to app.
- **Android**: add `com.paystack.android:paystack-ui` dependency; `Paystack.builder().setPublicKey(...).build()`; `PaymentSheet(this, ::paymentComplete)`; `paymentSheet.launch(accessCode)`.
- **iOS**: install via Swift Package Manager; `PaystackBuilder.newInstance.setKey(pk_...).build()`; use `chargeUIButton(accessCode:onComplete:)`.

### Verifying a transaction

```
GET https://api.paystack.co/transaction/verify/:reference
Authorization: Bearer YOUR_SECRET_KEY
```

- The **HTTP status of this call** ≠ the **transaction status**. Always check `data.status` in the body.
- Possible transaction statuses: `abandoned`, `failed`, `ongoing` (awaiting OTP/transfer), `pending`, `processing` (direct debit), `queued` (bulk charge), `reversed` (refund/chargeback), `success`.
- Also check `data.amount` matches what you expect — don't deliver value on a mismatched amount.
- `data.authorization` object (when channel is card) contains `authorization_code` — store it to charge the same card again later (recurring charges).
- `data.gateway_response_code` — see Gateway Responses docs for full mapping.
- Webhooks currently only fire for **successful** transactions — for other outcomes, rely on the Verify endpoint / redirect flow.

---

## 4. Webhooks

Preferred way to get final status updates (over callback URLs or polling) since they don't depend on the customer's device/network staying alive.

### Setting up a webhook URL

- It's just a POST endpoint that: parses the JSON body, does something with it, and **returns `200 OK`**.
- Must be publicly accessible (no localhost).
- Return `200 OK` immediately — do slow/long-running work asynchronously afterward, or Paystack will treat it as a failed delivery due to timeout.
- Add the trailing slash if using `.htaccess` routing quirks.

```js
// Express example
app.post("/my/webhook/url", function (req, res) {
  const event = req.body;
  // do something with event
  res.send(200);
});
```

### Retry behavior if you don't return 200

- **Live mode**: retried every 3 minutes for the first 4 tries, then hourly for 72 hours.
- **Test mode**: retried hourly for 10 hours; each attempt times out after 30s.

### Verifying the event is really from Paystack

Two options:

**1. Signature validation (recommended)** — every webhook request includes an `x-paystack-signature` header: an HMAC-SHA512 signature of the raw JSON payload, signed with your secret key.

```js
const crypto = require('crypto');
const secret = process.env.SECRET_KEY;
app.post("/my/webhook/url", function (req, res) {
  const hash = crypto.createHmac('sha512', secret)
    .update(JSON.stringify(req.body))
    .digest('hex');
  if (hash === req.headers['x-paystack-signature']) {
    const event = req.body;
    // handle event
  }
  res.send(200);
});
```

**2. IP whitelisting** — only accept webhook POSTs from these IPs (same for test & live):
```
52.31.139.75
52.49.173.169
52.214.14.220
```

### Go-live checklist for webhooks

- Add the webhook URL in Dashboard/Canvas.
- Ensure it's publicly reachable (not localhost).
- Confirm you parse the JSON body and return 200.
- Acknowledge (200) immediately, then process asynchronously if there's heavy work.

### Key events

| Event | Description |
|---|---|
| `charge.success` | A successful charge was made |
| `charge.dispute.create` / `.remind` / `.resolve` | Dispute lifecycle |
| `customeridentification.failed` / `.success` | Customer ID (BVN/bank) verification result |
| `dedicatedaccount.assign.failed` / `.success` | DVA (dedicated virtual account) assignment |
| `invoice.create` / `.update` / `.payment_failed` | Subscription invoice lifecycle |
| `paymentrequest.pending` / `.success` | Payment request (invoice link) status |
| `refund.pending` / `.processing` / `.processed` / `.failed` | Refund lifecycle |
| `subscription.create` / `.disable` / `.not_renew` / `.expiring_cards` | Subscription lifecycle |
| `transfer.success` / `.failed` / `.reversed` | Outbound transfer result |

---

## 5. Transfers (Send Money)

Four steps: create a transfer recipient → generate a transfer reference → initiate transfer → listen for status.

### Step 1 — Create a transfer recipient

Recipient types by country/currency:

| Type | Description | Currency |
|---|---|---|
| `nuban` | Nigerian bank account | NGN |
| `ghipss` | Ghana Interbank Payment and Settlement | GHS |
| `mobile_money` | Mobile money / MoMo account | GHS/KES |
| `kepss` | Kenya Electronic Payment and Settlement | KES |
| `basa` | South African bank account | ZAR |
| `authorization` | A saved card's authorization code | Any |

`POST /transferrecipient` → response `data.recipient_code` (e.g. `RCP_gd9vgag7n5lr5ix`) — save this against the customer.

### Step 2 — Generate a transfer reference

- Recommended: v4 UUID, ≤ 50 characters.
- Rules: lowercase letters, digits, underscore `_`, dash `-` only. Min 16, max 50 chars.
- Reusing the same reference on retry avoids double-crediting; a new reference = a brand-new transfer attempt.

### Step 3 — Initiate transfer

```
POST https://api.paystack.co/transfer
Authorization: Bearer YOUR_SECRET_KEY
Content-Type: application/json

{
  "source": "balance",
  "reason": "Bonus for the week",
  "amount": 100000,
  "recipient": "RCP_gd9vgag7n5lr5ix",
  "reference": "acv_9ee55786-2323-4760-98e2-6380c9cb3f68"
}
```

- Amount in subunits, as with transactions.
- Response starts as `pending` while processing.
- **OTP**: by default transfers require OTP confirmation. For automated systems, disable it in Dashboard → Preferences → uncheck "Confirm transfers before sending".
- If a request errors, retry with the **same reference** (don't generate a new one) to avoid double payout.
- Test-mode transfers always return `success` immediately (no real processing).

### Step 4 — Verify transfer status

Prefer **webhooks** (`transfer.success`, `transfer.failed`, `transfer.reversed`) over polling since processing can take seconds to minutes.

Polling alternative:
```
GET https://api.paystack.co/transfer/verify/{reference}
Authorization: Bearer YOUR_SECRET_KEY
```
- Again: HTTP status ≠ transfer status — check `data.status` in the body, and only trust it on a 200 response.

---

## 6. Errors

### HTTP status codes

| Code | Meaning |
|---|---|
| 200 | Success (note: charge/verify calls **always** return 200 — check `data` for actual outcome) |
| 201 | Resource created |
| 400 | Validation/client error |
| 401 | Unauthorized (bad/missing secret key) |
| 404 | Resource not found |
| 5xx | Paystack-side error (report it) |

### Error response shape

```json
{
  "status": false,
  "message": "Email Address is required",
  "meta": { "nextStep": "Provide all required params" },
  "type": "validation_error",
  "code": "missing_params"
}
```

- `status`: false on error.
- `message`: human-readable description.
- `type`: one of `api_error`, `validation_error`, `processor_error`.
- `code`: machine-readable error code.
- `meta.next_step` (or `nextStep`): suggested fix; may include other diagnostics (e.g. which recipients were invalid in a bulk transfer).

### Error type categories

| Type | Meaning |
|---|---|
| `api_error` | Problem at the Paystack API level (e.g. unauthorized resource access) |
| `validation_error` | Bad/missing request params |
| `processor_error` | Payment processor/gateway issue (insufficient funds, blocked/expired card, etc.) |

---

## 6b. Pagination

Paystack supports two pagination styles on list endpoints.

### Offset pagination
Query params: `page` (which page) and `perPage` (records per page, default 50).

```
GET /transaction?page=1&perPage=50
```

Response `meta`:
```json
{
  "meta": {
    "total": 7316,
    "total_volume": 397800,
    "skipped": 0,
    "perPage": 50,
    "page": 1,
    "pageCount": 147
  }
}
```
(`total_volume` — sum of fetched transactions — only appears on `GET /transaction`.)

### Cursor pagination
Set `use_cursor=true` on the first request; the response `meta` returns `next`/`previous` cursor tokens to pass as query params on subsequent requests.

```
GET /transaction?use_cursor=true&perPage=50
```
```json
{ "meta": { "next": "dW5kZWZpbmVkOjQwOTczNTgxNTg=", "previous": "null", "perPage": 49 } }
```

**Only available on:** Transactions, Customers, Dedicated Accounts, Transfer Recipients, Transfers, Disputes.

### Best practices
- Prefer offset pagination for small/static datasets; cursor pagination for large or frequently-changing ones.
- Default page size 50; avoid requesting more than ~1000 at once.
- For offset pagination, keep fetching until a page returns no results. For cursor pagination, absence of a `next` cursor means you're at the end.
- Be mindful of rate limits when paginating large datasets; add delays if needed.

---

## 6c. Identity Verification

Three tools under `/docs/identity-verification/`:

### 1. Resolve Account Number (Nigeria, Ghana — free)
Confirms a personal bank account before creating a transfer recipient / for KYC.
```
GET https://api.paystack.co/bank/resolve?account_number=0001234567&bank_code=058
Authorization: Bearer YOUR_SECRET_KEY
```

### 2. Account Validation (South Africa only — ZAR 3 per successful request)
Validates personal or business accounts. Not all SA banks support this — check first via:
```
GET https://api.paystack.co/bank?currency=ZAR&enabled_for_verification=true
```
Then validate:
```
POST https://api.paystack.co/bank/validate
{
  "bank_code": "632005",
  "country_code": "ZA",
  "account_number": "0123456789",
  "account_name": "Ann Bron",
  "account_type": "personal",       // or "business"
  "document_type": "identityNumber", // or "passportNumber" / "businessRegistrationNumber"
  "document_number": "1234567890123"
}
```
Response fields: `accountAcceptsDebits`, `accountAcceptsCredits`, `accountOpenForMoreThanThreeMonths`, `accountHolderMatch`, `accountOpen` (all booleans).

### 3. Validate Customer (Nigeria — required for Dedicated Virtual Accounts in Betting, Financial Services, General Services categories)
Verifies a customer's BVN against a bank account so a virtual account can be safely created/named.
```
POST https://api.paystack.co/customer/{customer_code}/identification
{
  "country": "NG",
  "type": "bank_account",
  "account_number": "0123456789",
  "bvn": "200123456677",
  "bank_code": "007",
  "first_name": "Asta",
  "last_name": "Lavista"
}
```
- Live keys only for real validation (test key credential provided for sandbox testing — see docs page for the literal test payload).
- Verification is **asynchronous** — listen for `customeridentification.success` / `customeridentification.failed` webhooks.
- On failure, `data.reason` explains why (e.g. "Account number or BVN is incorrect").
- On success, the customer's `first_name`/`last_name` are auto-updated to match the BVN record and can no longer be changed via Update Customer (only by re-validating).

---

## 6d. Recurring Charges (Card & Direct Debit Authorizations)

Distinct from Subscriptions (below) — this is the lower-level mechanism subscriptions are built on: charging a saved card/account on demand rather than a fixed billing schedule. Works for cards (all markets) and direct debit (Nigeria businesses).

### 1. Charge the first transaction
- Initialize + complete a normal transaction (web or mobile).
- For **direct debit**, instead use the Initialize Authorization API — the authorization is saved via webhook once the customer approves it.
- Minimum first-charge amount (for card tokenization): NGN 50, GHS 0.10, ZAR 1.00, KES 3.00, USD 2.00. It's standard practice to refund/credit this tokenization charge back to the user.
- Required because local regulations mandate 2FA/authentication on a card before it can be charged again later.

### 2. Get & store the authorization
On a successful first charge, the transaction response / webhook includes a `data.authorization` object:

```json
{
  "authorization_code": "AUTH_8dfhjjdt",
  "card_type": "visa",
  "last4": "1381",
  "exp_month": "08",
  "exp_year": "2018",
  "bin": "412345",
  "bank": "TEST BANK",
  "channel": "card",
  "signature": "SIG_idyuhgd87dUYSHO92D",
  "reusable": true,
  "country_code": "NG",
  "account_name": "BoJack Horseman"
}
```

- `signature`: stable identifier for the underlying card (unlike `authorization_code`, which is fresh each charge) — use it to dedupe saved cards.
- `reusable`: only attempt subsequent charges if `true`.
- **Store the whole authorization object**, plus the email used on that transaction — only the same email can be used to charge that authorization again.

### 3. Charge the authorization later

```
POST https://api.paystack.co/transaction/charge_authorization
{
  "authorization_code": "AUTH_pmx3mgawyd",
  "email": "mail@mail.com",
  "amount": "300000"
}
```

For interval-based charging (e.g. your own custom billing), run this from a cron job on your server — Paystack doesn't schedule these for you (that's what Subscriptions are for).

### Two-Factor Authentication (2FA) challenge flow
Available by default only for betting merchants (Nigeria) on GTB/Access/UBA/Zenith/First Bank cards; others can request it via support@paystack.com.

If a charge attempt gets challenged, the Charge Authorization response looks like:
```json
{
  "status": true,
  "message": "Please, redirect your customer to the authorization url provided",
  "data": {
    "authorization_url": "https://checkout.paystack.com/resume/0744ub5o065nwyz",
    "reference": "jvx2o36ghlvrgtt",
    "access_code": "0744ub5o065nwyz",
    "paused": true
  }
}
```
- Check `data.paused === true` → redirect the customer to `data.authorization_url` to complete the challenge (OTP/PIN/3DS/hardware token).
- Save `data.reference` to verify final status via webhook or Verify Transaction.
- Custom redirect after auth: pass `callback_url` in the charge request.
- Custom redirect on cancel: pass `metadata.cancel_action`.

---

## 6e. Subscriptions (Recurring Billing)

Higher-level than raw authorization charging — Paystack manages the billing cycle for you. Supports **Card** and **Direct Debit (Nigeria)** only.

### 1. Create a plan
```
POST https://api.paystack.co/plan
{ "name": "Monthly Retainer", "interval": "monthly", "amount": 500000 }
```
- `interval`: `hourly`, `daily`, `weekly`, `monthly`, `quarterly`, `biannually`, `annually`.
- `invoice_limit` (optional): caps how many times the customer is charged; omit to bill indefinitely until cancelled.
- **Monthly billing quirk**: subscriptions created on the 1st–28th bill on that same day each month; subscriptions created on the 29th–31st bill on the 28th of each subsequent month.

### 2. Create a subscription
Two ways:

**A. Attach `plan` to a transaction** — customer pays once via normal checkout and is auto-subscribed:
```json
{ "email": "customer@email.com", "amount": "500000", "plan": "PLN_xxxxxxxxxx" }
```
(the plan's amount overrides whatever `amount` you send).

**B. Use the Create Subscription endpoint directly** — requires the customer to already have an existing card/direct-debit authorization on your integration:
```json
POST /subscription
{ "customer": "CUS_xxxxxxxxxx", "plan": "PLN_xxxxxxxxxx" }
```
- Optionally pass `authorization` (a specific `authorization_code`) if the customer has multiple saved cards — otherwise Paystack uses the most recent.
- Optionally pass `start_date` to delay the first debit (free trial periods, plan switches).
- **Subscription charges are never retried** on failure — best suited where value is delivered *after* payment succeeds (e.g. streaming, internet access), not pre-delivered goods.

### 3. Events fired
- `subscription.create` — subscription created.
- `charge.success` — also sent if subscription was created by attaching a plan to a transaction.
- Each billing cycle: `invoice.create` (3 days before next charge) → `charge.success` or `invoice.payment_failed` on the payment date → `invoice.update` (final status).
- On cancellation: `subscription.not_renew` (won't renew next cycle) → `subscription.disable` (on the next payment date, subscription is actually cancelled).
- On completing all billing cycles (`invoice_limit` reached): final `subscription.disable` with `status: complete`.

### Subscription statuses
| Status | Meaning |
|---|---|
| `active` | Will be charged on the next payment date |
| `non-renewing` | Active but won't be charged again (about to complete, or cancelled but not yet at end of cycle) |
| `attention` | Active, but last charge attempt failed (expired card, insufficient funds, etc.) — will retry next cycle |
| `completed` | Finished; no more charges |
| `cancelled` | Cancelled; no more charge attempts |

### Handling payment issues
- Check `most_recent_invoice` on the Fetch Subscription response for `status: "failed"` and a `description` (e.g. "Insufficient Funds").
- At the start of each month, Paystack sends `subscription.expiring_cards` listing all subscriptions whose card expires that month — proactively prompt those customers to update their card.

### Updating subscriptions
- `Update Plan` endpoint changes price/interval for a plan. Use `update_existing_subscriptions: true` to apply to current subscribers immediately (next billing cycle), or `false` to only affect new subscriptions. Omitting it applies to all.
- To let a customer swap their card/bank or cancel: generate a hosted management link —
  `GET /subscription/:code/manage/link` (build your own button/redirect), or
  `POST /subscription/:code/manage/email` (Paystack emails the customer the link directly).
  On that page, adding a new card triggers a small tokenization charge that's immediately refunded.

---

## 6f. Split Payments (Single Split)

Share a transaction's settlement between your main account and **one** subaccount.

### 1. Create a subaccount
```
POST https://api.paystack.co/subaccount
{ "business_name": "Oasis", "bank_code": "058", "account_number": "0123456047", "percentage_charge": 30 }
```
- Verify the account number/bank match your intent — Paystack isn't liable for payouts sent to the wrong account due to bad input.
- `percentage_charge`: % of the transaction that goes to your **main** account by default (rest goes to the subaccount).

### 2. Initialize a split transaction
```json
{ "email": "customer@email.com", "amount": "20000", "subaccount": "ACCT_xxxxxxxxx" }
```
Use cases: shared revenue between a platform and a service provider, splitting profit across vendors, separating fee categories (tuition/accommodation/etc.).

### Flat fee override
Instead of percentage split, take a flat amount for the main account via `transaction_charge`:
```json
{ "email": "customer@email.com", "amount": "20000", "subaccount": "ACCT_xxxxxxxxx", "transaction_charge": 10000 }
```
(main account gets 10000, subaccount gets the rest).

### Who bears the Paystack fee
By default the main account pays Paystack's transaction fee. To shift it to the subaccount:
```json
{ ..., "bearer": "subaccount" }
```
If the subaccount's share is too small to cover the fee, you get a `400 Bad Request`.

---

## 6g. Multi-split Payments

Split settlement across a main account **and multiple** subaccounts (built on top of subaccounts).

### 1. Create a transaction split
```
POST https://api.paystack.co/split
{
  "name": "Halfsies",
  "type": "percentage",   // or "flat"
  "currency": "NGN",
  "subaccounts": [ { "subaccount": "ACCT_6uujpqtzmnufzkw", "share": 50 } ]
}
```
Rules:
- No decimals for percentage shares; percentage shares must sum to ≤ 100%.
- Flat shares must be in subunits and must sum to ≤ the transaction amount.
- A split is either `flat` or `percentage`, never mixed — and the type can't be changed after creation (deactivate and recreate instead).
- You can add/remove/update subaccounts on a split, and toggle its active state, via the Transaction Splits API.

### 2. Use the split
Attach `split_code` when initializing a transaction, or when charging a saved authorization:
```json
POST /transaction/initialize
{ "email": "customer@email.com", "amount": "20000", "split_code": "SPL_98WF13Eekw" }
```
```json
POST /transaction/charge_authorization
{ "authorization_code": "AUTH_12abc345de", "email": "mail@mail.com", "amount": "300000", "split_code": "SPL_UO2vBzEqHW" }
```

### Dynamic (on-the-fly) splits
When you can't predict the split config ahead of time, pass a `split` object directly instead of a `split_code`:
```json
{
  "email": "customer@email.com",
  "amount": "20000",
  "split": {
    "type": "flat",
    "bearer_type": "account",
    "subaccounts": [
      { "subaccount": "ACCT_pwwualwty4nhq9d", "share": 6000 },
      { "subaccount": "ACCT_hdl8abxl8drhrl3", "share": 4000 }
    ]
  }
}
```
`split` object params: `type` (flat/percentage), `bearer_type` (all/all-proportional/account/subaccount), `subaccounts` (array), `bearer_subaccount` (required if `bearer_type` is `subaccount`), `reference` (optional).

### Who bears the fee (multi-split)
| `bearer_type` | Meaning |
|---|---|
| `all` | Fee split equally between main account + all subaccounts |
| `all-proportional` | Fee split proportionally by each party's share |
| `account` | Main account pays the whole fee (default) |
| `subaccount` | Only the subaccount named in `bearer_subaccount` pays |

### Webhook payload
`charge.success` includes a `split` object with `formula` (the split config used) and `shares` (actual amounts each party received).

---

## 6h. Dedicated Virtual Accounts (DVAs)

**Availability: registered businesses in Nigeria and Ghana that have completed go-live.** Lets you assign a unique bank account number to each customer; any transfer into it is automatically recorded as a transaction from that customer.

### Two integration flows
1. **Multi-step**: create customer → validate customer (if required for your business category) → create DVA — you control and check each step.
2. **Single-step**: `POST /dedicated_account/assign` with all customer + (if required) validation data in one call — Paystack handles creation and assignment.

### Set up webhooks first
Bank transfers are external and asynchronous — the only way to know a DVA was funded is via the `charge.success` webhook. The `data.authorization` object for a DVA payment includes `channel: "dedicated_nuban"`, `sender_bank`, `sender_bank_account_number`, `sender_name`, plus the receiving DVA's account number.

### Multi-step flow
1. **Create a customer** — `email`, `first_name`, `last_name`, `phone` all required (a bank account can't be named without them).
2. **Validate the customer** (Nigeria only, and only required for Betting / Financial Services / General Services business categories) — get the customer's explicit consent before collecting BVN/personal info, since it's only used with consent, not by default.
3. **Create the DVA**:
```
POST /dedicated_account
{ "customer": "CUS_358xertt55", "preferred_bank": "test-bank" }
```
   - Fetch supported banks via the Fetch Providers API.
   - Resulting account name format: `Product Name / Customer Name`. Custom naming for accounts-as-a-service businesses is available on request (email support@paystack.com).
   - Default limit: 1,000 DVAs per business (raisable on request).
   - **Testing (Nigeria only)**: use `preferred_bank: "test-bank"` with your test secret key; fund it using Paystack's demo bank app.

### Single-step flow
```
POST /dedicated_account/assign
```
- **Required compliance** (Betting/Financial/General Services, Nigeria): include `account_number`, `bvn`, `bank_code` alongside customer details — validation happens first, firing `customeridentification.success`/`.failed`, then `dedicatedaccount.assign.success`/`.failed`.
- **Optional compliance** (other categories): just customer data + `preferred_bank` — fires `dedicatedaccount.assign.success`/`.failed` directly.

### Fetching a customer's DVA
`GET` the customer via Fetch Customer API — look at the `dedicated_account` object in the response (bank, account_name, account_number, active, assigned, etc).

### Requerying a DVA (delayed webhook recovery)
If a transfer into a DVA hasn't triggered a webhook after a few minutes:
```
GET /dedicated_account/requery?account_number={accountNumber}&provider_slug={provider_slug}&date={yyyy-mm-dd}
```
Triggers a background check; if unprocessed transactions are found, they're created and the webhook fires. **Rate-limited to once per 10 minutes per account.**

### Splitting funds received on a DVA
You can attach a `subaccount` (single split) or `split_code` (multi-split) to a DVA — either at creation time or by updating an existing one via `POST`/`DELETE /dedicated_account/split`. Passing a new subaccount/split code to an account that already has one updates it; sending the delete request with no code removes the split entirely (all funds go to the main account again).

### Inbound Transfer Approval (Paystack-Titan Virtual Accounts only)
Lets you accept/reject individual inbound transfers before they complete. Enable it in Dashboard → Preferences → Virtual Accounts, and set a webhook URL. On an inbound transfer attempt, Paystack POSTs payer/receiver details to your URL and **you must respond within 5 seconds** with:
```json
{ "decision": "REJECT" or "ACCEPT", "reason": "Optional explanation" }
```
Must return `200 OK`. If you don't respond in time (or your endpoint is unreachable), Paystack **auto-accepts** the transfer and does not retry the webhook.

---

## 6i. Terminal (In-Person Payments)

Bridges online and offline payments for POS-style flows. Four integration types: **Invoice Payments**, **Push Payment Requests**, **Custom apps** (via Terminal Intents), and **Virtual Terminal** (in-person payments with no POS device).

### Push Payment Requests flow
1. **Create a payment request** (invoice) —
```
POST /paymentrequest
{
  "customer": "CUS_5lgv9bc41uw15pb",
  "description": "Invoice for Damilola",
  "line_items": [
    { "name": "Pancakes and sausage", "amount": "2000", "quantity": 1 },
    { "name": "Chicken Salad", "amount": "3000", "quantity": 1 }
  ]
}
```
   Save the returned `id` and `offline_reference`.

2. **(Optional) Check terminal status** before pushing:
```
GET /terminal/:id/presence
```
   Only push if both `online: true` and `available: true`.

3. **Push the request to the terminal**:
```
POST /terminal/:terminal_id/event
{ "type": "invoice", "action": "process", "data": { "id": 7895939, "reference": 4634337895939 } }
```
   A successful response only confirms Paystack received and forwarded the push — **not** that the physical device received it.

4. **Verify delivery to the device** (within 48 hours of the push):
```
GET /terminal/:terminal_id/event/:event_id
```

5. **Listen for payment webhooks**: `charge.success` (full transaction/customer/card details), `paymentrequest.success` (invoice paid), `paymentrequest.pending` (request created), `invoice.payment_failed` (payment failed). If your webhook endpoint is down, Paystack retries hourly for 72 hours; after that, verify manually via the Verify Payment Request API or the dashboard.

---

## 6j. Refunds

Repay a customer in part or in full for a previous successful transaction.

### Create a refund
```
POST https://api.paystack.co/refund
{ "transaction": "qufywna9w9a5d8v", "amount": "10000" }
```
- Omit `amount` → full refund. Include it → partial refund. `amount` must not exceed the original transaction amount.

### Retry a refund (missing bank details)
If Paystack couldn't determine the customer's bank account from the original payment rails, refund status becomes `needs-attention`. Supply the account manually (can differ from the original payment method):
```
POST /refund/retry_with_customer_details/{id}
{ "refund_account_details": { "currency": "NGN", "account_number": "1234567890", "bank_id": "9" } }
```
Only call this in response to a `refund.needs-attention` webhook — otherwise you get `422 Unprocessable Entity`.

### List refunds
```
GET https://api.paystack.co/refund
```

### Refund status lifecycle

| Refund status | Meaning | Associated transaction status |
|---|---|---|
| `pending` | Initiated, awaiting processor response | Reversal Pending |
| `processing` | Received by processor | Reversal Pending |
| `needs-attention` | Need customer bank details to proceed | Reversal Pending |
| `failed` | Couldn't process — your account was credited back | Success |
| `processed` | Successfully processed by processor | Reversed |

Note: even once `processed`, it can take up to **10 business days** for the customer to actually see the funds.

### Webhook events
`refund.pending`, `refund.processing`, `refund.needs-attention`, `refund.failed`, `refund.processed`.

---

## 7. General integration notes / gotchas

- **Always verify server-side** before delivering value — never trust only a frontend callback or a redirect visit.
- **Always double-check `data.amount`** on verify to make sure it matches what you expected to charge.
- **Idempotency**: use unique references for transactions/transfers, and retry failures with the *same* reference rather than minting new ones, to prevent duplicate charges/payouts.
- **Webhooks currently only fire for successful transactions** (per the Verify Payments page) — don't rely on them alone for failure handling; also check the Verify endpoint / redirect flow.
- **Amounts are always in subunits** (kobo/cents/etc.) — a very common integration bug is forgetting to multiply/divide by 100.
- Paystack CLI and a Postman collection exist to help with local integration testing (mentioned across docs, not detailed here).
- Community/support: Payslack (Slack community), and https://paystack.com/docs/ search bar for anything not covered here.

---

## Sources
- https://paystack.com/docs/ (home)
- https://paystack.com/docs/payments/accept-payments/
- https://paystack.com/docs/payments/verify-payments/
- https://paystack.com/docs/payments/webhooks/
- https://paystack.com/docs/payments/recurring-charges/
- https://paystack.com/docs/payments/subscriptions/
- https://paystack.com/docs/payments/split-payments/
- https://paystack.com/docs/payments/multi-split-payments/
- https://paystack.com/docs/payments/dedicated-virtual-accounts/
- https://paystack.com/docs/payments/refunds/
- https://paystack.com/docs/transfers/single-transfers/
- https://paystack.com/docs/terminal/
- https://paystack.com/docs/terminal/push-payment-requests/
- https://paystack.com/docs/identity-verification/
- https://paystack.com/docs/identity-verification/verify-account-number/
- https://paystack.com/docs/identity-verification/validate-customer/
- https://paystack.com/docs/api/
- https://paystack.com/docs/api/authentication/
- https://paystack.com/docs/api/errors/
- https://paystack.com/docs/api/pagination/

*Not covered in depth (didn't have a stable/discoverable doc URL, or is a bulk-testing/tooling topic rather than integration mechanics): Disputes/Chargebacks integration guide (the endpoint exists — it's listed under cursor-pagination-supported resources — but I couldn't find its guide page; the `charge.dispute.*` webhook events are documented under Webhooks above), Bulk Charges, the full line-by-line API Reference (all endpoints/parameters — api.paystack.co's Postman/API reference site), rate limits (referenced but page not found at the guessed URL), Paystack CLI usage, and country-specific payment channel nuances (USSD codes, bank list quirks, etc). If your app needs any of these, tell me which and I'll go pull that specific page.*
