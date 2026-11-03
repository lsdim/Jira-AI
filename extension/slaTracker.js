// extension/slaTracker.js
// Відстеження заявок з SLA, візуальна підсвітка та виринаючі сповіщення

(function () {
  'use strict';

  console.log('[Jira AI Helper] slaTracker.js завантажено на сторінці:', window.location.href);

  const SLA_CONFIG = {
    // Кастомне поле SLA за замовчуванням
    slaFieldId: 'customfield_10641',
    // Селектор контейнера для спливаючих сповіщень
    containerId: 'jira-ai-sla-container',
    // Селектори рядків таблиць Jira
    tableRowSelector: 'tr[data-issue-key], tr[data-issuekey], #issuetable tr, table.aui tr[data-issuekey], tr.issuerow, tr[data-testid^="issue-table--row-"], .ghx-issue',
    issueHeaderSelector: '#jira-issue-header, #header-issue, .issue-header'
  };

  let pollingTimer = null;
  let activeIssues = []; // Масив актуальних критичних заявок
  let cachedSettings = {
    enableSlaTracking: false,
    slaThresholdMinutes: 30,
    slaSnoozeDuration: 10,
    enableSlaHighlighting: true,
    enableSlaNotifications: true,
    enableSlaTopBadge: true,
    snoozedTickets: {} // { issueKey: timestampUntil }
  };

  // Поточні закриті картки для поточної відкритої сторінки (сесійні, не блокують сповіщення назавжди)
  const sessionClosedTickets = new Set();

  // Форматування хвилин у зручний рядок
  function formatMinutes(minutes) {
    if (minutes <= 0) return 'Прострочено!';
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    if (h > 0) {
      return `${h}г ${m}хв`;
    }
    return `${m} хв`;
  }

  // Безпечне екранування тексту для вставки в HTML
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Очищення застарілих відкладених заявок (Snooze Cleanup)
  function cleanExpiredSnoozes(snoozed) {
    if (!snoozed || typeof snoozed !== 'object') return {};
    const now = Date.now();
    let hasExpired = false;
    const cleaned = {};
    for (const [key, timestamp] of Object.entries(snoozed)) {
      if (timestamp && timestamp > now) {
        cleaned[key] = timestamp;
      } else {
        hasExpired = true;
      }
    }
    if (hasExpired) {
      chrome.storage.local.set({ snoozedTickets: cleaned });
    }
    return cleaned;
  }

  // Уніфікований розрахунок залишку часу SLA у мілісекундах та хвилинах
  function parseSlaCycle(ongoing, now) {
    if (!ongoing) return null;

    let remainingMs = 0;
    if (ongoing.breachTime && ongoing.breachTime.epochMillis) {
      remainingMs = ongoing.breachTime.epochMillis - now;
    } else if (ongoing.remainingTime && typeof ongoing.remainingTime.millis === 'number') {
      remainingMs = ongoing.remainingTime.millis;
    } else if (typeof ongoing.remainingTime === 'string') {
      const timeStr = ongoing.remainingTime.trim();
      const isNegative = timeStr.startsWith('-');
      const cleanStr = isNegative ? timeStr.slice(1).trim() : timeStr;

      if (cleanStr.includes(':')) {
        const parts = cleanStr.split(':').map(Number);
        const ms = ((parts[0] || 0) * 60 + (parts[1] || 0)) * 60 * 1000;
        remainingMs = isNegative ? -ms : ms;
      } else {
        const wMatch = cleanStr.match(/(\d+)\s*w/i);
        const dMatch = cleanStr.match(/(\d+)\s*d/i);
        const hMatch = cleanStr.match(/(\d+)\s*h/i);
        const mMatch = cleanStr.match(/(\d+)\s*m/i);

        const w = wMatch ? parseInt(wMatch[1], 10) : 0;
        const d = dMatch ? parseInt(dMatch[1], 10) : 0;
        const h = hMatch ? parseInt(hMatch[1], 10) : 0;
        const m = mMatch ? parseInt(mMatch[1], 10) : 0;

        const totalMinutes = w * 7 * 24 * 60 + d * 24 * 60 + h * 60 + m;
        const ms = totalMinutes * 60 * 1000;
        remainingMs = isNegative ? -ms : ms;
      }
    }

    const remainingMinutes = Math.round(remainingMs / 60000);
    const isBreached = Boolean(ongoing.breached || ongoing.failed || remainingMs <= 0);

    return {
      remainingMs,
      remainingMinutes,
      isBreached,
      friendly: isBreached ? 'Прострочено' : (ongoing.remainingTimeHumanReadable || ongoing.remainingTime?.friendly || formatMinutes(Math.max(0, remainingMinutes))),
      friendlyBreach: isBreached ? 'Прострочено' : (ongoing.breachTime?.friendly || '')
    };
  }

  // Завантаження налаштувань
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get({
        enableSlaTracking: false,
        slaThresholdMinutes: 30,
        enableSlaHighlighting: true,
        enableSlaNotifications: true,
        enableSlaTopBadge: true,
        snoozedTickets: {}
      }, (items) => {
        items.snoozedTickets = cleanExpiredSnoozes(items.snoozedTickets);
        cachedSettings = items;
        console.log('[Jira AI Helper] Поточні налаштування SLA:', cachedSettings);
        resolve(items);
      });
    });
  }

  // Отримання ВИКЛЮЧНО моїх незакритих заявок через Jira REST API
  async function fetchAssignedIssues() {
    try {
      const jql = 'assignee = currentUser() AND resolution is EMPTY ORDER BY updated DESC';
      const url = `/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,status,priority,assignee,reporter,${SLA_CONFIG.slaFieldId}`;
      console.log('[Jira AI Helper] Отримання МОЇХ заявок:', jql);
      
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        const myIssues = data.issues || [];
        console.log(`[Jira AI Helper] Отримано ${myIssues.length} моїх заявок:`, myIssues.map(i => i.key));
        return myIssues;
      } else {
        console.warn('[Jira AI Helper] Помилка API:', response.status);
      }
    } catch (e) {
      console.warn('[Jira AI Helper] Помилка запиту через JQL:', e);
    }
    return [];
  }

  // Пряма перевірка SLA для поточної відкритої сторінки заявки (/browse/ або /queues/ тощо)
  async function checkCurrentIssueSla() {
    const currentKeyMatch = window.location.href.match(/\/([A-Z0-9]+-\d+)(?:\/|$|\?|\#)/i) || window.location.href.match(/([A-Z0-9]+-\d+)/i);
    if (!currentKeyMatch || !currentKeyMatch[1]) {
      const existingBanner = document.getElementById('jira-ai-sla-issue-banner');
      if (existingBanner) existingBanner.remove();
      return;
    }

    const currentKey = currentKeyMatch[1];
    try {
      const response = await fetch(`/rest/api/2/issue/${currentKey}?fields=summary,status,priority,reporter,${SLA_CONFIG.slaFieldId}`);
      if (!response.ok) return;
      const issue = await response.json();

      const statusName = (issue.fields?.status?.name || '').toLowerCase();
      if (statusName.includes('закрит') || statusName.includes('вирішен') || statusName.includes('closed') || statusName.includes('resolved')) {
        const existingBanner = document.getElementById('jira-ai-sla-issue-banner');
        if (existingBanner) existingBanner.remove();
        return;
      }

      const slaField = issue.fields?.[SLA_CONFIG.slaFieldId];
      if (!slaField) {
        const existingBanner = document.getElementById('jira-ai-sla-issue-banner');
        if (existingBanner) existingBanner.remove();
        return;
      }

      let ongoing = slaField.ongoingCycle || slaField.goalView;
      if (!ongoing || ongoing.paused === true) {
        const existingBanner = document.getElementById('jira-ai-sla-issue-banner');
        if (existingBanner) existingBanner.remove();
        return;
      }

      const now = Date.now();
      const thresholdMinutes = Number(cachedSettings.slaThresholdMinutes) || 30;
      const thresholdMs = thresholdMinutes * 60 * 1000;

      const slaInfo = parseSlaCycle(ongoing, now);
      if (!slaInfo) {
        const existingBanner = document.getElementById('jira-ai-sla-issue-banner');
        if (existingBanner) existingBanner.remove();
        return;
      }

      const isUrgent = slaInfo.remainingMs <= thresholdMs;

      if (slaInfo.isBreached || isUrgent) {
        const remMin = Math.max(0, slaInfo.remainingMinutes);
        const reporterName = issue.fields?.reporter?.displayName || issue.fields?.reporter?.name || '';
        const item = {
          key: issue.key,
          summary: issue.fields.summary || '',
          reporter: reporterName,
          remainingMinutes: remMin,
          isBreached: slaInfo.isBreached,
          friendly: slaInfo.friendly,
          friendlyBreach: slaInfo.friendlyBreach
        };
        renderIssueTopBanner(item);
      } else {
        const existingBanner = document.getElementById('jira-ai-sla-issue-banner');
        if (existingBanner) existingBanner.remove();
      }
    } catch (e) {
      console.warn('[Jira AI Helper] Помилка прямої перевірки SLA поточної заявки:', e);
    }
  }

  // Перевірка та обробка заявок
  async function checkSla() {
    console.log('[Jira AI Helper] === Запуск перевірки SLA ===');
    await loadSettings();
    if (!cachedSettings.enableSlaTracking) {
      console.log('[Jira AI Helper] Відстеження SLA вимкнено.');
      removeNotifications();
      clearHighlighting();
      const existingBanner = document.getElementById('jira-ai-sla-issue-banner');
      if (existingBanner) existingBanner.remove();
      const dropdown = document.getElementById('jira-ai-sla-dropdown');
      if (dropdown) dropdown.remove();
      return;
    }

    // Перевіряємо також поточну сторінку заявки напряму через API
    if (cachedSettings.enableSlaHighlighting) {
      await checkCurrentIssueSla();
    } else {
      const existingBanner = document.getElementById('jira-ai-sla-issue-banner');
      if (existingBanner) existingBanner.remove();
    }

    const issues = await fetchAssignedIssues();
    const now = Date.now();
    const thresholdMinutes = Number(cachedSettings.slaThresholdMinutes) || 30;
    const thresholdMs = thresholdMinutes * 60 * 1000;

    const criticalList = [];

    issues.forEach(issue => {
      const statusName = (issue.fields?.status?.name || '').toLowerCase();
      
      // Ігноруємо закриті/вирішені
      if (statusName.includes('закрит') || statusName.includes('вирішен') || statusName.includes('closed') || statusName.includes('resolved')) {
        return;
      }

      const slaField = issue.fields?.[SLA_CONFIG.slaFieldId];
      if (!slaField) return;

      let ongoing = slaField.ongoingCycle || slaField.goalView;
      if (!ongoing) return;

      // Якщо відлік призупинено (наприклад, очікує користувача)
      if (ongoing.paused === true) {
        console.log(`[Jira AI Helper] ${issue.key}: SLA на паузі.`);
        return;
      }

      // Розрахунок залишку часу через єдину функцію
      const slaInfo = parseSlaCycle(ongoing, now);
      if (!slaInfo) return;

      const isUrgent = slaInfo.remainingMs <= thresholdMs;

      console.log(`[Jira AI Helper] Моя заявка ${issue.key}: залишок SLA ${slaInfo.remainingMinutes} хв (поріг ${thresholdMinutes} хв).`);

      if (slaInfo.isBreached || isUrgent) {
        const remMin = Math.max(0, slaInfo.remainingMinutes);
        const reporterName = issue.fields?.reporter?.displayName || issue.fields?.reporter?.name || '';
        criticalList.push({
          key: issue.key,
          summary: issue.fields.summary || '',
          reporter: reporterName,
          status: issue.fields.status?.name || '',
          priority: issue.fields.priority?.name || '',
          priorityIcon: issue.fields.priority?.iconUrl || '',
          remainingMinutes: remMin,
          isBreached: slaInfo.isBreached,
          friendly: slaInfo.friendly,
          friendlyBreach: slaInfo.friendlyBreach
        });
      }
    });

    activeIssues = criticalList;

    // 1. Оновлюємо підсвітку в DOM ТІЛЬКИ для моїх критичних заявок
    if (cachedSettings.enableSlaHighlighting) {
      highlightIssuesInDom(criticalList);
    } else {
      clearHighlighting();
    }

    // 2. Відображаємо сповіщення
    renderNotifications(criticalList);

    // 3. Оновлюємо бейдж SLA у верхньому меню Jira
    updateSlaTopMenuBadge(criticalList);
  }

  // Оновлення бейджа SLA у верхньому меню Jira та створення випадаючого списку
  function updateSlaTopMenuBadge(criticalList) {
    const count = criticalList ? criticalList.length : 0;
    
    let badgeWrapper = document.getElementById('jira-ai-sla-top-badge-wrapper');
    let badge = document.getElementById('jira-ai-sla-top-badge');

    if (!cachedSettings.enableSlaTopBadge || count === 0) {
      if (badgeWrapper) {
        badgeWrapper.style.display = 'none';
      } else if (badge) {
        badge.style.display = 'none';
      }
      const existingDropdown = document.getElementById('jira-ai-sla-dropdown');
      if (existingDropdown) existingDropdown.remove();
      return;
    }

    const hasCritical = criticalList.some(item => item.isBreached || item.remainingMinutes <= 10);
    
    if (!badgeWrapper) {
      badgeWrapper = document.createElement('li');
      badgeWrapper.id = 'jira-ai-sla-top-badge-wrapper';
      badgeWrapper.className = 'jira-ai-sla-top-badge-wrapper';

      badge = document.createElement('div');
      badge.id = 'jira-ai-sla-top-badge';
      badge.title = 'Натисніть для перегляду списку термінових SLA заявок';

      badgeWrapper.appendChild(badge);

      badge.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleSlaDropdown();
      };

      // Вставляємо відразу після кнопки Create (li#create-menu) у верхньому меню
      const createMenu = document.getElementById('create-menu') || document.querySelector('#create-menu');

      if (createMenu && createMenu.parentNode) {
        createMenu.parentNode.insertBefore(badgeWrapper, createMenu.nextSibling);
      } else {
        // Fallback: якщо #create-menu не знайдено, вставляємо у головне меню / шапку
        const targetContainer = document.querySelector('#header .aui-header-primary') || 
                                document.querySelector('.aui-header-primary') || 
                                document.querySelector('#header .aui-header-inner') || 
                                document.querySelector('#header');
        
        if (targetContainer) {
          targetContainer.appendChild(badgeWrapper);
        } else {
          document.body.appendChild(badgeWrapper);
          badgeWrapper.style.position = 'fixed';
          badgeWrapper.style.top = '10px';
          badgeWrapper.style.right = '10px';
          badgeWrapper.style.zIndex = '10001';
        }
      }

      // Закриття дропдауну при кліку поза ним
      document.addEventListener('click', (event) => {
        const dropdown = document.getElementById('jira-ai-sla-dropdown');
        if (dropdown && !dropdown.contains(event.target) && !badge.contains(event.target)) {
          dropdown.remove();
        }
      });
    }

    const icon = hasCritical ? '🔥' : '⏱️';
    badge.className = `jira-ai-sla-top-badge ${hasCritical ? 'critical' : 'warning'}`;
    badge.innerHTML = `<span>${icon}</span><span>SLA: ${count}</span>`;
    badgeWrapper.style.display = 'inline-flex';

    // Якщо випадаючий список відкритий, оновлюємо його контент
    const openDropdown = document.getElementById('jira-ai-sla-dropdown');
    if (openDropdown) {
      renderDropdownContent(openDropdown, activeIssues);
    }
  }

  // Перемикання випадаючого списку SLA заявок
  function toggleSlaDropdown() {
    let dropdown = document.getElementById('jira-ai-sla-dropdown');
    if (dropdown) {
      dropdown.remove();
      return;
    }

    const badgeWrapper = document.getElementById('jira-ai-sla-top-badge-wrapper');
    if (!badgeWrapper) return;

    dropdown = document.createElement('div');
    dropdown.id = 'jira-ai-sla-dropdown';
    dropdown.className = 'jira-ai-sla-dropdown';

    // Завжди використовуємо актуальний список activeIssues замість застарілого з замикання
    renderDropdownContent(dropdown, activeIssues);
    badgeWrapper.appendChild(dropdown);

    // Запускаємо фонову перевірку для миттєвого оновлення найсвіжіших даних
    checkSla();
  }

  // Рендеринг вмісту випадаючого вікна
  function renderDropdownContent(dropdown, criticalList) {
    const count = criticalList ? criticalList.length : 0;
    let itemsHtml = '';

    if (count === 0) {
      itemsHtml = '<div class="jira-ai-sla-dropdown-empty">Немає термінових SLA заявок 🎉</div>';
    } else {
      itemsHtml = criticalList.map(item => {
        const isCrit = item.isBreached || item.remainingMinutes <= 10;
        const badgeClass = isCrit ? 'critical' : 'warning';
        const reporterText = item.reporter ? escapeHtml(item.reporter) : '';
        return `
          <li class="jira-ai-sla-dropdown-item" onclick="window.open('/browse/${item.key}', '_blank')">
            <div class="jira-ai-sla-dropdown-item-top">
              <div class="jira-ai-sla-dropdown-key-group">
                <span class="jira-ai-sla-dropdown-item-key">${item.key}</span>
                ${reporterText ? `<span class="jira-ai-sla-dropdown-reporter" title="Заявник: ${reporterText}">${reporterText}</span>` : ''}
              </div>
              <span class="jira-ai-sla-time-badge ${badgeClass}">${item.friendly}</span>
            </div>
            <div class="jira-ai-sla-dropdown-item-title" title="${escapeHtml(item.summary)}">
              ${escapeHtml(item.summary) || 'Без опису'}
            </div>
          </li>
        `;
      }).join('');
    }

    dropdown.innerHTML = `
      <div class="jira-ai-sla-dropdown-header">
        <span>⏱️ Заявки під SLA (${count})</span>
        <button type="button" style="background:none; border:none; cursor:pointer; font-size:16px; color:#6b778c;" id="jira-ai-sla-dropdown-close" title="Закрити">×</button>
      </div>
      <ul class="jira-ai-sla-dropdown-list">
        ${itemsHtml}
      </ul>
    `;

    const closeBtn = dropdown.querySelector('#jira-ai-sla-dropdown-close');
    if (closeBtn) {
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        dropdown.remove();
      };
    }
  }

  // Очищення підсвітки
  function clearHighlighting() {
    document.querySelectorAll('.jira-ai-sla-row-warning, .jira-ai-sla-row-critical').forEach(el => {
      el.classList.remove('jira-ai-sla-row-warning', 'jira-ai-sla-row-critical');
    });
    document.querySelectorAll('.jira-ai-sla-inline-badge').forEach(el => {
      el.remove();
    });
  }

  // Підсвітка заявок у чергах, таблицях та на сторінці заявки
  function highlightIssuesInDom(criticalList) {
    // Спочатку обов'язково очищуємо стару підсвітку
    clearHighlighting();

    if (!criticalList || criticalList.length === 0) {
      return;
    }

    const criticalMap = new Map(criticalList.map(item => [item.key, item]));

    // 1. Підсвітка у таблицях черг та пошуку
    const rows = document.querySelectorAll(SLA_CONFIG.tableRowSelector);
    let highlightedCount = 0;

    rows.forEach(row => {
      let issueKey = row.getAttribute('data-issue-key') || row.getAttribute('data-issuekey');
      if (!issueKey) {
        const testId = row.getAttribute('data-testid') || '';
        const m = testId.match(/issue-table--row-([A-Z0-9]+-\d+)/i);
        if (m) issueKey = m[1];
      }
      if (!issueKey) {
        const keyLink = row.querySelector('a.issue-link[data-issue-key], a.issue-link, td.nav.issuekey a');
        if (keyLink) {
          issueKey = keyLink.getAttribute('data-issue-key') || keyLink.textContent.trim();
        }
      }

      // ТІЛЬКИ якщо цей ключ є серед моїх критичних заявок
      if (issueKey && criticalMap.has(issueKey)) {
        highlightedCount++;
        const item = criticalMap.get(issueKey);
        const className = item.isBreached || item.remainingMinutes <= 10 ? 'jira-ai-sla-row-critical' : 'jira-ai-sla-row-warning';
        if (!row.classList.contains(className)) {
          row.classList.add(className);
        }

        // Додаємо бейдж поруч із номером заявки
        const keyContainer = row.querySelector(`[data-cell-name="${issueKey}_issuekey"], a.issue-link[data-issue-key="${issueKey}"]`) || row.querySelector('a.issue-link');
        if (keyContainer && !row.querySelector('.jira-ai-sla-inline-badge')) {
          const badge = document.createElement('span');
          badge.className = `jira-ai-sla-inline-badge ${className}`;
          badge.title = `SLA: ${item.friendlyBreach}`;
          badge.textContent = `${item.friendly}`;
          keyContainer.textContent = ''; 
          keyContainer.appendChild(badge);
          // ВИДАЛЕННЯ КАРТИНКИ: шукаємо img поруч у сусідньому лінку
          const issueImg = row.querySelector('div[data-cell-name$="_issuetype"] img, a.issue-link img');
          if (issueImg) {
            issueImg.remove();
          }		  
        }
      }
    });

    if (highlightedCount > 0) {
      console.log(`[Jira AI Helper] Підсвічено рядків у черзі (тільки мої заявки): ${highlightedCount}`);
    }

    // 2. Підсвітка банером на самій сторінці заявки (/browse/ або /queues/ тощо)
    const currentKeyMatch = window.location.href.match(/\/([A-Z0-9]+-\d+)(?:\/|$|\?|\#)/i) || window.location.href.match(/([A-Z0-9]+-\d+)/i);
    if (currentKeyMatch && currentKeyMatch[1]) {
      const currentKey = currentKeyMatch[1];
      if (criticalMap.has(currentKey)) {
        const item = criticalMap.get(currentKey);
        renderIssueTopBanner(item);
      }
    }
  }

  // Банер угорі сторінки поточної заявки
  function renderIssueTopBanner(item) {
    let banner = document.getElementById('jira-ai-sla-issue-banner');
    const isCrit = item.isBreached || item.remainingMinutes <= 10;
    
    if (banner) {
      banner.className = `jira-ai-sla-banner ${isCrit ? 'critical' : 'warning'}`;
      banner.innerHTML = `
        <div class="jira-ai-sla-banner-content">
          <span class="jira-ai-sla-banner-icon">${isCrit ? '🔥' : '⚠️'}</span>
          <span class="jira-ai-sla-banner-text">
            <strong>Увага SLA:</strong> До завершення терміну обслуговування цієї заявки <strong>${item.friendly}</strong>!
          </span>
        </div>
      `;
      // Перевіряємо, чи банер все ще прикріплений до DOM (на випадок якщо Jira його стерла)
      if (!document.body.contains(banner)) {
        const targetHeader = document.querySelector(SLA_CONFIG.issueHeaderSelector) || document.getElementById('stalker') || document.querySelector('.issue-header');
        if (targetHeader && targetHeader.parentNode) {
          targetHeader.parentNode.insertBefore(banner, targetHeader);
        } else {
          const mainContent = document.getElementById('content') || document.querySelector('#jira');
          if (mainContent) mainContent.prepend(banner);
          else document.body.prepend(banner);
        }
      }
      return;
    }

    banner = document.createElement('div');
    banner.id = 'jira-ai-sla-issue-banner';
    banner.className = `jira-ai-sla-banner ${isCrit ? 'critical' : 'warning'}`;
    
    banner.innerHTML = `
      <div class="jira-ai-sla-banner-content">
        <span class="jira-ai-sla-banner-icon">${isCrit ? '🔥' : '⚠️'}</span>
        <span class="jira-ai-sla-banner-text">
          <strong>Увага SLA:</strong> До завершення терміну обслуговування цієї заявки <strong>${item.friendly}</strong>!
        </span>
      </div>
    `;

    const targetHeader = document.querySelector(SLA_CONFIG.issueHeaderSelector) || document.getElementById('stalker') || document.querySelector('.issue-header');
    if (targetHeader && targetHeader.parentNode) {
      targetHeader.parentNode.insertBefore(banner, targetHeader);
    } else {
      const mainContent = document.getElementById('content') || document.querySelector('#jira');
      if (mainContent) {
        mainContent.prepend(banner);
      } else {
        document.body.prepend(banner);
      }
    }
  }

  // Отримання або створення контейнера для тостів
  function getOrCreateContainer() {
    let container = document.getElementById(SLA_CONFIG.containerId);
    if (!container) {
      container = document.createElement('div');
      container.id = SLA_CONFIG.containerId;
      document.body.appendChild(container);
    }
    return container;
  }

  // Видалення контейнера
  function removeNotifications() {
    const container = document.getElementById(SLA_CONFIG.containerId);
    if (container) container.remove();
  }

  // Відображення плаваючих карток
  function renderNotifications(criticalList) {
    if (!cachedSettings.enableSlaNotifications) {
      removeNotifications();
      return;
    }

    const container = getOrCreateContainer();
    const now = Date.now();
    const snoozed = cachedSettings.snoozedTickets || {};

    // Фільтруємо ті, які відкладені користувачем на певний час,
    // або які користувач закрив хрестиком на цій сторінці (поки не оновить сторінку)
    const visibleIssues = criticalList.filter(item => {
      // 1. Якщо відкладено на X хвилин
      if (snoozed[item.key] && snoozed[item.key] > now) {
        return false;
      }
      // 2. Якщо користувач просто закрив хрестиком на цій сторінці
      if (sessionClosedTickets.has(item.key)) {
        return false;
      }
      return true;
    });

    console.log(`[Jira AI Helper] Активних карток сповіщень: ${visibleIssues.length}`);

    if (visibleIssues.length === 0) {
      container.innerHTML = '';
      return;
    }

    // Створюємо або оновлюємо картки
    container.innerHTML = '';
    visibleIssues.forEach(item => {
      const card = document.createElement('div');
      const isCrit = item.isBreached || item.remainingMinutes <= 10;
      card.className = `jira-ai-sla-card ${isCrit ? 'critical' : 'warning'}`;
      card.setAttribute('data-issue-key', item.key);

      card.innerHTML = `
        <div class="jira-ai-sla-card-header">
          <div class="jira-ai-sla-card-title">
            <span class="jira-ai-sla-icon">${isCrit ? '🔥' : '⚠️'}</span>
            <a href="/browse/${item.key}" class="jira-ai-sla-link" target="_blank"><strong>${item.key}</strong></a>
            <span class="jira-ai-sla-time-badge ${isCrit ? 'critical' : 'warning'}">${item.friendly}</span>
          </div>
          <button class="jira-ai-sla-close-btn" title="Закрити (до наступного переходу або оновлення сторінки)">×</button>
        </div>
        <div class="jira-ai-sla-card-body" title="${item.summary}">
          ${item.summary}
        </div>
        <div class="jira-ai-sla-card-actions">
          <a href="/browse/${item.key}" class="aui-button aui-button-compact aui-button-primary jira-ai-sla-open-btn">Перейти</a>
          <div class="jira-ai-sla-snooze-group">
            <select class="jira-ai-sla-snooze-select" title="Час відкладання для цієї заявки">
              <option value="5">5 хв</option>
              <option value="10">10 хв</option>
              <option value="15" selected>15 хв</option>
              <option value="30">30 хв</option>
              <option value="60">1 год</option>
              <option value="120">2 год</option>
            </select>
            <button class="aui-button aui-button-compact jira-ai-sla-snooze-btn" title="Відкласти це сповіщення">
              ⏰ Відкласти
            </button>
          </div>
        </div>
      `;

      // 1. Подія "Відкласти" (Snooze): зберігається глобально у chrome.storage.local
      const snoozeBtn = card.querySelector('.jira-ai-sla-snooze-btn');
      const snoozeSelect = card.querySelector('.jira-ai-sla-snooze-select');
      snoozeBtn.onclick = async (e) => {
        e.preventDefault();
        const minutes = Number(snoozeSelect.value) || 15;
        const snoozeDurationMs = minutes * 60 * 1000;
        cachedSettings.snoozedTickets = cachedSettings.snoozedTickets || {};
        cachedSettings.snoozedTickets[item.key] = Date.now() + snoozeDurationMs;
        await chrome.storage.local.set({ snoozedTickets: cachedSettings.snoozedTickets });
        console.log(`[Jira AI Helper] Відкладено ${item.key} на ${minutes} хв.`);
        card.classList.add('fade-out');
        setTimeout(() => card.remove(), 250);
      };

      // 2. Подія "Закрити" (хрестик): закриває тільки на поточній сторінці (сесійно)
      const closeBtn = card.querySelector('.jira-ai-sla-close-btn');
      closeBtn.onclick = (e) => {
        e.preventDefault();
        sessionClosedTickets.add(item.key);
        console.log(`[Jira AI Helper] ${item.key} закрили хрестиком на цій сторінці.`);
        card.classList.add('fade-out');
        setTimeout(() => card.remove(), 250);
      };

      container.appendChild(card);
    });
  }

  // Ініціалізація періодичного опитування
  function initSlaTracker() {
    console.log('[Jira AI Helper] Ініціалізація SLA трекера...');
    loadSettings().then(() => {
      // Перша перевірка відразу при завантаженні сторінки
      checkSla();
      // Повторюємо кожні 60 секунд
      if (pollingTimer) clearInterval(pollingTimer);
      pollingTimer = setInterval(checkSla, 60 * 1000);
    });

    // Слухаємо зміни в сховищі налаштувань
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        let needRefresh = false;
        ['enableSlaTracking', 'slaThresholdMinutes', 'enableSlaHighlighting', 'enableSlaNotifications', 'enableSlaTopBadge', 'snoozedTickets'].forEach(key => {
          if (changes[key]) {
            cachedSettings[key] = changes[key].newValue;
            needRefresh = true;
          }
        });
        if (needRefresh) {
          checkSla();
        }
      }
    });

    // Спостерігач за появою таблиць у DOM (тільки додавання/видалення вузлів списку)
    let domDebounce = null;
    const domObserver = new MutationObserver((mutations) => {
      // Реагуємо тільки якщо додались нові елементи таблиці/черги
      const hasTableMutations = mutations.some(m => {
        return Array.from(m.addedNodes).some(n => {
          if (n.nodeType !== 1) return false;
          return n.matches?.('tr, tbody, table') || n.querySelector?.('tr[data-issue-key], tr[data-testid^="issue-table--row-"]');
        });
      });

      if (hasTableMutations && activeIssues.length > 0 && cachedSettings.enableSlaHighlighting) {
        clearTimeout(domDebounce);
        domDebounce = setTimeout(() => {
          highlightIssuesInDom(activeIssues);
        }, 500);
      }
    });

    const targetNode = document.querySelector('#content, #main, .issue-table, tbody') || document.body;
    if (targetNode) {
      domObserver.observe(targetNode, { childList: true, subtree: true });
    }

    // Оптимізоване відстеження зміни URL у Jira SPA (перехід між сторінками без повного перезавантаження)
    let lastUrl = location.href;
    const handleUrlChange = () => {
      const currentUrl = location.href;
      if (currentUrl !== lastUrl) {
        lastUrl = currentUrl;
        console.log('[Jira AI Helper] Зміна URL у Jira SPA:', currentUrl);
        setTimeout(checkSla, 600);
      }
    };

    // 1. Слухаємо події навігації історії браузера
    window.addEventListener('popstate', handleUrlChange);
    const wrapHistoryMethod = (type) => {
      const orig = history[type];
      return function () {
        const result = orig.apply(this, arguments);
        window.dispatchEvent(new Event('jira-ai-locationchange'));
        return result;
      };
    };
    history.pushState = wrapHistoryMethod('pushState');
    history.replaceState = wrapHistoryMethod('replaceState');
    window.addEventListener('jira-ai-locationchange', handleUrlChange);

    // 2. Спостерігаємо ТІЛЬКИ за тегом <title>, а не за всім document
    const titleElement = document.querySelector('title');
    if (titleElement) {
      const titleObserver = new MutationObserver(handleUrlChange);
      titleObserver.observe(titleElement, { childList: true, subtree: true, characterData: true });
    }
  }

  // Старт після завантаження DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSlaTracker);
  } else {
    initSlaTracker();
  }
})();
