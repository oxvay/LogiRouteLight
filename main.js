import * as XLSX from 'xlsx';

const API_BASE = '/api';
const SESSION_TOKEN_KEY = 'logiroute_session_token';
const LS_ACTIVE   = 'lrl_active';    // { routeId, date }
const LS_NUMBERS  = 'lrl_numbers';   // { date, suffixes: string[] }
const LS_STATUSES = 'lrl_statuses';  // { [routeId_index]: status }
const LS_HISTORY  = 'lrl_history';   // DeliveryRecord[]

const dataColumns = {
  orderNumber: 0, deliveryAddress: 2, grossWeight: 4,
  buyer: 5, comment: 7, responsible: 8, deliveryService: 9, orderId: 11
};

// Per-user localStorage key isolation
function lsKey(key) { return currentUser ? `${key}_${currentUser.id}` : key; }

// ── DOM refs ──────────────────────────────────────────────
const authPanel      = document.getElementById('authPanel');
const appPanel       = document.getElementById('appPanel');
const loginForm      = document.getElementById('loginForm');
const loginInput     = document.getElementById('loginInput');
const passwordInput  = document.getElementById('passwordInput');
const authMessage    = document.getElementById('authMessage');
const togglePwd      = document.getElementById('togglePwd');
const logoutBtn      = document.getElementById('logoutBtn');
const headerUser     = document.getElementById('headerUser');
const addRouteBtn    = document.getElementById('addRouteBtn');
const numbersBtn     = document.getElementById('numbersBtn');
const numbersPanel   = document.getElementById('numbersPanel');
const numbersInput   = document.getElementById('numbersInput');
const saveNumbersBtn = document.getElementById('saveNumbersBtn');
const numbersStatus  = document.getElementById('numbersStatus');
const fileInput      = document.getElementById('fileInput');
const statusPanel    = document.getElementById('statusPanel');
const routeList      = document.getElementById('routeList');
const resultCount    = document.getElementById('resultCount');
const allDeliveredBtn= document.getElementById('allDeliveredBtn');
const yandexRouteBtn = document.getElementById('yandexRouteBtn');
const tabRouteBtn    = document.getElementById('tabRouteBtn');
const tabMapBtn      = document.getElementById('tabMapBtn');
const tabHistoryBtn  = document.getElementById('tabHistoryBtn');
const historyBadge   = document.getElementById('historyBadge');
const routeTab       = document.getElementById('routeTab');
const mapTab         = document.getElementById('mapTab');
const historyTab     = document.getElementById('historyTab');
const monthlyCount   = document.getElementById('monthlyCount');
const dropzone       = document.getElementById('dropzone');
const routeDatePicker= document.getElementById('routeDatePicker');
const datePrevBtn    = document.getElementById('datePrevBtn');
const dateNextBtn    = document.getElementById('dateNextBtn');
const calGrid        = document.getElementById('calGrid');
const calDayDetail   = document.getElementById('calDayDetail');
const calMonthLabel  = document.getElementById('calMonthLabel');
const calPrevBtn     = document.getElementById('calPrevBtn');
const calNextBtn     = document.getElementById('calNextBtn');
const progressPanel  = document.getElementById('progressPanel');
const progressFill   = document.getElementById('progressFill');
const progressDone   = document.getElementById('progressDone');
const progressTotal  = document.getElementById('progressTotal');
const progressPercent= document.getElementById('progressPercent');

// Admin DOM
const adminPanel        = document.getElementById('adminPanel');
const adminLogoutBtn    = document.getElementById('adminLogoutBtn');
const adminHeaderUser   = document.getElementById('adminHeaderUser');
const tabAdminDriversBtn= document.getElementById('tabAdminDriversBtn');
const adminDriversTab   = document.getElementById('adminDriversTab');
const adminDriversCount = document.getElementById('adminDriversCount');
const adminAddDriverBtn = document.getElementById('adminAddDriverBtn');
const adminAddDriverForm= document.getElementById('adminAddDriverForm');
const newDriverLogin    = document.getElementById('newDriverLogin');
const newDriverPassword = document.getElementById('newDriverPassword');
const saveDriverBtn     = document.getElementById('saveDriverBtn');
const cancelDriverBtn   = document.getElementById('cancelDriverBtn');
const adminDriverError  = document.getElementById('adminDriverError');
const adminDriversList  = document.getElementById('adminDriversList');

// ── State ─────────────────────────────────────────────────
let currentUser       = null;
let currentRows       = [];       // flat filtered route rows
let routeGroups       = [];       // grouped by address for display
let activeRouteId     = null;
let dragSrcGroupIdx   = null;
let touchDragState    = null; // { srcIdx, ghost, lastTargetIdx, offsetY }
let selectedUploadDate = todayStr(); // always tracks the date picker value
let calendarState     = { year: new Date().getFullYear(), month: new Date().getMonth() };
let selectedCalDay    = null;

