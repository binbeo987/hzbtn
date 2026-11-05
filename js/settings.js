/* =============================================================================
 * settings.js - Cài đặt: lịch học, kết nối Supabase, mã truy cập, thông tin
 * ============================================================================= */

import { updateSettings } from './api.js';
import { state, refreshAll, refreshSettings } from './store.js';
import { APP_CONFIG, CONFIG_SOURCE_LABELS, saveConfigOverride, clearConfigOverride, readConfigOverride } from './config.js';
import { getConfig, getAccessKey, setAccessKey, testConnection, applyRuntimeConfig } from './supabase.js';
import { toast, getErrorMessage, formatDayKey, setBusy, esc } from './ui.js';

let mounted = false;

export function mountSettings() {
  if (mounted) return;
  mounted = true;
  document.getElementById('settings-form')?.addEventListener('submit', saveSettings);
  document.getElementById('supabase-toggle')?.addEventListener('click', toggleSupabasePanel);
  document.getElementById('supabase-save')?.addEventListener('click', saveSupabaseConfig);
  document.getElementById('supabase-test')?.addEventListener('click', checkSupabase);
  document.getElementById('supabase-reset')?.addEventListener('click', resetSupabaseConfig);
}

/* -------------------------------------------------------------------------- */
/* LỊCH HỌC                                                                    */
/* -------------------------------------------------------------------------- */
export function renderSettings() {
  const s = state.settings;
  if (s) {
    const newInput = document.getElementById('set-new');
    const maxInput = document.getElementById('set-max');
    const timeInput = document.getElementById('set-time');
    if (newInput) newInput.value = s.new_words_per_day;
    if (maxInput) maxInput.value = s.max_words_per_day;
    if (timeInput) timeInput.value = (s.preferred_study_time || '').slice(0, 5);

    const meta = document.getElementById('settings-meta');
    if (meta) {
      meta.textContent = s.study_start_date
        ? `Bắt đầu học từ ${formatDayKey(s.study_start_date, { dateStyle: 'long' })}. Múi giờ lưu lịch: ${s.timezone}.`
        : '';
    }
  }

  const tz = document.getElementById('settings-timezone');
  if (tz) tz.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || '—';

  const count = document.getElementById('settings-vocab-count');
  if (count) count.textContent = String(state.rows.length);

  const version = document.getElementById('settings-version');
  if (version) version.textContent = APP_CONFIG.version;

  renderSupabaseInfo();
}

