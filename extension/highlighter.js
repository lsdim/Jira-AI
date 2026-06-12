// extension/highlighter.js

const IP_REGEX = /(?<![a-zA-Z0-9])\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g;
// Регулярка для телефонів (UA: 050..., 380..., +380..., 044...)
const PHONE_REGEX = /(?<![a-zA-Z0-9])(?:\+?38\s?)?0[3-9]\d[\s\-]?\d{3}[\s\-]?\d{2}[\s\-]?\d{2}\b/g;
// Регулярка для штрихкодів (13 цифр, R+12 цифр або міжнародний XX123456789YY)
const BARCODE_REGEX = /(?<![a-zA-Z0-9])(?:\d{13}|R\d{12}|[A-Z]{2}\d{9}[A-Z]{2})(?![a-zA-Z0-9])/g;

// Універсальна функція підсвітки
function processHighlights() {
  chrome.storage.local.get({ 
    enableIPHighlighting: true, 
    enablePhoneHighlighting: true,
    enableBarcodeHighlighting: true 
  }, (items) => {
    if (!items.enableIPHighlighting && !items.enablePhoneHighlighting && !items.enableBarcodeHighlighting) return;

    const selectors = [
      '#description-val', 
      '#customfield_10616-val', 
      '#customfield_10808-val',
      '#customfield_10833-val', // Поле ШК
      '#ad-info-content'
    ];
    
    selectors.forEach(sel => {
      const el = document.querySelector(sel);
      if (!el) return;

      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, null, false);
      let node;
      const nodesToReplace = [];

      while (node = walker.nextNode()) {
        if (node.parentNode.closest('.ai-ip-highlight, .ai-phone-highlight, .ai-barcode-highlight')) continue;

        const text = node.nodeValue;
        IP_REGEX.lastIndex = 0;
        PHONE_REGEX.lastIndex = 0;
        BARCODE_REGEX.lastIndex = 0;

        const hasIP = items.enableIPHighlighting && IP_REGEX.test(text);
        const hasPhone = items.enablePhoneHighlighting && PHONE_REGEX.test(text);
        const hasBarcode = items.enableBarcodeHighlighting && BARCODE_REGEX.test(text);
        
        if (hasIP || hasPhone || hasBarcode) {
          nodesToReplace.push(node);
        }
      }

      nodesToReplace.forEach(textNode => {
        const span = document.createElement('span');
        let newHtml = textNode.nodeValue;

        if (items.enableIPHighlighting) {
          IP_REGEX.lastIndex = 0;
          newHtml = newHtml.replace(IP_REGEX, match => 
            `<span class="ai-ip-highlight" title="Копіювати IP">${match}</span>`
          );
        }
        
        if (items.enablePhoneHighlighting) {
          PHONE_REGEX.lastIndex = 0;
          newHtml = newHtml.replace(PHONE_REGEX, match => 
            `<span class="ai-phone-highlight" title="Копіювати телефон">${match}</span>`
          );
        }

        if (items.enableBarcodeHighlighting) {
          BARCODE_REGEX.lastIndex = 0;
          newHtml = newHtml.replace(BARCODE_REGEX, match => 
            `<span class="ai-barcode-highlight" title="Копіювати ШК">${match}</span>`
          );
        }

        span.innerHTML = newHtml;
        textNode.parentNode.replaceChild(span, textNode);
      });
    });
  });
}

// Глобальний обробник кліку для копіювання
document.addEventListener('click', async (e) => {
  const target = e.target;
  const isIP = target.classList.contains('ai-ip-highlight');
  const isPhone = target.classList.contains('ai-phone-highlight');
  const isBarcode = target.classList.contains('ai-barcode-highlight');

  if (isIP || isPhone || isBarcode) {
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