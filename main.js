// LogiRoute CRM frontend.
// Entry point for three roles:
//   - driver:               read-only dashboard of orders assigned for the day
//   - manager / supervisor: ops dashboard (CRUD orders, assign drivers, export)
//   - admin / supervisor:   user management tab inside the ops dashboard

const API_BASE = '/api';
const SESSION_TOKEN_KEY = 'logiroute_session_token';
const LS_TAB        = 'lrl_active_tab';
const LS_OPS_TAB    = 'lrl_ops_tab';

// ── DOM refs (auth) ───────────────────────────────────────
const authPanel      = document.getElementById('authPanel');
const loginForm      = document.getElementById('loginForm');
const loginInput     = document.getElementById('loginInput');
const passwordInput  = document.getElementById('passwordInput');
const authMessage    = document.getElementById('authMessage');
const togglePwd      = document.getElementById('togglePwd');

// ── DOM refs (driver) ─────────────────────────────────────
const appPanel       = document.getElementById('appPanel');
const logoutBtn      = document.getElementById('logoutBtn');
const headerUser     = document.getElementById('headerUser');
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

// ── DOM refs (ops dashboard) ──────────────────────────────
const opsPanel        = document.getElementById('opsPanel');
const opsLogoutBtn    = document.getElementById('opsLogoutBtn');
const opsHeaderUser   = document.getElementById('opsHeaderUser');
const tabOpsOrdersBtn = document.getElementById('tabOpsOrdersBtn');
const tabOpsInboxBtn  = document.getElementById('tabOpsInboxBtn');
const tabOpsStatsBtn  = document.getElementById('tabOpsStatsBtn');
const tabOpsExportBtn = document.getElementById('tabOpsExportBtn');
const tabOpsUsersBtn  = document.getElementById('tabOpsUsersBtn');
const opsOrdersTab    = document.getElementById('opsOrdersTab');
const opsInboxTab     = document.getElementById('opsInboxTab');
const opsStatsTab     = document.getElementById('opsStatsTab');
const opsExportTab    = document.getElementById('opsExportTab');
const opsUsersTab     = document.getElementById('opsUsersTab');
const opsDatePicker   = document.getElementById('opsDatePicker');
const opsDatePrevBtn  = document.getElementById('opsDatePrevBtn');
const opsDateNextBtn  = document.getElementById('opsDateNextBtn');
const opsDriverFilter = document.getElementById('opsDriverFilter');
const opsAddOrderBtn  = document.getElementById('opsAddOrderBtn');
const opsAddOrderForm = document.getElementById('opsAddOrderForm');
const opsFormTitle    = document.getElementById('opsFormTitle');
const ordAddress      = document.getElementById('ordAddress');
const ordTime         = document.getElementById('ordTime');
const ordDriver       = document.getElementById('ordDriver');
const ordBuyer        = document.getElementById('ordBuyer');
const ordWeight       = document.getElementById('ordWeight');
const ordExternalNo   = document.getElementById('ordExternalNo');
const ordDescription  = document.getElementById('ordDescription');
const ordComment      = document.getElementById('ordComment');
const opsFormError    = document.getElementById('opsFormError');
const opsSaveOrderBtn = document.getElementById('opsSaveOrderBtn');
const opsCancelOrderBtn = document.getElementById('opsCancelOrderBtn');
const opsOrderCount   = document.getElementById('opsOrderCount');
const opsOrdersList   = document.getElementById('opsOrdersList');
const exportDate      = document.getElementById('exportDate');
const exportDriver    = document.getElementById('exportDriver');
const opsUsersCount   = document.getElementById('opsUsersCount');
const opsAddUserBtn   = document.getElementById('opsAddUserBtn');
const opsAddUserForm  = document.getElementById('opsAddUserForm');
const newUserLogin    = document.getElementById('newUserLogin');
const newUserPassword = document.getElementById('newUserPassword');
const newUserRole     = document.getElementById('newUserRole');
const newUserFullName = document.getElementById('newUserFullName');
const opsUserError    = document.getElementById('opsUserError');
const opsSaveUserBtn  = document.getElementById('opsSaveUserBtn');
const opsCancelUserBtn= document.getElementById('opsCancelUserBtn');
const opsUsersList    = document.getElementById('opsUsersList');

// ── State ─────────────────────────────────────────────────
let currentUser       = null;
let currentRows       = [];     // driver: orders for the selected date, mapped to display rows
let routeGroups       = [];     // driver: rows grouped by normalized address
let dragSrcGroupIdx   = null;
let touchDragState    = null;
let selectedDate      = todayStr(); // driver
let calendarState     = { year: new Date().getFullYear(), month: new Date().getMonth() };
let selectedCalDay    = null;
let driverHistoryByMonth = new Map(); // month -> Set of dates that had a delivery

// ops state
let opsSelectedDate   = todayStr();
let opsDrivers        = [];     // [{id, login, fullName, unloadingTimeMinutes}]
let opsOrders         = [];
let opsEditingId      = null;

// ── Event listeners (auth) ────────────────────────────────
loginForm.addEventListener('submit', handleLogin);
logoutBtn.addEventListener('click', handleLogout);
opsLogoutBtn.addEventListener('click', handleLogout);
togglePwd.addEventListener('click', () => {
  const show = passwordInput.type === 'password';
  passwordInput.type = show ? 'text' : 'password';
  togglePwd.textContent = show ? '🔒' : '👁';
});

// ── Event listeners (driver) ──────────────────────────────
allDeliveredBtn.addEventListener('click', markAllDelivered);
yandexRouteBtn.addEventListener('click', e => { e.stopPropagation(); openRouteMenu(yandexRouteBtn); });
tabRouteBtn.addEventListener('click',   () => switchDriverTab('routeTab'));
tabMapBtn.addEventListener('click',     () => switchDriverTab('mapTab'));
tabHistoryBtn.addEventListener('click', () => switchDriverTab('historyTab'));
routeDatePicker.addEventListener('change', () => onDriverDateChange());
datePrevBtn.addEventListener('click', () => shiftDriverDate(-1));
dateNextBtn.addEventListener('click', () => shiftDriverDate(+1));
calPrevBtn.addEventListener('click',   () => { shiftCalendar(-1); renderCalendar(); });
calNextBtn.addEventListener('click',   () => { shiftCalendar(1);  renderCalendar(); });

// ── Event listeners (ops) ─────────────────────────────────
tabOpsOrdersBtn.addEventListener('click', () => switchOpsTab('opsOrdersTab'));
tabOpsInboxBtn .addEventListener('click', () => switchOpsTab('opsInboxTab'));
tabOpsStatsBtn .addEventListener('click', () => switchOpsTab('opsStatsTab'));
tabOpsExportBtn.addEventListener('click', () => switchOpsTab('opsExportTab'));
tabOpsUsersBtn .addEventListener('click', () => switchOpsTab('opsUsersTab'));
opsDatePicker.addEventListener('change', () => onOpsDateChange());
opsDatePrevBtn.addEventListener('click', () => shiftOpsDate(-1));
opsDateNextBtn.addEventListener('click', () => shiftOpsDate(+1));
opsDriverFilter.addEventListener('change', loadOpsOrders);
opsAddOrderBtn.addEventListener('click', () => openOrderForm(null));
opsCancelOrderBtn.addEventListener('click', closeOrderForm);
opsSaveOrderBtn.addEventListener('click', saveOrderForm);
document.querySelectorAll('[data-export]').forEach(btn =>
  btn.addEventListener('click', () => exportOrders(btn.dataset.export))
);
opsAddUserBtn.addEventListener('click', () => {
  opsAddUserForm.classList.remove('hidden');
  opsUserError.classList.add('hidden');
});
opsCancelUserBtn.addEventListener('click', () => {
  opsAddUserForm.classList.add('hidden');
  newUserLogin.value = ''; newUserPassword.value = '';
  newUserRole.value = 'driver'; newUserFullName.value = '';
});
opsSaveUserBtn.addEventListener('click', saveOpsUser);

// ── Touch drag-and-drop for driver route reordering ──────
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

bootstrap();

