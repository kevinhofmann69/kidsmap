console.log("app.js geladen");
const SUPABASE_URL = "https://epybdsrkxgkfrbwdnwae.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVweWJkc3JreGdrZnJid2Rud2FlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU5NTczODIsImV4cCI6MjA5MTUzMzM4Mn0.fKQ6d30zJ_rY6IsWRI7xr78uuSCEU0iM5swlJblLHbM";

const ICONS = {
  playground:     "🛝",
  toilet:         "🚾",
  "playground-wc": "🌞",
  family_centre:  "🫃🏻",
};

const COLORS = {
  playground:      "#22c55e",
  toilet:          "#3b82f6",
  "playground-wc": "#f97316",
  family_centre:   "#a855f7",
};

const SHADOWS = {
  playground:      "#15803d",
  toilet:          "#1e40af",
  "playground-wc": "#c2410c",
  family_centre:   "#7e22ce",
};

const LABELS = {
  playground:    "Spielplatz",
  toilet:        "Toilette",
  family_centre: "Familienzentrum",
};

// --- Pin HTML erzeugen ---
function createPinElement(cls) {
  const color  = COLORS[cls]  || COLORS.playground;
  const shadow = SHADOWS[cls] || SHADOWS.playground;
  const emoji  = ICONS[cls]   || "📍";

  const id = `sh-${cls}-${Math.random().toString(36).slice(2, 7)}`;

  const wrapper = document.createElement("div");
  wrapper.className = "pin-wrapper";
  wrapper.innerHTML = `
    <div class="pin-inner">
      <svg viewBox="0 0 56 72" fill="none" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <filter id="${id}" x="-40%" y="-20%" width="180%" height="180%">
            <feDropShadow dx="0" dy="2" stdDeviation="2"
              flood-color="${shadow}" flood-opacity="0.3"/>
          </filter>
        </defs>
        <path d="M28 4C16.954 4 8 12.954 8 24C8 38 28 68 28 68C28 68 48 38 48 24C48 12.954 39.046 4 28 4Z"
              fill="${color}" filter="url(#${id})"/>
      </svg>
      <div class="pin-emoji">${emoji}</div>
    </div>
    <div class="pin-shadow"></div>
  `;
  return wrapper;
}

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
  zoom:   savedView ? savedView.zoom   : 13,
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
console.log("map erstellt", map);
// --- Filter State ---
const filters = {
  playground:    true,
  toilet:        true,
  playground_wc: false,
  family_centre: true,
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

function renderMarkers() {
  clearMarkers();

  const visible = allPOIs.filter(poi => {
    if (filters.playground_wc) {
      return (poi.type === "playground" && poi.nearby_toilet) || poi.type === "family_centre";
    }
    if (poi.type === "playground") return filters.playground;
    if (poi.type === "toilet")     return filters.toilet;
    if (poi.type === "family_centre") return filters.family_centre;
    return false;
  });

  visible.forEach(poi => {
    const cls = poi.nearby_toilet && poi.type === "playground" ? "playground-wc" : poi.type;
    const label = poi.name || LABELS[poi.type] || poi.type;

    const el = createPinElement(cls);
    el.title = label;

    const marker = new maplibregl.Marker({ element: el, anchor: "bottom" })
      .setLngLat([poi.lng, poi.lat])
      .setPopup(
        new maplibregl.Popup({ offset: 20, closeButton: false }).setHTML(`
          <div style="font-size:13px; line-height:1.5">
            <strong>${label}</strong>
            ${poi.nearby_toilet && poi.type === "playground"
              ? '<br><span style="color:#f97316;font-size:11px">🚻 WC in der Nähe</span>'
              : ""}
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

    const data = await res.json();
    if (!Array.isArray(data)) {
      console.error("Supabase error:", data);
      return;
    }

    allPOIs = data;
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
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        lastCenter = null;
        map.flyTo({ center: [lng, lat], zoom: 14 });
      },
      () => {
        const c = map.getCenter();
        fetchPOIs({ lat: c.lat, lng: c.lng });
      }
    );
  } else {
    const c = map.getCenter();
    fetchPOIs({ lat: c.lat, lng: c.lng });
  }
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

    document.querySelectorAll(".filter-row").forEach(b => {
      b.classList.toggle("active", filters[b.dataset.filter]);
    });

    renderMarkers();
  });
});
