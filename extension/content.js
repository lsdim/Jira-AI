// content.js

const JIRA_CONFIG = {
  selectors: {
    summary: '#summary-val',
    description: '#description-val',
    service: '#customfield_10617-val', // Поле "Сервіс"
    dialogFooter: '.aui-dialog2-footer .buttons, .jira-dialog-core .buttons, #issue-workflow-transition .buttons',
    dialogResolution: '#customfield_10632', // Результат обробки
    dialogExecutedWorks: '#customfield_10831', // Виконані роботи
    dialogComment: '#comment', // Коментар
    // Селектор для ключів заявок у таблицях черг
    ticketKeyLink: 'a.issue-link[data-issue-key]',
    // Поле з IP адресою
    ipCustomField: '#customfield_10616-val'
  }
};

const IP_REGEX = /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;

// Функція підсвітки IP
function processIPHighlights() {
  const selectors = [JIRA_CONFIG.selectors.description, JIRA_CONFIG.selectors.ipCustomField];
  
  selectors.forEach(sel => {
    const el = document.querySelector(sel);
    if (!el || el.querySelector('.ai-ip-highlight')) return;

    // Працюємо з текстовими вузлами, щоб не пошкодити існуючу розмітку
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
    let node;
    const nodesToReplace = [];

    while (node = walker.nextNode()) {
      if (IP_REGEX.test(node.nodeValue)) {
        nodesToReplace.push(node);
      }
    }

    nodesToReplace.forEach(textNode => {
      const span = document.createElement('span');
      span.innerHTML = textNode.nodeValue.replace(IP_REGEX, match => 
        `<span class="ai-ip-highlight" title="Натисніть щоб копіювати">${match}</span>`
      );
      textNode.parentNode.replaceChild(span, textNode);
    });
  });
}

// Глобальний обробник кліку для копіювання IP
document.addEventListener('click', async (e) => {
  if (e.target.classList.contains('ai-ip-highlight')) {
    const ip = e.target.innerText.trim();
    try {
      await navigator.clipboard.writeText(ip);
      const btn = e.target;
      btn.classList.add('copied');
      setTimeout(() => btn.classList.remove('copied'), 2000);
    } catch (err) {
      console.error('Помилка копіювання:', err);
    }
  }
});

// --- Секція AI та шаблонів ---
function injectAIButtonIntoDialog() {
  const footer = document.querySelector(JIRA_CONFIG.selectors.dialogFooter);
  if (!footer || document.getElementById('jira-ai-helper-btn')) return;

  // Кнопка ШІ
  const aiBtn = document.createElement('button');
  aiBtn.id = 'jira-ai-helper-btn';
  aiBtn.className = 'aui-button';
  aiBtn.type = 'button';
  aiBtn.innerHTML = '✨ AI Відповідь';
  aiBtn.style.marginLeft = '10px';
  aiBtn.style.backgroundColor = '#deebff';
  aiBtn.style.color = '#0052cc';
  aiBtn.onclick = (e) => { e.preventDefault(); openManualInputModal(); };

  // Нова кнопка Google Sheets
  const sheetsBtn = document.createElement('button');
  sheetsBtn.id = 'jira-sheets-helper-btn';
  sheetsBtn.className = 'aui-button';
  sheetsBtn.type = 'button';
  sheetsBtn.innerHTML = '📚 Готові шаблони';
  sheetsBtn.style.marginLeft = '10px';
  sheetsBtn.style.backgroundColor = '#e3fce1';
  sheetsBtn.style.color = '#006644';
  sheetsBtn.onclick = (e) => { e.preventDefault(); openSheetsModal(); };

  footer.prepend(sheetsBtn);
  footer.prepend(aiBtn);
}

function getTicketData() {
  const summary = document.querySelector(JIRA_CONFIG.selectors.summary)?.innerText || '';
  let description = document.querySelector(JIRA_CONFIG.selectors.description)?.innerText || '';
  description = cleanJiraMarkup(description);
  const service = document.querySelector(JIRA_CONFIG.selectors.service)?.innerText?.trim() || 'Загальне';
  return { summary, description, service };
}

