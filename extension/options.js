// options.js

// Логіка закладок
document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll('.tab-btn, .tab-content').forEach(el => el.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  };
});

// Збереження налаштувань
document.getElementById('save').onclick = () => {
  const apiKey = document.getElementById('apiKey').value;
  const userPrompt = document.getElementById('prompt').value;
  const sheetsUrl = document.getElementById('sheetsUrl').value;
  const enableQueueTooltip = document.getElementById('enableTooltip').checked;

  chrome.storage.local.set({
    geminiApiKey: apiKey,
    userPrompt: userPrompt,
    sheetsUrl: sheetsUrl,
    enableQueueTooltip: enableQueueTooltip
  }, () => {
    const status = document.getElementById('status');
    status.textContent = '✅ Збережено';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
};

// Завантаження налаштувань
function loadOptions() {
  chrome.storage.local.get({
    geminiApiKey: '',
    userPrompt: '',
    sheetsUrl: '',
    enableQueueTooltip: true // За замовчуванням увімкнено
  }, (items) => {
    document.getElementById('apiKey').value = items.geminiApiKey;
    // Якщо користувацького промпту немає — показуємо стандартний
    document.getElementById('prompt').value = items.userPrompt || window.DEFAULT_PROMPT || '';
    document.getElementById('sheetsUrl').value = items.sheetsUrl;
    document.getElementById('enableTooltip').checked = items.enableQueueTooltip;
  });
}

document.addEventListener('DOMContentLoaded', loadOptions);