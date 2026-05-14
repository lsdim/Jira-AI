// extension/sheets.js

const SHEETS_CONFIG = {
    cols: {
        index: 0,
        resolution: 1,
        tag: 2,
        name: 3,
        subject: 3,
        works: 5,
        template: 6,
        pdfNeeded: 7,
        files: 8
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
    const storage = await chrome.storage.local.get(['sheetsUrl', 'cachedCsvText']);
    
    // Пріоритет кешу
    if (storage.cachedCsvText) {
        console.log('AI Helper: Завантажено з кешу');
        return parseCSV(storage.cachedCsvText);
    }

    const url = storage.sheetsUrl;
    if (!url) throw new Error('Посилання на таблицю не налаштовано в параметрах!');

    let csvUrl = url.includes('output=csv') ? url : (() => {
        const parsed = parseSheetUrl(url);
        if (!parsed || !parsed.id) throw new Error('Некоректне посилання на Google Таблицю!');
        return `https://docs.google.com/spreadsheets/d/${parsed.id}/export?format=csv&gid=${parsed.gid}`;
    })();
    
    try {
        console.log('AI Helper: Кеш порожній, завантаження:', csvUrl);
        const response = await fetch(csvUrl);
        if (!response.ok) throw new Error('Не вдалося завантажити дані');
        const text = await response.text();
        
        // Оновлюємо кеш
        await chrome.storage.local.set({ cachedCsvText: text, lastCacheUpdate: Date.now() });
        return parseCSV(text);
    } catch (e) {
        throw new Error('Помилка мережі: ' + e.message);
    }
}

async function getSheetsHistory() {
    const data = await chrome.storage.local.get('usedSheetsTemplates');
    return data.usedSheetsTemplates || [];
}

async function saveToSheetsHistory(item) {
    const history = await getSheetsHistory();
    // Використовуємо комбінацію теми та тегу як унікальний ключ
    const itemKey = `${item.tag} | ${item.subject}`;
    const newHistory = [item, ...history.filter(h => `${h.tag} | ${h.subject}` !== itemKey)].slice(0, 20);
    await chrome.storage.local.set({ usedSheetsTemplates: newHistory });
}

function parseCSV(text) {
    const result = [];
    let row = [];
    let col = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        let char = text[i];
        let next = text[i + 1];

        if (inQuotes) {
            if (char === '"' && next === '"') { col += '"'; i++; }
            else if (char === '"') inQuotes = false;
            else col += char;
        } else {
            if (char === '"') inQuotes = true;
            else if (char === ',') { row.push(col); col = ''; }
            else if (char === '\n' || (char === '\r' && next === '\n')) {
                if (char === '\r') i++;
                row.push(col);
                if (row.length > 1 || row[0] !== '') result.push(row);
                row = []; col = '';
            } else col += char;
        }
    }
    if (row.length > 0 || col !== '') { row.push(col); result.push(row); }
    return result.slice(1).map(r => ({
        index: r[SHEETS_CONFIG.cols.index] || '',
        resolution: r[SHEETS_CONFIG.cols.resolution] || '',
        tag: r[SHEETS_CONFIG.cols.tag] || '',
        name: r[SHEETS_CONFIG.cols.name] || '',
        subject: r[SHEETS_CONFIG.cols.subject] || '',
        works: r[SHEETS_CONFIG.cols.works] || '',
        template: r[SHEETS_CONFIG.cols.template] || '',
        pdf: r[SHEETS_CONFIG.cols.pdfNeeded] || '',
        files: r[SHEETS_CONFIG.cols.files] || ''
    })).filter(item => item.name || item.works);
}

