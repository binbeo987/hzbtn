/* =============================================================================
 * api.js - Tất cả truy vấn Supabase (tách khỏi UI)
 * ============================================================================= */

import { getClient } from './supabase.js';
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

function client() {
  return getClient();
}

function assertRate(rating) {
  if (!['again', 'hard', 'good', 'easy'].includes(rating)) throw new Error(`Rating không hợp lệ: ${rating}`);
}

function stripEmpty(vocab) {
  const row = {};
  for (const key of VOCAB_COLUMNS) {
    const value = vocab[key] === null || vocab[key] === undefined ? '' : String(vocab[key]).trim();
    row[key] = value;
  }
  return row;
}

/* -------------------------------------------------------------------------- */
/* VOCABULARY                                                                  */
/* -------------------------------------------------------------------------- */

export async function searchVocabulary(query, { limit = 30, offset = 0 } = {}) {
  const { data, error } = await client().rpc('search_vocabulary', {
    p_query: query,
    p_limit: limit,
    p_offset: offset,
  });
  if (error) throw error;
  return data || [];
}

export async function countVocabulary() {
  const { count, error } = await client().from('vocabulary').select('id', { count: 'exact', head: true });
  if (error) throw error;
  return count || 0;
}

export async function listVocabularyPage({ limit = 50, offset = 0, hsk = '', topic = '', sort = 'newest' } = {}) {
  let query = client().from('vocabulary').select('*', { count: 'exact' });
  if (hsk) query = query.eq('hsk', hsk);
  if (topic) query = query.eq('topic', topic);
  switch (sort) {
    case 'word':
      query = query.order('word', { ascending: true });
      break;
    case 'oldest':
      query = query.order('created_at', { ascending: true });
      break;
    default:
      query = query.order('created_at', { ascending: false });
  }
  const { data, error, count } = await query.range(offset, offset + limit - 1);
  if (error) throw error;
  return { rows: data || [], count: count || 0 };
}

