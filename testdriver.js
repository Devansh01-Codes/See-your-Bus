// ════════════════════════════════════════════════════════════════════════════
//  driver.js  —  BusTrack Driver Dashboard
//  Fully connected with Admin Panel Firebase structure
//  Firebase compat SDK (matches admin panel)
// ════════════════════════════════════════════════════════════════════════════

import { initializeApp }   from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, onAuthStateChanged, signOut }
                            from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
import { getDatabase, ref, get, set, update, onValue, remove }
                            from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";

/* ─────────────────────────────────────────────────────────────────────────────
   1. FIREBASE INIT  (same config as auth.js and admin panel)
───────────────────────────────────────────────────────────────────────────── */
const firebaseConfig = {
  apiKey:            "AIzaSyCVTQr4SePTDMHe2H7VYKvDmvD0e71JpPg",
  authDomain:        "bus-tracker-app-001.firebaseapp.com",
  databaseURL:       "https://bus-tracker-app-001-default-rtdb.firebaseio.com",
  projectId:         "bus-tracker-app-001",
  storageBucket:     "bus-tracker-app-001.firebasestorage.app",
  messagingSenderId: "183488595656",
  appId:             "1:183488595656:web:5e0f1cf3ca1601e08bc7fd"
};

const app  = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db   = getDatabase(app);

/* ─────────────────────────────────────────────────────────────────────────────
   2. STATE
───────────────────────────────────────────────────────────────────────────── */
let currentUID      = null;   // Firebase Auth UID
let driverData      = null;   // drivers/{uid}  from admin panel
let busData         = null;   // buses/{assignedBusId} from admin panel
let routeData       = null;   // routes/{routeId} from admin panel
let isLive          = false;
let currentTripMode = null;   // 'picking' | 'dropping'
let selectedLastStop = null;  // { name, lat, lng }
let watchId         = null;   // geolocation watch
let driverUnsubscribe = null; // realtime listener cleanup

/* ─────────────────────────────────────────────────────────────────────────────
   3. DOM REFS  (all elements that already exist in driver.html)
───────────────────────────────────────────────────────────────────────────── */
const dom = {
  dashboard:        () => document.getElementById("dashboard"),
  tripModeOverlay:  () => document.getElementById("tripModeOverlay"),
  lastStopOverlay:  () => document.getElementById("lastStopOverlay"),
  liveBtn:          () => document.getElementById("liveBtn"),
  liveCard:         () => document.getElementById("liveCard"),
  tripCard:         () => document.getElementById("tripCard"),
  stopBtn:          () => document.getElementById("stopBtn"),
  statusPill:       () => document.getElementById("statusPill"),
  noticeBox:        () => document.getElementById("noticeBox"),
  sidebarAvatar:    () => document.getElementById("sidebarAvatar"),
  sidebarName:      () => document.getElementById("sidebarName"),
  profileAvatar:    () => document.getElementById("profileAvatar"),
  profileName:      () => document.getElementById("profileName"),
  tripModeBadge:    () => document.getElementById("tripModeBadge"),
  tripTo:           () => document.getElementById("tripTo"),
  tripStartTime:    () => document.getElementById("tripStartTime"),
  statSpeed:        () => document.getElementById("stat-speed"),
  statAccuracy:     () => document.getElementById("stat-accuracy"),
  stopsList:        () => document.getElementById("stopsList"),
  stopsCard:        () => document.getElementById("stopsCard"),
  statsCard:        () => document.getElementById("statsCard"),
  logoutBtn:        () => document.getElementById("logoutBtn"),
  toast:            () => document.getElementById("toast"),
};

