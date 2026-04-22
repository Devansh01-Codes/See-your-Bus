
 import { initializeApp }from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
 import { getAuth, onAuthStateChanged, signOut }from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";
 import { getDatabase, ref, onValue, set, get, off }from "https://www.gstatic.com/firebasejs/10.8.0/firebase-database.js";
 
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
 
 /* ─────────────────────────────────────────
    STATE
 ───────────────────────────────────────── */
 let studentLat   = null;
 let studentLng   = null;
 let studentUID   = null;
 let studentName  = '';
 let studentData  = null;   // full record from Firebase
 
 let institutionMode = 'school';  // 'school' | 'college'
 
 let chosenBusUID   = null;
 let map            = null;
 let busMarker      = null;
 let studentMarker  = null;
 let myStopMarker   = null;
 let routeLayer     = null;
 let busUnsubscribe = null; // onValue unsubscribe fn for the active bus listener
 let goLiveUnsub    = null; // BUG FIX: store unsub for listenForAssignedBusGoLive
 let firstFix       = true;
 
 /* ─────────────────────────────────────────
    HELPERS
 ───────────────────────────────────────── */
 function showToast(msg, isError = false) {
   const t = document.getElementById('toast');
   if (!t) return;
   t.textContent = msg;
   t.style.background = isError ? '#e74c3c' : '#1a1a2e';
   t.classList.add('show');
   clearTimeout(t._timer);
   t._timer = setTimeout(() => t.classList.remove('show'), 3500);
 }
 
 function hideScreen(id) {
   const el = document.getElementById(id);
   if (el) el.classList.add('hidden');
 }
 function showScreen(id) {
   const el = document.getElementById(id);
   if (el) el.classList.remove('hidden');
 }
 
 function haversine(lat1, lng1, lat2, lng2) {
   const R = 6371000, toRad = d => d * Math.PI / 180;
   const dLat = toRad(lat2 - lat1), dLng = toRad(lng2 - lng1);
   const a = Math.sin(dLat / 2) ** 2
     + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
   return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
 }
 
 function setElText(id, text) {
   const el = document.getElementById(id);
   if (el) el.textContent = text;
 }
 
 /* ─────────────────────────────────────────
    AUTH + BOOTSTRAP
 ───────────────────────────────────────── */
 onAuthStateChanged(auth, async user => {
   if (!user) { window.location.href = "login.html"; return; }
 
   studentUID  = user.uid;
   studentName = (user.displayName || user.email.split('@')[0].replace(/[._-]/g, ' '))
     .trim().replace(/\b\w/g, c => c.toUpperCase());
 
   const initials = studentName.split(' ').filter(Boolean)
     .map(w => w[0]).join('').slice(0, 2).toUpperCase();
 
   const avatarEl = document.getElementById('sAvatar');
   const nameEl   = document.getElementById('sName');
   if (avatarEl) avatarEl.textContent = initials;
   if (nameEl)   nameEl.textContent   = studentName;
 
   // 1. Read institution mode
   const modeSnap = await get(ref(db, 'settings/institutionType'));
   institutionMode = modeSnap.val() || 'school';
 
   // 2. Read this student's record
   studentData = await loadStudentRecord(user.uid, user.email);
 
   // 3. Branch on mode
     bootCollegeMode();
   
 });
 let currentMode = "college"; // default

 const modeBtn = document.getElementById("modeToggleBtn");
 
 modeBtn.addEventListener("click", async () => {
 
   if (currentMode === "college") {
     // Switch to SCHOOL MODE
 
     if (!studentData?.assignedBusId) {
       showToast("No bus assigned to you!", true);
       return;
     }
 
     // Cleanup
     if (busUnsubscribe) { busUnsubscribe(); busUnsubscribe = null; }
     if (goLiveUnsub)    { goLiveUnsub();    goLiveUnsub    = null; }
 
     document.getElementById('mainUI').style.display = 'none';
 
     await bootSchoolMode();
 
     currentMode = "school";
     modeBtn.textContent = "College Mode";
 
   } else {
     // Switch to COLLEGE MODE
 
     if (chosenBusUID && studentUID) {
       await set(ref(db, `bus_students/${chosenBusUID}/${studentUID}`), null);
     }
 
     if (busUnsubscribe) { busUnsubscribe(); busUnsubscribe = null; }
 
     document.getElementById('mainUI').style.display = 'none';
 
     bootCollegeMode();
 
     currentMode = "college";
     modeBtn.textContent = "School Mode";
   }
 });
 /**
  * Try to find this student's record.
  * Priority: users/{uid} → students scan by .uid field → students scan by email
  */
 async function loadStudentRecord(uid, email) {
   try {
     const userSnap = await get(ref(db, `users/${uid}`));
     if (userSnap.exists()) return { id: uid, ...userSnap.val() };
 
     const studSnap = await get(ref(db, 'students'));
     const all = studSnap.val() || {};
     for (const [id, s] of Object.entries(all)) {
       if (s.uid === uid || s.email === email) return { id, ...s };
     }
     return null;
   } catch (e) {
     console.error('loadStudentRecord error:', e);
     return null;
   }
 }
 
 /* ─────────────────────────────────────────
    LOGOUT
 ───────────────────────────────────────── */
 async function doLogout() {
   // Clean up bus_students entry if set
   if (chosenBusUID && studentUID) {
     await set(ref(db, `bus_students/${chosenBusUID}/${studentUID}`), null).catch(() => {});
   }
   // Unsubscribe all listeners before signing out
   if (busUnsubscribe) { busUnsubscribe(); busUnsubscribe = null; }
   if (goLiveUnsub)    { goLiveUnsub();    goLiveUnsub    = null; }
   await signOut(auth);
   window.location.href = "login.html";
 }
 
 const logoutBtn = document.getElementById('logoutBtn');
 if (logoutBtn) logoutBtn.addEventListener('click', doLogout);
 const logoutBtnMobile = document.getElementById('logoutBtnMobile');
 if (logoutBtnMobile) logoutBtnMobile.addEventListener('click', doLogout);
 
 /* ══════════════════════════════════════════════
    SCHOOL MODE
 ══════════════════════════════════════════════ */
 
 async function bootSchoolMode() {
   hideScreen('locationScreen');
   hideScreen('busSelectScreen');
 
   if (!studentData || !studentData.assignedBusId) {
     showSchoolNoAssignment();
     return;
   }
 
   // Show school mode banner
   const schoolBanner = document.getElementById('schoolModeBanner');
   if (schoolBanner) schoolBanner.style.display = 'flex';
 
   const hasHomeCoords = studentData.lat && studentData.lng;
 
   if (!hasHomeCoords) {
     showScreen('locationScreen');
     const skipBtn = document.getElementById('skipLocation');
     if (skipBtn) {
       skipBtn.textContent = 'Use address only';
       skipBtn.onclick = () => { hideScreen('locationScreen'); launchSchoolTracking(); };
     }
     const allowBtn = document.getElementById('allowLocationBtn');
     if (allowBtn) {
       allowBtn.onclick = () => {
         if (!navigator.geolocation) {
           showToast('Geolocation not supported on this device.');
           hideScreen('locationScreen');
           launchSchoolTracking();
           return;
         }
         navigator.geolocation.getCurrentPosition(pos => {
           studentLat = pos.coords.latitude;
           studentLng = pos.coords.longitude;
           hideScreen('locationScreen');
           launchSchoolTracking();
         }, () => {
           showToast('Location access denied. Continuing without GPS.');
           hideScreen('locationScreen');
           launchSchoolTracking();
         }, { enableHighAccuracy: true });
       };
     }
   } else {
     studentLat = parseFloat(studentData.lat);
     studentLng = parseFloat(studentData.lng);
     await launchSchoolTracking();
   }
 }
 
 function showSchoolNoAssignment() {
   hideScreen('locationScreen');
   hideScreen('busSelectScreen');
   const mainUI = document.getElementById('mainUI');
   if (mainUI) mainUI.style.display = 'none';
 
   let noAssign = document.getElementById('noAssignScreen');
   if (!noAssign) {
     noAssign = document.createElement('div');
     noAssign.id = 'noAssignScreen';
     noAssign.style.cssText = `
       position:fixed;inset:0;top:64px;display:flex;align-items:center;
       justify-content:center;flex-direction:column;gap:16px;
       background:#f4f6fb;font-family:'Outfit',sans-serif;text-align:center;padding:32px;z-index:600;
     `;
     noAssign.innerHTML = `
       <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,#4361ee,#7b9dff);
         display:flex;align-items:center;justify-content:center;font-size:2rem;color:#fff;">
         🚌
       </div>
       <h2 style="font-size:1.3rem;font-weight:700;color:#1a1a2e;">No Bus Assigned Yet</h2>
       <p style="font-size:.88rem;color:#888;max-width:280px;line-height:1.6;">
         Your admin hasn't assigned a bus to your account yet.<br>
         Please contact your school administration.
       </p>
       <p style="font-size:.8rem;color:#aaa;">Logged in as: <strong>${studentName}</strong></p>
       <button id="noAssignLogoutBtn" style="padding:10px 24px;border:none;border-radius:12px;
         background:#e74c3c;color:#fff;font-family:'Outfit',sans-serif;font-weight:700;cursor:pointer;">
         Logout
       </button>
     `;
     document.body.appendChild(noAssign);
     // BUG FIX: use event listener instead of inline onclick (modules scope issue)
     document.getElementById('noAssignLogoutBtn').addEventListener('click', doLogout);
   }
   noAssign.style.display = 'flex';
 }
 
 async function launchSchoolTracking() {
   const assignedBusId = studentData.assignedBusId;
 
   const activeSnap  = await get(ref(db, 'active_buses'));
   const activeBuses = activeSnap.val() || {};
 
   let matchedDriverUID = null;
   let matchedBus       = null;
 
   for (const [driverUID, b] of Object.entries(activeBuses)) {
     if (!b || !b.isLive) continue;
     if (driverUID === assignedBusId || b.busId === assignedBusId || b.assignedBusId === assignedBusId) {
       matchedDriverUID = driverUID;
       matchedBus = b;
       break;
     }
   }
 
   // Fallback: look up buses/{assignedBusId} for driverId then check active_buses
   if (!matchedDriverUID) {
     try {
       const busSnap = await get(ref(db, `buses/${assignedBusId}`));
       const busData = busSnap.val();
       if (busData && busData.driverId) {
         const driverActiveSnap = await get(ref(db, `active_buses/${busData.driverId}`));
         if (driverActiveSnap.exists() && driverActiveSnap.val()?.isLive) {
           matchedDriverUID = busData.driverId;
           matchedBus = driverActiveSnap.val();
         }
       }
     } catch (e) {
       console.error('Bus lookup error:', e);
     }
   }
 
   // BUG FIX: init map BEFORE setting display so the container has dimensions
   initMap();
 
   const mainUI = document.getElementById('mainUI');
   if (mainUI) mainUI.style.display = 'flex';
 
   const changeBusNavBtn = document.getElementById('changeBusNavBtn');
   if (changeBusNavBtn) changeBusNavBtn.style.display = 'none';
 
   await populateRouteInfoFromStudent();
 
   if (matchedDriverUID) {
     chosenBusUID = matchedDriverUID;
     await setupSchoolStudentStop(matchedBus);
     listenToBus(chosenBusUID, 'school');
   } else {
     showToast('Your bus is not live yet. Waiting…');
     listenForAssignedBusGoLive(assignedBusId);
   }
 
   const myBusLabel = document.getElementById('myAssignedBusLabel');
   if (myBusLabel) {
     myBusLabel.textContent = `You are assigned to Bus ${assignedBusId}`;
     myBusLabel.style.display = 'block';
   }
 }
 
 /** Listen for the assigned bus to come online (school mode) */
 function listenForAssignedBusGoLive(assignedBusId) {
   // BUG FIX: cancel any previous goLive listener
   if (goLiveUnsub) { goLiveUnsub(); goLiveUnsub = null; }
 
   const activeRef = ref(db, 'active_buses');
   goLiveUnsub = onValue(activeRef, async snap => {
     const all = snap.val() || {};
     for (const [driverUID, b] of Object.entries(all)) {
       if (!b?.isLive) continue;
       if (driverUID === assignedBusId || b.busId === assignedBusId || b.assignedBusId === assignedBusId) {
         // BUG FIX: stop listening before doing async work
         if (goLiveUnsub) { goLiveUnsub(); goLiveUnsub = null; }
         chosenBusUID = driverUID;
         await setupSchoolStudentStop(b);
         listenToBus(driverUID, 'school');
         showToast('Your bus just went live! 🚌');
         break;
       }
     }
   });
 }
 
 /** Write student pickup stop and place map marker — school mode */
 async function setupSchoolStudentStop(busData) {
   let stopCoords = {
     lat:  studentLat,
     lng:  studentLng,
     name: studentData?.location || 'Your home location'
   };
   let stopDistText = '';
 
   if (studentLat && studentLng && busData?.latitude) {
     const lastStop = busData.lastStop;
     if (lastStop && lastStop.lat && lastStop.lng) {
       const snapped = await snapToRoute(
         studentLat, studentLng,
         busData.latitude, busData.longitude,
         lastStop.lat, lastStop.lng
       );
       if (snapped) {
         stopCoords   = snapped;
         const d      = haversine(studentLat, studentLng, snapped.lat, snapped.lng);
         stopDistText = `${(d / 1000).toFixed(2)} km from your home`;
       }
     }
   } else if (studentData?.location) {
     stopCoords.name = studentData.location;
   }
 
   const myStopCard = document.getElementById('myStopCard');
   if (myStopCard) myStopCard.style.display = 'block';
   setElText('myStopName', stopCoords.name || '—');
   setElText('myStopDist', stopDistText);
 
   if (studentUID && chosenBusUID) {
     await set(ref(db, `bus_students/${chosenBusUID}/${studentUID}`), {
       lat:         stopCoords.lat  ?? null,
       lng:         stopCoords.lng  ?? null,
       name:        stopCoords.name || studentData?.location || '—',
       distText:    stopDistText,
       studentName,
       assignedBus: studentData?.assignedBusId || null
     });
   }
 
   if (map && stopCoords.lat && stopCoords.lng) {
     if (myStopMarker) { map.removeLayer(myStopMarker); myStopMarker = null; }
     myStopMarker = L.marker([stopCoords.lat, stopCoords.lng], { icon: getMyStopIcon() })
       .addTo(map)
       .bindPopup(`<b>Your Pickup Stop</b><br>${stopCoords.name}`);
     map.setView([stopCoords.lat, stopCoords.lng], 14);
   }
 }
 
 /** Populate route info sidebar from the student's assigned route */
 async function populateRouteInfoFromStudent() {
   if (!studentData?.routeId && !studentData?.assignedBusId) return;
 
   let route = null;
   try {
     if (studentData.routeId) {
       const routeSnap = await get(ref(db, `routes/${studentData.routeId}`));
       route = routeSnap.val();
     } else if (studentData.assignedBusId) {
       const busSnap = await get(ref(db, `buses/${studentData.assignedBusId}`));
       const busData = busSnap.val();
       if (busData?.routeId) {
         const routeSnap = await get(ref(db, `routes/${busData.routeId}`));
         route = routeSnap.val();
       }
     }
   } catch (e) {
     console.error('populateRouteInfoFromStudent error:', e);
   }
 
   if (!route) return;
 
   const stops = Array.isArray(route.stops) ? route.stops : [];
   const first = stops[0];
   const last  = stops[stops.length - 1];
 
   setElText('routeOrigin',      first ? (typeof first === 'object' ? first.name : first) : '—');
   setElText('routeDestination', last  ? (typeof last  === 'object' ? last.name  : last)  : '—');
   setElText('routeVehicle',     studentData.assignedBusId || '—');
 }
 
 /* ══════════════════════════════════════════════
    COLLEGE MODE
 ══════════════════════════════════════════════ */
 
 function bootCollegeMode() {
   const cbn = document.getElementById('changeBusNavBtn');
   if (cbn) cbn.style.display = 'inline-flex';
   const cbnm = document.getElementById('changeBusNavBtnMobile');
   if (cbnm) cbnm.style.display = 'block';
 
   showScreen('locationScreen');
   bindCollegeLocationScreen();
 }
 
 function bindCollegeLocationScreen() {
   const allowBtn = document.getElementById('allowLocationBtn');
   const skipBtn  = document.getElementById('skipLocation');
 
   if (allowBtn) allowBtn.onclick = requestLocationCollege;
   if (skipBtn)  skipBtn.onclick  = () => {
     hideScreen('locationScreen');
     showScreen('busSelectScreen');
     loadBuses();
   };
 }
 
 function requestLocationCollege() {
   if (!navigator.geolocation) {
     showToast('Geolocation not supported on this device.');
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
   }, err => {
     // BUG FIX: show specific error message based on code
     const msg = err.code === 1
       ? 'Location access denied. Showing all buses.'
       : 'Could not get location. Showing all buses.';
     showToast(msg);
     hideScreen('locationScreen');
     showScreen('busSelectScreen');
     loadBuses();
   }, { enableHighAccuracy: true, timeout: 10000 });
 }
 
 async function loadBuses() {
   const listEl = document.getElementById('busList');
   if (listEl) listEl.innerHTML = `<div class="no-buses"><i class="fa-solid fa-spinner fa-spin"></i><br>Looking for buses…</div>`;
 
   try {
     const snap  = await get(ref(db, 'active_buses'));
     const data  = snap.val() || {};
     const buses = Object.entries(data)
       .filter(([, b]) => b && b.isLive && b.latitude)
       .map(([uid, b]) => {
         const dist = (studentLat != null && studentLng != null)
           ? haversine(studentLat, studentLng, b.latitude, b.longitude)
           : null;
         return { uid, ...b, dist };
       })
       .sort((a, b) => (a.dist ?? 9999999) - (b.dist ?? 9999999));
 
     if (!listEl) return;
     if (!buses.length) {
       listEl.innerHTML = `<div class="no-buses"><i class="fa-solid fa-bus-simple"></i>No active buses right now.<br>Ask your driver to go live.</div>`;
       return;
     }
     listEl.innerHTML = '';
 
     if (studentLat != null) {
       setElText('busSelectSub', `${buses.length} bus${buses.length > 1 ? 'es' : ''} near your location`);
     }
 
     buses.forEach(bus => {
       const distText = bus.dist != null ? `${(bus.dist / 1000).toFixed(1)} km away` : '';
       const modeHtml = bus.tripMode
         ? `<span class="bus-mode-badge ${bus.tripMode}">${bus.tripMode === 'picking' ? '🟢 Picking' : '🔴 Dropping'}</span>`
         : '';
       const busNumber = bus.busNumber || bus.busId || 'Unknown';
       const card = document.createElement('div');
       card.className = 'bus-card';
       card.innerHTML = `
         <div class="bus-card-top">
           <div class="bus-card-icon"><i class="fa-solid fa-bus"></i></div>
           <div>
             <div class="bus-card-title">${bus.driverName || 'Bus'}</div>
             <div class="bus-card-sub">${busNumber}</div>
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
       listEl.appendChild(card);
     });
   } catch (e) {
     console.error('loadBuses error:', e);
     if (listEl) listEl.innerHTML = `<div class="no-buses"><i class="fa-solid fa-circle-exclamation"></i>Failed to load buses. Check your connection.</div>`;
   }
 }
 
 const refreshBusesBtn = document.getElementById('refreshBuses');
 if (refreshBusesBtn) refreshBusesBtn.addEventListener('click', loadBuses);
 
 async function selectBus(bus) {
   chosenBusUID = bus.uid;
 
   // BUG FIX: init map FIRST before showing mainUI so container has layout dimensions
   initMap();
 
   hideScreen('busSelectScreen');
   const mainUI = document.getElementById('mainUI');
   if (mainUI) mainUI.style.display = 'flex';
 
   const cbn = document.getElementById('changeBusNavBtn');
   if (cbn) cbn.style.display = 'inline-flex';
   const cbnm = document.getElementById('changeBusNavBtnMobile');
   if (cbnm) cbnm.style.display = 'block';
 
   let stopCoords   = { lat: studentLat, lng: studentLng, name: 'Your location' };
   let stopDistText = '';
 
   if (studentLat != null && studentLng != null && bus.lastStop?.lat && bus.lastStop?.lng) {
     try {
       const nearest = await snapToRoute(
         studentLat, studentLng,
         bus.latitude, bus.longitude,
         bus.lastStop.lat, bus.lastStop.lng
       );
       if (nearest) {
         stopCoords   = nearest;
         const d      = haversine(studentLat, studentLng, nearest.lat, nearest.lng);
         stopDistText = `${(d / 1000).toFixed(2)} km from your location`;
       }
     } catch (e) {
       console.error('selectBus snapToRoute error:', e);
     }
   }
 
   const myStopCard = document.getElementById('myStopCard');
   if (myStopCard) myStopCard.style.display = 'block';
   setElText('myStopName', stopCoords.name || '—');
   setElText('myStopDist', stopDistText);
 
   if (studentUID) {
     await set(ref(db, `bus_students/${chosenBusUID}/${studentUID}`), {
       lat:      stopCoords.lat ?? null,
       lng:      stopCoords.lng ?? null,
       name:     stopCoords.name,
       distText: stopDistText,
       studentName
     }).catch(console.error);
   }
 
   if (map && stopCoords.lat != null && stopCoords.lng != null) {
     if (myStopMarker) { map.removeLayer(myStopMarker); myStopMarker = null; }
     myStopMarker = L.marker([stopCoords.lat, stopCoords.lng], { icon: getMyStopIcon() })
       .addTo(map)
       .bindPopup(`<b>Your Pickup Stop</b><br>${stopCoords.name}`);
   }
 
   setElText('routeOrigin',      bus.firstStop?.name?.split(',')[0] || '—');
   setElText('routeDestination', bus.lastStop?.name?.split(',')[0]  || '—');
   setElText('routeVehicle',     bus.busNumber || bus.busId || '—');
 
   listenToBus(chosenBusUID, 'college');
 }
 
 /* ─────────────────────────────────────────
    LISTEN TO BUS  (shared by both modes)
 ───────────────────────────────────────── */
 function listenToBus(driverUID, mode) {
   // BUG FIX: always unsubscribe previous listener before attaching a new one
   if (busUnsubscribe) {
     busUnsubscribe();
     busUnsubscribe = null;
   }
 
   const busRef = ref(db, `active_buses/${driverUID}`);
   busUnsubscribe = onValue(busRef, snapshot => {
     const data      = snapshot.val();
     const pill      = document.getElementById('sPill');
     const dot       = document.getElementById('pulseDot');
     const badgeText = document.getElementById('mapBadgeText');
     const liveCard  = document.getElementById('liveInfoCard');
 
     if (data && data.isLive && data.latitude) {
       if (pill)      { pill.textContent = 'Live'; pill.classList.add('live'); }
       if (dot)       dot.classList.add('live');
       if (badgeText) badgeText.textContent = `${data.driverName || 'Bus'} is Live`;
       if (liveCard)  liveCard.style.display = 'block';
 
       // BUG FIX: safe speed calculation — data.speed can be null/undefined
       const speedKmh = (data.speed != null && !isNaN(data.speed))
         ? (data.speed * 3.6).toFixed(1) + ' km/h'
         : '— km/h';
       setElText('busSpeed',    speedKmh);
       setElText('busDriver',   data.driverName || '—');
       setElText('busTripMode', data.tripMode
         ? (data.tripMode === 'picking' ? '🟢 Picking' : '🔴 Dropping')
         : '—');
       setElText('busLastStop', data.lastStop?.name?.split(',')[0] || '—');
       if (data.timestamp) {
         setElText('busUpdated', new Date(data.timestamp)
           .toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }));
       }
 
       const pos = [data.latitude, data.longitude];
       if (!busMarker) {
         busMarker = L.marker(pos, { icon: getBusIcon() })
           .addTo(map)
           .bindPopup(`<b>${data.driverName || 'Bus'}</b><br>${data.busNumber || ''}`)
           .openPopup();
       } else {
         busMarker.setLatLng(pos);
       }
 
       if (data.lastStop?.lat && data.lastStop?.lng && map) {
         drawRouteOnMap(data.latitude, data.longitude, data.lastStop.lat, data.lastStop.lng);
       }
 
       if (firstFix && map) { map.setView(pos, 15); firstFix = false; }
 
     } else {
       if (pill)      { pill.textContent = 'Offline'; pill.classList.remove('live'); }
       if (dot)       dot.classList.remove('live');
       if (badgeText) badgeText.textContent = 'Bus is offline';
       if (liveCard)  liveCard.style.display = 'none';
 
       if (busMarker && map) { map.removeLayer(busMarker); busMarker = null; firstFix = true; }
       // BUG FIX: null guard before removing routeLayer
       if (routeLayer && map) { map.removeLayer(routeLayer); routeLayer = null; }
 
       if (mode === 'school') {
         showToast('Your bus went offline. Waiting for it to reconnect…');
       }
     }
   });
 }
 
 /* ─────────────────────────────────────────
    CHANGE BUS (college mode only)
 ───────────────────────────────────────── */
 async function changeBus() {
   if (chosenBusUID && studentUID) {
     await set(ref(db, `bus_students/${chosenBusUID}/${studentUID}`), null).catch(console.error);
   }
 
   if (busUnsubscribe) { busUnsubscribe(); busUnsubscribe = null; }
 
   chosenBusUID = null;
   firstFix     = true;
 
   if (map) {
     if (busMarker)    { map.removeLayer(busMarker);    busMarker    = null; }
     if (routeLayer)   { map.removeLayer(routeLayer);   routeLayer   = null; }
     if (myStopMarker) { map.removeLayer(myStopMarker); myStopMarker = null; }
   }
 
   const mainUI = document.getElementById('mainUI');
   if (mainUI) mainUI.style.display = 'none';
 
   const lc = document.getElementById('liveInfoCard');
   if (lc) lc.style.display = 'none';
   const ms = document.getElementById('myStopCard');
   if (ms) ms.style.display = 'none';
 
   const cbn = document.getElementById('changeBusNavBtn');
   if (cbn) cbn.style.display = 'none';
   const cbnm = document.getElementById('changeBusNavBtnMobile');
   if (cbnm) cbnm.style.display = 'none';
 
   showScreen('busSelectScreen');
   loadBuses();
 }
 
 const changeBusBtn = document.getElementById('changeBusBtn');
 if (changeBusBtn) changeBusBtn.addEventListener('click', changeBus);
 const changeBusNavBtn = document.getElementById('changeBusNavBtn');
 if (changeBusNavBtn) changeBusNavBtn.addEventListener('click', changeBus);
 const changeBusNavBtnMobile = document.getElementById('changeBusNavBtnMobile');
 if (changeBusNavBtnMobile) changeBusNavBtnMobile.addEventListener('click', changeBus);
 
 /* ─────────────────────────────────────────
    MAP
 ───────────────────────────────────────── */
 function initMap() {
   if (map) return;
   // BUG FIX: guard against missing map container
   const container = document.getElementById('map');
   if (!container) { console.warn('Map container #map not found'); return; }
   map = L.map('map').setView([20.5937, 78.9629], 5);
   L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
     attribution: '© OpenStreetMap contributors'
   }).addTo(map);
 }
 
 const locateMeBtn = document.getElementById('locateMe');
 if (locateMeBtn) locateMeBtn.addEventListener('click', () => {
   if (!map) { showToast('Map not ready yet.', true); return; }
   if (!navigator.geolocation) { showToast('Geolocation not supported.', true); return; }
   navigator.geolocation.getCurrentPosition(pos => {
     const { latitude, longitude } = pos.coords;
     if (!studentMarker) {
       studentMarker = L.marker([latitude, longitude], { icon: getStudentIcon() })
         .addTo(map).bindPopup('You are here');
     } else {
       studentMarker.setLatLng([latitude, longitude]);
     }
     map.setView([latitude, longitude], 15);
   }, err => {
     // BUG FIX: show proper error to user
     showToast(err.code === 1 ? 'Location access denied.' : 'Could not get your location.', true);
   });
 });
 
 async function drawRouteOnMap(fromLat, fromLng, toLat, toLng) {
   try {
     const url = `https://router.project-osrm.org/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=full&geometries=geojson`;
     const r   = await fetch(url);
     const d   = await r.json();
     if (d.code !== 'Ok' || !d.routes?.length) return;
     // BUG FIX: null guard before removing old routeLayer
     if (routeLayer && map) { map.removeLayer(routeLayer); routeLayer = null; }
     routeLayer = L.geoJSON(d.routes[0].geometry, {
       style: { color: '#4361ee', weight: 5, opacity: .8, lineCap: 'round', lineJoin: 'round' }
     }).addTo(map);
   } catch (e) { console.error('Route draw error:', e); }
 }
 
 /* ─────────────────────────────────────────
    OSRM SNAP TO ROUTE
 ───────────────────────────────────────── */
 async function snapToRoute(sLat, sLng, dLat, dLng, eLat, eLng) {
   try {
     const url  = `https://router.project-osrm.org/route/v1/driving/${dLng},${dLat};${eLng},${eLat}?overview=full&geometries=geojson`;
     const r    = await fetch(url);
     const d    = await r.json();
     if (d.code !== 'Ok' || !d.routes?.length) return null;
 
     const coords = d.routes[0].geometry.coordinates;
     let minDist  = Infinity, closest = null;
     coords.forEach(([lng, lat]) => {
       const dist = haversine(sLat, sLng, lat, lng);
       if (dist < minDist) { minDist = dist; closest = { lat, lng }; }
     });
     if (!closest) return null;
 
     const rev     = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${closest.lat}&lon=${closest.lng}`);
     const revData = await rev.json();
     closest.name  = revData.display_name
       ? revData.display_name.split(',').slice(0, 2).join(',')
       : 'Stop near route';
 
     return closest;
   } catch (e) {
     console.error('Snap to route failed:', e);
     return null;
   }
 }
 
 /* ─────────────────────────────────────────
    ICONS
 ───────────────────────────────────────── */
 function getBusIcon() {
   return L.divIcon({
     className: '',
     html: `<div style="background:#1a73e8;border-radius:50% 50% 50% 0;transform:rotate(-45deg);
       width:40px;height:40px;display:flex;align-items:center;justify-content:center;
       box-shadow:0 2px 8px rgba(0,0,0,.3);border:2px solid #fff;">
       <i class="fa-solid fa-bus" style="color:#fff;font-size:16px;transform:rotate(45deg);"></i>
     </div>`,
     iconSize: [40, 40], iconAnchor: [20, 40]
   });
 }
 function getStudentIcon() {
   return L.divIcon({
     className: '',
     html: `<div style="background:#e74c3c;border-radius:50%;width:14px;height:14px;
       border:2px solid #fff;box-shadow:0 0 0 4px rgba(231,76,60,.2);"></div>`,
     iconSize: [14, 14], iconAnchor: [7, 7]
   });
 }
 function getMyStopIcon() {
   return L.divIcon({
     className: '',
     html: `<div style="background:#4361ee;border-radius:50%;width:16px;height:16px;
       border:3px solid #fff;box-shadow:0 0 0 4px rgba(67,97,238,.25);"></div>`,
     iconSize: [16, 16], iconAnchor: [8, 8]
   });
 }