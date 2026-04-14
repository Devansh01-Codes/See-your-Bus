
import { initializeApp }                         from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }  from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase, ref, onValue, set, get }  from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey: "AIzaSyCVTQr4SePTDMHe2H7VYKvDmvD0e71JpPg",
  authDomain: "bus-tracker-app-001.firebaseapp.com",
  databaseURL: "https://bus-tracker-app-001-default-rtdb.firebaseio.com",
  projectId: "bus-tracker-app-001",
  storageBucket: "bus-tracker-app-001.firebasestorage.app",
  messagingSenderId: "183488595656",
  appId: "1:183488595656:web:5e0f1cf3ca1601e08bc7fd"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

// ── State ──────────────────────────────────────────────────────────────
let studentLat    = null;
let studentLng    = null;
let studentUID    = null;
let studentName   = '';
let chosenBusUID  = null;   // driver UID of chosen bus
let map           = null;
let busMarker     = null;
let studentMarker = null;
let myStopMarker  = null;
let routeLayer    = null;
let busListener   = null;
let firstFix      = true;

// ── Auth guard ─────────────────────────────────────────────────────────
onAuthStateChanged(auth, user => {
  // if (!user) { window.location.href = "index.html"; return; }
  studentUID  = user.uid;
  studentName = (user.displayName || user.email.split('@')[0].replace(/[._-]/g,' '))
                .trim().replace(/\b\w/g, c => c.toUpperCase());
  const initials = studentName.split(' ').filter(Boolean).map(w=>w[0]).join('').slice(0,2).toUpperCase();
  document.getElementById('sAvatar').textContent = initials;
  document.getElementById('sName').textContent   = studentName;
});

document.getElementById('logoutBtn').addEventListener('click', async () => {
  await signOut(auth); window.location.href = "index.html";
});

// ── Toast ──────────────────────────────────────────────────────────────
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.style.opacity='1';
  t.style.transform='translateX(-50%) translateY(0)';
  setTimeout(()=>{ t.style.opacity='0'; t.style.transform='translateX(-50%) translateY(20px)'; },3000);
}

// ── Step 1: Location permission screen ────────────────────────────────
document.getElementById('allowLocationBtn').addEventListener('click', requestLocation);
document.getElementById('skipLocation').addEventListener('click', () => {
  hideScreen('locationScreen');
  showScreen('busSelectScreen');
  loadBuses();
});

function requestLocation() {
  if (!navigator.geolocation) {
    showToast('Geolocation not supported.');
    hideScreen('locationScreen');
    showScreen('busSelectScreen');
    loadBuses();
    return;
  }
  navigator.geolocation.getCurrentPosition(pos => {
    studentLat = pos.coords.latitude;
    studentLng = pos.coords.longitude;
    hideScreen('locationScreen');
    showScreen('busSelectScreen');
    loadBuses();
  }, () => {
    showToast('Could not get location. Showing all buses.');
    hideScreen('locationScreen');
    showScreen('busSelectScreen');
    loadBuses();
  }, { enableHighAccuracy: true });
}

// ── Step 2: Load active buses ──────────────────────────────────────────
async function loadBuses() {
  document.getElementById('busList').innerHTML = `
    <div class="no-buses"><i class="fa-solid fa-spinner fa-spin"></i><br>Looking for buses…</div>`;

  const snap = await get(ref(db, 'active_buses'));
  const data = snap.val() || {};
  const buses = Object.entries(data)
    .filter(([, b]) => b && b.isLive && b.latitude)
    .map(([uid, b]) => {
      const dist = studentLat
        ? haversine(studentLat, studentLng, b.latitude, b.longitude)
        : null;
      return { uid, ...b, dist };
    })
    .sort((a, b) => (a.dist ?? 9999) - (b.dist ?? 9999));

  const list = document.getElementById('busList');
  if (!buses.length) {
    list.innerHTML = `<div class="no-buses"><i class="fa-solid fa-bus-simple"></i>No active buses right now.<br>Ask your driver to go live.</div>`;
    return;
  }
  list.innerHTML = '';

  if (studentLat) {
    document.getElementById('busSelectSub').textContent =
      `${buses.length} bus${buses.length>1?'es':''} near your location`;
  }

  buses.forEach(bus => {
    const distText = bus.dist != null ? `${(bus.dist/1000).toFixed(1)} km away` : '';
    const modeHtml = bus.tripMode
      ? `<span class="bus-mode-badge ${bus.tripMode}">${bus.tripMode==='picking'?'🟢 Picking':'🔴 Dropping'}</span>`
      : '';
    const card = document.createElement('div');
    card.className = 'bus-card';
    card.innerHTML = `
      <div class="bus-card-top">
        <div class="bus-card-icon"><i class="fa-solid fa-bus"></i></div>
        <div>
          <div class="bus-card-title">${bus.driverName || 'Bus'}</div>
          <div class="bus-card-sub">UP-80 AB 1234</div>
        </div>
        ${distText ? `<span class="bus-dist-badge"><i class="fa-solid fa-location-arrow"></i>${distText}</span>` : ''}
      </div>
      <div class="bus-card-rows">
        <div class="bus-card-row">
          <span class="k"><i class="fa-solid fa-tag"></i>Trip</span>
          <span class="v">${modeHtml || '—'}</span>
        </div>
        <div class="bus-card-row">
          <span class="k"><i class="fa-solid fa-location-dot"></i>Going to</span>
          <span class="v">${bus.lastStop ? bus.lastStop.name.split(',')[0] : '—'}</span>
        </div>
      </div>`;
    card.addEventListener('click', () => selectBus(bus));
    list.appendChild(card);
  });
}

