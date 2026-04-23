document.getElementById('save').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value;
  chrome: chrome.storage.local.set({ geminiApiKey: apiKey }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Налаштування збережено!';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});

// Завантажуємо існуючий ключ при відкритті
chrome.storage.local.get('geminiApiKey', (data) => {
  if (data.geminiApiKey) {
    document.getElementById('apiKey').value = data.geminiApiKey;
  }
});