import * as XLSX from 'xlsx';

const courierNumbers = ['00НФ-025488', '00НФ-025491', '00НФ-025525', '00НФ-025498', '00НФ-025499', '00НФ-025507', '00НФ-025508', '00НФ-025512', '00НФ-025513', '00НФ-025518', '00НФ-025533', '00НФ-025534', '00НФ-025536', '00НФ-025538'];
const normalizedCourierNumbers = courierNumbers.map(normalizeText);

const dataColumns = {
  orderNumber: 0,
  deliveryAddress: 2,
  grossWeight: 4,
  buyer: 5,
  comment: 7,
  responsible: 8,
  deliveryService: 9,
  orderId: 11
};

const addRouteBtn = document.getElementById('addRouteBtn');
const fileInput = document.getElementById('fileInput');
const fileInfo = document.getElementById('fileInfo');
const statusPanel = document.getElementById('statusPanel');
const routeMap = document.getElementById('routeMap');
const resultCount = document.getElementById('resultCount');
const courierNumbersContainer = document.getElementById('courierNumbers');
const dropzone = document.getElementById('dropzone');

courierNumbersContainer.innerHTML = courierNumbers.map((number) => `<span class="chip">${number}</span>`).join('');

addRouteBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileSelect);

['dragenter', 'dragover'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.add('dragover');
  });
});

['dragleave', 'drop'].forEach((eventName) => {
  dropzone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropzone.classList.remove('dragover');
  });
});

dropzone.addEventListener('drop', (event) => {
  const [file] = event.dataTransfer.files;
  if (file) processFile(file);
});

function handleFileSelect(event) {
  const [file] = event.target.files;
  if (file) processFile(file);
}

async function processFile(file) {
  fileInfo.textContent = `Файл выбран: ${file.name}`;
  statusPanel.textContent = 'Чтение файла...';

  try {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: 'array', cellDates: false, WTF: false });
    const rows = extractRowsFromWorkbook(workbook);
    const extracted = rows.filter((row) => row.matchesCourier && (row.orderNumber || row.matchedValue));

    renderRoute(extracted);
    statusPanel.textContent = extracted.length
      ? `Найдено ${extracted.length} строк для ваших курьеров.`
      : 'Подходящих строк не найдено. Проверьте структуру файла.';
  } catch (error) {
    console.error(error);
    statusPanel.textContent = `Не удалось прочитать файл: ${error?.message || 'неизвестная ошибка'}`;
    routeMap.innerHTML = '<div class="empty-state">Ошибка чтения файла.</div>';
    resultCount.textContent = '0 точек';
  }
}

function extractRowsFromWorkbook(workbook) {
  const result = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet['!ref']) {
      continue;
    }

    const range = XLSX.utils.decode_range(sheet['!ref']);
    const maxCol = range.e.c;
    const rows = [];

    for (let rowIndex = range.s.r; rowIndex <= range.e.r; rowIndex += 1) {
      rows.push(readRow(sheet, rowIndex, maxCol));
    }

    // В примере разметка такая:
    // 1-я строка — параметры,
    // 2-я строка — отбор,
    // 3-я строка — заголовки,
    // 4-я и далее — данные.
    const dataStartRowIndex = 3;

    for (let rowIndex = dataStartRowIndex; rowIndex < rows.length; rowIndex += 1) {
      const row = rows[rowIndex] || [];
      if (!row.some((cell) => String(cell ?? '').trim() !== '')) {
        continue;
      }

      result.push(mapRowByFixedColumns(row));
    }
  }

  return result;
}

function mapRowByFixedColumns(row) {
  const normalizedRow = {
    orderNumber: getCell(row, dataColumns.orderNumber),
    deliveryAddress: getCell(row, dataColumns.deliveryAddress),
    grossWeight: getCell(row, dataColumns.grossWeight),
    buyer: getCell(row, dataColumns.buyer),
    comment: getCell(row, dataColumns.comment),
    responsible: getCell(row, dataColumns.responsible),
    deliveryService: getCell(row, dataColumns.deliveryService),
    orderId: getCell(row, dataColumns.orderId)
  };

  const matchedEntry = findCourierMatch(normalizedRow.orderNumber, row);

  return {
    ...normalizedRow,
    matchesCourier: Boolean(matchedEntry),
    matchedValue: matchedEntry?.value ?? ''
  };
}

function getCell(row, index) {
  if (index < 0) return '';
  return row[index] ?? '';
}

function readRow(sheet, rowIndex, maxCol) {
  const row = [];
  for (let colIndex = 0; colIndex <= maxCol; colIndex += 1) {
    const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
    const cell = sheet[address];
    row.push(cell ? cell.w ?? cell.v ?? '' : '');
  }
  return row;
}

function findCourierMatch(orderNumber, row) {
  const normalizedOrderNumber = normalizeText(orderNumber);
  if (normalizedCourierNumbers.some((number) => normalizedOrderNumber.endsWith(number))) {
    return { value: orderNumber };
  }

  for (const value of row.map(normalizeText)) {
    if (normalizedCourierNumbers.some((number) => value.endsWith(number))) {
      return { value };
    }
  }

  return null;
}

function normalizeText(value) {
  return String(value ?? '')
    .replace(/\u00A0/g, ' ')
    .replace(/\t/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
    .toUpperCase();
}

function renderRoute(rows) {
  resultCount.textContent = `${rows.length} точек`;

  if (!rows.length) {
    routeMap.innerHTML = '<div class="empty-state">Загрузите Excel, чтобы увидеть маршрут.</div>';
    return;
  }

  routeMap.classList.remove('empty-state');
  routeMap.innerHTML = rows
    .map((row, index) => {
      const orderId = row.orderId || row.orderNumber || row.matchedValue || 'Без номера';
      const address = row.deliveryAddress || '';
      const yandexMapsUrl = `https://yandex.ru/maps/?text=${encodeURIComponent(address)}`;

      return `
        <div class="route-point">
          <div class="step-dot"></div>
          <div>
            <div class="order-row">
              <button class="order-toggle" type="button" data-order-toggle="${index}">
                <span class="order-title">${index + 1}. Заказ ${escapeHtml(orderId)}</span>
                <span class="order-hint">Показать детали заказа</span>
              </button>
              <a class="map-link" href="${yandexMapsUrl}" target="_blank" rel="noopener noreferrer" title="Открыть адрес в Яндекс Картах">🗺️</a>
            </div>
            <div class="order-details" hidden data-order-details="${index}">
              <div class="meta-grid">
                <div><strong>Адрес:</strong> ${escapeHtml(address)}</div>
                <div><strong>Вес:</strong> ${escapeHtml(row.grossWeight)}</div>
                <div><strong>Покупатель:</strong> ${escapeHtml(row.buyer)}</div>
                <div><strong>Комментарий:</strong> ${escapeHtml(row.comment)}</div>
                <div><strong>Ответственный:</strong> ${escapeHtml(row.responsible)}</div>
                <div><strong>Служба доставки:</strong> ${escapeHtml(row.deliveryService)}</div>
                <div><strong>Накладная:</strong> ${escapeHtml(row.orderNumber || row.matchedValue)}</div>
                <div><strong>Номер заказа:</strong> ${escapeHtml(row.orderId)}</div>
              </div>
            </div>
          </div>
        </div>
      `;
    })
    .join('');

  routeMap.querySelectorAll('[data-order-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const index = button.getAttribute('data-order-toggle');
      const details = routeMap.querySelector(`[data-order-details="${index}"]`);
      if (!details) return;
      details.hidden = !details.hidden;
      button.classList.toggle('expanded', !details.hidden);
    });
  });
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
