import * as XLSX from 'xlsx';

const API_BASE = '/api';
const SESSION_TOKEN_KEY = 'logiroute_session_token';
const LS_ACTIVE    = 'lrl_active';      // { routeId, date }
const LS_NUMBERS   = 'lrl_numbers';     // { date, suffixes: string[] }
const LS_STATUSES  = 'lrl_statuses';    // { [routeId_index]: status }
const LS_HISTORY   = 'lrl_history';     // DeliveryRecord[]

const AVG_KM_PER_STOP  = 3.5;
const AVG_MIN_PER_STOP = 15;
const AVG_SPEED_KMH    = 40;

const dataColumns = {
  orderNumber: 0, deliveryAddress: 2, grossWeight: 4,
  buyer: 5, comment: 7, responsible: 8, deliveryService: 9, orderId: 11
};

// ── DOM ───────────────────────────────────────────────────
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
const tabRouteBtn    = document.getElementById('tabRouteBtn');
const tabHistoryBtn  = document.getElementById('tabHistoryBtn');
const historyBadge   = document.getElementById('historyBadge');
const routeTab       = document.getElementById('routeTab');
const historyTab     = document.getElementById('historyTab');
const historyList    = document.getElementById('historyList');
const monthlyCount   = document.getElementById('monthlyCount');
const dropzone       = document.getElementById('dropzone');
const statKm         = document.getElementById('statKm');
const statTime       = document.getElementById('statTime');
const statSpeed      = document.getElementById('statSpeed');

let currentUser  = null;
let currentRows  = [];      // filtered route rows currently displayed
let activeRouteId= null;    // backend route ID for today
let dragSrcIndex = null;

// ── Startup ───────────────────────────────────────────────
loginForm.addEventListener('submit', handleLogin);
logoutBtn.addEventListener('click', handleLogout);
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
tabRouteBtn.addEventListener('click',   () => switchTab('routeTab'));
tabHistoryBtn.addEventListener('click', () => switchTab('historyTab'));
['dragenter', 'dragover'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.add('dragover'); }));
['dragleave', 'drop'].forEach(ev => dropzone.addEventListener(ev, e => { e.preventDefault(); dropzone.classList.remove('dragover'); }));
dropzone.addEventListener('drop', e => { if (e.dataTransfer.files[0]) processFile(e.dataTransfer.files[0]); });

bootstrap();