// ── Event listeners ───────────────────────────────────────
loginForm.addEventListener('submit', handleLogin);
logoutBtn.addEventListener('click', handleLogout);
adminLogoutBtn.addEventListener('click', handleLogout);
togglePwd.addEventListener('click', () => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  togglePwd.textContent = show ? '🔒' : '👁';
});
numbersBtn.addEventListener('click', () => numbersPanel.classList.toggle('hidden'));
saveNumbersBtn.addEventListener('click', saveNumbers);
addRouteBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', e => { if (e.target.files[0]) processFile(e.target.files[0]); });
allDeliveredBtn.addEventListener('click', markAllDelivered);
yandexRouteBtn.addEventListener('click', e => { e.stopPropagation(); openRouteMenu(yandexRouteBtn); });
tabRouteBtn.addEventListener('click',   () => switchTab('routeTab'));
tabMapBtn.addEventListener('click',     () => switchTab('mapTab'));
tabHistoryBtn.addEventListener('click', () => switchTab('historyTab'));
routeDatePicker.addEventListener('change', () => onDatePickerChange());
datePrevBtn.addEventListener('click', () => shiftPickerDate(-1));
dateNextBtn.addEventListener('click', () => shiftPickerDate(+1));
calPrevBtn.addEventListener('click',   () => { shiftCalendar(-1); renderCalendar(); });
calNextBtn.addEventListener('click',   () => { shiftCalendar(1);  renderCalendar(); });
['dragenter','dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('dragover'); }));
['dragleave','drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
dropzone.addEventListener('drop', e => { if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); });

// ── Touch drag-and-drop (document level) ─────────────────
document.addEventListener('touchmove', e => {
  if (!touchDragState) return;
  e.preventDefault();
  const touch = e.touches[0];
  const { ghost, offsetY } = touchDragState;
  ghost.style.top = `${touch.clientY - offsetY}px`;

  ghost.style.display = 'none';
  const el = document.elementFromPoint(touch.clientX, touch.clientY);
  ghost.style.display = '';

  document.querySelectorAll('.route-card').forEach(c => c.classList.remove('drag-over'));
  const targetCard = el?.closest('.route-card');
  if (targetCard) {
    const idx = parseInt(targetCard.dataset.groupIndex, 10);
    touchDragState.lastTargetIdx = idx;
    if (idx !== touchDragState.srcIdx) targetCard.classList.add('drag-over');
  }
}, { passive: false });

document.addEventListener('touchend', () => {
  if (!touchDragState) return;
  const { srcIdx, ghost, lastTargetIdx } = touchDragState;
  ghost.remove();
  document.querySelectorAll('.route-card').forEach(c => c.classList.remove('dragging', 'drag-over'));
  touchDragState = null;
  if (srcIdx !== lastTargetIdx) {
    const [moved] = routeGroups.splice(srcIdx, 1);
    routeGroups.splice(lastTargetIdx, 0, moved);
    currentRows = routeGroups.flatMap(g => g.map(i => i.row));
    renderRoute(currentRows);
  }
});
tabAdminDriversBtn.addEventListener('click', () => switchAdminTab('adminDriversTab'));
adminAddDriverBtn.addEventListener('click',  () => adminAddDriverForm.classList.remove('hidden'));
cancelDriverBtn.addEventListener('click', () => {
  adminAddDriverForm.classList.add('hidden');
  newDriverLogin.value = ''; newDriverPassword.value = '';
  adminDriverError.classList.add('hidden');
});
saveDriverBtn.addEventListener('click', handleAdminAddDriver);

bootstrap();

// ── Auth ──────────────────────────────────────────────────
async function bootstrap() {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  try {
    const res = await fetch(`${API_BASE}/me`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (res.ok) {
      currentUser = (await res.json()).user;
      if (currentUser.role === 'admin') { showAdminApp(); return; }
      showApp();
      await loadRouteForDate(todayStr());
      return;
    }
  } catch { /* fall through */ }
  localStorage.removeItem(SESSION_TOKEN_KEY);
  showAuth();
}

async function handleLogin(e) {
  e.preventDefault();
  setAuthMsg('Вход…', false);
  try {
    const res = await fetch(`${API_BASE}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginInput.value.trim(), password: passwordInput.value })
    });
    if (!res.ok) { setAuthMsg('Неверный логин или пароль', true); return; }
    const data = await res.json();
    currentUser = data.user;
    localStorage.setItem(SESSION_TOKEN_KEY, data.token);
    if (currentUser.role === 'admin') { showAdminApp(); return; }
    showApp();
    await loadRouteForDate(todayStr());
  } catch { setAuthMsg('Ошибка соединения с сервером', true); }
}

async function handleLogout() {
  try { await fetch(`${API_BASE}/logout`, { method: 'POST', headers: authHeaders() }); } catch { /* ignore */ }
  localStorage.removeItem(SESSION_TOKEN_KEY);
  location.reload();
}

function setAuthMsg(text, isError) {
  authMessage.textContent = text;
  authMessage.className = 'auth-message' + (isError ? ' error' : '');
}

function showAuth() {
  authPanel.classList.remove('hidden');
  appPanel.classList.add('hidden');
  adminPanel.classList.add('hidden');
  setAuthMsg('', false);
  loginInput.value = ''; passwordInput.value = '';
}

function showApp() {
  authPanel.classList.add('hidden');
  adminPanel.classList.add('hidden');
  appPanel.classList.remove('hidden');
  headerUser.textContent = currentUser?.login || 'Водитель';
  selectedUploadDate = todayStr();
  routeDatePicker.value = selectedUploadDate;
  routeDatePicker.classList.toggle('is-today', true);
  loadSavedNumbers();
  renderCalendar();
}

function showAdminApp() {
  authPanel.classList.add('hidden');
  appPanel.classList.add('hidden');
  adminPanel.classList.remove('hidden');
  adminHeaderUser.textContent = currentUser?.login || 'Администратор';
  loadAdminUsers();
}

// ── Admin ─────────────────────────────────────────────────
function switchAdminTab(tabId) {
  [adminDriversTab].forEach(t => t.classList.add('hidden'));
  [tabAdminDriversBtn].forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.remove('hidden');
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
}

async function loadAdminUsers() {
  try {
    const res = await fetch(`${API_BASE}/admin/users`, { headers: authHeaders() });
    if (!res.ok) return;
    const { users } = await res.json();
    const plural = n => n === 1 ? 'пользователь' : n < 5 ? 'пользователя' : 'пользователей';
    adminDriversCount.textContent = `${users.length} ${plural(users.length)}`;
    adminDriversList.innerHTML = '';
    users.forEach(u => {
      const isSelf = u.id === currentUser?.id;
      const created = new Date(u.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
      const card = document.createElement('div');
      card.className = 'route-card';
      card.innerHTML = `
        <div class="card-main" style="cursor:default">
          <div class="route-badge" style="background:${u.role === 'admin' ? 'var(--red)' : 'var(--text)'}; font-size:16px">👤</div>
          <div class="route-info">
            <div class="route-address">
              ${escapeHtml(u.login)}
              ${isSelf ? '<span style="font-size:11px;color:var(--orange);font-weight:600;margin-left:6px">Вы</span>' : ''}
            </div>
            <div class="route-ordnum">
              <span class="admin-role-badge role-${u.role}">${u.role === 'admin' ? 'Admin' : 'Driver'}</span>
              &nbsp;·&nbsp;Маршрутов: ${u.routeCount}
              &nbsp;·&nbsp;${created}
            </div>
          </div>
          <div class="route-actions">
            ${!isSelf ? `
              <button class="btn-clear" data-action="clear" data-id="${u.id}" data-login="${escapeHtml(u.login)}">Очистить</button>
              <button class="btn-danger" data-action="delete" data-id="${u.id}" data-login="${escapeHtml(u.login)}">Удалить</button>
            ` : ''}
          </div>
        </div>
      `;
      adminDriversList.appendChild(card);
    });

    adminDriversList.querySelectorAll('[data-action="clear"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Очистить все данные «${btn.dataset.login}»?\nАккаунт останется, маршруты удалятся.`)) return;
        btn.textContent = '…';
        const r = await fetch(`${API_BASE}/admin/users/${btn.dataset.id}/clear`, { method: 'POST', headers: authHeaders() });
        if (r.ok) loadAdminUsers(); else alert('Ошибка');
      });
    });
    adminDriversList.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Удалить «${btn.dataset.login}» и все его данные?\nОперация необратима!`)) return;
        btn.textContent = '…';
        const r = await fetch(`${API_BASE}/admin/users/${btn.dataset.id}`, { method: 'DELETE', headers: authHeaders() });
        if (r.ok) loadAdminUsers(); else alert('Ошибка');
      });
    });
  } catch (err) { console.error('Admin load error', err); }
}

async function handleAdminAddDriver() {
  adminDriverError.classList.add('hidden');
  const login    = newDriverLogin.value.trim();
  const password = newDriverPassword.value;
  if (!login || !password) {
    adminDriverError.textContent = 'Заполните логин и пароль';
    adminDriverError.classList.remove('hidden');
    return;
  }
  saveDriverBtn.textContent = '…';
  try {
    const res = await fetch(`${API_BASE}/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ login, password, role: 'driver' })
    });
    if (!res.ok) {
      const { error } = await res.json();
      adminDriverError.textContent = error || 'Ошибка создания';
      adminDriverError.classList.remove('hidden');
    } else {
      newDriverLogin.value = ''; newDriverPassword.value = '';
      adminAddDriverForm.classList.add('hidden');
      loadAdminUsers();
    }
  } catch {
    adminDriverError.textContent = 'Сетевая ошибка';
    adminDriverError.classList.remove('hidden');
  } finally {
    saveDriverBtn.textContent = 'Сохранить';
  }
}

