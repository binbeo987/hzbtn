/* =============================================================================
 * supabase.js - Khởi tạo client + Anonymous Auth + tải toàn bộ trạng thái học
 * ============================================================================= */

import { loadConfig, isConfigured } from './config.js';
import { chunk } from './ui.js';

let client = null;
let config = null;
let sessionPromise = null;

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

/**
 * Khởi tạo Supabase client, khôi phục session cũ hoặc tạo phiên ẩn danh.
 * Không hiển thị form đăng nhập.
 */
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
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
      storageKey: 'hanngu-auth',
    },
    global: {
      headers: { 'x-application-name': 'han-ngu-dictionary' },
    },
  });

  return client;
}

/**
 * Bảo đảm có phiên đăng nhập ẩn danh.
 * - Có session trên trình duyệt → dùng lại (mở lại website vẫn còn dữ liệu).
 * - Chưa có → gọi signInAnonymously() → tạo auth.uid() mới.
 */
export async function ensureSession({ force = false } = {}) {
  if (!client) throw new Error('Supabase chưa khởi tạo.');
  if (sessionPromise && !force) return sessionPromise;

  sessionPromise = (async () => {
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError) throw sessionError;
    if (sessionData?.session?.user) return sessionData.session;

    const timeout = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Tạo phiên ẩn danh quá lâu. Kiểm tra mạng và cấu hình Supabase.')), 20000);
    });

    const signIn = client.auth.signInAnonymously().then(({ data, error }) => {
      if (error) throw error;
      if (!data?.session) throw new Error('Supabase không trả về phiên ẩn danh.');
      return data.session;
    });

    return Promise.race([signIn, timeout]);
  })();

  try {
    return await sessionPromise;
  } catch (error) {
    sessionPromise = null;
    throw error;
  }
}

export async function getSession() {
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data?.session || null;
}

export async function getUserId() {
  const session = await getSession();
  return session?.user?.id || null;
}

export function onAuthStateChange(callback) {
  if (!client) return { unsubscribe() {} };
  const { data } = client.auth.onAuthStateChange((event, session) => callback(event, session));
  return data.subscription;
}

/** Đọc settings của user; nếu chưa có thì tạo default qua RPC. */
export async function loadSettings() {
  const { data, error } = await client.rpc('ensure_learning_settings');
  if (error) throw error;
  return normalizeSettings(data);
}

export function normalizeSettings(row) {
  return {
    user_id: row?.user_id,
    new_words_per_day: Number(row?.new_words_per_day ?? 10),
    max_words_per_day: Number(row?.max_words_per_day ?? 30),
    study_start_date: row?.study_start_date || null,
    preferred_study_time: row?.preferred_study_time || '',
    timezone: row?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
    updated_at: row?.updated_at || null,
  };
}

/** Tải toàn bộ từ vựng + tiến trình + favorite (phân trang để vượt giới hạn 1000 dòng). */
export async function loadVocabularyRows(userId, { onProgress } = {}) {
  const pageSize = 1000;
  const all = [];
  let from = 0;
  for (;;) {
    let query = client
      .from('vocabulary')
      .select(
        'id,user_id,word,pinyin,pos,meaning,hsk,topic,example,example_pinyin,example_meaning,created_at,updated_at,learning_progress(*),favorites(user_id,vocabulary_id)',
      )
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + pageSize - 1);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) throw error;
    all.push(...(data || []));
    onProgress?.(all.length);
    if (!data || data.length < pageSize) break;
    from += pageSize;
  }

  return all.map((row) => {
    const progress = Array.isArray(row.learning_progress) ? row.learning_progress[0] || null : row.learning_progress;
    const favorite = Array.isArray(row.favorites) ? row.favorites.length > 0 : Boolean(row.favorites);
    const { learning_progress: _p, favorites: _f, ...vocab } = row;
    return { ...vocab, progress: progress || null, favorite };
  });
}

/**
 * Tải tiến trình theo danh sách vocabulary_id (dùng khi mở buổi học thay thế
 * toàn bộ kho chưa đồng bộ).
 */
export async function loadProgressFor(userId, vocabularyIds) {
  const out = new Map();
  for (const ids of chunk(vocabularyIds, 200)) {
    let query = client
      .from('learning_progress')
      .select('*')
      .in('vocabulary_id', ids);
    if (userId) query = query.eq('user_id', userId);
    const { data, error } = await query;
    if (error) throw error;
    for (const row of data || []) out.set(row.vocabulary_id, row);
  }
  return out;
}

/** Đăng xuất phiên ẩn danh hiện tại (chỉ dùng trong Cài đặt, kèm cảnh báo mất dữ liệu). */
export async function signOut() {
  sessionPromise = null;
  const { error } = await client.auth.signOut();
  if (error) throw error;
}

/** Tạo phiên ẩn danh mới + settings mới. Dùng khi khôi phục từ JSON. */
export async function startNewAnonymousSession() {
  sessionPromise = null;
  try {
    await client.auth.signOut();
  } catch {
    /* bỏ qua */
  }
  return ensureSession({ force: true });
}

export { isConfigured };