// ── Auth ──────────────────────────────────────────────────
async function bootstrap() {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  try {
    const res = await fetch(`${API_BASE}/me`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (res.ok) {
      currentUser = (await res.json()).user;
      await routeByRole();
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
    await routeByRole();
  } catch { setAuthMsg('Ошибка соединения с сервером', true); }
}

async function handleLogout() {
  try { await fetch(`${API_BASE}/logout`, { method: 'POST', headers: authHeaders() }); } catch { /* ignore */ }
  localStorage.removeItem(SESSION_TOKEN_KEY);
  location.reload();
}

async function routeByRole() {
  switch (currentUser?.role) {
    case 'driver':                  return showDriverApp();
    case 'manager':
    case 'supervisor':
    case 'admin':                   return showOpsApp();
    default:                        return showAuth();
  }
}

function setAuthMsg(text, isError) {
  authMessage.textContent = text;
  authMessage.className = 'auth-message' + (isError ? ' error' : '');
}

function showAuth() {
  authPanel.classList.remove('hidden');
  appPanel.classList.add('hidden');
  opsPanel.classList.add('hidden');
  setAuthMsg('', false);
  loginInput.value = ''; passwordInput.value = '';
}

async function showDriverApp() {
  authPanel.classList.add('hidden');
  opsPanel.classList.add('hidden');
  appPanel.classList.remove('hidden');
  headerUser.textContent = currentUser?.fullName || currentUser?.login || 'Водитель';
  selectedDate = todayStr();
  routeDatePicker.value = selectedDate;
  routeDatePicker.classList.toggle('is-today', true);
  await loadDriverOrdersForDate(selectedDate);
  renderCalendar();
  const savedTab = localStorage.getItem(LS_TAB);
  if (savedTab && ['routeTab', 'mapTab', 'historyTab'].includes(savedTab)) switchDriverTab(savedTab);
}

async function showOpsApp() {
  authPanel.classList.add('hidden');
  appPanel.classList.add('hidden');
  opsPanel.classList.remove('hidden');
  const roleLabel = { manager: 'Менеджер', supervisor: 'Супервайзер', admin: 'Администратор' }[currentUser.role] || '';
  opsHeaderUser.textContent = `${currentUser?.fullName || currentUser?.login} · ${roleLabel}`;

  // Show users tab only to elevated roles
  if (currentUser.role === 'supervisor' || currentUser.role === 'admin') {
    tabOpsUsersBtn.classList.remove('hidden');
  }

  opsSelectedDate = todayStr();
  opsDatePicker.value = opsSelectedDate;
  exportDate.value = opsSelectedDate;

  await loadOpsDrivers();
  await loadOpsOrders();

  const savedTab = localStorage.getItem(LS_OPS_TAB);
  if (savedTab && ['opsOrdersTab', 'opsInboxTab', 'opsStatsTab', 'opsExportTab', 'opsUsersTab'].includes(savedTab)) switchOpsTab(savedTab);
}

// ── Common helpers ────────────────────────────────────────
function authHeaders() {
  const token = localStorage.getItem(SESSION_TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function shiftDateStr(dateStr, delta) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
}

function escapeHtml(v) {
  return String(v ?? '')
    .replaceAll('&','&amp;').replaceAll('<','&lt;')
    .replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
function pluralRu(n) {
  if (n % 10 === 1 && n % 100 !== 11) return '';
  if ([2,3,4].includes(n % 10) && ![12,13,14].includes(n % 100)) return 'а';
  return 'ов';
}
function pluralWord(n, one, few, many) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if ([2,3,4].includes(m10) && ![12,13,14].includes(m100)) return few;
  return many;
}

function showToast(msg, ms = 2800) {
  let el = document.querySelector('.app-toast');
  if (!el) { el = document.createElement('div'); el.className = 'app-toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.add('visible');
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.remove('visible'), ms);
}

// ── Driver: date navigation ──────────────────────────────
function onDriverDateChange() {
  const val = routeDatePicker.value;
  if (!val) return;
  selectedDate = val;
  routeDatePicker.classList.toggle('is-today', val === todayStr());
  loadDriverOrdersForDate(val);
}
function shiftDriverDate(delta) {
  const next = shiftDateStr(routeDatePicker.value || todayStr(), delta);
  routeDatePicker.value = next;
  selectedDate = next;
  routeDatePicker.classList.toggle('is-today', next === todayStr());
  loadDriverOrdersForDate(next);
}

// ── Driver: load orders ──────────────────────────────────
async function loadDriverOrdersForDate(dateStr) {
  if (!currentUser) return;
  statusPanel.textContent = 'Загрузка…';
  try {
    const res = await fetch(`${API_BASE}/orders?date=${dateStr}`, { headers: authHeaders() });
    if (!res.ok) throw new Error('load failed');
    const { orders } = await res.json();
    currentRows = orders.map(orderToRow);
    statusPanel.textContent = currentRows.length
      ? `Маршрут: ${currentRows.length} ${pluralWord(currentRows.length, 'точка', 'точки', 'точек')}.`
      : '';
    renderRoute(currentRows);
  } catch {
    statusPanel.textContent = 'Не удалось загрузить заказы.';
    currentRows = [];
    renderRoute([]);
  }
}

// Map server order → row shape consumed by render code (legacy field names preserved
// so the existing card layout keeps working).
function orderToRow(o) {
  return {
    _orderId:        o.id,
    _serverStatus:   o.status,
    deliveryAddress: o.address,
    orderNumber:     o.externalOrderNo || (o.scheduledTime || ''),
    orderId:         o.externalOrderNo || '',
    grossWeight:     o.weightKg ?? '',
    buyer:           o.buyer || '',
    comment:         o.comment || '',
    description:     o.description || '',
    scheduledTime:   o.scheduledTime || '',
    responsible:     '',
    deliveryService: '',
    geocodedLat:     o.geocodedLat,
    geocodedLon:     o.geocodedLon,
    _status:         o.status === 'delivered' ? 'delivered' : 'pending'
  };
}

// ── Driver: status push ──────────────────────────────────
async function pushOrderStatus(orderId, nextStatus) {
  const res = await fetch(`${API_BASE}/orders/${orderId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ status: nextStatus })
  });
  if (!res.ok) {
    showToast('Не удалось обновить статус');
    return false;
  }
  return true;
}

// ── Address grouping (unchanged) ─────────────────────────
function normalizeAddress(addr) {
  return expandRuAddress(addr || '').toLowerCase();
}
function groupRowsByAddress(rows) {
  const groups = [];
  const keyMap = new Map();
  rows.forEach((row, idx) => {
    const key = normalizeAddress(row.deliveryAddress);
    if (keyMap.has(key)) groups[keyMap.get(key)].push({ row, idx });
    else { keyMap.set(key, groups.length); groups.push([{ row, idx }]); }
  });
  return groups;
}

// ── Driver: render route ─────────────────────────────────
function renderRoute(rows) {
  routeGroups = groupRowsByAddress(rows);
  const pointCount = routeGroups.length;
  resultCount.textContent = `${pointCount} ${pluralWord(pointCount, 'точка', 'точки', 'точек')}`;
  allDeliveredBtn.classList.toggle('hidden', !rows.length);
  yandexRouteBtn.classList.toggle('hidden', !rows.length);
  progressPanel.classList.toggle('hidden', !rows.length);
  if (!rows.length) {
    routeList.innerHTML = '<div class="empty-state">Заказы на этот день ещё не назначены</div>';
    updateProgress();
    return;
  }
  routeList.innerHTML = '';
  routeGroups.forEach((group, gIdx) => routeList.appendChild(createGroupCard(group, gIdx)));
  updateProgress();
}

function updateProgress() {
  const total = routeGroups.length;
  const done  = routeGroups.filter(g => g.every(({ row }) => row._status === 'delivered')).length;
  const pct   = total ? Math.round((done / total) * 100) : 0;
  progressDone.textContent    = String(done);
  progressTotal.textContent   = String(total);
  progressPercent.textContent = `${pct}%`;
  progressFill.style.width    = `${pct}%`;
}

// ── Phone extraction (unchanged) ─────────────────────────
function extractPhones(text) {
  if (!text) return [];
  const re = /(\+?[78])([\s\-.() ]*(?:\d[\s\-.() ]*)){10}/g;
  const phones = []; const seen = new Set();
  for (const match of String(text).match(re) || []) {
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
  const phones = []; const seen = new Set();
  for (const { row } of group) {
    const text = `${row.comment || ''}\n${row.description || ''}`;
    for (const p of extractPhones(text)) {
      if (!seen.has(p.tel)) { seen.add(p.tel); phones.push(p); }
    }
  }
  return phones;
}

// ── Popup menus & link openers (unchanged) ───────────────
function closePopups() { document.querySelectorAll('.popup-menu').forEach(el => el.remove()); }
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
  const rect = anchor.getBoundingClientRect();
  menu.style.position = 'fixed';
  menu.style.top = `${Math.min(rect.bottom + 6, window.innerHeight - menu.offsetHeight - 8)}px`;
  const right = Math.max(8, window.innerWidth - rect.right);
  menu.style.right = `${right}px`;
  const onOutside = (ev) => { if (!menu.contains(ev.target)) closePopups(); };
  const onEsc = (ev) => { if (ev.key === 'Escape') closePopups(); };
  setTimeout(() => {
    document.addEventListener('click', onOutside, { once: true });
    document.addEventListener('keydown', onEsc, { once: true });
  }, 0);
  menu.addEventListener('click', e => {
    setTimeout(closePopups, 0);
    if (e.target.closest('a[href="#"]')) e.preventDefault();
  });
}
function openLink(url) {
  const a = document.createElement('a');
  a.href = url; a.target = '_blank'; a.rel = 'noopener noreferrer';
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
}

function buildRouteUrls(addrs) {
  const rtext  = addrs.map(encodeURIComponent).join('~');
  const isIOS  = /iPad|iPhone|iPod/.test(navigator.userAgent);
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
    { label: 'Яндекс Карты',     icon: '🗺', href: yandex, external: yandexNew },
    { label: 'Яндекс Навигатор', icon: '🧭', href: navi,   external: naviNew  }
  ]);
}

// ── Group card ───────────────────────────────────────────
function groupInfoEqual(group) {
  if (group.length <= 1) return true;
  const ref = group[0].row;
  return group.slice(1).every(({ row }) =>
    row.grossWeight    === ref.grossWeight &&
    row.buyer          === ref.buyer &&
    row.comment        === ref.comment &&
    row.description    === ref.description
  );
}
function detailGridHtml(row, address) {
  return `<div class="detail-grid">
    <div><strong>Адрес</strong><span>${escapeHtml(address)}</span></div>
    ${row.scheduledTime ? `<div><strong>Время</strong><span>${escapeHtml(row.scheduledTime)}</span></div>` : ''}
    ${row.description  ? `<div><strong>Описание</strong><span>${escapeHtml(row.description)}</span></div>` : ''}
    ${row.grossWeight !== '' && row.grossWeight != null
        ? `<div><strong>Вес (кг)</strong><span>${escapeHtml(row.grossWeight)}</span></div>` : ''}
    ${row.buyer        ? `<div><strong>Покупатель</strong><span>${escapeHtml(row.buyer)}</span></div>` : ''}
    ${row.comment      ? `<div><strong>Комментарий</strong><span>${escapeHtml(row.comment)}</span></div>` : ''}
    ${row.orderNumber  ? `<div><strong>Накладная</strong><span>${escapeHtml(row.orderNumber)}</span></div>` : ''}
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

  let detailsHtml = '';
  if (!isMulti) {
    detailsHtml = detailGridHtml(firstRow, address);
  } else if (sameInfo) {
    const invoiceNums = group.map(({ row }) => escapeHtml(row.orderNumber || '—')).join(', ');
    detailsHtml = detailGridHtml(firstRow, address) + `
      <div class="group-invoice-list">
        <span class="group-invoice-label">Заказы:</span>
        <span class="group-invoice-nums">${invoiceNums}</span>
      </div>`;
  } else {
    detailsHtml = group.map(({ row, idx }) => `
      <div class="group-order-section">
        <div class="group-section-header">
          <span>${escapeHtml(row.orderNumber || row.scheduledTime || '—')}</span>
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

  const subline = isMulti
    ? `<span class="group-badge-count">${group.length} ${pluralWord(group.length, 'заказ', 'заказа', 'заказов')}</span>`
    : (firstRow.scheduledTime
        ? `🕒 ${escapeHtml(firstRow.scheduledTime)}${firstRow.description ? ` · ${escapeHtml(firstRow.description)}` : ''}`
        : (firstRow.description ? escapeHtml(firstRow.description) : ''));

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
        <div class="route-ordnum">${subline}</div>
      </div>
      <div class="route-actions">
        ${headerDeliveredBtn}
        ${callBtn}
        <button class="maps-btn" type="button">Maps</button>
      </div>
    </div>
    <div class="card-details hidden">${detailsHtml}</div>
  `;

  function refreshBadge() {
    const nowAllDel = group.every(({ row }) => row._status === 'delivered');
    card.classList.toggle('is-delivered', nowAllDel);
    card.querySelector('.route-badge').style.background = nowAllDel ? 'var(--green)' : '';
  }

  const details = card.querySelector('.card-details');
  card.addEventListener('click', e => {
    if (e.target.closest('button, select, a, input')) return;
    details.classList.toggle('hidden');
  });

  // Group-level delivered toggle (single item or merged sameInfo group)
  const groupDeliveredBtn = card.querySelector('[data-group-delivered]');
  if (groupDeliveredBtn) {
    groupDeliveredBtn.addEventListener('click', async e => {
      e.stopPropagation();
      const isDel = group.every(({ row }) => row._status === 'delivered');
      const next  = isDel ? 'in_progress' : 'delivered';
      groupDeliveredBtn.disabled = true;
      const results = await Promise.all(group.map(({ row }) => pushOrderStatus(row._orderId, next)));
      groupDeliveredBtn.disabled = false;
      results.forEach((ok, i) => { if (ok) {
        group[i].row._status = next === 'delivered' ? 'delivered' : 'pending';
        group[i].row._serverStatus = next;
      }});
      groupDeliveredBtn.classList.toggle('is-delivered', !isDel);
      refreshBadge();
      updateProgress();
      bumpHistoryFor(selectedDate);
    });
  }

  // Per-row delivered toggles
  card.querySelectorAll('.card-details .delivered-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
      e.stopPropagation();
      const rowIdx = parseInt(btn.dataset.rowIdx, 10);
      const item   = group.find(i => i.idx === rowIdx);
      if (!item) return;
      const { row } = item;
      const isDel = row._status === 'delivered';
      const next  = isDel ? 'in_progress' : 'delivered';
      btn.disabled = true;
      const ok = await pushOrderStatus(row._orderId, next);
      btn.disabled = false;
      if (!ok) return;
      row._status = isDel ? 'pending' : 'delivered';
      row._serverStatus = next;
      btn.classList.toggle('is-delivered', !isDel);
      refreshBadge();
      updateProgress();
      bumpHistoryFor(selectedDate);
    });
  });

  card.querySelector('.maps-btn').addEventListener('click', e => {
    e.stopPropagation();
    openLink(yandex);
  });

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
    });
  }

  card.addEventListener('dragstart', onGroupDragStart);
  card.addEventListener('dragover',  onGroupDragOver);
  card.addEventListener('drop',      onGroupDrop);
  card.addEventListener('dragend',   onGroupDragEnd);

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

  refreshBadge();
  return card;
}

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