// ── Date Picker ───────────────────────────────────────────
function onDatePickerChange() {
  const val = routeDatePicker.value;
  if (!val) return;
  selectedUploadDate = val;
  routeDatePicker.classList.toggle('is-today', val === todayStr());
  loadSavedNumbers();
  loadRouteForDate(val);
}

function shiftPickerDate(delta) {
  const current = routeDatePicker.value || todayStr();
  const [y, m, d] = current.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta); // local arithmetic, no UTC shift
  const next = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
  routeDatePicker.value = next;
  selectedUploadDate = next;
  routeDatePicker.classList.toggle('is-today', next === todayStr());
  loadSavedNumbers();
  loadRouteForDate(next);
}

// ── Numbers Filter ────────────────────────────────────────
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function readNumbersMap() {
  try {
    const v = JSON.parse(localStorage.getItem(lsKey(LS_NUMBERS)) || '{}');
    // Legacy { date, suffixes } → treat as a single-day map
    if (Array.isArray(v.suffixes)) return v.date ? { [v.date]: v.suffixes } : {};
    return v && typeof v === 'object' ? v : {};
  } catch { return {}; }
}

function getFilterSuffixes() {
  return readNumbersMap()[selectedUploadDate] || [];
}

function loadSavedNumbers() {
  const suffixes = getFilterSuffixes();
  numbersInput.value = suffixes.length ? suffixes.join(', ') : '';
  numbersStatus.textContent = '';
  if (suffixes.length) showNumbersStatus(suffixes);
}

function saveNumbers() {
  const suffixes = parseFilterInput(numbersInput.value);
  if (!suffixes.length) { numbersStatus.textContent = 'Введите хотя бы одно число'; return; }
  const all = readNumbersMap();
  all[selectedUploadDate] = suffixes;
  localStorage.setItem(lsKey(LS_NUMBERS), JSON.stringify(all));
  showNumbersStatus(suffixes);
}

function showNumbersStatus(suffixes) {
  numbersStatus.textContent = `Активно: ${suffixes.join(', ')} (${suffixes.length} маршрут${pluralRu(suffixes.length)})`;
}

function parseFilterInput(raw) {
  return raw.split(',').map(s => s.trim().replace(/\D/g, '')).filter(s => s.length > 0);
}

// ── Persistence: load route for a given date ─────────────
async function loadRouteForDate(dateStr) {
  if (!currentUser) return;
  const headers = authHeaders();
  const isToday = dateStr === todayStr();

  // Try LS cache for today
  if (isToday) {
    const saved = JSON.parse(localStorage.getItem(lsKey(LS_ACTIVE)) || 'null');
    if (saved?.date === dateStr && saved.routeId) {
      const res = await fetch(`${API_BASE}/routes/${saved.routeId}/items`, { headers });
      if (res.ok) {
        const { items } = await res.json();
        if (items.length) {
          activeRouteId = saved.routeId;
          currentRows = items; restoreStatuses(); renderRoute(currentRows);
          statusPanel.textContent = `Маршрут: ${currentRows.length} точек.`;
          return;
        }
      }
    }
  }

  const res = await fetch(`${API_BASE}/routes?date=${dateStr}`, { headers });
  if (!res.ok) { currentRows = []; activeRouteId = null; renderRoute([]); return; }
  const { routes } = await res.json();
  if (!routes?.length) { activeRouteId = null; currentRows = []; renderRoute([]); statusPanel.textContent = ''; return; }

  const latest = routes[routes.length - 1];
  activeRouteId = latest.id;
  if (isToday) localStorage.setItem(lsKey(LS_ACTIVE), JSON.stringify({ date: dateStr, routeId: activeRouteId }));

  const itemsRes = await fetch(`${API_BASE}/routes/${activeRouteId}/items`, { headers });
  if (!itemsRes.ok) { renderRoute([]); return; }
  const { items } = await itemsRes.json();
  currentRows = items; restoreStatuses(); renderRoute(currentRows);
  statusPanel.textContent = currentRows.length ? `Маршрут: ${currentRows.length} точек.` : '';
}

function restoreStatuses() {
  if (!activeRouteId) return;
  const all = JSON.parse(localStorage.getItem(lsKey(LS_STATUSES)) || '{}');
  currentRows.forEach((row, i) => {
    const s = all[`${activeRouteId}_${i}`];
    row._status = s === 'delivered' ? 'delivered' : 'pending';
  });
}