// Функція очищення тексту від вікі-розмітки Jira та "сміття"
function cleanJiraMarkup(text) {
  if (!text) return '';
  return text
    .replace(/\{color:[^}]*\}/gi, '')     // Видаляє {color:#212121}
    .replace(/\{color\}/gi, '')           // Видаляє {color}
    .replace(/\{[^}]+\}/gi, '')           // Видаляє будь-які інші теги {panel}, {quote}, {code} тощо
    .replace(/\[([^|\]]+)\|[^\]]+\]/g, '$1') // Складні посилання [Text|URL] -> Text
    .replace(/\[\^[^\]]+\]/g, '')         // Вкладення [^file.pdf]
    .replace(/\n{3,}/g, '\n\n')           // Замінює 3+ переноси рядків на два
    .replace(/^\s+|\s+$/g, '')            // trim
    .trim();
}

// --- Секція черг та Tooltip ---
let tooltipCache = new Map();
let tooltipTimeout = null;
let tooltipHideTimeout = null; // Таймер для приховування
let currentTooltip = null;

function initQueueEnhancements() {
  document.addEventListener('mouseover', (e) => {
    const link = e.target.closest(JIRA_CONFIG.selectors.ticketKeyLink);
    if (!link) return;

    // Скасовуємо приховування, якщо ми повернулися на посилання
    clearTimeout(tooltipHideTimeout);

    const issueKey = link.getAttribute('data-issue-key');
    if (!issueKey) return;

    clearTimeout(tooltipTimeout);
    tooltipTimeout = setTimeout(() => showIssueTooltip(issueKey, e.pageX, e.pageY), 500);
  });

  document.addEventListener('mouseout', (e) => {
    const link = e.target.closest(JIRA_CONFIG.selectors.ticketKeyLink);
    if (link) {
      clearTimeout(tooltipTimeout);
      // Починаємо ховати з невеликою затримкою
      tooltipHideTimeout = setTimeout(hideTooltip, 200);
    }
  });
}

async function showIssueTooltip(key, x, y) {
  if (currentTooltip) currentTooltip.remove();

  currentTooltip = document.createElement('div');
  currentTooltip.className = 'jira-ai-tooltip';
  currentTooltip.style.left = `${x + 15}px`;
  currentTooltip.style.top = `${y + 15}px`;
  
  // Якщо мишка зайшла в тултіп — скасовуємо таймер закриття
  currentTooltip.onmouseenter = () => {
    clearTimeout(tooltipHideTimeout);
  };

  // Коли мишка виходить з тултіпа — запускаємо таймер закриття
  currentTooltip.onmouseleave = () => {
    tooltipHideTimeout = setTimeout(hideTooltip, 200);
  };

  currentTooltip.innerHTML = `<div class="ai-tooltip-header">Завантаження ${key}...</div><div class="ai-tooltip-body"><div class="ai-pulse"></div></div>`;
  document.body.appendChild(currentTooltip);

  try {
    let data;
    if (tooltipCache.has(key)) {
      data = tooltipCache.get(key);
    } else {
      // 1. Отримуємо деталі заявки
      const issueResp = await fetch(`/rest/api/2/issue/${key}?fields=description,reporter,summary`);
      const issue = await issueResp.json();
      
      let description = issue.fields.description || 'Опис відсутній';
	  description = cleanJiraMarkup(description);
      const reporter = issue.fields.reporter;
      //const reporterKey = reporter ? (reporter.key || reporter.name) : null;
      const reporterKey = reporter.name;

      // 2. Шукаємо інші заявки цього ж автора
      let otherIssues = [];
      if (reporterKey) {
        const searchJql = `reporter = "${reporterKey}" AND key != ${key} ORDER BY created DESC`;
        const searchResp = await fetch(`/rest/api/2/search?jql=${encodeURIComponent(searchJql)}&maxResults=10&fields=summary,status,created`);
        const searchResult = await searchResp.json();
        otherIssues = searchResult.issues || [];
      }

      data = { summary: issue.fields.summary, description, otherIssues, reporterName: reporter?.displayName || 'Анонім' };
      tooltipCache.set(key, data);
    }

    renderTooltipContent(data, key);
  } catch (err) {
    currentTooltip.innerHTML = `<div class="ai-tooltip-body" style="color:red;">Помилка завантаження даних</div>`;
  }
}

