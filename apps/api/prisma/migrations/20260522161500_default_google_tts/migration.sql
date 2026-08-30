-- Align new records with the provider that is currently verified for this project.
ALTER TABLE "ReadingDocument" ALTER COLUMN "provider" SET DEFAULT 'google';
ALTER TABLE "ReadingDocument" ALTER COLUMN "voice" SET DEFAULT 'en-US-Neural2-F';

ALTER TABLE "UserSettings" ALTER COLUMN "provider" SET DEFAULT 'google';
ALTER TABLE "UserSettings" ALTER COLUMN "voice" SET DEFAULT 'en-US-Neural2-F';
