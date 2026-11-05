/* =============================================================================
 * supabase.js - Khởi tạo client + mã truy cập (chế độ 1 người dùng)
 * Không có đăng nhập, không có phiên ẩn danh: dữ liệu là 1 kho duy nhất,
 * truy cập qua các hàm RPC (xem database/rls.sql).
 * ============================================================================= */

import { loadConfig, isConfigured } from './config.js';

let client = null;
let config = null;
let accessKey = '';

const ACCESS_KEY_STORAGE = 'hanngu:access-key';

export function getClient() {
  if (!client) throw new Error('Supabase client chưa được khởi tạo.');
  return client;
}

export function getConfig() {
  return config;
}

/** Chỉ dùng cho kiểm thử tự động: thay client hiện tại bằng client khác. */
export function __setClientForTests(next) {
  client = next;
}

export function isReady() {
  return Boolean(client);
}

/** Mã truy cập (nếu Supabase có đặt app_access_key). */
export function getAccessKey() {
  if (accessKey) return accessKey;
  try {
    accessKey = localStorage.getItem(ACCESS_KEY_STORAGE) || '';
  } catch {
    accessKey = '';
  }
  return accessKey;
}

export function setAccessKey(value) {
  accessKey = String(value || '').trim();
  try {
    if (accessKey) localStorage.setItem(ACCESS_KEY_STORAGE, accessKey);
    else localStorage.removeItem(ACCESS_KEY_STORAGE);
  } catch {
    /* trình duyệt chặn storage */
  }
}

export async function initSupabase() {
  config = await loadConfig();
  if (!isConfigured(config)) {
    const err = new Error('MISSING_CONFIG');
    err.code = 'MISSING_CONFIG';
    err.detail = config.warning;
    throw err;
  }
  const lib = window.supabase;
  if (!lib || typeof lib.createClient !== 'function') {
    throw new Error('Không tải được thư viện supabase-js.');
  }

  client = lib.createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-application-name': 'han-ngu-dictionary' } },
  });
  return client;
}

/** RPC kèm mã truy cập; chuẩn hoá lỗi dễ hiểu cho người dùng. */
export async function rpc(fn, args = {}) {
  const { data, error } = await getClient().rpc(fn, { ...args, p_key: getAccessKey() || null });
  if (error) throw decorateError(error);
  return data;
}

function decorateError(error) {
  const message = error?.message || '';
  if (/invalid access key/i.test(message)) {
    const err = new Error('ACCESS_KEY_REQUIRED');
    err.code = 'ACCESS_KEY_REQUIRED';
    err.detail = message;
    return err;
  }
  return error;
}

function isAccessKeyError(error) {
  return error?.code === 'ACCESS_KEY_REQUIRED' || /invalid access key/i.test(error?.message || '');
}

export function normalizeSettings(row) {
  return {
    id: true,
    new_words_per_day: Number(row?.new_words_per_day ?? 10),
    max_words_per_day: Number(row?.max_words_per_day ?? 30),
    study_start_date: row?.study_start_date || null,
    preferred_study_time: row?.preferred_study_time || '',
    timezone: row?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    updated_at: row?.updated_at || null,
  };
}

/** Cài đặt học tập (bảng luôn có đúng 1 dòng, schema.sql tạo sẵn). */
export async function loadSettings() {
  const backup = await rpc('get_backup');
  return normalizeSettings(backup?.settings);
}

/** Toàn bộ kho từ vựng + tiến trình, dùng để tính buổi học và lịch. */
export async function loadVocabularyRows() {
  let data;
  try {
    data = await rpc('get_study_rows');
  } catch (error) {
    if (isAccessKeyError(error)) throw error;
    throw error;
  }

  return (data || []).map((row) => ({
    id: row.id,
    word: row.word,
    pinyin: row.pinyin,
    meaning: row.meaning,
    hsk: row.hsk,
    topic: row.topic,
    created_at: row.created_at,
    progress: row.progress || null,
    favorite: Boolean(row.progress?.favorite),
  }));
}

export { isAccessKeyError, isConfigured };
