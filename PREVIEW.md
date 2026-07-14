# Previewing the Interview Prep feature (branch `feature/interview-prep`)

Interview Prep needs a live backend: **new Postgres tables + 4 edge functions**.
This runbook gets you a fully functional, isolated preview **without touching
production** (`resuvibe.ai` / Supabase project `fatldfxqimgvowikjwkh`).

## What the backend must have
1. The **current app schema** (`profiles`, `job_applications`, `generation_usage`, …).
2. Our migration `supabase/migrations/20260710113516_interview-prep.sql` applied
   (adds `user_entitlements`, `interview_*`, and `generation_usage` token/cost columns).
3. The **4 edge functions** deployed/served: `get-interview-entitlement`,
   `start-interview-session`, `generate-interview-plan`, `score-interview-answer`.
4. The **`LOVABLE_API_KEY`** secret set (all AI functions use the Lovable gateway).

> ⚠️ **Load-bearing caveat.** Part of this app's schema (`profiles`,
> `generation_usage`, `user_roles`, …) was created via the Lovable/Supabase
> dashboard and is **NOT** in `supabase/migrations`. So a from-scratch local
> `supabase start` will be missing those tables and our migration's
> `ALTER TABLE generation_usage` will fail. You must **reproduce the current
> schema first** (both paths below handle this).

---

## Path A — Supabase preview branch / throwaway project (recommended)

Cleanest, because it starts from the *current* schema and just layers our changes.

1. Create a **non-prod** backend that mirrors current prod schema — either a
   Supabase **preview branch** (Dashboard → Branching) or a **new project** you
   restore the prod schema into (`supabase db dump --linked -f schema.sql` from prod
   is read-only introspection; load it into the new project).
2. Point the CLI at that non-prod ref and apply the feature:
   ```bash
   supabase link --project-ref <NON_PROD_REF>
   supabase db push                       # applies 20260710113516_interview-prep.sql
   supabase functions deploy get-interview-entitlement start-interview-session \
     generate-interview-plan score-interview-answer
   supabase secrets set LOVABLE_API_KEY=<your key>   # (+ INTERVIEW_AI_MODEL optional)
   ```
3. Point the app at it (use `.env.local` so your real `.env` is untouched):
   ```
   VITE_SUPABASE_URL=<non-prod url>
   VITE_SUPABASE_PUBLISHABLE_KEY=<non-prod anon key>
   ```
4. `npm run dev`, sign up, generate a resume for an application (unlocks the tab) —
   or use the **seed shortcut** below.

## Path B — Fully local stack (advanced; needs Docker + Supabase CLI)

Neither is installed by default — `brew install supabase/tap/supabase` + Docker Desktop.

```bash
# 1. Materialize the CURRENT schema locally (read-only dump from prod):
supabase link --project-ref fatldfxqimgvowikjwkh     # do NOT `db push` to this ref
supabase db dump --linked --schema public -f /tmp/prod_schema.sql

# 2. Start local Supabase, then load prod schema, then ONLY our new migration:
supabase start
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" -f /tmp/prod_schema.sql
psql "$(supabase status -o env | grep DB_URL | cut -d= -f2-)" \
  -f supabase/migrations/20260710113516_interview-prep.sql

# 3. Serve functions with the gateway key:
cp supabase/functions/.env.example supabase/functions/.env   # fill in LOVABLE_API_KEY
supabase functions serve --env-file supabase/functions/.env
```

Then `.env.local` → the local URL/anon key from `supabase status`, and `npm run dev`.
(If `supabase start` auto-applies `migrations/*` and double-applies our migration,
temporarily move it aside during step 2, or use `supabase db reset` semantics.)

---

## Seed shortcut — land straight on a working Interview Prep tab

Skips the resume pipeline by inserting a confirmed, past-onboarding user + an
application that already has `resume_html` + a JD:

```bash
SUPABASE_URL=<local or non-prod url> \
SUPABASE_SERVICE_ROLE_KEY=<service_role key> \
node scripts/seed-interview-preview.mjs
```

It prints login creds and the exact `/applications/<id>/interview-prep` URL. (The
seeded user is free-tier with an unclaimed trial, so **"Begin interview" spends the
one free trial** — the paywall path is reachable by creating a second application
and opening its Interview Prep.) The script refuses hosted URLs unless
`ALLOW_REMOTE=1`, and should never be pointed at production.

## Notes
- **No `config.toml` changes needed** — the 4 functions use default JWT
  verification, which is correct (they read `Authorization` and call `auth.getUser`).
- **Never** `supabase db push` / `functions deploy` against the prod ref
  (`fatldfxqimgvowikjwkh`) just to preview — that is the real resuvibe.ai backend and
  is the human/ops "staging" decision, not a preview step.
