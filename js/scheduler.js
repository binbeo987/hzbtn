/* =============================================================================
 * scheduler.js - Thuật toán spaced repetition (SM-2 cải tiến) + tính buổi học
 * Module thuần JS, không phụ thuộc DOM/Supabase → có thể test bằng Node.
 * ============================================================================= */

export const RATINGS = ['again', 'hard', 'good', 'easy'];

export const RATING_LABELS = {
  again: 'Chưa nhớ',
  hard: 'Khó nhớ',
  good: 'Đã nhớ',
  easy: 'Rất dễ',
};

export const FIRST_INTERVALS = {
  again: 10 / 1440, // 10 phút
  hard: 1, // 1 ngày
  good: 3, // 3 ngày
  easy: 7, // 7 ngày
};

export const EF_MIN = 1.3;
export const EF_DEFAULT = 2.5;
export const MASTERED_INTERVAL_DAYS = 21;
export const MASTERED_REPETITION = 5;
export const MINUTE_MS = 60 * 1000;
export const DAY_MS = 24 * 60 * MINUTE_MS;

/** Hồ sơ mới cho một từ chưa có learning_progress. */
export function freshProgress() {
  return {
    status: 'new',
    first_learned_at: null,
    last_reviewed_at: null,
    next_review_at: null,
    review_count: 0,
    correct_count: 0,
    incorrect_count: 0,
    repetition: 0,
    easiness_factor: EF_DEFAULT,
    interval_days: 0,
  };
}

function round(value, digits = 4) {
  const p = Math.pow(10, digits);
  return Math.round(value * p) / p;
}

export function addMinutes(date, minutes) {
  return new Date(date.getTime() + minutes * MINUTE_MS);
}

export function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * Tính lịch ôn tiếp theo sau một đánh giá (SM-2 cải tiến).
 * Không sửa object đầu vào, trả về dữ liệu đầy đủ để lưu vào learning_progress.
 */
export function scheduleReview(previous, rating, now = new Date()) {
  if (!RATINGS.includes(rating)) {
    throw new Error(`Unknown rating: ${rating}`);
  }

  const prev = { ...freshProgress(), ...(previous || {}) };
  const prevEf = Number(prev.easiness_factor);
  let ef = Number.isFinite(prevEf) && prevEf > 0 ? prevEf : EF_DEFAULT;
  let repetition = Number(prev.repetition) || 0;
  const previousInterval = Number(prev.interval_days) || 0;
  const isFirstReview = !prev.last_reviewed_at;

  let intervalDays;
  let exactMinutes = null;
  if (rating === 'again') {
    repetition = 0;
    ef -= 0.2;
    intervalDays = FIRST_INTERVALS.again;
    exactMinutes = 10;
  } else if (isFirstReview) {
    repetition += 1;
    intervalDays = FIRST_INTERVALS[rating];
    if (rating === 'hard') ef -= 0.15;
    if (rating === 'easy') ef += 0.15;
  } else if (rating === 'hard') {
    repetition += 1;
    ef -= 0.15;
    intervalDays = Math.max(previousInterval * 1.2, FIRST_INTERVALS.hard);
  } else if (rating === 'good') {
    repetition += 1;
    intervalDays = Math.max(previousInterval * ef, previousInterval + 1);
  } else {
    repetition += 1;
    ef += 0.15;
    intervalDays = Math.max(previousInterval * ef * 1.3, previousInterval + 2);
  }

  ef = round(Math.max(EF_MIN, ef), 2);
  intervalDays = round(intervalDays, 4);

  let status;
  if (rating === 'again') status = 'learning';
  else if (intervalDays >= MASTERED_INTERVAL_DAYS && repetition >= MASTERED_REPETITION) status = 'mastered';
  else if (rating === 'good' || rating === 'easy') status = 'review';
  else status = 'learning';

  const isCorrect = rating === 'good' || rating === 'easy';
  // "Chưa nhớ" cộng chính xác 10 phút; các trường hợp khác cộng từ interval_days.
  const nextReviewAt = new Date(
    now.getTime() + (exactMinutes !== null ? exactMinutes * MINUTE_MS : intervalDays * DAY_MS),
  );

  return {
    status,
    first_learned_at: prev.first_learned_at || now.toISOString(),
    last_reviewed_at: now.toISOString(),
    next_review_at: nextReviewAt.toISOString(),
    review_count: (Number(prev.review_count) || 0) + 1,
    correct_count: (Number(prev.correct_count) || 0) + (isCorrect ? 1 : 0),
    incorrect_count: (Number(prev.incorrect_count) || 0) + (isCorrect ? 0 : 1),
    repetition,
    easiness_factor: ef,
    interval_days: intervalDays,
  };
}

