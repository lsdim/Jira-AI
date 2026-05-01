// background.js

const ALARM_NAME = 'refreshSheetsCache';

// Ініціалізація при встановленні
chrome.runtime.onInstalled.addListener(() => {
  setupAlarm();
  updateCache();
});

// Налаштування будильника на кожні 30 хвилин
function setupAlarm() {
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 30 });
}

// Слухаємо будильник
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) {
    updateCache();
  }
});

// Функція для парсингу посилання (копія з sheets.js для автономності)
function parseSheetUrl(url) {
  if (!url) return null;
  const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
  const gidMatch = url.match(/gid=([0-9]+)/);
  return { id: idMatch ? idMatch[1] : null, gid: gidMatch ? gidMatch[1] : "0" };
}

// Основна функція оновлення кешу
async function updateCache() {
  const storage = await chrome.storage.local.get('sheetsUrl');
  if (!storage.sheetsUrl) return;

  console.log('Background: Початок оновлення кешу...');
  
  let csvUrl = '';
  if (storage.sheetsUrl.includes('output=csv')) {
    csvUrl = storage.sheetsUrl;
  } else {
    const parsed = parseSheetUrl(storage.sheetsUrl);
    if (!parsed || !parsed.id) return;
    csvUrl = `https://docs.google.com/spreadsheets/d/${parsed.id}/export?format=csv&gid=${parsed.gid}`;
  }

  try {
    const response = await fetch(csvUrl);
    if (response.ok) {
      const text = await response.text();
      // Зберігаємо сирий текст CSV в сховище
      await chrome.storage.local.set({ 
        cachedCsvText: text,
        lastCacheUpdate: Date.now()
      });
      console.log('Background: Кеш оновлено успішно.');
    }
  } catch (e) {
    console.error('Background: Помилка оновлення кешу:', e);
  }
}

// Слухаємо зміни в налаштуваннях (якщо змінили URL - відразу оновлюємо)
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.sheetsUrl) {
    updateCache();
  }
});