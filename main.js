// Initialize the Leaflet map
const map = L.map('map').setView([39.8, -75], 9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let routeLayer;
let stepLayers = [];
let gpsMarker;

const ORS_API_KEY = 'eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6ImZmZDdjYmQ2YzQ0YTQzZDA4MTk5NTVjMDU4ZGEzNzdmIiwiaCI6Im11cm11cjY0In0=';

// Add address search via Photon
L.Control.geocoder({
  defaultMarkGeocode: false,
  geocoder: L.Control.Geocoder.photon()
})
.on('markgeocode', function (e) {
  document.getElementById('start').value = e.geocode.name;
  map.setView(e.geocode.center, 13);
})
.addTo(map);

// Start GPS tracking and show current position
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
        gpsMarker = L.marker(latlng, {
          title: "Your location",
          icon: L.icon({
            iconUrl: "https://cdn-icons-png.flaticon.com/512/684/684908.png",
            iconSize: [25, 25],
            iconAnchor: [12, 12]
          })
        }).addTo(map);
      } else {
        gpsMarker.setLatLng(latlng);
      }
    },
    err => {
      console.error("GPS error:", err);
      alert("Could not get GPS position.");
    },
    { enableHighAccuracy: true }
  );
}
startGPS();

// Previously traveled road tracking
const traveledRoadHashes = new Set(JSON.parse(localStorage.getItem('routique-road-hashes') || '[]'));

function hashSegment(coords) {
  return coords.map(c => c.join(",")).join("|");
}

// Route planning
document.getElementById('routeBtn').addEventListener('click', async () => {
  const start = document.getElementById('start').value;
  const end = document.getElementById('end').value;
  const avoidHighways = document.getElementById('avoidHighways').checked;

  if (!start || !end) {
    alert('Enter both start and end addresses.');
    return;
  }

  try {
    const startCoords = await geocode(start);
    const endCoords = await geocode(end);

    const body = {
      coordinates: [startCoords, endCoords],
      preference: avoidHighways ? "shortest" : "recommended",
      options: {
        avoid_features: avoidHighways ? ["highways"] : []
      },
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

    if (!segment || !segment.geometry || !segment.properties?.segments?.[0]) {
      throw new Error("Invalid GeoJSON response from ORS.");
    }

    // Remove old route and step overlays
    if (routeLayer) map.removeLayer(routeLayer);
    stepLayers.forEach(l => map.removeLayer(l));
    stepLayers = [];

    // Draw route
    routeLayer = L.geoJSON(segment).addTo(map);
    map.fitBounds(routeLayer.getBounds());

    // Track previously traveled roads
    const coordsHash = hashSegment(segment.geometry.coordinates);
    if (!traveledRoadHashes.has(coordsHash)) {
      traveledRoadHashes.add(coordsHash);
      localStorage.setItem('routique-road-hashes', JSON.stringify([...traveledRoadHashes]));
    }

    const steps = segment.properties.segments[0].steps;
    renderDirections(steps);
    renderStepsOnMap(segment.geometry.coordinates, steps);
  } catch (err) {
    alert("There was an error retrieving the route.");
    console.error("Fetch error:", err);
  }
});

// Convert address to [lon, lat]
async function geocode(address) {
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(address)}&limit=1`);
  const json = await res.json();

  if (!json.features.length) {
    throw new Error('No location found for: ' + address);
  }

  return json.features[0].geometry.coordinates;
}

// Show step-by-step directions (in miles)
function renderDirections(steps) {
  const dirBox = document.getElementById('directions');
  if (!steps || !steps.length) {
    dirBox.innerHTML = '<p>No turn-by-turn instructions available.</p>';
    return;
  }

  const listItems = steps.map(step => {
    const distance = (step.distance * 0.000621371).toFixed(1); // miles
    const duration = Math.round(step.duration / 60); // minutes
    return `<li><strong>${step.instruction}</strong><br><small>${distance} mi, ${duration} min</small></li>`;
  }).join('');

  dirBox.innerHTML = `
    <h2>Turn-by-Turn Directions</h2>
    <ul>${listItems}</ul>
  `;
}

// Highlight each step with an orange line
function renderStepsOnMap(routeCoords, steps) {
  steps.forEach(step => {
    const waypoints = step.way_points;
    const stepCoords = routeCoords.slice(waypoints[0], waypoints[1] + 1).map(([lon, lat]) => [lat, lon]);
    const line = L.polyline(stepCoords, {
      color: 'orange',
      weight: 3,
      opacity: 0.7
    }).addTo(map);
    stepLayers.push(line);
  });
}