// ── File Processing ───────────────────────────────────────
async function processFile(file) {
  const suffixes = getFilterSuffixes();
  if (!suffixes.length) {
    statusPanel.textContent = '⚠ Сначала укажите номера (кнопка «🔢 Номера»).';
    numbersPanel.classList.remove('hidden');
    return;
  }
  statusPanel.textContent = 'Читаем файл…';
  try {
    const buffer   = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
    const rows     = extractRowsFromWorkbook(workbook);
    const filtered = rows.filter(r => suffixes.some(s => normalizeText(r.orderNumber).endsWith(s)));
    if (!filtered.length) {
      statusPanel.textContent = `Совпадений не найдено. Проверьте номера (${suffixes.join(', ')}).`;
      return;
    }
    filtered.forEach(r => { r._status = 'pending'; });
    currentRows = filtered;
    const isToday = selectedUploadDate === todayStr();
    const label = isToday ? 'сегодня' : selectedUploadDate;
    statusPanel.textContent = `Найдено ${currentRows.length} точек (${label}).`;
    renderRoute(currentRows);
    const routeId = await saveRoute(file.name, currentRows);
    if (routeId) {
      activeRouteId = routeId;
      if (isToday) localStorage.setItem(lsKey(LS_ACTIVE), JSON.stringify({ date: selectedUploadDate, routeId }));
    }
  } catch (err) {
    console.error(err);
    statusPanel.textContent = `Ошибка чтения файла: ${err?.message || 'неизвестная ошибка'}`;
  }
}

// ── Excel Parsing ─────────────────────────────────────────
function extractRowsFromWorkbook(workbook) {
  const result = [];
  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const rows  = [];
    for (let r = range.s.r; r <= range.e.r; r++) rows.push(readRow(sheet, r, range.e.c));
    for (let r = 3; r < rows.length; r++) {
      const row    = rows[r] || [];
      if (!row.some(c => String(c ?? '').trim() !== '')) continue;
      const mapped = mapRow(row);
      if (String(mapped.orderNumber).toUpperCase().includes('РАСХНАКЛ')) continue;
      result.push(mapped);
    }
  }
  return result;
}

function mapRow(row) {
  return {
    orderNumber:     getCell(row, dataColumns.orderNumber),
    deliveryAddress: getCell(row, dataColumns.deliveryAddress),
    grossWeight:     getCell(row, dataColumns.grossWeight),
    buyer:           getCell(row, dataColumns.buyer),
    comment:         getCell(row, dataColumns.comment),
    responsible:     getCell(row, dataColumns.responsible),
    deliveryService: getCell(row, dataColumns.deliveryService),
    orderId:         getCell(row, dataColumns.orderId),
    _status: 'pending'
  };
}

function getCell(row, idx) { return idx < 0 ? '' : String(row[idx] ?? '').trim(); }

function readRow(sheet, rowIndex, maxCol) {
  const row = [];
  for (let c = 0; c <= maxCol; c++) {
    const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c })];
    row.push(cell ? cell.w ?? cell.v ?? '' : '');
  }
  return row;
}

function normalizeText(value) {
  return String(value ?? '').replace(/\u00A0/g, ' ').replace(/\t/g, ' ').trim().replace(/\s+/g, ' ').toUpperCase();
}

// ── API ───────────────────────────────────────────────────
function authHeaders() {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function saveRoute(sourceFileName, items) {
  if (!currentUser) return null;
  const res = await fetch(`${API_BASE}/routes`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({
      sourceFileName, routeDate: selectedUploadDate, status: 'active',
      items: items.map(r => ({
        orderNumber: r.orderNumber, deliveryAddress: r.deliveryAddress,
        grossWeight: r.grossWeight, buyer: r.buyer, comment: r.comment,
        responsible: r.responsible, deliveryService: r.deliveryService, orderId: r.orderId
      }))
    })
  });
  if (!res.ok) return null;
  return (await res.json()).route?.id || null;
}

// ── Address Grouping ──────────────────────────────────────
function normalizeAddress(addr) {
  return (addr || '')
    .trim()
    .replace(/^\d{6}[\s,]+/, '') // strip leading 6-digit postal code (e.g. "143444 ")
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .trim();
}

function groupRowsByAddress(rows) {
  const groups  = [];
  const keyMap  = new Map(); // normalised address → group index
  rows.forEach((row, idx) => {
    const key = normalizeAddress(row.deliveryAddress);
    if (keyMap.has(key)) {
      groups[keyMap.get(key)].push({ row, idx });
    } else {
      keyMap.set(key, groups.length);
      groups.push([{ row, idx }]);
    }
  });
  return groups;
}

// ── Render Route ──────────────────────────────────────────
function renderRoute(rows) {
  routeGroups = groupRowsByAddress(rows);
  const pointCount = routeGroups.length;
  resultCount.textContent = `${pointCount} точек`;
  allDeliveredBtn.classList.toggle('hidden', !rows.length);
  yandexRouteBtn.classList.toggle('hidden', !rows.length);
  progressPanel.classList.toggle('hidden', !rows.length);
  if (!rows.length) {
    routeList.innerHTML = '<div class="empty-state">Совпадений не найдено</div>';
    updateProgress();
    return;
  }
  routeList.innerHTML = '';
  routeGroups.forEach((group, gIdx) => routeList.appendChild(createGroupCard(group, gIdx)));
  updateProgress();
}

// ── Live progress ────────────────────────────────────────
function updateProgress() {
  const total = routeGroups.length;
  const done  = routeGroups.filter(g => g.every(({ row }) => row._status === 'delivered')).length;
  const pct   = total ? Math.round((done / total) * 100) : 0;
  progressDone.textContent    = String(done);
  progressTotal.textContent   = String(total);
  progressPercent.textContent = `${pct}%`;
  progressFill.style.width    = `${pct}%`;
}

// ── Tap-to-call: extract Russian phone numbers from free-form text ─
function extractPhones(text) {
  if (!text) return [];
  const re = /(\+?[78])([\s\-.()\u00A0]*(?:\d[\s\-.()\u00A0]*)){10}/g;
  const phones = [];
  const seen = new Set();
  const matches = String(text).match(re) || [];
  for (const match of matches) {
    const digits = match.replace(/\D/g, '');
    if (digits.length < 11) continue;
    const tel = '+7' + digits.slice(-10);
    if (seen.has(tel)) continue;
    seen.add(tel);
    phones.push({ display: match.trim(), tel });
  }
  return phones;
}

function collectGroupPhones(group) {
  const phones = [];
  const seen = new Set();
  for (const { row } of group) {
    for (const p of extractPhones(row.comment)) {
      if (!seen.has(p.tel)) { seen.add(p.tel); phones.push(p); }
    }
  }
  return phones;
}

// ── Popup menu (for call / route choice) ──────────────────
function closePopups() {
  document.querySelectorAll('.popup-menu').forEach(el => el.remove());
}

