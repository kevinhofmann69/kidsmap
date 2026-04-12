const SUPABASE_URL = "https://epybdsrkxgkfrbwdnwae.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVweWJkc3JreGdrZnJid2Rud2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NTczODIsImV4cCI6MjA5MTUzMzM4Mn0.fKQ6d30zJ_rY6IsWRI7xr78uuSCEU0iM5swlJblLHbM"; // Supabase → Settings → API → anon public

const ICONS = {
  playground:    "🛝",
  toilet:        "🚻",
  "playground-wc": "🛝",
};

// --- Letzten Standort laden ---
function getSavedView() {
  try {
    const saved = localStorage.getItem("kidsmap_view");
    if (saved) return JSON.parse(saved);
  } catch {}
  return null;
}

function saveView(center, zoom) {
  localStorage.setItem("kidsmap_view", JSON.stringify({
    center: [center.lng, center.lat],
    zoom,
  }));
}

const savedView = getSavedView();

// --- Karte ---
const map = new maplibregl.Map({
  container: "map",
  style: "https://tiles.openfreemap.org/styles/liberty",
  center: savedView ? savedView.center : [13.405, 52.52],
  zoom: savedView ? savedView.zoom : 13,
});

map.addControl(new maplibregl.NavigationControl(), "bottom-right");
map.addControl(
  new maplibregl.GeolocateControl({
    positionOptions: { enableHighAccuracy: true },
    trackUserLocation: true,
    showUserHeading: true,
  }),
  "bottom-right"
);

// --- Filter State ---
const filters = {
  playground: true,
  toilet: true,
  playground_wc: false,
};

// --- Marker Management ---
let allPOIs = [];
let markers = [];
let fetchTimeout = null;
let lastCenter = null;

function clearMarkers() {
  markers.forEach(m => m.remove());
  markers = [];
}

function getMarkerClass(poi) {
  if (poi.nearby_toilet && filters.playground_wc) return "playground-wc";
  return poi.type;
}

function renderMarkers() {
  clearMarkers();

  const visible = allPOIs.filter(poi => {
    if (filters.playground_wc) {
      return poi.type === "playground" && poi.nearby_toilet;
    }
    if (poi.type === "playground") return filters.playground;
    if (poi.type === "toilet")     return filters.toilet;
    return false;
  });

  visible.forEach(poi => {
    const cls = poi.nearby_toilet && poi.type === "playground" ? "playground-wc" : poi.type;
    const el = document.createElement("div");
    el.className = `marker ${cls}`;
    el.textContent = ICONS[cls] || ICONS[poi.type];
    el.title = poi.name || (poi.type === "playground" ? "Spielplatz" : "Toilette");

    const marker = new maplibregl.Marker({ element: el })
      .setLngLat([poi.lng, poi.lat])
      .setPopup(
        new maplibregl.Popup({ offset: 20, closeButton: false }).setHTML(`
          <div style="font-size:13px; line-height:1.5">
            <strong>${poi.name || (poi.type === "playground" ? "Spielplatz" : "Toilette")}</strong>
            ${poi.nearby_toilet ? '<br><span style="color:#f97316;font-size:11px">🚻 WC in der Nähe</span>' : ""}
          </div>
        `)
      )
      .addTo(map);

    markers.push(marker);
  });
}

async function fetchPOIs(center) {
  if (lastCenter) {
    const dx = center.lng - lastCenter.lng;
    const dy = center.lat - lastCenter.lat;
    const dist = Math.sqrt(dx * dx + dy * dy) * 111000;
    if (dist < 300) return;
  }

  lastCenter = center;

  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/get_pois`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_ANON_KEY,
      },
      body: JSON.stringify({ lat: center.lat, lng: center.lng, radius: 2000 }),
    });
    allPOIs = await res.json();
    renderMarkers();
  } catch (err) {
    console.error("Fetch error:", err);
  }
}

map.on("moveend", () => {
  const c = map.getCenter();
  saveView(c, map.getZoom());

  clearTimeout(fetchTimeout);
  fetchTimeout = setTimeout(() => {
    fetchPOIs({ lat: c.lat, lng: c.lng });
  }, 500);
});

// Initialer Load
map.on("load", () => {
  const c = map.getCenter();
  fetchPOIs({ lat: c.lat, lng: c.lng });
});

// --- Filter UI ---
const filterToggleBtn = document.getElementById("filter-toggle");
const filterMenu = document.getElementById("filter-menu");

filterToggleBtn.addEventListener("click", () => {
  filterMenu.classList.toggle("hidden");
});

document.querySelectorAll(".filter-row").forEach(btn => {
  btn.addEventListener("click", () => {
    const f = btn.dataset.filter;

    if (f === "playground_wc") {
      filters.playground_wc = !filters.playground_wc;
      if (filters.playground_wc) {
        filters.playground = false;
        filters.toilet = false;
      }
    } else {
      filters[f] = !filters[f];
      if (filters[f]) {
        filters.playground_wc = false;
      }
    }

    // UI sync
    document.querySelectorAll(".filter-row").forEach(b => {
      const active = filters[b.dataset.filter];
      b.classList.toggle("active", active);
    });

    renderMarkers();
  });
});
