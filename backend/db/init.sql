CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS pois (
  id          BIGSERIAL PRIMARY KEY,
  osm_id      BIGINT UNIQUE,
  type        VARCHAR(50) NOT NULL,        -- 'playground' | 'toilet'
  name        VARCHAR(255),
  location    GEOGRAPHY(POINT, 4326) NOT NULL,
  tags        JSONB DEFAULT '{}',
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pois_location ON pois USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_pois_type     ON pois (type);