async function markAllDelivered() {
  const tasks = currentRows
    .filter(r => r._status !== 'delivered')
    .map(r => pushOrderStatus(r._orderId, 'delivered').then(ok => { if (ok) {
      r._status = 'delivered'; r._serverStatus = 'delivered';
    }}));
  if (!tasks.length) return;
  allDeliveredBtn.disabled = true;
  await Promise.all(tasks);
  allDeliveredBtn.disabled = false;
  renderRoute(currentRows);
  bumpHistoryFor(selectedDate);
}

// ── Calendar ─────────────────────────────────────────────
function shiftCalendar(delta) {
  calendarState.month += delta;
  if (calendarState.month > 11) { calendarState.month = 0; calendarState.year++; }
  if (calendarState.month < 0)  { calendarState.month = 11; calendarState.year--; }
  selectedCalDay = null;
}

function bumpHistoryFor(dateStr) {
  // Optimistic update: ensure the calendar shows a delivery dot for this date.
  const month = dateStr.slice(0, 7);
  let set = driverHistoryByMonth.get(month);
  if (!set) { set = new Set(); driverHistoryByMonth.set(month, set); }
  set.add(dateStr);
  renderCalendar();
}

async function renderCalendar() {
  const displayMonth = `${calendarState.year}-${String(calendarState.month + 1).padStart(2, '0')}`;
  const todayMonth   = todayStr().slice(0, 7);

  // Render shell first; fetch month data and update.
  const today = todayStr();
  const firstDay = new Date(calendarState.year, calendarState.month, 1);
  const lastDay  = new Date(calendarState.year, calendarState.month + 1, 0);
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const monthData = await getDriverMonthData(displayMonth);
  driverHistoryByMonth.set(displayMonth, monthData.deliveryDates);

  const todayMonthData = displayMonth === todayMonth
    ? monthData
    : await getDriverMonthData(todayMonth);
  driverHistoryByMonth.set(todayMonth, todayMonthData.deliveryDates);
  const thisMonthCount = todayMonthData.deliveryCount;
  historyBadge.textContent = String(thisMonthCount);
  historyBadge.classList.toggle('hidden', thisMonthCount === 0);
  monthlyCount.textContent = String(monthData.deliveryCount);

  calMonthLabel.textContent = new Date(calendarState.year, calendarState.month, 1)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  const cells = [];
  ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d => cells.push(`<div class="cal-header-cell">${d}</div>`));
  for (let i = 0; i < startDow; i++) cells.push('<div class="cal-cell"></div>');
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const ds  = `${calendarState.year}-${String(calendarState.month + 1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const cls = ['cal-cell',
      monthData.deliveryDates.has(ds)  ? 'has-deliveries' : '',
      monthData.assignedDates.has(ds)  ? 'has-route'      : '',
      ds === today                      ? 'is-today'       : '',
      ds === selectedCalDay             ? 'is-selected'    : ''
    ].filter(Boolean).join(' ');
    cells.push(`<div class="${cls}" data-date="${ds}">${d}${monthData.deliveryDates.has(ds) ? '<span class="cal-dot"></span>' : ''}</div>`);
  }
  calGrid.innerHTML = cells.join('');

  calGrid.querySelectorAll('.cal-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      selectedCalDay = selectedCalDay === cell.dataset.date ? null : cell.dataset.date;
      showCalDayDetail(selectedCalDay, monthData.byDate);
      calGrid.querySelectorAll('.cal-cell').forEach(c => c.classList.toggle('is-selected', c.dataset.date === selectedCalDay));
    });
  });

  showCalDayDetail(selectedCalDay, monthData.byDate);
}

const driverMonthCache = new Map(); // monthKey -> { promise, expiresAt }
async function getDriverMonthData(monthKey) {
  const cached = driverMonthCache.get(monthKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const p = (async () => {
    try {
      const res = await fetch(`${API_BASE}/orders?month=${monthKey}`, { headers: authHeaders() });
      if (!res.ok) throw new Error('fail');
      const { orders } = await res.json();
      const deliveryDates = new Set();
      const assignedDates = new Set();
      const byDate = new Map();
      for (const o of orders) {
        assignedDates.add(o.routeDate);
        if (!byDate.has(o.routeDate)) byDate.set(o.routeDate, []);
        byDate.get(o.routeDate).push(o);
        if (o.status === 'delivered') deliveryDates.add(o.routeDate);
      }
      const deliveryCount = orders.filter(o => o.status === 'delivered').length;
      return { deliveryDates, assignedDates, byDate, deliveryCount };
    } catch {
      return { deliveryDates: new Set(), assignedDates: new Set(), byDate: new Map(), deliveryCount: 0 };
    }
  })();
  // 30-second cache: invalidated on any status change via bumpHistoryFor / refresh.
  driverMonthCache.set(monthKey, { promise: p, expiresAt: Date.now() + 30_000 });
  return p;
}

function showCalDayDetail(dateStr, byDate) {
  if (!dateStr) { calDayDetail.classList.add('hidden'); return; }
  const orders = (byDate?.get(dateStr) || []).filter(o => o.status === 'delivered');
  if (!orders.length) { calDayDetail.classList.add('hidden'); return; }
  calDayDetail.classList.remove('hidden');
  orders.sort((a, b) => (a.deliveredAt || '').localeCompare(b.deliveredAt || ''));
  calDayDetail.innerHTML = `
    <div class="cal-detail-header">${formatCalDate(dateStr)} — ${orders.length} ${pluralWord(orders.length, 'доставка', 'доставки', 'доставок')}</div>
    ${orders.map(o => {
      const time = o.deliveredAt ? new Date(o.deliveredAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' }) : '';
      return `<div class="history-item">
        <div class="history-addr">${escapeHtml(o.address)}</div>
        <div class="history-meta">${time}${o.externalOrderNo ? ' · ' + escapeHtml(o.externalOrderNo) : ''}</div>
      </div>`;
    }).join('')}`;
}
function formatCalDate(ds) {
  return new Date(ds + 'T00:00:00').toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
}

function switchDriverTab(tabId) {
  [routeTab, mapTab, historyTab].forEach(t => t.classList.add('hidden'));
  [tabRouteBtn, tabMapBtn, tabHistoryBtn].forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.remove('hidden');
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  try { localStorage.setItem(LS_TAB, tabId); } catch {}
  if (tabId === 'historyTab') renderCalendar();
  if (tabId === 'mapTab') renderMap();
}

// ── Map (preserved) ──────────────────────────────────────
const LS_GEOCACHE = 'lrl_geocache_v7';
let   mapInstance   = null;
let   leafletLoaded = false;

function getGeoCache() {
  try { return JSON.parse(localStorage.getItem(LS_GEOCACHE) || '{}'); } catch { return {}; }
}
function saveGeoCache(c) {
  try { localStorage.setItem(LS_GEOCACHE, JSON.stringify(c)); } catch {}
}
function cacheKey(addr) { return expandRuAddress(addr || '').toLowerCase(); }
function putInCache(addr, coords) {
  const c = getGeoCache();
  c[cacheKey(addr)] = coords; c[addr] = coords;
  saveGeoCache(c);
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
  const NC = '(?<![А-ЯЁа-яё])';
  return raw
    .replace(/^\d{6}[\s,]+/, '')
    .replace(/,\s*метро\s+[^,]*/gi, '')
    .replace(/,\s*кв\.\/офис.*/gi, '')
    .replace(/\s*территория\s+[^,\d]+/gi, '')
    .replace(/\s+[пП]\d+(?=[,\s]|$)/g, '')
    .replace(new RegExp(NC + 'ул\\.\\s*', 'gi'),   'улица ')
    .replace(new RegExp(NC + 'пр-кт\\.?\\s*', 'gi'), 'проспект ')
    .replace(new RegExp(NC + 'пр-т\\b', 'gi'),     'проспект ')
    .replace(new RegExp(NC + 'пр-д\\.?\\s*', 'gi'), 'проезд ')
    .replace(new RegExp(NC + 'пр\\.\\s*', 'gi'),   'проспект ')
    .replace(new RegExp(NC + 'пер\\.\\s*', 'gi'),  'переулок ')
    .replace(new RegExp(NC + 'б-р(?![А-ЯЁа-яё\\-])', 'gi'), 'бульвар ')
    .replace(new RegExp(NC + 'бул\\.\\s*', 'gi'),  'бульвар ')
    .replace(new RegExp(NC + 'пл\\.\\s*', 'gi'),   'площадь ')
    .replace(new RegExp(NC + 'ш\\.\\s*', 'gi'),    'шоссе ')
    .replace(new RegExp(NC + 'наб\\.?\\s*', 'gi'), 'набережная ')
    .replace(new RegExp(NC + 'мкр\\.\\s*', 'gi'),  'микрорайон ')
    .replace(new RegExp(NC + 'р-н(?![А-ЯЁа-яё\\-])', 'gi'), 'район ')
    .replace(/(?<![А-ЯЁа-яё])д\.\s*(?=вл)/gi, '')
    .replace(/(?<![А-ЯЁа-яё])д\.\s*(?=\d)/gi, '')
    .replace(/(?<![А-ЯЁа-яё])корп?\.\s*(?=[\dА-ЯЁа-яё])/gi, ' корпус ')
    .replace(/(?<![А-ЯЁа-яё])стр\.\s*(?=\d)/gi,   ' строение ')
    .replace(/,\s*,/g, ',').replace(/,\s*$/, '').replace(/\s+/g, ' ').trim();
}

function extractLocality(addr) {
  let m = addr.match(/\bг\.?\s+([А-Яа-яЁё][А-Яа-яЁё\-]+)/i);
  if (m) return m[1].trim();
  m = addr.match(/\b(?:город|пгт\.?|пос\.?|посёлок|поселок)\s+([А-Яа-яЁё][А-Яа-яЁё\-]+)/i);
  if (m) return m[1].trim();
  const s = addr.replace(/^\d{6}[\s,]+/, '');
  m = s.match(/^([А-Яа-яЁё][А-Яа-яЁё\s\-]+?)\s*,\s*(?:ул\.|пр\.|пр-т|пер\.|б-р|бул\.|наб\.|ш\.|мкр\.)/i);
  if (m) return m[1].trim();
  return null;
}
function inferDefaultCity(groups) {
  const freq = {};
  for (const g of groups) {
    const city = extractLocality(g[0].row.deliveryAddress || '');
    if (city) freq[city] = (freq[city] || 0) + 1;
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}

async function fetchJsonWithTimeout(url, opts = {}, ms = 12000) {
  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!res.ok) return null;
    return await res.json();
  } catch { return null; }
  finally { clearTimeout(timer); }
}

async function geocodeAddr(addr, defaultCity) {
  const cache = getGeoCache();
  const key   = cacheKey(addr);
  if (cache[key]) return cache[key];
  if (cache[addr]) { putInCache(addr, cache[addr]); return cache[addr]; }
  const city     = extractLocality(addr) || defaultCity;
  const expanded = expandRuAddress(addr);
  const q        = city ? `${city}, ${expanded}` : expanded;
  const url  = `${API_BASE}/geocode?q=${encodeURIComponent(q)}`;
  const data = await fetchJsonWithTimeout(url, {}, 15000);
  const coords = data?.coords || null;
  if (coords) { putInCache(addr, coords); return coords; }
  return null;
}

function makeLeafletIcon(num, done) {
  const fill = done ? '#34C759' : '#FF6B00';
  return L.divIcon({
    html: `<div style="width:30px;height:30px;border-radius:50%;background:${fill};border:2.5px solid #fff;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;box-shadow:0 2px 6px rgba(0,0,0,.25)">${num}</div>`,
    className: '',
    iconSize: [30, 30], iconAnchor: [15, 15], popupAnchor: [0, -17],
  });
}
function placeMapMarker(i, addr, coords) {
  const group     = routeGroups[i];
  const delivered = group.every(({ row }) => row._status === 'delivered');
  const firstRow  = group[0].row;
  const phones    = collectGroupPhones(group);
  const isIOS     = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const naviUrl   = `https://yandex.ru/navi/?text=${encodeURIComponent(addr)}`;
  const naviTarget = isIOS ? '' : ' target="_blank" rel="noopener noreferrer"';
  const callHtml  = phones[0]
    ? `<a href="tel:${phones[0].tel}" style="background:#34C759;color:#fff;padding:9px 13px;border-radius:8px;text-decoration:none;font-weight:700;font-size:15px;flex-shrink:0">📞</a>`
    : '';
  const popup =
    `<div style="font-family:system-ui,sans-serif;max-width:240px">` +
    `<b style="font-size:14px">#${i + 1} ${escapeHtml(addr)}</b>` +
    (firstRow.scheduledTime ? `<div style="font-size:12px;margin-top:6px">🕒 ${escapeHtml(firstRow.scheduledTime)}</div>` : '') +
    (firstRow.buyer       ? `<div style="font-size:12px;margin-top:4px">👤 ${escapeHtml(firstRow.buyer)}</div>` : '') +
    (firstRow.grossWeight !== '' && firstRow.grossWeight != null
      ? `<div style="font-size:12px;margin-top:4px">⚖️ ${escapeHtml(firstRow.grossWeight)} кг</div>` : '') +
    (firstRow.comment     ? `<div style="font-size:12px;margin-top:4px">💬 ${escapeHtml(firstRow.comment)}</div>` : '') +
    (delivered ? `<div style="color:#34C759;font-weight:700;font-size:12px;margin-top:6px">✓ Доставлено</div>` : '') +
    `<div style="display:flex;gap:8px;margin-top:10px">` +
    `<a href="${naviUrl}"${naviTarget} style="flex:1;background:#FF6B00;color:#fff;text-align:center;padding:9px;border-radius:8px;text-decoration:none;font-weight:700;font-size:13px">🧭 Навигатор</a>` +
    callHtml + `</div></div>`;
  L.marker([coords.lat, coords.lon], { icon: makeLeafletIcon(i + 1, delivered) })
    .bindPopup(popup)
    .addTo(mapInstance);
}

