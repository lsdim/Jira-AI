// extension/highlighter.js

// Регулярні вирази
const IP_REGEX = /(?<![a-zA-Z0-9])\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
// Регулярка для телефонів (UA: 050..., 380..., +380..., 044...)
const PHONE_REGEX = /(?<![a-zA-Z0-9])(?:\+?38\s?)?0[3-9]\d[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}\b/g;
// Регулярка для штрихкодів (13 цифр, R+12 цифр або міжнародний XX123456789YY)
const BARCODE_REGEX = /(?<![a-zA-Z0-9])(?:\d{13}|R\d{12}|[A-Z]{2}\d{9}[A-Z]{2})(?![a-zA-Z0-9])/g;
const LOGIN_REGEX = /(?:Користувач:|User:)\s*([a-zA-Z]+(?:\d*)?-[a-zA-Z]+)/i;

// Універсальна функція підсвітки
function processHighlights() {
  chrome.storage.local.get({
    enableIPHighlighting: true,
    enablePhoneHighlighting: true,
    enableBarcodeHighlighting: true,
    enableExtraHighlighting: true,
    enableCalling: false,
    callPrefix: 'callto:'
  }, (items) => {
    const { enableIPHighlighting, enablePhoneHighlighting, enableBarcodeHighlighting, enableExtraHighlighting, enableCalling, callPrefix } = items;
    if (!Object.values(items).some(val => val === true)) return;

    const selectors = [
      { selector: '#description-val', type: 'all' },
      { selector: '#customfield_10616-val', type: 'ip' },
      { selector: '#customfield_10808-val', type: 'phone' },
      { selector: '#customfield_10833-val', type: 'barcode' },
      { selector: '#ad-info-content', type: 'all' }
    ];

    selectors.forEach(({ selector, type }) => {
      const el = document.querySelector(selector);
      if (!el) return;

      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      let node;
      const nodesToProcess = [];
      while (node = walker.nextNode()) {
        if (!node.parentNode.closest('.ai-ip-highlight, .ai-phone-highlight, .ai-barcode-highlight, .ai-text-highlight')) {
          nodesToProcess.push(node);
        }
      }

      nodesToProcess.forEach(textNode => {
        let newHtml = textNode.nodeValue;
        
        if (enableExtraHighlighting && (type === 'all' || type === 'extra')) {
          newHtml = newHtml.replace(LOGIN_REGEX, (match, login) => 
            match.replace(login, `<span class="ai-text-highlight" title="Копіювати логін">${login}</span>`)
          );
        }

        [
          { regex: IP_REGEX, enabled: enableIPHighlighting, className: 'ai-ip-highlight', title: 'Копіювати IP', itemType: 'ip' },
          { regex: PHONE_REGEX, enabled: enablePhoneHighlighting, className: 'ai-phone-highlight', title: 'Копіювати телефон', itemType: 'phone' },
          { regex: BARCODE_REGEX, enabled: enableBarcodeHighlighting, className: 'ai-barcode-highlight', title: 'Копіювати ШК', itemType: 'barcode' }
        ].forEach(({ regex, enabled, className, title, itemType }) => {
          if (enabled && (type === 'all' || type === itemType)) {
            regex.lastIndex = 0;
            if (regex.test(newHtml)) {
              newHtml = newHtml.replace(regex, match => {
                const callBtn = (itemType === 'phone' && enableCalling)
                  ? `<a href="${callPrefix}${match.replace(/\s|-/g, '')}" class="ai-call-btn" title="Подзвонити">📞</a>`
                  : '';
                return `<span class="${className}" title="${title}">${match}</span>${callBtn}`;
              });
            }
          }
        });
        
        if (newHtml !== textNode.nodeValue) {
            const span = document.createElement('span');
            span.innerHTML = newHtml;
            textNode.parentNode.replaceChild(span, textNode);
        }
      });

      // Підсвітка жирного тексту та специфічних полів в ad-info-content
      if (enableExtraHighlighting && (type === 'all' || type === 'extra')) {
        // Жирний текст
       /* el.querySelectorAll('b, strong').forEach(boldEl => {
          const text = boldEl.innerText.trim();
          if (text.length >= 4 && text.length <= 25 && !boldEl.querySelector('.ai-text-highlight')) {
            boldEl.innerHTML = `<span class="ai-text-highlight" title="Копіювати">${text}</span>`;
          }
        });
		*/

        // Блок ad-info
        if (selector === '#ad-info-content') {
            const rows = el.querySelectorAll('tr');
            rows.forEach(row => {
                const label = row.cells[0]?.innerText.trim();
                const valueCell = row.cells[1];
                if (!valueCell || valueCell.querySelector('.ai-text-highlight')) return;
                
                const valueText = valueCell.innerText.trim();
                if (valueText === '-' || valueText === '') return;

                if (label === 'Login:' || label === "Індекс:") {
                    valueCell.innerHTML = `<span class="ai-text-highlight" title="Копіювати">${valueText}</span>`;
                }
            });
        }
      }
    });
  });
}

// Глобальний обробник кліку для копіювання
document.addEventListener('click', async (e) => {
  const target = e.target;
  // Запобігаємо спливанню, якщо це кнопка дзвінка
  if (target.classList.contains('ai-call-btn')) {
    e.stopPropagation();
    return;
  }
  
  const isHighlight = target.matches('.ai-ip-highlight, .ai-phone-highlight, .ai-barcode-highlight, .ai-text-highlight');

  if (isHighlight) {
    const text = target.innerText.trim();
    try {
      await navigator.clipboard.writeText(text);
      target.classList.add('copied');
      setTimeout(() => target.classList.remove('copied'), 2000);
    } catch (err) {
      console.error('Помилка копіювання:', err);
    }
  }
});
