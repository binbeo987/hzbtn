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
import { scheduleReview, buildDailyQueue, localDayKey } from './scheduler.js';
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
  confirmDialog,
} from './ui.js';

let current = null; // { items, index, ratings, startedAt, dayKey, counts, revealed, saving }
let mounted = false;
let saveError = null; // lỗi lưu gần nhất, hiển thị trong buổi học

const body = () => document.getElementById('review-body');
const subtitle = () => document.getElementById('review-subtitle');

/* -------------------------------------------------------------------------- */
/* BUILD QUEUE                                                                 */
/* -------------------------------------------------------------------------- */

/** Tính buổi học mới từ dữ liệu đã tải. */
export function planToday() {
  const tz = state.settings?.timezone || undefined;
  return buildDailyQueue(state.rows, state.settings || {}, new Date(), tz);
}

export function restoreOrBuildQueue() {
  const tz = state.settings?.timezone || undefined;
  const today = localDayKey(new Date(), tz);
  const snapshot = getSavedQueueSnapshot();

  if (snapshot && snapshot.dayKey === today && snapshot.items?.length) {
    const byId = new Map(state.rows.map((r) => [r.id, r]));
    const items = snapshot.items.map((id) => byId.get(id)).filter(Boolean);
    const ratings = snapshot.ratings || {};
    const completedIds = new Set(Object.keys(ratings));
    const remaining = items.filter((i) => !completedIds.has(i.id));
    if (remaining.length && items.length) {
      current = {
        items,
        index: 0,
        ratings,
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
  saveError = null;
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
    reload.addEventListener('click', async () => {
      if (current && !isComplete()) {
        const ok = await confirmDialog({
          title: 'Tải lại buổi học',
          message: 'Các đánh giá đã lưu vào Supabase vẫn được giữ nguyên. Buổi học sẽ được tính lại từ dữ liệu mới nhất.',
          okText: 'Tải lại',
        });
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

/** Tạo hàng nút đánh giá (dùng chung cho lần render đầu và sau khi mở đáp án). */
function ratingGrid() {
  const grid = el('div', { class: 'rating-grid', id: 'rating-grid' });
  for (const [rating, meta] of Object.entries(RATING_META)) {
    grid.appendChild(
      el('button', {
        class: `rating-btn ${meta.className}`,
        type: 'button',
        dataset: { rating },
        'aria-label': `${meta.label} (${meta.hint})`,
        onclick: () => rate(rating),
      }, [el('span', {}, meta.label), el('small', {}, meta.hint)]),
    );
  }
  return grid;
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
  host.appendChild(el('div', {}, [progressBar(s.done, s.total, `Đã ôn ${s.done}/${s.total} từ`)]));

  if (saveError) {
    host.appendChild(
      el('div', { class: 'boot-error', style: { marginBottom: '1rem' } }, [
        `Đánh giá vừa rồi chưa lưu được: ${saveError}`,
        el('br'),
        el('button', {
          class: 'btn btn-primary btn-sm',
          type: 'button',
          style: { marginTop: '0.5rem' },
          onclick: () => {
            saveError = null;
            render();
          },
        }, 'Thử lại'),
      ]),
    );
  }

  const card = el('div', {
    class: 'flashcard',
    id: 'flashcard',
    dataset: { flipped: String(Boolean(current.revealed)) },
    tabindex: '0',
    role: 'button',
    'aria-label': current.revealed ? `Đáp án của ${item.word}` : `Thẻ từ ${item.word}. Nhấn để xem đáp án.`,
  });

  // MẶT TRƯỚC
  const front = el('div', { class: 'flashcard-face flashcard-front' }, [
    el('div', { class: 'fc-bucket' }, [
      el('span', {
        class: `tag ${item.bucket === 'new' ? 'tag-blue' : item.bucket === 'backlog' ? 'tag-amber' : ''}`,
      }, bucketLabel(item.bucket)),
    ]),
    el('h2', { class: 'fc-word han', lang: 'zh' }, item.word),
    el('button', {
      class: 'btn btn-outline btn-icon',
      type: 'button',
      title: 'Nghe phát âm',
      'aria-label': `Nghe phát âm ${item.word}`,
      onclick: (e) => {
        e.stopPropagation();
        if (!speakable(item.word)) {
          toast('Trình duyệt không hỗ trợ phát âm.', 'error');
          return;
        }
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
    item.hsk || item.topic
      ? el('div', { class: 'fc-tags' }, [
          item.hsk ? el('span', { class: 'tag tag-blue' }, labelHsk(item.hsk)) : null,
          item.topic ? el('span', { class: 'tag tag-green' }, labelTopic(item.topic)) : null,
        ])
      : null,
    item.example || item.example_meaning
      ? el('div', { class: 'fc-example' }, [
          item.example ? el('div', { class: 'han', lang: 'zh' }, item.example) : null,
          item.example_pinyin ? el('div', { class: 'pinyin-line' }, item.example_pinyin) : null,
          item.example_meaning ? el('div', { class: 'vi-line' }, item.example_meaning) : null,
          item.example && speakable(item.example)
            ? el('button', {
                class: 'btn btn-ghost btn-sm',
                type: 'button',
                onclick: (e) => {
                  e.stopPropagation();
                  speak(item.example);
                },
              }, '🔊 Nghe câu')
            : null,
        ])
      : null,
  ]);

  card.append(el('div', { class: 'flashcard-inner' }, [front, back]));
  front.addEventListener('click', () => revealAnswer());
  card.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      revealAnswer();
    }
  });
  host.appendChild(card);

  host.appendChild(
    current.revealed
      ? ratingGrid()
      : el('div', { class: 'flashcard-actions' }, [
          el('button', { class: 'btn btn-primary btn-lg', type: 'button', id: 'reveal-btn', onclick: revealAnswer }, 'Xem đáp án'),
        ]),
  );

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
  return el('div', { class: 'card empty-state' }, [
    el('h2', {}, plan.counts.newAvailable ? 'Đã hết từ cần ôn hôm nay' : 'Kho từ đang trống'),
    el('p', { class: 'muted' }, plan.counts.newAvailable
      ? `Còn ${plan.counts.newAvailable} từ mới chưa phân bổ (giới hạn từ mới/ngày: ${state.settings?.new_words_per_day ?? 10}).`
      : 'Hãy nhập CSV hoặc thêm từ ở trang Kho từ vựng để bắt đầu học.'),
    el('div', { class: 'review-done-actions' }, [
      el('a', { class: 'btn btn-primary', href: '#vocabulary' }, 'Mở kho từ vựng'),
      el('a', { class: 'btn btn-outline', href: '#import' }, 'Nhập CSV'),
    ]),
  ]);
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
  if (card) {
    card.dataset.flipped = 'true';
    card.setAttribute('aria-label', `Đáp án của ${current.items[current.index]?.word || ''}`);
  }
  document.getElementById('reveal-btn')?.remove();

  const host = body();
  if (host && !document.getElementById('rating-grid')) {
    const grid = ratingGrid();
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
      try {
        previous = await startLearning(item.id);
        item.progress = previous;
      } catch (error) {
        // RPC record_review vẫn tự upsert nếu bước này thất bại.
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
    saveError = null;
    persist();
    render();
    markSessionProgress();
  } catch (error) {
    current.saving = false;
    saveError = getErrorMessage(error);
    document.querySelectorAll('.rating-btn').forEach((b) => (b.disabled = false));
    toast(`Chưa lưu được đánh giá: ${saveError}`, 'error', 5000);
  }
}

function sessionPayload(completed) {
  const s = statsOf();
  return {
    sessionDate: current.dayKey,
    counts: {
      newInQueue: current.counts?.newInQueue || 0,
      dueInQueue: current.counts?.dueInQueue || 0,
      backlogInQueue: current.counts?.backlogInQueue || 0,
      completed: s.done,
    },
    status: completed ? 'completed' : 'in_progress',
    startedAt: current.startedAt,
    completedAt: completed ? new Date().toISOString() : null,
  };
}

async function markSessionProgress() {
  try {
    await markSession(sessionPayload(statsOf().done >= current.items.length));
  } catch (error) {
    console.warn('markSession failed', error);
  }
}

let finalized = false;
async function finalizeSession() {
  if (finalized) return;
  finalized = true;
  try {
    await markSession(sessionPayload(true));
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
    saveError = null;
    toast(`Đã đưa “${row.word}” vào danh sách ôn tập.`, 'success');
  } catch (error) {
    toast(getErrorMessage(error), 'error');
  }
}

/** Bắt đầu học hôm nay (trang chủ / menu). */
export function startToday() {
  invalidateQueue();
  current = null;
  saveError = null;
  resetFinalizeFlag();
  mounted = true;
  if (location.hash !== '#review') {
    location.hash = '#review';
    return; // hashchange → navigate() sẽ render
  }
  restoreOrBuildQueue();
  render();
}
