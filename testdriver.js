import { initializeApp }                        from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase, ref, set, get, onValue, off } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

const firebaseConfig = {
  apiKey:"AIzaSyCVTQr4SePTDMHe2H7VYKvDmvD0e71JpPg",
  authDomain:"bus-tracker-app-001.firebaseapp.com",
  databaseURL:"https://bus-tracker-app-001-default-rtdb.firebaseio.com",
  projectId:"bus-tracker-app-001",
  storageBucket:"bus-tracker-app-001.firebasestorage.app",
  messagingSenderId:"183488595656",
  appId:"1:183488595656:web:5e0f1cf3ca1601e08bc7fd"
};
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

/* ── State ── */
let watchId = null, mainMap = null, busMarker = null, routeLayer = null;
let isLive = false, tripMode = null, driverName = '', driverUID = null;
let currentLat = null, currentLng = null;
let lastStop = null;
let studentStops = {}, knownUIDs = new Set(), stopsListener = null, lastUpdate = 0;

/* ── Driver profile (loaded from Firebase) ── */
let driverProfile  = null;   // full drivers/${uid} record
let assignedBusId  = null;   // e.g. "BUS001"
let assignedBusNum = null;   // e.g. "UP80 AB 1234"
let assignedRoute  = null;   // full route record { routeName, stops:[] }

/* Pick-map */
let pickMap = null, pickMapInited = false, reverseTimer = null, mapPending = null;

/* ════════════════════════════════════════════
   AUTH — load driver profile after login
════════════════════════════════════════════ */
onAuthStateChanged(auth, async user => {
  if (!user) { window.location.href = 'login.html'; return; }

  driverUID  = user.uid;
  driverName = (user.displayName || user.email.split('@')[0])
    .replace(/[._-]/g, ' ').trim()
    .replace(/\b\w/g, c => c.toUpperCase());

  const ini = driverName.split(' ').filter(Boolean)
    .map(w => w[0]).join('').slice(0, 2).toUpperCase();

  ['sidebarAvatar','profileAvatar'].forEach(id => {
    document.getElementById(id).textContent = ini;
  });
  ['sidebarName','profileName'].forEach(id => {
    document.getElementById(id).textContent = driverName;
  });

  /* ── Load driver record from Firebase ── */
  await loadDriverProfile();
});

async function loadDriverProfile() {
  try {
    const snap = await get(ref(db, `drivers/${driverUID}`));
    driverProfile = snap.val();

    /* Driver not registered / not verified by admin */
    if (!driverProfile) {
      toast('Your account is not registered. Contact admin.', true);
      return;
    }
    if (!driverProfile.isVerified) {
      toast('Your account is pending admin approval.', true);
      document.getElementById('liveBtn').disabled = true;
      document.getElementById('liveBtn').textContent = '⏳ Awaiting Admin Approval';
      return;
    }

    assignedBusId = driverProfile.assignedBusId || null;

    /* Load bus number */
    if (assignedBusId) {
      const busSnap = await get(ref(db, `buses/${assignedBusId}`));
      const busData = busSnap.val();
      assignedBusNum = busData?.busNumber || assignedBusId;

      /* Show bus number in both sidebar cards */
      document.querySelectorAll('.driver-bus').forEach(el => {
        el.innerHTML = `<i class="fa-solid fa-bus" style="color:var(--primary);margin-right:4px;"></i>${assignedBusNum}`;
      });

      /* Load assigned route */
      const routeId = busData?.routeId;
      if (routeId) {
        const routeSnap = await get(ref(db, `routes/${routeId}`));
        assignedRoute = routeSnap.val();
        renderRoutePanel();
      }
    } else {
      /* No bus assigned yet */
      document.querySelectorAll('.driver-bus').forEach(el => {
        el.innerHTML = `<i class="fa-solid fa-bus" style="color:var(--primary);margin-right:4px;"></i>No bus assigned`;
      });
      toast('No bus assigned to you yet. Contact admin.', true);
      document.getElementById('liveBtn').disabled = true;
    }

  } catch (e) {
    toast('Failed to load profile: ' + e.message, true);
  }
}

