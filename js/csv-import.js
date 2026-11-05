/* =============================================================================
 * csv-import.js - Nhập từ vựng từ CSV
 * 1. Chọn file → 2. Kiểm tra 9 trường + xem trước → 3. Xử lý từ trùng →
 * 4. Import theo batch → 5. Báo cáo kết quả (tải báo cáo lỗi CSV)
 * ============================================================================= */

import { analyzeCsv, toCsvText, errorReportCsv, CSV_HEADER } from './csv-parser.js';
import { findExistingWords, importVocabulary } from './api.js';
import { refreshAll, state } from './store.js';
import { el, esc, toast, downloadBlob, getErrorMessage, progressBar, setBusy } from './ui.js';

const PREVIEW_LIMIT = 100;

let flow = {
  fileName: '',
  analysis: null,
  existing: new Map(),
  mode: 'skip',
};

let mounted = false;

export function mountImport() {
  const panel = document.getElementById('import-panel');
  if (!panel) return;
  if (!mounted) {
    mounted = true;
    resetFlow();
  }
}

export function resetFlow() {
  flow = { fileName: '', analysis: null, existing: new Map(), mode: 'skip' };
  renderStep1();
  setStep(1);
}

function setStep(step, done = []) {
  document.querySelectorAll('#import-steps .step').forEach((node) => {
    const n = Number(node.dataset.step);
    node.classList.toggle('is-active', n === step);
    node.classList.toggle('is-done', done.includes(n));
  });
}

function panel() {
  return document.getElementById('import-panel');
}

/* -------------------------------------------------------------------------- */
/* STEP 1: chọn file                                                           */
/* -------------------------------------------------------------------------- */
function renderStep1() {
  const host = panel();
  if (!host) return;
  host.innerHTML = '';
  const input = el('input', { type: 'file', accept: '.csv,text/csv', id: 'csv-file', hidden: true });

  const drop = el('label', { class: 'file-drop', id: 'csv-drop', for: 'csv-file' }, [
    el('strong', {}, 'Chọn file CSV'),
    el('span', { class: 'muted small' }, 'Hỗ trợ UTF-8 / UTF-8 BOM · tiếng Trung & tiếng Việt · file lớn'),
  ]);

  drop.addEventListener('dragover', (e) => {
    e.preventDefault();
    drop.classList.add('is-drag');
  });
  drop.addEventListener('dragleave', () => drop.classList.remove('is-drag'));
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    drop.classList.remove('is-drag');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });
  input.addEventListener('change', () => {
    if (input.files?.[0]) handleFile(input.files[0]);
  });

  const sample = toCsvText([
    {
      word: '学习',
      pinyin: 'xuéxí',
      pos: 'Động từ',
      meaning: 'Học, học tập',
      hsk: 'HSK 1',
      topic: 'school',
      example: '我每天学习中文。',
      example_pinyin: 'Wǒ měitiān xuéxí Zhōngwén.',
      example_meaning: 'Tôi học tiếng Trung mỗi ngày.',
    },
    {
      word: '朋友',
      pinyin: 'péngyou',
      pos: 'Danh từ',
      meaning: 'Bạn bè',
      hsk: 'HSK 1',
      topic: 'daily',
      example: '他是我的好朋友。',
      example_pinyin: 'Tā shì wǒ de hǎo péngyou.',
      example_meaning: 'Anh ấy là bạn thân của tôi.',
    },
  ]);

  host.append(
    input,
    el('div', { class: 'stack' }, [
      el('div', { class: 'button-row wrap' }, [
        el('a', { class: 'btn btn-ghost', href: '#vocabulary' }, '‹ Kho từ vựng'),
        el('a', { class: 'btn btn-ghost', href: '#settings' }, 'Sao lưu dữ liệu'),
      ]),
      drop,
      el('p', { class: 'muted small' }, `Thứ tự cột bắt buộc: ${CSV_HEADER.join(', ')}. Chỉ word, pinyin, meaning là bắt buộc.`),
      el('div', { class: 'button-row wrap' }, [
        el('button', {
          class: 'btn btn-outline',
          type: 'button',
          onclick: () => downloadBlob('mau-tu-vung-9-truong.csv', sample, 'text/csv;charset=utf-8'),
        }, 'Tải file CSV mẫu'),
        el('a', { class: 'btn btn-ghost', href: './assets/sample-vocabulary.csv', download: 'hanngu-sample.csv' }, 'File mẫu nhiều từ'),
      ]),
      el('div', { id: 'import-file-status' }),
    ]),
  );
  setStep(1);
}

