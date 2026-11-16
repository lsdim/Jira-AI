// extension/reminders.js
// Модуль нагадувань для заявок Jira

(function () {
  'use strict';

  console.log('[Jira AI Helper] reminders.js завантажено');

  let cachedSettings = {
    enableReminders: true,
    reminders: {} // { issueKey: { time: timestamp, note: '...', summary: '...', reporterName: '...' } }
  };

  // Завантаження налаштувань
  async function loadSettings() {
    return new Promise((resolve) => {
      chrome.storage.local.get({
        enableReminders: true,
        reminders: {}
      }, (items) => {
        cachedSettings = items;
        resolve(items);
      });
    });
  }

  // Ініціалізація модуля
  async function initReminders() {
    await loadSettings();
    if (!cachedSettings.enableReminders) return;

    // Періодично перевіряємо наявність кнопки transition_more та бейджа в шапці
    setInterval(checkAndInjectUI, 1000);
    
    // Запускаємо перевірку нагадувань
    setInterval(checkRemindersLoop, 30000);
    checkRemindersLoop();
  }

  // Ін’єкція або оновлення кнопки нагадування біля opsbar-transitions_more
  function checkAndInjectUI() {
    const transitionsMore = document.getElementById('opsbar-transitions_more');
    const currentKey = getCurrentIssueKey();
    let btn = document.getElementById('jira-ai-reminder-btn');

    if (transitionsMore) {
      if (!btn) {
        const parent = transitionsMore.parentNode;
        if (parent) {
          btn = document.createElement('a');
          btn.id = 'jira-ai-reminder-btn';
          btn.className = 'aui-button';
          btn.href = '#';
          btn.style.marginLeft = '8px';
          
          btn.onclick = (e) => {
            e.preventDefault();
            openReminderModal(currentKey);
          };

          parent.appendChild(btn);
        }
      }

      if (btn) {
        const hasActive = currentKey && cachedSettings.reminders && cachedSettings.reminders[currentKey];
        if (hasActive) {
          btn.style.backgroundColor = '#ffebe6';
          btn.style.borderColor = '#ffbdad';
          btn.style.color = '#bf2600';
          btn.innerHTML = '<span class="aui-icon aui-icon-small aui-iconfont-time" style="margin-right: 4px;"></span>Нагадування активне';
        } else {
          btn.style.backgroundColor = '#fffae6';
          btn.style.color = '#172b4d';
          btn.style.borderColor = '#ffe380';
          btn.innerHTML = '<span class="aui-icon aui-icon-small aui-iconfont-time" style="margin-right: 4px;"></span>Нагадування';
        }
      }
    }

    updateRemindersTopBadge();
  }

  function getCurrentIssueKey() {
    const match = window.location.href.match(/\/([A-Z0-9]+-\d+)(?:\/|$|\?|\#)/i) || window.location.href.match(/([A-Z0-9]+-\d+)/i);
    return match ? match[1] : null;
  }

  // Модальне вікно нагадування
  async function openReminderModal(issueKey) {
    if (!issueKey) {
      alert('Не вдалося визначити ключ заявки!');
      return;
    }

    if (document.getElementById('jira-ai-reminder-modal')) return;

    await loadSettings();
    const existing = cachedSettings.reminders[issueKey] || { time: '', note: '' };

    let defaultDateTime = '';
    if (existing.time) {
      const d = new Date(existing.time);
      const pad = (n) => String(n).padStart(2, '0');
      defaultDateTime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    } else {
      const d = new Date(Date.now() + 3600000);
      const pad = (n) => String(n).padStart(2, '0');
      defaultDateTime = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }

    // Спробуємо одразу витягнути summary та reporter для кешування
    let fetchedSummary = existing.summary || '';
    let fetchedReporter = existing.reporterName || '';
    try {
      const resp = await fetch(`/rest/api/2/issue/${issueKey}?fields=summary,reporter`);
      if (resp.ok) {
        const issueJson = await resp.json();
        fetchedSummary = issueJson.fields?.summary || fetchedSummary;
        fetchedReporter = issueJson.fields?.reporter?.displayName || fetchedReporter;
      }
    } catch (e) {
      // ігноруємо
    }

    const modal = document.createElement('div');
    modal.id = 'jira-ai-reminder-modal';
    modal.className = 'jira-ai-whats-new-overlay';
    modal.innerHTML = `
      <div class="jira-ai-whats-new-modal" style="width: 450px;">
        <div class="jira-ai-whats-new-header">
          <h3>⏱️ Нагадування для ${issueKey}</h3>
        </div>
        <div class="jira-ai-whats-new-body">
          <div class="field-group" style="margin-bottom: 15px;">
            <label style="display:block; font-weight:600; font-size:12px; margin-bottom:6px; color:#5e6c84;">Дата та час нагадування:</label>
            <input type="datetime-local" id="jira-reminder-time" value="${defaultDateTime}" style="width:100%; padding:8px; border:2px solid #dfe1e6; border-radius:4px; box-sizing:border-box;">
          </div>
          <div class="field-group">
            <label style="display:block; font-weight:600; font-size:12px; margin-bottom:6px; color:#5e6c84;">Замітка / Причина:</label>
            <textarea id="jira-reminder-note" placeholder="Наприклад: Передзвонити клієнту щодо уточнення IP..." style="width:100%; height:90px; padding:8px; border:2px solid #dfe1e6; border-radius:4px; box-sizing:border-box; resize:vertical; font-family:inherit;">${existing.note || ''}</textarea>
          </div>
        </div>
        <div class="jira-ai-whats-new-footer">
          ${existing.time ? '<button type="button" id="jira-reminder-delete-btn" class="aui-button" style="margin-right: auto; color: #de350b;">Видалити нагадування</button>' : ''}
          <button type="button" id="jira-reminder-cancel-btn" class="aui-button">Скасувати</button>
          <button type="button" id="jira-reminder-save-btn" class="aui-button aui-button-primary">Зберегти</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    modal.querySelector('#jira-reminder-cancel-btn').onclick = () => modal.remove();
    
    const deleteBtn = modal.querySelector('#jira-reminder-delete-btn');
    if (deleteBtn) {
      deleteBtn.onclick = async () => {
        delete cachedSettings.reminders[issueKey];
        await chrome.storage.local.set({ reminders: cachedSettings.reminders });
        modal.remove();
        checkAndInjectUI();
      };
    }

    modal.querySelector('#jira-reminder-save-btn').onclick = async () => {
      const timeVal = modal.querySelector('#jira-reminder-time').value;
      const noteVal = modal.querySelector('#jira-reminder-note').value;

      if (!timeVal) {
        alert('Будь ласка, вкажіть дату та час!');
        return;
      }

      const [datePart, timePart] = timeVal.split('T');
      const [year, month, day] = datePart.split('-').map(Number);
      const [hours, minutes] = timePart.split(':').map(Number);
      const timestamp = new Date(year, month - 1, day, hours, minutes).getTime();

      if (timestamp <= Date.now()) {
        alert('Час нагадування має бути в майбутньому!');
        return;
      }

      cachedSettings.reminders[issueKey] = {
        time: timestamp,
        note: noteVal,
        summary: fetchedSummary,
        reporterName: fetchedReporter,
        createdAt: Date.now(),
        notified: false
      };

      await chrome.storage.local.set({ reminders: cachedSettings.reminders });
      modal.remove();
      checkAndInjectUI();
    };
  }

  // Обчислення та оновлення бейджа у верхньому меню
  function updateRemindersTopBadge() {
    const reminders = cachedSettings.reminders || {};
    const keys = Object.keys(reminders);
    if (keys.length === 0) {
      const wrapper = document.getElementById('jira-ai-reminders-top-badge-wrapper');
      if (wrapper) wrapper.style.display = 'none';
      return;
    }

    let wrapper = document.getElementById('jira-ai-reminders-top-badge-wrapper');
    let badge = document.getElementById('jira-ai-reminders-top-badge');

    if (!wrapper) {
      const slaBadgeWrapper = document.getElementById('jira-ai-sla-top-badge-wrapper');
      const createMenu = document.getElementById('create-menu') || document.querySelector('#header-details-user-fullname')?.parentNode;
      
      wrapper = document.createElement('li');
      wrapper.id = 'jira-ai-reminders-top-badge-wrapper';
      wrapper.className = 'jira-ai-sla-top-badge-wrapper';
      wrapper.style.display = 'inline-flex';
      wrapper.style.alignItems = 'center';

      badge = document.createElement('div');
      badge.id = 'jira-ai-reminders-top-badge';
      badge.className = 'jira-ai-sla-top-badge';
      badge.style.background = '#deebff';
      badge.style.color = '#0052cc';
      badge.style.borderColor = '#4c9aff';
      badge.title = 'Активні нагадування';

      wrapper.appendChild(badge);

      badge.onclick = (e) => {
        e.stopPropagation();
        toggleRemindersDropdown(wrapper);
      };

      if (slaBadgeWrapper && slaBadgeWrapper.parentNode) {
        slaBadgeWrapper.parentNode.insertBefore(wrapper, slaBadgeWrapper.nextSibling);
      } else if (createMenu && createMenu.parentNode) {
        createMenu.parentNode.insertBefore(wrapper, createMenu.nextSibling);
      } else {
        document.body.appendChild(wrapper);
        wrapper.style.position = 'fixed';
        wrapper.style.top = '10px';
        wrapper.style.right = '200px';
        wrapper.style.zIndex = '10001';
      }
    }

    badge.innerHTML = `<span>⏰</span><span>Нагадування: ${keys.length}</span>`;
    wrapper.style.display = 'inline-flex';
  }

  // Випадаючий список активних нагадувань у верхньому меню
  function toggleRemindersDropdown(wrapper) {
    let dropdown = document.getElementById('jira-ai-reminders-dropdown');
    if (dropdown) {
      dropdown.remove();
      return;
    }

    dropdown = document.createElement('div');
    dropdown.id = 'jira-ai-reminders-dropdown';
    dropdown.className = 'jira-ai-sla-dropdown';

    const reminders = cachedSettings.reminders || {};
    const itemsHtml = Object.entries(reminders).length > 0
      ? Object.entries(reminders).map(([key, data]) => {
          const dateStr = new Date(data.time).toLocaleString('uk-UA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
          return `
            <div class="jira-ai-sla-dropdown-item" data-key="${key}">
              <div class="jira-ai-sla-dropdown-item-top">
                <a href="/browse/${key}" class="jira-ai-sla-dropdown-item-key" target="_blank">${key}</a>
                <span style="font-size:11px; font-weight:700; color:#0052cc;">${dateStr}</span>
              </div>
              <div style="font-size:11px; color:#5e6c84; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(data.note || data.summary || 'Без замітки')}</div>
            </div>
          `;
        }).join('')
      : '<div class="jira-ai-sla-dropdown-empty">Немає активних нагадувань</div>';

    dropdown.innerHTML = `
      <div class="jira-ai-sla-dropdown-header">
        <span>⏰ Активні нагадування (${Object.keys(reminders).length})</span>
      </div>
      <div class="jira-ai-sla-dropdown-list">
        ${itemsHtml}
      </div>
    `;

    wrapper.appendChild(dropdown);

    const closeListener = (e) => {
      if (!wrapper.contains(e.target)) {
        dropdown.remove();
        document.removeEventListener('click', closeListener);
      }
    };
    setTimeout(() => document.addEventListener('click', closeListener), 10);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Перевірка нагадувань у фоні (цикл)
  async function checkRemindersLoop() {
    await loadSettings();
    const reminders = cachedSettings.reminders || {};
    const now = Date.now();

    for (const [key, data] of Object.entries(reminders)) {
      if (data.time <= now && !data.notified) {
        showReminderToast(key, data);
        
        cachedSettings.reminders[key].notified = true;
        await chrome.storage.local.set({ reminders: cachedSettings.reminders });
      }
    }
  }

  // Показ виринаючого сповіщення (Toast) для нагадування
  async function showReminderToast(key, data) {
    try {
      let summary = data.summary || '';
      let reporterName = data.reporterName || 'Анонім';
      
      if (!summary || !data.reporterName) {
        try {
          const resp = await fetch(`/rest/api/2/issue/${key}?fields=summary,reporter`);
          if (resp.ok) {
            const issueJson = await resp.json();
            summary = issueJson.fields?.summary || summary;
            reporterName = issueJson.fields?.reporter?.displayName || reporterName;
            data.summary = summary;
            data.reporterName = reporterName;
            cachedSettings.reminders[key] = data;
            await chrome.storage.local.set({ reminders: cachedSettings.reminders });
          }
        } catch (e) {
          // ігноруємо
        }
      }

      const dateStr = new Date(data.time).toLocaleString('uk-UA', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

      let container = document.getElementById('jira-ai-reminder-toast-container');
      if (!container) {
        container = document.createElement('div');
        container.id = 'jira-ai-reminder-toast-container';
        container.style.position = 'fixed';
        container.style.top = '70px';
        container.style.right = '24px';
        container.style.zIndex = '99999';
        container.style.display = 'flex';
        container.style.flexDirection = 'column';
        container.style.gap = '12px';
        container.style.maxWidth = '380px';
        container.style.pointerEvents = 'none';
        document.body.appendChild(container);
      }

      const card = document.createElement('div');
      card.className = 'jira-ai-sla-card';
      card.style.pointerEvents = 'auto';
      card.style.background = '#ffffff';
      card.style.borderRadius = '8px';
      card.style.boxShadow = '0 8px 24px rgba(9, 30, 66, 0.3), 0 0 1px rgba(9, 30, 66, 0.31)';
      card.style.padding = '14px 16px';
      card.style.borderLeft = '5px solid #0052cc';
      card.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
      card.style.color = '#172b4d';
      card.style.zIndex = '99999';
      
      card.innerHTML = `
        <div class="jira-ai-sla-card-header" style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px;">
          <div class="jira-ai-sla-card-title" style="display: flex; align-items: center; gap: 8px; font-size: 13px;">
            <span>⏰</span>
            <a href="/browse/${key}" class="jira-ai-sla-link" target="_blank" style="color: #0052cc; text-decoration: none;"><strong>${key}</strong></a>
            <span class="jira-ai-sla-time-badge warning" style="font-size: 11px; font-weight: 700; padding: 2px 7px; border-radius: 10px; background: #deebff; color: #0052cc;">${dateStr}</span>
          </div>
          <button class="jira-ai-sla-close-btn" title="Закрити" style="background: none; border: none; font-size: 18px; line-height: 14px; color: #6b778c; cursor: pointer; padding: 2px 6px; border-radius: 4px;">&times;</button>
        </div>
        <div style="font-size: 11px; font-weight: 700; color: #5e6c84; margin-bottom: 2px;">Заявник: ${escapeHtml(reporterName)}</div>
        <div style="font-size: 12px; color: #172b4d; font-weight: 600; margin-bottom: 6px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" title="${escapeHtml(summary)}">${escapeHtml(summary)}</div>
        <div class="jira-ai-sla-card-body" style="font-size: 12px; color: #42526e; line-height: 16px; margin-bottom: 10px; white-space: pre-line; background: #f4f5f7; padding: 8px; border-radius: 4px;">
          ${escapeHtml(data.note || 'Час нагадування настав!')}
        </div>
        <div class="jira-ai-sla-card-actions" style="display: flex; justify-content: space-between; align-items: center; gap: 8px;">
          <a href="/browse/${key}" class="aui-button aui-button-compact aui-button-primary jira-ai-sla-open-btn" target="_blank" style="font-size: 11px; height: 24px; line-height: 24px; text-decoration: none;">Перейти</a>
          <div class="jira-ai-sla-snooze-group" style="display: flex; align-items: center; gap: 6px;">
            <select class="jira-ai-sla-snooze-select reminder-snooze-select" style="padding: 3px 6px; font-size: 11px; border: 1px solid #dfe1e6; border-radius: 3px; background: #f4f5f7; color: #172b4d;">
              <option value="5">5 хв</option>
              <option value="10">10 хв</option>
              <option value="15" selected>15 хв</option>
              <option value="30"> хв</option>
              <option value="60">1 год</option>
              <option value="120">2 год</option>
            </select>
            <button class="aui-button aui-button-compact jira-ai-sla-snooze-btn reminder-snooze-btn" style="font-size: 11px; height: 24px; background: #f4f5f7; color: #42526e; border: 1px solid #dfe1e6; cursor: pointer;">⏰ Відкласти</button>
          </div>
        </div>
      `;

      // Подія "Закрити"
      card.querySelector('.jira-ai-sla-close-btn').onclick = () => {
        card.style.opacity = '0';
        card.style.transform = 'translateY(15px)';
        card.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        setTimeout(() => card.remove(), 250);
      };

      // Подія "Відкласти" (Snooze)
      card.querySelector('.reminder-snooze-btn').onclick = async (e) => {
        e.preventDefault();
        const selectEl = card.querySelector('.reminder-snooze-select');
        const minutes = Number(selectEl.value) || 30;
        const snoozeMs = minutes * 60 * 1000;

        await loadSettings();
        if (cachedSettings.reminders[key]) {
          cachedSettings.reminders[key].time = Date.now() + snoozeMs;
          cachedSettings.reminders[key].notified = false; // Скидаємо прапорець
          await chrome.storage.local.set({ reminders: cachedSettings.reminders });
        }

        card.style.opacity = '0';
        card.style.transform = 'translateY(15px)';
        card.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
        setTimeout(() => card.remove(), 250);
        checkAndInjectUI();
      };

      container.appendChild(card);
    } catch (err) {
      console.error('[Jira AI Reminders] Помилка при показі Toast:', err);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initReminders);
  } else {
    initReminders();
  }

})();