async function renderMap() {
  const msgEl = document.getElementById('mapMsg');
  const mapEl = document.getElementById('mapContainer');
  if (!routeGroups.length) {
    msgEl.textContent = 'Нет заказов на сегодня';
    msgEl.classList.remove('hidden');
    mapEl.classList.add('hidden');
    return;
  }
  msgEl.textContent = 'Загрузка карты…';
  msgEl.classList.remove('hidden');
  mapEl.classList.add('hidden');
  try { await loadLeaflet(); }
  catch { msgEl.textContent = 'Ошибка загрузки. Проверьте интернет.'; return; }
  if (mapInstance) { mapInstance.remove(); mapInstance = null; }
  msgEl.classList.add('hidden');
  mapEl.classList.remove('hidden');
  mapInstance = L.map(mapEl, {
    center: [55.7558, 37.6173], zoom: 10,
    attributionControl: false, zoomControl: true,
  });
  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    maxZoom: 19, subdomains: 'abcd',
  }).addTo(mapInstance);

  const items       = routeGroups.map((g, i) => ({ addr: g[0].row.deliveryAddress, i })).filter(x => x.addr);
  const cache       = getGeoCache();
  const defaultCity = inferDefaultCity(routeGroups);
  const bounds      = [];
  const refit = () => {
    if (bounds.length === 1) mapInstance.setView(bounds[0], 13);
    else if (bounds.length > 1) mapInstance.fitBounds(bounds, { padding: [40, 40] });
  };

  for (const { addr, i } of items) {
    const c = cache[cacheKey(addr)] ?? cache[addr];
    if (!c) continue;
    placeMapMarker(i, addr, c);
    bounds.push([c.lat, c.lon]);
  }
  refit();

  const toGeocode = items.filter(x => !(cache[cacheKey(x.addr)] ?? cache[x.addr]));
  if (!toGeocode.length) {
    if (!bounds.length) {
      mapInstance.remove(); mapInstance = null;
      mapEl.classList.add('hidden');
      msgEl.textContent = 'Адреса не найдены.';
      msgEl.classList.remove('hidden');
    }
    return;
  }

  let done = 0;
  const total = toGeocode.length;
  const updateProgress = () => {
    msgEl.textContent = done < total ? `Геокодирование ${done}/${total}…` : '';
    if (done < total) msgEl.classList.remove('hidden'); else msgEl.classList.add('hidden');
  };
  updateProgress();

  await Promise.all(toGeocode.map(({ addr, i }, idx) =>
    new Promise(r => setTimeout(r, idx * 80))
      .then(() => geocodeAddr(addr, defaultCity))
      .then(coords => {
        done++; updateProgress();
        if (!coords) return;
        placeMapMarker(i, addr, coords);
        bounds.push([coords.lat, coords.lon]);
        refit();
      })
      .catch(() => { done++; updateProgress(); })
  ));

  msgEl.classList.add('hidden');
  if (!bounds.length) {
    mapInstance.remove(); mapInstance = null;
    mapEl.classList.add('hidden');
    msgEl.textContent = 'Адреса не найдены.';
    msgEl.classList.remove('hidden');
  }
}