/* Populate the "Your Route" info panel in defaultView */
function renderRoutePanel() {
  if (!assignedRoute) return;
  const stops = assignedRoute.stops || [];
  const rows = document.querySelectorAll('#defaultView .info-row .info-val');
  if (rows.length >= 4) {
    rows[0].textContent = stops[0]            || '—';
    rows[1].textContent = stops[stops.length - 1] || '—';
    rows[2].textContent = stops.length + ' stops';
    rows[3].textContent = '— km'; // distance calculated live if needed
  }
}

/* ════════════════════════════════════════════
   LOGOUT
════════════════════════════════════════════ */
async function handleLogout() {
  if (isLive) await stopTracking();
  await signOut(auth).catch(() => {});
  window.location.href = 'login.html';
}
document.getElementById('logoutBtn').addEventListener('click', handleLogout);
const mobileLogoutBtn = document.getElementById('logoutBtnMobile');
if (mobileLogoutBtn) mobileLogoutBtn.addEventListener('click', handleLogout);

/* ════════════════════════════════════════════
   TOAST
════════════════════════════════════════════ */
function toast(msg, err = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('err');
  if (err) el.classList.add('err');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

/* ════════════════════════════════════════════
   STEP 1: Go Live → trip type
════════════════════════════════════════════ */
document.getElementById('liveBtn').addEventListener('click', () => {
  if (!assignedBusId) {
    toast('No bus assigned. Contact admin.', true);
    return;
  }
  document.getElementById('tripModeOverlay').classList.add('visible');
});
document.getElementById('pickingBtn').addEventListener('click', () => openSearch('picking'));
document.getElementById('droppingBtn').addEventListener('click', () => openSearch('dropping'));

function openSearch(mode) {
  tripMode = mode;
  document.getElementById('tripModeOverlay').classList.remove('visible');
  document.getElementById('lastStopOverlay').classList.add('visible');
  setTimeout(() => document.getElementById('lastStopInput').focus(), 120);
  if (!currentLat) navigator.geolocation.getCurrentPosition(
    p => { currentLat = p.coords.latitude; currentLng = p.coords.longitude; }, () => {}
  );
}

/* ════════════════════════════════════════════
   STEP 2: Search modal helpers
════════════════════════════════════════════ */
function buildNames(item) {
  const a = item.address || {};
  const title = item.name || a.amenity || a.shop || a.leisure || a.tourism || a.road || a.pedestrian || a.neighbourhood || a.suburb || '';
  const road  = a.road || a.pedestrian || a.path || '';
  const nbhd  = a.neighbourhood || a.suburb || a.quarter || a.hamlet || '';
  const city  = a.village || a.town || a.city_district || a.city || '';
  const dist  = a.state_district || a.county || '';
  const state = a.state || '';
  const short = [title, nbhd || city].filter(Boolean).join(', ') || item.display_name.split(',').slice(0, 2).join(', ');
  const full  = [title !== road ? road : '', nbhd, city, dist, state].filter(Boolean).join(', ') || item.display_name.split(',').slice(0, 4).join(', ');
  return { short, full };
}

function typeIcon(item) {
  const c = item.class || '', t = item.type || '';
  const map = { school:'fa-school', hospital:'fa-hospital', fuel:'fa-gas-pump', bank:'fa-building-columns', restaurant:'fa-utensils', place_of_worship:'fa-place-of-worship', bus_station:'fa-bus', bus_stop:'fa-bus', railway:'fa-train', park:'fa-tree', marketplace:'fa-store' };
  if (c === 'highway') return 'fa-road';
  if (c === 'place')   return 'fa-map-pin';
  if (c === 'shop')    return 'fa-store';
  if (c === 'leisure') return 'fa-tree';
  if (c === 'landuse') return 'fa-city';
  return map[t] || 'fa-location-dot';
}

function setStop(lat, lng, short, full) {
  lastStop = { lat, lng, name: short, addr: full };
  document.getElementById('chipName').textContent = short;
  document.getElementById('chipAddr').textContent = full;
  document.getElementById('selChip').classList.add('visible');
  document.getElementById('confirmStopBtn').disabled = false;
  document.getElementById('stopSuggestions').style.display = 'none';
  document.getElementById('lastStopInput').value = short;
  document.getElementById('inputX').style.display = 'block';
}

function clearStop() {
  lastStop = null;
  document.getElementById('selChip').classList.remove('visible');
  document.getElementById('confirmStopBtn').disabled = true;
}

function clearAll() {
  document.getElementById('lastStopInput').value = '';
  document.getElementById('inputX').style.display = 'none';
  document.getElementById('stopSuggestions').style.display = 'none';
  clearStop();
}

document.getElementById('inputX').addEventListener('click', clearAll);
document.getElementById('chipX').addEventListener('click', clearAll);

let sTimer = null;
document.getElementById('lastStopInput').addEventListener('input', e => {
  const q = e.target.value.trim();
  document.getElementById('inputX').style.display = q ? 'block' : 'none';
  clearStop();
  clearTimeout(sTimer);
  if (q.length < 2) { document.getElementById('stopSuggestions').style.display = 'none'; return; }
  sTimer = setTimeout(() => fetchSugg(q), 380);
});

async function fetchSugg(q) {
  const ul = document.getElementById('stopSuggestions');
  ul.innerHTML = `<li><div class="si"><div class="si-dot"><i class="fa-solid fa-spinner fa-spin"></i></div><span style="font-size:.84rem;color:#aaa;">Searching nearby…</span></div></li>`;
  ul.style.display = 'block';
  try {
    const base = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=in&addressdetails=1&namedetails=1&limit=10&zoom=18`;
    let data = [];
    if (currentLat && currentLng) {
      const d1 = 0.27, vb1 = `${currentLng-d1},${currentLat+d1},${currentLng+d1},${currentLat-d1}`;
      const r1 = await fetch(`${base}&viewbox=${vb1}&bounded=1`, { headers:{'Accept-Language':'en','User-Agent':'BusTrackApp/1.0'} });
      data = await r1.json();
      if (data.length < 4) {
        const d2 = 1.5, vb2 = `${currentLng-d2},${currentLat+d2},${currentLng+d2},${currentLat-d2}`;
        const r2 = await fetch(`${base}&viewbox=${vb2}&bounded=0`, { headers:{'Accept-Language':'en','User-Agent':'BusTrackApp/1.0'} });
        const ex = await r2.json();
        const seen = new Set(data.map(x => x.place_id));
        ex.forEach(x => { if (!seen.has(x.place_id)) data.push(x); });
      }
    } else {
      const r = await fetch(base, { headers:{'Accept-Language':'en','User-Agent':'BusTrackApp/1.0'} });
      data = await r.json();
    }
    ul.innerHTML = '';
    if (!data.length) {
      ul.innerHTML = `<li><div class="si"><div class="si-dot"><i class="fa-solid fa-magnifying-glass"></i></div><span style="font-size:.84rem;color:#aaa;">No results — try Pick on Map</span></div></li>`;
      return;
    }
    data.slice(0, 9).forEach(item => {
      const { short, full } = buildNames(item);
      const icon = typeIcon(item);
      const li = document.createElement('li');
      li.innerHTML = `<div class="si"><div class="si-dot"><i class="fa-solid ${icon}"></i></div><div><div class="si-main">${short}</div><div class="si-meta">${full}</div></div></div>`;
      li.addEventListener('click', () => setStop(parseFloat(item.lat), parseFloat(item.lon), short, full));
      ul.appendChild(li);
    });
  } catch {
    ul.innerHTML = `<li><div class="si"><div class="si-dot"><i class="fa-solid fa-triangle-exclamation"></i></div><span style="font-size:.84rem;color:var(--danger);">Search failed. Check internet.</span></div></li>`;
  }
}

/* ════════════════════════════════════════════
   STEP 3: Pick on Map
════════════════════════════════════════════ */
document.getElementById('pickOnMapBtn').addEventListener('click', () => {
  document.getElementById('lastStopOverlay').classList.remove('visible');
  document.getElementById('mapPickScreen').classList.add('visible');
  initPickMap();
});

function initPickMap() {
  if (!pickMapInited) {
    pickMapInited = true;
    const lat = currentLat || 28.4595, lng = currentLng || 77.0266;
    pickMap = L.map('pickMap', { zoomControl: true }).setView([lat, lng], 16);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19
    }).addTo(pickMap);
    pickMap.on('moveend', reverseCenter);
    pickMap.on('zoomend', reverseCenter);
    reverseCenter();
  } else {
    if (currentLat) pickMap.setView([currentLat, currentLng], 16);
    pickMap.invalidateSize();
    reverseCenter();
  }
}

async function reverseCenter() {
  const c  = pickMap.getCenter();
  const el = document.getElementById('pickLocName');
  el.textContent = 'Fetching location name…'; el.classList.add('loading');
  clearTimeout(reverseTimer);
  reverseTimer = setTimeout(async () => {
    try {
      const r = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${c.lat}&lon=${c.lng}&zoom=18&addressdetails=1`,
        { headers: {'Accept-Language':'en','User-Agent':'BusTrackApp/1.0'} }
      );
      const d = await r.json();
      if (d && d.display_name) {
        const a = d.address || {};
        const parts = [
          d.name || a.amenity || a.shop || a.road || '',
          a.neighbourhood || a.suburb || a.quarter || '',
          a.village || a.town || a.city_district || a.city || '',
          a.state_district || a.county || '',
          a.state || ''
        ].filter(Boolean);
        const name = parts.join(', ') || d.display_name.split(',').slice(0, 4).join(', ');
        el.textContent = name; el.classList.remove('loading');
        mapPending = { lat: c.lat, lng: c.lng, name };
      }
    } catch {
      const name = `${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}`;
      el.textContent = name; el.classList.remove('loading');
      mapPending = { lat: c.lat, lng: c.lng, name };
    }
  }, 500);
}

