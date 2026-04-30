// extension/sheets.js

const SHEETS_CONFIG = {
    cols: {
        tag: 0,
        index: 1,
        name: 2,
        works: 3,
        subject: 4,
        template: 5,
        pdfNeeded: 6,
        files: 7
    }
};

let cachedSheetsData = [];

function parseSheetUrl(url) {
    if (!url) return null;
    try {
        const idMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
        const gidMatch = url.match(/gid=([0-9]+)/);
        const id = idMatch ? idMatch[1] : null;
        const gid = gidMatch ? gidMatch[1] : "0";
        return { id, gid };
    } catch (e) { return null; }
}

async function fetchSheetData() {
    const storage = await chrome.storage.local.get('sheetsUrl');
    if (!storage.sheetsUrl) throw new Error('Посилання на таблицю не налаштовано в параметрах!');

    const parsed = parseSheetUrl(storage.sheetsUrl);
    if (!parsed || !parsed.id) throw new Error('Некоректне посилання на Google Таблицю!');

    const csvUrl = `https://docs.google.com/spreadsheets/d/${parsed.id}/export?format=csv&gid=${parsed.gid}`;
    
    try {
        const response = await fetch(csvUrl);
        if (!response.ok) throw new Error('Не вдалося завантажити дані (перевірте доступ до таблиці)');
        const text = await response.text();
        return parseCSV(text);
    } catch (e) {
        throw new Error('Помилка мережі або доступу: ' + e.message);
    }
}

/**
 * Розумний парсер CSV, що обробляє багаторядкові поля та екранування лапок
 */
function parseCSV(text) {
    const result = [];
    let row = [];
    let col = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        let char = text[i];
        let next = text[i + 1];

        if (inQuotes) {
            if (char === '"' && next === '"') {
                col += '"'; // екранована лапка "" -> "
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                col += char;
            }
        } else {
            if (char === '"') {
                inQuotes = true;
            } else if (char === ',') {
                row.push(col.trim());
                col = '';
            } else if (char === '\n' || (char === '\r' && next === '\n')) {
                if (char === '\r') i++; // пропускаємо \r в парі \r\n
                row.push(col.trim());
                if (row.length > 1 || row[0] !== '') {
                    result.push(row);
                }
                row = [];
                col = '';
            } else {
                col += char;
            }
        }
    }
    
    // Додаємо останній рядок, якщо він не порожній
    if (row.length > 0 || col !== '') {
        row.push(col.trim());
        result.push(row);
    }

    // Пропускаємо заголовок і мапимо в об'єкти
    return result.slice(1).map(r => ({
        tag: r[SHEETS_CONFIG.cols.tag] || '',
        index: r[SHEETS_CONFIG.cols.index] || '',
        name: r[SHEETS_CONFIG.cols.name] || '',
        works: r[SHEETS_CONFIG.cols.works] || '',
        subject: r[SHEETS_CONFIG.cols.subject] || '',
        template: r[SHEETS_CONFIG.cols.template] || '',
        pdf: r[SHEETS_CONFIG.cols.pdfNeeded] || '',
        files: r[SHEETS_CONFIG.cols.files] || ''
    })).filter(item => item.name || item.works); // фільтруємо зовсім порожні рядки
}

