-- "Direct radio streams (HD)" was never read by any code path, so the value in
-- an existing row is not operator intent: it is the 'false' the catalog seeded
-- when the row was created. Direct playback is the intended behaviour now, and
-- the reason is concrete — proxying audio through this app meant every listener
-- reached the station from one datacenter IP (the app's Frankfurt function
-- region), which is what made ad-inserting relays serve geo-targeted German
-- spots to an East African audience.
--
-- The rewrite is deliberately narrow: only rows still holding that old default.
-- An operator who has since turned direct playback OFF keeps it off, and this
-- statement never runs twice.
UPDATE "PlatformSetting"
SET "value" = 'true', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'radioDirectStream' AND "value" = 'false';

-- The browser chooses the transport per channel, so the flag has to travel in
-- /api/settings/public with the rest of the public config.
UPDATE "PlatformSetting"
SET "isPublic" = true, "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'radioDirectStream' AND "isPublic" = false;
