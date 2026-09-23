-- Cartesia is retired. Premium natural-voice preferences move to Gemini 3.8 Flash TTS.
UPDATE "UserSettings"
SET "provider" = 'gemini',
    "voice" = 'Kore'
WHERE "provider" = 'cartesia';

-- Documents only record the Google provider; playback follows user settings.
UPDATE "ReadingDocument"
SET "provider" = 'google',
    "voice" = 'en-US-Neural2-F'
WHERE "provider" = 'cartesia';