async function handleFile(file) {
  if (!/\.csv$/i.test(file.name)) {
    toast('Vui lòng chọn file .csv', 'error');
    return;
  }
  flow.fileName = file.name;
  const status = document.getElementById('import-file-status');
  if (status) status.innerHTML = `<p class="muted"><span class="spinner"></span> Đang phân tích “${esc(file.name)}”…</p>`;

  try {
    const text = await readFileText(file);
    const analysis = analyzeCsv(text);
    flow.analysis = analysis;
    if (!analysis.rows.length) {
      status.innerHTML = `<div class="boot-error"><strong>Không đọc được dữ liệu.</strong><br>${analysis.errors
        .slice(0, 3)
        .map((e) => esc(e.message))
        .join('<br>')}</div>`;
      setStep(2);
      return;
    }
    await renderStep2();
  } catch (error) {
    toast(`Không đọc được file: ${getErrorMessage(error)}`, 'error');
    if (status) status.innerHTML = '';
  }
}

/** Đọc file: thử UTF-8 trước, nếu có ký tự lỗi thì thử windows-1258 (tiếng Việt cũ). */
async function readFileText(file) {
  const buffer = await file.arrayBuffer();
  const utf8 = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
  if (!utf8.includes('\uFFFD')) return utf8;
  try {
    return new TextDecoder('windows-1258').decode(buffer);
  } catch {
    return utf8;
  }
}

/* -------------------------------------------------------------------------- */
/* STEP 2: xem trước + kiểm tra trùng                                          */
/* -------------------------------------------------------------------------- */
async function renderStep2() {
  const host = panel();
  const analysis = flow.analysis;
  host.innerHTML = `<p class="muted"><span class="spinner"></span> Đang kiểm tra từ trùng với kho hiện tại…</p>`;

  const words = analysis.rows.map((r) => r.data.word);
  try {
    flow.existing = await findExistingWords(words);
  } catch (error) {
    host.innerHTML = `<div class="boot-error">${esc(getErrorMessage(error))}</div>`;
    return;
  }

  const dupInDb = analysis.rows.filter((r) => flow.existing.has(r.data.word)).length;
  const newInDb = analysis.rows.length - dupInDb;
  setStep(2, [1]);

  host.innerHTML = '';
  host.append(
    el('div', { class: 'import-summary-cards' }, [
      miniStat(analysis.total, 'Tổng số dòng', 'is-new'),
      miniStat(analysis.rows.length, 'Dòng hợp lệ', 'is-updated'),
      miniStat(dupInDb, 'Từ đã tồn tại', 'is-skipped'),
      miniStat(newInDb, 'Từ hoàn toàn mới', 'is-new'),
      miniStat(analysis.errors.length, 'Dòng lỗi', 'is-failed'),
    ]),
    el('p', { class: 'muted small' }, `File: ${esc(flow.fileName)}`),
    el('h2', {}, 'Xem trước ' + Math.min(PREVIEW_LIMIT, analysis.rows.length) + ' dòng đầu'),
    renderPreviewTable(analysis.rows.slice(0, PREVIEW_LIMIT)),
  );

  if (analysis.errors.length) {
    host.append(
      el('details', { class: 'card', style: { marginTop: '1rem', padding: '0.9rem' } }, [
        el('summary', {}, `Có ${analysis.errors.length} dòng lỗi (không được import)`),
        el('div', { class: 'preview-table', style: { marginTop: '0.75rem' } }, [renderErrorTable(analysis.errors.slice(0, 200))]),
        el('button', {
          class: 'btn btn-outline btn-sm',
          type: 'button',
          style: { marginTop: '0.6rem' },
          onclick: () => downloadBlob('loi-import.csv', errorReportCsv(analysis.errors), 'text/csv;charset=utf-8'),
        }, 'Tải báo cáo lỗi CSV'),
      ]),
    );
  }

  host.append(
    el('div', { class: 'button-row wrap', style: { marginTop: '1rem' } }, [
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: resetFlow }, 'Chọn file khác'),
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        onclick: renderStep3,
      }, 'Tiếp tục'),
    ]),
  );
}