/* ─────────────────────────────────────────────────────────────────────────────
   4. AUTH GATE  — runs on every page load
───────────────────────────────────────────────────────────────────────────── */
onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "index.html";
    return;
  }

  currentUID = user.uid;

  // Hide everything while we validate
  hideAll();

  try {
    const snap = await get(ref(db, `drivers/${currentUID}`));

    // ── CASE 1: Not in drivers collection at all ──────────────────────────
    if (!snap.exists()) {
      await signOut(auth);
      showBlockScreen(
        "🚫",
        "Access Denied",
        "Your account is not registered as a driver. Contact your admin.",
        true   // show logout
      );
      return;
    }

    driverData = snap.val();

    // ── CASE 2: Not verified yet ──────────────────────────────────────────
    if (!driverData.isVerified) {
      showBlockScreen(
        "⏳",
        "Waiting for Verification",
        "Your account is pending admin approval. Please check back later.",
        true
      );
      // Still listen — unlock automatically when admin verifies
      listenForDriverChanges();
      return;
    }

    // ── CASE 3: No bus assigned ───────────────────────────────────────────
    if (!driverData.assignedBusId) {
      showBlockScreen(
        "🚌",
        "No Bus Assigned",
        "Your account is verified but no bus has been assigned yet. Contact your admin.",
        true
      );
      // Still listen — unlock when admin assigns a bus
      listenForDriverChanges();
      return;
    }

    // ── ALL CHECKS PASSED — load bus & route data, then unlock ────────────
    await loadBusAndRoute();
    unlockDashboard(user);
    listenForDriverChanges();   // watch admin changes in real-time

  } catch (err) {
    showBlockScreen("⚠️", "Connection Error", err.message, true);
  }
});

