// extension/attachments.js

const ATTACHMENT_CONFIG = {
  // Регулярні вирази для назв файлів, які треба приховати
  NAME_PATTERNS: [
    /^image\d{3,}\.(png|jpg|jpeg|gif)$/i,
    /^(Outlook|ios)Emoji-[\da-f-]+\.(png|jpg|jpeg|gif)$/i,
    /^[a-f0-9]{8}-([a-f0-9]{4}-){3}[a-f0-9]{12}\.(png|jpg|jpeg|gif)$/i, // GUID
    /^logo\.(png|jpg|jpeg|gif)$/i
  ],
  // Максимальний розмір файлу в кілобайтах
  MAX_SIZE_KB: 40,
  // Селектор контейнера з вкладеннями
  ATTACHMENT_BLOCK_SELECTOR: '#attachmentmodule .mod-content'
};

function parseSizeKb(text) {
  if (!text) return null;
  const match = text.trim().match(/([\d.]+)\s*(kB|KB|MB|Mb)/i);
  if (!match) return null;
  let value = parseFloat(match[1]);
  if (/mb/i.test(match[2])) value *= 1024;
  return value;
}

function hideSignatureAttachments() {
  const attachmentBlock = document.querySelector(ATTACHMENT_CONFIG.ATTACHMENT_BLOCK_SELECTOR);
  if (!attachmentBlock) return;

  // Шукаємо або створюємо панель
  let hiderPanel = attachmentBlock.querySelector('.ai-attachment-hider');

  const attachments = attachmentBlock.querySelectorAll('li.attachment-content');
  const hiddenItems = [];

  attachments.forEach(item => {
    // ПРОПУСКАЄМО, якщо вже приховано (hidden-by-ai) або відкрито вручну (manually-revealed)
    if (item.classList.contains('hidden-by-ai') || item.classList.contains('manually-revealed')) return;

    const titleEl = item.querySelector('dl .attachment-title');
    const sizeEl = item.querySelector('.attachment-size');
    if (!titleEl || !sizeEl) return;

    const fileName = titleEl.textContent.trim();
    const sizeKb = parseSizeKb(sizeEl.textContent);

    const isNameMatch = ATTACHMENT_CONFIG.NAME_PATTERNS.some(pattern => pattern.test(fileName));
    const isSizeMatch = sizeKb !== null && sizeKb < ATTACHMENT_CONFIG.MAX_SIZE_KB;

    if (isNameMatch && isSizeMatch) {
      item.style.display = 'none';
      item.classList.add('hidden-by-ai');
      hiddenItems.push(item);
    }
  });

  // Якщо знайшли нові сміттєві файли, створюємо панель
  if (hiddenItems.length > 0 && !hiderPanel) {
    hiderPanel = document.createElement('div');
    hiderPanel.className = 'ai-attachment-hider';
    hiderPanel._hiddenItems = hiddenItems; 

    hiderPanel.innerHTML = `
      <span>🖼️ Приховано ${hiddenItems.length} сміттєвих вкладень.</span>
      <button class="ai-attachment-hider-btn">Показати</button>
    `;

    attachmentBlock.prepend(hiderPanel);

    hiderPanel.querySelector('.ai-attachment-hider-btn').addEventListener('click', (e) => {
      const btn = e.target;
      const isShowing = btn.textContent === 'Показати';

      hiderPanel._hiddenItems.forEach(item => { 
        item.style.display = isShowing ? 'list-item' : 'none';
        item.classList.toggle('hidden-by-ai', !isShowing);
        item.classList.toggle('manually-revealed', isShowing);
      });

      btn.textContent = isShowing ? 'Приховати' : 'Показати';
      hiderPanel.querySelector('span').textContent = isShowing 
        ? `🖼️ Показано ${hiderPanel._hiddenItems.length} вкладень.` 
        : `🖼️ Приховано ${hiderPanel._hiddenItems.length} сміттєвих вкладень.`;
    });
  }
}

function initAttachmentFilter() {
  chrome.storage.local.get({ enableAttachmentFiltering: true }, (items) => {
    if (items.enableAttachmentFiltering) {
      // Перший запуск
      hideSignatureAttachments();
      
      // Слідкуємо за динамічними змінами
      const observer = new MutationObserver((mutations) => {
        // Проста перевірка, щоб не запускати на кожну дрібницю
        const hasRelevantChanges = mutations.some(m => m.target.matches(ATTACHMENT_CONFIG.ATTACHMENT_BLOCK_SELECTOR) || m.target.querySelector(ATTACHMENT_CONFIG.ATTACHMENT_BLOCK_SELECTOR));
        if (hasRelevantChanges) {
            hideSignatureAttachments();
        }
      });
      
      observer.observe(document.body, { childList: true, subtree: true });
    }
  });
}
