import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scheduleReview,
  buildDailyQueue,
  buildCalendar,
  classify,
  localDayKey,
  countBacklog,
  freshProgress,
} from '../js/scheduler.js';

const DAY = 24 * 60 * 60 * 1000;
const base = new Date('2026-11-05T08:00:00.000Z');

test('khoảng cách ban đầu: Chưa nhớ 10 phút, Khó nhớ 1 ngày, Đã nhớ 3 ngày, Rất dễ 7 ngày', () => {
  const again = scheduleReview(null, 'again', base);
  assert.equal(again.interval_days, 0.0069);
  assert.equal(new Date(again.next_review_at).getTime() - base.getTime(), 10 * 60 * 1000);

  const hard = scheduleReview(null, 'hard', base);
  assert.equal(new Date(hard.next_review_at).getTime() - base.getTime(), DAY);

  const good = scheduleReview(null, 'good', base);
  assert.equal(new Date(good.next_review_at).getTime() - base.getTime(), 3 * DAY);

  const easy = scheduleReview(null, 'easy', base);
  assert.equal(new Date(easy.next_review_at).getTime() - base.getTime(), 7 * DAY);
});

test('Lượt đánh giá đầu tiên đặt first_learned_at, review_count = 1', () => {
  const p = scheduleReview(null, 'good', base);
  assert.equal(p.review_count, 1);
  assert.equal(p.correct_count, 1);
  assert.equal(p.incorrect_count, 0);
  assert.equal(p.first_learned_at, base.toISOString());
  assert.equal(p.status, 'review');
});

test('Chưa nhớ: reset repetition, tăng incorrect_count, giảm EF', () => {
  const first = scheduleReview(null, 'good', base);
  const again = scheduleReview(first, 'again', new Date(base.getTime() + 3 * DAY));
  assert.equal(again.repetition, 0);
  assert.equal(again.status, 'learning');
  assert.equal(again.review_count, 2);
  assert.equal(again.incorrect_count, 1);
  assert.equal(again.correct_count, 1);
  assert.ok(again.easiness_factor < first.easiness_factor);
  assert.equal(new Date(again.next_review_at).getTime() - (base.getTime() + 3 * DAY), 10 * 60 * 1000);
});

test('SM-2: Đã nhớ lặp lại tăng khoảng cách theo easiness factor', () => {
  let p = scheduleReview(null, 'good', base);
  const intervals = [p.interval_days];
  let now = new Date(p.next_review_at);
  for (let i = 0; i < 4; i += 1) {
    p = scheduleReview(p, 'good', now);
    intervals.push(p.interval_days);
    now = new Date(p.next_review_at);
  }
  for (let i = 1; i < intervals.length; i += 1) {
    assert.ok(intervals[i] > intervals[i - 1], `interval phải tăng: ${intervals}`);
  }
  assert.ok(p.status === 'mastered' || p.interval_days >= 21);
});

test('Rất dễ: khoảng cách dài hơn Đã nhớ, EF tăng', () => {
  const good = scheduleReview(null, 'good', base);
  const easy = scheduleReview(null, 'easy', base);
  assert.ok(easy.interval_days > good.interval_days);
  assert.ok(easy.easiness_factor > 2.5);
});

test('EF không giảm dưới 1.3', () => {
  let p = null;
  let now = base;
  for (let i = 0; i < 20; i += 1) {
    p = scheduleReview(p, 'again', now);
    now = new Date(p.next_review_at);
  }
  assert.equal(p.easiness_factor, 1.3);
});

test('không mutate object progress cũ', () => {
  const prev = {
    ...freshProgress(),
    status: 'review',
    repetition: 2,
    last_reviewed_at: base.toISOString(),
    interval_days: 3,
    next_review_at: base.toISOString(),
  };
  const snapshot = JSON.stringify(prev);
  scheduleReview(prev, 'good', base);
  assert.equal(JSON.stringify(prev), snapshot);
});

function row(id, extra = {}) {
  return {
    id,
    word: `w${id}`,
    created_at: new Date(base.getTime() - 1000 * (Number(id.replace(/\D/g, '')) || 0)).toISOString(),
    progress: null,
    ...extra,
  };
}

test('phân loại new / due / backlog / scheduled', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  assert.equal(classify(row('1'), now).bucket, 'new');
  assert.equal(
    classify(
      row('2', {
        progress: { last_reviewed_at: now.toISOString(), next_review_at: new Date(now.getTime() - 60000).toISOString() },
      }),
      now,
    ).bucket,
    'due',
  );
  assert.equal(
    classify(row('3', { progress: { last_reviewed_at: now.toISOString(), next_review_at: '2026-11-01T10:00:00Z' } }), now)
      .bucket,
    'backlog',
  );
  assert.equal(
    classify(row('4', { progress: { last_reviewed_at: now.toISOString(), next_review_at: '2026-11-09T10:00:00Z' } }), now)
      .bucket,
    'scheduled',
  );
});

