/**
 * OSM Import Script
 * Fetches playgrounds and public toilets from Overpass API
 * and upserts them into the PostgreSQL database.
 *
 * Usage:
 *   node scripts/import-osm.js --city munich
 *   node scripts/import-osm.js --bbox 48.06,11.36,48.25,11.72
 */

require("dotenv").config();
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const db = require("../src/db");

// Predefined city bounding boxes [south, west, north, east]
const CITIES = {
  munich:  [48.06, 11.36, 48.25, 11.72],
  berlin:  [52.34, 13.09, 52.68, 13.76],
  hamburg: [53.39, 9.73,  53.71, 10.33],
};

const OVERPASS_MIRRORS = [
  "https://overpass.kumi.systems/api/interpreter",
  "https://overpass-api.de/api/interpreter",
];

async function fetchOverpass(query) {
  for (const url of OVERPASS_MIRRORS) {
    try {
      console.log(`  Trying ${url} ...`);
      const res = await fetch(url, {
        method: "POST",
        body: "data=" + encodeURIComponent(query),
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(90_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`  Failed (${err.message}), trying next mirror...`);
    }
  }
  throw new Error("All Overpass mirrors failed");
}

function buildQuery(south, west, north, east) {
  const bbox = `${south},${west},${north},${east}`;
  return `
    [out:json][timeout:120];
    (
      node["leisure"="playground"](${bbox});
      node["amenity"="toilets"](${bbox});
      way["leisure"="playground"](${bbox});
      way["amenity"="toilets"](${bbox});
    );
    out center;
  `;
}

function mapType(tags) {
  if (tags.leisure === "playground") return "playground";
  if (tags.amenity === "toilets") return "toilet";
  return "unknown";
}

// Ways haben keine lat/lon direkt, sondern ein center-Objekt
function getCoords(element) {
  if (element.type === "way") return element.center;
  return { lat: element.lat, lon: element.lon };
}

async function importNodes(nodes) {
  let inserted = 0;
  let updated = 0;

  for (const node of nodes) {
    const type = mapType(node.tags || {});
    if (type === "unknown") continue;

    const name = node.tags?.name || null;
    const tags = node.tags || {};

    const result = await db.query(
      `INSERT INTO pois (osm_id, type, name, location, tags)
       VALUES ($1, $2, $3, ST_MakePoint($5, $4)::geography, $6)
       ON CONFLICT (osm_id) DO UPDATE
         SET type = EXCLUDED.type,
             name = EXCLUDED.name,
             location = EXCLUDED.location,
             tags = EXCLUDED.tags,
             updated_at = NOW()
       RETURNING (xmax = 0) AS inserted`,
      [node.id, type, name, getCoords(node).lat, getCoords(node).lon, JSON.stringify(tags)]
    );

    if (result.rows[0].inserted) inserted++;
    else updated++;
  }

  return { inserted, updated };
}

async function main() {
  const args = process.argv.slice(2);
  let bbox;

  const cityIndex = args.indexOf("--city");
  const bboxIndex = args.indexOf("--bbox");

  if (cityIndex !== -1) {
    const cityName = args[cityIndex + 1];
    bbox = CITIES[cityName];
    if (!bbox) {
      console.error(`Unknown city: ${cityName}. Available: ${Object.keys(CITIES).join(", ")}`);
      process.exit(1);
    }
    console.log(`Importing OSM data for: ${cityName}`);
  } else if (bboxIndex !== -1) {
    bbox = args[bboxIndex + 1].split(",").map(Number);
    console.log(`Importing OSM data for bbox: ${bbox.join(", ")}`);
  } else {
    console.error("Usage: node scripts/import-osm.js --city munich");
    console.error("       node scripts/import-osm.js --bbox 48.06,11.36,48.25,11.72");
    process.exit(1);
  }

  const [south, west, north, east] = bbox;

  console.log("Fetching from Overpass API...");
  const data = await fetchOverpass(buildQuery(south, west, north, east));
  console.log(`Received ${data.elements.length} nodes`);

  console.log("Importing into database...");
  const { inserted, updated } = await importNodes(data.elements);
  console.log(`Done. Inserted: ${inserted}, Updated: ${updated}`);

  await db.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
