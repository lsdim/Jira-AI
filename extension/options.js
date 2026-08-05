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
  const settings = {
    geminiApiKey: document.getElementById('apiKey').value,
    userPrompt: document.getElementById('prompt').value,
    sheetsUrl: document.getElementById('sheetsUrl').value,
    enableQueueTooltip: document.getElementById('enableTooltip').checked,
    enableIPHighlighting: document.getElementById('enableIPHighlighting').checked,
    enablePhoneHighlighting: document.getElementById('enablePhoneHighlighting').checked,
    enableBarcodeHighlighting: document.getElementById('enableBarcodeHighlighting').checked,
    enableExtraHighlighting: document.getElementById('enableExtraHighlighting').checked,
    enableAttachmentFiltering: document.getElementById('enableAttachmentFiltering').checked,
    enableCalling: document.getElementById('enableCalling').checked,
    callPrefix: document.getElementById('callPrefix').value,
    // Нові налаштування оформлення
    enableGreeting: document.getElementById('enableGreeting').checked,
    greetingText: document.getElementById('greetingText').value,
    enableConsultNote: document.getElementById('enableConsultNote').checked,
    consultNoteText: document.getElementById('consultNoteText').value,
    enableSignature: document.getElementById('enableSignature').checked,
    signatureText: document.getElementById('signatureText').value
  };

  chrome.storage.local.set(settings, () => {
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
    enableQueueTooltip: true,
    enableIPHighlighting: true,
    enablePhoneHighlighting: true,
    enableBarcodeHighlighting: true,
    enableExtraHighlighting: true,
    enableAttachmentFiltering: true, // За замовчуванням увімкнено
    enableCalling: false,
    callPrefix: 'callto:',
    enableGreeting: true,
    greetingText: 'Добрий день',
    enableConsultNote: true,
    consultNoteText: 'Дане звернення буде закрито. Центр звернень користувачів приймає та обробляє заявки які стосуються виключно ІТ питань та проблем що виникли на робочому пристрої співробітників, надіслані через корпоративні методи зв\'язку',
    enableSignature: true,
    signatureText: 'З повагою, ІТ підтримка АТ "Укрпошта"'
  }, (items) => {
    document.getElementById('apiKey').value = items.geminiApiKey;
    document.getElementById('prompt').value = items.userPrompt || window.DEFAULT_PROMPT || '';
    document.getElementById('sheetsUrl').value = items.sheetsUrl;
    document.getElementById('enableTooltip').checked = items.enableQueueTooltip;
    document.getElementById('enableIPHighlighting').checked = items.enableIPHighlighting;
    document.getElementById('enablePhoneHighlighting').checked = items.enablePhoneHighlighting;
    document.getElementById('enableBarcodeHighlighting').checked = items.enableBarcodeHighlighting;
    document.getElementById('enableExtraHighlighting').checked = items.enableExtraHighlighting;
    document.getElementById('enableAttachmentFiltering').checked = items.enableAttachmentFiltering;
    document.getElementById('enableCalling').checked = items.enableCalling;
    document.getElementById('callPrefix').value = items.callPrefix;
    
    document.getElementById('enableGreeting').checked = items.enableGreeting;
    document.getElementById('greetingText').value = items.greetingText;
    document.getElementById('enableConsultNote').checked = items.enableConsultNote;
    document.getElementById('consultNoteText').value = items.consultNoteText;
    document.getElementById('enableSignature').checked = items.enableSignature;
    document.getElementById('signatureText').value = items.signatureText;
  });
}

document.addEventListener('DOMContentLoaded', loadOptions);