function renderTooltipContent(data, key) {
  if (!currentTooltip) return;

  const otherTicketsHtml = data.otherIssues.length > 0 
    ? data.otherIssues.map(issue => {
        const status = issue.fields.status.name;
        const colorClass = getStatusColorClass(status);
        const date = new Date(issue.fields.created).toLocaleDateString('uk-UA');
        return `
          <div class="ai-tooltip-ticket-item">
            <span style="flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; margin-right:10px;" title="${issue.fields.summary}">
              <a href="https://jira.ukrposhta.loc/browse/${issue.key}"><strong>${issue.key}</strong></a>: ${issue.fields.summary}
            </span>
            <span class="ai-tooltip-status ${colorClass}">${status}</span>
            <span style="font-size:9px; color:#6b778c; margin-left:10px;">${date}</span>
          </div>`;
      }).join('')
    : '<div style="font-size:11px; color:#888;">Інших заявок не знайдено</div>';

  currentTooltip.innerHTML = `
    <div class="ai-tooltip-header">${key}: ${data.summary}</div>
    <div class="ai-tooltip-body">
      <span class="ai-tooltip-label">Опис проблеми:</span>
      <div class="ai-tooltip-description">${data.description}</div>
      
      <span class="ai-tooltip-label">Інші заявки від ${data.reporterName}:</span>
      <div class="ai-tooltip-other-tickets">
        ${otherTicketsHtml}
      </div>
    </div>
  `;
  
  // Коригуємо позицію, щоб не виходило за межі екрану
  const rect = currentTooltip.getBoundingClientRect();
  if (rect.right > window.innerWidth) {
    currentTooltip.style.left = `${window.innerWidth - rect.width - 20}px`;
  }
  if (rect.bottom > window.innerHeight) {
    currentTooltip.style.top = `${window.innerHeight - rect.height - 20}px`;
  }
}

function getStatusColorClass(status) {
  const s = status.toLowerCase();
  if (s.includes('вирішена') || s.includes('закрита') || s.includes('опрацьована') || s.includes('done') || s.includes('closed')) return 'status-green';
  if (s.includes('роботі') || s.includes('progress')) return 'status-blue';
  return 'status-yellow';
}

function hideTooltip() {
  if (currentTooltip) {
    currentTooltip.remove();
    currentTooltip = null;
  }
}

// --- Існуюча логіка автоматизації ---
async function getHistory(service) {
  const data = await chrome.storage.local.get('notesHistory');
  const history = data.notesHistory || {};
  return history[service] || [];
}

async function saveToHistory(service, note) {
  if (!note || note.trim().length < 5) return;
  const data = await chrome.storage.local.get('notesHistory');
  const history = data.notesHistory || {};
  if (!history[service]) history[service] = [];
  
  // Додаємо в початок, видаляємо дублікати
  history[service] = [note, ...history[service].filter(n => n !== note)].slice(0, 20);
  await chrome.storage.local.set({ notesHistory: history });
}

async function removeFromHistory(service, note) {
  const data = await chrome.storage.local.get('notesHistory');
  const history = data.notesHistory || {};
  if (history[service]) {
    history[service] = history[service].filter(n => n !== note);
    await chrome.storage.local.set({ notesHistory: history });
  }
}