document.getElementById('setStopBtn').addEventListener('click', () => {
  if (!mapPending) return;
  setStop(mapPending.lat, mapPending.lng, mapPending.name, mapPending.name);
  document.getElementById('mapPickScreen').classList.remove('visible');
  document.getElementById('lastStopOverlay').classList.add('visible');
});

document.getElementById('mapPickBack').addEventListener('click', () => {
  document.getElementById('mapPickScreen').classList.remove('visible');
  document.getElementById('lastStopOverlay').classList.add('visible');
});

/* ════════════════════════════════════════════
   Confirm & begin trip
════════════════════════════════════════════ */
document.getElementById('confirmStopBtn').addEventListener('click', async () => {
  if (!lastStop) {
    const q = document.getElementById('lastStopInput').value.trim();
    if (!q) { toast('Please search or pick a destination.', true); return; }
    toast('Finding location…');
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(q)}&countrycodes=in&addressdetails=1&limit=1`, { headers: {'Accept-Language':'en'} });
      const d = await r.json();
      if (!d.length) { toast('Location not found. Try Pick on Map.', true); return; }
      const { short, full } = buildNames(d[0]);
      setStop(parseFloat(d[0].lat), parseFloat(d[0].lon), short, full);
    } catch { toast('Search failed. Use Pick on Map.', true); return; }
  }
  document.getElementById('lastStopOverlay').classList.remove('visible');
  document.getElementById('tripTo').textContent = lastStop.name;
  document.getElementById('tripStartTime').textContent = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });
  const badge = document.getElementById('tripModeBadge');
  badge.textContent = tripMode === 'picking' ? '🟢 Picking' : '🔴 Dropping';
  badge.className   = `mode-badge ${tripMode}`;
  startTracking();
});

/* ════════════════════════════════════════════
   GPS TRACKING
   KEY FIX: writes to active_buses/${assignedBusId}
   so admin's bus list shows the correct bus as Live
════════════════════════════════════════════ */
async function startTracking() {
  if (!navigator.geolocation) { toast('Geolocation not supported.', true); return; }
  if (!assignedBusId) { toast('No bus assigned — cannot go live.', true); return; }

  setLiveUI();

  watchId = navigator.geolocation.watchPosition(async pos => {
    const { latitude, longitude, heading, speed, accuracy } = pos.coords;
    currentLat = latitude; currentLng = longitude;
    const now  = Date.now();

    if (!mainMap) {
      mainMap    = L.map('mainMap').setView([latitude, longitude], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mainMap);
      busMarker  = L.marker([latitude, longitude], { icon: busIcon() }).addTo(mainMap);
      if (lastStop) await drawRoute(latitude, longitude, lastStop.lat, lastStop.lng, Object.values(studentStops));
    } else {
      busMarker.setLatLng([latitude, longitude]);
    }

    document.getElementById('stat-speed').textContent    = speed    != null ? (speed * 3.6).toFixed(1) + ' km/h' : '— km/h';
    document.getElementById('stat-accuracy').textContent = accuracy != null ? accuracy.toFixed(0) + ' m'         : '— m';

    /* Throttle Firebase writes to every 3 s */
    if (now - lastUpdate > 3000) {
      lastUpdate = now;
      try {
        /* ── Write under Bus ID (not driver UID) so admin panel matches ── */
        await set(ref(db, `active_buses/${assignedBusId}`), {
          latitude,
          longitude,
          heading:    heading  ?? null,
          speed:      speed    ?? null,
          accuracy:   accuracy ?? null,
          timestamp:  now,
          isLive:     true,
          tripMode,
          driverName,
          driverUID,                     // keep for reference
          lastStop: lastStop
            ? { lat: lastStop.lat, lng: lastStop.lng, name: lastStop.name }
            : null
        });
      } catch {}
    }
  },
  err => toast('Location error: ' + err.message, true),
  { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 });

  isLive = true;

  /* Listen for student stops added by parent/student apps */
  stopsListener = ref(db, `bus_students/${assignedBusId}`);
  onValue(stopsListener, snap => {
    const data = snap.val() || {};
    Object.entries(data).forEach(([uid, stop]) => {
      if (!stop?.lat || knownUIDs.has(uid)) return;
      knownUIDs.add(uid); studentStops[uid] = stop;
      addStudentMarker(stop);
      showStopNotif(stop);
      if (currentLat && lastStop) drawRoute(currentLat, currentLng, lastStop.lat, lastStop.lng, Object.values(studentStops));
    });
    renderStops();
  });
}

/* ════════════════════════════════════════════
   STOP TRACKING
   KEY FIX: clears active_buses/${assignedBusId}
════════════════════════════════════════════ */
async function stopTracking() {
  if (watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; }
  if (stopsListener)    { off(stopsListener); stopsListener = null; }

  try {
    await set(ref(db, `active_buses/${assignedBusId}`), {
      latitude: null, longitude: null,
      isLive: false, tripMode: null,
      driverName: null, driverUID: null, lastStop: null
    });
    /* Clean up student stops for this bus */
    await set(ref(db, `bus_students/${assignedBusId}`), null);
  } catch {}

  if (mainMap) { mainMap.remove(); mainMap = null; busMarker = null; routeLayer = null; }
  studentStops = {}; knownUIDs = new Set(); isLive = false; tripMode = null; lastStop = null;
  clearAll(); setOfflineUI();
  toast('Trip ended. Location sharing stopped.');
}
document.getElementById('stopBtn').addEventListener('click', stopTracking);

/* ════════════════════════════════════════════
   ROUTE DRAWING
════════════════════════════════════════════ */
async function drawRoute(fLat, fLng, tLat, tLng, wps = []) {
  const wc = wps.map(w => `${w.lng},${w.lat}`).join(';');
  try {
    const d = await (await fetch(
      `https://router.project-osrm.org/route/v1/driving/${fLng},${fLat}${wc ? ';' + wc : ''};${tLng},${tLat}?overview=full&geometries=geojson`
    )).json();
    if (d.code !== 'Ok') return;
    if (routeLayer) mainMap.removeLayer(routeLayer);
    routeLayer = L.geoJSON(d.routes[0].geometry, {
      style: { color:'#4361ee', weight:5, opacity:.85, lineCap:'round', lineJoin:'round' }
    }).addTo(mainMap);
    mainMap.fitBounds(routeLayer.getBounds(), { padding:[40, 40] });
  } catch {}
}