document.getElementById('refreshBuses').addEventListener('click', loadBuses);

// ── Step 3: Student selects a bus ─────────────────────────────────────
async function selectBus(bus) {
  chosenBusUID = bus.uid;
  hideScreen('busSelectScreen');

  // Show main UI
  document.getElementById('mainUI').style.display = 'flex';
  initMap();

  // Find nearest point on driver route to student location
  let stopCoords = { lat: studentLat, lng: studentLng, name: 'Your location' };
  let stopDistText = '';

  if (studentLat && bus.lastStop) {
    // Use OSRM nearest to snap student to road on route
    const nearest = await snapToRoute(studentLat, studentLng, bus.latitude, bus.longitude, bus.lastStop.lat, bus.lastStop.lng);
    if (nearest) {
      stopCoords = nearest;
      const d = haversine(studentLat, studentLng, nearest.lat, nearest.lng);
      stopDistText = `${(d/1000).toFixed(2)} km from your location`;
    }
  }

  // Show my stop card
  document.getElementById('myStopCard').style.display  = 'block';
  document.getElementById('myStopName').textContent    = stopCoords.name;
  document.getElementById('myStopDist').textContent    = stopDistText;

  // Write student stop to DB under driver's node
  if (studentUID) {
    await set(ref(db, `bus_students/${chosenBusUID}/${studentUID}`), {
      lat:      stopCoords.lat,
      lng:      stopCoords.lng,
      name:     stopCoords.name,
      distText: stopDistText,
      studentName
    });
  }

  // Place student's stop marker on map
  if (map && stopCoords.lat) {
    myStopMarker = L.marker([stopCoords.lat, stopCoords.lng], { icon: getMyStopIcon() })
      .addTo(map)
      .bindPopup(`<b>Your Pickup Stop</b><br>${stopCoords.name}`);
  }

  // Start listening to the chosen bus
  listenToBus(chosenBusUID);
}

// ── Snap student to nearest point on route (OSRM) ─────────────────────
async function snapToRoute(sLat, sLng, dLat, dLng, eLat, eLng) {
  // Get the full route geometry, find closest point to student
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${dLng},${dLat};${eLng},${eLat}?overview=full&geometries=geojson`;
    const r = await fetch(url);
    const d = await r.json();
    if (d.code !== 'Ok') return null;

    const coords = d.routes[0].geometry.coordinates; // [lng,lat] pairs
    let minDist = Infinity, closest = null;
    coords.forEach(([lng, lat]) => {
      const dist = haversine(sLat, sLng, lat, lng);
      if (dist < minDist) { minDist = dist; closest = { lat, lng }; }
    });

    if (!closest) return null;

    // Reverse geocode the nearest point
    const rev = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${closest.lat}&lon=${closest.lng}`);
    const revData = await rev.json();
    closest.name = revData.display_name
      ? revData.display_name.split(',').slice(0,2).join(',')
      : `Stop near route`;

    return closest;
  } catch(e) {
    console.error('Snap to route failed:', e);
    return null;
  }
}

// ── Listen to chosen bus ───────────────────────────────────────────────
function listenToBus(driverUID) {
  if (busListener) busListener(); // unsubscribe previous
  busListener = null;

  const busRef = ref(db, `active_buses/${driverUID}`);
  onValue(busRef, snapshot => {
    const data = snapshot.val();
    const pill     = document.getElementById('sPill');
    const dot      = document.getElementById('pulseDot');
    const badgeText= document.getElementById('mapBadgeText');
    const liveCard = document.getElementById('liveInfoCard');

    if (data && data.isLive && data.latitude) {
      pill.textContent = 'Live'; pill.classList.add('live');
      dot.classList.add('live');
      badgeText.textContent = `${data.driverName || 'Bus'} is Live`;
      liveCard.style.display = 'block';

      const spd = data.speed != null ? (data.speed*3.6).toFixed(1)+' km/h' : '— km/h';
      document.getElementById('busSpeed').textContent    = spd;
      document.getElementById('busDriver').textContent   = data.driverName || '—';
      document.getElementById('busTripMode').textContent = data.tripMode
        ? (data.tripMode==='picking' ? '🟢 Picking' : '🔴 Dropping') : '—';
      document.getElementById('busLastStop').textContent = data.lastStop
        ? data.lastStop.name.split(',')[0] : '—';
      if (data.timestamp) {
        document.getElementById('busUpdated').textContent =
          new Date(data.timestamp).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit',second:'2-digit'});
      }

      const pos = [data.latitude, data.longitude];
      if (!busMarker) {
        busMarker = L.marker(pos, { icon: getBusIcon() }).addTo(map)
          .bindPopup(`<b>${data.driverName || 'Bus'}</b><br>UP-80 AB 1234`).openPopup();
      } else {
        busMarker.setLatLng(pos);
      }

      // Draw route from bus to last stop
      if (data.lastStop && map) {
        drawRouteOnMap(data.latitude, data.longitude, data.lastStop.lat, data.lastStop.lng);
      }

      if (firstFix) { map.setView(pos, 15); firstFix = false; }

    } else {
      pill.textContent = 'Offline'; pill.classList.remove('live');
      dot.classList.remove('live');
      badgeText.textContent = 'Bus is offline';
      liveCard.style.display = 'none';
      if (busMarker) { map.removeLayer(busMarker); busMarker = null; firstFix = true; }
      if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    }
  });
}

