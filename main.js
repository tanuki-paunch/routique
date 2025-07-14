// Initialize map
const map = L.map('map').setView([39.8, -75], 9);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);

let routeLayer;
let stepLayers = [];
let gpsMarker;
let scenicLayer;

// It's highly recommended to store API keys securely, not directly in frontend code.
// For demonstration, it's kept here, but for production, consider environment variables or a backend proxy.
const ORS_API_KEY = 'YOUR_OPENROUTESERVICE_API_KEY'; // Replace with a valid API key

L.Control.geocoder({
  defaultMarkGeocode: false,
  geocoder: L.Control.Geocoder.photon({
    url: 'https://photon.komoot.io/reverse/', // Specify Photon reverse geocoding URL
    autocomplete: true
  })
})
.on('markgeocode', function (e) {
  document.getElementById('start').value = e.geocode.name;
  map.setView(e.geocode.center, 13);
})
.addTo(map);

// Function to start GPS tracking and display current location
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
        // Create a custom pulsing marker for GPS
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
      // Optionally center map on GPS marker if desired
      // map.panTo(latlng);
    },
    err => {
      console.error("GPS error:", err);
      alert("Could not retrieve your current location. Please ensure location services are enabled.");
    },
    { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
  );
}
startGPS(); // Start GPS on page load

// Event listener for using current GPS location as start point
document.getElementById('gpsStart').addEventListener('click', () => {
  if (gpsMarker) {
    const latlng = gpsMarker.getLatLng();
    // Reverse geocode the current GPS coordinates to get a human-readable address
    fetch(`https://photon.komoot.io/reverse/?lat=${latlng.lat}&lon=${latlng.lng}`)
      .then(res => res.json())
      .then(data => {
        if (data.features.length > 0) {
          document.getElementById('start').value = data.features[0].properties.name || data.features[0].properties.formatted;
        } else {
          document.getElementById('start').value = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
        }
      })
      .catch(err => {
        console.error("Reverse geocoding error:", err);
        document.getElementById('start').value = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
      });
  } else {
    alert("GPS signal not found. Please wait or enable location services.");
  }
});


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
      style: (feature) => {
        if (feature.properties.leisure === 'park' || feature.properties.leisure === 'nature_reserve') {
          return { color: "green", weight: 1, opacity: 0.4, fillOpacity: 0.2 };
        } else if (feature.properties.landuse === 'forest') {
          return { color: "darkgreen", weight: 1, opacity: 0.4, fillOpacity: 0.2 };
        }
        return { color: "blue", weight: 1, opacity: 0.4, fillOpacity: 0.2 }; // Default for viewpoints or others
      },
      pointToLayer: (feature, latlng) => {
        let fillColor = "green";
        let color = "darkgreen";
        if (feature.properties.tourism === 'viewpoint') {
          fillColor = "blue";
          color = "darkblue";
        } else if (feature.properties.landuse === 'forest') {
            fillColor = "darkgreen";
            color = "#004d00";
        }
        return L.circleMarker(latlng, {
          radius: 5,
          fillColor: fillColor,
          color: color,
          weight: 1,
          opacity: 1,
          fillOpacity: 0.6
        });
      }
    }).addTo(map);
  })
  .catch(err => console.error("Scenic overlay error:", err));
}

const traveledRoadHashes = new Set(JSON.parse(localStorage.getItem('routique-road-hashes') || '[]'));
function hashSegment(coords) {
  // Create a more robust hash by considering a few key points, not just string concatenation of all.
  // This is a simplification; a truly robust solution might involve geometry simplification or external hashing library.
  if (coords.length < 2) return "";
  const first = coords[0].join(",");
  const last = coords[coords.length - 1].join(",");
  const middle = coords[Math.floor(coords.length / 2)].join(",");
  return `${first}|${middle}|${last}`;
}


