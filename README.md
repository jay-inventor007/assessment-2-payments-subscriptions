# Payment and Subscription Slice

A subscription flow on Paystack: pick a plan, pay, upgrade or downgrade, cancel with access retained until the paid period ends. Auth is reused from the Authentication slice. Built with React and TypeScript on the frontend, Supabase Postgres and Edge Functions on the backend.

See `DOCUMENTATION.md` for the full write-up: setup steps, the request flow, the data model, and the concepts behind the implementation. `PLAN.md` and `docs/paystack-reference.md` are working notes kept from the build.

## Quick start

```
npm install
cp .env.example .env   # fill in VITE_API_BASE_URL
npm run dev
```

Full setup, including linking the Supabase project and deploying Edge Functions, is in `DOCUMENTATION.md`.
