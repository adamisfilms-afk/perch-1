@AGENTS.md

# The Switchboard

Internal operating system for a speech pathology / OT referral network. See README.md for the full picture.

- Business rules (status machines, go-live gate, offers, credential expiry, outbox) live in SQL in `supabase/migrations/`. Change them there, not in the app, and add a test to `tests/db/switchboard.test.ts`.
- Every table has row-level security; every role check also requires MFA (`private.mfa_satisfied`). Never query family data with the service-role client in code that runs for a signed-in user: use `createClient()` from `src/lib/supabase/server.ts`.
- `src/lib/domain.ts` mirrors the database enums and transitions: keep them in sync.
- Messages are queued in `message_log` by database functions and sent by `src/lib/notifications/outbox.ts`.
- Checks: `npm run lint && npm run typecheck && npm test`, and `TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/postgres npm run test:db` (needs a local Postgres 15+).