// Функція показу повних деталей шаблону
function showTemplateDetails(item, parentWrapper) {
    // Визначаємо стиль в залежності від типу рішення
    const res = (item.resolution || '').toLowerCase();
    let resStyle = '';
    if (res.includes('вирішено')) resStyle = 'background:#e3fce1; color:#006644; border-color:#b3f5ad;';
    else if (res.includes('консультац')) resStyle = 'background:#fff0b3; color:#172b4d; border-color:#ffe380;';
    else if (res.includes('l1')) resStyle = 'background:#deebff; color:#0747a6; border-color:#cce0ff;';

    const overlay = document.createElement('div');
    overlay.className = 'ai-details-overlay';
    overlay.innerHTML = `
        <div class="ai-details-content">
            <div class="ai-main-header">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <h3>📄 Деталі шаблону</h3>
                    <span class="ai-service-tag">${item.tag}</span>
                </div>
            </div>
            <div class="ai-details-body">
                <div class="ai-details-row">
                    <span class="ai-details-label">Назва</span>
                    <div style="font-weight:bold; color:#0052cc;">${item.name}</div>
                </div>
                <div class="ai-details-row">
                    <span class="ai-details-label">Тип рішення</span>
                    <div class="ai-service-tag" style="${resStyle}">${item.resolution}</div>
                </div>
                <div class="ai-details-row">
                    <span class="ai-details-label">Виконані роботи</span>
                    <div class="ai-details-text">${item.works}</div>
                </div>
                <div class="ai-details-row">
                    <span class="ai-details-label">Текст відповіді (Коментар)</span>
                    <div class="ai-details-text" style="background:#fffbe6; border-color:#ffe380;">${item.template}</div>
                </div>
                ${item.pdf.toLowerCase() === 'так' ? `
                <div class="ai-details-row">
                    <span class="ai-details-label" style="color: #de350b;">📎 Потрібні файли</span>
                    <div class="ai-details-text" style="color: #de350b; border-color:#ffbdad;">${item.files}</div>
                </div>` : ''}
            </div>
            <div class="ai-modal-buttons" style="padding: 16px 24px;">
                <button id="ai-apply-details-btn" class="aui-button aui-button-primary">Використати цей шаблон</button>
                <button id="ai-close-details-btn" class="aui-button aui-button-link">Назад до списку</button>
            </div>
        </div>
    `;

    parentWrapper.appendChild(overlay);

    document.getElementById('ai-close-details-btn').onclick = () => overlay.remove();
    document.getElementById('ai-apply-details-btn').onclick = async () => {
        await saveToSheetsHistory(item);
        applyTemplate(item);
        document.getElementById('ai-helper-modal').remove();
    };
}

