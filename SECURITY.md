# Security Policy

## Reporting a Vulnerability

Please report security vulnerabilities privately via
[GitHub Security Advisories](https://github.com/nextgendev026/connectplus/security/advisories/new).

Do **not** open public issues for security reports.

We aim to acknowledge reports within 48 hours and to provide a fix timeline
within 5 business days of triage.

## Supported Versions

| Version | Supported |
|---------|-----------|
| main    | ✅        |

Only the latest code on `main` receives fixes. There are no versioned release
branches; deployments track `main` directly (Vercel for the application, a
Cloudflare Worker for the edge cache in front of it).

## Scope and Known Controls

- All outbound fetches of URLs the application did not choose go through the
  SSRF guard in `src/lib/safe-fetch.ts` (scheme and hostname rules, DNS
  resolution of every answer, redirect hops re-validated, body capped).
- Cookie-authenticated mutations are origin-checked in `src/middleware.ts`.
- Anonymous rate limits are keyed by platform-set headers with a shared
  ceiling for unattributable traffic — not by client-supplied `x-forwarded-for`.
- Writes proposed from chat or the brain are filed into an approval queue
  (`src/lib/brain-approvals.ts`) and run only after a human approves them.
- CI runs separate security gates: dependency audit (production deps,
  high/critical), gitleaks secret scanning, CodeQL SAST, and a Prisma
  migration-drift check (`.github/workflows/security.yml`).

## Disclosure Policy

We aim to acknowledge reports within 48 hours and to provide a fix timeline
within 5 business days of triage. Credit is given in the fix notes unless you
prefer to stay anonymous.