function showPopupMenu(anchor, items) {
  closePopups();
  const menu = document.createElement('div');
  menu.className = 'popup-menu';
  menu.innerHTML = items.map(it => {
    const href = it.href ? ` href="${it.href}"` : ' href="#"';
    const target = it.external ? ' target="_blank" rel="noopener noreferrer"' : '';
    return `<a${href}${target} class="popup-menu-item">${it.icon || ''} ${escapeHtml(it.label)}</a>`;
  }).join('');
  document.body.appendChild(menu);

  // Position below/near anchor, right-aligned, clamped to viewport
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8)}px`;
  const right = Math.max(8, window.innerWidth - rect.right);
  menu.style.right = `${right}px`;

  // Close on outside click / scroll / esc
  const onOutside = (ev) => {
    if (!menu.contains(ev.target)) closePopups();
  };
  const onEsc = (ev) => { if (ev.key === 'Escape') closePopups(); };
  setTimeout(() => {
    document.addEventListener('click', onOutside, { once: true });
    document.addEventListener('keydown', onEsc, { once: true });
  }, 0);
  menu.addEventListener('click', e => {
    // Let tel: / external links navigate normally, then close
    setTimeout(closePopups, 0);
    if (e.target.closest('a[href="#"]')) e.preventDefault();
  });
}

// ── Link opener (works on mobile — avoids popup blocker) ──
function openLink(url) {
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── Toast notification ────────────────────────────────────
function showToast(msg, ms = 2800) {
  let el = document.querySelector('.app-toast');
  if (!el) { el = document.createElement('div'); el.className = 'app-toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), ms);
}

// ── Multi-point Route (menu: Yandex Maps / Yandex Navigator) ────────
function buildRouteUrls(addrs) {
  const rtext  = addrs.map(encodeURIComponent).join('~');
  const isIOS  = /iPad|iPhone|iPod/.test(navigator.userAgent);
  // Use HTTPS on all platforms — iOS Universal Links open the app with the full route.
  // On iOS open in current tab (no _blank) so Universal Links fire; desktop opens new tab.
  const yandex    = `https://yandex.ru/maps/?mode=routes&rtext=${rtext}&rtt=auto`;
  const yandexNew = !isIOS;

  const navi    = `https://yandex.ru/navi/?rtext=${rtext}&rtt=auto`;
  const naviNew = !isIOS;

  return { yandex, yandexNew, navi, naviNew };
}

function openRouteMenu(anchor) {
  const addrs = routeGroups.map(g => g[0].row.deliveryAddress).filter(Boolean);
  if (!addrs.length) return;
  const { yandex, yandexNew, navi, naviNew } = buildRouteUrls(addrs);
  showPopupMenu(anchor, [
    { label: 'Яндекс Карты',      icon: '🗺', href: yandex, external: yandexNew },
    { label: 'Яндекс Навигатор',  icon: '🧭', href: navi,   external: naviNew  }
  ]);
}

// ── Group Card ────────────────────────────────────────────
function groupInfoEqual(group) {
  if (group.length <= 1) return true;
  const ref = group[0].row;
  return group.slice(1).every(({ row }) =>
    row.grossWeight    === ref.grossWeight &&
    row.buyer          === ref.buyer &&
    row.comment        === ref.comment &&
    row.responsible    === ref.responsible &&
    row.deliveryService=== ref.deliveryService
  );
}

function detailGridHtml(row, address) {
  return `<div class="detail-grid">
    <div><strong>Адрес</strong><span>${escapeHtml(address)}</span></div>
    <div><strong>Номер заказа</strong><span>${escapeHtml(row.orderId || '—')}</span></div>
    <div><strong>Вес (кг)</strong><span>${escapeHtml(row.grossWeight) || '—'}</span></div>
    <div><strong>Покупатель</strong><span>${escapeHtml(row.buyer) || '—'}</span></div>
    <div><strong>Комментарий</strong><span>${escapeHtml(row.comment) || '—'}</span></div>
    <div><strong>Ответственный</strong><span>${escapeHtml(row.responsible) || '—'}</span></div>
    <div><strong>Служба доставки</strong><span>${escapeHtml(row.deliveryService) || '—'}</span></div>
    <div><strong>Номер РасхНакл</strong><span>${escapeHtml(row.orderNumber || '—')}</span></div>
  </div>`;
}