/* ─────────────────────────────────────────────────────────────────────────────
   5. LOAD BUS + ROUTE DATA (from admin panel structure)
───────────────────────────────────────────────────────────────────────────── */
async function loadBusAndRoute() {
  // buses/{assignedBusId}  —  set by admin panel's saveBus() / confirmAssign()
  const busSnap = await get(ref(db, `buses/${driverData.assignedBusId}`));
  busData = busSnap.exists() ? busSnap.val() : {};

  // routes/{routeId}  —  set by admin panel's saveRoute()
  if (busData.routeId) {
    const routeSnap = await get(ref(db, `routes/${busData.routeId}`));
    routeData = routeSnap.exists() ? routeSnap.val() : null;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   6. UNLOCK DASHBOARD — populate UI and enable features
───────────────────────────────────────────────────────────────────────────── */
function unlockDashboard(user) {
  // Remove any block screen
  document.getElementById("blockScreen")?.remove();

  // Show dashboard
  dom.dashboard().style.display = "";

  // ── Populate driver info ──────────────────────────────────────────────────
  const name    = driverData.name || user.displayName || "Driver";
  const initial = name.charAt(0).toUpperCase();

  dom.sidebarAvatar().textContent = initial;
  dom.profileAvatar().textContent = initial;
  dom.sidebarName().textContent   = name;
  dom.profileName().textContent   = name;

  // ── Bus number in all .driver-bus spans ───────────────────────────────────
  const busNumber = busData.busNumber || driverData.assignedBusId || "—";
  document.querySelectorAll(".driver-bus").forEach(el => {
    el.innerHTML = `<i class="fa-solid fa-bus" style="color:var(--primary);margin-right:4px;"></i>${busNumber}`;
  });

  // ── Inject bus info banner into sidebar ──────────────────────────────────
  injectBusInfoBanner(busNumber);

  // ── Populate route card in main area ─────────────────────────────────────
  populateRouteCard();

  // ── Enable Go Live button ─────────────────────────────────────────────────
  enableGoLive();

  // ── Wire logout ──────────────────────────────────────────────────────────
  dom.logoutBtn()?.addEventListener("click", handleLogout);
}

/* ─────────────────────────────────────────────────────────────────────────────
   7. BUS INFO BANNER (injected into sidebar below driver-card)
───────────────────────────────────────────────────────────────────────────── */
function injectBusInfoBanner(busNumber) {
  if (document.getElementById("busInfoBanner")) {
    // Already exists — just update values
    document.getElementById("bib-busId").textContent    = driverData.assignedBusId || "—";
    document.getElementById("bib-busNum").textContent   = busNumber;
    document.getElementById("bib-route").textContent    = routeData?.routeName || busData.routeId || "—";
    updateStatusBadges();
    return;
  }

  const banner = document.createElement("div");
  banner.id = "busInfoBanner";
  banner.style.cssText = `
    background:#fff;border:1px solid #e8edf5;border-radius:12px;
    padding:14px 16px;margin:12px 0;display:flex;flex-direction:column;gap:8px;
  `;
  banner.innerHTML = `
    <!-- Info rows -->
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:.85rem;">
      <span style="color:#6B7280;display:flex;align-items:center;gap:6px;">
        <i class="fa-solid fa-id-card"></i> Bus ID
      </span>
      <strong id="bib-busId">${driverData.assignedBusId || "—"}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:.85rem;">
      <span style="color:#6B7280;display:flex;align-items:center;gap:6px;">
        <i class="fa-solid fa-bus"></i> Bus No.
      </span>
      <strong id="bib-busNum">${busNumber}</strong>
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;font-size:.85rem;">
      <span style="color:#6B7280;display:flex;align-items:center;gap:6px;">
        <i class="fa-solid fa-route"></i> Route
      </span>
      <strong id="bib-route">${routeData?.routeName || busData.routeId || "—"}</strong>
    </div>
    <!-- Status badges -->
    <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;" id="bibBadgeRow">
      <span id="badgeVerified"  style="${badgeStyle("verified")}">✔ Verified</span>
      <span id="badgeBus"       style="${badgeStyle("bus")}">🚌 Bus Assigned</span>
      <span id="badgeOnline"    style="${badgeStyle("offline")}">● Offline</span>
    </div>`;

  const sidebar    = document.getElementById("sidebar");
  const driverCard = sidebar?.querySelector(".driver-card");
  driverCard ? driverCard.after(banner) : sidebar?.prepend(banner);
}

function badgeStyle(type) {
  const styles = {
    verified: "font-size:.72rem;font-weight:700;padding:3px 10px;border-radius:20px;background:#d4edda;color:#1a7a3c;",
    pending:  "font-size:.72rem;font-weight:700;padding:3px 10px;border-radius:20px;background:#fff3cd;color:#856404;",
    bus:      "font-size:.72rem;font-weight:700;padding:3px 10px;border-radius:20px;background:#cce5ff;color:#004085;",
    "no-bus": "font-size:.72rem;font-weight:700;padding:3px 10px;border-radius:20px;background:#f8d7da;color:#721c24;",
    online:   "font-size:.72rem;font-weight:700;padding:3px 10px;border-radius:20px;background:#d4edda;color:#1a7a3c;",
    offline:  "font-size:.72rem;font-weight:700;padding:3px 10px;border-radius:20px;background:#e2e3e5;color:#555;",
  };
  return styles[type] || styles.offline;
}

function updateStatusBadges() {
  const bv = document.getElementById("badgeVerified");
  const bb = document.getElementById("badgeBus");
  if (!bv || !bb) return;
  const verified    = driverData?.isVerified;
  const busAssigned = !!driverData?.assignedBusId;
  bv.textContent = verified    ? "✔ Verified"      : "⏳ Pending";
  bv.style.cssText = badgeStyle(verified ? "verified" : "pending");
  bb.textContent = busAssigned ? "🚌 Bus Assigned"  : "❌ No Bus";
  bb.style.cssText = badgeStyle(busAssigned ? "bus" : "no-bus");
}

function setOnlineStatus(online) {
  const bo = document.getElementById("badgeOnline");
  const sp = dom.statusPill();
  if (bo) {
    bo.textContent   = online ? "● Online" : "● Offline";
    bo.style.cssText = badgeStyle(online ? "online" : "offline");
  }
  if (sp) {
    sp.innerHTML = `<i class="fa-solid fa-circle" style="font-size:.45rem;margin-right:4px;vertical-align:middle;"></i>${online ? "Live" : "Offline"}`;
    sp.style.background = online ? "#2ecc71" : "";
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
   8. POPULATE ROUTE CARD (main area) — from admin's routes/{routeId}
───────────────────────────────────────────────────────────────────────────── */
function populateRouteCard() {
  if (!routeData) return;

  const stops = Array.isArray(routeData.stops) ? routeData.stops : [];
  const infoRows = document.querySelectorAll(".info-row .info-val");

  // .info-row order in driver.html: First stop, Last stop, Total stops, Distance
  if (infoRows[0]) infoRows[0].textContent = stops[0]               || "—";
  if (infoRows[1]) infoRows[1].textContent = stops[stops.length - 1] || "—";
  if (infoRows[2]) infoRows[2].textContent = `${stops.length} stops`;
  // distance stays as-is (calculated during live tracking)

  // Populate sidebar stops list (stopsCard)
  renderRouteStops(stops);
}

function renderRouteStops(stops) {
  const list = dom.stopsList();
  if (!list || !stops.length) return;
  list.innerHTML = stops.map((s, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:.85rem;">
      <span style="width:20px;height:20px;border-radius:50%;background:rgba(255,193,7,.15);color:#b07d00;
        font-size:.7rem;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;">
        ${i + 1}
      </span>
      ${s}
    </div>`).join("");
}

/* ─────────────────────────────────────────────────────────────────────────────
   9. GO LIVE BUTTON — enable / disable
───────────────────────────────────────────────────────────────────────────── */
function enableGoLive() {
  const btn = dom.liveBtn();
  if (!btn) return;
  btn.disabled         = false;
  btn.style.opacity    = "1";
  btn.style.cursor     = "pointer";
  btn.title            = "";
  btn.addEventListener("click", onGoLiveClick);
}

function blockGoLive(reason) {
  const btn = dom.liveBtn();
  if (!btn) return;
  btn.disabled         = true;
  btn.style.opacity    = "0.5";
  btn.style.cursor     = "not-allowed";
  btn.title            = reason;
  btn.removeEventListener("click", onGoLiveClick);
}

/* ─────────────────────────────────────────────────────────────────────────────
   10. REAL-TIME LISTENER — admin can change driver / bus assignment anytime
───────────────────────────────────────────────────────────────────────────── */
function listenForDriverChanges() {
  if (driverUnsubscribe) driverUnsubscribe();   // cleanup previous

  driverUnsubscribe = onValue(ref(db, `drivers/${currentUID}`), async (snap) => {
    if (!snap.exists()) return;
    const updated = snap.val();

    // Admin un-verified
    if (!updated.isVerified) {
      driverData = updated;
      showToast("Your verification was revoked. Contact admin.", true);
      blockGoLive("Account not verified");
      updateStatusBadges();
      if (isLive) await stopTrip();
      return;
    }

    // Admin removed bus
    if (!updated.assignedBusId) {
      driverData = updated;
      showToast("Your bus assignment was removed. Contact admin.", true);
      blockGoLive("No bus assigned");
      updateStatusBadges();
      if (isLive) await stopTrip();
      return;
    }

    // Bus changed by admin
    if (updated.assignedBusId !== driverData?.assignedBusId) {
      driverData = updated;
      await loadBusAndRoute();

      // Refresh UI — don't call full unlockDashboard to avoid re-injecting banner
      const busNumber = busData.busNumber || driverData.assignedBusId || "—";
      document.querySelectorAll(".driver-bus").forEach(el => {
        el.innerHTML = `<i class="fa-solid fa-bus" style="color:var(--primary);margin-right:4px;"></i>${busNumber}`;
      });
      const busIdEl = document.getElementById("bib-busId");
      if (busIdEl) busIdEl.textContent = driverData.assignedBusId;
      
      const busNumEl = document.getElementById("bib-busNum");
      if (busNumEl) busNumEl.textContent = busNumber;
      
      const routeEl = document.getElementById("bib-route");
      if (routeEl) {
        routeEl.textContent = routeData?.routeName || busData.routeId || "—";
      }
      updateStatusBadges();
      populateRouteCard();
      showToast("Your bus assignment was updated by admin.");
      return;
    }

    driverData = updated;
    updateStatusBadges();
  });
}

/* ─────────────────────────────────────────────────────────────────────────────
   11. TRIP FLOW — Go Live click → Trip Mode → Last Stop → Live Tracking
───────────────────────────────────────────────────────────────────────────── */

// Step 1: "Go Live" clicked — show trip mode overlay (picking / dropping)
function onGoLiveClick() {
  dom.tripModeOverlay().style.display = "flex";
}

// Wire picking / dropping buttons  (they exist in driver.html)
document.getElementById("pickingBtn")?.addEventListener("click", () => {
  currentTripMode = "picking";
  dom.tripModeOverlay().style.display = "none";
  dom.lastStopOverlay().style.display = "flex";   // Step 2
});

document.getElementById("droppingBtn")?.addEventListener("click", () => {
  currentTripMode = "dropping";
  dom.tripModeOverlay().style.display = "none";
  dom.lastStopOverlay().style.display = "flex";   // Step 2
});

// Step 3: "Confirm & Start Trip" — wired from existing confirmStopBtn in driver.html
// We hook into it here; your script.js handles the search/pick-on-map logic
// and should call window.onLastStopConfirmed(stopName, lat, lng)
window.onLastStopConfirmed = async (stopName, lat, lng) => {
  selectedLastStop = { name: stopName, lat, lng };
  dom.lastStopOverlay().style.display = "none";
  await startTrip();
};

/* ─────────────────────────────────────────────────────────────────────────────
   12. START TRIP
───────────────────────────────────────────────────────────────────────────── */
async function startTrip() {
  if (!driverData?.isVerified || !driverData?.assignedBusId) {
    showToast("Cannot start trip — contact admin.", true);
    return;
  }

  isLive = true;

  // Update sidebar UI
  dom.liveCard().style.display  = "none";
  dom.tripCard().style.display  = "block";
  dom.noticeBox().style.display = "none";

  // Trip card values
  dom.tripModeBadge().textContent = currentTripMode === "picking" ? "🟢 Picking" : "🔴 Dropping";
  dom.tripTo().textContent        = selectedLastStop?.name || "—";
  dom.tripStartTime().textContent = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });

  setOnlineStatus(true);

  // Write initial record to active_buses/{driverUID}
  // Structure matches admin panel's renderActiveBuses() and store.activeBuses
  await set(ref(db, `active_buses/${currentUID}`), {
    isLive:        true,
    driverName:    driverData.name,
    assignedBusId: driverData.assignedBusId,
    busNumber:     busData.busNumber || driverData.assignedBusId,
    routeId:       busData.routeId   || null,
    tripMode:      currentTripMode,
    lastStop:      selectedLastStop?.name || null,
    lastStopLat:   selectedLastStop?.lat  || null,
    lastStopLng:   selectedLastStop?.lng  || null,
    latitude:      null,
    longitude:     null,
    speed:         0,
    heading:       0,
    startedAt:     Date.now()
  });

  // Start geolocation tracking
  startLocationWatch();

  // Wire stop button
  dom.stopBtn()?.addEventListener("click", stopTrip);
}

/* ─────────────────────────────────────────────────────────────────────────────
   13. GEOLOCATION — writes to active_buses/{driverUID}
───────────────────────────────────────────────────────────────────────────── */
function startLocationWatch() {
  if (!navigator.geolocation) {
    showToast("Geolocation not supported by this device.", true);
    return;
  }

  watchId = navigator.geolocation.watchPosition(
    async (pos) => {
      const { latitude, longitude, speed, heading, accuracy } = pos.coords;

      // Update stats in sidebar
      if (dom.statSpeed())    dom.statSpeed().textContent    = speed != null ? `${(speed * 3.6).toFixed(1)} km/h` : "— km/h";
      if (dom.statAccuracy()) dom.statAccuracy().textContent = accuracy != null ? `${accuracy.toFixed(0)} m` : "— m";

      // Write live data — matches admin panel's store.activeBuses structure
      await update(ref(db, `active_buses/${currentUID}`), {
        latitude:  latitude,
        longitude: longitude,
        speed:     speed     != null ? +(speed * 3.6).toFixed(1) : 0,   // km/h
        heading:   heading   != null ? +heading.toFixed(1)        : 0,
        accuracy:  accuracy  != null ? +accuracy.toFixed(0)       : null,
        updatedAt: Date.now()
      });
    },
    (err) => { showToast("Location error: " + err.message, true); },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

/* ─────────────────────────────────────────────────────────────────────────────
   14. STOP TRIP
───────────────────────────────────────────────────────────────────────────── */
async function stopTrip() {
  isLive = false;

  // Stop geolocation
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }

  // Mark offline in active_buses (admin dashboard will see isLive = false)
  await update(ref(db, `active_buses/${currentUID}`), {
    isLive:    false,
    endedAt:   Date.now()
  });

  // Reset sidebar UI
  dom.tripCard().style.display  = "none";
  dom.liveCard().style.display  = "block";
  dom.noticeBox().style.display = "block";
  
  const speedEl = dom.statSpeed();
if (speedEl) speedEl.textContent = "— km/h";

const accEl = dom.statAccuracy();
if (accEl) accEl.textContent = "— m";
  setOnlineStatus(false);
  showToast("Trip ended. Location sharing stopped.");

  currentTripMode  = null;
  selectedLastStop = null;
}

/* ─────────────────────────────────────────────────────────────────────────────
   15. LOGOUT
───────────────────────────────────────────────────────────────────────────── */
async function handleLogout() {
  if (isLive) await stopTrip();
  if (driverUnsubscribe) driverUnsubscribe();
  await signOut(auth);
  window.location.href = "index.html";
}

/* ─────────────────────────────────────────────────────────────────────────────
   16. BLOCK SCREEN (shown when access denied / not verified / no bus)
───────────────────────────────────────────────────────────────────────────── */
function hideAll() {
  if (dom.dashboard()) {
    dom.dashboard().style.display = "none";
  }
    if(dom.tripModeOverlay()){
      dom.tripModeOverlay().style.display = "none";
    }
    if(dom.lastStopOverlay()){
      dom.lastStopOverlay().style.display = "none";
    }
}

function showBlockScreen(icon, title, message, showLogout = true) {
  document.getElementById("blockScreen")?.remove();

  const el = document.createElement("div");
  el.id = "blockScreen";
  el.style.cssText = `
    position:fixed;inset:0;z-index:9999;
    display:flex;flex-direction:column;align-items:center;justify-content:center;
    gap:14px;font-family:'Outfit',sans-serif;
    background:radial-gradient(ellipse 80% 60% at 60% -10%,#fff8e7,transparent),
               radial-gradient(ellipse 60% 50% at 0% 100%,#eef2ff,transparent),#f5f5f5;
    padding:24px;text-align:center;
  `;
  el.innerHTML = `
    <div style="font-size:3.5rem;line-height:1;">${icon}</div>
    <h2 style="margin:0;font-size:1.5rem;color:#1a1a2e;font-family:'Outfit',sans-serif;">${title}</h2>
    <p style="max-width:340px;color:#6B7280;font-size:.95rem;line-height:1.6;">${message}</p>
    ${showLogout ? `
      <button onclick="(async()=>{
          const {getAuth,signOut}=await import('https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js');
          await signOut(getAuth()); window.location.href='index.html';
        })()"
        style="margin-top:8px;padding:11px 32px;border:none;border-radius:10px;
               background:#FFC107;color:#fff;font-size:1rem;font-weight:700;
               cursor:pointer;font-family:'Outfit',sans-serif;letter-spacing:.3px;">
        Back to Login
      </button>` : ""}
  `;
  document.body.appendChild(el);
}

/* ─────────────────────────────────────────────────────────────────────────────
   17. TOAST
───────────────────────────────────────────────────────────────────────────── */
let toastTimer;
function showToast(message, isError = false) {
  const toast = dom.toast();
  if (!toast) return;
  toast.textContent      = message;
  toast.style.background = isError ? "#EF4444" : "#22C55E";
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3500);
}

// Expose showToast globally so script.js can also use it
window.showToast = showToast;

/* ─────────────────────────────────────────────────────────────────────────────
   18. SIGNUP — Driver Key Validation
       Called from auth.js  signUpUser()  before createUserWithEmailAndPassword
       Export for use in auth.js if needed, or inline the same logic there.
───────────────────────────────────────────────────────────────────────────── */

/**
 * Validates a driverKey against admin panel's  driverKeys/{key}  node.
 * Returns { valid: true }  or  { valid: false, reason: string }
 */
export async function validateDriverKey(key) {
  if (!key || key.length === 0) {
    return { valid: false, reason: "Please enter a driver key." };
  }
  try {
    const snap = await get(ref(db, `driverKeys/${key}`));
    if (!snap.exists()) {
      return { valid: false, reason: "Invalid driver key. Ask your admin for a key." };
    }
    const data = snap.val();
    if (data.isUsed) {
      return { valid: false, reason: "This driver key has already been used." };
    }
    return { valid: true };
  } catch (err) {
    return { valid: false, reason: "Could not verify key: " + err.message };
  }
}

/**
 * Saves driver to  drivers/{uid}  and marks key as used in  driverKeys/{key}
 * Matches exactly what admin panel reads in renderDrivers()
 */
export async function saveDriverOnSignup(uid, name, email, phone, driverKey) {
  const updates = {};

  // drivers/{uid}  — matches admin's renderDrivers() columns:
  //   name, phone, driverKey, assignedBusId, isVerified
  updates[`drivers/${uid}`] = {
    name:          name,
    email:         email,
    phone:         phone || "",
    driverKey:     driverKey,
    isVerified:    false,        // admin verifies via verifyDriver()
    assignedBusId: null,         // admin assigns via confirmAssign()
    createdAt:     Date.now()
  };

  // driverKeys/{key}  — mark as used
  updates[`driverKeys/${driverKey}/isUsed`]  = true;
  updates[`driverKeys/${driverKey}/usedBy`]  = uid;
  updates[`driverKeys/${driverKey}/usedAt`]  = Date.now();

  await update(ref(db, "/"), updates);
}