function miniStat(value, label, cls) {
  return el('div', { class: `mini-stat ${cls}` }, [el('b', {}, String(value)), el('span', {}, label)]);
}

function renderPreviewTable(rows) {
  const table = el('table', { class: 'data-table' });
  table.innerHTML = `<thead><tr><th>#</th><th>Chữ Hán</th><th>Pinyin</th><th>Từ loại</th><th>Nghĩa</th><th>HSK</th><th>Chủ đề</th><th>Trạng thái</th></tr></thead>`;
  const tbody = el('tbody');
  rows.forEach((row, i) => {
    const d = row.data;
    const dup = flow.existing.has(d.word);
    const tr = el('tr');
    tr.innerHTML = `<td>${row.line}</td>
      <td class="han">${esc(d.word)}</td>
      <td class="pinyin-cell">${esc(d.pinyin)}</td>
      <td>${esc(d.pos)}</td>
      <td>${esc(d.meaning)}</td>
      <td>${esc(d.hsk)}</td>
      <td>${esc(d.topic)}</td>
      <td>${dup ? '<span class="tag tag-amber">Đã tồn tại</span>' : '<span class="tag tag-green">Mới</span>'}</td>`;
    tbody.appendChild(tr);
    if (i === rows.length - 1 && flow.analysis.rows.length > rows.length) {
      const more = el('tr');
      more.innerHTML = `<td colspan="8" class="row-muted">… và ${flow.analysis.rows.length - rows.length} dòng khác</td>`;
      tbody.appendChild(more);
    }
  });
  table.appendChild(tbody);
  return el('div', { class: 'preview-table' }, [table]);
}

function renderErrorTable(errors) {
  const table = el('table', { class: 'data-table' });
  table.innerHTML = `<thead><tr><th>Dòng</th><th>Loại</th><th>Mô tả</th></tr></thead>`;
  const tbody = el('tbody');
  for (const e of errors) {
    const tr = el('tr', { class: 'err-row' });
    tr.innerHTML = `<td>${e.line}</td><td>${esc(e.type)}</td><td>${esc(e.message)}</td>`;
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  return table;
}

/* -------------------------------------------------------------------------- */
/* STEP 3: chọn cách xử lý từ trùng                                            */
/* -------------------------------------------------------------------------- */
function renderStep3() {
  setStep(3, [1, 2]);
  const host = panel();
  const analysis = flow.analysis;
  const dupCount = analysis.rows.filter((r) => flow.existing.has(r.data.word)).length;
  host.innerHTML = '';

  const option = (value, title, desc) =>
    el('label', { class: 'radio-card' }, [
      el('input', {
        type: 'radio',
        name: 'dup-mode',
        value,
        checked: flow.mode === value,
        onchange: () => {
          flow.mode = value;
        },
      }),
      el('div', {}, [el('strong', {}, title), el('span', { class: 'muted' }, desc)]),
    ]);

  host.append(
    el('h2', {}, 'Cách xử lý từ trùng'),
    el('p', { class: 'muted small' }, `Từ trùng được xác định theo (người dùng, chữ Hán). Có ${dupCount} từ trong file đã tồn tại.`),
    el('div', { class: 'radio-cards' }, [
      option('skip', 'Bỏ qua từ đã tồn tại', 'Giữ nguyên dữ liệu cũ và toàn bộ lịch sử học của từ.'),
      option('update', 'Cập nhật thông tin từ đã tồn tại', 'Chỉ cập nhật nội dung từ vựng. Giữ nguyên lịch ôn, trạng thái ghi nhớ và số lần ôn.'),
    ]),
    el('div', { class: 'button-row wrap', style: { marginTop: '1.2rem' } }, [
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: renderStep2 }, 'Quay lại'),
      el('button', { class: 'btn btn-primary', type: 'button', id: 'import-run', onclick: runImport }, 'Xác nhận import'),
    ]),
    el('div', { id: 'import-progress' }),
  );
}

