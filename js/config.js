/* =============================================================================
 * config.js - Cấu hình runtime
 *
 * ❗ Không viết secret vào file này. Chỉ dùng anon/publishable key ở frontend.
 *
 * Vercel:
 *  - Biến môi trường SUPABASE_URL và SUPABASE_ANON_KEY được đọc lúc build bởi
 *    scripts/build.mjs → sinh ra /js/env.js và /api/config.
 *  - Không cần Vite. File .env không bao giờ được đẩy lên CDN trực tiếp.
 *
 * Dev local không có build:
 *  - Cách 1: đặt thông tin vào meta trong index.html.
 *  - Cách 2: tạo js/env.js thủ công (xem js/env.example.js).
 * ============================================================================= */

const DEFAULT_CONFIG = { supabaseUrl: '', supabaseAnonKey: '' };

/** Cấu hình tùy chỉnh lưu trên máy (nhập ở trang Cài đặt). */
const OVERRIDE_KEY = 'hanngu:supabase-config';

const ENV_KEYS = {
  supabaseUrl: ['SUPABASE_URL', 'VITE_SUPABASE_URL'],
  supabaseAnonKey: ['SUPABASE_ANON_KEY', 'VITE_SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY'],
};

/** Chuẩn hoá URL dự án: thêm https://, bỏ dấu / cuối. */
export function normalizeSupabaseUrl(value) {
  let url = String(value || '').trim();
  if (!url) return '';
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/+$/, '');
}

/** Kiểm tra nhanh cặp URL + key; trả về danh sách lỗi (rỗng = hợp lệ). */
export function validateSupabaseConfig({ url, key }) {
  const errors = [];
  if (!normalizeSupabaseUrl(url)) errors.push('Chưa nhập Project URL.');
  else if (!/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.supabase\.(co|in)$/i.test(normalizeSupabaseUrl(url))) {
    errors.push('Project URL phải có dạng https://<project-ref>.supabase.co');
  }
  const anonKey = String(key || '').trim();
  if (!anonKey) errors.push('Chưa nhập anon / publishable key.');
  else if (anonKey.length < 30) errors.push('Anon key quá ngắn, hãy dán đầy đủ key.');
  else if (/^sb_secret_/i.test(anonKey) || /service_role/i.test(anonKey)) {
    errors.push('Đây là secret key — chỉ dùng anon / publishable key ở frontend.');
  }
  return errors;
}

export function readConfigOverride() {
  try {
    const raw = localStorage.getItem(OVERRIDE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !data.supabaseUrl || !data.supabaseAnonKey) return null;
    return { supabaseUrl: data.supabaseUrl, supabaseAnonKey: data.supabaseAnonKey };
  } catch {
    return null;
  }
}

export function saveConfigOverride({ url, key }) {
  const config = {
    supabaseUrl: normalizeSupabaseUrl(url),
    supabaseAnonKey: String(key || '').trim(),
  };
  localStorage.setItem(OVERRIDE_KEY, JSON.stringify(config));
  return config;
}

export function clearConfigOverride() {
  try {
    localStorage.removeItem(OVERRIDE_KEY);
  } catch {
    /* bỏ qua */
  }
}

export function hasConfigOverride() {
  return Boolean(readConfigOverride());
}

async function fromEnvModule(config) {
  try {
    const mod = await import('./env.js');
    for (const [key, keys] of Object.entries(ENV_KEYS)) {
      if (config[key]) continue;
      const found = keys.map((k) => mod.ENV?.[k]).find((v) => typeof v === 'string' && v.trim());
      if (found) config[key] = found.trim();
    }
  } catch {
    /* env.js chưa được tạo */
  }
}

async function fromApi(config) {
  if (config.supabaseUrl && config.supabaseAnonKey) return;
  try {
    const res = await fetch('/api/config', { headers: { accept: 'application/json' } });
    if (!res.ok) return;
    const data = await res.json();
    for (const [key, keys] of Object.entries(ENV_KEYS)) {
      if (config[key]) continue;
      const found = keys.map((k) => data[k]).find((v) => typeof v === 'string' && v.trim());
      if (found) config[key] = found.trim();
    }
  } catch {
    /* dev tĩnh không có serverless */
  }
}

function fromMeta(config) {
  const metaMap = { supabaseUrl: 'supabase-url', supabaseAnonKey: 'supabase-anon-key' };
  for (const [key, metaName] of Object.entries(metaMap)) {
    if (config[key]) continue;
    const meta = document.querySelector(`meta[name="${metaName}"]`);
    if (meta && meta.content) config[key] = meta.content.trim();
  }
}

export function getBuildEnv(config) {
  return Object.fromEntries(Object.entries(config).filter(([, v]) => v));
}

/**
 * Đọc config theo thứ tự ưu tiên:
 *   1. Cấu hình nhập tay ở trang Cài đặt (lưu trên máy)
 *   2. meta trong index.html
 *   3. js/env.js (sinh lúc build)
 *   4. /api/config (biến môi trường Vercel)
 */
export async function loadConfig() {
  const config = { ...DEFAULT_CONFIG };

  const override = readConfigOverride();
  if (override) {
    config.supabaseUrl = override.supabaseUrl;
    config.supabaseAnonKey = override.supabaseAnonKey;
    config.source = 'manual';
  } else {
    fromMeta(config);
    if (config.supabaseUrl && config.supabaseAnonKey) config.source = 'meta';
    await fromEnvModule(config);
    if (!config.supabaseUrl || !config.supabaseAnonKey) await fromApi(config);
    if (config.supabaseUrl && config.supabaseAnonKey && !config.source) config.source = 'env';
  }

  if (config.supabaseUrl && !/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.supabase\.(co|in)\/?$/i.test(config.supabaseUrl)) {
    config.warning = 'SUPABASE_URL không đúng định dạng https://<project>.supabase.co';
  }
  if (config.supabaseAnonKey && config.supabaseAnonKey.length < 40) {
    config.warning = 'SUPABASE_ANON_KEY có vẻ không đúng (quá ngắn).';
  }
  return config;
}

export const CONFIG_SOURCE_LABELS = {
  manual: 'Nhập ở trang Cài đặt',
  meta: 'Cấu hình sẵn trong index.html',
  env: 'Biến môi trường / api/config',
};

export function isConfigured(config) {
  return Boolean(config?.supabaseUrl && config?.supabaseAnonKey);
}

export const APP_CONFIG = {
  appName: 'Hán Ngữ',
  version: '1.0.0',
  defaultSettings: {
    new_words_per_day: 10,
    max_words_per_day: 30,
  },
  limits: {
    importBatchSize: 500,
    queryPageSize: 1000,
    searchPageSize: 30,
    backupPageSize: 1000,
  },
};

export const RATING_META = {
  again: { label: 'Chưa nhớ', icon: '✕', hint: '10 phút', className: 'rating-again' },
  hard: { label: 'Khó nhớ', icon: '◐', hint: '1 ngày', className: 'rating-hard' },
  good: { label: 'Đã nhớ', icon: '✓', hint: '3 ngày', className: 'rating-good' },
  easy: { label: 'Rất dễ', icon: '★', hint: '7 ngày', className: 'rating-easy' },
};
