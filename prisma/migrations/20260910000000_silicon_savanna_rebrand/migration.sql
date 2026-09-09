-- Silicon Savanna rebrand: migrate live site-identity copy to the new voice.
-- Only rows still carrying the previous defaults are touched; any value an
-- admin customized is left exactly as they set it.
UPDATE "PlatformSetting"
SET "value" = 'Voices of the Silicon Savanna', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'siteTagline'
  AND "value" = 'Stories that connect East Africa';

UPDATE "PlatformSetting"
SET "value" = 'Homegrown stories, tech, and ideas from East Africa''s Silicon Savanna — Nairobi to Kigali, Kampala to Dar es Salaam. Read, write, listen, and belong.', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'siteDescription'
  AND "value" = 'A modern social blogging platform sharing stories, ideas, and perspectives from across East Africa. Join the conversation.';

UPDATE "PlatformSetting"
SET "value" = 'Silicon Savanna, blog, East Africa, Nairobi, Kampala, Dar es Salaam, Kigali, African tech, stories, writing, community, radio', "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'seoKeywords'
  AND "value" = 'blog, East Africa, Nairobi, Kampala, Dar es Salaam, Kigali, stories, writing, community';