export async function listAllVocabulary({ columns = '*', pageSize = 1000, onPage } = {}) {
  const all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client()
      .from('vocabulary')
      .select(columns)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all.push(...(data || []));
    onPage?.(all.length);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function getVocabulary(id) {
  const { data, error } = await client().from('vocabulary').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return data;
}

export async function getVocabularyByWords(words) {
  if (!words.length) return [];
  let query = client().from('vocabulary').select('id,word').in('word', words);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function insertVocabulary(rows) {
  if (!rows.length) return [];
  const payload = rows.map(stripEmpty);
  const { data, error } = await client().from('vocabulary').insert(payload).select('id,word');
  if (error) throw error;
  return data || [];
}

export async function updateVocabulary(id, patch) {
  const payload = stripEmpty({ ...patch });
  const { data, error } = await client().from('vocabulary').update(payload).eq('id', id).select('*').single();
  if (error) throw error;
  return data;
}

export async function deleteVocabulary(ids) {
  const list = [].concat(ids);
  for (const part of chunk(list, 200)) {
    const { error } = await client().from('vocabulary').delete().in('id', part);
    if (error) throw error;
  }
}

export async function updateVocabularyBatch(rows) {
  // Upsert để "bỏ qua" cũng có thể xử lý idempotent khi import lại.
  const payload = rows.map(stripEmpty);
  const { error } = await client().from('vocabulary').upsert(payload, { onConflict: 'user_id,word' });
  if (error) throw error;
}

/* -------------------------------------------------------------------------- */
/* FAVORITES                                                                   */
/* -------------------------------------------------------------------------- */

export async function addFavorite(vocabularyId) {
  const { error } = await client()
    .from('favorites')
    .upsert({ vocabulary_id: vocabularyId }, { onConflict: 'user_id,vocabulary_id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function removeFavorite(vocabularyId) {
  const { error } = await client().from('favorites').delete().eq('vocabulary_id', vocabularyId);
  if (error) throw error;
}

/* -------------------------------------------------------------------------- */
/* REVIEW + PROGRESS                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Ghi nhận một lượt ôn nguyên tử (review_records + learning_progress)
 * thông qua RPC record_review. Dữ liệu SM-2 do client tính (js/scheduler.js).
 */
export async function recordReview({ vocabularyId, rating, previousNextReviewAt, schedule }) {
  assertRate(rating);
  const { data, error } = await client().rpc('record_review', {
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
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

/** Lượt học đầu tiên cho từ mới nằm ngoài hàng đợi (thêm từ khóa tay). */
export async function startLearning(vocabularyId) {
  const { data, error } = await client()
    .from('learning_progress')
    .upsert(
      {
        vocabulary_id: vocabularyId,
        status: 'new',
        next_review_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,vocabulary_id' },
    )
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Đưa một từ (bất kỳ) vào danh sách ôn ngay hôm nay. */
export async function queueForReview(vocabularyId) {
  const now = new Date().toISOString();
  const { data, error } = await client()
    .from('learning_progress')
    .upsert({ vocabulary_id: vocabularyId, status: 'new', next_review_at: now }, { onConflict: 'user_id,vocabulary_id' })
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function listProgress({ pageSize = 1000 } = {}) {
  const all = [];
  let from = 0;
  for (;;) {
    const { data, error } = await client()
      .from('learning_progress')
      .select('*')
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

export async function listReviewRecords({ fromIso, toIso, pageSize = 1000 } = {}) {
  const all = [];
  let from = 0;
  for (;;) {
    let query = client()
      .from('review_records')
      .select('id,vocabulary_id,rating,reviewed_at,previous_next_review_at,new_next_review_at')
      .order('reviewed_at', { ascending: true })
      .range(from, from + pageSize - 1);
    if (fromIso) query = query.gte('reviewed_at', fromIso);
    if (toIso) query = query.lt('reviewed_at', toIso);
    const { data, error } = await query;
    if (error) throw error;
    all.push(...(data || []));
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }
  return all;
}

/* -------------------------------------------------------------------------- */
/* DAILY SESSIONS                                                              */
/* -------------------------------------------------------------------------- */

export async function markSession({ sessionDate, counts, status, startedAt = null, completedAt = null }) {
  const { data, error } = await client().rpc('mark_session', {
    p_session_date: sessionDate,
    p_new_words_count: counts.newInQueue ?? counts.new ?? 0,
    p_due_words_count: counts.dueInQueue ?? counts.due ?? 0,
    p_backlog_count: counts.backlogInQueue ?? counts.backlog ?? 0,
    p_completed_count: counts.completed ?? 0,
    p_status: status,
    p_started_at: startedAt,
    p_completed_at: completedAt,
  });
  if (error) throw error;
  return Array.isArray(data) ? data[0] : data;
}

export async function listSessions({ fromDate, toDate } = {}) {
  let query = client().from('daily_sessions').select('*').order('session_date', { ascending: true });
  if (fromDate) query = query.gte('session_date', fromDate);
  if (toDate) query = query.lte('session_date', toDate);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/* -------------------------------------------------------------------------- */
/* SETTINGS                                                                    */
/* -------------------------------------------------------------------------- */

export async function updateSettings(patch) {
  const payload = {
    new_words_per_day: Number(patch.new_words_per_day),
    max_words_per_day: Number(patch.max_words_per_day),
    preferred_study_time: patch.preferred_study_time || null,
    timezone: patch.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
  if (payload.max_words_per_day < payload.new_words_per_day) {
    throw new Error('Tổng số từ tối đa phải lớn hơn hoặc bằng số từ mới mỗi ngày.');
  }
  const { data: session } = await client().auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) throw new Error('Chưa có phiên đăng nhập.');
  const { data, error } = await client()
    .from('learning_settings')
    .update(payload)
    .eq('user_id', userId)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/* -------------------------------------------------------------------------- */
/* IMPORT                                                                      */
/* -------------------------------------------------------------------------- */

/** Lấy danh sách id của các từ đã tồn tại (theo khóa word). */
export async function findExistingWords(words) {
  const map = new Map();
  for (const part of chunk(words, 200)) {
    const { data, error } = await client().from('vocabulary').select('id,word').in('word', part);
    if (error) throw error;
    for (const row of data || []) map.set(row.word, row.id);
  }
  return map;
}

/**
 * Import theo batch.
 * - mode 'skip'   : bỏ qua từ đã tồn tại (chỉ insert từ mới)
 * - mode 'update' : cập nhật dữ liệu từ vựng đã tồn tại, giữ nguyên learning_progress
 *                   (bảng learning_progress không bị chạm tới → lịch ôn, trạng thái,
 *                   số lần ôn, ngày ôn đều giữ nguyên).
 */
export async function importVocabulary({ rows, mode, batchSize = 500, existingWordIds, onProgress }) {
  const inserted = [];
  const updated = [];
  const skipped = [];
  const failed = [];
  const total = rows.length;
  let processed = 0;

  const batches = chunk(rows, batchSize);
  for (const batch of batches) {
    if (mode === 'skip') {
      const toInsert = [];
      for (const item of batch) {
        if (existingWordIds.has(item.word)) skipped.push(item);
        else toInsert.push(item);
      }
      if (toInsert.length) {
        const { data, error } = await client()
          .from('vocabulary')
          .insert(toInsert.map(stripEmpty))
          .select('id,word');
        if (error) {
          if (/duplicate key|unique/i.test(error.message)) {
            // Race condition: một từ vừa được thêm ở tab khác → thử từng dòng.
            for (const item of toInsert) {
              const one = await client().from('vocabulary').insert(stripEmpty(item)).select('id,word');
              if (one.error) {
                if (/duplicate key|unique/i.test(one.error.message)) skipped.push(item);
                else failed.push({ ...item, error: one.error.message });
              } else inserted.push(...(one.data || []).map((r) => ({ ...item, id: r.id })));
            }
          } else {
            for (const item of toInsert) failed.push({ ...item, error: error.message });
          }
        } else {
          inserted.push(...(data || []).map((r) => ({ ...item, id: r.id })));
        }
      }
    } else {
      // mode update: upsert 1 lần cho toàn bộ batch (tối đa 500 dòng / request).
      const payload = batch.map(stripEmpty);
      const { data, error } = await client()
        .from('vocabulary')
        .upsert(payload, { onConflict: 'user_id,word' })
        .select('id,word');
      if (error) {
        // Thử từng dòng để báo lỗi chính xác.
        for (const item of batch) {
          const one = await client()
            .from('vocabulary')
            .upsert(stripEmpty(item), { onConflict: 'user_id,word' })
            .select('id,word');
          if (one.error) failed.push({ ...item, error: one.error.message });
          else {
            const row = (one.data || [])[0];
            if (existingWordIds.has(item.word)) updated.push({ ...item, id: row?.id });
            else inserted.push({ ...item, id: row?.id });
          }
        }
      } else {
        for (const item of batch) {
          const row = (data || []).find((r) => r.word === item.word);
          if (existingWordIds.has(item.word)) updated.push({ ...item, id: row?.id });
          else inserted.push({ ...item, id: row?.id });
        }
      }
    }

    processed += batch.length;
    onProgress?.({ processed, total });

    // Cho UI kịp cập nhật.
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

/* -------------------------------------------------------------------------- */
/* BACKUP / RESTORE                                                            */
/* -------------------------------------------------------------------------- */

export async function listFavorites() {
  const { data, error } = await client().from('favorites').select('vocabulary_id,created_at');
  if (error) throw error;
  return data || [];
}

export async function restoreProgressRows(rows, batchSize = 500) {
  const results = { ok: 0, failed: [] };
  for (const part of chunk(rows, batchSize)) {
    const { error } = await client().from('learning_progress').insert(part);
    if (error) {
      // fallback từng dòng
      for (const row of part) {
        const one = await client().from('learning_progress').insert(row);
        if (one.error) results.failed.push({ row, error: one.error.message });
        else results.ok += 1;
      }
    } else {
      results.ok += part.length;
    }
  }
  return results;
}

export async function restoreReviewRecords(rows, batchSize = 500) {
  const results = { ok: 0, failed: [] };
  for (const part of chunk(rows, batchSize)) {
    const { error } = await client().from('review_records').insert(part);
    if (error) {
      for (const row of part) {
        const one = await client().from('review_records').insert(row);
        if (one.error) results.failed.push({ row, error: one.error.message });
        else results.ok += 1;
      }
    } else {
      results.ok += part.length;
    }
  }
  return results;
}

export async function insertFavorites(vocabularyIds) {
  const rows = [...new Set(vocabularyIds)].map((id) => ({ vocabulary_id: id }));
  for (const part of chunk(rows, 500)) {
    const { error } = await client().from('favorites').upsert(part, { onConflict: 'user_id,vocabulary_id' });
    if (error) throw error;
  }
}

export async function upsertSessions(rows) {
  if (!rows.length) return;
  for (const part of chunk(rows, 500)) {
    const { error } = await client()
      .from('daily_sessions')
      .upsert(part, { onConflict: 'user_id,session_date' });
    if (error) throw error;
  }
}

export async function deleteAllUserData() {
  const tables = ['review_records', 'favorites', 'learning_progress', 'daily_sessions', 'vocabulary'];
  const { data: session } = await client().auth.getSession();
  const userId = session?.session?.user?.id;
  if (!userId) throw new Error('Chưa có phiên đăng nhập.');
  for (const table of tables) {
    const { error } = await client().from(table).delete().eq('user_id', userId);
    if (error) throw error;
  }
}