/* ════════════════════════════════════════════
   STUDENT MARKERS & NOTIFICATIONS
════════════════════════════════════════════ */
function addStudentMarker(stop) {
  if (!mainMap) return;
  L.marker([stop.lat, stop.lng], {
    icon: L.divIcon({
      className: '',
      html: `<div style="width:14px;height:14px;border-radius:50%;background:var(--primary);border:3px solid #fff;box-shadow:0 0 0 3px rgba(67,97,238,.25);"></div>`,
      iconSize:[14,14], iconAnchor:[7,7]
    })
  }).addTo(mainMap).bindPopup(`<b>Student Pickup</b><br>${stop.name || 'Nearby stop'}`);
}

function showStopNotif(stop) {
  document.getElementById('stopNotifSub').textContent = `Pickup: ${stop.name || 'Nearby stop'}`;
  const n = document.getElementById('stopNotif');
  n.classList.add('show'); setTimeout(() => n.classList.remove('show'), 5000);
}

function renderStops() {
  const list = document.getElementById('stopsList'); list.innerHTML = '';
  const mk = (cls, label, sub = '') => {
    const d = document.createElement('div'); d.className = 'stop-item';
    d.innerHTML = `<div class="stop-dot ${cls}"></div><div><div class="stop-label">${label}</div>${sub ? `<div class="stop-sub">${sub}</div>` : ''}</div>`;
    list.appendChild(d);
  };
  mk('start', 'Your current location', 'Starting point');
  Object.values(studentStops).forEach((s, i) => mk('student', s.name || 'Student stop ' + (i + 1)));
  if (lastStop) mk('end', lastStop.name, 'Final destination');
  document.getElementById('stopsCard').classList.add('visible');
}

