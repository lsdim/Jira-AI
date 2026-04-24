// options.js
document.getElementById('save').addEventListener('click', () => {
  const apiKey = document.getElementById('apiKey').value;
  const customPrompt = document.getElementById('customPrompt').value;
  
  chrome.storage.local.set({ 
    geminiApiKey: apiKey,
    userPrompt: customPrompt
  }, () => {
    const status = document.getElementById('status');
    status.textContent = 'Збережено! ✅';
    setTimeout(() => { status.textContent = ''; }, 2000);
  });
});

// Завантажуємо дані при відкритті
chrome.storage.local.get(['geminiApiKey', 'userPrompt'], (data) => {
  if (data.geminiApiKey) {
    document.getElementById('apiKey').value = data.geminiApiKey;
  }
  
  // Якщо користувач ще не зберігав промпт, беремо DEFAULT_PROMPT з defaults.js
  if (data.userPrompt) {
    document.getElementById('customPrompt').value = data.userPrompt;
  } else {
    document.getElementById('customPrompt').value = window.DEFAULT_PROMPT;
  }
});