async function openManualInputModal() {
  const ticketData = getTicketData();
  let history = await getHistory(ticketData.service);
  
  const modal = document.createElement('div');
  modal.id = 'ai-helper-modal';
  // ... (HTML залишається без змін до моменту рендерингу історії)
  modal.innerHTML = `
    <div class="ai-modal-wrapper" id="ai-modal-wrapper">
      <div class="ai-modal-main">
        <button class="ai-toggle-history-btn" id="ai-history-toggle">Шаблони (H)</button>
        <div class="ai-main-header">
          <h3>✨ AI Помічник</h3>
          <div style="margin-top: 4px;">
            <span class="ai-service-tag">${ticketData.service}</span>
          </div>
        </div>
        <div class="ai-main-content">
          <label>Що було зроблено для вирішення?</label>
          <textarea id="ai-manual-notes" placeholder="Опишіть технічну суть (напр: оновив ПЗ, скинув налаштування)..."></textarea>
        </div>
        <div class="ai-modal-buttons">
          <div id="ai-loading" style="display:none;">
            <div class="ai-pulse"></div>
            <span id="ai-status-log">Обробка...</span>
          </div>
          <button id="ai-generate-btn" class="aui-button aui-button-primary">🚀 Згенерувати</button>
          <button id="ai-cancel-btn" class="aui-button aui-button-link">Скасувати</button>
        </div>
      </div>
      <div class="ai-modal-sidebar collapsed" id="ai-sidebar">
        <div class="ai-history-header">
          <label>Ваші шаблони</label>
          <input type="text" class="ai-history-search" id="ai-search-input" placeholder="Пошук у минулих рішеннях...">
        </div>
        <div class="ai-history-list" id="ai-history-list"></div>
      </div>
    </div>
  `;

  document.body.appendChild(modal);
  const textarea = document.getElementById('ai-manual-notes');
  const sidebar = document.getElementById('ai-sidebar');
  const historyList = document.getElementById('ai-history-list');
  const searchInput = document.getElementById('ai-search-input');

  textarea.focus();

  // Логіка відображення історії з підтримкою видалення
  const renderHistory = (filter = '') => {
    const filtered = history.filter(h => h.toLowerCase().includes(filter.toLowerCase()));
    historyList.innerHTML = filtered.length 
      ? filtered.map(h => `
          <div class="ai-history-item" title="Натисніть щоб вставити">
            ${h}
            <div class="ai-history-item-delete" title="Видалити цей шаблон" data-note="${h.replace(/"/g, '&quot;')}">×</div>
          </div>`).join('')
      : `<div style="padding: 20px; font-size: 11px; color: #888; text-align: center;">Нічого не знайдено</div>`;
    
    // Клік по всьому елементу - вставка тексту
    historyList.querySelectorAll('.ai-history-item').forEach(item => {
      item.onclick = (e) => {
        if (e.target.classList.contains('ai-history-item-delete')) return;
        textarea.value = item.innerText.replace(/×$/, '').trim();
        textarea.focus();
      };
    });

    // Клік по хрестику - видалення
    historyList.querySelectorAll('.ai-history-item-delete').forEach(delBtn => {
      delBtn.onclick = async (e) => {
        e.stopPropagation();
        const noteToRemove = delBtn.getAttribute('data-note');
        if (confirm('Видалити цей шаблон з історії?')) {
          await removeFromHistory(ticketData.service, noteToRemove);
          history = await getHistory(ticketData.service); // Оновлюємо локальний список
          renderHistory(searchInput.value); // Перемальовуємо
        }
      };
    });
  };

  renderHistory();

  // Пошук
  searchInput.oninput = (e) => renderHistory(e.target.value);

  // Перемикання сайдбару
  document.getElementById('ai-history-toggle').onclick = () => {
    sidebar.classList.toggle('collapsed');
  };

  document.getElementById('ai-cancel-btn').onclick = () => modal.remove();
  
  document.getElementById('ai-generate-btn').onclick = async () => {
    const manualNotes = textarea.value;
    const loadingEl = document.getElementById('ai-loading');
    const statusLog = document.getElementById('ai-status-log');
    
    loadingEl.style.display = 'block';
    document.getElementById('ai-generate-btn').disabled = true;
    
    try {
      await processAIGeneration(ticketData, manualNotes, (msg) => { statusLog.innerText = msg; });
      await saveToHistory(ticketData.service, manualNotes);
      modal.remove();
    } catch (err) {
      alert('Помилка: ' + err.message);
      loadingEl.style.display = 'none';
      document.getElementById('ai-generate-btn').disabled = false;
    }
  };
}

