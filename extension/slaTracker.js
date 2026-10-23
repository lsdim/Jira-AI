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
    enableSlaTracking: true,
    slaThresholdMinutes: 30,
    slaSnoozeDuration: 10,
    enableSlaHighlighting: true,
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

  // Завантаження налаштувань
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get({
        enableSlaTracking: true,
        slaThresholdMinutes: 30,
        slaSnoozeDuration: 10,
        enableSlaHighlighting: true,
        snoozedTickets: {}
      }, (items) => {
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
      const url = `/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,status,priority,assignee,${SLA_CONFIG.slaFieldId}`;
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

  // Перевірка та обробка заявок
  async function checkSla() {
    console.log('[Jira AI Helper] === Запуск перевірки SLA ===');
    await loadSettings();
    if (!cachedSettings.enableSlaTracking) {
      console.log('[Jira AI Helper] Відстеження SLA вимкнено.');
      removeNotifications();
      clearHighlighting();
      return;
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

      // Розрахунок залишку часу
      let remainingMs = 0;
      if (ongoing.breachTime && ongoing.breachTime.epochMillis) {
        remainingMs = ongoing.breachTime.epochMillis - now;
      } else if (ongoing.remainingTime && typeof ongoing.remainingTime.millis === 'number') {
        remainingMs = ongoing.remainingTime.millis;
      } else if (typeof ongoing.remainingTime === 'string') {
        const timeStr = ongoing.remainingTime;
        if (timeStr.includes(':')) {
          const parts = timeStr.split(':').map(Number);
          remainingMs = (parts[0] * 60 + parts[1]) * 60 * 1000;
        } else {
          const hMatch = timeStr.match(/(\d+)\s*h/);
          const mMatch = timeStr.match(/(\d+)\s*m/);
          const h = hMatch ? parseInt(hMatch[1], 10) : 0;
          const m = mMatch ? parseInt(mMatch[1], 10) : 0;
          remainingMs = (h * 60 + m) * 60 * 1000;
        }
      }

      const remainingMinutes = Math.round(remainingMs / 60000);
      const isBreached = ongoing.breached || ongoing.failed || remainingMs <= 0;
      const isUrgent = remainingMs <= thresholdMs;

      console.log(`[Jira AI Helper] Моя заявка ${issue.key}: залишок SLA ${remainingMinutes} хв (поріг ${thresholdMinutes} хв).`);

      if (isBreached || isUrgent) {
        const remMin = Math.max(0, remainingMinutes);
        criticalList.push({
          key: issue.key,
          summary: issue.fields.summary || '',
          status: issue.fields.status?.name || '',
          priority: issue.fields.priority?.name || '',
          priorityIcon: issue.fields.priority?.iconUrl || '',
          remainingMinutes: remMin,
          isBreached,
          friendly: isBreached ? 'Прострочено' : (ongoing.remainingTimeHumanReadable || ongoing.remainingTime?.friendly || formatMinutes(remMin)),
          friendlyBreach: isBreached ? 'Прострочено' : ongoing.breachTime?.friendly
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
  }

  // Очищення підсвітки
  function clearHighlighting() {
    document.querySelectorAll('.jira-ai-sla-row-warning, .jira-ai-sla-row-critical').forEach(el => {
      el.classList.remove('jira-ai-sla-row-warning', 'jira-ai-sla-row-critical');
    });
    document.querySelectorAll('.jira-ai-sla-inline-badge, #jira-ai-sla-issue-banner').forEach(el => {
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
        /*const keyContainer = row.querySelector(`[data-cell-name="${issueKey}_issuekey"], a.issue-link[data-issue-key="${issueKey}"]`) || row.querySelector('a.issue-link');
        if (keyContainer && !row.querySelector('.jira-ai-sla-inline-badge')) {
          const badge = document.createElement('span');
          badge.className = `jira-ai-sla-inline-badge ${className}`;
          badge.title = `SLA: ${item.friendly}`;
          badge.textContent = `⏱️ ${item.friendly}`;
          keyContainer.parentNode.insertBefore(badge, keyContainer.nextSibling);
        }*/
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

    // 2. Підсвітка банером на самій сторінці заявки (/browse/SD-...)
    const currentPath = window.location.pathname;
    const currentKeyMatch = currentPath.match(/\/browse\/([A-Z0-9]+-\d+)/i);
    if (currentKeyMatch && currentKeyMatch[1]) {
      const currentKey = currentKeyMatch[1];
      if (criticalMap.has(currentKey)) {
        const item = criticalMap.get(currentKey);
        renderIssueTopBanner(item);
      } else {
        const existingBanner = document.getElementById('jira-ai-sla-issue-banner');
        if (existingBanner) existingBanner.remove();
      }
    }
  }

  // Банер угорі сторінки поточної заявки
  function renderIssueTopBanner(item) {
    if (document.getElementById('jira-ai-sla-issue-banner')) return;

    const banner = document.createElement('div');
    banner.id = 'jira-ai-sla-issue-banner';
    const isCrit = item.isBreached || item.remainingMinutes <= 10;
    banner.className = `jira-ai-sla-banner ${isCrit ? 'critical' : 'warning'}`;
    
    banner.innerHTML = `
      <div class="jira-ai-sla-banner-content">
        <span class="jira-ai-sla-banner-icon">${isCrit ? '🔥' : '⚠️'}</span>
        <span class="jira-ai-sla-banner-text">
          <strong>Увага SLA:</strong> До завершення терміну обслуговування цієї заявки <strong>${item.friendly}</strong>!
        </span>
      </div>
    `;

    const targetHeader = document.querySelector(SLA_CONFIG.issueHeaderSelector) || document.getElementById('stalker');
    if (targetHeader) {
      targetHeader.parentNode.insertBefore(banner, targetHeader);
    } else {
      const mainContent = document.getElementById('content');
      if (mainContent) mainContent.prepend(banner);
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
          <button class="aui-button aui-button-compact jira-ai-sla-snooze-btn" title="Не показувати на всіх вкладках ${cachedSettings.slaSnoozeDuration || 10} хв">
            ⏰ Відкласти (${cachedSettings.slaSnoozeDuration || 10} хв)
          </button>
        </div>
      `;

      // 1. Подія "Відкласти" (Snooze): зберігається глобально у chrome.storage.local
      const snoozeBtn = card.querySelector('.jira-ai-sla-snooze-btn');
      snoozeBtn.onclick = async (e) => {
        e.preventDefault();
        const snoozeDurationMs = (Number(cachedSettings.slaSnoozeDuration) || 10) * 60 * 1000;
        cachedSettings.snoozedTickets = cachedSettings.snoozedTickets || {};
        cachedSettings.snoozedTickets[item.key] = Date.now() + snoozeDurationMs;
        await chrome.storage.local.set({ snoozedTickets: cachedSettings.snoozedTickets });
        console.log(`[Jira AI Helper] Відкладено ${item.key} на ${cachedSettings.slaSnoozeDuration || 10} хв.`);
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
        ['enableSlaTracking', 'slaThresholdMinutes', 'slaSnoozeDuration', 'enableSlaHighlighting', 'snoozedTickets'].forEach(key => {
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
  }

  // Старт після завантаження DOM
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initSlaTracker);
  } else {
    initSlaTracker();
  }
})();
