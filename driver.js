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
let lastStop = null;                              // auto-set from assigned route
let studentStops = {}, knownUIDs = new Set(), stopsListener = null, lastUpdate = 0;

/* ── Driver profile (loaded from Firebase) ── */
let driverProfile  = null;   // full drivers/${uid} record
let assignedBusId  = null;   // e.g. "BUS001"
let assignedBusNum = null;   // e.g. "UP80 AB 1234"
let assignedRoute  = null;   // full route record { routeName, stops:[] }

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
    const el = document.getElementById(id);
    if (el) el.textContent = ini;
  });
  ['sidebarName','profileName'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = driverName;
  });

  await loadDriverProfile();
});

/* ════════════════════════════════════════════
   LOAD DRIVER PROFILE + BUS + ROUTE FROM ADMIN
════════════════════════════════════════════ */
async function loadDriverProfile() {
  try {
    const snap = await get(ref(db, `drivers/${driverUID}`));
    driverProfile = snap.val();

    if (!driverProfile) {
      toast('Your account is not registered. Contact admin.', true);
      return;
    }
    if (!driverProfile.isVerified) {
      toast('Your account is pending admin approval.', true);
      const liveBtn = document.getElementById('liveBtn');
      if (liveBtn) { liveBtn.disabled = true; liveBtn.textContent = '⏳ Awaiting Admin Approval'; }
      return;
    }

    assignedBusId = driverProfile.assignedBusId || null;

    if (assignedBusId) {
      /* ── Load bus data ── */
      const busSnap = await get(ref(db, `buses/${assignedBusId}`));
      const busData = busSnap.val();
      assignedBusNum = busData?.busNumber || assignedBusId;

      document.querySelectorAll('.driver-bus').forEach(el => {
        el.innerHTML = `<i class="fa-solid fa-bus" style="color:var(--primary);margin-right:4px;"></i>${assignedBusNum}`;
      });

      /* ── Load assigned route ── */
      const routeId = busData?.routeId;
      if (routeId) {
        const routeSnap = await get(ref(db, `routes/${routeId}`));
        assignedRoute = routeSnap.val();

        /* ── Auto-set lastStop from the route's final stop ── */
        if (assignedRoute) {
          const stops = assignedRoute.stops || [];
          if (stops.length > 0) {
            const finalStop = stops[stops.length - 1];
            /* Support both object stops {name,lat,lng} and plain string stops */
            if (typeof finalStop === 'object' && finalStop.lat && finalStop.lng) {
              lastStop = { lat: finalStop.lat, lng: finalStop.lng, name: finalStop.name || 'Final Stop' };
            } else if (typeof finalStop === 'string') {
              /* String-only stops: name is set, coords resolved when trip starts */
              lastStop = { lat: null, lng: null, name: finalStop };
            }
          }
          renderRoutePanel();
        }
      }
    } else {
      document.querySelectorAll('.driver-bus').forEach(el => {
        el.innerHTML = `<i class="fa-solid fa-bus" style="color:var(--primary);margin-right:4px;"></i>No bus assigned`;
      });
      toast('No bus assigned to you yet. Contact admin.', true);
      const liveBtn = document.getElementById('liveBtn');
      if (liveBtn) liveBtn.disabled = true;
    }

  } catch (e) {
    toast('Failed to load profile: ' + e.message, true);
  }
}

/* ════════════════════════════════════════════
   RENDER ROUTE PANEL (defaultView)
   Reads from assignedRoute set by admin
════════════════════════════════════════════ */
function renderRoutePanel() {
  if (!assignedRoute) return;

  const stops = assignedRoute.stops || [];

  /* Helper: get display name whether stop is a string or object */
  const stopName = s => (typeof s === 'object' ? s?.name : s) || '—';

  const firstStopName = stops.length > 0 ? stopName(stops[0])            : '—';
  const lastStopName  = stops.length > 0 ? stopName(stops[stops.length - 1]) : '—';
  const routeName     = assignedRoute.routeName || assignedRoute.name || '—';

  const rows = document.querySelectorAll('#defaultView .info-row .info-val');
  if (rows.length >= 3) {
    rows[0].textContent = firstStopName;
    rows[1].textContent = stops.length + ' stops';
    rows[2].textContent = '— km';
  }

  /* Also populate tripCard "To" field with final stop name */
  const tripToEl = document.getElementById('tripTo');
  if (tripToEl) tripToEl.textContent = lastStopName;
}

