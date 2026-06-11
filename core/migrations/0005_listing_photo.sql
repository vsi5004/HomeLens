-- Listing preview photo (the og:image / JSON-LD image from the listing page).
-- Stored as a URL only; loaded on demand like a link-preview thumbnail.
ALTER TABLE properties ADD COLUMN photo_url TEXT;
