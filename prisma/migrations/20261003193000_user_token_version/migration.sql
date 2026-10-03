-- Session revocation (F-10): every JWT carries the tokenVersion it was issued
-- with; the session refresh in src/lib/auth.ts compares it to this column and
-- invalidates the session on mismatch. Incrementing it (password change, or
-- POST /api/user/sessions) signs every outstanding session out at its next
-- refresh instead of waiting out the JWT's 30-day life.

ALTER TABLE "User" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