document.getElementById('routeBtn').addEventListener('click', async () => {
  const start = document.getElementById('start').value;
  const end = document.getElementById('end').value;
  const avoidHighways = document.getElementById('avoidHighways').checked;
  if (!start || !end) {
    alert('Please enter both start and end addresses.');
    return;
  }

  // Clear previous route and directions
  if (routeLayer) map.removeLayer(routeLayer);
  stepLayers.forEach(l => map.removeLayer(l));
  stepLayers = [];
  document.getElementById('directions').innerHTML = ''; // Clear directions list

  // Simple loading indicator
  document.getElementById('routeBtn').textContent = 'Planning...';
  document.getElementById('routeBtn').disabled = true;


  try {
    const startCoords = await geocode(start);
    const endCoords = await geocode(end);

    if (!startCoords || !endCoords) {
      alert("Could not find coordinates for one or both addresses. Please try again with more specific addresses.");
      return;
    }

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

    if (!res.ok) {
        const errorData = await res.json();
        throw new Error(`OpenRouteService error: ${errorData.error?.message || res.statusText}`);
    }

    const data = await res.json();
    const segment = data.features[0];

    if (!segment || !segment.geometry || !segment.properties?.segments?.[0]) {
        throw new Error("Invalid route response from OpenRouteService. No route found or malformed data.");
    }


    routeLayer = L.geoJSON(segment, {
        style: {
            color: '#007bff', // Modern route color
            weight: 5,
            opacity: 0.7
        }
    }).addTo(map);
    map.fitBounds(routeLayer.getBounds(), { padding: [50, 50] }); // Add padding

    const coordsHash = hashSegment(segment.geometry.coordinates);
    if (!traveledRoadHashes.has(coordsHash)) {
      traveledRoadHashes.add(coordsHash);
      localStorage.setItem('routique-road-hashes', JSON.stringify([...traveledRoadHashes]));
    }

    const steps = segment.properties.segments[0].steps;
    renderDirections(steps);
    renderStepsOnMap(segment.geometry.coordinates, steps);
  } catch (err) {
    alert("Error retrieving the route: " + err.message);
    console.error("Route error:", err);
  } finally {
    document.getElementById('routeBtn').textContent = 'Plan Route';
    document.getElementById('routeBtn').disabled = false;
  }
});

async function geocode(address) {
  const res = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(address)}`);
  const data = await res.json();
  if (data.features.length > 0) {
    return data.features[0].geometry.coordinates; // [longitude, latitude]
  }
  return null;
}

function renderDirections(steps) {
  const directionsDiv = document.getElementById('directions');
  directionsDiv.innerHTML = '<h3>Directions</h3><ul></ul>';
  const ul = directionsDiv.querySelector('ul');
  steps.forEach(step => {
    const li = document.createElement('li');
    li.textContent = step.instruction;
    ul.appendChild(li);
  });
}

function renderStepsOnMap(routeCoordinates, steps) {
    steps.forEach(step => {
        // Find the coordinates for this step. The 'way_points' array in each step
        // gives the start and end index in the overall routeCoordinates array.
        const startIdx = step.way_points[0];
        const endIdx = step.way_points[1];

        // Extract the segment of the route coordinates that corresponds to this step
        const stepCoords = routeCoordinates.slice(startIdx, endIdx + 1);

        // Convert OpenRouteService [lon, lat] to Leaflet [lat, lon]
        const latLngs = stepCoords.map(coord => [coord[1], coord[0]]);

        // Create a polyline for each step
        const stepPolyline = L.polyline(latLngs, {
            color: 'purple', // A distinct color for individual step highlights
            weight: 7,
            opacity: 0
        }).addTo(map);

        // Add event listeners to show/hide the step highlight on hover
        stepPolyline.on('mouseover', function() {
            this.setStyle({opacity: 0.5}); // Make it visible on hover
        });
        stepPolyline.on('mouseout', function() {
            this.setStyle({opacity: 0}); // Hide it on mouse out
        });

        stepLayers.push(stepPolyline);
    });
}