async function openSheetsModal() {
    const modal = document.createElement('div');
    modal.id = 'ai-helper-modal';
    
    let historyData = await getSheetsHistory();

    modal.innerHTML = `
        <div class="ai-modal-wrapper" id="ai-sheets-wrapper" style="width: 1000px; height: 650px;">
            <div class="ai-modal-main">
                <button class="ai-toggle-history-btn" id="sheets-history-toggle">Останні (H)</button>
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
                    </div>
                </div>
                <div class="ai-modal-buttons" style="padding: 16px 24px; background: white; border-top: 1px solid #f0f0f0; display: flex; gap: 12px; justify-content: flex-end;">
                    <button id="sheets-refresh-btn" class="aui-button">🔄 Оновити базу</button>
                    <button id="ai-close-sheets-btn" class="aui-button aui-button-link">Закрити</button>
                </div>
            </div>
            <div class="ai-modal-sidebar collapsed" id="sheets-sidebar">
                <div class="ai-history-header"><label>Останні використані</label></div>
                <div class="ai-history-list" id="sheets-history-list"></div>
            </div>
        </div>
    `;

    document.body.appendChild(modal);
    const container = document.getElementById('sheets-results-container');
    const wrapper = document.getElementById('ai-sheets-wrapper');
    const searchInput = document.getElementById('sheet-search');
    const tagFilter = document.getElementById('tag-filter');
    const sidebar = document.getElementById('sheets-sidebar');
    const historyList = document.getElementById('sheets-history-list');

    const renderHistory = () => {
        if (historyData.length === 0) {
            historyList.innerHTML = '<div style="padding: 20px; font-size: 11px; color: #888; text-align: center;">Історія порожня</div>';
            return;
        }
        historyList.innerHTML = historyData.map((h, idx) => `
            <div class="ai-history-item" data-hidx="${idx}" title="${h.subject.replace(/"/g, '&quot;')}">
                <div style="font-weight: bold; color: #0052cc; font-size: 11px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;">${h.subject}</div>
                <div style="font-size: 10px; color: #6b778c; margin-top: 4px;">${h.tag}</div>
            </div>
        `).join('');
        historyList.querySelectorAll('.ai-history-item').forEach(el => {
            el.onclick = () => { applyTemplate(historyData[el.dataset.hidx]); modal.remove(); };
        });
    };

    const renderResults = (dataToRender) => {
        if (dataToRender.length === 0) {
            container.innerHTML = '<div style="grid-column: span 2; text-align:center; padding:50px; color:#6b778c;">Нічого не знайдено</div>';
            return;
        }
        container.innerHTML = dataToRender.map((item, idx) => `
            <div class="sheet-template-card" data-idx="${idx}" style="background:white; padding:15px; border-radius:8px; border:1px solid #dfe1e6; cursor:pointer; transition:all 0.2s; display:flex; flex-direction:column; gap:8px; position:relative;">
                <div style="display:flex; justify-content:space-between; align-items:center;">
                    <span class="ai-service-tag" style="font-size:10px;">${item.tag}</span>
                    <div style="display:flex; gap:8px; align-items:center;">
                        <button class="sheet-preview-btn" data-previdx="${idx}" title="Швидкий перегляд">👁</button>
                        <span style="font-size: 10px; color: #97a0af; font-weight:bold;">#${item.index}</span>
                    </div>
                </div>
                <div style="font-weight: bold; font-size: 14px; color: #0052cc;">${item.name}</div>
                <div style="font-size: 11px; color: #5e6c84; background: #f9fafb; padding: 8px; border-radius: 4px; border: 1px dashed #dfe1e6; flex: 1; white-space: pre-line;">
                    ${item.works.length > 150 ? item.works.substring(0, 150) + '...' : item.works}
                </div>
                ${item.pdf.toLowerCase() === 'так' ? '<div style="font-size:10px; color:#de350b; font-weight:bold;">📎 Файл: ' + item.files + '</div>' : ''}
            </div>
        `).join('');

        container.querySelectorAll('.sheet-template-card').forEach(card => {
            card.onclick = async (e) => {
                if (e.target.closest('.sheet-preview-btn')) return;
                const item = dataToRender[card.dataset.idx];
                await saveToSheetsHistory(item);
                applyTemplate(item);
                modal.remove();
            };
        });

        container.querySelectorAll('.sheet-preview-btn').forEach(btn => {
            btn.onclick = (e) => {
                e.stopPropagation();
                showTemplateDetails(dataToRender[btn.dataset.previdx], wrapper);
            };
        });
    };

    const handleFilter = () => {
        const query = searchInput.value.toLowerCase();
        const tag = tagFilter.value;
        const filtered = cachedSheetsData.filter(item => {
            const searchSource = `${item.tag} ${item.name} ${item.works} ${item.subject} ${item.template}`.toLowerCase();
            return searchSource.includes(query) && (!tag || item.tag === tag);
        });
        renderResults(filtered);
    };

    const loadAndShow = async (forceUpdate = false) => {
        if (forceUpdate) {
            container.innerHTML = '<div style="grid-column: span 2; text-align: center; padding: 40px;">Оновлення бази з Google Sheets... 🔃</div>';
            await chrome.storage.local.remove('cachedCsvText');
        } else {
            if (!cachedSheetsData.length) {
                container.innerHTML = '<div style="grid-column: span 2; text-align: center; padding: 40px;">Завантаження... 🔃</div>';
            }
        }

        try {
            cachedSheetsData = await fetchSheetData();
            const tags = [...new Set(cachedSheetsData.map(i => i.tag))].filter(Boolean).sort();
            tagFilter.innerHTML = '<option value="">Всі теги</option>' + 
                tags.map(t => `<option value="${t.replace(/"/g, '&quot;')}">${t}</option>`).join('');
            renderResults(cachedSheetsData);
            renderHistory();
            if (!forceUpdate) searchInput.focus();
        } catch (e) {
            container.innerHTML = `<div style="grid-column: span 2; color:red; padding:20px; text-align:center;">${e.message}</div>`;
        }
    };

    searchInput.oninput = handleFilter;
    tagFilter.onchange = handleFilter;

    document.getElementById('sheets-history-toggle').onclick = () => sidebar.classList.toggle('collapsed');
    document.getElementById('sheets-refresh-btn').onclick = () => loadAndShow(true);
    document.getElementById('ai-close-sheets-btn').onclick = () => modal.remove();
    loadAndShow();
}

async function applyTemplate(item) {
    const settings = await chrome.storage.local.get({
        enableGreeting: true,
        greetingText: 'Добрий день',
        enableConsultNote: true,
        consultNoteText: 'Дане звернення буде закрито. Центр звернень користувачів приймає та обробляє заявки які стосуються виключно ІТ питань та проблем що виникли на робочому пристрої співробітників, надіслані через корпоративні методи зв\'язку',
        enableSignature: true,
        signatureText: 'З повагою, ІТ підтримка АТ "Укрпошта"'
    });

    let finalTemplate = item.template;
    const isConsultation = item.resolution.toLowerCase().includes('консультація');

    // Збираємо текст: Привітання + Шаблон + Примітка + Підпис
    let parts = [];
    if (settings.enableGreeting && settings.greetingText) parts.push(settings.greetingText);
    parts.push(finalTemplate);
    if (isConsultation && settings.enableConsultNote && settings.consultNoteText) parts.push(settings.consultNoteText);
    if (settings.enableSignature && settings.signatureText) parts.push(settings.signatureText);

    const data = {
        executedWorks: item.works,
        userComment: parts.join('\n\n'),
        resolutionCode: isConsultation ? '10310' : '10309'
    };

    if (typeof fillJiraFields === 'function') {
        fillJiraFields(data);
        if (item.pdf.toLowerCase() === 'так') {
            alert(`💡 Зверніть увагу!\nДля цього шаблону потрібно прикріпити файл:\n"${item.files}"`);
        }
    }
}
