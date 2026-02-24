// src/components/earningsCalendar.js
import { getWeeklyEarnings, resetEarningsCache } from '../data/earningsService.js';
import { renderLastUpdatedLine } from './lastUpdated.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

export function initEarningsCalendar() {
  const view = document.getElementById('earnings-view');
  if (!view) return;

  const container = view.querySelector('#earnings-calendar');
  const lastUpdatedEl = view.querySelector('.last-updated');
  const refreshBtn = view.querySelector('.earnings-refresh-btn');

  async function refresh() {
    try {
      const { dataByDay, lastFetch, error } = await getWeeklyEarnings();
      renderGrid(container, dataByDay);
      // Use “1W” as the timeframe label for the calendar
      renderLastUpdatedLine(lastUpdatedEl, lastFetch, '1W', error);
    } catch (err) {
      renderLastUpdatedLine(lastUpdatedEl, null, '1W', err.message);
    }
  }

  if (refreshBtn) {
    refreshBtn.addEventListener('click', () => {
      // Clear cache earnings so we force a fresh fetch for the current/next week
      resetEarningsCache();
      refresh();
    });
  }

  // Initial render
  refresh();
}

function renderGrid(container, dataByDay) {
  if (!container) return;
  container.innerHTML = '';

  DAYS.forEach(day => {
    const col = document.createElement('div');
    col.className = 'earnings-day';

    const dayHeader = document.createElement('div');
    dayHeader.className = 'earnings-day-header';
    dayHeader.textContent = day;
    col.appendChild(dayHeader);

    const dayList = document.createElement('div');
    dayList.className = 'earnings-day-list';

    ['BMO', 'AMC'].forEach(session => {
      const section = document.createElement('div');
      section.className = 'earnings-session';

      const label = document.createElement('div');
      label.className = 'earnings-session-label';
      label.textContent = session === 'BMO' ? 'Before Open' : 'After Close';
      section.appendChild(label);

      const list = document.createElement('div');
      list.className = 'earnings-company-list';

      const items =
        dataByDay &&
        dataByDay[day] &&
        dataByDay[day][session]
          ? dataByDay[day][session]
          : [];

      items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'earnings-company-row';

        row.innerHTML = `
          <div class="earnings-logo-wrapper">
            ${
              item.logo
                ? `<img src="${item.logo}" alt="${item.symbol} logo" class="earnings-logo" />`
                : `<div class="earnings-logo-placeholder"></div>`
            }
          </div>
          <div class="earnings-text">
            <div class="earnings-symbol">${item.symbol}</div>
            <div class="earnings-name">${item.companyName || ''}</div>
          </div>
        `;

        list.appendChild(row);
      });

      section.appendChild(list);
      dayList.appendChild(section);
    });

    col.appendChild(dayList);

    container.appendChild(col);
  });
}