/* -------------------------------------------------------------------------- */
/* STEP 4: import + báo cáo                                                    */
/* -------------------------------------------------------------------------- */
async function runImport() {
  const runBtn = document.getElementById('import-run');
  const progressHost = document.getElementById('import-progress');
  const analysis = flow.analysis;
  setBusy(runBtn, true, 'Đang import…');
  progressHost.innerHTML = '';
  const bar = progressBar(0, analysis.rows.length);
  const text = el('p', { class: 'muted small' }, `0 / ${analysis.rows.length} dòng`);
  progressHost.append(bar, text);

  try {
    const result = await importVocabulary({
      rows: analysis.rows.map((r) => r.data),
      mode: flow.mode,
      existingWordIds: flow.existing,
      batchSize: 500,
      onProgress: ({ processed, total }) => {
        const pct = total ? Math.round((processed / total) * 100) : 0;
        bar.querySelector('span').style.width = `${pct}%`;
        text.textContent = `${processed} / ${total} dòng (${pct}%)`;
      },
    });

    // Đồng bộ lại dữ liệu trong bộ nhớ để trang chủ/kho từ hiển thị đúng.
    await refreshAll();

    renderReport(result, analysis);
    setStep(4, [1, 2, 3]);
  } catch (error) {
    progressHost.append(el('div', { class: 'boot-error' }, getErrorMessage(error)));
    setBusy(runBtn, false);
  }
}

function renderReport(result, analysis) {
  setStep(4, [1, 2, 3]);
  const host = panel();
  const s = result.summary;
  host.innerHTML = '';

  const failedRows = result.failed.map((f) => ({ line: '', type: 'db_error', message: `${f.word}: ${f.error}`, raw: f.word }));
  const reportRows = [
    ...analysis.errors.map((e) => ({ line: e.line, type: e.type, message: e.message, raw: e.raw || '' })),
    ...failedRows,
  ];

  host.append(
    el('h2', {}, 'Kết quả import'),
    el('div', { class: 'import-summary-cards' }, [
      miniStat(s.total, 'Tổng số dòng', ''),
      miniStat(s.inserted, 'Từ mới', 'is-new'),
      miniStat(s.updated, 'Từ cập nhật', 'is-updated'),
      miniStat(s.skipped, 'Từ bỏ qua', 'is-skipped'),
      miniStat(s.failed + analysis.errors.length, 'Dòng lỗi', 'is-failed'),
    ]),
    el('p', { class: 'muted small' }, `Tổng từ trong kho hiện tại: ${state.rows.length}`),
    el('div', { class: 'button-row wrap' }, [
      reportRows.length
        ? el('button', {
            class: 'btn btn-outline',
            type: 'button',
            onclick: () => downloadBlob('bao-cao-import-loi.csv', errorReportCsv(reportRows), 'text/csv;charset=utf-8'),
          }, 'Tải báo cáo lỗi CSV')
        : null,
      el('button', {
        class: 'btn btn-outline',
        type: 'button',
        onclick: () => downloadBlob(
          'kho-tu-vung.csv',
          toCsvText(state.rows.map(({ id, progress, favorite, user_id, created_at, updated_at, ...rest }) => rest)),
          'text/csv;charset=utf-8',
        ),
      }, 'Tải kho từ vựng CSV'),
      el('a', { class: 'btn btn-primary', href: '#vocabulary' }, 'Mở kho từ vựng'),
      el('button', { class: 'btn btn-ghost', type: 'button', onclick: resetFlow }, 'Import file khác'),
    ]),
  );
}