function createGroupCard(group, gIdx) {
  const isMulti  = group.length > 1;
  const firstRow = group[0].row;
  const address  = firstRow.deliveryAddress || 'Адрес не указан';
  const yandex   = `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`;
  const allDel   = group.every(({ row }) => row._status === 'delivered');
  const sameInfo = groupInfoEqual(group);

  const card = document.createElement('div');
  card.className = 'route-card' + (allDel ? ' is-delivered' : '');
  card.draggable = true;
  card.dataset.groupIndex = String(gIdx);

  // Build card-details HTML
  let detailsHtml = '';
  if (!isMulti) {
    // Single item: full detail grid
    detailsHtml = detailGridHtml(firstRow, address);
  } else if (sameInfo) {
    // Merged: shared info once + invoice numbers as text list
    const invoiceNums = group.map(({ row }) => escapeHtml(row.orderNumber || '—')).join(', ');
    detailsHtml = detailGridHtml(firstRow, address) + `
      <div class="group-invoice-list">
        <span class="group-invoice-label">Накладные:</span>
        <span class="group-invoice-nums">${invoiceNums}</span>
      </div>`;
  } else {
    // Multiple items with different info: separate sections per item
    detailsHtml = group.map(({ row, idx }) => `
      <div class="group-order-section">
        <div class="group-section-header">
          <span>Накл: ${escapeHtml(row.orderNumber || '—')}</span>
          <button class="delivered-btn${row._status === 'delivered' ? ' is-delivered' : ''}" data-row-idx="${idx}" type="button">✓</button>
        </div>
        ${detailGridHtml(row, address)}
      </div>`).join('');
  }

  const headerDeliveredBtn = (!isMulti || sameInfo)
    ? `<button class="delivered-btn${allDel ? ' is-delivered' : ''}" type="button" data-group-delivered>✓</button>`
    : '';

  const phones = collectGroupPhones(group);
  const callBtn = phones.length
    ? (phones.length === 1
        ? `<a class="call-btn" href="tel:${phones[0].tel}" type="button" aria-label="Позвонить">📞</a>`
        : `<button class="call-btn has-count" type="button" aria-label="Позвонить" data-call-multi>📞<span class="call-count">${phones.length}</span></button>`)
    : '';

  card.innerHTML = `
    <div class="card-main">
      <div class="drag-handle-icon" aria-hidden="true">
        <span class="dot"></span><span class="dot"></span>
        <span class="dot"></span><span class="dot"></span>
        <span class="dot"></span><span class="dot"></span>
      </div>
      <div class="route-badge">${gIdx + 1}</div>
      <div class="route-info">
        <div class="route-address" title="${escapeHtml(address)}">${escapeHtml(address)}</div>
        <div class="route-ordnum">
          ${isMulti
            ? `<span class="group-badge-count">${group.length} заказа</span>`
            : `Накладная: ${escapeHtml(firstRow.orderNumber || '—')}`}
        </div>
      </div>
      <div class="route-actions">
        ${headerDeliveredBtn}
        ${callBtn}
        <button class="maps-btn" type="button">Maps</button>
      </div>
    </div>
    <div class="card-details hidden">${detailsHtml}</div>
  `;

  // Update badge colour helper
  function refreshBadge() {
    const nowAllDel = group.every(({ row }) => row._status === 'delivered');
    card.classList.toggle('is-delivered', nowAllDel);
    card.querySelector('.route-badge').style.background = nowAllDel ? 'var(--green)' : '';
  }

  // Expand / collapse — whole card is clickable except interactive elements
  const details = card.querySelector('.card-details');
  card.addEventListener('click', e => {
    if (e.target.closest('button, select, a, input')) return;
    details.classList.toggle('hidden');
  });

  // Delivered toggle — header button (single item or sameInfo merged group)
  const groupDeliveredBtn = card.querySelector('[data-group-delivered]');
  if (groupDeliveredBtn) {
    groupDeliveredBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isDel = group.every(({ row }) => row._status === 'delivered');
      const next  = isDel ? 'pending' : 'delivered';
      group.forEach(({ row, idx }) => {
        row._status = next;
        persistStatus(idx, next);
        if (next === 'delivered') addToHistory(row, idx); else removeFromHistory(idx);
      });
      groupDeliveredBtn.classList.toggle('is-delivered', !isDel);
      refreshBadge();
      updateProgress();
      renderCalendar();
    });
  }

  // Per-row delivered toggles (in card-details, only for different-info groups)
  card.querySelectorAll('.card-details .delivered-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      const rowIdx = parseInt(btn.dataset.rowIdx, 10);
      const item   = group.find(i => i.idx === rowIdx);
      if (!item) return;
      const { row } = item;
      const isDel = row._status === 'delivered';
      row._status = isDel ? 'pending' : 'delivered';
      btn.classList.toggle('is-delivered', !isDel);
      persistStatus(rowIdx, row._status);
      if (!isDel) addToHistory(row, rowIdx); else removeFromHistory(rowIdx);
      refreshBadge();
      updateProgress();
      renderCalendar();
    });
  });

  // Maps button
  card.querySelector('.maps-btn').addEventListener('click', e => {
    e.stopPropagation();
    openLink(yandex);
  });

  // Call button: single phone → native tel link, multiple → popup menu
  const callEl = card.querySelector('.call-btn');
  if (callEl) {
    callEl.addEventListener('click', e => {
      e.stopPropagation();
      if (callEl.dataset.callMulti !== undefined) {
        e.preventDefault();
        showPopupMenu(callEl, phones.map(p => ({
          icon: '📞', label: p.display, href: `tel:${p.tel}`
        })));
      }
      // single-phone <a href="tel:..."> navigates natively
    });
  }

  // Desktop drag-and-drop
  card.addEventListener('dragstart', onGroupDragStart);
  card.addEventListener('dragover',  onGroupDragOver);
  card.addEventListener('drop',      onGroupDrop);
  card.addEventListener('dragend',   onGroupDragEnd);

  // Touch drag-and-drop (mobile)
  const handle = card.querySelector('.drag-handle-icon');
  handle.addEventListener('touchstart', e => {
    e.preventDefault();
    const rect = card.getBoundingClientRect();
    const touch = e.touches[0];
    const ghost = card.cloneNode(true);
    ghost.style.cssText = [
      'position:fixed', 'z-index:9999', 'pointer-events:none', 'opacity:0.85',
      `width:${rect.width}px`, `left:${rect.left}px`, `top:${rect.top}px`,
      'box-shadow:0 8px 28px rgba(0,0,0,0.22)', 'border-radius:12px', 'transition:none'
    ].join(';');
    document.body.appendChild(ghost);
    card.classList.add('dragging');
    touchDragState = { srcIdx: gIdx, ghost, lastTargetIdx: gIdx, offsetY: touch.clientY - rect.top };
  }, { passive: false });

  // Set initial badge
  refreshBadge();
  return card;
}

// ── Group Drag & Drop ─────────────────────────────────────
function onGroupDragStart(ev) {
  dragSrcGroupIdx = parseInt(this.dataset.groupIndex, 10);
  ev.dataTransfer.effectAllowed = 'move';
  requestAnimationFrame(() => this.classList.add('dragging'));
}
function onGroupDragOver(ev) {
  ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.route-card').forEach(c => c.classList.remove('drag-over'));
  this.classList.add('drag-over');
}
function onGroupDrop(ev) {
  ev.preventDefault();
  const dest = parseInt(this.dataset.groupIndex, 10);
  if (dragSrcGroupIdx === null || dragSrcGroupIdx === dest) return;
  const [moved] = routeGroups.splice(dragSrcGroupIdx, 1);
  routeGroups.splice(dest, 0, moved);
  currentRows = routeGroups.flatMap(g => g.map(i => i.row));
  renderRoute(currentRows);
}
function onGroupDragEnd() {
  document.querySelectorAll('.route-card').forEach(c => c.classList.remove('dragging', 'drag-over'));
  dragSrcGroupIdx = null;
}

// ── Bulk: All Delivered ───────────────────────────────────
function markAllDelivered() {
  currentRows.forEach((row, i) => {
    if (row._status !== 'delivered') {
      row._status = 'delivered';
      persistStatus(i, 'delivered');
      addToHistory(row, i);
    }
  });
  renderRoute(currentRows);
  renderCalendar();
}

// ── Status Persistence ────────────────────────────────────
function persistStatus(index, status) {
  if (!activeRouteId) return;
  const all = JSON.parse(localStorage.getItem(lsKey(LS_STATUSES)) || '{}');
  all[`${activeRouteId}_${index}`] = status;
  localStorage.setItem(lsKey(LS_STATUSES), JSON.stringify(all));
}

// ── History ───────────────────────────────────────────────
function historyKey(index) { return `${activeRouteId || 'local'}_${index}`; }