/* ════════════════════════════════════════════
   UI STATE HELPERS
════════════════════════════════════════════ */
function busIcon() {
  return L.divIcon({
    className: '',
    html: `<div style="background:#1a73e8;border-radius:50% 50% 50% 0;transform:rotate(-45deg);width:40px;height:40px;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.3);border:2px solid #fff;"><i class="fa-solid fa-bus" style="color:#fff;font-size:16px;transform:rotate(45deg);"></i></div>`,
    iconSize:[40,40], iconAnchor:[20,40]
  });
}

function setLiveUI() {
  document.getElementById('defaultView').style.display  = 'none';
  document.getElementById('mapView').style.display      = 'block';
  document.getElementById('liveCard').style.display     = 'none';
  document.getElementById('noticeBox').style.display    = 'none';
  document.getElementById('tripCard').classList.add('visible');
  document.getElementById('statsCard').classList.add('visible');
  const p = document.getElementById('statusPill');
  p.innerHTML = '<i class="fa-solid fa-circle" style="font-size:.45rem;color:var(--success);margin-right:4px;vertical-align:middle;"></i>Online';
  p.className = 'status-pill online';
}

function setOfflineUI() {
  document.getElementById('defaultView').style.display  = 'block';
  document.getElementById('mapView').style.display      = 'none';
  document.getElementById('liveCard').style.display     = 'block';
  document.getElementById('noticeBox').style.display    = 'flex';
  document.getElementById('tripCard').classList.remove('visible');
  document.getElementById('statsCard').classList.remove('visible');
  document.getElementById('stopsCard').classList.remove('visible');
  const p = document.getElementById('statusPill');
  p.innerHTML = '<i class="fa-solid fa-circle" style="font-size:.45rem;margin-right:4px;vertical-align:middle;"></i>Offline';
  p.className = 'status-pill';
}

/* Seed location on load */
navigator.geolocation.getCurrentPosition(
  p => { currentLat = p.coords.latitude; currentLng = p.coords.longitude; },
  () => {},
  { enableHighAccuracy: true }
);