/* ════════════════════════════════════════════
   LOGOUT
════════════════════════════════════════════ */
async function handleLogout() {
  if (isLive) await stopTracking();
  await signOut(auth).catch(() => {});
  window.location.href = 'login.html';
}
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) logoutBtn.addEventListener('click', handleLogout);
const mobileLogoutBtn = document.getElementById('logoutBtnMobile');
if (mobileLogoutBtn) mobileLogoutBtn.addEventListener('click', handleLogout);

/* ════════════════════════════════════════════
   TOAST
════════════════════════════════════════════ */
function toast(msg, err = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.remove('err');
  if (err) el.classList.add('err');
  el.classList.add('show');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('show'), 3000);
}

/* ════════════════════════════════════════════
   STEP 1: Go Live → Trip type → Start directly
   (No last-stop overlay — destination is auto-set from admin route)
════════════════════════════════════════════ */
const liveBtnEl = document.getElementById('liveBtn');
if (liveBtnEl) {
  liveBtnEl.addEventListener('click', () => {
    if (!assignedBusId) { toast('No bus assigned. Contact admin.', true); return; }
    document.getElementById('tripModeOverlay').classList.add('visible');
  });
}

const pickingBtn  = document.getElementById('pickingBtn');
const droppingBtn = document.getElementById('droppingBtn');
if (pickingBtn)  pickingBtn.addEventListener('click',  () => beginTrip('picking'));
if (droppingBtn) droppingBtn.addEventListener('click', () => beginTrip('dropping'));

/* ── Begin trip immediately after mode selection ── */
function beginTrip(mode) {
  tripMode = mode;
  document.getElementById('tripModeOverlay').classList.remove('visible');

  /* Seed current location if not yet available */
  if (!currentLat) {
    navigator.geolocation.getCurrentPosition(
      p => { currentLat = p.coords.latitude; currentLng = p.coords.longitude; },
      () => {}
    );
  }

  /* Update trip card info */
  const badge = document.getElementById('tripModeBadge');
  if (badge) {
    badge.textContent = mode === 'picking' ? '🟢 Picking' : '🔴 Dropping';
    badge.className   = `mode-badge ${mode}`;
  }
  const tripToEl = document.getElementById('tripTo');
  if (tripToEl && lastStop) tripToEl.textContent = lastStop.name;

  const startEl = document.getElementById('tripStartTime');
  if (startEl) startEl.textContent = new Date().toLocaleTimeString([], { hour:'2-digit', minute:'2-digit' });

  startTracking();
}

/* ════════════════════════════════════════════
   GPS TRACKING
   Writes to active_buses/${assignedBusId} so
   admin's bus list shows the correct bus as Live
════════════════════════════════════════════ */
async function startTracking() {
  if (!navigator.geolocation) { toast('Geolocation not supported.', true); return; }
  if (!assignedBusId)         { toast('No bus assigned — cannot go live.', true); return; }

  setLiveUI();

  watchId = navigator.geolocation.watchPosition(async pos => {
    const { latitude, longitude, heading, speed, accuracy } = pos.coords;
    currentLat = latitude; currentLng = longitude;
    const now  = Date.now();

    if (!mainMap) {
      mainMap   = L.map('mainMap').setView([latitude, longitude], 15);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap' }).addTo(mainMap);
      busMarker = L.marker([latitude, longitude], { icon: busIcon() }).addTo(mainMap);

      /* Draw route if lastStop has valid coords */
      if (lastStop?.lat && lastStop?.lng) {
        await drawRoute(latitude, longitude, lastStop.lat, lastStop.lng, Object.values(studentStops));
      }
    } else {
      busMarker.setLatLng([latitude, longitude]);
    }

    const speedEl    = document.getElementById('stat-speed');
    const accuracyEl = document.getElementById('stat-accuracy');
    if (speedEl)    speedEl.textContent    = speed    != null ? (speed * 3.6).toFixed(1) + ' km/h' : '— km/h';
    if (accuracyEl) accuracyEl.textContent = accuracy != null ? accuracy.toFixed(0) + ' m'         : '— m';

    /* Throttle Firebase writes to every 3 s */
    if (now - lastUpdate > 3000) {
      lastUpdate = now;
      try {
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
          driverUID,
          busNumber:  assignedBusNum || assignedBusId,
          lastStop: (lastStop?.lat && lastStop?.lng)
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
      if (currentLat && lastStop?.lat && lastStop?.lng) {
        drawRoute(currentLat, currentLng, lastStop.lat, lastStop.lng, Object.values(studentStops));
      }
    });
    renderStops();
  });
}