// ── Draw route on student map ──────────────────────────────────────────
async function drawRouteOnMap(fromLat, fromLng, toLat, toLng) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
    const r = await fetch(url);
    const d = await r.json();
    if (d.code !== 'Ok') return;
    if (routeLayer) map.removeLayer(routeLayer);
    routeLayer = L.geoJSON(d.routes[0].geometry, {
      style: { color: '#4361ee', weight: 5, opacity: .8, lineCap: 'round', lineJoin: 'round' }
    }).addTo(map);
  } catch(e) { console.error(e); }
}

// ── Init Leaflet map ───────────────────────────────────────────────────
function initMap() {
  if (map) return;
  map = L.map('map').setView([20.5937, 78.9629], 5);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
  }).addTo(map);
}

// ── Locate Me ──────────────────────────────────────────────────────────
document.getElementById('locateMe').addEventListener('click', () => {
  if (!navigator.geolocation) return;
  navigator.geolocation.getCurrentPosition(pos => {
    const { latitude, longitude } = pos.coords;
    if (!studentMarker) {
      studentMarker = L.marker([latitude, longitude], { icon: getStudentIcon() })
        .addTo(map).bindPopup('You are here');
    } else { studentMarker.setLatLng([latitude, longitude]); }
    map.setView([latitude, longitude], 15);
  });
});

// ── Change bus ─────────────────────────────────────────────────────────
function changeBus() {
  // Remove student from current bus
  if (chosenBusUID && studentUID) {
    set(ref(db, `bus_students/${chosenBusUID}/${studentUID}`), null).catch(console.error);
  }
  chosenBusUID = null; firstFix = true;
  if (busMarker)    { map.removeLayer(busMarker); busMarker = null; }
  if (routeLayer)   { map.removeLayer(routeLayer); routeLayer = null; }
  if (myStopMarker) { map.removeLayer(myStopMarker); myStopMarker = null; }
  document.getElementById('mainUI').style.display = 'none';
  document.getElementById('liveInfoCard').style.display = 'none';
  document.getElementById('myStopCard').style.display   = 'none';
  showScreen('busSelectScreen');
  loadBuses();
}
document.getElementById('changeBusBtn').addEventListener('click', changeBus);
document.getElementById('changeBusNavBtn').addEventListener('click', changeBus);

// ── Haversine distance (meters) ────────────────────────────────────────
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, toRad = d => d*Math.PI/180;
  const dLat = toRad(lat2-lat1), dLng = toRad(lng2-lng1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Icons ──────────────────────────────────────────────────────────────
function getBusIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="background:#1a73e8;border-radius:50% 50% 50% 0;transform:rotate(-45deg);width:40px;height:40px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3);border:2px solid #fff;"><i class="fa-solid fa-bus" style="color:#fff;font-size:16px;transform:rotate(45deg);"></i></div>`,
    iconSize:[40,40], iconAnchor:[20,40]
  });
}
function getStudentIcon() {
  return L.divIcon({
    className:'',
    html:`<div style="background:#e74c3c;border-radius:50%;width:14px;height:14px;border:2px solid #fff;box-shadow:0 0 0 4px rgba(231,76,60,.2);"></div>`,
    iconSize:[14,14], iconAnchor:[7,7]
  });
}
function getMyStopIcon() {
  return L.divIcon({
    className:'',
    html:`<div style="background:#4361ee;border-radius:50%;width:16px;height:16px;border:3px solid #fff;box-shadow:0 0 0 4px rgba(67,97,238,.25);"></div>`,
    iconSize:[16,16], iconAnchor:[8,8]
  });
}

// ── Screen helpers ─────────────────────────────────────────────────────
function hideScreen(id) { document.getElementById(id).classList.add('hidden'); }
function showScreen(id) { document.getElementById(id).classList.remove('hidden'); }