/**
 * Phân loại một từ trong hàng đợi:
 *  - new       : chưa có learning_progress (chưa hoàn thành lượt Flashcard đầu)
 *  - due       : từ cũ đến hạn hôm nay
 *  - backlog   : từ tồn đọng (đến hạn từ ngày trước, theo giờ địa phương)
 *  - scheduled : chưa đến hạn
 */
export function classify(row, now = new Date(), timeZone = undefined) {
  const progress = row.progress || null;
  if (!progress || !progress.last_reviewed_at) return { bucket: 'new', nextReviewAt: null };
  const next = progress.next_review_at ? new Date(progress.next_review_at) : null;
  if (!next || !Number.isFinite(next.getTime())) return { bucket: 'scheduled', nextReviewAt: null };
  if (next.getTime() > now.getTime()) return { bucket: 'scheduled', nextReviewAt: next };
  const dueDay = localDayKey(next, timeZone);
  const todayDay = localDayKey(now, timeZone);
  return { bucket: dueDay < todayDay ? 'backlog' : 'due', nextReviewAt: next };
}

/** YYYY-MM-DD theo múi giờ địa phương (hoặc timeZone chỉ định). */
export function localDayKey(date, timeZone = undefined) {
  const d = date instanceof Date ? date : new Date(date);
  if (timeZone) {
    try {
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).formatToParts(d);
      const get = (t) => parts.find((p) => p.type === t)?.value;
      return `${get('year')}-${get('month')}-${get('day')}`;
    } catch {
      // dùng giờ máy
    }
  }
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Lập danh sách từ cho buổi học hôm nay.
 * rows: [{ id, word, created_at, progress | null, ... }]
 * settings: { new_words_per_day, max_words_per_day }
 *
 * Thứ tự ưu tiên: từ cũ đến hạn → từ tồn đọng → từ mới.
 * Không lặp từ trong cùng buổi. Khi vượt giới hạn: ưu tiên từ cũ,
 * cắt phần từ mới; từ mới chưa được phân bổ vẫn ở trạng thái "new"
 * (chưa học) và sẽ được xét cho buổi sau. Không tự tăng chỉ tiêu từ mới.
 */
export function buildDailyQueue(rows, settings, now = new Date(), timeZone = undefined) {
  const newPerDay = Math.max(0, Number(settings?.new_words_per_day ?? 10));
  const maxPerDay = Math.max(1, Number(settings?.max_words_per_day ?? 30));

  const due = [];
  const backlog = [];
  const fresh = [];
  const seen = new Set();

  for (const row of rows) {
    const id = row.id || row.vocabulary_id;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const { bucket, nextReviewAt } = classify(row, now, timeZone);
    if (bucket === 'due') due.push({ row, nextReviewAt, bucket });
    else if (bucket === 'backlog') backlog.push({ row, nextReviewAt, bucket });
    else if (bucket === 'new') fresh.push({ row, nextReviewAt: null, bucket });
  }

  due.sort((a, b) => a.nextReviewAt - b.nextReviewAt || String(a.row.word).localeCompare(String(b.row.word)));

  // Tồn đọng: từ vừa trả lời sai (repetition = 0) lên trước, sau đó từ lâu không ôn.
  backlog.sort((a, b) => {
    const aWrong = a.row.progress?.repetition === 0 ? 0 : 1;
    const bWrong = b.row.progress?.repetition === 0 ? 0 : 1;
    if (aWrong !== bWrong) return aWrong - bWrong;
    return new Date(a.row.progress?.last_reviewed_at || 0) - new Date(b.row.progress?.last_reviewed_at || 0);
  });

  // Từ mới: theo thứ tự nạp vào kho; nếu cùng thời điểm thì theo id để ổn định.
  fresh.sort(
    (a, b) =>
      new Date(a.row.created_at || 0) - new Date(b.row.created_at || 0) ||
      String(a.row.id).localeCompare(String(b.row.id)),
  );

  const items = [];
  const take = (list, limit) => {
    for (const item of list) {
      if (items.length >= maxPerDay || limit <= 0) break;
      items.push({ ...item.row, bucket: item.bucket });
      limit -= 1;
    }
    return limit;
  };

  take(due, Infinity);
  take(backlog, Infinity);
  const remainingSlots = Math.max(0, maxPerDay - items.length);
  const newQuota = Math.min(newPerDay, remainingSlots);
  take(fresh, newQuota);

  const count = (b) => items.filter((i) => i.bucket === b).length;

  return {
    items,
    counts: {
      due: due.length,
      backlog: backlog.length,
      newAvailable: fresh.length,
      newInQueue: count('new'),
      dueInQueue: count('due'),
      backlogInQueue: count('backlog'),
      total: items.length,
    },
    deferredNew: Math.max(0, Math.min(newPerDay, fresh.length) - newQuota),
  };
}

