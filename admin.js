/* ─── FIREBASE CONFIG ─── */
const firebaseConfig = {
    apiKey: "AIzaSyCVTQr4SePTDMHe2H7VYKvDmvD0e71JpPg",
    authDomain: "bus-tracker-app-001.firebaseapp.com",
    databaseURL: "https://bus-tracker-app-001-default-rtdb.firebaseio.com",
    projectId: "bus-tracker-app-001",
    storageBucket: "bus-tracker-app-001.firebasestorage.app",
    messagingSenderId: "183488595656",
    appId: "1:183488595656:web:5e0f1cf3ca1601e08bc7fd"
  };
  firebase.initializeApp(firebaseConfig);
  const auth = firebase.auth();
  const db   = firebase.database();
  
  /* ─── IN-MEMORY STORE ─── */
  let store = { students:{}, drivers:{}, buses:{}, routes:{}, driverKeys:{}, activeBuses:{} };
  let institutionMode = 'school';
  
  /* ─── Map picker state ─── */
  let stopPickerMap     = null;
  let stopPickerMarkers = [];
  let pendingLatLng     = null;
  let pendingMarker     = null;
  let tempStops         = [];
  let tempTimings       = [];
  
  /* ─── Stop search state ─── */
  let stopSearchTimer   = null;
  let stopSearchActive  = false;
  
  /* ─── Bulk import state ─── */
  let bulkRows = [];
  
  /* ══════════════════════
     AUTH
  ══════════════════════ */
  auth.onAuthStateChanged(async (user) => {
    if (!user) {
      window.location.href = "login.html";
      return;
    }
  
    try {
      const adminRef  = db.ref(`admins/${user.uid}`);
      const adminSnap = await adminRef.once('value');
  
      if (!adminSnap.exists()) {
        alert("You are not authorized as admin!");
        await auth.signOut();
        window.location.href = "login.html";
        return;
      }
  
      document.getElementById('loginScreen').style.display = 'none';
      document.getElementById('adminShell').style.display  = 'block';
  
      const name = user.email.split('@')[0];
      document.getElementById('adminName').textContent     = name;
      document.getElementById('adminAvatar').textContent   = name[0].toUpperCase();
      document.getElementById('settingsEmail').textContent = user.email;
  
      initListeners();
      loadMode();
  
    } catch (error) {
      console.error(error);
      alert("Something went wrong!");
    }
  });
  
  function doLogin() {
    const email = document.getElementById('loginEmail').value.trim();
    const pass  = document.getElementById('loginPass').value;
    const err   = document.getElementById('loginErr');
    err.textContent = '';
    if (!email || !pass) { err.textContent = 'Please enter email and password.'; return; }
    auth.signInWithEmailAndPassword(email, pass)
      .then(cred => {
        if (cred.user.email !== 'admin@bustrack.com') {
          err.textContent = 'Access Denied! Not an admin account.';
          auth.signOut();
          return;
        }
        showToast('Welcome Admin!', 'success');
      })
      .catch(e => { err.textContent = e.message; });
  }
  
  function doLogout() { auth.signOut(); }
  
  /* ══════════════════════
     FIREBASE LISTENERS
  ══════════════════════ */
  function initListeners() {
    ['students','drivers','buses','routes','driverKeys'].forEach(key => {
      db.ref(key).on('value', snap => {
        store[key] = snap.val() || {};
        updateBadges();
        updateStats();
        refreshCurrentPage();
      });
    });
    db.ref('active_buses').on('value', snap => {
      store.activeBuses = snap.val() || {};
      updateStats();
      renderActiveBuses();
    });
    db.ref('settings/institutionType').on('value', snap => {
      institutionMode = snap.val() || 'school';
      applyMode();
    });
  }
  
  /* ══════════════════════
     NAVIGATION
  ══════════════════════ */
  let currentPage = 'dashboard';
  
  function navigate(page) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const pageEl = document.getElementById('page-' + page);
    if (!pageEl) return;
    pageEl.classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => {
      if (n.dataset.page === page) n.classList.add('active');
    });
    currentPage = page;
    closeSidebarMobile();
    refreshCurrentPage();
  }
  
  function refreshCurrentPage() {
    if (currentPage === 'students')   renderStudents();
    if (currentPage === 'drivers')    renderDrivers();
    if (currentPage === 'buses')      renderBuses();
    if (currentPage === 'routes')     renderRoutes();
    if (currentPage === 'driverkeys') renderKeys();
    if (currentPage === 'dashboard')  renderActiveBuses();
  }
  
  /* ══════════════════════
     STATS & BADGES
  ══════════════════════ */
  function updateStats() {
    const sc = Object.keys(store.students).length;
    const dc = Object.keys(store.drivers).length;
    const bc = Object.keys(store.buses).length;
    const ac = Object.values(store.activeBuses).filter(b => b && b.isLive).length;
    document.getElementById('statStudents').textContent  = sc;
    document.getElementById('statDrivers').textContent   = dc;
    document.getElementById('statBuses').textContent     = bc;
    document.getElementById('statActive').textContent    = ac;
    document.getElementById('statActiveSub').textContent = ac > 0 ? `${ac} bus${ac>1?'es':''} broadcasting` : 'No live buses';
  }
  
  function updateBadges() {
    document.getElementById('badgeStudents').textContent = Object.keys(store.students).length;
    document.getElementById('badgeDrivers').textContent  = Object.keys(store.drivers).length;
    document.getElementById('badgeBuses').textContent    = Object.keys(store.buses).length;
    document.getElementById('badgeRoutes').textContent   = Object.keys(store.routes).length;
  }
  
  /* ══════════════════════
     ACTIVE BUSES
  ══════════════════════ */
  function renderActiveBuses() {
    const el   = document.getElementById('activeBusesList');
    const live = Object.entries(store.activeBuses).filter(([,v]) => v && v.isLive);
    if (!live.length) {
      el.innerHTML = `<div class="empty-state"><i class="fas fa-satellite-dish"></i><p>No buses live right now</p></div>`;
      return;
    }
    el.innerHTML = live.map(([id, b]) => `
      <div class="activity-item">
        <div class="activity-icon green" style="background:rgba(34,197,94,.1);color:var(--success)">
          <i class="fas fa-bus"></i>
        </div>
        <div class="activity-text">
          <strong>${id}</strong> — ${b.driverName || 'Unknown Driver'}
          <div class="activity-time">
            <span class="badge badge-green"><span class="badge-dot"></span> Live</span>
            &nbsp;${b.tripMode || ''}
            ${b.latitude ? `· ${(+b.latitude).toFixed(4)}, ${(+b.longitude).toFixed(4)}` : ''}
          </div>
        </div>
      </div>`).join('');
  }
  
  /* ══════════════════════
     STUDENTS
  ══════════════════════ */
  function renderStudents() {
    const q   = (document.getElementById('studentSearch')?.value || '').toLowerCase();
    const bus = document.getElementById('studentBusFilter')?.value || '';
    const rows = Object.entries(store.students).filter(([,s]) => {
      const matchQ = !q || s.name?.toLowerCase().includes(q) || s.parentName?.toLowerCase().includes(q) || s.phone?.includes(q);
      const matchB = !bus || s.assignedBusId === bus;
      return matchQ && matchB;
    });
    const tbody = document.getElementById('studentsTableBody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><i class="fas fa-user-graduate"></i><p>No students found</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(([id, s]) => `
      <tr>
        <td><strong>${s.name||'—'}</strong></td>
        <td>${s.class||'—'}</td>
        <td>${s.parentName||'—'}</td>
        <td>${s.phone||'—'}</td>
        <td>${s.location||'—'}</td>
        <td>${s.assignedBusId
          ? `<span class="badge badge-yellow"><i class="fas fa-bus"></i> ${s.assignedBusId}</span>`
          : `<span class="badge badge-grey">Unassigned</span>`}</td>
        <td class="td-actions">
          <button class="btn btn-secondary btn-sm btn-icon js-edit-student" data-id="${id}" title="Edit"><i class="fas fa-pen"></i></button>
          <button class="btn btn-danger btn-sm btn-icon js-delete-student" data-id="${id}" title="Delete"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`).join('');
  }
  
  function populateBusDropdowns() {
    const busOpts = `<option value="">— None —</option>` +
      Object.keys(store.buses).map(k => `<option value="${k}">${k} — ${store.buses[k].busNumber||''}</option>`).join('');
    ['sBusId','assignBusSelect'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.innerHTML = busOpts;
    });
    const sf = document.getElementById('studentBusFilter');
    if (sf) sf.innerHTML = `<option value="">All Buses</option>` +
      Object.keys(store.buses).map(k => `<option value="${k}">${k}</option>`).join('');
    const bd = document.getElementById('bDriverId');
    if (bd) bd.innerHTML = `<option value="">— None —</option>` +
      Object.entries(store.drivers).map(([k,v]) => `<option value="${k}">${v.name||k}</option>`).join('');
    const br = document.getElementById('bRouteId');
    if (br) br.innerHTML = `<option value="">— None —</option>` +
      Object.entries(store.routes).map(([k,v]) => `<option value="${k}">${v.routeName||k}</option>`).join('');
  }
  
  function openModal(id) {
    populateBusDropdowns();
    document.getElementById(id).classList.add('open');
    if (id === 'routeModal') {
      setTimeout(initStopPickerMap, 150);
    }
  }
  
  function closeModal(id) {
    document.getElementById(id).classList.remove('open');
    if (id === 'studentModal') clearStudentForm();
    if (id === 'busModal')     clearBusForm();
    if (id === 'routeModal')   clearRouteForm();
  }
  
  function clearStudentForm() {
    ['studentEditId','sName','sClass','sParent','sPhone','sLocation'].forEach(i => {
      const el = document.getElementById(i);
      if (el) el.value = '';
    });
    const sBus = document.getElementById('sBusId');
    if (sBus) sBus.value = '';
    document.getElementById('studentModalTitle').textContent = 'Add Student';
    clearBulkPreview();
    const body = document.getElementById('bulkUploadBody');
    if (body) body.classList.remove('open');
    const header = document.querySelector('.bulk-upload-header');
    if (header) header.classList.remove('open');
  }
  
  function saveStudent() {
    const editId = document.getElementById('studentEditId').value;
    const name   = document.getElementById('sName').value.trim();
    if (!name) { showToast('Name is required', 'error'); return; }
    const data = {
      name,
      class:         document.getElementById('sClass').value.trim(),
      parentName:    document.getElementById('sParent').value.trim(),
      phone:         document.getElementById('sPhone').value.trim(),
      location:      document.getElementById('sLocation').value.trim(),
      assignedBusId: document.getElementById('sBusId').value || null
    };
    const ref = editId ? db.ref(`students/${editId}`) : db.ref('students').push();
    ref.set(data).then(() => {
      showToast(editId ? 'Student updated!' : 'Student added!', 'success');
      closeModal('studentModal');
      logActivity(`${editId ? 'Updated' : 'Added'} student: ${name}`, 'user-graduate', 'yellow');
    }).catch(e => showToast(e.message, 'error'));
  }
  
  function editStudent(id) {
    const s = store.students[id];
    if (!s) return;
    document.getElementById('studentEditId').value = id;
    document.getElementById('sName').value         = s.name || '';
    document.getElementById('sClass').value        = s.class || '';
    document.getElementById('sParent').value       = s.parentName || '';
    document.getElementById('sPhone').value        = s.phone || '';
    document.getElementById('sLocation').value     = s.location || '';
    populateBusDropdowns();
    document.getElementById('sBusId').value        = s.assignedBusId || '';
    document.getElementById('studentModalTitle').textContent = 'Edit Student';
    openModal('studentModal');
  }
  
  function deleteStudent(id) {
    if (!confirm('Delete this student?')) return;
    db.ref(`students/${id}`).remove().then(() => showToast('Student deleted', 'warning'));
  }
  
  /* ══════════════════════════════════════
     BULK STUDENT IMPORT
  ══════════════════════════════════════ */
  function toggleBulkUpload() {
    const body   = document.getElementById('bulkUploadBody');
    const header = document.querySelector('.bulk-upload-header');
    body.classList.toggle('open');
    header.classList.toggle('open');
  }
  
  function handleBulkFile(file) {
    if (!file) return;
    const ext = file.name.split('.').pop().toLowerCase();
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        let rows = [];
        if (ext === 'csv') {
          rows = parseCSV(e.target.result);
        } else if (ext === 'xlsx' || ext === 'xls') {
          const data = new Uint8Array(e.target.result);
          const wb   = XLSX.read(data, { type: 'array' });
          const ws   = wb.Sheets[wb.SheetNames[0]];
          rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        } else {
          showToast('Unsupported file type. Use .csv, .xlsx or .xls', 'error');
          return;
        }
        processBulkRows(rows);
      } catch(err) {
        showToast('Error reading file: ' + err.message, 'error');
      }
    };
    if (ext === 'csv') {
      reader.readAsText(file);
    } else {
      reader.readAsArrayBuffer(file);
    }
  }
  
  function parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g,'').toLowerCase());
    return lines.slice(1).filter(l => l.trim()).map(line => {
      const vals = [];
      let cur = '', inQ = false;
      for (let c of line) {
        if (c === '"') { inQ = !inQ; }
        else if (c === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
        else cur += c;
      }
      vals.push(cur.trim());
      const obj = {};
      headers.forEach((h, i) => { obj[h] = vals[i] !== undefined ? vals[i] : ''; });
      return obj;
    });
  }
  
  function normalizeRow(raw) {
    const get = (...keys) => {
      for (const k of keys) {
        const v = raw[k] || raw[k.toLowerCase()] || raw[k.toUpperCase()];
        if (v !== undefined && v !== '') return String(v).trim();
      }
      return '';
    };
    return {
      name:          get('name','Name','fullname','full_name','FullName'),
      class:         get('class','Class','grade','Grade','std','Std'),
      parentName:    get('parentname','parentName','parent','Parent','parent_name','ParentName'),
      phone:         get('phone','Phone','mobile','Mobile','contact','Contact'),
      location:      get('location','Location','address','Address'),
      assignedBusId: get('assignedbusid','assignedBusId','busid','busId','bus','Bus','bus_id')
    };
  }
  
  function processBulkRows(rawRows) {
    if (!rawRows.length) { showToast('No data found in file', 'error'); return; }
    bulkRows = rawRows.slice(0, 500).map((raw, i) => {
      const r   = normalizeRow(raw);
      const err = !r.name ? 'Missing name' : null;
      return { ...r, _row: i + 1, _err: err };
    });
    const validCount = bulkRows.filter(r => !r._err).length;
    const errCount   = bulkRows.filter(r => r._err).length;
    document.getElementById('bulkPreviewCount').textContent =
      `${validCount} valid · ${errCount} with errors — ${bulkRows.length} total`;
    const tbody = document.getElementById('bulkPreviewBody');
    tbody.innerHTML = bulkRows.map(r => `
      <tr class="${r._err ? 'row-error' : ''}">
        <td>${r._row}</td>
        <td>${r.name || '<em>—</em>'}</td>
        <td>${r.class || '—'}</td>
        <td>${r.parentName || '—'}</td>
        <td>${r.phone || '—'}</td>
        <td>${r.assignedBusId || '—'}</td>
        <td>
          ${r._err
            ? `<span class="bulk-row-status err"><i class="fas fa-times"></i> ${r._err}</span>`
            : `<span class="bulk-row-status ok"><i class="fas fa-check"></i> OK</span>`}
        </td>
      </tr>`).join('');
    document.getElementById('bulkPreviewWrap').classList.add('visible');
  }
  
  function clearBulkPreview() {
    bulkRows = [];
    document.getElementById('bulkPreviewWrap').classList.remove('visible');
    document.getElementById('bulkPreviewBody').innerHTML = '';
    document.getElementById('bulkImportProgress').classList.remove('visible');
    const fi = document.getElementById('bulkFileInput');
    if (fi) fi.value = '';
  }
  
  async function importBulkStudents() {
    const valid = bulkRows.filter(r => !r._err);
    if (!valid.length) { showToast('No valid rows to import', 'error'); return; }
    const progressWrap = document.getElementById('bulkImportProgress');
    const fill         = document.getElementById('bulkProgressFill');
    const label        = document.getElementById('bulkProgressLabel');
    progressWrap.classList.add('visible');
    let done = 0, failed = 0;
    for (const row of valid) {
      try {
        await db.ref('students').push({
          name:          row.name,
          class:         row.class || '',
          parentName:    row.parentName || '',
          phone:         row.phone || '',
          location:      row.location || '',
          assignedBusId: row.assignedBusId || null
        });
        done++;
      } catch(e) {
        failed++;
      }
      const pct = Math.round(((done + failed) / valid.length) * 100);
      fill.style.width  = pct + '%';
      label.textContent = `Imported ${done} / ${valid.length}${failed ? ` (${failed} failed)` : ''}…`;
      await new Promise(r => setTimeout(r, 30));
    }
    label.textContent = `Done! Imported ${done} students${failed ? `, ${failed} failed` : ''}.`;
    showToast(`Bulk import complete: ${done} students added`, 'success');
    logActivity(`Bulk imported ${done} students`, 'user-graduate', 'yellow');
    setTimeout(() => {
      clearBulkPreview();
      closeModal('studentModal');
    }, 1500);
  }
  
  function downloadTemplate() {
    const csv  = `name,class,parentName,phone,location,assignedBusId\nRiya Sharma,9-A,Rajesh Sharma,9876543210,Sadar Bazaar,BUS001\nAman Gupta,10-B,Sunita Gupta,9823456789,Civil Lines,BUS002\n`;
    const blob = new Blob([csv], { type: 'text/csv' });
    const a    = document.createElement('a');
    a.href     = URL.createObjectURL(blob);
    a.download = 'students_template.csv';
    a.click();
  }
  
  /* ══════════════════════
     DRIVERS
  ══════════════════════ */
  function renderDrivers() {
    const q      = (document.getElementById('driverSearch')?.value || '').toLowerCase();
    const status = document.getElementById('driverStatusFilter')?.value || '';
    const rows   = Object.entries(store.drivers).filter(([,d]) => {
      const matchQ = !q || d.name?.toLowerCase().includes(q) || d.phone?.includes(q);
      const matchS = !status
        || (status === 'verified' && d.isVerified)
        || (status === 'pending'  && !d.isVerified);
      return matchQ && matchS;
    });
    const tbody = document.getElementById('driversTableBody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-id-card"></i><p>No drivers found</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(([id, d]) => `
      <tr>
        <td><strong>${d.name||'—'}</strong></td>
        <td>${d.phone||'—'}</td>
        <td><span style="font-family:'Courier New',monospace;font-size:.83rem">${d.driverKey||'—'}</span></td>
        <td>${d.assignedBusId
          ? `<span class="badge badge-yellow"><i class="fas fa-bus"></i> ${d.assignedBusId}</span>`
          : `<span class="badge badge-grey">Not Assigned</span>`}</td>
        <td>${d.isVerified
          ? `<span class="badge badge-green"><span class="badge-dot"></span> Verified</span>`
          : `<span class="badge badge-red"><span class="badge-dot"></span> Pending</span>`}</td>
        <td class="td-actions">
          ${!d.isVerified
            ? `<button class="btn btn-success btn-sm js-verify-driver" data-id="${id}"><i class="fas fa-check"></i> Verify</button>`
            : `<button class="btn btn-secondary btn-sm btn-icon" disabled title="Already verified"><i class="fas fa-check-circle"></i></button>`}
          <button class="btn btn-secondary btn-sm js-assign-bus" data-id="${id}"><i class="fas fa-bus"></i> Assign Bus</button>
        </td>
      </tr>`).join('');
  }
  
  function verifyDriver(id) {
    db.ref(`drivers/${id}/isVerified`).set(true).then(() => {
      showToast('Driver verified!', 'success');
      logActivity(`Verified driver: ${store.drivers[id]?.name||id}`, 'id-card', 'blue');
    });
  }
  
  function openAssignModal(driverId) {
    document.getElementById('assignDriverId').value = driverId;
    populateBusDropdowns();
    const current = store.drivers[driverId]?.assignedBusId;
    if (current) document.getElementById('assignBusSelect').value = current;
    document.getElementById('assignModal').classList.add('open');
  }
  
  function confirmAssign() {
    const driverId = document.getElementById('assignDriverId').value;
    const busId    = document.getElementById('assignBusSelect').value;
    const updates  = {};
    const oldBus   = store.drivers[driverId]?.assignedBusId;
    if (oldBus && oldBus !== busId) updates[`buses/${oldBus}/driverId`] = null;
    updates[`drivers/${driverId}/assignedBusId`] = busId || null;
    if (busId) updates[`buses/${busId}/driverId`] = driverId;
    db.ref().update(updates).then(() => {
      showToast('Assignment updated!', 'success');
      closeModal('assignModal');
      logActivity(`Assigned bus ${busId||'None'} to driver ${store.drivers[driverId]?.name||driverId}`, 'link', 'green');
    }).catch(e => showToast(e.message, 'error'));
  }
  
  /* ══════════════════════
     BUSES
  ══════════════════════ */
  function renderBuses() {
    const rows  = Object.entries(store.buses);
    const tbody = document.getElementById('busesTableBody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><i class="fas fa-bus"></i><p>No buses yet</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(([id, b]) => {
      const isLive = store.activeBuses[id]?.isLive;
      return `<tr${isLive ? ' class="live-row"' : ''}>
        <td>${isLive ? '<span class="live-indicator"></span>' : ''}<strong>${id}</strong></td>
        <td>${b.busNumber||'—'}</td>
        <td>${b.driverId
          ? `<span class="badge badge-blue"><i class="fas fa-user"></i> ${store.drivers[b.driverId]?.name||b.driverId}</span>`
          : `<span class="badge badge-grey">Unassigned</span>`}</td>
        <td>${b.routeId
          ? `<span class="badge badge-yellow"><i class="fas fa-route"></i> ${store.routes[b.routeId]?.routeName||b.routeId}</span>`
          : `<span class="badge badge-grey">No Route</span>`}</td>
        <td>${isLive
          ? `<span class="badge badge-green"><span class="badge-dot"></span> Live</span>`
          : `<span class="badge badge-grey"><span class="badge-dot"></span> Offline</span>`}</td>
        <td class="td-actions">
          <button class="btn btn-secondary btn-sm btn-icon js-edit-bus" data-id="${id}"><i class="fas fa-pen"></i></button>
          <button class="btn btn-danger btn-sm btn-icon js-delete-bus" data-id="${id}"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
  }
  
  function clearBusForm() {
    ['busEditId','bId','bNumber'].forEach(i => document.getElementById(i).value = '');
    document.getElementById('bDriverId').value = '';
    document.getElementById('bRouteId').value  = '';
    document.getElementById('busModalTitle').textContent = 'Add Bus';
    document.getElementById('bId').disabled = false;
  }
  
  function saveBus() {
    const editId = document.getElementById('busEditId').value;
    const busId  = document.getElementById('bId').value.trim().toUpperCase();
    const busNum = document.getElementById('bNumber').value.trim();
    if (!busId || !busNum) { showToast('Bus ID and Number required', 'error'); return; }
    if (!editId && store.buses[busId]) { showToast('Bus ID already exists', 'error'); return; }
    const driverId = document.getElementById('bDriverId').value;
    const routeId  = document.getElementById('bRouteId').value;
    const data     = { busNumber: busNum, driverId: driverId||null, routeId: routeId||null };
    const updates  = {};
    updates[`buses/${busId}`] = data;
    if (driverId) updates[`drivers/${driverId}/assignedBusId`] = busId;
    if (driverId && routeId && store.routes[routeId]) {
      updates[`drivers/${driverId}/assignedRoute`] = store.routes[routeId];
    }
    db.ref().update(updates).then(() => {
      showToast(editId ? 'Bus updated!' : 'Bus added!', 'success');
      closeModal('busModal');
      logActivity(`${editId ? 'Updated':'Added'} bus: ${busId}`, 'bus', 'purple');
    }).catch(e => showToast(e.message, 'error'));
  }
  
  function editBus(id) {
    const b = store.buses[id];
    if (!b) return;
    document.getElementById('busEditId').value = id;
    document.getElementById('bId').value       = id;
    document.getElementById('bId').disabled    = true;
    document.getElementById('bNumber').value   = b.busNumber || '';
    populateBusDropdowns();
    document.getElementById('bDriverId').value = b.driverId||'';
    document.getElementById('bRouteId').value  = b.routeId||'';
    document.getElementById('busModalTitle').textContent = 'Edit Bus';
    openModal('busModal');
  }
  
  function deleteBus(id) {
    if (!confirm(`Delete bus ${id}?`)) return;
    db.ref(`buses/${id}`).remove().then(() => showToast('Bus deleted', 'warning'));
  }
  
  /* ══════════════════════════════════════
     ROUTES  —  MAP-BASED STOP PICKER
  ══════════════════════════════════════ */
  function initStopPickerMap() {
    const container = document.getElementById('stopMapContainer');
    if (!container) return;
    if (stopPickerMap) {
      stopPickerMap.off();
      stopPickerMap.remove();
      stopPickerMap = null;
    }
    stopPickerMarkers = [];
    const defaultLat = 60.8974;
    const defaultLng = 78.0880;
    stopPickerMap = L.map('stopMapContainer').setView([defaultLat, defaultLng], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors'
    }).addTo(stopPickerMap);
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        stopPickerMap.setView([pos.coords.latitude, pos.coords.longitude], 14);
      }, () => {});
    }
    stopPickerMap.on('click', function(e) {
      if (pendingMarker) { pendingMarker.remove(); pendingMarker = null; }
      pendingLatLng = e.latlng;
      pendingMarker = L.marker(e.latlng, {
        icon: L.divIcon({
          html: `<div style="background:#f59e0b;width:28px;height:28px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
          iconSize: [28, 28], iconAnchor: [14, 28]
        }),
        draggable: true
      }).addTo(stopPickerMap);
      pendingMarker.on('dragend', ev => { pendingLatLng = ev.target.getLatLng(); });
      document.getElementById('pendingPinRow').style.display = 'block';
      document.getElementById('pendingStopName').value = '';
      document.getElementById('pendingStopName').focus();
      container.classList.add('pin-placed');
      reverseGeocodeForStop(e.latlng.lat, e.latlng.lng);
    });
    renderStopMarkers();
  }
  
  function reverseGeocodeForStop(lat, lng) {
    fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=16`)
      .then(r => r.json())
      .then(d => {
        const nameInput = document.getElementById('pendingStopName');
        if (nameInput && !nameInput.value && d.display_name) {
          const parts  = d.display_name.split(',');
          nameInput.value = parts.slice(0, 2).join(',').trim();
        }
      }).catch(() => {});
  }
  
  /* ── Stop Search (Nominatim) ── */
  let _stopSearchDebounce = null;
  
  function onStopSearchInput() {
    const inp = document.getElementById('stopSearchInput');
    const val = inp.value.trim();
    const clr = document.getElementById('stopSearchClear');
    if (clr) clr.classList.toggle('visible', val.length > 0);
    clearTimeout(_stopSearchDebounce);
    const res = document.getElementById('stopSearchResults');
    if (val.length < 3) {
      res.classList.remove('visible');
      res.innerHTML = '';
      return;
    }
    res.innerHTML = `<div class="search-result-spinner"><i class="fas fa-spinner fa-spin"></i> Searching…</div>`;
    res.classList.add('visible');
    _stopSearchDebounce = setTimeout(() => {
      searchStopsNominatim(val);
    }, 420);
  }
  
  function searchStopsNominatim(q) {
    let lat = 27.8974;
    let lon = 78.0880;
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(pos => {
        fetchNearby(q, pos.coords.latitude, pos.coords.longitude);
      }, () => {
        fetchNearby(q, lat, lon);
      });
    } else {
      fetchNearby(q, lat, lon);
    }
  }
  
  function fetchNearby(q, lat, lon) {
    const res     = document.getElementById('stopSearchResults');
    const viewbox = `${lon-0.1},${lat-0.1},${lon+0.1},${lat+0.1}`;
    const url     = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=6&viewbox=${viewbox}&bounded=1&countrycodes=in`;
    fetch(url)
      .then(r => r.json())
      .then(data => {
        if (!data.length) {
          res.innerHTML = `<div>No nearby results. Try map pin.</div>`;
          return;
        }
        res.innerHTML = data.map(item => {
          const parts = item.display_name.split(',');
          const main  = parts[0];
          const sub   = parts.slice(1, 3).join(',');
          return `
          <div class="search-result-item js-select-stop"
            data-lat="${item.lat}" data-lng="${item.lon}" data-name="${escapeAttr(item.display_name)}">
            <i class="fas fa-map-marker-alt"></i>
            <div>
              <div>${main}</div>
              <small>${sub}</small>
            </div>
          </div>`;
        }).join('');
      });
  }
  
  function selectSearchedStop(lat, lng, fullName) {
    const parts = fullName.split(',');
    const name  = parts.slice(0, 2).join(',').trim();
    const stop  = { name, lat: +parseFloat(lat).toFixed(6), lng: +parseFloat(lng).toFixed(6) };
    tempStops.push(stop);
    if (stopPickerMap) {
      stopPickerMap.setView([lat, lng], 15);
    }
    clearStopSearch();
    renderStopMarkers();
    renderStopTags();
    showToast(`Stop added: ${name}`, 'success');
  }
  
  function clearStopSearch() {
    const inp = document.getElementById('stopSearchInput');
    const res = document.getElementById('stopSearchResults');
    const clr = document.getElementById('stopSearchClear');
    if (inp) inp.value = '';
    if (res) { res.innerHTML = ''; res.classList.remove('visible'); }
    if (clr) clr.classList.remove('visible');
  }
  
  function escHTML(str) {
    return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }
  
  function escapeAttr(str) {
    return str.replace(/'/g,"\\'").replace(/"/g,'\\"');
  }
  
  function confirmPendingStop() {
    const name = document.getElementById('pendingStopName').value.trim();
    if (!name) { showToast('Enter a stop name', 'error'); return; }
    if (!pendingLatLng) { showToast('Click the map to place a pin first', 'error'); return; }
    const stop = { name, lat: +pendingLatLng.lat.toFixed(6), lng: +pendingLatLng.lng.toFixed(6) };
    tempStops.push(stop);
    if (pendingMarker) { pendingMarker.remove(); pendingMarker = null; }
    pendingLatLng = null;
    document.getElementById('pendingPinRow').style.display = 'none';
    document.getElementById('stopMapContainer').classList.remove('pin-placed');
    renderStopMarkers();
    renderStopTags();
  }
  
  function cancelPendingStop() {
    if (pendingMarker) { pendingMarker.remove(); pendingMarker = null; }
    pendingLatLng = null;
    document.getElementById('pendingPinRow').style.display = 'none';
    const mc = document.getElementById('stopMapContainer');
    if (mc) mc.classList.remove('pin-placed');
  }
  
  function renderStopMarkers() {
    stopPickerMarkers.forEach(m => m.remove());
    stopPickerMarkers = [];
    if (!stopPickerMap) return;
    tempStops.forEach((stop, i) => {
      const isFirst = i === 0;
      const isLast  = i === tempStops.length - 1;
      const color   = isFirst ? '#22c55e' : isLast ? '#ef4444' : '#4361ee';
      const marker  = L.marker([stop.lat, stop.lng], {
        icon: L.divIcon({
          html: `<div style="background:${color};color:#fff;width:30px;height:30px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.3);">${i+1}</div>`,
          iconSize: [30, 30], iconAnchor: [15, 15]
        })
      }).addTo(stopPickerMap);
      marker.bindPopup(`<b>${i+1}. ${stop.name}</b><br><small>${stop.lat.toFixed(5)}, ${stop.lng.toFixed(5)}</small>`);
      stopPickerMarkers.push(marker);
    });
    if (tempStops.length >= 2) {
      const bounds = L.latLngBounds(tempStops.map(s => [s.lat, s.lng]));
      stopPickerMap.fitBounds(bounds, { padding: [40, 40] });
    }
  }
  
  function renderStopTags() {
    const el = document.getElementById('stopsList');
    if (!el) return;
    if (!tempStops.length) { el.innerHTML = ''; return; }
    el.innerHTML = tempStops.map((s, i) => `
      <span class="stop-tag">
        <span class="stop-order">${i+1}</span>
        ${i===0 ? '<i class="fas fa-flag-checkered" style="color:#22c55e;font-size:.75rem"></i>' : ''}
        ${i===tempStops.length-1 && tempStops.length>1 ? '<i class="fas fa-map-pin" style="color:#ef4444;font-size:.75rem"></i>' : ''}
        <span>${s.name}</span>
        <span class="stop-coord">${s.lat.toFixed(4)},${s.lng.toFixed(4)}</span>
        <button class="stop-remove js-remove-stop" data-index="${i}" title="Remove"><i class="fas fa-times"></i></button>
      </span>`).join('');
  }
  
  function removeStop(i) {
    tempStops.splice(i, 1);
    renderStopMarkers();
    renderStopTags();
  }
  
  /* ── TIMINGS ── */
  function addTiming() {
    tempTimings.push({ label: '', time: '' });
    renderTimings();
  }
  
  function removeTiming(i) {
    tempTimings.splice(i, 1);
    renderTimings();
  }
  
  function renderTimings() {
    const el = document.getElementById('timingsList');
    if (!el) return;
    if (!tempTimings.length) { el.innerHTML = ''; return; }
    el.innerHTML = tempTimings.map((t, i) => `
      <div class="timing-row">
        <span class="timing-label">Trip ${i+1}</span>
        <input type="text" placeholder="Label (e.g. Morning, Evening…)"
          value="${t.label}" data-timing-index="${i}" data-timing-field="label"
          class="js-timing-input"
          style="flex:1;"/>
        <input type="time" value="${t.time}"
          data-timing-index="${i}" data-timing-field="time"
          class="js-timing-input"/>
        <button class="timing-remove js-remove-timing" data-index="${i}" title="Remove timing">
          <i class="fas fa-trash"></i>
        </button>
      </div>`).join('');
  }
  
  /* ── SAVE / EDIT / DELETE ROUTE ── */
  function clearRouteForm() {
    ['routeEditId','rId','rName'].forEach(i => {
      const el = document.getElementById(i);
      if (el) el.value = '';
    });
    const rIdEl = document.getElementById('rId');
    if (rIdEl) rIdEl.disabled = false;
    tempStops   = [];
    tempTimings = [];
    renderStopTags();
    renderTimings();
    clearStopSearch();
    cancelPendingStop();
    document.getElementById('routeModalTitle').textContent = 'Add Route';
    if (stopPickerMap) { stopPickerMap.off(); stopPickerMap.remove(); stopPickerMap = null; }
    stopPickerMarkers = [];
  }
  
  function saveRoute() {
    const editId = document.getElementById('routeEditId').value;
    const rId    = document.getElementById('rId').value.trim().toUpperCase().replace(/\s+/g,'_');
    const rName  = document.getElementById('rName').value.trim();
    if (!rId || !rName) { showToast('Route ID and Name required', 'error'); return; }
    if (tempStops.length < 2) { showToast('Add at least 2 stops', 'error'); return; }
    const routeData = {
      routeName: rName,
      stops:     tempStops,
      timings:   tempTimings.filter(t => t.time)
    };
    db.ref(`routes/${rId}`).set(routeData).then(() => {
      const busUpdates = {};
      Object.entries(store.buses).forEach(([busId, bus]) => {
        if (bus.routeId === rId && bus.driverId) {
          busUpdates[`drivers/${bus.driverId}/assignedRoute`] = routeData;
        }
      });
      if (Object.keys(busUpdates).length) {
        db.ref().update(busUpdates);
      }
      showToast(editId ? 'Route updated!' : 'Route added!', 'success');
      closeModal('routeModal');
      logActivity(`${editId ? 'Updated':'Added'} route: ${rName} (${tempStops.length} stops)`, 'route', 'yellow');
    }).catch(e => showToast(e.message, 'error'));
  }
  
  function renderRoutes() {
    const rows  = Object.entries(store.routes);
    const tbody = document.getElementById('routesTableBody');
    if (!tbody) return;
    if (!rows.length) {
      tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><i class="fas fa-route"></i><p>No routes yet</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = rows.map(([id, r]) => {
      const stops   = Array.isArray(r.stops)   ? r.stops   : [];
      const timings = Array.isArray(r.timings) ? r.timings : [];
      return `<tr>
        <td><code style="background:#f3f4f6;padding:3px 8px;border-radius:6px;font-size:.82rem">${id}</code></td>
        <td><strong>${r.routeName||'—'}</strong></td>
        <td>
          <div style="display:flex;flex-wrap:wrap;gap:4px">
            ${stops.map((s, i) => {
              const obj = typeof s === 'object' ? s : { name: s };
              const isFirst = i === 0, isLast = i === stops.length-1;
              return `<span class="stop-tag" style="font-size:.76rem;padding:3px 8px;">
                <span class="stop-order" style="width:14px;height:14px;font-size:.6rem">${i+1}</span>
                ${isFirst ? '<i class="fas fa-circle" style="color:#22c55e;font-size:.5rem"></i>' : ''}
                ${isLast  ? '<i class="fas fa-map-pin" style="color:#ef4444;font-size:.6rem"></i>' : ''}
                ${obj.name}
              </span>`;
            }).join('') || '<span style="color:var(--grey);font-size:.82rem">No stops</span>'}
          </div>
        </td>
        <td>
          ${timings.map(t => `<span class="timing-chip"><i class="fas fa-clock"></i>${t.label ? t.label+' · ':''}<b>${t.time}</b></span>`).join('') || '<span style="color:var(--grey);font-size:.82rem">No timings</span>'}
        </td>
        <td class="td-actions">
          <button class="btn btn-secondary btn-sm btn-icon js-edit-route" data-id="${id}"><i class="fas fa-pen"></i></button>
          <button class="btn btn-danger btn-sm btn-icon js-delete-route" data-id="${id}"><i class="fas fa-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
  }
  
  function editRoute(id) {
    const r = store.routes[id];
    if (!r) return;
    document.getElementById('routeEditId').value = id;
    document.getElementById('rId').value         = id;
    document.getElementById('rId').disabled      = true;
    document.getElementById('rName').value       = r.routeName || '';
    tempStops   = Array.isArray(r.stops)   ? r.stops.map(s => typeof s === 'object' ? s : {name:s,lat:0,lng:0}) : [];
    tempTimings = Array.isArray(r.timings) ? [...r.timings] : [];
    renderStopTags();
    renderTimings();
    document.getElementById('routeModalTitle').textContent = 'Edit Route';
    openModal('routeModal');
  }
  
  function deleteRoute(id) {
    if (!confirm(`Delete route ${id}?`)) return;
    db.ref(`routes/${id}`).remove().then(() => showToast('Route deleted', 'warning'));
  }
  
  /* ══════════════════════
     DRIVER KEYS
  ══════════════════════ */
  function generateKeys() {
    const count   = Object.keys(store.driverKeys).length;
    const updates = {};
    for (let i = 1; i <= 5; i++) {
      const key = `DRV${String(count + i).padStart(3,'0')}`;
      if (!store.driverKeys[key]) updates[`driverKeys/${key}`] = { isUsed: false };
    }
    db.ref().update(updates).then(() => {
      showToast('5 new keys generated!', 'success');
      logActivity('Generated 5 new driver keys', 'key', 'yellow');
    });
  }
  
  function renderKeys() {
    const el   = document.getElementById('keysContainer');
    const keys = Object.entries(store.driverKeys);
    if (!keys.length) {
      el.innerHTML = `<div class="empty-state" style="width:100%"><i class="fas fa-key"></i><p>No keys generated yet.</p></div>`;
      return;
    }
    el.innerHTML = keys.map(([k, v]) => `
      <span class="key-chip ${v.isUsed ? 'used':'available'}">
        <i class="fas fa-key" style="font-size:.75rem"></i> ${k}
        ${v.isUsed
          ? `<span style="font-size:.7rem;font-weight:600;color:var(--grey)">Used</span>`
          : `<button class="js-delete-key" data-key="${k}" style="background:none;border:none;cursor:pointer;color:var(--error);font-size:.7rem;padding:0 0 0 4px" title="Delete key"><i class="fas fa-trash"></i></button>`}
      </span>`).join('');
  }
  
  function deleteKey(key) {
    if (!confirm(`Delete key ${key}?`)) return;
    db.ref(`driverKeys/${key}`).remove().then(() => showToast('Key deleted', 'warning'));
  }
  
  /* ══════════════════════
     MODE
  ══════════════════════ */
  function loadMode() {
    db.ref('settings/institutionType').once('value').then(snap => {
      institutionMode = snap.val() || 'school';
      applyMode();
    });
  }
  
  function applyMode() {
    const isSchool = institutionMode === 'school';
    document.getElementById('modeLabel').textContent       = isSchool ? 'School Mode' : 'College Mode';
    document.getElementById('modeSwitch').checked          = !isSchool;
    document.getElementById('modeSwitchLabel').innerHTML   = `Current: <strong>${isSchool ? 'School Mode':'College Mode'}</strong>`;
    document.getElementById('busRequiredLabel').textContent = isSchool ? '(required)' : '(optional in college mode)';
  }
  
  function saveMode() {
    const isCollege = document.getElementById('modeSwitch').checked;
    const mode = isCollege ? 'college' : 'school';
    db.ref('settings/institutionType').set(mode).then(() => {
      showToast(`Switched to ${isCollege ? 'College':'School'} Mode`, 'success');
    });
  }
  
  function toggleMode() {
    const sw = document.getElementById('modeSwitch');
    sw.checked = !sw.checked;
    saveMode();
  }
  
  /* ══════════════════════
     ACTIVITY LOG
  ══════════════════════ */
  const activityLog = [];
  
  function logActivity(text, icon, color) {
    activityLog.unshift({ text, icon, color, time: new Date() });
    if (activityLog.length > 10) activityLog.pop();
    renderActivity();
  }
  
  function renderActivity() {
    const el = document.getElementById('activityFeed');
    if (!el) return;
    el.innerHTML = activityLog.map(a => `
      <div class="activity-item">
        <div class="activity-icon ${a.color}" style="background:rgba(255,193,7,0.1);color:var(--primary-dark)">
          <i class="fas fa-${a.icon}"></i>
        </div>
        <div class="activity-text">
          ${a.text}
          <div class="activity-time">${timeAgo(a.time)}</div>
        </div>
      </div>`).join('');
  }
  
  function timeAgo(d) {
    const s = Math.floor((new Date() - d) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return `${Math.floor(s/60)}m ago`;
    return `${Math.floor(s/3600)}h ago`;
  }
  
  /* ══════════════════════
     TOAST
  ══════════════════════ */
  let toastTimer;
  
  function showToast(msg, type = '') {
    const t = document.getElementById('toast');
    if (!t) return;
    t.className = `toast ${type}`;
    t.innerHTML = `<i class="fas fa-${type==='success'?'check-circle':type==='error'?'exclamation-circle':'info-circle'}"></i> ${msg}`;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
  }
  
  /* ══════════════════════
     MOBILE SIDEBAR
  ══════════════════════ */
  function toggleSidebar() {
    document.getElementById('sidebar').classList.toggle('open');
    document.getElementById('sidebarOverlay').classList.toggle('open');
  }
  
  function closeSidebarMobile() {
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebarOverlay').classList.remove('open');
  }
  
  /* ══════════════════════════════════════
     EVENT LISTENERS  (replaces all inline
     onclick / oninput attributes)
  ══════════════════════════════════════ */
  document.addEventListener('DOMContentLoaded', () => {
  
    /* ── Login ── */
    document.getElementById('loginEmail')?.addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
    document.getElementById('loginPass')?.addEventListener('keydown',  e => { if (e.key === 'Enter') doLogin(); });
    document.querySelector('.login-btn')?.addEventListener('click', doLogin);
  
    /* ── Topbar ── */
    document.querySelector('.menu-toggle')?.addEventListener('click', toggleSidebar);
    document.querySelector('.mode-toggle')?.addEventListener('click', toggleMode);
    document.querySelector('.logout-btn')?.addEventListener('click', doLogout);
  
    /* ── Sidebar overlay ── */
    document.getElementById('sidebarOverlay')?.addEventListener('click', closeSidebarMobile);
  
    /* ── Sidebar navigation ── */
    document.querySelectorAll('.nav-item[data-page]').forEach(el => {
      el.addEventListener('click', () => navigate(el.dataset.page));
    });
  
    /* ── Students page ── */
    document.querySelector('[data-open-modal="studentModal"]')?.addEventListener('click', () => openModal('studentModal'));
    document.getElementById('studentSearch')?.addEventListener('input', renderStudents);
    document.getElementById('studentBusFilter')?.addEventListener('change', renderStudents);
  
    /* ── Student modal ── */
    document.querySelector('[data-close-modal="studentModal"]')?.addEventListener('click', () => closeModal('studentModal'));
    document.querySelector('[data-save="student"]')?.addEventListener('click', saveStudent);
    document.querySelector('.bulk-upload-header')?.addEventListener('click', toggleBulkUpload);
    document.getElementById('bulkFileInput')?.addEventListener('change', e => handleBulkFile(e.target.files[0]));
    document.querySelector('[data-action="downloadTemplate"]')?.addEventListener('click', downloadTemplate);
    document.querySelector('[data-action="importBulk"]')?.addEventListener('click', importBulkStudents);
    document.querySelector('[data-action="clearBulk"]')?.forEach?.(el => el.addEventListener('click', clearBulkPreview));
    // Multiple clear-bulk buttons
    document.querySelectorAll('[data-action="clearBulk"]').forEach(el => el.addEventListener('click', clearBulkPreview));
  
    /* ── Drivers page ── */
    document.getElementById('driverSearch')?.addEventListener('input', renderDrivers);
    document.getElementById('driverStatusFilter')?.addEventListener('change', renderDrivers);
  
    /* ── Buses page ── */
    document.querySelector('[data-open-modal="busModal"]')?.addEventListener('click', () => openModal('busModal'));
    document.querySelector('[data-close-modal="busModal"]')?.addEventListener('click', () => closeModal('busModal'));
    document.querySelector('[data-save="bus"]')?.addEventListener('click', saveBus);
  
    /* ── Routes page ── */
    document.querySelector('[data-open-modal="routeModal"]')?.addEventListener('click', () => openModal('routeModal'));
    document.querySelector('[data-close-modal="routeModal"]')?.addEventListener('click', () => closeModal('routeModal'));
    document.querySelector('[data-save="route"]')?.addEventListener('click', saveRoute);
  
    /* ── Stop search ── */
    document.getElementById('stopSearchInput')?.addEventListener('input', onStopSearchInput);
    document.getElementById('stopSearchClear')?.addEventListener('click', clearStopSearch);
  
    /* ── Pending stop pin ── */
    document.querySelector('[data-action="confirmStop"]')?.addEventListener('click', confirmPendingStop);
    document.querySelector('[data-action="cancelStop"]')?.addEventListener('click', cancelPendingStop);
  
    /* ── Add timing ── */
    document.querySelector('[data-action="addTiming"]')?.addEventListener('click', addTiming);
  
    /* ── Assign modal ── */
    document.querySelector('[data-close-modal="assignModal"]')?.addEventListener('click', () => closeModal('assignModal'));
    document.querySelector('[data-action="confirmAssign"]')?.addEventListener('click', confirmAssign);
  
    /* ── Driver keys ── */
    document.querySelector('[data-action="generateKeys"]')?.addEventListener('click', generateKeys);
  
    /* ── Settings ── */
    document.getElementById('modeSwitch')?.addEventListener('change', saveMode);
    document.querySelector('[data-action="logout"]')?.addEventListener('click', doLogout);
  
    /* ══════════════════════════════════════
       DELEGATED EVENTS  (dynamic table rows)
    ══════════════════════════════════════ */
  
    /* Students table */
    document.getElementById('studentsTableBody')?.addEventListener('click', e => {
      const editBtn   = e.target.closest('.js-edit-student');
      const deleteBtn = e.target.closest('.js-delete-student');
      if (editBtn)   editStudent(editBtn.dataset.id);
      if (deleteBtn) deleteStudent(deleteBtn.dataset.id);
    });
  
    /* Drivers table */
    document.getElementById('driversTableBody')?.addEventListener('click', e => {
      const verifyBtn = e.target.closest('.js-verify-driver');
      const assignBtn = e.target.closest('.js-assign-bus');
      if (verifyBtn) verifyDriver(verifyBtn.dataset.id);
      if (assignBtn) openAssignModal(assignBtn.dataset.id);
    });
  
    /* Buses table */
    document.getElementById('busesTableBody')?.addEventListener('click', e => {
      const editBtn   = e.target.closest('.js-edit-bus');
      const deleteBtn = e.target.closest('.js-delete-bus');
      if (editBtn)   editBus(editBtn.dataset.id);
      if (deleteBtn) deleteBus(deleteBtn.dataset.id);
    });
  
    /* Routes table */
    document.getElementById('routesTableBody')?.addEventListener('click', e => {
      const editBtn   = e.target.closest('.js-edit-route');
      const deleteBtn = e.target.closest('.js-delete-route');
      if (editBtn)   editRoute(editBtn.dataset.id);
      if (deleteBtn) deleteRoute(deleteBtn.dataset.id);
    });
  
    /* Keys container */
    document.getElementById('keysContainer')?.addEventListener('click', e => {
      const deleteBtn = e.target.closest('.js-delete-key');
      if (deleteBtn) deleteKey(deleteBtn.dataset.key);
    });
  
    /* Stop tags (remove stop) */
    document.getElementById('stopsList')?.addEventListener('click', e => {
      const removeBtn = e.target.closest('.js-remove-stop');
      if (removeBtn) removeStop(+removeBtn.dataset.index);
    });
  
    /* Timings list (remove timing + input change) */
    document.getElementById('timingsList')?.addEventListener('click', e => {
      const removeBtn = e.target.closest('.js-remove-timing');
      if (removeBtn) removeTiming(+removeBtn.dataset.index);
    });
    document.getElementById('timingsList')?.addEventListener('input', e => {
      const inp = e.target.closest('.js-timing-input');
      if (inp) {
        tempTimings[+inp.dataset.timingIndex][inp.dataset.timingField] = inp.value;
      }
    });
  
    /* Stop search results (delegated) */
    document.getElementById('stopSearchResults')?.addEventListener('click', e => {
      const item = e.target.closest('.js-select-stop');
      if (item) selectSearchedStop(item.dataset.lat, item.dataset.lng, item.dataset.name);
    });
  
    /* Close search results on outside click */
    document.addEventListener('click', e => {
      const res = document.getElementById('stopSearchResults');
      const inp = document.getElementById('stopSearchInput');
      if (res && inp && !res.contains(e.target) && e.target !== inp) {
        res.classList.remove('visible');
      }
    });
  
    /* Close modals on overlay click */
    document.querySelectorAll('.modal-overlay').forEach(el => {
      el.addEventListener('click', e => {
        if (e.target === el) el.classList.remove('open');
      });
    });
  
    /* Drag-and-drop bulk upload */
    const area = document.getElementById('uploadDropArea');
    if (area) {
      area.addEventListener('dragover',  e => { e.preventDefault(); area.classList.add('dragover'); });
      area.addEventListener('dragleave', () => area.classList.remove('dragover'));
      area.addEventListener('drop', e => {
        e.preventDefault();
        area.classList.remove('dragover');
        const file = e.dataTransfer.files[0];
        if (file) handleBulkFile(file);
      });
    }
  
  });