function addToHistory(row, index) {
  const history = JSON.parse(localStorage.getItem(lsKey(LS_HISTORY)) || '[]');
  const key     = historyKey(index);
  const existing = history.findIndex(h => h.key === key);
  const record = {
    key, date: selectedUploadDate, completedAt: new Date().toISOString(),
    address: row.deliveryAddress || 'Адрес не указан',
    orderNumber: row.orderNumber || '—', orderId: row.orderId || '—', buyer: row.buyer || ''
  };
  if (existing >= 0) history[existing] = record; else history.push(record);
  localStorage.setItem(lsKey(LS_HISTORY), JSON.stringify(history));
}

function removeFromHistory(index) {
  const history = JSON.parse(localStorage.getItem(lsKey(LS_HISTORY)) || '[]')
    .filter(h => h.key !== historyKey(index));
  localStorage.setItem(lsKey(LS_HISTORY), JSON.stringify(history));
}

// ── Calendar ──────────────────────────────────────────────
function shiftCalendar(delta) {
  calendarState.month += delta;
  if (calendarState.month > 11) { calendarState.month = 0; calendarState.year++; }
  if (calendarState.month < 0)  { calendarState.month = 11; calendarState.year--; }
  selectedCalDay = null;
}

function renderCalendar() {
  const history = JSON.parse(localStorage.getItem(lsKey(LS_HISTORY)) || '[]');

  // Badge (always current month)
  const thisMonthCount = history.filter(h => h.date.startsWith(todayStr().slice(0, 7))).length;
  historyBadge.textContent = String(thisMonthCount);
  historyBadge.classList.toggle('hidden', thisMonthCount === 0);

  const displayMonth = `${calendarState.year}-${String(calendarState.month + 1).padStart(2, '0')}`;
  monthlyCount.textContent = String(history.filter(h => h.date.startsWith(displayMonth)).length);

  calMonthLabel.textContent = new Date(calendarState.year, calendarState.month, 1)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  const deliveryDates = new Set(history.map(h => h.date));
  const today = todayStr();

  const firstDay = new Date(calendarState.year, calendarState.month, 1);
  const lastDay  = new Date(calendarState.year, calendarState.month + 1, 0);
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1; // Mon = 0

  const cells = [];
  ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d => cells.push(`<div class="cal-header-cell">${d}</div>`));
  for (let i = 0; i < startDow; i++) cells.push('<div class="cal-cell"></div>');
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const ds  = `${calendarState.year}-${String(calendarState.month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cls = ['cal-cell',
      deliveryDates.has(ds) ? 'has-deliveries' : '',
      ds === today           ? 'is-today'       : '',
      ds === selectedCalDay  ? 'is-selected'    : ''
    ].filter(Boolean).join(' ');
    cells.push(`<div class="${cls}" data-date="${ds}">${d}${deliveryDates.has(ds) ? '<span class="cal-dot"></span>' : ''}</div>`);
  }
  calGrid.innerHTML = cells.join('');

  calGrid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      selectedCalDay = selectedCalDay === cell.dataset.date ? null : cell.dataset.date;
      showCalDayDetail(selectedCalDay, history);
      // Re-mark selected cell without full re-render
      calGrid.querySelectorAll('.cal-cell').forEach(c => c.classList.toggle('is-selected', c.dataset.date === selectedCalDay));
    });
  });

  showCalDayDetail(selectedCalDay, history);

  // Async: fetch route indicators for the displayed month
  fetchRouteIndicators(displayMonth);
}

async function fetchRouteIndicators(month) {
  try {
    const res = await fetch(`${API_BASE}/routes?month=${month}`, { headers: authHeaders() });
    if (!res.ok) return;
    const { routes } = await res.json();
    const routeDates = new Set(routes.map(r => r.routeDate));
    calGrid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
      if (routeDates.has(cell.dataset.date)) cell.classList.add('has-route');
    });
  } catch { /* ignore */ }
}

function showCalDayDetail(dateStr, history) {
  if (!dateStr) { calDayDetail.classList.add('hidden'); return; }
  const dayHistory = (history || [])
    .filter(h => h.date === dateStr)
    .sort((a, b) => a.completedAt.localeCompare(b.completedAt));
  if (!dayHistory.length) { calDayDetail.classList.add('hidden'); return; }
  calDayDetail.classList.remove('hidden');
  calDayDetail.innerHTML = `
    <div class="cal-detail-header">${formatCalDate(dateStr)} — ${dayHistory.length} доставок</div>
    ${dayHistory.map(h => {
      const time = new Date(h.completedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
      return `<div class="history-item">
        <div class="history-addr">${escapeHtml(h.address)}</div>
        <div class="history-meta">${time} · Накладная: ${escapeHtml(h.orderNumber)}</div>
      </div>`;
    }).join('')}`;
}

function formatCalDate(ds) {
  return new Date(ds + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

// ── Tab Switching ─────────────────────────────────────────
function switchTab(tabId) {
  [routeTab, mapTab, historyTab].forEach(t => t.classList.add('hidden'));
  [tabRouteBtn, tabMapBtn, tabHistoryBtn].forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.remove('hidden');
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  if (tabId === 'historyTab') renderCalendar();
  if (tabId === 'mapTab') {
    const saved = localStorage.getItem(LS_MAP_CITY);
    if (mapCityInput && saved !== null) mapCityInput.value = saved;
    renderMap();
  }
}

// ── Helpers ───────────────────────────────────────────────
function pluralRu(n) {
  if (n % 10 === 1 && n % 100 !== 11) return '';
  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'а';
  return 'ов';
}

function escapeHtml(v) {
  return String(v ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}

// ── Map Tab ───────────────────────────────────────────────
const LS_MAP_CITY  = 'lrl_map_city';
const LS_GEOCACHE  = 'lrl_geocache_v3';
let   mapInstance  = null;
let   leafletLoaded = false;

const mapCityInput  = document.getElementById('mapCityInput');
const showMapBtn    = document.getElementById('showMapBtn');
const mapCityStatus = document.getElementById('mapCityStatus');

showMapBtn.addEventListener('click', () => {
  localStorage.setItem(LS_MAP_CITY, mapCityInput.value.trim());
  renderMap();
});

function getGeoCache() {
  try { return JSON.parse(localStorage.getItem(LS_GEOCACHE) || '{}'); } catch { return {}; }
}
function saveGeoCache(c) {
  try { localStorage.setItem(LS_GEOCACHE, JSON.stringify(c)); } catch {}
}

function loadLeaflet() {
  if (leafletLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (!document.querySelector('link[href*="leaflet"]')) {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
      document.head.appendChild(link);
    }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    s.onload = () => { leafletLoaded = true; resolve(); };
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

function expandRuAddress(raw) {
  return raw
    .replace(/^\d{6}[\s,]+/, '')           // strip postal code
    .replace(/\bг\.\s*/gi, '')             // strip city prefix "г."
    .replace(/\bул\.\s*/gi, 'улица ')
    .replace(/\bпр-т\b/gi, 'проспект')
    .replace(/\bпр\.\s*/gi, 'проспект ')
    .replace(/\bпер\.\s*/gi, 'переулок ')
    .replace(/\bб-р\b/gi, 'бульвар')
    .replace(/\bбул\.\s*/gi, 'бульвар ')
    .replace(/\bпл\.\s*/gi, 'площадь ')
    .replace(/\bш\.\s*/gi, 'шоссе ')
    .replace(/\bнаб\.\s*/gi, 'набережная ')
    .replace(/\bмкр\.\s*/gi, 'микрорайон ')
    .replace(/\bд\.\s*(?=\d)/gi, '')       // "д. 5" → "5"
    .replace(/\bкорп?\.\s*(?=\d)/gi, ' корпус ')
    .replace(/\bстр\.\s*(?=\d)/gi, ' строение ')
    .replace(/,\s*,/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

async function geocodeAddr(addr, city) {
  const cacheKey = city ? `${city}|${addr}` : addr;
  const cache = getGeoCache();
  if (cache[cacheKey]) return cache[cacheKey];
  const expanded = expandRuAddress(addr);
  const query    = city ? `${city}, ${expanded}` : expanded;
  try {
    const params = new URLSearchParams({ q: query, format: 'json', limit: '1', countrycodes: 'ru' });
    const res  = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, {
      headers: { 'Accept-Language': 'ru,en' }
    });
    const data = await res.json();
    if (data[0]) {
      const v = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
      saveGeoCache({ ...getGeoCache(), [cacheKey]: v });
      return v;
    }
  } catch {}
  return null;
}

function makeLeafletIcon(num, done) {
  const fill = done ? '#34C759' : '#FF6B00';
  return L.divIcon({
    html: `<div style="width:30px;height:30px;border-radius:50%;background:${fill};border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.25)">${num}</div>`,
    className: '',
    iconSize:   [30, 30],
    iconAnchor: [15, 15],
    popupAnchor:[0, -17],
  });
}

async function renderMap() {
  const city  = localStorage.getItem(LS_MAP_CITY) ?? '';
  const msgEl = document.getElementById('mapMsg');
  const mapEl = document.getElementById('mapContainer');

  // Pre-fill input with saved city
  if (mapCityInput && mapCityInput.value === '' && city) mapCityInput.value = city;

  if (!routeGroups.length) {
    msgEl.textContent = 'Загрузите маршрут, чтобы увидеть карту';
    msgEl.classList.remove('hidden');
    mapEl.classList.add('hidden');
    return;
  }

  msgEl.textContent = 'Загрузка карты…';
  msgEl.classList.remove('hidden');
  mapEl.classList.add('hidden');

  try { await loadLeaflet(); }
  catch {
    msgEl.textContent = 'Ошибка загрузки. Проверьте интернет.';
    return;
  }

  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  msgEl.classList.add('hidden');
  mapEl.classList.remove('hidden');

  mapInstance = L.map(mapEl, { center: [55.75, 37.62], zoom: 10 });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19,
  }).addTo(mapInstance);

  const addrs    = routeGroups.map(g => g[0].row.deliveryAddress).filter(Boolean);
  const bounds   = [];
  let   lastFetch = 0;
  const isIOS    = /iPad|iPhone|iPod/.test(navigator.userAgent);

  for (let i = 0; i < addrs.length; i++) {
    const addr     = addrs[i];
    const cacheKey = city ? `${city}|${addr}` : addr;
    const cached   = getGeoCache()[cacheKey];

    let coords;
    if (cached) {
      coords = cached;
    } else {
      // Nominatim rate limit: ≤1 req/sec
      const wait = 1050 - (Date.now() - lastFetch);
      if (lastFetch && wait > 0) await new Promise(r => setTimeout(r, wait));
      mapCityStatus.textContent = `Поиск: ${i + 1} / ${addrs.length}…`;
      lastFetch = Date.now();
      coords = await geocodeAddr(addr, city);
    }

    if (!coords) continue;

    const group      = routeGroups[i];
    const delivered  = group.every(({ row }) => row._status === 'delivered');
    const firstRow   = group[0].row;
    const phones     = collectGroupPhones(group);
    const naviUrl    = `https://yandex.ru/navi/?text=${encodeURIComponent(addr)}`;
    const naviTarget = isIOS ? '' : ' target="_blank" rel="noopener noreferrer"';
    const callHtml   = phones[0]
      ? `<a href="tel:${phones[0].tel}" style="background:#34C759;color:#fff;padding:9px 13px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;flex-shrink:0">📞</a>`
      : '';

    const popup =
      `<div style="font-family:system-ui,sans-serif;max-width:240px">` +
      `<b style="font-size:14px">#${i + 1} ${escapeHtml(addr)}</b>` +
      (firstRow.buyer       ? `<div style="font-size:12px;margin-top:6px">👤 ${escapeHtml(firstRow.buyer)}</div>` : '') +
      (firstRow.grossWeight ? `<div style="font-size:12px;margin-top:4px">⚖️ ${escapeHtml(firstRow.grossWeight)} кг</div>` : '') +
      (firstRow.comment     ? `<div style="font-size:12px;margin-top:4px">💬 ${escapeHtml(firstRow.comment)}</div>` : '') +
      (delivered ? `<div style="color:#34C759;font-weight:700;font-size:12px;margin-top:6px">✓ Доставлено</div>` : '') +
      `<div style="display:flex;gap:8px;margin-top:10px">` +
      `<a href="${naviUrl}"${naviTarget} style="flex:1;background:#FF6B00;color:#fff;text-align:center;padding:9px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">🧭 Навигатор</a>` +
      callHtml +
      `</div>` +
      `</div>`;

    L.marker([coords.lat, coords.lon], { icon: makeLeafletIcon(i + 1, delivered) })
      .bindPopup(popup)
      .addTo(mapInstance);
    bounds.push([coords.lat, coords.lon]);

    if (bounds.length === 1) mapInstance.setView(bounds[0], 13);
  }

  mapCityStatus.textContent = '';

  if (!bounds.length) {
    mapInstance.remove(); mapInstance = null;
    mapEl.classList.add('hidden');
    msgEl.textContent = city
      ? 'Адреса не найдены. Проверьте правильность города.'
      : 'Адреса не найдены. Введите город и нажмите «Показать».';
    msgEl.classList.remove('hidden');
    return;
  }

  if (bounds.length > 1) mapInstance.fitBounds(bounds, { padding: [40, 40] });
}