/* ════════════════════════════════════════════
   STOP TRACKING
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
    await set(ref(db, `bus_students/${assignedBusId}`), null);
  } catch {}

  if (mainMap) { mainMap.remove(); mainMap = null; busMarker = null; routeLayer = null; }
  studentStops = {}; knownUIDs = new Set(); isLive = false; tripMode = null;
  setOfflineUI();
  toast('Trip ended. Location sharing stopped.');
}

const stopBtn = document.getElementById('stopBtn');
if (stopBtn) stopBtn.addEventListener('click', stopTracking);

/* ════════════════════════════════════════════
   ROUTE DRAWING
════════════════════════════════════════════ */
async function drawRoute(fLat, fLng, tLat, tLng, wps = []) {
  if (!tLat || !tLng) return;          // skip if destination coords not available
  const wc = wps.filter(w => w.lat && w.lng).map(w => `${w.lng},${w.lat}`).join(';');
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
  const sub = document.getElementById('stopNotifSub');
  if (sub) sub.textContent = `Pickup: ${stop.name || 'Nearby stop'}`;
  const n = document.getElementById('stopNotif');
  if (n) { n.classList.add('show'); setTimeout(() => n.classList.remove('show'), 5000); }
}

function renderStops() {
  const list = document.getElementById('stopsList');
  if (!list) return;
  list.innerHTML = '';

  const mk = (cls, label, sub = '') => {
    const d = document.createElement('div'); d.className = 'stop-item';
    d.innerHTML = `<div class="stop-dot ${cls}"></div><div><div class="stop-label">${label}</div>${sub ? `<div class="stop-sub">${sub}</div>` : ''}</div>`;
    list.appendChild(d);
  };

  mk('start', 'Your current location', 'Starting point');
  Object.values(studentStops).forEach((s, i) => mk('student', s.name || 'Student stop ' + (i + 1)));
  if (lastStop) mk('end', lastStop.name, 'Final destination');

  const stopsCard = document.getElementById('stopsCard');
  if (stopsCard) stopsCard.classList.add('visible');
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
  const dv = document.getElementById('defaultView');
  const mv = document.getElementById('mapView');
  const lc = document.getElementById('liveCard');
  const nb = document.getElementById('noticeBox');
  const tc = document.getElementById('tripCard');
  const sc = document.getElementById('statsCard');
  if (dv) dv.style.display = 'none';
  if (mv) mv.style.display = 'block';
  if (lc) lc.style.display = 'none';
  if (nb) nb.style.display = 'none';
  if (tc) tc.classList.add('visible');
  if (sc) sc.classList.add('visible');
  const p = document.getElementById('statusPill');
  if (p) {
    p.innerHTML = '<i class="fa-solid fa-circle" style="font-size:.45rem;color:var(--success);margin-right:4px;vertical-align:middle;"></i>Online';
    p.className = 'status-pill online';
  }
}

function setOfflineUI() {
  const dv = document.getElementById('defaultView');
  const mv = document.getElementById('mapView');
  const lc = document.getElementById('liveCard');
  const nb = document.getElementById('noticeBox');
  const tc = document.getElementById('tripCard');
  const sc = document.getElementById('statsCard');
  const stc = document.getElementById('stopsCard');
  if (dv)  dv.style.display = 'block';
  if (mv)  mv.style.display = 'none';
  if (lc)  lc.style.display = 'block';
  if (nb)  nb.style.display = 'flex';
  if (tc)  tc.classList.remove('visible');
  if (sc)  sc.classList.remove('visible');
  if (stc) stc.classList.remove('visible');
  const p = document.getElementById('statusPill');
  if (p) {
    p.innerHTML = '<i class="fa-solid fa-circle" style="font-size:.45rem;margin-right:4px;vertical-align:middle;"></i>Offline';
    p.className = 'status-pill';
  }
}

/* Seed location on load */
navigator.geolocation.getCurrentPosition(
  p => { currentLat = p.coords.latitude; currentLng = p.coords.longitude; },
  () => {},
  { enableHighAccuracy: true }
);