async function openSheetsModal() {
    const modal = document.createElement('div');
    modal.id = 'ai-helper-modal';
    
    modal.innerHTML = `
        <div class="ai-modal-wrapper" style="width: 1000px; height: 650px;">
            <div class="ai-modal-main">
                <div class="ai-main-header">
                    <h3>📚 База шаблонів (Google Sheets)</h3>
                    <div style="display: flex; gap: 12px; margin-top: 15px;">
                        <input type="text" id="sheet-search" class="ai-history-search" placeholder="Пошук за ключовими словами..." style="flex: 2;">
                        <select id="tag-filter" style="flex: 1; padding: 8px; border-radius: 6px; border: 1px solid #dfe1e6; font-size: 13px;">
                            <option value="">Всі теги</option>
                        </select>
                    </div>
                </div>
                
                <div class="ai-main-content" style="padding: 0; overflow: hidden; background: #f4f5f7;">
                    <div id="sheets-results-container" style="height: 100%; overflow-y: auto; padding: 16px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-content: start;">
                        <div id="sheets-loading" style="grid-column: span 2; text-align: center; padding: 40px;">Завантаження бази... 🔃</div>
                    </div>
                </div>

                <div class="ai-modal-buttons" style="padding: 16px 24px; background: white; border-top: 1px solid #f0f0f0; display: flex; gap: 12px; justify-content: flex-end;">
                    <button id="sheets-refresh-btn" class="aui-button">🔄 Оновити дані</button>
                    <button id="ai-close-sheets-btn" class="aui-button aui-button-link">Закрити</button>
                </div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);

    const container = document.getElementById('sheets-results-container');
    const searchInput = document.getElementById('sheet-search');
    const tagFilter = document.getElementById('tag-filter');

    const renderResults = (data) => {
        if (data.length === 0) {
            container.innerHTML = '<div style="grid-column: span 2; text-align:center; padding:50px; color:#6b778c;">Нічого не знайдено</div>';
            return;
        }

        container.innerHTML = data.map((item, idx) => `
            <div class="sheet-template-card" data-idx="${idx}" style="background:white; padding:15px; border-radius:8px; border:1px solid #dfe1e6; cursor:pointer; transition:all 0.2s; display:flex; flex-direction:column; gap:8px; position:relative;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="ai-service-tag" style="font-size:10px;">${item.tag}</span>
                    <span style="font-size: 10px; color: #97a0af; font-weight:bold;">#${item.index}</span>
                </div>
                <div style="font-weight: bold; font-size: 14px; color: #0052cc;">${item.name}</div>
                <div style="font-size: 11px; color: #172b4d; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;" title="${item.subject.replace(/"/g, '&quot;')}">
                    <strong>Тема:</strong> ${item.subject}
                </div>
                <div style="font-size: 11px; color: #5e6c84; background: #f9fafb; padding: 8px; border-radius: 4px; border: 1px dashed #dfe1e6; flex: 1; white-space: pre-line;">
                    ${item.works.length > 150 ? item.works.substring(0, 150) + '...' : item.works}
                </div>
                ${item.pdf.toLowerCase() === 'так' ? '<div style="font-size:10px; color:#de350b; font-weight:bold; display:flex; align-items:center; gap:4px;">📎 PDF: ' + item.files + '</div>' : ''}
            </div>
        `).join('');

        container.querySelectorAll('.sheet-template-card').forEach(card => {
            card.onclick = () => {
                const currentData = (searchInput.value || tagFilter.value) ? filteredData : cachedSheetsData;
                applyTemplate(currentData[card.dataset.idx]);
                modal.remove();
            };
        });
    };

    let filteredData = [];
    const handleFilter = () => {
        const query = searchInput.value.toLowerCase();
        const tag = tagFilter.value;
        
        filteredData = cachedSheetsData.filter(item => {
            const searchSource = `${item.tag} ${item.name} ${item.works} ${item.subject} ${item.template}`.toLowerCase();
            const matchesSearch = searchSource.includes(query);
            const matchesTag = !tag || item.tag === tag;
            return matchesSearch && matchesTag;
        });
        renderResults(filteredData);
    };

    const loadAndShow = async () => {
        container.innerHTML = '<div style="grid-column: span 2; text-align: center; padding: 40px;">Оновлення бази... 🔃</div>';
        try {
            cachedSheetsData = await fetchSheetData();
            const tags = [...new Set(cachedSheetsData.map(i => i.tag))].filter(Boolean).sort();
            tagFilter.innerHTML = '<option value="">Всі теги</option>' + 
                tags.map(t => `<option value="${t.replace(/"/g, '&quot;')}">${t}</option>`).join('');
            renderResults(cachedSheetsData);
            searchInput.focus();
        } catch (e) {
            container.innerHTML = `<div style="grid-column: span 2; color:red; padding:20px; text-align:center;">${e.message}</div>`;
        }
    };

    searchInput.oninput = handleFilter;
    tagFilter.onchange = handleFilter;
    document.getElementById('sheets-refresh-btn').onclick = loadAndShow;
    document.getElementById('ai-close-sheets-btn').onclick = () => modal.remove();

    loadAndShow();
}

function applyTemplate(item) {
    const data = {
        executedWorks: item.works,
        userComment: item.template
    };
    
    if (typeof fillJiraFields === 'function') {
        fillJiraFields(data);
        if (item.pdf.toLowerCase() === 'так') {
            alert(`💡 Зверніть увагу!\nДля цього шаблону потрібно прикріпити файл:\n"${item.files}"`);
        }
    }
}
