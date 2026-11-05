/* =============================================================================
 * settings.js - Trang Cài đặt: lịch học hằng ngày, thông tin phiên, sao lưu
 * ============================================================================= */

import { updateSettings } from './api.js';
import { state, refreshSettings } from './store.js';
import { APP_CONFIG } from './config.js';
import { toast, getErrorMessage, formatDayKey, setBusy } from './ui.js';

let mounted = false;

export function mountSettings() {
  if (mounted) return;
  mounted = true;
  const form = document.getElementById('settings-form');
  form?.addEventListener('submit', saveSettings);
}

export function renderSettings() {
  const s = state.settings;
  if (!s) return;
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

  const uid = document.getElementById('settings-user-id');
  if (uid) uid.textContent = state.userId || '—';

  const tz = document.getElementById('settings-timezone');
  if (tz) tz.textContent = Intl.DateTimeFormat().resolvedOptions().timeZone || '—';

  const count = document.getElementById('settings-vocab-count');
  if (count) count.textContent = String(state.rows.length);

  const version = document.getElementById('settings-version');
  if (version) version.textContent = APP_CONFIG.version;
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