async function saveSettings(event) {
  event.preventDefault();
  const button = document.getElementById('settings-save');
  const newWords = Number(document.getElementById('set-new').value);
  const maxWords = Number(document.getElementById('set-max').value);
  const time = document.getElementById('set-time').value;

  if (!Number.isInteger(newWords) || newWords < 0) {
    toast('Số từ mới phải là số nguyên không âm.', 'error');
    return;
  }
  if (!Number.isInteger(maxWords) || maxWords < 1) {
    toast('Tổng số từ tối đa mỗi buổi phải từ 1 trở lên.', 'error');
    return;
  }
  if (maxWords < newWords) {
    toast('Tổng số từ tối đa phải lớn hơn hoặc bằng số từ mới mỗi ngày.', 'error');
    return;
  }

  setBusy(button, true, 'Đang lưu…');
  try {
    await updateSettings({
      new_words_per_day: newWords,
      max_words_per_day: maxWords,
      preferred_study_time: time,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    });
    await refreshSettings();
    renderSettings();
    toast('Đã lưu cài đặt.', 'success');
  } catch (error) {
    toast(getErrorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

/* -------------------------------------------------------------------------- */
/* KẾT NỐI SUPABASE                                                            */
/* -------------------------------------------------------------------------- */
function renderSupabaseInfo() {
  const cfg = getConfig();
  const urlDisplay = document.getElementById('sb-url-display');
  const keyDisplay = document.getElementById('sb-key-display');
  const source = document.getElementById('sb-source');
  const status = document.getElementById('sb-status');

  if (urlDisplay) urlDisplay.textContent = cfg?.supabaseUrl || 'Chưa cấu hình';
  if (keyDisplay) {
    const key = cfg?.supabaseAnonKey || '';
    keyDisplay.textContent = key ? `${key.slice(0, 12)}…${key.slice(-6)} (${key.length} ký tự)` : 'Chưa cấu hình';
    keyDisplay.title = key;
  }
  if (source) {
    const override = readConfigOverride();
    source.textContent = CONFIG_SOURCE_LABELS[override ? 'manual' : cfg?.source] || (cfg?.supabaseUrl ? 'Cấu hình mặc định' : '—');
  }
  if (status) {
    status.innerHTML = cfg?.supabaseUrl && cfg?.supabaseAnonKey
      ? `<span class="tag tag-green">Đã kết nối</span>`
      : `<span class="tag tag-amber">Chưa cấu hình</span>`;
  }
}

function fillSupabaseForm() {
  const cfg = getConfig();
  const urlInput = document.getElementById('set-sb-url');
  const keyInput = document.getElementById('set-sb-key');
  const accessInput = document.getElementById('set-access-key');
  if (urlInput) urlInput.value = cfg?.supabaseUrl || '';
  if (keyInput) keyInput.value = cfg?.supabaseAnonKey || '';
  if (accessInput && !accessInput.value) accessInput.value = getAccessKey();
}

function toggleSupabasePanel() {
  const panel = document.getElementById('supabase-panel');
  const toggle = document.getElementById('supabase-toggle');
  if (!panel) return;
  // Chỉ mở khi panel đang ẩn thực sự.
  const open = getComputedStyle(panel).display === 'none';
  panel.hidden = !open;
  toggle?.setAttribute('aria-expanded', String(open));
  toggle.textContent = open ? 'Thu gọn' : 'Thay đổi';
  if (open) {
    fillSupabaseForm();
    document.getElementById('set-sb-url')?.focus();
  }
}

function readSupabaseForm() {
  return {
    url: document.getElementById('set-sb-url')?.value || '',
    key: document.getElementById('set-sb-key')?.value || '',
    accessKey: document.getElementById('set-access-key')?.value.trim() || '',
  };
}

function feedback(message, type = 'info') {
  const node = document.getElementById('supabase-feedback');
  if (!node) return;
  node.className = `small ${type === 'error' ? 'text-error' : type === 'success' ? 'text-ok' : 'muted'}`;
  node.innerHTML = esc(message);
}

async function checkSupabase() {
  const button = document.getElementById('supabase-test');
  const { url, key, accessKey } = readSupabaseForm();
  setBusy(button, true, 'Đang kiểm tra…');
  feedback('Đang kết nối tới Supabase…');
  try {
    const result = await testConnection(url, key, accessKey);
    feedback(result.message, result.ok ? 'success' : 'error');
    toast(result.message, result.ok ? 'success' : 'error', 4000);
  } catch (error) {
    feedback(getErrorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function saveSupabaseConfig() {
  const button = document.getElementById('supabase-save');
  const { url, key, accessKey } = readSupabaseForm();
  setBusy(button, true, 'Đang kiểm tra…');
  feedback('Đang kiểm tra kết nối trước khi lưu…');

  try {
    const result = await testConnection(url, key, accessKey);
    if (!result.ok && !result.needsKey) {
      feedback(result.message, 'error');
      toast(result.message, 'error', 5000);
      return;
    }

    applyRuntimeConfig({ url, key });
    const saved = saveConfigOverride({ url, key });
    if (accessKey) setAccessKey(accessKey);

    // Kết nối lại dữ liệu với cấu hình mới để kiểm tra lần cuối.
    try {
      await refreshSettings();
      await refreshAll();
      setBusy(button, false);
      feedback(`Đã lưu cấu hình và kết nối thành công · ${state.rows.length} từ trong kho.`, 'success');
      toast('Đã cập nhật kết nối Supabase.', 'success');
      renderSettings();
      document.getElementById('supabase-panel').hidden = true;
      document.getElementById('supabase-toggle').textContent = 'Thay đổi';
      document.getElementById('supabase-toggle').setAttribute('aria-expanded', 'false');
    } catch (error) {
      feedback(`Đã lưu cấu hình nhưng chưa đọc được dữ liệu: ${getErrorMessage(error)}`, 'error');
      toast('Đã lưu cấu hình. Hãy kiểm tra mã truy cập hoặc file SQL.', 'error', 5000);
    }
    void saved;
  } catch (error) {
    feedback(getErrorMessage(error), 'error');
    toast(getErrorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function resetSupabaseConfig() {
  clearConfigOverride();
  setAccessKey('');
  feedback('Đã xoá cấu hình nhập tay. Tải lại trang để dùng cấu hình mặc định.', 'info');
  toast('Đã xoá cấu hình trên máy này. Đang tải lại…', 'info', 1800);
  setTimeout(() => location.reload(), 900);
}
