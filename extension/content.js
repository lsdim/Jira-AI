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
  }
};

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
  sheetsBtn.innerHTML = '📚 Шаблони Google';
  sheetsBtn.style.marginLeft = '10px';
  sheetsBtn.style.backgroundColor = '#e3fce1';
  sheetsBtn.style.color = '#006644';
  sheetsBtn.onclick = (e) => { e.preventDefault(); openSheetsModal(); };

  footer.prepend(sheetsBtn);
  footer.prepend(aiBtn);
}


function getTicketData() {
  const summary = document.querySelector(JIRA_CONFIG.selectors.summary)?.innerText || '';
  const description = document.querySelector(JIRA_CONFIG.selectors.description)?.innerText || '';
  const service = document.querySelector(JIRA_CONFIG.selectors.service)?.innerText?.trim() || 'Загальне';
  return { summary, description, service };
}

// Функції для роботи з історією
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

      <div class="ai-modal-sidebar" id="ai-sidebar">
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
        'gemma-3-27b-it',
        'gemini-2.0-flash-lite',
        'gemini-2.0-flash'
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
  }
  if (resolutionField) {
    resolutionField.value = '10309';
    resolutionField.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const commentIframe = document.querySelector('iframe[id^="mce_"][id$="_ifr"]');
  if (commentIframe?.contentDocument) {
    const editorBody = commentIframe.contentDocument.getElementById('tinymce');
    if (editorBody) {
      editorBody.innerHTML = `<p>${data.userComment}</p>`;
      const hiddenTextarea = document.querySelector(JIRA_CONFIG.selectors.dialogComment);
      if (hiddenTextarea) hiddenTextarea.value = data.userComment;
    }
  } else {
    const commentField = document.querySelector(JIRA_CONFIG.selectors.dialogComment);
    if (commentField) {
      commentField.value = data.userComment;
      commentField.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }
}

const observer = new MutationObserver(() => { injectAIButtonIntoDialog(); });
observer.observe(document.body, { childList: true, subtree: true });
injectAIButtonIntoDialog();