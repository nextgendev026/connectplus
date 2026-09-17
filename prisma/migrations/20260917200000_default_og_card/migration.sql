-- Point the stored social-share image at the real 1200×630 card.
--
-- `ogImage` is a settings row, and a stored row always beats a changed default —
-- so every deployment created before the landscape card existed keeps serving
-- the square app icon while the platform metadata declares it as 1200×630, which
-- is why every shared link rendered as a letterboxed or cropped square.
--
-- Only the exact legacy default is rewritten. An operator who deliberately
-- pointed this setting at their own artwork keeps it.
UPDATE "PlatformSetting"
SET "value" = '/og-default.png',
    "updatedAt" = NOW()
WHERE "key" = 'ogImage'
  AND "value" = '/pwa-512.png';
