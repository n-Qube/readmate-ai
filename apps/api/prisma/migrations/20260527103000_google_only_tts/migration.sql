-- Remove legacy OpenAI provider selections now that Google TTS is the only supported backend.
UPDATE "ReadingDocument"
SET "provider" = 'google',
    "voice" = 'en-US-Neural2-F'
WHERE "provider" <> 'google';

UPDATE "UserSettings"
SET "provider" = 'google',
    "voice" = 'en-US-Neural2-F'
WHERE "provider" <> 'google';

ALTER TABLE "ReadingDocument" ALTER COLUMN "provider" SET DEFAULT 'google';
ALTER TABLE "UserSettings" ALTER COLUMN "provider" SET DEFAULT 'google';