// ── Ops dashboard ────────────────────────────────────────
function switchOpsTab(tabId) {
  [opsOrdersTab, opsInboxTab, opsStatsTab, opsExportTab, opsUsersTab].forEach(t => t.classList.add('hidden'));
  [tabOpsOrdersBtn, tabOpsInboxBtn, tabOpsStatsBtn, tabOpsExportBtn, tabOpsUsersBtn].forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.remove('hidden');
  document.querySelector(`[data-tab="${tabId}"]`).classList.add('active');
  try { localStorage.setItem(LS_OPS_TAB, tabId); } catch {}
  if (tabId === 'opsUsersTab') loadOpsUsers();
  if (tabId === 'opsInboxTab') loadOpsCatalog();
  if (tabId === 'opsStatsTab') loadOpsStats();
}

function onOpsDateChange() {
  const val = opsDatePicker.value;
  if (!val) return;
  opsSelectedDate = val;
  loadOpsOrders();
}
function shiftOpsDate(delta) {
  const next = shiftDateStr(opsDatePicker.value || todayStr(), delta);
  opsDatePicker.value = next;
  opsSelectedDate = next;
  loadOpsOrders();
}

async function loadOpsDrivers() {
  try {
    const res = await fetch(`${API_BASE}/drivers`, { headers: authHeaders() });
    if (!res.ok) return;
    const { drivers } = await res.json();
    opsDrivers = drivers || [];

    const optionsHtml = ['<option value="">Все</option>']
      .concat(opsDrivers.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.fullName || d.login)}</option>`))
      .join('');
    opsDriverFilter.innerHTML = optionsHtml;
    exportDriver.innerHTML    = optionsHtml;

    ordDriver.innerHTML = ['<option value="">— не назначен —</option>']
      .concat(opsDrivers.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.fullName || d.login)}</option>`))
      .join('');
  } catch { /* ignore */ }
}

async function loadOpsOrders() {
  const filterDriver = opsDriverFilter.value;
  const params = new URLSearchParams({ date: opsSelectedDate });
  if (filterDriver) params.set('driverId', filterDriver);
  try {
    const res = await fetch(`${API_BASE}/orders?${params}`, { headers: authHeaders() });
    if (!res.ok) { opsOrders = []; renderOpsOrders(); return; }
    const { orders } = await res.json();
    opsOrders = orders || [];
    renderOpsOrders();
  } catch {
    opsOrders = [];
    renderOpsOrders();
  }
}

const STATUS_LABEL = {
  pending: 'Ожидает', assigned: 'Назначен', in_progress: 'В пути',
  delivered: 'Доставлено', failed: 'Не доставлено', cancelled: 'Отменён'
};
const STATUS_CLASS = {
  pending: 'st-pending', assigned: 'st-assigned', in_progress: 'st-progress',
  delivered: 'st-delivered', failed: 'st-failed', cancelled: 'st-cancelled'
};

function renderOpsOrders() {
  opsOrderCount.textContent = `${opsOrders.length} ${pluralWord(opsOrders.length, 'заказ', 'заказа', 'заказов')}`;
  if (!opsOrders.length) {
    opsOrdersList.innerHTML = '<div class="empty-state">Нет заказов на эту дату</div>';
    return;
  }
  opsOrdersList.innerHTML = '';
  opsOrders.forEach(o => opsOrdersList.appendChild(createOpsOrderCard(o)));
}