/**
 * Thống kê lịch ôn cho một khoảng ngày.
 * Trả về Map dayKey -> { key, due, backlog, learned, reviewed, status, items }.
 * status: completed (xanh) | needs_review (vàng) | backlog (đỏ) | future (xám) | empty
 */
export function buildCalendar(rows, rangeStart, rangeEnd, timeZone = undefined, now = new Date()) {
  const days = new Map();
  const startKey = localDayKey(rangeStart, timeZone);
  const endKey = localDayKey(rangeEnd, timeZone);
  const inRange = (key) => key >= startKey && key <= endKey;

  const ensure = (key) => {
    if (!days.has(key)) {
      days.set(key, { key, due: 0, backlog: 0, learned: 0, reviewed: 0, status: 'future', items: [] });
    }
    return days.get(key);
  };

  for (const row of rows) {
    const p = row.progress;
    if (!p || !p.last_reviewed_at) continue;
    if (p.first_learned_at) {
      const k = localDayKey(new Date(p.first_learned_at), timeZone);
      if (inRange(k)) ensure(k).learned += 1;
    }
    if (p.next_review_at) {
      const dueKey = localDayKey(new Date(p.next_review_at), timeZone);
      if (inRange(dueKey)) {
        const day = ensure(dueKey);
        day.due += 1;
        day.items.push({ ...row, bucket: 'due' });
      }
      // Chỉ tính lượt ôn của từ khi từ đó đến hạn trong cùng ngày.
      const reviewedKey = localDayKey(new Date(p.last_reviewed_at), timeZone);
      if (inRange(reviewedKey) && reviewedKey === dueKey) ensure(reviewedKey).reviewed += 1;
    }
  }

  const todayKey = localDayKey(now, timeZone);

  for (const [key, day] of [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (key > todayKey) {
      day.status = 'future';
      continue;
    }
    const remaining = Math.max(0, day.due - day.reviewed);
    if (key < todayKey) {
      day.backlog = remaining;
      day.status = remaining > 0 ? 'backlog' : day.due > 0 || day.learned > 0 ? 'completed' : 'empty';
      continue;
    }
    day.backlog = 0;
    if (day.due > 0) day.status = day.reviewed >= day.due ? 'completed' : 'needs_review';
    else day.status = day.learned > 0 ? 'completed' : 'empty';
  }

  return days;
}

/** Số từ tồn đọng hiện tại (đã đến hạn trước hôm nay nhưng chưa ôn). */
export function countBacklog(rows, now = new Date(), timeZone = undefined) {
  let n = 0;
  for (const row of rows) {
    if (classify(row, now, timeZone).bucket === 'backlog') n += 1;
  }
  return n;
}

/** Tỷ lệ trả lời đúng (%) */
export function accuracy(progress) {
  const correct = Number(progress?.correct_count) || 0;
  const total = correct + (Number(progress?.incorrect_count) || 0);
  if (!total) return 0;
  return Math.round((correct / total) * 100);
}

/** Nhãn mô tả khoảng cách ôn tiếp theo. */
export function formatNextReview(iso, now = new Date()) {
  if (!iso) return 'Chưa lên lịch';
  const next = new Date(iso);
  const diff = next.getTime() - now.getTime();
  if (diff <= 0) return 'Đã đến hạn';
  const minutes = Math.round(diff / MINUTE_MS);
  if (minutes < 60) return `${minutes} phút nữa`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} giờ nữa`;
  return `${Math.round(hours / 24)} ngày nữa`;
}