test('buildDailyQueue: thứ tự từ cũ → tồn đọng → từ mới, không trùng từ', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const rows = [
    row('1', { progress: { last_reviewed_at: '2026-11-01T10:00:00Z', next_review_at: '2026-11-03T10:00:00Z' } }),
    row('2', { progress: { last_reviewed_at: '2026-11-01T10:00:00Z', next_review_at: '2026-11-05T09:00:00Z' } }),
    row('3'),
    row('4'),
    row('5'),
    row('6', { progress: { last_reviewed_at: '2026-11-05T09:00:00Z', next_review_at: '2026-11-20T10:00:00Z' } }),
  ];
  const { items, counts } = buildDailyQueue(rows, { new_words_per_day: 2, max_words_per_day: 30 }, now);
  assert.equal(items[0].id, '2');
  assert.equal(items[1].id, '1');
  assert.deepEqual(items.map((i) => i.bucket), ['due', 'backlog', 'new', 'new']);
  assert.equal(counts.total, 4);
  assert.ok(!items.some((i) => i.id === '6'));
  const ids = items.map((i) => i.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('buildDailyQueue: tổng vượt giới hạn → ưu tiên từ cũ, cắt từ mới, không tăng chỉ tiêu', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const rows = [];
  for (let i = 1; i <= 25; i += 1) {
    rows.push(
      row(`d${i}`, { progress: { last_reviewed_at: '2026-11-01T10:00:00Z', next_review_at: '2026-11-05T09:00:00Z' } }),
    );
  }
  for (let i = 1; i <= 20; i += 1) rows.push(row(`n${i}`));

  const { items, counts, deferredNew } = buildDailyQueue(rows, { new_words_per_day: 10, max_words_per_day: 30 }, now);
  assert.equal(items.length, 30);
  assert.equal(counts.dueInQueue, 25);
  assert.equal(counts.newInQueue, 5);
  assert.equal(deferredNew, 5);
  assert.equal(items.filter((i) => i.bucket === 'new').length, 5);

  const tight = buildDailyQueue(rows, { new_words_per_day: 10, max_words_per_day: 20 }, now);
  assert.equal(tight.items.length, 20);
  assert.equal(tight.counts.dueInQueue, 20);
  assert.equal(tight.counts.newInQueue, 0);
});

test('buildDailyQueue: từ mới chưa phân bổ vẫn ở trạng thái new (không bị đánh dấu đã học)', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const rows = [];
  for (let i = 1; i <= 50; i += 1) rows.push(row(`n${i}`));
  buildDailyQueue(rows, { new_words_per_day: 10, max_words_per_day: 30 }, now);
  assert.ok(rows.every((r) => r.progress === null));
});

test('ngày không học → ngày sau tự động tính lại và trở thành tồn đọng', () => {
  const day1 = new Date('2026-11-01T10:00:00Z');
  const p = scheduleReview(null, 'good', day1);
  const rows = [row('1', { progress: p })];
  const day5 = new Date('2026-11-05T10:00:00Z');
  assert.equal(countBacklog(rows, day5), 1);
  const plan = buildDailyQueue(rows, { new_words_per_day: 10, max_words_per_day: 30 }, day5);
  assert.equal(plan.counts.backlogInQueue, 1);
  assert.equal(plan.items[0].bucket, 'backlog');
});

test('localDayKey theo múi giờ Việt Nam', () => {
  const utcLate = new Date('2026-11-05T18:30:00Z');
  assert.equal(localDayKey(utcLate, 'Asia/Ho_Chi_Minh'), '2026-11-06');
  assert.equal(localDayKey(utcLate, 'UTC'), '2026-11-05');
});

test('buildCalendar trả trạng thái màu đúng', () => {
  const now = new Date('2026-11-05T10:00:00Z');
  const rows = [
    row('1', {
      progress: {
        first_learned_at: '2026-11-01T10:00:00Z',
        last_reviewed_at: '2026-11-01T10:00:00Z',
        next_review_at: '2026-11-02T10:00:00Z',
      },
    }),
    row('2', {
      progress: {
        first_learned_at: '2026-11-05T09:00:00Z',
        last_reviewed_at: '2026-11-04T09:00:00Z',
        next_review_at: '2026-11-05T09:30:00Z',
      },
    }),
    row('3', {
      progress: {
        first_learned_at: '2026-11-05T09:00:00Z',
        last_reviewed_at: '2026-11-05T09:00:00Z',
        next_review_at: '2026-11-09T09:00:00Z',
      },
    }),
  ];
  const start = new Date('2026-11-01T00:00:00Z');
  const end = new Date('2026-11-10T00:00:00Z');
  const days = buildCalendar(rows, start, end, 'UTC', now);
  assert.equal(days.get('2026-11-02').status, 'backlog');
  assert.equal(days.get('2026-11-05').status, 'needs_review');
  assert.equal(days.get('2026-11-05').learned, 2);
  assert.equal(days.get('2026-11-05').due, 1);
  // Ngày chưa đến (09/11) trong lưới tháng được đánh dấu xám (future).
  assert.equal(days.get('2026-11-09').status, 'future');
});

test('scheduleReview từ chối rating không hợp lệ', () => {
  assert.throws(() => scheduleReview(null, 'perfect', base));
});
