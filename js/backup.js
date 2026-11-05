/* =============================================================================
 * backup.js - Sao lưu & khôi phục dữ liệu
 * - Xuất JSON đầy đủ: từ vựng, learning_progress, review_records, daily_sessions,
 *   favorites + settings.
 * - Khôi phục: kiểm tra cấu trúc → xem trước → xác nhận → ghi theo batch.
 *   Không ghi đè dữ liệu nếu người dùng chưa xác nhận.
 * ============================================================================= */

import {
  listAllVocabulary,
  listProgress,
  listReviewRecords,
  listSessions,
  listFavorites,
  insertVocabulary,
  restoreProgressRows,
  restoreReviewRecords,
  insertFavorites,
  upsertSessions,
  updateSettings,
  deleteAllUserData,
  findExistingWords,
} from './api.js';
import { state, refreshAll, refreshSettings } from './store.js';
import { toCsvText, CSV_HEADER } from './csv-parser.js';
import { getSession } from './supabase.js';
import { APP_CONFIG } from './config.js';
import { invalidateCalendarCache } from './calendar.js';
import {
  el,
  esc,
  toast,
  downloadBlob,
  getErrorMessage,
  confirmDialog,
  setBusy,
  formatDateTime,
} from './ui.js';

let imported = null; // dữ liệu đã parse, chờ xác nhận
let mounted = false;

export function mountBackup() {
  if (mounted) return;
  mounted = true;

  document.getElementById('backup-json')?.addEventListener('click', (e) => exportFullJson(e.currentTarget));
  document.getElementById('backup-csv')?.addEventListener('click', exportCsv);
  document.getElementById('backup-progress')?.addEventListener('click', (e) => exportProgressJson(e.currentTarget));
  document.getElementById('restore-file')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (file) handleRestoreFile(file);
    e.target.value = '';
  });

  const drop = document.getElementById('restore-drop');
  drop?.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-drag');
  });
  drop?.addEventListener('dragleave', () => drop.classList.remove('is-drag'));
  drop?.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-drag');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleRestoreFile(file);
  });

  document.getElementById('danger-delete')?.addEventListener('click', deleteEverything);
}

/* -------------------------------------------------------------------------- */
/* EXPORT                                                                      */
/* -------------------------------------------------------------------------- */
async function collectFullBackup() {
  const [vocabulary, progress, reviews, sessions, favorites, session] = await Promise.all([
    listAllVocabulary(),
    listProgress(),
    listReviewRecords({}),
    listSessions({}),
    listFavorites(),
    getSession(),
  ]);
  return {
    app: 'han-ngu',
    version: APP_CONFIG.version,
    exported_at: new Date().toISOString(),
    user_id: session?.user?.id || null,
    settings: state.settings,
    vocabulary,
    learning_progress: progress,
    review_records: reviews,
    daily_sessions: sessions,
    favorites,
  };
}

