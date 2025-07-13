// Initialize map
const map = L.map('map').setView([39.8, -75], 9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let routeLayer;
let stepLayers = [];
let gpsMarker;
let scenicLayer;

const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZmZDdjYmQ2YzQ0YTQzZDA4MTk5NTVjMDU4ZGEzNzdmIiwiaCI6Im11cm11cjY0In0=';

L.Control.geocoder({
  defaultMarkGeocode: false,
  geocoder: L.Control.Geocoder.photon()
})
.on('markgeocode', function (e) {
  document.getElementById('start').value = e.geocode.name;
  map.setView(e.geocode.center, 13);
})
.addTo(map);

function startGPS() {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by your browser.");
    return;
  }

  navigator.geolocation.watchPosition(
    pos => {
      const { latitude, longitude } = pos.coords;
      const latlng = [latitude, longitude];

      if (!gpsMarker) {
        gpsMarker = L.circleMarker(latlng, {
          radius: 8,
          fillColor: "#007bff",
          color: "#fff",
          weight: 2,
          opacity: 1,
          fillOpacity: 0.9
        }).addTo(map);
      } else {
        gpsMarker.setLatLng(latlng);
      }
    },
    err => {
      console.error("GPS error:", err);
    },
    { enableHighAccuracy: true }
  );
}
startGPS();

map.on("moveend", loadScenicOverlays);
function loadScenicOverlays() {
  if (scenicLayer) map.removeLayer(scenicLayer);
  const bounds = map.getBounds();
  const bbox = `${bounds.getSouth()},${bounds.getWest()},${bounds.getNorth()},${bounds.getEast()}`;
  const query = `[
    out:json][timeout:25];(
      node["leisure"="park"](${bbox});
      way["leisure"="park"](${bbox});
      relation["leisure"="park"](${bbox});
      node["tourism"="viewpoint"](${bbox});
      way["leisure"="nature_reserve"](${bbox});
      way["landuse"="forest"](${bbox});
    );out body;>;out skel qt;`;

  fetch("https://overpass-api.de/api/interpreter", {
    method: "POST",
    body: query
  })
  .then(res => res.json())
  .then(data => {
    scenicLayer = L.geoJSON(osmtogeojson(data), {
      style: () => ({
        color: "green",
        weight: 1,
        opacity: 0.4,
        fillOpacity: 0.2
      }),
      pointToLayer: (feature, latlng) => L.circleMarker(latlng, {
        radius: 5,
        fillColor: "green",
        color: "darkgreen",
        weight: 1,
        opacity: 1,
        fillOpacity: 0.6
      })
    }).addTo(map);
  })
  .catch(err => console.error("Scenic overlay error:", err));
}

const traveledRoadHashes = new Set(JSON.parse(localStorage.getItem('routique-road-hashes') || '[]'));
function hashSegment(coords) {
  return coords.map(c => c.join(",")).join("|");
}

document.getElementById('routeBtn').addEventListener('click', async () => {
  const start = document.getElementById('start').value;
  const end = document.getElementById('end').value;
  const avoidHighways = document.getElementById('avoidHighways').checked;
  if (!start || !end) return alert('Enter both start and end addresses.');

  try {
    const startCoords = await geocode(start);
    const endCoords = await geocode(end);
    const body = {
      coordinates: [startCoords, endCoords],
      preference: avoidHighways ? "shortest" : "recommended",
      options: { avoid_features: avoidHighways ? ["highways"] : [] },
      instructions: true
    };

    const res = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: {
        'Authorization': ORS_API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    const data = await res.json();
    const segment = data.features[0];

    if (!segment || !segment.geometry || !segment.properties?.segments?.[0]) throw new Error("Invalid GeoJSON response");

    if (routeLayer) map.removeLayer(routeLayer);
    stepLayers.forEach(l => map.removeLayer(l));
    stepLayers = [];

    routeLayer = L.geoJSON(segment).addTo(map);
    map.fitBounds(routeLayer.getBounds());

    const coordsHash = hashSegment(segment.geometry.coordinates);
    if (!traveledRoadHashes.has(coordsHash)) {
      traveledRoadHashes.add(coordsHash);
      localStorage.setItem('routique-road-hashes', JSON.stringify([...traveledRoadHashes]));
    }

    const steps = segment.properties.segments[0].steps;
    renderDirections(steps);
    renderStepsOnMap(segment.geometry.coordinates, steps);
  } catch (err) {
    alert("Error retrieving the route.");
    console.error("Route error:", err);
  }
});

async function geocode(address) {
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURICo