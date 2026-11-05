/* =============================================================================
 * flashcard.js - Buổi ôn tập Flashcard
 * - Mỗi lượt đánh giá: tính SM-2 (scheduler.js) → lưu Supabase (RPC record_review)
 * - Chỉ ghi nhận khi người dùng đã mở đáp án rồi chọn mức độ
 * - Lưu tạm vị trí buổi học vào LocalStorage để mở lại trình duyệt vẫn tiếp tục
 * ============================================================================= */

import {
  state,
  setQueue,
  applyReviewLocally,
  invalidateQueue,
  getSavedQueueSnapshot,
} from './store.js';
import { recordReview, startLearning, queueForReview, markSession } from './api.js';
import { scheduleReview, buildDailyQueue, localDayKey, formatNextReview } from './scheduler.js';
import { RATING_META } from './config.js';
import {
  el,
  toast,
  speak,
  speakable,
  labelHsk,
  labelTopic,
  getErrorMessage,
  progressBar,
} from './ui.js';

let current = null; // { items, index, ratings, startedAt, dayKey, revealed, saving }
let mounted = false;

const body = () => document.getElementById('review-body');
const subtitle = () => document.getElementById('review-subtitle');

/* -------------------------------------------------------------------------- */
/* BUILD QUEUE                                                                 */
/* -------------------------------------------------------------------------- */

/** Tính buổi học mới từ dữ liệu đã tải; nếu còn snapshot hôm nay thì khôi phục. */
export function planToday() {
  const tz = state.settings?.timezone || undefined;
  const plan = buildDailyQueue(state.rows, state.settings || {}, new Date(), tz);
  return plan;
}

export function restoreOrBuildQueue() {
  const tz = state.settings?.timezone || undefined;
  const today = localDayKey(new Date(), tz);
  const snapshot = getSavedQueueSnapshot(state.userId);

  if (snapshot && snapshot.dayKey === today && snapshot.items?.length) {
    const byId = new Map(state.rows.map((r) => [r.id, r]));
    const items = snapshot.items.map((id) => byId.get(id)).filter(Boolean);
    const completedIds = new Set(Object.keys(snapshot.ratings || {}));
    const remaining = items.filter((i) => !completedIds.has(i.id));
    if (remaining.length && items.length) {
      current = {
        items,
        index: 0,
        ratings: snapshot.ratings || {},
        startedAt: snapshot.startedAt || new Date().toISOString(),
        dayKey: today,
        counts: snapshot.counts || {},
        revealed: false,
        saving: false,
        resumed: true,
      };
      return current;
    }
  }

  return rebuildQueue();
}

/** Tạo buổi học mới từ trạng thái Supabase hiện tại. */
export function rebuildQueue() {
  const tz = state.settings?.timezone || undefined;
  const plan = planToday();
  current = {
    items: plan.items,
    index: 0,
    ratings: {},
    startedAt: new Date().toISOString(),
    dayKey: localDayKey(new Date(), tz),
    counts: plan.counts,
    revealed: false,
    saving: false,
    resumed: false,
    deferredNew: plan.deferredNew,
  };
  persist();
  return current;
}

export function getQueue() {
  return current;
}

function persist() {
  if (!current) return;
  setQueue({
    dayKey: current.dayKey,
    items: current.items.map((i) => i.id),
    ratings: current.ratings,
    startedAt: current.startedAt,
    counts: current.counts,
    userId: state.userId,
  });
}

/* -------------------------------------------------------------------------- */
/* RENDER                                                                      */
/* -------------------------------------------------------------------------- */

export function mountReview() {
  mounted = true;
  const reload = document.getElementById('review-reload');
  if (reload && !reload.dataset.bound) {
    reload.dataset.bound = '1';
    reload.addEventListener('click', () => {
      if (current && !isComplete()) {
        const ok = window.confirm('Tải lại buổi học? Các đánh giá đã lưu vẫn được giữ, buổi học sẽ được tính lại.');
        if (!ok) return;
      }
      invalidateQueue();
      current = null;
      beginSession();
    });
  }
  if (!current) restoreOrBuildQueue();
  render();
}

export function beginSession() {
  if (!current) restoreOrBuildQueue();
  render();
}

function isComplete() {
  return current && current.index >= current.items.length;
}

function statsOf() {
  const rated = Object.values(current.ratings || {});
  return {
    done: rated.length,
    total: current.items.length,
    again: rated.filter((r) => r === 'again').length,
    hard: rated.filter((r) => r === 'hard').length,
    good: rated.filter((r) => r === 'good').length,
    easy: rated.filter((r) => r === 'easy').length,
  };
}

export function render() {
  if (!mounted) return;
  const host = body();
  if (!host) return;
  if (!current) current = restoreOrBuildQueue();

  const plan = planToday();
  const dueNow = plan.counts.due + plan.counts.backlog;
  if (subtitle()) {
    subtitle().textContent = current.items.length
      ? `${dueNow} từ cần ôn · ${plan.counts.newInQueue} từ mới trong buổi hôm nay`
      : 'Chưa có từ nào cần ôn hôm nay.';
  }

  host.innerHTML = '';

  if (!current.items.length) {
    host.appendChild(renderEmpty(plan));
    return;
  }

  if (isComplete()) {
    host.appendChild(renderDone());
    finalizeSession();
    return;
  }

  const item = current.items[current.index];
  const s = statsOf();
  const progressEl = el('div', {}, [progressBar(s.done, s.total, `Đã ôn ${s.done}/${s.total} từ`)]);
  host.appendChild(progressEl);

  const card = el('div', { class: 'flashcard', id: 'flashcard', dataset: { flipped: String(Boolean(current.revealed)) } });
  const inner = el('div', { class: 'flashcard-inner' });

  // MẶT TRƯỚC
  const front = el('div', { class: 'flashcard-face flashcard-front' }, [
    el('div', { class: 'fc-bucket' }, [
      el('span', { class: `tag ${item.bucket === 'new' ? 'tag-blue' : item.bucket === 'backlog' ? 'tag-amber' : ''}` },
        bucketLabel(item.bucket)),
    ]),
    el('h2', { class: 'fc-word han', lang: 'zh' }, item.word),
    el('button', {
      class: 'btn btn-outline btn-icon',
      type: 'button',
      title: 'Nghe phát âm',
      'aria-label': `Nghe phát âm ${item.word}`,
      onclick: (e) => {
        e.stopPropagation();
        if (!speakable(item.word)) return toast('Trình duyệt không hỗ trợ phát âm.', 'error');
        speak(item.word);
      },
    }, '🔊'),
    el('p', { class: 'fc-hint' }, 'Chạm để xem đáp án'),
  ]);

  // MẶT SAU
  const back = el('div', { class: 'flashcard-face flashcard-back' }, [
    el('h2', { class: 'fc-word-sm han', lang: 'zh' }, item.word),
    el('p', { class: 'fc-pinyin' }, item.pinyin),
    item.pos ? el('p', { class: 'fc-pos' }, item.pos) : null,
    el('p', { class: 'fc-meaning' }, item.meaning),
    el('div', { class: 'fc-tags' }, [
      item.hsk ? el('span', { class: 'tag tag-blue' }, labelHsk(item.hsk)) : null,
      item.topic ? el('span', { class: 'tag tag-green' }, labelTopic(item.topic)) : null,
    ]),
    item.example || item.example_meaning
      ? el('div', { class: 'fc-example' }, [
          item.example ? el('div', { class: 'han', lang: 'zh' }, item.example) : null,
          item.example_pinyin ? el('div', { class: 'pinyin-line' }, item.example_pinyin) : null,
          item.example_meaning ? el('div', { class: 'vi-line' }, item.example_meaning) : null,
          item.example && speakable(item.example)
            ? el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => speak(item.example) }, '🔊 Nghe câu')
            : null,
        ])
      : null,
    item.progress?.next_review_at
      ? el('p', { class: 'fc-hint' }, `Lịch hiện tại: ${formatNextReview(item.progress.next_review_at)}`)
      : null,
  ]);

  inner.append(front, back);
  card.appendChild(inner);

  front.addEventListener('click', () => revealAnswer());
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      revealAnswer();
    }
  });
  card.tabIndex = 0;

  host.appendChild(card);

  const actions = el('div', { class: 'flashcard-actions' });
  if (!current.revealed) {
    actions.appendChild(
      el('button', { class: 'btn btn-primary btn-lg', type: 'button', id: 'reveal-btn', onclick: revealAnswer }, 'Xem đáp án'),
    );
  } else {
    const grid = el('div', { class: 'rating-grid', id: 'rating-grid' });
    for (const [rating, meta] of Object.entries(RATING_META)) {
      grid.appendChild(
        el('button', {
          class: `rating-btn ${meta.className}`,
          type: 'button',
          dataset: { rating },
          onclick: () => rate(rating),
        }, [el('span', {}, meta.label), el('small', {}, meta.hint)]),
      );
    }
    host.appendChild(grid);
  }

  host.appendChild(actions);

  // Tóm tắt hàng đợi
  host.appendChild(
    el('div', { class: 'queue-summary' }, [
      el('span', { class: 'tag' }, `Từ cũ đến hạn: ${current.counts?.dueInQueue ?? 0}`),
      el('span', { class: 'tag tag-amber' }, `Tồn đọng: ${current.counts?.backlogInQueue ?? 0}`),
      el('span', { class: 'tag tag-blue' }, `Từ mới: ${current.counts?.newInQueue ?? 0}`),
    ]),
  );
}

function bucketLabel(bucket) {
  if (bucket === 'new') return 'Từ mới';
  if (bucket === 'backlog') return 'Tồn đọng';
  return 'Đến hạn';
}

function renderEmpty(plan) {
  const wrap = el('div', { class: 'card empty-state' }, [
    el('h2', {}, plan.counts.newAvailable ? 'Đã hết từ cần ôn hôm nay' : 'Kho từ đang trống'),
    el('p', { class: 'muted' }, plan.counts.newAvailable
      ? `Còn ${plan.counts.newAvailable} từ mới chưa phân bổ (giới hạn từ mới/ngày: ${state.settings?.new_words_per_day ?? 10}).`
      : 'Hãy nhập CSV hoặc thêm từ ở trang Kho từ vựng để bắt đầu học.'),
    el('div', { class: 'review-done-actions' }, [
      el('a', { class: 'btn btn-primary', href: '#vocabulary' }, 'Mở kho từ vựng'),
      el('a', { class: 'btn btn-outline', href: '#import' }, 'Nhập CSV'),
    ]),
  ]);
  return wrap;
}

function renderDone() {
  const s = statsOf();
  return el('div', { class: 'card review-done' }, [
    el('div', { class: 'big-emoji' }, '🎉'),
    el('h2', {}, 'Hoàn thành buổi học hôm nay!'),
    el('p', { class: 'muted' }, `Bạn đã ôn ${s.done} từ.`),
    el('div', { class: 'import-summary-cards', style: { width: '100%', maxWidth: '560px' } }, [
      el('div', { class: 'mini-stat is-failed' }, [el('b', {}, s.again), el('span', {}, 'Chưa nhớ')]),
      el('div', { class: 'mini-stat is-skipped' }, [el('b', {}, s.hard), el('span', {}, 'Khó nhớ')]),
      el('div', { class: 'mini-stat is-updated' }, [el('b', {}, s.good), el('span', {}, 'Đã nhớ')]),
      el('div', { class: 'mini-stat is-new' }, [el('b', {}, s.easy), el('span', {}, 'Rất dễ')]),
    ]),
    el('div', { class: 'review-done-actions' }, [
      el('a', { class: 'btn btn-primary', href: '#home' }, 'Về trang chủ'),
      el('a', { class: 'btn btn-outline', href: '#calendar' }, 'Xem lịch ôn tập'),
    ]),
  ]);
}

/* -------------------------------------------------------------------------- */
/* INTERACTION                                                                 */
/* -------------------------------------------------------------------------- */