function createOpsOrderCard(o) {
  const driver = opsDrivers.find(d => d.id === o.assignedDriverId);
  const driverLabel = driver ? (driver.fullName || driver.login) : '— не назначен —';
  const card = document.createElement('div');
  card.className = 'route-card ops-card';
  card.innerHTML = `
    <div class="card-main" style="cursor:pointer">
      <div class="route-badge ${STATUS_CLASS[o.status] || ''}">${o.scheduledTime || '—'}</div>
      <div class="route-info">
        <div class="route-address">${escapeHtml(o.address)}</div>
        <div class="route-ordnum">
          <span class="ops-status-pill ${STATUS_CLASS[o.status] || ''}">${STATUS_LABEL[o.status] || o.status}</span>
          · 👤 ${escapeHtml(driverLabel)}
          ${o.buyer       ? ' · ' + escapeHtml(o.buyer) : ''}
          ${o.description ? ' · ' + escapeHtml(o.description) : ''}
        </div>
      </div>
      <div class="route-actions">
        <select class="ops-driver-select" data-id="${escapeHtml(o.id)}">
          <option value="">— не назначен —</option>
          ${opsDrivers.map(d => `<option value="${escapeHtml(d.id)}"${d.id === o.assignedDriverId ? ' selected' : ''}>${escapeHtml(d.fullName || d.login)}</option>`).join('')}
        </select>
        <button class="btn-secondary btn-sm" data-action="edit"   data-id="${escapeHtml(o.id)}" type="button">Изм.</button>
        <button class="btn-danger    btn-sm" data-action="delete" data-id="${escapeHtml(o.id)}" type="button">Удал.</button>
      </div>
    </div>
  `;

  card.querySelector('.ops-driver-select').addEventListener('change', async e => {
    const newDriverId = e.target.value || null;
    const res = await fetch(`${API_BASE}/orders/${o.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ assignedDriverId: newDriverId })
    });
    if (!res.ok) { showToast('Не удалось назначить'); return; }
    showToast(newDriverId ? 'Назначено' : 'Снято с водителя');
    loadOpsOrders();
  });

  card.querySelector('[data-action="edit"]').addEventListener('click', () => openOrderForm(o));
  card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm(`Удалить заказ?\n${o.address}`)) return;
    const res = await fetch(`${API_BASE}/orders/${o.id}`, { method: 'DELETE', headers: authHeaders() });
    if (!res.ok) { showToast('Ошибка удаления'); return; }
    loadOpsOrders();
  });

  return card;
}

function openOrderForm(order) {
  opsEditingId = order?.id || null;
  opsFormTitle.textContent = order ? 'Редактирование заказа' : 'Новый заказ';
  ordAddress.value     = order?.address || '';
  ordTime.value        = order?.scheduledTime || '';
  ordDriver.value      = order?.assignedDriverId || '';
  ordBuyer.value       = order?.buyer || '';
  ordWeight.value      = order?.weightKg ?? '';
  ordExternalNo.value  = order?.externalOrderNo || '';
  ordDescription.value = order?.description || '';
  ordComment.value     = order?.comment || '';
  opsFormError.classList.add('hidden');
  opsAddOrderForm.classList.remove('hidden');
  ordAddress.focus();
}

function closeOrderForm() {
  opsEditingId = null;
  opsAddOrderForm.classList.add('hidden');
  ordAddress.value = ordTime.value = ordDriver.value = '';
  ordBuyer.value = ordWeight.value = ordExternalNo.value = '';
  ordDescription.value = ordComment.value = '';
}

async function saveOrderForm() {
  const address = ordAddress.value.trim();
  if (!address) {
    opsFormError.textContent = 'Адрес обязателен';
    opsFormError.classList.remove('hidden');
    return;
  }
  const payload = {
    routeDate:        opsSelectedDate,
    address,
    scheduledTime:    ordTime.value || null,
    assignedDriverId: ordDriver.value || null,
    buyer:            ordBuyer.value || null,
    weightKg:         ordWeight.value === '' ? null : Number(ordWeight.value),
    externalOrderNo:  ordExternalNo.value || null,
    description:      ordDescription.value || null,
    comment:          ordComment.value || null,
  };
  opsSaveOrderBtn.disabled = true;
  try {
    const res = opsEditingId
      ? await fetch(`${API_BASE}/orders/${opsEditingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload)
        })
      : await fetch(`${API_BASE}/orders`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload)
        });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      opsFormError.textContent = error || 'Ошибка сохранения';
      opsFormError.classList.remove('hidden');
      return;
    }
    closeOrderForm();
    loadOpsOrders();
  } finally {
    opsSaveOrderBtn.disabled = false;
  }
}

async function exportOrders(range) {
  const date     = exportDate.value || todayStr();
  const driverId = exportDriver.value || '';
  const params   = new URLSearchParams({ range, date });
  if (driverId) params.set('driverId', driverId);

  // Use XHR-style download via temporary anchor with a Bearer-authed blob,
  // since cookies set on Set-Cookie are HttpOnly and the sessionToken header
  // is the path that works cross-context.
  try {
    const res = await fetch(`${API_BASE}/export/orders?${params}`, { headers: authHeaders() });
    if (!res.ok) { showToast('Ошибка экспорта'); return; }
    const blob = await res.blob();
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href     = url;
    a.download = `orders-${range}-${date}.xlsx`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  } catch {
    showToast('Сетевая ошибка');
  }
}

// ── Ops: users tab (supervisor / admin) ──────────────────
async function loadOpsUsers() {
  try {
    const res = await fetch(`${API_BASE}/admin/users`, { headers: authHeaders() });
    if (!res.ok) return;
    const { users } = await res.json();
    opsUsersCount.textContent = `${users.length} ${pluralWord(users.length, 'пользователь', 'пользователя', 'пользователей')}`;
    opsUsersList.innerHTML = '';
    users.forEach(u => {
      const isSelf = u.id === currentUser?.id;
      const created = new Date(u.createdAt).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' });
      const card = document.createElement('div');
      card.className = 'route-card';
      card.innerHTML = `
        <div class="card-main" style="cursor:default">
          <div class="route-badge role-${u.role}" style="font-size:14px">👤</div>
          <div class="route-info">
            <div class="route-address">
              ${escapeHtml(u.fullName || u.login)}
              ${isSelf ? '<span style="font-size:11px;color:var(--orange);font-weight:600;margin-left:6px">Вы</span>' : ''}
              <span style="font-size:12px;color:var(--text-soft);margin-left:8px">@${escapeHtml(u.login)}</span>
            </div>
            <div class="route-ordnum">
              <span class="admin-role-badge role-${u.role}">${roleLabel(u.role)}</span>
              ${u.role === 'driver' ? ` &nbsp;·&nbsp; Заказов: ${u.orderCount}` : ''}
              &nbsp;·&nbsp; ${created}
            </div>
          </div>
          <div class="route-actions">
            <button class="btn-secondary btn-sm" data-action="password" data-id="${u.id}" data-login="${escapeHtml(u.login)}" type="button">Пароль</button>
            ${!isSelf ? `<button class="btn-danger btn-sm" data-action="delete" data-id="${u.id}" data-login="${escapeHtml(u.login)}" type="button">Удалить</button>` : ''}
          </div>
        </div>
      `;
      opsUsersList.appendChild(card);
    });
    opsUsersList.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm(`Удалить «${btn.dataset.login}»?\nОперация необратима.`)) return;
        btn.textContent = '…';
        const r = await fetch(`${API_BASE}/admin/users/${btn.dataset.id}`, { method: 'DELETE', headers: authHeaders() });
        if (r.ok) { loadOpsUsers(); loadOpsDrivers(); }
        else      { showToast('Ошибка'); btn.textContent = 'Удалить'; }
      });
    });
    opsUsersList.querySelectorAll('[data-action="password"]').forEach(btn => {
      btn.addEventListener('click', () => openPasswordModal(btn.dataset.id, btn.dataset.login));
    });
  } catch { /* ignore */ }
}

function roleLabel(role) {
  return { admin: 'Admin', supervisor: 'Супервайзер', manager: 'Менеджер', driver: 'Водитель' }[role] || role;
}

