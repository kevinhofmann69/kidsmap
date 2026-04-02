const express = require("express");
const router = express.Router();
const db = require("../db");

// GET /pois?lat=48.13&lng=11.58&radius=2000&type=playground&has_toilet=true
router.get("/", async (req, res) => {
  const { lat, lng, radius = 2000, type, bbox, has_toilet } = req.query;

  const buildFilters = (startIndex, existingParams) => {
    const conditions = [];
    const params = [...existingParams];

    if (type) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }
    if (has_toilet === "true") {
      conditions.push(`nearby_toilet = true`);
    }

    return { conditions, params };
  };

  try {
    let query, params;

    if (bbox) {
      const [minLat, minLng, maxLat, maxLng] = bbox.split(",").map(Number);
      const base = [minLng, minLat, maxLng, maxLat];
      const { conditions, params: p } = buildFilters(5, base);
      const where = conditions.length ? "AND " + conditions.join(" AND ") : "";
      query = `
        SELECT
          id::int, osm_id::text, type, name, tags, nearby_toilet,
          ST_Y(location::geometry) AS lat,
          ST_X(location::geometry) AS lng
        FROM pois
        WHERE location && ST_MakeEnvelope($1, $2, $3, $4, 4326)
        ${where}
        LIMIT 2000
      `;
      params = p;
    } else {
      if (!lat || !lng) {
        return res.status(400).json({ error: "lat and lng are required" });
      }
      const base = [lat, lng, radius];
      const { conditions, params: p } = buildFilters(4, base);
      const where = conditions.length ? "AND " + conditions.join(" AND ") : "";
      query = `
        SELECT
          id::int, osm_id::text, type, name, tags, nearby_toilet,
          ST_Y(location::geometry) AS lat,
          ST_X(location::geometry) AS lng,
          ST_Distance(location, ST_MakePoint($2, $1)::geography) AS distance_m
        FROM pois
        WHERE ST_DWithin(location, ST_MakePoint($2, $1)::geography, $3)
        ${where}
        ORDER BY distance_m
        LIMIT 500
      `;
      params = p;
    }

    const result = await db.query(query, params);
    res.json({ count: result.rows.length, data: result.rows });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

// GET /pois/:id
router.get("/:id", async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id::int, osm_id::text, type, name, tags, nearby_toilet,
        ST_Y(location::geometry) AS lat,
        ST_X(location::geometry) AS lng
       FROM pois WHERE id = $1`,
      [req.params.id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: "Not found" });
    res.json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Database error" });
  }
});

module.exports = router;
