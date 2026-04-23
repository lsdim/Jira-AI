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
  aiBtn.innerHTML = '<span class="aui-icon aui-icon-small aui-iconfont-magic"></span> AI Відповідь';
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

// Функція збору даних заявки (вони залишаються в DOM під модалкою)
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
      <textarea id="ai-manual-notes" placeholder="Наприклад: переобтиснув кабель, оновив драйвери, перевірив доступність..."></textarea>
      <div class="ai-modal-buttons">
        <button id="ai-generate-btn" class="aui-button aui-button-primary">Згенерувати</button>
        <button id="ai-cancel-btn" class="aui-button aui-button-link">Скасувати</button>
      </div>
      <div id="ai-loading" style="display:none; margin-top:10px;">🤖 Gemini генерує відповідь...</div>
    </div>
  `;

  document.body.appendChild(modal);
  document.getElementById('ai-manual-notes').focus();

  document.getElementById('ai-cancel-btn').onclick = () => modal.remove();
  document.getElementById('ai-generate-btn').onclick = async () => {
    const manualNotes = document.getElementById('ai-manual-notes').value;
    document.getElementById('ai-loading').style.display = 'block';
    document.getElementById('ai-generate-btn').disabled = true;
    
    try {
      await processAIGeneration(ticketData, manualNotes);
      modal.remove();
    } catch (err) {
      alert('Помилка API: ' + err.message);
      document.getElementById('ai-loading').style.display = 'none';
      document.getElementById('ai-generate-btn').disabled = false;
    }
  };
}

// Робота з Gemini API
async function processAIGeneration(ticketData, manualNotes) {
  const storage = await chrome.storage.local.get('geminiApiKey');
  const apiKey = storage.geminiApiKey;

  if (!apiKey) {
    throw new Error('API Key не знайдено! Натисніть на іконку розширення та введіть ключ.');
  }

  const prompt = `
    Ти спеціаліст технічної підтримки (Local Support). Твоє завдання — заповнити звіт про виконання заявки.
    
    КОНТЕКСТ ЗАЯВКИ:
    Тема: ${ticketData.summary}
    Опис: ${ticketData.description}
    
    ЩО Я ЗРОБИВ (МОЇ НОТАТКИ):
    ${manualNotes || 'Проблема усунена, все працює коректно.'}
    
    ВИМОГИ ДО ВІДПОВІДІ:
    1. Поле "executedWorks": напиши коротко у форматі "Проблема: [суть] Вирішення: [що зроблено]".
    2. Поле "userComment": ввічлива відповідь користувачу (наприклад: "Доброго дня! Вашу заявку опрацьовано. Проблему з [суть] усунено. Гарного дня!").
    3. Мова: українська.
	4. Відповідь повинна бути коротка, чітка, без води.
    
    НАДАЙ ВІДПОВІДЬ ВИКЛЮЧНО У ФОРМАТІ JSON (без markdown):
    {
      "executedWorks": "...",
      "userComment": "..."
    }
  `;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }]
      })
    });

    const data = await response.json();
    if (data.error) throw new Error(data.error.message);

    let textResponse = data.candidates[0].content.parts[0].text;
    // Очищення від можливих артефактів розмітки
    textResponse = textResponse.replace(/```json/g, '').replace(/```/g, '').trim();
    
    const result = JSON.parse(textResponse);
    fillJiraFields(result);
  } catch (e) {
    console.error('Gemini Error:', e);
    throw e;
  }
}

// Заповнення полів у відкритому діалозі Jira
function fillJiraFields(data) {
  const worksField = document.querySelector(JIRA_CONFIG.selectors.dialogExecutedWorks);
  const commentField = document.querySelector(JIRA_CONFIG.selectors.dialogComment);
  const resolutionField = document.querySelector(JIRA_CONFIG.selectors.dialogResolution);

  if (worksField) {
    worksField.value = data.executedWorks;
    worksField.dispatchEvent(new Event('input', { bubbles: true }));
    worksField.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (commentField) {
    // В деяких версіях Jira це textarea, в деяких RTE (Rich Text Editor)
    commentField.value = data.userComment;
    commentField.dispatchEvent(new Event('input', { bubbles: true }));
    commentField.dispatchEvent(new Event('change', { bubbles: true }));
  }

  if (resolutionField) {
    resolutionField.value = '10309'; // ID для "Вирішена"
    resolutionField.dispatchEvent(new Event('change', { bubbles: true }));
  }
}

// Постійний моніторинг появи модальних вікон
const observer = new MutationObserver(() => {
  injectAIButtonIntoDialog();
});

observer.observe(document.body, { childList: true, subtree: true });
injectAIButtonIntoDialog();