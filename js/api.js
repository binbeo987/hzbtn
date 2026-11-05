/* =============================================================================
 * api.js - Toàn bộ truy vấn dữ liệu (chế độ 1 người dùng, không đăng nhập).
 * Mọi thao tác đi qua RPC trong database/rls.sql; frontend KHÔNG đọc/ghi bảng
 * trực tiếp nên không cần RLS theo người dùng.
 * ============================================================================= */

import { rpc } from './supabase.js';
import { chunk } from './ui.js';

const VOCAB_COLUMNS = [
  'word',
  'pinyin',
  'pos',
  'meaning',
  'hsk',
  'topic',
  'example',
  'example_pinyin',
  'example_meaning',
];

function stripEmpty(vocab) {
  const row = {};
  for (const key of VOCAB_COLUMNS) {
    row[key] = vocab[key] === null || vocab[key] === undefined ? '' : String(vocab[key]).trim();
  }
  return row;
}

/* -------------------------------------------------------------------------- */
/* VOCABULARY                                                                  */
/* -------------------------------------------------------------------------- */

/** Tìm theo Hán tự / pinyin (bỏ dấu) / nghĩa, lọc HSK/chủ đề ở DB. */
export async function searchVocabulary(query, { limit = 30, offset = 0, hsk = '', topic = '' } = {}) {
  const data = await rpc('search_vocabulary', {
    p_query: query,
    p_limit: limit,
    p_offset: offset,
    p_hsk: hsk || null,
    p_topic: topic || null,
  });
  return data || [];
}

/** Một trang kho từ vựng. Khi có `search` thì dùng RPC tìm kiếm để phân trang đúng. */
export async function listVocabularyPage({ limit = 50, offset = 0, hsk = '', topic = '', sort = 'newest', search = '' } = {}) {
  if (search) {
    const rows = await searchVocabulary(search, { limit, offset, hsk, topic });
    const sorted = sortRows(rows, sort);
    return { rows: sorted, count: offset + rows.length + (rows.length === limit ? 1 : 0), approximate: rows.length === limit };
  }

  // Không có từ khóa: lấy từ danh sách gọn rồi lọc + phân trang trên client
  // (dữ liệu cá nhân thường vài nghìn từ, tải một lần là đủ nhanh).
  const all = await listAllVocabulary();
  const filtered = all.filter((r) => (!hsk || r.hsk === hsk) && (!topic || r.topic === topic));
  const sorted = sortRows(filtered, sort);
  return { rows: sorted.slice(offset, offset + limit), count: sorted.length };
}

function sortRows(rows, sort) {
  const copy = [...rows];
  if (sort === 'word') copy.sort((a, b) => String(a.word).localeCompare(String(b.word), 'zh'));
  else if (sort === 'oldest') copy.sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
  else copy.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  return copy;
}

export async function listAllVocabulary() {
  const data = await rpc('get_study_rows');
  return (data || []).map(({ progress, ...row }) => row);
}

export async function insertVocabulary(rows) {
  if (!rows.length) return [];
  const result = await rpc('import_vocabulary', { p_rows: rows.map(stripEmpty), p_mode: 'update' });
  return (result || []).map((r) => ({ id: r.id }));
}

export async function updateVocabulary(id, patch) {
  // Upsert theo khóa word: ghi đè nội dung, giữ nguyên learning_progress.
  const result = await rpc('import_vocabulary', { p_rows: [stripEmpty(patch)], p_mode: 'update' });
  const newId = result?.[0]?.id;
  if (!newId) throw new Error('Không cập nhật được từ vựng.');
  const rows = await rpc('get_study_rows');
  const { progress, ...row } = (rows || []).find((r) => r.id === newId) || {};
  return { ...row, id: newId };
}

export async function deleteVocabulary(ids) {
  for (const part of chunk([].concat(ids), 200)) {
    await rpc('delete_vocabulary', { p_ids: part });
  }
}

export async function getVocabulary(id) {
  const rows = await rpc('get_study_rows');
  const item = (rows || []).find((r) => r.id === id);
  if (!item) return null;
  const { progress, ...row } = item;
  return row;
}

/* -------------------------------------------------------------------------- */
/* FAVORITES                                                                   */
/* -------------------------------------------------------------------------- */

export async function toggleFavorite(vocabularyId, favorite) {
  const data = await rpc('toggle_favorite', { p_vocabulary_id: vocabularyId, p_favorite: Boolean(favorite) });
  return data || { favorite: Boolean(favorite) };
}

export async function removeFavorite(vocabularyId) {
  await toggleFavorite(vocabularyId, false);
}

export async function listFavorites() {
  const data = await rpc('get_backup');
  return (data?.favorites) || [];
}

/* -------------------------------------------------------------------------- */
/* REVIEW + PROGRESS                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Ghi nhận một lượt ôn nguyên tử (review_records + learning_progress).
 * Dữ liệu SM-2 do client tính (js/scheduler.js) để mọi thiết bị ra cùng kết quả.
 */
export async function recordReview({ vocabularyId, rating, previousNextReviewAt, schedule }) {
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw new Error(`Rating không hợp lệ: ${rating}`);
  const data = await rpc('record_review', {
    p_vocabulary_id: vocabularyId,
    p_rating: rating,
    p_previous_next_review: previousNextReviewAt || null,
    p_new_next_review: schedule.next_review_at,
    p_status: schedule.status,
    p_interval_days: schedule.interval_days,
    p_repetition: schedule.repetition,
    p_easiness_factor: schedule.easiness_factor,
    p_review_count: schedule.review_count,
    p_correct_count: schedule.correct_count,
    p_incorrect_count: schedule.incorrect_count,
  });
  return Array.isArray(data) ? data[0] : data;
}

