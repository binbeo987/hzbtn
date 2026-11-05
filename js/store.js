/* =============================================================================
 * store.js - Trạng thái ứng dụng (Supabase là nguồn dữ liệu chính)
 * Chế độ 1 người dùng: không có phiên đăng nhập, dữ liệu là 1 kho duy nhất.
 * LocalStorage chỉ lưu cài đặt giao diện và vị trí buổi học đang dở.
 * ============================================================================= */

import { loadSettings, loadVocabularyRows } from './supabase.js';
import { saveQueueSnapshot, readQueueSnapshot } from './session-cache.js';
import { RATING_LABELS } from './scheduler.js';

export const state = {
  ready: false,
  settings: null,
  rows: [],
  rowsLoadedAt: null,
  queue: null,
  loadError: null,
  uiPrefs: loadUiPrefs(),
};

function loadUiPrefs() {
  try {
    return {
      lastPage: localStorage.getItem('hanngu:lastPage') || 'home',
      studyNotes: localStorage.getItem('hanngu:notes') || '',
    };
  } catch {
    return { lastPage: 'home', studyNotes: '' };
  }
}

export function saveUiPref(key, value) {
  state.uiPrefs[key] = value;
  try {
    localStorage.setItem(`hanngu:${key}`, value);
  } catch {
    /* trình duyệt chặn storage */
  }
}

/* -------------------------------------------------------------------------- */
/* KHỞI TẠO                                                                    */
/* -------------------------------------------------------------------------- */
export async function bootstrap() {
  state.settings = await loadSettings();
  await refreshAll();
  state.ready = true;
  return state;
}

/** Tải lại từ vựng + tiến trình từ Supabase. */
export async function refreshAll({ onProgress } = {}) {
  state.rows = await loadVocabularyRows({ onProgress });
  state.rowsLoadedAt = new Date().toISOString();
  invalidateQueue();
  return state.rows;
}

export async function refreshSettings() {
  state.settings = await loadSettings();
  invalidateQueue();
  return state.settings;
}

/* -------------------------------------------------------------------------- */
/* QUEUE: danh sách buổi học hiện tại                                          */
/* -------------------------------------------------------------------------- */
export function setQueue(queue) {
  state.queue = queue;
  if (queue?.items?.length) {
    saveQueueSnapshot({
      dayKey: queue.dayKey,
      items: queue.items.map((i) => i.id),
      ratings: queue.ratings || {},
      index: queue.index || 0,
      startedAt: queue.startedAt,
      counts: queue.counts,
    });
  } else {
    saveQueueSnapshot(null);
  }
}

export function invalidateQueue() {
  state.queue = null;
  saveQueueSnapshot(null);
}

export function getSavedQueueSnapshot() {
  return readQueueSnapshot();
}

/* -------------------------------------------------------------------------- */
/* CHỈ SỐ TỔNG QUAN                                                            */
/* -------------------------------------------------------------------------- */
export function computeStats(rows = state.rows) {
  let learned = 0;
  let mastered = 0;
  let reviewCount = 0;
  let correct = 0;
  let incorrect = 0;
  for (const row of rows) {
    const p = row.progress;
    if (p && p.last_reviewed_at) {
      learned += 1;
      if (p.status === 'mastered') mastered += 1;
      reviewCount += p.review_count || 0;
      correct += p.correct_count || 0;
      incorrect += p.incorrect_count || 0;
    }
  }
  return {
    total: rows.length,
    learned,
    mastered,
    favorites: rows.filter((r) => r.favorite).length,
    reviewCount,
    correct,
    incorrect,
    accuracy: correct + incorrect ? Math.round((correct / (correct + incorrect)) * 100) : 0,
  };
}

/** Cập nhật progress của một từ trong bộ nhớ sau khi lưu (không gọi lại mạng). */
export function applyReviewLocally(vocabularyId, schedule) {
  const row = state.rows.find((r) => r.id === vocabularyId);
  if (!row) return null;
  row.progress = { ...(row.progress || {}), ...schedule, vocabulary_id: vocabularyId };
  return row.progress;
}

export function setFavoriteLocal(vocabularyId, value) {
  const row = state.rows.find((r) => r.id === vocabularyId);
  if (row) row.favorite = value;
}

export function addVocabularyLocal(row) {
  if (!row || state.rows.some((r) => r.id === row.id)) return;
  state.rows.push({ ...row, progress: row.progress || null, favorite: Boolean(row.favorite) });
}

export function removeVocabularyLocal(ids) {
  const set = new Set([].concat(ids));
  state.rows = state.rows.filter((r) => !set.has(r.id));
}

export function updateVocabularyLocal(id, patch) {
  const row = state.rows.find((r) => r.id === id);
  if (row) Object.assign(row, patch);
}

export function ratingLabel(rating) {
  return RATING_LABELS[rating] || rating;
}