async function saveOpsUser() {
  opsUserError.classList.add('hidden');
  const login    = newUserLogin.value.trim();
  const password = newUserPassword.value;
  if (!login || !password) {
    opsUserError.textContent = 'Заполните логин и пароль';
    opsUserError.classList.remove('hidden');
    return;
  }
  opsSaveUserBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/admin/users`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        login, password,
        role: newUserRole.value,
        fullName: newUserFullName.value.trim() || null
      })
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      opsUserError.textContent = error || 'Ошибка создания';
      opsUserError.classList.remove('hidden');
      return;
    }
    newUserLogin.value = ''; newUserPassword.value = '';
    newUserRole.value = 'driver'; newUserFullName.value = '';
    opsAddUserForm.classList.add('hidden');
    loadOpsUsers();
    loadOpsDrivers();
  } finally {
    opsSaveUserBtn.disabled = false;
  }
}

// ── Catalog (permanent library of delivery objects) ──────
const opsAddInboxBtn    = document.getElementById('opsAddInboxBtn');
const opsAddInboxForm   = document.getElementById('opsAddInboxForm');
const opsInboxFormTitle = document.getElementById('opsInboxFormTitle');
const inbAddress        = document.getElementById('inbAddress');
const inbTime           = document.getElementById('inbTime');
const inbBuyer          = document.getElementById('inbBuyer');
const inbWeight         = document.getElementById('inbWeight');
const inbExternalNo     = document.getElementById('inbExternalNo');
const inbDescription    = document.getElementById('inbDescription');
const inbComment        = document.getElementById('inbComment');
const opsInboxFormError = document.getElementById('opsInboxFormError');
const opsSaveInboxBtn   = document.getElementById('opsSaveInboxBtn');
const opsCancelInboxBtn = document.getElementById('opsCancelInboxBtn');
const opsInboxCount     = document.getElementById('opsInboxCount');
const opsInboxList      = document.getElementById('opsInboxList');

let opsCatalog = [];
let opsCatalogEditingId = null;

opsAddInboxBtn.addEventListener('click', () => openCatalogForm(null));
opsCancelInboxBtn.addEventListener('click', closeCatalogForm);
opsSaveInboxBtn.addEventListener('click', saveCatalogForm);

async function loadOpsCatalog() {
  try {
    const res = await fetch(`${API_BASE}/catalog`, { headers: authHeaders() });
    if (!res.ok) { opsCatalog = []; renderOpsCatalog(); return; }
    const { catalog } = await res.json();
    opsCatalog = catalog || [];
    renderOpsCatalog();
  } catch {
    opsCatalog = [];
    renderOpsCatalog();
  }
}

function renderOpsCatalog() {
  opsInboxCount.textContent = `${opsCatalog.length} ${pluralWord(opsCatalog.length, 'объект', 'объекта', 'объектов')}`;
  if (!opsCatalog.length) {
    opsInboxList.innerHTML = '<div class="empty-state">Каталог пуст. Нажмите «+ Объект», чтобы добавить.</div>';
    return;
  }
  opsInboxList.innerHTML = '';
  opsCatalog.forEach(o => opsInboxList.appendChild(createCatalogCard(o)));
}

function createCatalogCard(o) {
  const card = document.createElement('div');
  card.className = 'route-card ops-card inbox-card';
  card.innerHTML = `
    <div class="card-main" style="cursor:pointer">
      <div class="route-badge st-pending">${o.defaultTime || '—'}</div>
      <div class="route-info">
        <div class="route-address">${escapeHtml(o.address)}</div>
        <div class="route-ordnum">
          ${o.buyer       ? '👤 ' + escapeHtml(o.buyer) + ' · ' : ''}
          ${o.description ? escapeHtml(o.description)           : 'без описания'}
          ${o.weightKg !== null && o.weightKg !== undefined && o.weightKg !== '' ? ` · ⚖️ ${escapeHtml(o.weightKg)} кг` : ''}
        </div>
      </div>
      <div class="route-actions">
        <button class="btn-primary    btn-sm" data-action="assign" data-id="${escapeHtml(o.id)}" type="button">Назначить</button>
        <button class="btn-secondary  btn-sm" data-action="edit"   data-id="${escapeHtml(o.id)}" type="button">Изм.</button>
        <button class="btn-danger     btn-sm" data-action="delete" data-id="${escapeHtml(o.id)}" type="button">Удал.</button>
      </div>
    </div>
  `;
  card.querySelector('[data-action="assign"]').addEventListener('click', () => openAssignModal(o));
  card.querySelector('[data-action="edit"]').addEventListener('click', () => openCatalogForm(o));
  card.querySelector('[data-action="delete"]').addEventListener('click', async () => {
    if (!confirm(`Удалить объект из каталога?\n${o.address}\n(Уже созданные заказы останутся.)`)) return;
    const r = await fetch(`${API_BASE}/catalog/${o.id}`, { method: 'DELETE', headers: authHeaders() });
    if (!r.ok) { showToast('Ошибка удаления'); return; }
    loadOpsCatalog();
  });
  return card;
}

function openCatalogForm(obj) {
  opsCatalogEditingId = obj?.id || null;
  opsInboxFormTitle.textContent = obj ? 'Редактирование объекта' : 'Новый объект каталога';
  inbAddress.value     = obj?.address || '';
  inbTime.value        = obj?.defaultTime || '';
  inbBuyer.value       = obj?.buyer || '';
  inbWeight.value      = obj?.weightKg ?? '';
  inbExternalNo.value  = obj?.externalNo || '';
  inbDescription.value = obj?.description || '';
  inbComment.value     = obj?.comment || '';
  opsInboxFormError.classList.add('hidden');
  opsAddInboxForm.classList.remove('hidden');
  inbAddress.focus();
}

function closeCatalogForm() {
  opsCatalogEditingId = null;
  opsAddInboxForm.classList.add('hidden');
  inbAddress.value = inbTime.value = inbBuyer.value = '';
  inbWeight.value = inbExternalNo.value = '';
  inbDescription.value = inbComment.value = '';
}

async function saveCatalogForm() {
  const address = inbAddress.value.trim();
  if (!address) {
    opsInboxFormError.textContent = 'Адрес обязателен';
    opsInboxFormError.classList.remove('hidden');
    return;
  }
  const payload = {
    address,
    defaultTime: inbTime.value || null,
    buyer:       inbBuyer.value || null,
    weightKg:    inbWeight.value === '' ? null : Number(inbWeight.value),
    externalNo:  inbExternalNo.value || null,
    description: inbDescription.value || null,
    comment:     inbComment.value || null,
  };
  opsSaveInboxBtn.disabled = true;
  try {
    const res = opsCatalogEditingId
      ? await fetch(`${API_BASE}/catalog/${opsCatalogEditingId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload)
        })
      : await fetch(`${API_BASE}/catalog`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify(payload)
        });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      opsInboxFormError.textContent = error || 'Ошибка сохранения';
      opsInboxFormError.classList.remove('hidden');
      return;
    }
    closeCatalogForm();
    loadOpsCatalog();
  } finally {
    opsSaveInboxBtn.disabled = false;
  }
}

// ── Assignment modal (used from inbox) ───────────────────
const assignModal     = document.getElementById('assignModal');
const assignSummary   = document.getElementById('assignSummary');
const assignDate      = document.getElementById('assignDate');
const assignTime      = document.getElementById('assignTime');
const assignDriver    = document.getElementById('assignDriver');
const assignError     = document.getElementById('assignError');
const assignSaveBtn   = document.getElementById('assignSaveBtn');
const assignCancelBtn = document.getElementById('assignCancelBtn');

let assigningOrderId = null;

assignSaveBtn.addEventListener('click', submitAssign);
assignCancelBtn.addEventListener('click', closeAssignModal);
assignModal.addEventListener('click', e => { if (e.target === assignModal) closeAssignModal(); });

