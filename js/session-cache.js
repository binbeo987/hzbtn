/* =============================================================================
 * session-cache.js - Lưu tạm tiến độ buổi Flashcard đang học (LocalStorage).
 * Đây KHÔNG phải nguồn dữ liệu chính: mỗi lần đánh giá đều đã lưu vào Supabase.
 * Cache chỉ giúp người dùng đóng tab giữa buổi và mở lại đúng vị trí.
 * ============================================================================= */

import { localDayKey } from './scheduler.js';

const KEY = 'hanngu:queue-snapshot:v1';

export function saveQueueSnapshot(snapshot) {
  try {
    if (!snapshot) {
      localStorage.removeItem(KEY);
      return;
    }
    localStorage.setItem(
      KEY,
      JSON.stringify({ ...snapshot, savedAt: new Date().toISOString(), userId: snapshot.userId || null }),
    );
  } catch {
    // storage đầy hoặc bị trình duyệt chặn
  }
}

export function readQueueSnapshot(userId) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.items)) return null;
    const today = localDayKey(new Date());
    if (data.dayKey && data.dayKey !== today) return null;
    if (userId && data.userId && data.userId !== userId) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearQueueSnapshot() {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}
