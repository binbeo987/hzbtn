/* =============================================================================
 * home.js - Trang chủ: thống kê, tiến độ hôm nay, lịch 7 ngày
 * ============================================================================= */

import { state, computeStats } from './store.js';
import { planToday } from './flashcard.js';
import { localDayKey } from './scheduler.js';
import { el, progressBar, formatDayKey } from './ui.js';

export function renderHome() {
  const stats = computeStats();
  const plan = planToday();
  const tz = state.settings?.timezone || undefined;
  const todayKey = localDayKey(new Date(), tz);

  const statsHost = document.getElementById('home-stats');
  if (statsHost) {
    statsHost.innerHTML = '';
    statsHost.append(
      statCard('Tổng số từ trong kho', stats.total),
      statCard('Từ đã học', stats.learned, 'stat-accent'),
      statCard('Từ thành thạo', stats.mastered, 'stat-accent'),
      statCard('Từ mới hôm nay', plan.counts.newInQueue, '', `Còn ${plan.counts.newAvailable} từ mới chưa học`),
      statCard('Từ cũ cần ôn', plan.counts.due, 'stat-warn'),
      statCard('Từ tồn đọng', plan.counts.backlog, plan.counts.backlog ? 'stat-danger' : ''),
      statCard('Tỷ lệ trả lời đúng', `${stats.accuracy}%`),
      statCard('Lượt ôn', stats.reviewCount),
    );
  }

  // Tiến độ hôm nay: dựa trên số từ đã đánh giá trong buổi hôm nay
  // Từ đã đánh giá hôm nay = từ trong buổi học có đánh giá HOẶC lịch sử ôn hôm nay.
  const queueIds = new Set((state.queue?.items || []).map((i) => i.id));
  const session = state.rows.filter(
    (r) =>
      (queueIds.has(r.id) && Boolean(state.queue?.ratings?.[r.id])) ||
      (r.progress?.last_reviewed_at && localDayKey(new Date(r.progress.last_reviewed_at), tz) === todayKey),
  ).length;
  const target = Math.max(plan.items.length, session);
  let pct = target ? Math.min(100, Math.round((session / target) * 100)) : 0;
  if (!target) pct = stats.total && !plan.counts.newAvailable ? 100 : 0;

  const value = document.getElementById('hero-progress-value');
  if (value) value.textContent = `${pct}%`;
  const barHost = document.getElementById('hero-progress-bar');
  if (barHost) {
    barHost.innerHTML = '';
    barHost.appendChild(progressBar(session, target || 1));
  }

  const subtitle = document.getElementById('hero-subtitle');
  if (subtitle) {
    if (!stats.total) subtitle.textContent = 'Kho từ đang trống — nhập CSV để bắt đầu hành trình học tiếng Trung.';
    else if (!plan.items.length)
      subtitle.textContent = `Hôm nay chưa có từ cần ôn. Đã hoàn thành ${session} lượt ôn.`;
    else
      subtitle.textContent = `Hôm nay: ${plan.counts.dueInQueue} từ cũ đến hạn, ${plan.counts.backlogInQueue} từ tồn đọng, ${plan.counts.newInQueue} từ mới.`;
  }

  const summary = document.getElementById('home-session-summary');
  if (summary) {
    summary.innerHTML = '';
    const rows = [
      ['Từ cũ đến hạn', plan.counts.dueInQueue],
      ['Từ tồn đọng', plan.counts.backlogInQueue],
      ['Từ mới', plan.counts.newInQueue],
      ['Tổng buổi học', plan.items.length],
      ['Đã hoàn thành hôm nay', session],
    ];
    for (const [label, value] of rows) {
      summary.appendChild(el('li', {}, [el('span', {}, label), el('b', {}, String(value))]));
    }
    if (plan.deferredNew > 0) {
      summary.appendChild(
        el('li', { class: 'muted' }, [
          el('span', {}, `Từ mới để dành cho ngày sau (do giới hạn buổi)`),
          el('b', {}, String(plan.deferredNew)),
        ]),
      );
    }
  }

  const week = document.getElementById('home-week');
  if (week) {
    week.innerHTML = '';
    const byDay = new Map();
    for (const row of state.rows) {
      const p = row.progress;
      if (!p?.next_review_at || !p.last_reviewed_at) continue;
      const key = localDayKey(new Date(p.next_review_at), tz);
      byDay.set(key, (byDay.get(key) || 0) + 1);
    }
    for (let i = 0; i < 7; i += 1) {
      const d = new Date();
      d.setDate(d.getDate() + i);
      const key = localDayKey(d, tz);
      const count = byDay.get(key) || 0;
      const weekday = new Intl.DateTimeFormat('vi-VN', { weekday: 'short' }).format(d);
      week.appendChild(
        el('a', { class: `week-day${i === 0 ? ' is-today' : ''}`, href: '#calendar', title: `${count} từ đến hạn` }, [
          el('strong', {}, String(d.getDate())),
          el('span', {}, weekday),
          el('span', {}, count ? `${count} từ` : '—'),
        ]),
      );
    }
    const label = el('p', { class: 'muted small', style: { gridColumn: '1 / -1', marginTop: '0.4rem' } },
      `Hôm nay: ${formatDayKey(todayKey, { dateStyle: 'full' })}`);
    week.appendChild(label);
  }
}

function statCard(label, value, accent = '', hint = '') {
  return el('div', { class: 'stat' }, [
    el('span', { class: 'stat-label' }, label),
    el('span', { class: `stat-value ${accent}` }, String(value)),
    hint ? el('span', { class: 'stat-hint' }, hint) : null,
  ]);
}
