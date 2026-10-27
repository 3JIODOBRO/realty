-- Run after the first migration: npm run db:postgis
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Keep geography column in sync with lat/lng
CREATE OR REPLACE FUNCTION listing_sync_location() RETURNS trigger AS $$
BEGIN
  NEW.location := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS listing_location_trg ON "Listing";
CREATE TRIGGER listing_location_trg BEFORE INSERT OR UPDATE OF lat, lng ON "Listing"
  FOR EACH ROW EXECUTE FUNCTION listing_sync_location();

CREATE INDEX IF NOT EXISTS listing_location_gist ON "Listing" USING GIST (location);
CREATE INDEX IF NOT EXISTS message_body_trgm ON "Message" USING GIN (body gin_trgm_ops);