async function exportFullJson(button) {
  setBusy(button, true, 'Đang chuẩn bị…');
  try {
    const data = await collectFullBackup();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(`hanngu-backup-${stamp}.json`, JSON.stringify(data, null, 2));
    toast('Đã xuất bản sao lưu JSON.', 'success');
  } catch (error) {
    toast(getErrorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

async function exportProgressJson(button) {
  setBusy(button, true, 'Đang chuẩn bị…');
  try {
    const [progress, reviews, sessions] = await Promise.all([listProgress(), listReviewRecords({}), listSessions({})]);
    const data = {
      app: 'han-ngu',
      version: APP_CONFIG.version,
      kind: 'history',
      exported_at: new Date().toISOString(),
      learning_progress: progress,
      review_records: reviews,
      daily_sessions: sessions,
    };
    downloadBlob(`hanngu-history-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(data, null, 2));
    toast('Đã xuất lịch sử học tập.', 'success');
  } catch (error) {
    toast(getErrorMessage(error), 'error');
  } finally {
    setBusy(button, false);
  }
}

function exportCsv() {
  if (!state.rows.length) {
    toast('Kho từ đang trống.', 'error');
    return;
  }
  const rows = state.rows.map((r) => Object.fromEntries(CSV_HEADER.map((k) => [k, r[k] || ''])));
  downloadBlob(`hanngu-vocabulary-${new Date().toISOString().slice(0, 10)}.csv`, toCsvText(rows), 'text/csv;charset=utf-8');
  toast(`Đã xuất ${rows.length} từ ra CSV.`, 'success');
}

/* -------------------------------------------------------------------------- */
/* RESTORE                                                                     */
/* -------------------------------------------------------------------------- */
async function handleRestoreFile(file) {
  if (!/\.json$/i.test(file.name)) {
    toast('Vui lòng chọn file .json', 'error');
    return;
  }
  const host = document.getElementById('restore-preview');
  host.innerHTML = `<p class="muted"><span class="spinner"></span> Đang kiểm tra “${esc(file.name)}”…</p>`;
  try {
    const text = await file.text();
    const data = JSON.parse(text.replace(/^\uFEFF/, ''));
    const validation = validateBackup(data);
    imported = { data, validation, fileName: file.name };
    renderRestorePreview();
  } catch (error) {
    imported = null;
    host.innerHTML = `<div class="boot-error">File không hợp lệ: ${esc(getErrorMessage(error))}</div>`;
  }
}

/** Kiểm tra cấu trúc dữ liệu bản sao lưu (dùng chung cho test). */
export function validateBackup(data) {
  const errors = [];
  const warnings = [];
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return { ok: false, errors: ['Nội dung không phải JSON object.'], warnings, counts: {} };
  }
  if (data.app && data.app !== 'han-ngu') warnings.push(`File được xuất từ ứng dụng khác (${data.app}).`);

  const vocab = Array.isArray(data.vocabulary) ? data.vocabulary : [];
  const progress = Array.isArray(data.learning_progress) ? data.learning_progress : [];
  const reviews = Array.isArray(data.review_records) ? data.review_records : [];
  const sessions = Array.isArray(data.daily_sessions) ? data.daily_sessions : [];
  const favorites = Array.isArray(data.favorites) ? data.favorites : [];

  if (!vocab.length && !progress.length && !reviews.length && !sessions.length) {
    errors.push('File không chứa dữ liệu từ vựng hay lịch sử học nào.');
  }

  vocab.forEach((row, i) => {
    if (!row || typeof row !== 'object') {
      errors.push(`vocabulary: dòng thứ ${i + 1} không hợp lệ.`);
      return;
    }
    if (!row.word || !row.pinyin || !row.meaning) errors.push(`vocabulary: dòng thứ ${i + 1} thiếu word/pinyin/meaning.`);
  });

  const vocabIds = new Set(vocab.map((v) => v && v.id));
  progress.forEach((row, i) => {
    if (!row || !row.vocabulary_id) {
      errors.push(`learning_progress: dòng thứ ${i + 1} thiếu vocabulary_id.`);
      return;
    }
    if (vocabIds.size && !vocabIds.has(row.vocabulary_id)) {
      errors.push(`learning_progress: dòng thứ ${i + 1} trỏ tới từ không có trong file.`);
    }
    if (row.status && !['new', 'learning', 'review', 'remembered', 'mastered'].includes(row.status)) {
      errors.push(`learning_progress: dòng thứ ${i + 1} có status không hợp lệ.`);
    }
  });

  reviews.forEach((row, i) => {
    if (!row || !['again', 'hard', 'good', 'easy'].includes(row.rating)) {
      errors.push(`review_records: dòng thứ ${i + 1} có rating không hợp lệ.`);
    }
  });

  const duplicates = {};
  for (const v of vocab) if (v?.word) duplicates[v.word] = (duplicates[v.word] || 0) + 1;
  const dupWords = Object.keys(duplicates).filter((k) => duplicates[k] > 1);
  if (dupWords.length) warnings.push(`${dupWords.length} từ trùng trong file (chỉ nhập bản ghi đầu tiên).`);

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    counts: {
      vocabulary: vocab.length,
      learning_progress: progress.length,
      review_records: reviews.length,
      daily_sessions: sessions.length,
      favorites: favorites.length,
    },
  };
}

function renderRestorePreview() {
  const host = document.getElementById('restore-preview');
  const { validation, fileName, data } = imported;
  host.innerHTML = '';
  host.append(
    el('p', { class: 'muted small' },
      `File: ${esc(fileName)}${data.exported_at ? ` · xuất lúc ${esc(formatDateTime(data.exported_at))}` : ''}`),
    el('ul', { class: 'check-list' }, [
      el('li', { class: validation.ok ? 'ok' : 'bad' },
        validation.ok ? 'Cấu trúc hợp lệ' : `${validation.errors.length} lỗi cấu trúc`),
      el('li', {}, `Từ vựng: ${validation.counts.vocabulary}`),
      el('li', {}, `Tiến trình học: ${validation.counts.learning_progress}`),
      el('li', {}, `Lịch sử ôn: ${validation.counts.review_records}`),
      el('li', {}, `Buổi học: ${validation.counts.daily_sessions}`),
      el('li', {}, `Yêu thích: ${validation.counts.favorites}`),
    ]),
  );

  if (validation.warnings.length) {
    host.append(el('div', { class: 'muted small' }, validation.warnings.map((w) => el('p', {}, w))));
  }
  if (!validation.ok) {
    host.append(el('div', { class: 'boot-error' }, validation.errors.slice(0, 8).join('\n')));
    return;
  }

  host.append(
    el('label', { class: 'radio-card', style: { marginTop: '0.6rem' } }, [
      el('input', { type: 'checkbox', id: 'restore-replace' }),
      el('div', {}, [
        el('strong', {}, 'Xoá dữ liệu hiện tại trước khi khôi phục'),
        el('span', { class: 'muted' }, 'Mặc định chỉ thêm từ mới vào kho hiện tại và giữ nguyên dữ liệu đang có.'),
      ]),
    ]),
    el('div', { class: 'button-row', style: { marginTop: '0.8rem' } }, [
      el('button', { class: 'btn btn-primary', type: 'button', id: 'restore-run' }, 'Xác nhận khôi phục'),
    ]),
  );
  document.getElementById('restore-run').addEventListener('click', (e) => runRestore(e.currentTarget));
}

async function runRestore(button) {
  if (!imported?.validation?.ok) return;
  const replace = document.getElementById('restore-replace')?.checked;
  const confirmed = await confirmDialog({
    title: 'Khôi phục dữ liệu',
    message: replace
      ? 'Dữ liệu hiện tại sẽ bị <b>xoá</b> rồi khôi phục từ file. Không thể hoàn tác.'
      : 'Dữ liệu từ file sẽ được <b>thêm</b> vào kho hiện tại. Bản ghi trùng sẽ không tạo bản sao.',
    okText: 'Khôi phục',
    danger: replace,
  });
  if (!confirmed) return;

  setBusy(button, true, 'Đang khôi phục…');
  const { data } = imported;
  const report = [];
  try {
    if (replace) {
      await deleteAllUserData();
      state.rows = [];
    }

    // 1. Từ vựng
    const idMap = new Map();
    const seenWords = new Set();
    const vocabRows = [];
    for (const v of data.vocabulary || []) {
      if (!v?.word || seenWords.has(v.word)) continue;
      seenWords.add(v.word);
      vocabRows.push({
        word: v.word,
        pinyin: v.pinyin || '',
        pos: v.pos || '',
        meaning: v.meaning || '',
        hsk: v.hsk || '',
        topic: v.topic || '',
        example: v.example || '',
        example_pinyin: v.example_pinyin || '',
        example_meaning: v.example_meaning || '',
      });
    }
    if (vocabRows.length) {
      const inserted = await insertVocabularyBatched(vocabRows);
      for (const row of inserted) {
        const original = (data.vocabulary || []).find((v) => v.word === row.word);
        if (original?.id) idMap.set(original.id, row.id);
      }
      report.push(`Đã thêm ${inserted.length} từ vựng.`);
    }

    const existing = await findExistingWords(vocabRows.map((v) => v.word));
    const resolveVocabId = (oldId) => {
      if (idMap.has(oldId)) return idMap.get(oldId);
      const oldVocab = (data.vocabulary || []).find((v) => v.id === oldId);
      return oldVocab ? existing.get(oldVocab.word) || null : null;
    };

    // 2. Tiến trình học
    const progressRows = (data.learning_progress || [])
      .map((p) => ({ ...toProgressRow(p), vocabulary_id: resolveVocabId(p.vocabulary_id) }))
      .filter((p) => p.vocabulary_id);
    const progressResult = await restoreProgressRows(progressRows);
    report.push(`Khôi phục tiến trình: ${progressResult.ok} dòng${progressResult.failed.length ? `, ${progressResult.failed.length} lỗi` : ''}.`);

    // 3. Lịch sử ôn tập
    const reviewRows = (data.review_records || [])
      .map((r) => {
        const newId = resolveVocabId(r.vocabulary_id);
        if (!newId) return null;
        const { user_id, ...rest } = r;
        return { ...rest, vocabulary_id: newId };
      })
      .filter(Boolean);
    const reviewResult = await restoreReviewRecords(reviewRows);
    report.push(`Khôi phục lịch sử ôn: ${reviewResult.ok} lượt${reviewResult.failed.length ? `, ${reviewResult.failed.length} lỗi` : ''}.`);

    // 4. Yêu thích
    const favIds = (data.favorites || []).map((f) => resolveVocabId(f.vocabulary_id)).filter(Boolean);
    if (favIds.length) await insertFavorites(favIds);
    report.push(`Khôi phục ${favIds.length} từ yêu thích.`);

    // 5. Buổi học
    const sessionRows = (data.daily_sessions || []).map(({ user_id, id, ...rest }) => rest);
    if (sessionRows.length) await upsertSessions(sessionRows);
    report.push(`Khôi phục ${sessionRows.length} buổi học.`);

    // 6. Cài đặt
    if (data.settings) {
      try {
        await updateSettings({
          new_words_per_day: data.settings.new_words_per_day ?? 10,
          max_words_per_day: data.settings.max_words_per_day ?? 30,
          preferred_study_time: data.settings.preferred_study_time || null,
          timezone: state.settings?.timezone,
        });
        report.push('Đã áp dụng cài đặt học tập.');
      } catch (error) {
        report.push(`Không áp dụng được cài đặt: ${error.message}`);
      }
    }

    await refreshAll();
    await refreshSettings();
    invalidateCalendarCache();
    imported = null;
    document.getElementById('restore-preview').innerHTML = `<div class="restore-preview"><ul class="check-list">${report
      .map((r) => `<li class="ok">${esc(r)}</li>`)
      .join('')}</ul></div>`;
    toast('Khôi phục hoàn tất.', 'success');
  } catch (error) {
    toast(`Khôi phục thất bại: ${getErrorMessage(error)}`, 'error', 6000);
  } finally {
    setBusy(button, false);
  }
}

function toProgressRow(p) {
  return {
    status: p.status || 'new',
    first_learned_at: p.first_learned_at || null,
    last_reviewed_at: p.last_reviewed_at || null,
    next_review_at: p.next_review_at || null,
    review_count: p.review_count || 0,
    correct_count: p.correct_count || 0,
    incorrect_count: p.incorrect_count || 0,
    repetition: p.repetition || 0,
    easiness_factor: p.easiness_factor ?? 2.5,
    interval_days: p.interval_days ?? 0,
  };
}

async function insertVocabularyBatched(rows, batchSize = 500) {
  const all = [];
  for (let i = 0; i < rows.length; i += batchSize) {
    const batch = rows.slice(i, i + batchSize);
    try {
      all.push(...(await insertVocabulary(batch)));
    } catch (error) {
      if (!/duplicate key|unique/i.test(error.message || '')) throw error;
      for (const row of batch) {
        try {
          all.push(...(await insertVocabulary([row])));
        } catch {
          // trùng với kho hiện có hoặc dòng lỗi: bỏ qua
        }
      }
    }
  }
  return all;
}

/* -------------------------------------------------------------------------- */
/* DELETE ALL                                                                  */
/* -------------------------------------------------------------------------- */
async function deleteEverything() {
  const ok = await confirmDialog({
    title: 'Xoá toàn bộ dữ liệu',
    message:
      'Tất cả từ vựng và lịch sử học của phiên này sẽ bị xoá vĩnh viễn trên Supabase. Bạn nên xuất JSON sao lưu trước.',
    okText: 'Xoá vĩnh viễn',
    danger: true,
  });
  if (!ok) return;

  const confirmText = await new Promise((resolve) => {
    const dialog = el('dialog', { class: 'modal' });
    const input = el('input', { class: 'input', placeholder: 'Nhập XOA để xác nhận' });
    const close = (v) => {
      dialog.close();
      dialog.remove();
      resolve(v);
    };
    dialog.append(
      el('form', {
        method: 'dialog',
        class: 'modal-body',
        onsubmit: (e) => {
          e.preventDefault();
          close(input.value);
        },
      }, [
        el('h2', { class: 'modal-title' }, 'Xác nhận lần cuối'),
        input,
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close(null) }, 'Huỷ'),
          el('button', { class: 'btn btn-danger', type: 'submit' }, 'Xoá'),
        ]),
      ]),
    );
    document.body.appendChild(dialog);
    dialog.showModal();
  });

  if (String(confirmText || '').trim().toUpperCase() !== 'XOA') {
    toast('Đã huỷ.', 'info');
    return;
  }

  try {
    await deleteAllUserData();
    await refreshAll();
    invalidateCalendarCache();
    toast('Đã xoá toàn bộ dữ liệu.', 'success');
  } catch (error) {
    toast(getErrorMessage(error), 'error');
  }
}
