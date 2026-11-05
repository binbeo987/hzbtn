/* =============================================================================
 * calendar.js - Trang Lịch ôn tập (tháng / tuần)
 * Dữ liệu tính động từ next_review_at + review_records của Supabase.
 * ============================================================================= */

import { state } from './store.js';
import { buildCalendar, localDayKey } from './scheduler.js';
import { el, esc, formatDayKey, labelHsk } from './ui.js';
import { listReviewRecords } from './api.js';

let view = 'month';
let cursor = new Date();
let selectedKey = null;
let recordsCache = null;
let rendering = false;

export function mountCalendar() {
  const prev = document.getElementById('cal-prev');
  const next = document.getElementById('cal-next');
  if (!prev || prev.dataset.bound) return;
  prev.dataset.bound = '1';
  prev.addEventListener('click', () => shift(-1));
  next.addEventListener('click', () => shift(1));

  document.querySelectorAll('.segmented-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      view = btn.dataset.view;
      document.querySelectorAll('.segmented-btn').forEach((b) => b.classList.toggle('is-active', b === btn));
      renderCalendar();
    });
  });
}

function shift(direction) {
  if (view === 'month') cursor = new Date(cursor.getFullYear(), cursor.getMonth() + direction, 1);
  else cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + direction * 7);
  renderCalendar();
}

export async function renderCalendar() {
  const grid = document.getElementById('calendar-grid');
  const title = document.getElementById('cal-title');
  if (!grid) return;
  if (rendering) return;
  rendering = true;

  try {
    if (!recordsCache) {
      try {
        recordsCache = await listReviewRecords({});
      } catch {
        recordsCache = [];
      }
    }

    const tz = state.settings?.timezone || undefined;
    const { start, end } = rangeForView();
    const days = buildCalendar(state.rows, start, end, tz);

    // Bổ sung đếm lượt ôn thực tế theo ngày từ review_records (chính xác hơn
    // last_reviewed_at khi một từ được ôn nhiều lần trong ngày).
    const reviewedCount = new Map();
    for (const rec of recordsCache) {
      const key = localDayKey(new Date(rec.reviewed_at), tz);
      reviewedCount.set(key, (reviewedCount.get(key) || 0) + 1);
    }
    for (const [key, day] of days) {
      if (reviewedCount.has(key)) day.reviewed = reviewedCount.get(key);
      const todayKey = localDayKey(new Date(), tz);
      if (key === todayKey && day.due > 0) {
        day.status = day.reviewed >= day.due ? 'completed' : 'needs_review';
      }
    }

    title.textContent = view === 'month'
      ? new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(cursor)
      : `Tuần ${weekNumber(cursor)} · ${new Intl.DateTimeFormat('vi-VN', { month: 'long', year: 'numeric' }).format(cursor)}`;

    grid.innerHTML = '';
    const weekdays = view === 'month'
      ? ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN']
      : ['Thứ 2', 'Thứ 3', 'Thứ 4', 'Thứ 5', 'Thứ 6', 'Thứ 7', 'CN'];
    for (const w of weekdays) grid.appendChild(el('div', { class: 'cal-weekday' }, w));

    const todayKey = localDayKey(new Date(), tz);
    const cells = [...days.keys()].sort();
    for (const key of cells) {
      const day = days.get(key);
      const cell = el('button', {
        class: `cal-cell status-${day.status}${key === todayKey ? ' is-today' : ''}${key === selectedKey ? ' is-selected' : ''}`,
        type: 'button',
        dataset: { key },
        'aria-label': formatDayKey(key),
        onclick: () => selectDay(key, day),
      });
      const [, , dd] = key.split('-');
      cell.append(
        el('span', { class: 'cal-daynum' }, String(Number(dd))),
        el('span', { class: 'cal-counts', html: countsHtml(day) }),
      );
      grid.appendChild(cell);
    }

    if (!cells.length) {
      grid.appendChild(el('p', { class: 'muted empty-state', style: { gridColumn: '1 / -1' } }, 'Chưa có dữ liệu ôn tập trong khoảng thời gian này.'));
    }

    if (selectedKey && days.has(selectedKey)) renderDayDetail(selectedKey, days.get(selectedKey));
    else document.getElementById('calendar-day-detail').innerHTML = '';
  } finally {
    rendering = false;
  }
}

function countsHtml(day) {
  const parts = [];
  if (day.learned) parts.push(`+${day.learned} mới`);
  if (day.due) parts.push(`<b>${day.due}</b> cần ôn`);
  if (day.backlog) parts.push(`${day.backlog} tồn`);
  if (day.reviewed) parts.push(`✓${day.reviewed}`);
  return parts.join('<br>') || '<span class="row-muted">—</span>';
}

function rangeForView() {
  if (view === 'month') {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
    // Bắt đầu tuần thứ Hai
    const startOffset = (first.getDay() + 6) % 7;
    const start = new Date(first.getFullYear(), first.getMonth(), first.getDate() - startOffset);
    const endOffset = 6 - ((last.getDay() + 6) % 7);
    const end = new Date(last.getFullYear(), last.getMonth(), last.getDate() + endOffset);
    return { start, end };
  }
  const startOffset = (cursor.getDay() + 6) % 7;
  const start = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() - startOffset);
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return { start, end };
}

function weekNumber(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
}

function selectDay(key, day) {
  selectedKey = key;
  document.querySelectorAll('.cal-cell').forEach((c) => c.classList.toggle('is-selected', c.dataset.key === key));
  renderDayDetail(key, day);
}

function renderDayDetail(key, day) {
  const host = document.getElementById('calendar-day-detail');
  const statusText = {
    completed: 'Hoàn thành',
    needs_review: 'Có từ cần ôn',
    backlog: 'Có từ tồn đọng',
    future: 'Ngày chưa đến',
    empty: 'Không có lịch',
  }[day.status] || day.status;

  host.innerHTML = '';
  host.append(
    el('h3', {}, formatDayKey(key)),
    el('p', { class: 'muted small' }, [
      `Trạng thái: ${statusText} · Từ mới đã học: ${day.learned} · Từ đến hạn: ${day.due} · Lượt ôn: ${day.reviewed}${day.backlog ? ` · Tồn đọng: ${day.backlog}` : ''}`,
    ]),
  );

  const listItems = (day.items || []).slice(0, 200);
  if (listItems.length) {
    const list = el('ul', { class: 'detail-list' });
    for (const row of listItems) {
      list.appendChild(
        el('li', {}, [
          el('span', { class: 'han', lang: 'zh' }, row.word),
          el('span', { class: 'muted' }, [row.pinyin, row.hsk ? ` · ${labelHsk(row.hsk)}` : ''].join('')),
        ]),
      );
    }
    host.append(el('p', { class: 'small muted', style: { marginTop: '0.6rem' } }, `Danh sách từ đến hạn (${day.due}):`), list);
  } else if (day.status === 'future') {
    host.append(el('p', { class: 'muted small' }, 'Không có từ nào được lên lịch cho ngày này.'));
  }

  // Nagivation: học ngay nếu là hôm nay
  if (key === localDayKey(new Date(), state.settings?.timezone || undefined) && day.status !== 'completed') {
    host.append(el('a', { class: 'btn btn-primary btn-sm', href: '#review', style: { marginTop: '0.75rem' } }, 'Ôn ngay hôm nay'));
  }
  // Chống XSS nếu dữ liệu lạ
  host.querySelectorAll('[data-raw]').forEach((n) => (n.textContent = esc(n.dataset.raw)));
}

export function invalidateCalendarCache() {
  recordsCache = null;
}