// ── Auth ─────────────────────────────────────────────────
async function bootstrap() {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  try {
    const res = await fetch(`${API_BASE}/me`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (res.ok) {
      currentUser = (await res.json()).user;
      showApp();
      await loadTodayRoute();
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
    showApp();
    await loadTodayRoute();
  } catch { setAuthMsg('Ошибка соединения с сервером', true); }
}

async function handleLogout() {
  currentUser = null;
  localStorage.removeItem(SESSION_TOKEN_KEY);
  showAuth();
}

function setAuthMsg(text, isError) {
  authMessage.textContent = text;
  authMessage.className = 'auth-message' + (isError ? ' error' : '');
}

function showAuth() {
  authPanel.classList.remove('hidden');
  appPanel.classList.add('hidden');
  setAuthMsg('Демо: driver / driver123', false);
  loginInput.value = '';
  passwordInput.value = '';
}

function showApp() {
  authPanel.classList.add('hidden');
  appPanel.classList.remove('hidden');
  headerUser.textContent = currentUser?.login || 'Водитель';
  loadSavedNumbers();
  renderHistory();
}

// ── Numbers Filter ────────────────────────────────────────
function todayStr() { return new Date().toISOString().slice(0, 10); }

function getFilterSuffixes() {
  try {
    const saved = JSON.parse(localStorage.getItem(LS_NUMBERS) || 'null');
    if (saved?.date === todayStr()) return saved.suffixes;
  } catch { /* ignore */ }
  return [];
}

function loadSavedNumbers() {
  const suffixes = getFilterSuffixes();
  if (suffixes.length) {
    numbersInput.value = suffixes.join(', ');
    showNumbersStatus(suffixes);
  }
}

function saveNumbers() {
  const raw = numbersInput.value;
  const suffixes = parseFilterInput(raw);
  if (!suffixes.length) {
    numbersStatus.textContent = 'Введите хотя бы одно число';
    return;
  }
  localStorage.setItem(LS_NUMBERS, JSON.stringify({ date: todayStr(), suffixes }));
  showNumbersStatus(suffixes);
}

function showNumbersStatus(suffixes) {
  numbersStatus.textContent = `Активно: ${suffixes.join(', ')} (${suffixes.length} маршрут${pluralRu(suffixes.length)})`;
}

function parseFilterInput(raw) {
  return raw.split(',').map(s => s.trim().replace(/\D/g, '')).filter(s => s.length > 0);
}

// ── Persistence: load today's route ───────────────────────
async function loadTodayRoute() {
  if (!currentUser) return;
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  const headers = token ? { Authorization: `Bearer ${token}` } : {};

  // Check if we have a stored activeRoute for today
  const saved = JSON.parse(localStorage.getItem(LS_ACTIVE) || 'null');
  if (saved?.date === todayStr() && saved.routeId) {
    activeRouteId = saved.routeId;
    // Verify it still exists on the backend and load items
    const res = await fetch(`${API_BASE}/routes/${activeRouteId}/items`, { headers });
    if (res.ok) {
      const { items } = await res.json();
      if (items.length) {
        currentRows = items;
        restoreStatuses();
        renderRoute(currentRows);
        statusPanel.textContent = `Маршрут загружен: ${currentRows.length} точек.`;
        return;
      }
    }
  }

  // Fallback: query today's routes from backend and use the latest
  const res = await fetch(`${API_BASE}/routes?date=${todayStr()}`, { headers });
  if (!res.ok) return;
  const { routes } = await res.json();
  if (!routes?.length) return;

  const latest = routes[routes.length - 1];
  activeRouteId = latest.id;
  localStorage.setItem(LS_ACTIVE, JSON.stringify({ date: todayStr(), routeId: activeRouteId }));

  const itemsRes = await fetch(`${API_BASE}/routes/${activeRouteId}/items`, { headers });
  if (!itemsRes.ok) return;
  const { items } = await itemsRes.json();
  if (items.length) {
    currentRows = items;
    restoreStatuses();
    renderRoute(currentRows);
    statusPanel.textContent = `Маршрут загружен: ${currentRows.length} точек.`;
  }
}

// Restore per-card statuses from localStorage
function restoreStatuses() {
  if (!activeRouteId) return;
  const all = JSON.parse(localStorage.getItem(LS_STATUSES) || '{}');
  currentRows.forEach((row, i) => {
    row._status = all[`${activeRouteId}_${i}`] || 'pending';
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
  statusPanel.textContent = `Читаем файл…`;
  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false });
    const rows = extractRowsFromWorkbook(workbook);
    const filtered = rows.filter(r => {
      const num = normalizeText(r.orderNumber);
      return suffixes.some(s => num.endsWith(s));
    });
    if (!filtered.length) {
      statusPanel.textContent = `Совпадений не найдено. Проверьте номера (${suffixes.join(', ')}).`;
      return;
    }
    filtered.forEach(r => { r._status = 'pending'; });
    currentRows = filtered;
    renderRoute(currentRows);
    statusPanel.textContent = `Найдено ${currentRows.length} точек.`;

    // Save to backend
    const routeId = await saveRoute(file.name, currentRows);
    if (routeId) {
      activeRouteId = routeId;
      localStorage.setItem(LS_ACTIVE, JSON.stringify({ date: todayStr(), routeId }));
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
    const rows = [];
    for (let r = range.s.r; r <= range.e.r; r++) rows.push(readRow(sheet, r, range.e.c));
    for (let r = 3; r < rows.length; r++) {
      const row = rows[r] || [];
      if (!row.some(c => String(c ?? '').trim() !== '')) continue;
      const mapped = mapRow(row);
      // Skip header-ish rows
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
  return String(value ?? '').replace(/\u00A0/g, ' ').replace(/\t/g, ' ')
    .trim().replace(/\s+/g, ' ').toUpperCase();
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
      sourceFileName,
      routeDate: todayStr(),
      status: 'active',
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

// ── Render Route ──────────────────────────────────────────
function renderRoute(rows) {
  resultCount.textContent = `${rows.length} точек`;
  updateStats(rows.length);
  allDeliveredBtn.classList.toggle('hidden', rows.length === 0);

  if (!rows.length) {
    routeList.innerHTML = '<div class="empty-state">Совпадений не найдено</div>';
    return;
  }
  routeList.innerHTML = '';
  rows.forEach((row, i) => routeList.appendChild(createRouteCard(row, i)));
}

function updateStats(n) {
  const km = Math.round(n * AVG_KM_PER_STOP);
  const totalMin = n * AVG_MIN_PER_STOP;
  const h = Math.floor(totalMin / 60), m = totalMin % 60;
  statKm.textContent   = n ? km : '0';
  statTime.textContent = n ? (h ? `${h}ч${m ? m + 'м' : ''}` : `${m}м`) : '0м';
  statSpeed.textContent = n ? `${AVG_SPEED_KMH}` : '—';
}

// ── Route Card ────────────────────────────────────────────
function createRouteCard(row, index) {
  const address  = row.deliveryAddress || 'Адрес не указан';
  const orderId  = row.orderId  || '—';
  const orderNum = row.orderNumber || '—';
  const yandex   = `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`;
  const status   = row._status || 'pending';

  const card = document.createElement('div');
  card.className = 'route-card' + (status === 'delivered' ? ' is-delivered' : '');
  card.draggable = true;
  card.dataset.index = String(index);

  card.innerHTML = `
    <div class="card-main">
      <div class="drag-handle-icon" aria-hidden="true">
        <span class="dot"></span><span class="dot"></span>
        <span class="dot"></span><span class="dot"></span>
        <span class="dot"></span><span class="dot"></span>
      </div>
      <div class="route-badge">${index + 1}</div>
      <div class="route-info">
        <div class="route-address" title="${escapeHtml(address)}">${escapeHtml(address)}</div>
        <div class="route-ordnum">Накладная: ${escapeHtml(orderNum)}</div>
      </div>
      <div class="route-actions">
        <select class="status-select ${status !== 'pending' ? 'status-' + status : ''}" aria-label="Статус">
          <option value="pending"    ${status === 'pending'    ? 'selected' : ''}>Ожидает</option>
          <option value="inprogress" ${status === 'inprogress' ? 'selected' : ''}>В пути</option>
          <option value="delivered"  ${status === 'delivered'  ? 'selected' : ''}>Доставлен</option>
          <option value="failed"     ${status === 'failed'     ? 'selected' : ''}>Не доставлен</option>
        </select>
        <button class="maps-btn" type="button">Maps</button>
      </div>
    </div>
    <div class="card-details hidden">
      <div class="detail-grid">
        <div><strong>Адрес</strong><span>${escapeHtml(address)}</span></div>
        <div><strong>Номер заказа</strong><span>${escapeHtml(orderId)}</span></div>
        <div><strong>Вес (кг)</strong><span>${escapeHtml(row.grossWeight) || '—'}</span></div>
        <div><strong>Покупатель</strong><span>${escapeHtml(row.buyer) || '—'}</span></div>
        <div><strong>Комментарий</strong><span>${escapeHtml(row.comment) || '—'}</span></div>
        <div><strong>Ответственный</strong><span>${escapeHtml(row.responsible) || '—'}</span></div>
        <div><strong>Служба доставки</strong><span>${escapeHtml(row.deliveryService) || '—'}</span></div>
        <div><strong>Номер РасхНакл</strong><span>${escapeHtml(orderNum)}</span></div>
      </div>
    </div>
  `;

  // Expand/collapse on clicking the info area
  const cardMain = card.querySelector('.card-main');
  const details  = card.querySelector('.card-details');
  cardMain.addEventListener('click', e => {
    if (e.target.closest('.route-actions')) return;  // don't expand when clicking actions
    details.classList.toggle('hidden');
  });

  // Status select
  const select = card.querySelector('.status-select');
  select.addEventListener('change', e => {
    e.stopPropagation();
    const newStatus = select.value;
    row._status = newStatus;
    select.className = `status-select${newStatus !== 'pending' ? ' status-' + newStatus : ''}`;
    card.classList.toggle('is-delivered', newStatus === 'delivered');
    card.querySelector('.route-badge').style.background = newStatus === 'delivered' ? 'var(--green)' : '';
    persistStatus(index, newStatus);
    if (newStatus === 'delivered') addToHistory(row, index);
    else removeFromHistory(index);
    renderHistory();
  });

  // Maps button
  card.querySelector('.maps-btn').addEventListener('click', e => {
    e.stopPropagation();
    window.open(yandex, '_blank', 'noopener,noreferrer');
  });

  // Drag events
  card.addEventListener('dragstart', onCardDragStart);
  card.addEventListener('dragover',  onCardDragOver);
  card.addEventListener('drop',      onCardDrop);
  card.addEventListener('dragend',   onCardDragEnd);

  return card;
}

// ── Drag & Drop ───────────────────────────────────────────
function onCardDragStart(ev) {
  dragSrcIndex = parseInt(this.dataset.index, 10);
  ev.dataTransfer.effectAllowed = 'move';
  requestAnimationFrame(() => this.classList.add('dragging'));
}
function onCardDragOver(ev) {
  ev.preventDefault(); ev.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.route-card').forEach(c => c.classList.remove('drag-over'));
  this.classList.add('drag-over');
}
function onCardDrop(ev) {
  ev.preventDefault();
  const dest = parseInt(this.dataset.index, 10);
  if (dragSrcIndex === null || dragSrcIndex === dest) return;
  const [moved] = currentRows.splice(dragSrcIndex, 1);
  currentRows.splice(dest, 0, moved);
  renderRoute(currentRows);
}
function onCardDragEnd() {
  document.querySelectorAll('.route-card').forEach(c => c.classList.remove('dragging', 'drag-over'));
  dragSrcIndex = null;
}

// ── Bulk: All Delivered ───────────────────────────────────
function markAllDelivered() {
  currentRows.forEach((row, i) => {
    row._status = 'delivered';
    persistStatus(i, 'delivered');
    addToHistory(row, i);
  });
  renderRoute(currentRows);
  renderHistory();
}

// ── Status Persistence (localStorage) ────────────────────
function persistStatus(index, status) {
  if (!activeRouteId) return;
  const all = JSON.parse(localStorage.getItem(LS_STATUSES) || '{}');
  all[`${activeRouteId}_${index}`] = status;
  localStorage.setItem(LS_STATUSES, JSON.stringify(all));
}

// ── History ───────────────────────────────────────────────
function historyKey(index) { return `${activeRouteId || 'local'}_${index}`; }

function addToHistory(row, index) {
  const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]');
  const key = historyKey(index);
  const existing = history.findIndex(h => h.key === key);
  const record = {
    key,
    date: todayStr(),
    completedAt: new Date().toISOString(),
    address:     row.deliveryAddress || 'Адрес не указан',
    orderNumber: row.orderNumber || '—',
    orderId:     row.orderId || '—',
    buyer:       row.buyer || ''
  };
  if (existing >= 0) history[existing] = record;
  else history.push(record);
  localStorage.setItem(LS_HISTORY, JSON.stringify(history));
}

function removeFromHistory(index) {
  const key = historyKey(index);
  const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]')
    .filter(h => h.key !== key);
  localStorage.setItem(LS_HISTORY, JSON.stringify(history));
}

function renderHistory() {
  const history = JSON.parse(localStorage.getItem(LS_HISTORY) || '[]');
  const currentMonth = todayStr().slice(0, 7);
  const thisMonth = history.filter(h => h.date.startsWith(currentMonth));

  // Update badge and counter
  const count = thisMonth.length;
  monthlyCount.textContent = String(count);
  historyBadge.textContent = String(count);
  historyBadge.classList.toggle('hidden', count === 0);

  if (!history.length) {
    historyList.innerHTML = '<div class="empty-state">Нет завершённых доставок</div>';
    return;
  }

  // Sort newest first
  const sorted = [...history].sort((a, b) => b.completedAt.localeCompare(a.completedAt));
  historyList.innerHTML = sorted.map(h => {
    const time = new Date(h.completedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return `
      <div class="history-item">
        <div class="history-addr">${escapeHtml(h.address)}</div>
        <div class="history-meta">${h.date} · ${time} · Накладная: ${escapeHtml(h.orderNumber)}</div>
      </div>`;
  }).join('');
}

// ── Tab Switching ─────────────────────────────────────────
function switchTab(tabId) {
  [routeTab, historyTab].forEach(t => t.classList.add('hidden'));
  [tabRouteBtn, tabHistoryBtn].forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.remove('hidden');
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  if (tabId === 'historyTab') renderHistory();
}

// ── Helpers ───────────────────────────────────────────────
function pluralRu(n) {
  if (n % 10 === 1 && n % 100 !== 11) return '';
  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'а';
  return 'ов';
}

function escapeHtml(v) {
  return String(v ?? '')
    .replaceAll('&', '&amp;').replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;');
}