async function processAIGeneration(ticketData, manualNotes, onProgress) {
  const storage = await chrome.storage.local.get(['geminiApiKey', 'userPrompt']);
  const apiKey = storage.geminiApiKey;
  const basePrompt = storage.userPrompt || window.DEFAULT_PROMPT;

  if (!apiKey) throw new Error('API Key не знайдено!');

  const userModels = [ 
		'gemini-2.5-flash-lite', 
        'gemini-2.5-flash', 
        'gemini-flash-latest',
        'gemma-4-31b-it',
        'gemma-3-27b-it'
  ];

  const filledPrompt = basePrompt
    .replace(/{{summary}}/g, ticketData.summary)
    .replace(/{{description}}/g, ticketData.description)
    .replace(/{{manualNotes}}/g, manualNotes || 'Проблема усунена, все працює коректно.');

  const finalPrompt = `${filledPrompt}\n\nНАДАЙ ВІДПОВІДЬ ВИКЛЮЧНО У ФОРМАТІ JSON:\n{\n  "executedWorks": "...",\n  "userComment": "..."\n}`;

  let lastError = null;
  for (const model of userModels) {
    try {
      if (onProgress) onProgress(`(${model})`);
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: finalPrompt }] }] })
      });

      const data = await response.json();
      if (data.error) { 
        lastError = `API Error (${model}): ${data.error.message}`;
        continue; 
      }
      
      if (!data.candidates || !data.candidates[0]?.content?.parts?.[0]?.text) {
        lastError = `Empty response from ${model}`;
        continue;
      }

      let text = data.candidates[0].content.parts[0].text;
      
      // 1. Покращене очищення: шукаємо першу { та останню }
      const startJson = text.indexOf('{');
      const endJson = text.lastIndexOf('}');
      
      if (startJson === -1 || endJson === -1) {
        lastError = `Invalid format from ${model} (no JSON object found)`;
        continue;
      }
      
      const cleanJson = text.substring(startJson, endJson + 1);
      
      try {
        const result = JSON.parse(cleanJson);
        
        // 2. Валідація полів
        if (typeof result.executedWorks !== 'string' || typeof result.userComment !== 'string') {
          throw new Error('Missing required fields in JSON');
        }
        
        fillJiraFields(result);
        return; // Успіх!
      } catch (parseError) {
        lastError = `JSON Parse/Validation Error (${model}): ${parseError.message}`;
        console.error(`AI Helper: ${lastError}`, cleanJson);
        continue;
      }

    } catch (e) { 
      lastError = `Network/Unexpected Error (${model}): ${e.message}`; 
    }
  }
  throw new Error(lastError);
}

function fillJiraFields(data) {
  const worksField = document.querySelector(JIRA_CONFIG.selectors.dialogExecutedWorks);
  const resolutionField = document.querySelector(JIRA_CONFIG.selectors.dialogResolution);
  
  if (worksField) {
    worksField.value = data.executedWorks;
    worksField.dispatchEvent(new Event('change', { bubbles: true }));
    worksField.dispatchEvent(new Event('input', { bubbles: true }));
  }

  if (resolutionField) {
    if (data.resolutionCode) {
      // Використовуємо код, переданий із шаблонів
      resolutionField.value = data.resolutionCode;
    } else {
      // Автоматично визначаємо результат для ШІ: Консультація (10310) або Вирішена (10309)
      const isConsultation = data.executedWorks.toLowerCase().includes('консультац');
      resolutionField.value = isConsultation ? '10310' : '10309';
    }
    resolutionField.dispatchEvent(new Event('change', { bubbles: true }));
    console.log(`AI Helper: Resolution set to ${resolutionField.value}`);
  }
  const commentIframe = document.querySelector('iframe[id^="mce_"][id$="_ifr"]');
  const hiddenTextarea = document.querySelector(JIRA_CONFIG.selectors.dialogComment);
  
  if (commentIframe?.contentDocument) {
    const editorBody = commentIframe.contentDocument.getElementById('tinymce');
    if (editorBody) {
      // Замінюємо переноси рядків на <br> для HTML редактора
      const htmlContent = (data.userComment || '').replace(/\n/g, '<br>');
      editorBody.innerHTML = `<p>${htmlContent}</p>`;
      // Сповіщаємо редактор про зміну вмісту
      editorBody.dispatchEvent(new Event('input', { bubbles: true }));
      
      if (hiddenTextarea) {
        hiddenTextarea.value = data.userComment || '';
        hiddenTextarea.dispatchEvent(new Event('input', { bubbles: true }));
        hiddenTextarea.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }
  } else if (hiddenTextarea) {
    hiddenTextarea.value = data.userComment || '';
    hiddenTextarea.dispatchEvent(new Event('input', { bubbles: true }));
    hiddenTextarea.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// --- Ініціалізація ---
const observer = new MutationObserver(() => {
  injectAIButtonIntoDialog();
  chrome.storage.local.get({ enableIPHighlighting: true }, (items) => {
    if (items.enableIPHighlighting) processIPHighlights();
  });
});

observer.observe(document.body, { childList: true, subtree: true });
injectAIButtonIntoDialog();

// Перевіряємо налаштування перед запуском
chrome.storage.local.get({ enableQueueTooltip: true, enableIPHighlighting: true }, (items) => {
  if (items.enableQueueTooltip) {
    initQueueEnhancements();
  }
  if (items.enableIPHighlighting) {
    processIPHighlights();
  }
});