/** Lượt học đầu tiên cho từ mới. */
export async function startLearning(vocabularyId) {
  const data = await rpc('start_learning', { p_vocabulary_id: vocabularyId });
  return Array.isArray(data) ? data[0] : data;
}

/** Đưa một từ vào danh sách ôn ngay hôm nay. */
export async function queueForReview(vocabularyId) {
  const data = await rpc('queue_for_review', { p_vocabulary_id: vocabularyId });
  return Array.isArray(data) ? data[0] : data;
}

/* -------------------------------------------------------------------------- */
/* DAILY SESSIONS                                                              */
/* -------------------------------------------------------------------------- */

export async function markSession({ sessionDate, counts, status, startedAt = null, completedAt = null }) {
  const data = await rpc('mark_session', {
    p_session_date: sessionDate,
    p_new_words_count: counts.newInQueue ?? counts.new ?? 0,
    p_due_words_count: counts.dueInQueue ?? counts.due ?? 0,
    p_backlog_count: counts.backlogInQueue ?? counts.backlog ?? 0,
    p_completed_count: counts.completed ?? 0,
    p_status: status,
    p_started_at: startedAt,
    p_completed_at: completedAt,
  });
  return Array.isArray(data) ? data[0] : data;
}

export async function listSessions() {
  const data = await rpc('get_backup');
  return (data?.daily_sessions) || [];
}

export async function listReviewRecords() {
  const data = await rpc('get_backup');
  return (data?.review_records) || [];
}

export async function listProgress() {
  const data = await rpc('get_backup');
  return (data?.learning_progress) || [];
}

/* -------------------------------------------------------------------------- */
/* SETTINGS                                                                    */
/* -------------------------------------------------------------------------- */

export async function updateSettings(patch) {
  const newWords = Number(patch.new_words_per_day);
  const maxWords = Number(patch.max_words_per_day);
  if (maxWords < newWords) throw new Error('Tổng số từ tối đa phải lớn hơn hoặc bằng số từ mới mỗi ngày.');
  const data = await rpc('update_settings', {
    p_new_words_per_day: newWords,
    p_max_words_per_day: maxWords,
    p_preferred_study_time: patch.preferred_study_time || null,
    p_timezone: patch.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  });
  return Array.isArray(data) ? data[0] : data;
}

/* -------------------------------------------------------------------------- */
/* IMPORT                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Import theo batch (RPC upsert ở DB).
 * - mode 'skip'  : bỏ qua từ đã tồn tại
 * - mode 'update': cập nhật nội dung từ đã tồn tại, KHÔNG chạm learning_progress
 */
export async function importVocabulary({ rows, mode, batchSize = 500, existingWordIds, onProgress }) {
  const inserted = [];
  const updated = [];
  const skipped = [];
  const failed = [];
  const total = rows.length;
  let processed = 0;

  for (const batch of chunk(rows, batchSize)) {
    try {
      const result = await rpc('import_vocabulary', {
        p_rows: batch.map(stripEmpty),
        p_mode: mode === 'update' ? 'update' : 'skip',
      });
      const byWord = new Map();
      for (const item of result || []) byWord.set(item.idx, item.id);
      batch.forEach((item, i) => {
        const id = byWord.get(i);
        const existed = existingWordIds?.has(item.word);
        if (mode === 'skip' && existed) skipped.push({ ...item, id });
        else if (existed) updated.push({ ...item, id });
        else inserted.push({ ...item, id });
      });
    } catch (error) {
      for (const item of batch) failed.push({ ...item, error: error.message });
    }
    processed += batch.length;
    onProgress?.({ processed, total });
    await new Promise((r) => setTimeout(r, 0));
  }

  return {
    inserted,
    updated,
    skipped,
    failed,
    summary: {
      total,
      inserted: inserted.length,
      updated: updated.length,
      skipped: skipped.length,
      failed: failed.length,
    },
  };
}

export async function findExistingWords(words) {
  if (!words.length) return new Map();
  const rows = await rpc('get_study_rows');
  const targets = new Set(words);
  const map = new Map();
  for (const row of rows || []) if (targets.has(row.word)) map.set(row.word, row.id);
  return map;
}

/* -------------------------------------------------------------------------- */
/* BACKUP / RESTORE                                                            */
/* -------------------------------------------------------------------------- */

/** Xuất toàn bộ dữ liệu dưới dạng object (JSON) — 1 lần gọi RPC. */
export async function getFullBackup() {
  const data = await rpc('get_backup');
  return {
    app: 'han-ngu',
    version: '1.1.0',
    exported_at: data?.exported_at || new Date().toISOString(),
    settings: data?.settings || null,
    vocabulary: data?.vocabulary || [],
    learning_progress: data?.learning_progress || [],
    review_records: data?.review_records || [],
    daily_sessions: data?.daily_sessions || [],
    favorites: data?.favorites || [],
  };
}

export async function restoreBackup(data) {
  return rpc('restore_backup', { p_data: data });
}

export async function deleteAllUserData() {
  await rpc('delete_all_data');
}
