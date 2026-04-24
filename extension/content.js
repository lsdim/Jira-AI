// content.js

const JIRA_CONFIG = {
  selectors: {
    // Дані на основній сторінці (під модалкою)
    summary: '#summary-val',
    description: '#description-val',
    
    // Елементи в модальному вікні Jira
    dialogFooter: '.aui-dialog2-footer .buttons, .jira-dialog-core .buttons, #issue-workflow-transition .buttons',
    dialogResolution: '#customfield_10632', // Результат обробки
    dialogExecutedWorks: '#customfield_10831', // Виконані роботи
    dialogComment: '#comment', // Коментар
  }
};

// Функція впровадження кнопки в модальне вікно
function injectAIButtonIntoDialog() {
  // Перевіряємо, чи є відкрите діалогове вікно Jira
  const footer = document.querySelector(JIRA_CONFIG.selectors.dialogFooter);
  if (!footer || document.getElementById('jira-ai-helper-btn')) return;

  const aiBtn = document.createElement('button');
  aiBtn.id = 'jira-ai-helper-btn';
  aiBtn.className = 'aui-button';
  aiBtn.type = 'button'; // Щоб не сабмітив форму Jira
  aiBtn.innerHTML = '✨ AI Відповідь';
  aiBtn.style.marginLeft = '10px';
  aiBtn.style.backgroundColor = '#deebff';
  aiBtn.style.color = '#0052cc';

  aiBtn.onclick = (e) => {
    e.preventDefault();
    openManualInputModal();
  };

  // Додаємо кнопку на початок списку кнопок у футері
  footer.prepend(aiBtn);
}

// Функція збору даних заявки (вони залишаються в DOM под модалкою)
function getTicketData() {
  const summary = document.querySelector(JIRA_CONFIG.selectors.summary)?.innerText || '';
  const description = document.querySelector(JIRA_CONFIG.selectors.description)?.innerText || '';
  return { summary, description };
}

// Модальне вікно для уточнень
function openManualInputModal() {
  const ticketData = getTicketData();
  
  const modal = document.createElement('div');
  modal.id = 'ai-helper-modal';
  modal.innerHTML = `
    <div class="ai-modal-content">
      <h3>Уточнення для ШІ</h3>
      <p style="font-size: 12px; color: #6b778c;"><strong>Заявка:</strong> ${ticketData.summary}</p>
      <label>Що саме було зроблено?</label>
      <textarea id="ai-manual-notes" placeholder="Наприклад: переобтиснув кабель, оновив драйвери..."></textarea>
      <div class="ai-modal-buttons">
        <button id="ai-generate-btn" class="aui-button aui-button-primary">Згенерувати</button>
        <button id="ai-cancel-btn" class="aui-button aui-button-link">Скасувати</button>
      </div>
      <div id="ai-loading" style="display:none; margin-top:10px;">🤖 AI генерує відповідь...</div>
      <div id="ai-status-log" style="font-size: 10px; color: #888; margin-top: 5px;"></div>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById('ai-manual-notes').focus();

  document.getElementById('ai-cancel-btn').onclick = () => modal.remove();
  document.getElementById('ai-generate-btn').onclick = async () => {
    const manualNotes = document.getElementById('ai-manual-notes').value;
    const loadingEl = document.getElementById('ai-loading');
    const statusLog = document.getElementById('ai-status-log');
    
    loadingEl.style.display = 'block';
    document.getElementById('ai-generate-btn').disabled = true;
    
    try {
      await processAIGeneration(ticketData, manualNotes, (msg) => {
        statusLog.innerText = msg;
      });
      modal.remove();
    } catch (err) {
      alert('Всі моделі AI недоступні або сталася помилка: ' + err.message);
      loadingEl.style.display = 'none';
      document.getElementById('ai-generate-btn').disabled = false;
    }
  };
}

async function processAIGeneration(ticketData, manualNotes, onProgress) {
  const storage = await chrome.storage.local.get(['geminiApiKey', 'userPrompt']);
  const apiKey = storage.geminiApiKey;
  const basePrompt = storage.userPrompt || window.DEFAULT_PROMPT;

  if (!apiKey) {
    throw new Error('API Key не знайдено! Налаштуйте його в параметрах розширення.');
  }

  // Ваш список моделей для ітерації
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
      if (onProgress) onProgress(`Спроба через ${model}...`);
      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: finalPrompt }] }]
        })
      });
      const data = await response.json();
      
      if (data.error) { 
		console.warn(`AI Helper: Модель ${model} недоступна: ${data.error.message}`);
		lastError = data.error.message; 
		continue;
	  }
	  
      if (!data.candidates || data.candidates.length === 0) {
		  continue;
	  }		  
	  
      let text = data.candidates[0].content.parts[0].text;
      const cleanJson = text.replace(/```json/g, '').replace(/```/g, '').trim();
	  
	  const result = JSON.parse(cleanJson);
      fillJiraFields(result);
	  
	  console.log(`AI Helper: Успішно через ${model}`);      
      return;
	  
    } catch (e) {
		console.error(`AI Helper: Помилка ${model}:`, e);
		lastError = e.message; 
	}
  }

  throw new Error(lastError || 'Невідома помилка');
}

// Автозаповнення полів у відкритому діалозі Jira
function fillJiraFields(data) {
  const worksField = document.querySelector(JIRA_CONFIG.selectors.dialogExecutedWorks);
  const resolutionField = document.querySelector(JIRA_CONFIG.selectors.dialogResolution);

  if (worksField) {
    worksField.value = data.executedWorks;
    worksField.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (resolutionField) {
    resolutionField.value = '10309'; // ID для "Вирішена"
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

// Постійний моніторинг появи модальних вікон
const observer = new MutationObserver(() => {
  injectAIButtonIntoDialog();
});

observer.observe(document.body, { childList: true, subtree: true });
injectAIButtonIntoDialog();