// The assign modal turns a catalog object into a fresh order on the chosen
// date+driver. The catalog object stays in the catalog — every "Назначить"
// click creates a new order.
function openAssignModal(catObj) {
  assigningOrderId = catObj.id;
  assignSummary.textContent = catObj.address + (catObj.buyer ? ' · ' + catObj.buyer : '');
  assignDate.value = todayStr();
  assignTime.value = catObj.defaultTime || '';
  assignDriver.innerHTML = ['<option value="">— не назначен —</option>']
    .concat(opsDrivers.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.fullName || d.login)}</option>`))
    .join('');
  assignDriver.value = '';
  assignError.classList.add('hidden');
  assignModal.classList.remove('hidden');
}
function closeAssignModal() {
  assigningOrderId = null;
  assignModal.classList.add('hidden');
}
async function submitAssign() {
  if (!assigningOrderId) return;
  const date = assignDate.value;
  if (!date) {
    assignError.textContent = 'Укажите дату';
    assignError.classList.remove('hidden');
    return;
  }
  const payload = {
    routeDate:        date,
    scheduledTime:    assignTime.value || null,
    assignedDriverId: assignDriver.value || null,
  };
  assignSaveBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/catalog/${assigningOrderId}/assign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      assignError.textContent = error || 'Ошибка';
      assignError.classList.remove('hidden');
      return;
    }
    closeAssignModal();
    // Catalog list does NOT shrink — the entry stays. Just refresh the day plan
    // if the new order lands on the currently-viewed date.
    if (date === opsSelectedDate) loadOpsOrders();
    showToast('Заказ создан');
  } finally {
    assignSaveBtn.disabled = false;
  }
}

// ── Stats ────────────────────────────────────────────────
const statsPrevBtn        = document.getElementById('statsPrevBtn');
const statsNextBtn        = document.getElementById('statsNextBtn');
const statsMonthLabel     = document.getElementById('statsMonthLabel');
const statsMonthTotal     = document.getElementById('statsMonthTotal');
const statsMonthDelivered = document.getElementById('statsMonthDelivered');
const statsCalGrid        = document.getElementById('statsCalGrid');
const statsDayPanel       = document.getElementById('statsDayPanel');
const statsDayHeader      = document.getElementById('statsDayHeader');
const statsStatusGrid     = document.getElementById('statsStatusGrid');
const statsDayDrivers     = document.getElementById('statsDayDrivers');
const statsMonthDrivers   = document.getElementById('statsMonthDrivers');

let statsMonthState = { year: new Date().getFullYear(), month: new Date().getMonth() };
let statsSelectedDay = null;

statsPrevBtn.addEventListener('click', () => { shiftStatsMonth(-1); loadOpsStats(); });
statsNextBtn.addEventListener('click', () => { shiftStatsMonth(+1); loadOpsStats(); });

function shiftStatsMonth(delta) {
  statsMonthState.month += delta;
  if (statsMonthState.month > 11) { statsMonthState.month = 0; statsMonthState.year++; }
  if (statsMonthState.month < 0)  { statsMonthState.month = 11; statsMonthState.year--; }
  statsSelectedDay = null;
}

const STATUS_PILLS = [
  ['pending',     'Ожидает',       'st-pending'],
  ['assigned',    'Назначен',      'st-assigned'],
  ['in_progress', 'В пути',        'st-progress'],
  ['delivered',   'Доставлено',    'st-delivered'],
  ['failed',      'Не доставлено', 'st-failed'],
  ['cancelled',   'Отменён',       'st-cancelled'],
];

async function loadOpsStats() {
  const monthKey = `${statsMonthState.year}-${String(statsMonthState.month + 1).padStart(2,'0')}`;
  statsMonthLabel.textContent = new Date(statsMonthState.year, statsMonthState.month, 1)
    .toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });

  let monthly = { total: 0, delivered: 0, perDay: [], perDriver: [] };
  try {
    const res = await fetch(`${API_BASE}/stats/monthly?month=${monthKey}`, { headers: authHeaders() });
    if (res.ok) monthly = await res.json();
  } catch { /* ignore */ }

  statsMonthTotal.textContent     = String(monthly.total);
  statsMonthDelivered.textContent = String(monthly.delivered);

  // Calendar
  const today = todayStr();
  const firstDay = new Date(statsMonthState.year, statsMonthState.month, 1);
  const lastDay  = new Date(statsMonthState.year, statsMonthState.month + 1, 0);
  let startDow = firstDay.getDay();
  startDow = startDow === 0 ? 6 : startDow - 1;

  const totalsByDate = new Map(monthly.perDay.map(r => [r.date, r]));
  const cells = [];
  ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'].forEach(d => cells.push(`<div class="cal-header-cell">${d}</div>`));
  for (let i = 0; i < startDow; i++) cells.push('<div class="cal-cell"></div>');
  for (let d = 1; d <= lastDay.getDate(); d++) {
    const ds = `${monthKey}-${String(d).padStart(2,'0')}`;
    const r  = totalsByDate.get(ds);
    const cls = ['cal-cell', 'stats-cell',
      r ? 'has-deliveries' : '',
      ds === today                 ? 'is-today'    : '',
      ds === statsSelectedDay      ? 'is-selected' : ''
    ].filter(Boolean).join(' ');
    const countBadge = r
      ? `<span class="stats-cell-count${r.delivered === r.total ? ' all-done' : ''}">${r.delivered}/${r.total}</span>`
      : '';
    cells.push(`<div class="${cls}" data-date="${ds}">${d}${countBadge}</div>`);
  }
  statsCalGrid.innerHTML = cells.join('');

  statsCalGrid.querySelectorAll('.stats-cell[data-date]').forEach(cell => {
    cell.addEventListener('click', () => {
      const ds = cell.dataset.date;
      statsSelectedDay = statsSelectedDay === ds ? null : ds;
      statsCalGrid.querySelectorAll('.stats-cell').forEach(c => c.classList.toggle('is-selected', c.dataset.date === statsSelectedDay));
      if (statsSelectedDay) loadStatsDay(statsSelectedDay);
      else statsDayPanel.classList.add('hidden');
    });
  });

  // Per-driver monthly summary
  if (!monthly.perDriver.length) {
    statsMonthDrivers.innerHTML = '<div class="empty-state">Нет данных</div>';
  } else {
    statsMonthDrivers.innerHTML = monthly.perDriver.map(d => {
      const pct = d.total ? Math.round((d.delivered / d.total) * 100) : 0;
      return `<div class="stats-driver-row">
        <div class="stats-driver-name">${escapeHtml(d.fullName || d.login)}</div>
        <div class="stats-driver-meta">${d.delivered}/${d.total} (${pct}%)</div>
        <div class="stats-driver-bar"><div class="stats-driver-bar-fill" style="width:${pct}%"></div></div>
      </div>`;
    }).join('');
  }
}

async function loadStatsDay(dateStr) {
  try {
    const res = await fetch(`${API_BASE}/stats/daily?date=${dateStr}`, { headers: authHeaders() });
    if (!res.ok) return;
    const data = await res.json();
    statsDayPanel.classList.remove('hidden');
    statsDayHeader.innerHTML = `${formatCalDate(dateStr)} — <strong>${data.total}</strong> ${pluralWord(data.total, 'заказ', 'заказа', 'заказов')}`;

    statsStatusGrid.innerHTML = STATUS_PILLS
      .filter(([key]) => data.byStatus[key] > 0)
      .map(([key, label, cls]) =>
        `<div class="stats-status-cell">
          <span class="ops-status-pill ${cls}">${label}</span>
          <span class="stats-status-num">${data.byStatus[key]}</span>
        </div>`
      ).join('') || '<div class="empty-state">Нет заказов на этот день</div>';

    if (!data.byDriver.length || data.total === 0) {
      statsDayDrivers.innerHTML = '<div class="empty-state">—</div>';
    } else {
      statsDayDrivers.innerHTML = data.byDriver.map(d => {
        const pct = d.total ? Math.round((d.delivered / d.total) * 100) : 0;
        return `<div class="stats-driver-row">
          <div class="stats-driver-name">${escapeHtml(d.fullName || d.login)}</div>
          <div class="stats-driver-meta">${d.delivered}/${d.total}${d.total ? ` (${pct}%)` : ''}</div>
          <div class="stats-driver-bar"><div class="stats-driver-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
      }).join('');
    }
  } catch { /* ignore */ }
}

// ── Password change modal ────────────────────────────────
const passwordModal  = document.getElementById('passwordModal');
const pwdSummary     = document.getElementById('pwdSummary');
const pwdNew         = document.getElementById('pwdNew');
const pwdConfirm     = document.getElementById('pwdConfirm');
const pwdError       = document.getElementById('pwdError');
const pwdSaveBtn     = document.getElementById('pwdSaveBtn');
const pwdCancelBtn   = document.getElementById('pwdCancelBtn');

let pwdTargetUserId = null;

pwdSaveBtn.addEventListener('click', submitPassword);
pwdCancelBtn.addEventListener('click', closePasswordModal);
passwordModal.addEventListener('click', e => { if (e.target === passwordModal) closePasswordModal(); });

function openPasswordModal(userId, login) {
  pwdTargetUserId = userId;
  pwdSummary.textContent = login + (userId === currentUser?.id ? ' (вы)' : '');
  pwdNew.value = '';
  pwdConfirm.value = '';
  pwdError.classList.add('hidden');
  passwordModal.classList.remove('hidden');
  pwdNew.focus();
}
function closePasswordModal() {
  pwdTargetUserId = null;
  passwordModal.classList.add('hidden');
}
async function submitPassword() {
  if (!pwdTargetUserId) return;
  const pwd  = pwdNew.value;
  const conf = pwdConfirm.value;
  if (!pwd) {
    pwdError.textContent = 'Введите новый пароль';
    pwdError.classList.remove('hidden');
    return;
  }
  if (pwd !== conf) {
    pwdError.textContent = 'Пароли не совпадают';
    pwdError.classList.remove('hidden');
    return;
  }
  pwdSaveBtn.disabled = true;
  try {
    const res = await fetch(`${API_BASE}/admin/users/${pwdTargetUserId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ password: pwd })
    });
    if (!res.ok) {
      const { error } = await res.json().catch(() => ({}));
      pwdError.textContent = error || 'Ошибка';
      pwdError.classList.remove('hidden');
      return;
    }
    closePasswordModal();
    showToast('Пароль изменён');
  } finally {
    pwdSaveBtn.disabled = false;
  }
}
