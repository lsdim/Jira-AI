// options.js
document.getElementById('save').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value;
  const customPrompt = document.getElementById('customPrompt').value;
  const sheetsUrl = document.getElementById('sheetsUrl').value;
  
  chrome.storage.local.set({ 
    geminiApiKey: apiKey,
    userPrompt: customPrompt,
    sheetsUrl: sheetsUrl
  }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Збережено! ✅';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});

// Завантажуємо дані при відкритті
chrome.storage.local.get(['geminiApiKey', 'userPrompt', 'sheetsUrl'], (data) => {
  if (data.geminiApiKey) {
    document.getElementById('apiKey').value = data.geminiApiKey;
  }
  
  if (data.sheetsUrl) {
    document.getElementById('sheetsUrl').value = data.sheetsUrl;
  }
  
  if (data.userPrompt) {
    document.getElementById('customPrompt').value = data.userPrompt;
  } else {
    document.getElementById('customPrompt').value = window.DEFAULT_PROMPT;
  }
});