<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

---

## Supabase topology — TWO accounts, do not mix (IMPORTANT)

There are **two separate Supabase accounts**. Future agents MUST read this to avoid
"wrong project" mistakes. The two project refs below are **NOT** interchangeable.

### NEW — primary / source of truth (ACTIVE)
- **Account**: the current/live account used for everything new.
- **Project ref**: `sobouolsnvgksdjzpcsj` (lives in `.env`, `.env.example`, `.env.local`,
  and Vercel `DATABASE_URL` / `DIRECT_URL`).
- **Role**: the single source of truth. All migrations, new schema, Realtime, all new writes.
- The running deployment points here. This database currently holds the **schema only**
  (rows are empty or partial until the OLD→NEW copy completes).

### OLD — legacy / read-only source (DATA LIVES HERE)
- **Account**: the older account that owns the real historical row data.
- **Project ref**: `eligxvxirkfnqqkywxhv` (only referenced via the OLD account's PAT / its
  connection string — it is NOT in `.env` or Vercel).
- **Role**: **read-only** legacy source. All real posts/comments/likes/RSS/neural memory rows
  live here. Nothing new is written to it. Direction of copy is ALWAYS `OLD → NEW`.

### How they're wired in code
- Default `prisma` client → reads `DATABASE_URL` (NEW project).
- `src/lib/prisma-legacy.ts` → gated read-only legacy client → `LEGACY_DATABASE_URL`
  (OLD project). Falls back safely if unset.
- Copy tooling moves rows OLD→NEW in **dependency order**:
  users/settings → posts → comments/likes → RSS feeds → neural memory.
- **Secrets**: the OLD account PAT + `LEGACY_DATABASE_URL` are private, never committed.
  The OLD PAT token is stored in the user's own env, NOT in this repo.

Verification tip: after any Supabase-copy or env change, run tsc/lint/tests — and confirm
`DATABASE_URL` still points at `sobouolsnvgksdjzpcsj`. If a URL references
`eligxvxirkfnqqkywxhv`, that is the OLD/legacy read-only source — treat it as read-only.

---

## Supabase topology — TWO accounts, do not mix (IMPORTANT)

There are **two separate Supabase accounts**. Future agents MUST understand this to avoid
"wrong project" mistakes. The two project refs below are **NOT** interchangeable.

### NEW — primary / source of truth (ACTIVE)
- **Account**: the current/live account used for everything new.
- **Project ref**: `sobouolsnvgksdjzpcsj` (lives in `.env`, `.env.example`, `.env.local`,
  and Vercel `DATABASE_URL` / `DIRECT_URL`).
- **Role**: the single source of truth. All migrations, new schema, Realtime, all new writes.
- The running deployment points here. This database currently holds the **schema only**
  (rows are empty or partial until the OLD→NEW copy completes).

### OLD — legacy / read-only source (DATA LIVES HERE)
- **Account**: the older account that owns the real historical row data.
- **Project ref**: `eligxvxirkfnqqkywxhv` (only referenced via the OLD account's PAT / its
  connection string — it is NOT in `.env` or Vercel).
- **Role**: **read-only** legacy source. All real posts/comments/likes/RSS/neural memory rows
  live here. Nothing new is written to it. Direction of copy is ALWAYS `OLD → NEW`.

### How they're wired in code
- Default `prisma` client → reads `DATABASE_URL` (NEW project).
- `src/lib/prisma-legacy.ts` → gated read-only legacy client → `LEGACY_DATABASE_URL`
  (OLD project). Falls back safely if unset.
- Copy tooling moves rows OLD→NEW in **dependency order**:
  users/settings → posts → comments/likes → RSS feeds → neural memory.
- **Secrets**: the OLD account PAT + `LEGACY_DATABASE_URL` are private, never committed.
  The OLD PAT token is stored in the user's own env, NOT in this repo.

Verification tip: after any Supabase-copy or env change, run tsc/lint/tests — and confirm
`DATABASE_URL` still points at `sobouolsnvgksdjzpcsj`. If a URL references
`eligxvxirkfnqqkywxhv`, that is the OLD/legacy read-only source — treat it as read-only.

