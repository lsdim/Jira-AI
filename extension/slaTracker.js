// extension/slaTracker.js
// Відстеження заявок з SLA, візуальна підсвітка та виринаючі сповіщення

(function () {
  'use strict';

  const SLA_CONFIG = {
    // Кастомне поле SLA за замовчуванням
    slaFieldId: 'customfield_10641',
    // Селектор контейнера для спливаючих сповіщень
    containerId: 'jira-ai-sla-container',
    // Селектори елементів Jira для підсвітки
    tableRowSelector: '#issuetable tr, table.aui tr[data-issuekey], .ghx-issue, tr.issuerow',
    issueHeaderSelector: '#jira-issue-header, #header-issue'
  };

  let pollingTimer = null;
  let activeIssues = []; // Масив актуальних критичних заявок
  let cachedSettings = {
    enableSlaTracking: true,
    slaThresholdMinutes: 30,
    slaSnoozeDuration: 10,
    enableSlaHighlighting: true,
    snoozedTickets: {}, // { issueKey: timestampUntil }
    dismissedTickets: {} // { issueKey: timestampDismissed }
  };

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
        snoozedTickets: {},
        dismissedTickets: {}
      }, (items) => {
        cachedSettings = items;
        resolve(items);
      });
    });
  }

  // Отримання даних про заявки через Jira REST API
  async function fetchAssignedIssues() {
    try {
      // Шукаємо незакриті заявки призначені на поточного користувача
      const jql = 'assignee = currentUser() AND resolution is EMPTY ORDER BY updated DESC';
      const url = `/rest/api/2/search?jql=${encodeURIComponent(jql)}&maxResults=50&fields=summary,status,priority,${SLA_CONFIG.slaFieldId}`;
      
      const response = await fetch(url);
      if (!response.ok) {
        return [];
      }
      const data = await response.json();
      return data.issues || [];
    } catch (e) {
      console.warn('Jira AI Helper: Помилка отримання заявок для SLA:', e);
      return [];
    }
  }

  // Перевірка та обробка заявок
  async function checkSla() {
    await loadSettings();
    if (!cachedSettings.enableSlaTracking) {
      removeNotifications();
      clearHighlighting();
      return;
    }

    const issues = await fetchAssignedIssues();
    const now = Date.now();
    const thresholdMs = (Number(cachedSettings.slaThresholdMinutes) || 30) * 60 * 1000;
    const criticalList = [];

    issues.forEach(issue => {
      const statusName = (issue.fields?.status?.name || '').toLowerCase();
      // Перевіряємо статуси: "В роботі", "Призначена", "Відкрита", "Очікує виконання"
      // Не враховуємо закриті/вирішені (вже відфільтровано resolution is EMPTY)
      const allowedStatuses = ['в роботі', 'призначена', 'відкрита', 'очікує виконання', 'in progress', 'assigned', 'open'];
      const isAllowedStatus = allowedStatuses.some(st => statusName.includes(st));
      if (!isAllowedStatus) return;

      const slaField = issue.fields?.[SLA_CONFIG.slaFieldId];
      if (!slaField || !slaField.ongoingCycle) return;

      const ongoing = slaField.ongoingCycle;
      // Якщо відлік призупинено - не турбуємо
      if (ongoing.paused === true) return;

      // Визначаємо час до порушення
      let remainingMs = 0;
      if (ongoing.breachTime && ongoing.breachTime.epochMillis) {
        remainingMs = ongoing.breachTime.epochMillis - now;
      } else if (ongoing.remainingTime && typeof ongoing.remainingTime.millis === 'number') {
        remainingMs = ongoing.remainingTime.millis;
      }

      // Якщо час вичерпано або залишок менший за поріг
      const isBreached = ongoing.breached || remainingMs <= 0;
      const isUrgent = remainingMs <= thresholdMs;

      if (isBreached || isUrgent) {
        const remainingMinutes = Math.max(0, Math.round(remainingMs / 60000));
        criticalList.push({
          key: issue.key,
          summary: issue.fields.summary || '',
          status: issue.fields.status?.name || '',
          priority: issue.fields.priority?.name || '',
          priorityIcon: issue.fields.priority?.iconUrl || '',
          remainingMinutes,
          isBreached,
          friendly: isBreached ? 'Прострочено' : (ongoing.remainingTime?.friendly || formatMinutes(remainingMinutes))
        });
      }
    });

    activeIssues = criticalList;

    // Оновлюємо підсвітку в DOM
    if (cachedSettings.enableSlaHighlighting) {
      highlightIssuesInDom(criticalList);
    } else {
      clearHighlighting();
    }

    // Відображаємо сповіщення
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
    if (!criticalList || criticalList.length === 0) {
      clearHighlighting();
      return;
    }

    const criticalMap = new Map(criticalList.map(item => [item.key, item]));

    // 1. Підсвітка у таблицях черг та пошуку
    const rows = document.querySelectorAll(SLA_CONFIG.tableRowSelector);
    rows.forEach(row => {
      let issueKey = row.getAttribute('data-issuekey') || row.getAttribute('data-issue-key');
      if (!issueKey) {
        const keyLink = row.querySelector('a.issue-link[data-issue-key], a.issue-link, td.nav.issuekey a');
        if (keyLink) {
          issueKey = keyLink.getAttribute('data-issue-key') || keyLink.textContent.trim();
        }
      }

      if (issueKey && criticalMap.has(issueKey)) {
        const item = criticalMap.get(issueKey);
        const className = item.isBreached || item.remainingMinutes <= 10 ? 'jira-ai-sla-row-critical' : 'jira-ai-sla-row-warning';
        row.classList.remove('jira-ai-sla-row-warning', 'jira-ai-sla-row-critical');
        row.classList.add(className);

        // Додаємо бейдж поруч із номером заявки, якщо його ще немає
        const keyCell = row.querySelector('.issuekey, [rel="issue-key"], a.issue-link') || row;
        if (keyCell && !keyCell.querySelector('.jira-ai-sla-inline-badge')) {
          const badge = document.createElement('span');
          badge.className = `jira-ai-sla-inline-badge ${className}`;
          badge.title = `SLA: ${item.friendly}`;
          badge.textContent = `⏱️ ${item.friendly}`;
          keyCell.appendChild(badge);
        }
      }
    });

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
    const dismissed = cachedSettings.dismissedTickets || {};

    // Фільтруємо ті, які відкладені або приховані
    const visibleIssues = criticalList.filter(item => {
      // Якщо відкладено і час відкладення ще не минув
      if (snoozed[item.key] && snoozed[item.key] > now) {
        return false;
      }
      // Якщо приховано для поточної зміни (приховано менше ніж 4 години тому)
      if (dismissed[item.key] && (now - dismissed[item.key] < 4 * 60 * 60 * 1000)) {
        return false;
      }
      return true;
    });

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
          <button class="jira-ai-sla-close-btn" title="Приховати">×</button>
        </div>
        <div class="jira-ai-sla-card-body" title="${item.summary}">
          ${item.summary}
        </div>
        <div class="jira-ai-sla-card-actions">
          <a href="/browse/${item.key}" class="aui-button aui-button-compact aui-button-primary jira-ai-sla-open-btn">Перейти</a>
          <button class="aui-button aui-button-compact jira-ai-sla-snooze-btn" title="Відкласти на ${cachedSettings.slaSnoozeDuration || 10} хв">
            ⏰ Відкласти (${cachedSettings.slaSnoozeDuration || 10} хв)
          </button>
        </div>
      `;

      // Подія "Відкласти" (Snooze)
      const snoozeBtn = card.querySelector('.jira-ai-sla-snooze-btn');
      snoozeBtn.onclick = async (e) => {
        e.preventDefault();
        const snoozeDurationMs = (Number(cachedSettings.slaSnoozeDuration) || 10) * 60 * 1000;
        cachedSettings.snoozedTickets = cachedSettings.snoozedTickets || {};
        cachedSettings.snoozedTickets[item.key] = Date.now() + snoozeDurationMs;
        await chrome.storage.local.set({ snoozedTickets: cachedSettings.snoozedTickets });
        card.classList.add('fade-out');
        setTimeout(() => card.remove(), 250);
      };

      // Подія "Приховати" (Dismiss)
      const closeBtn = card.querySelector('.jira-ai-sla-close-btn');
      closeBtn.onclick = async (e) => {
        e.preventDefault();
        cachedSettings.dismissedTickets = cachedSettings.dismissedTickets || {};
        cachedSettings.dismissedTickets[item.key] = Date.now();
        await chrome.storage.local.set({ dismissedTickets: cachedSettings.dismissedTickets });
        card.classList.add('fade-out');
        setTimeout(() => card.remove(), 250);
      };

      container.appendChild(card);
    });
  }

  // Ініціалізація періодичного опитування
  function initSlaTracker() {
    loadSettings().then(() => {
      checkSla();
      // Перевіряємо кожні 60 секунд
      if (pollingTimer) clearInterval(pollingTimer);
      pollingTimer = setInterval(checkSla, 60 * 1000);
    });

    // Слухаємо зміни в сховищі налаштувань
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local') {
        let needRefresh = false;
        ['enableSlaTracking', 'slaThresholdMinutes', 'slaSnoozeDuration', 'enableSlaHighlighting', 'snoozedTickets', 'dismissedTickets'].forEach(key => {
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

    // Спостерігач за DOM (якщо в Jira динамічно оновлюється черга без перезавантаження сторінки)
    const domObserver = new MutationObserver(() => {
      if (activeIssues.length > 0 && cachedSettings.enableSlaHighlighting) {
        highlightIssuesInDom(activeIssues);
      }
    });

    const targetNode = document.getElementById('content') || document.body;
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