export function revealAnswer() {
  if (!current || current.revealed) return;
  current.revealed = true;
  const card = document.getElementById('flashcard');
  if (card) card.dataset.flipped = 'true';
  const revealBtn = document.getElementById('reveal-btn');
  if (revealBtn) revealBtn.remove();

  const host = body();
  if (host && !document.getElementById('rating-grid')) {
    const grid = el('div', { class: 'rating-grid', id: 'rating-grid' });
    for (const [rating, meta] of Object.entries(RATING_META)) {
      grid.appendChild(
        el('button', {
          class: `rating-btn ${meta.className}`,
          type: 'button',
          dataset: { rating },
          onclick: () => rate(rating),
        }, [el('span', {}, meta.label), el('small', {}, meta.hint)]),
      );
    }
    host.appendChild(grid);
    grid.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/** Đánh giá từ hiện tại: lưu Supabase ngay, rồi chuyển từ tiếp theo. */
export async function rate(rating) {
  if (!current || current.saving || !current.revealed) return;
  const item = current.items[current.index];
  if (!item) return;

  current.saving = true;
  document.querySelectorAll('.rating-btn').forEach((b) => (b.disabled = true));
  const now = new Date();

  try {
    let previous = item.progress || null;
    if (item.bucket === 'new') {
      // Từ mới chưa có learning_progress: tạo hồ sơ "new" để RPC có thể update.
      try {
        previous = await startLearning(item.id);
        item.progress = previous;
      } catch (error) {
        // Nếu RLS trigger cấm thì vẫn để RPC tự upsert.
        console.warn('startLearning failed, continue with RPC', error);
      }
    }

    const schedule = scheduleReview(previous, rating, now);
    const saved = await recordReview({
      vocabularyId: item.id,
      rating,
      previousNextReviewAt: previous?.next_review_at || null,
      schedule,
    });

    applyReviewLocally(item.id, saved || schedule);
    item.progress = saved || schedule;
    current.ratings[item.id] = rating;
    current.index += 1;
    current.revealed = false;
    current.saving = false;
    persist();
    render();
    markSessionProgress();
  } catch (error) {
    current.saving = false;
    document.querySelectorAll('.rating-btn').forEach((b) => (b.disabled = false));
    toast(`Chưa lưu được đánh giá: ${getErrorMessage(error)}`, 'error', 5000);
  }
}

async function markSessionProgress() {
  const s = statsOf();
  try {
    await markSession({
      sessionDate: current.dayKey,
      counts: {
        newInQueue: current.counts?.newInQueue || 0,
        dueInQueue: current.counts?.dueInQueue || 0,
        backlogInQueue: current.counts?.backlogInQueue || 0,
        completed: s.done,
      },
      status: s.done >= current.items.length ? 'completed' : 'in_progress',
      startedAt: current.startedAt,
      completedAt: s.done >= current.items.length ? new Date().toISOString() : null,
    });
  } catch (error) {
    console.warn('markSession failed', error);
  }
}

let finalized = false;
async function finalizeSession() {
  if (finalized) return;
  finalized = true;
  const s = statsOf();
  try {
    await markSession({
      sessionDate: current.dayKey,
      counts: {
        newInQueue: current.counts?.newInQueue || 0,
        dueInQueue: current.counts?.dueInQueue || 0,
        backlogInQueue: current.counts?.backlogInQueue || 0,
        completed: s.done,
      },
      status: 'completed',
      startedAt: current.startedAt,
      completedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn('finalizeSession failed', error);
  }
}

export function resetFinalizeFlag() {
  finalized = false;
}

/** Thêm một từ bất kỳ (từ trang Tra từ) vào danh sách ôn tập ngay. */
export async function addToReview(row) {
  try {
    const progress = await queueForReview(row.id);
    const existing = state.rows.find((r) => r.id === row.id);
    if (existing) existing.progress = progress;
    invalidateQueue();
    current = null;
    toast(`Đã đưa “${row.word}” vào danh sách ôn tập.`, 'success');
  } catch (error) {
    toast(getErrorMessage(error), 'error');
  }
}

/** Bắt đầu học hôm nay (trang chủ / menu). */
export function startToday() {
  invalidateQueue();
  current = null;
  resetFinalizeFlag();
  location.hash = '#review';
  if (location.hash === '#review') {
    mounted = true;
    restoreOrBuildQueue();
    render();
  }
}
