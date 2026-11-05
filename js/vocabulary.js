/* =============================================================================
 * vocabulary.js - Trang Kho từ vựng: lọc, tìm, thêm, sửa, xoá, xuất CSV
 * ============================================================================= */

import {
  listVocabularyPage,
  insertVocabulary,
  updateVocabulary,
  deleteVocabulary,
  removeFavorite,
  searchVocabulary,
} from './api.js';
import { state, addVocabularyLocal, updateVocabularyLocal, removeVocabularyLocal } from './store.js';
import { toCsvText, CSV_HEADER } from './csv-parser.js';
import {
  el,
  toast,
  esc,
  confirmDialog,
  downloadBlob,
  getErrorMessage,
  labelHsk,
  labelTopic,
  formatDateTime,
} from './ui.js';

const PAGE_SIZE = 50;
let page = 0;
let total = 0;
let filters = { hsk: '', topic: '', search: '', sort: 'newest' };
let mounted = false;
let searchTimer = null;

export function mountVocabulary() {
  const hsk = document.getElementById('vocab-hsk');
  const topic = document.getElementById('vocab-topic');
  const sort = document.getElementById('vocab-sort');
  const search = document.getElementById('vocab-search');
  const addBtn = document.getElementById('vocab-add');
  const exportBtn = document.getElementById('vocab-export');
  if (!hsk || mounted) return;
  mounted = true;

  // Đổ danh sách chủ đề có trong kho.
  const topicMap = new Map();
  for (const row of state.rows) if (row.topic) topicMap.set(row.topic, labelTopic(row.topic));
  for (const [value, label] of topicMap) topic.appendChild(el('option', { value }, label));

  hsk.addEventListener('change', () => {
    filters.hsk = hsk.value;
    page = 0;
    renderTable();
  });
  topic.addEventListener('change', () => {
    filters.topic = topic.value;
    page = 0;
    renderTable();
  });
  sort.addEventListener('change', () => {
    filters.sort = sort.value;
    page = 0;
    renderTable();
  });
  search.addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      filters.search = search.value.trim().toLowerCase();
      page = 0;
      renderTable();
    }, 250);
  });

  addBtn.addEventListener('click', addVocabularyFlow);
  exportBtn.addEventListener('click', exportCsv);
}

export async function renderVocabulary() {
  if (!mounted) mountVocabulary();
  await renderTable();
}

function matchesSearch(row, q) {
  if (!q) return true;
  const plain = (value) =>
    String(value || '')
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');
  return (
    (row.word || '').includes(q) ||
    (row.pinyin || '').toLowerCase().includes(q) ||
    plain(row.pinyin).includes(plain(q)) ||
    (row.meaning || '').toLowerCase().includes(q)
  );
}

async function renderTable() {
  const wrap = document.getElementById('vocab-table-wrap');
  const pager = document.getElementById('vocab-pagination');
  if (!wrap) return;
  wrap.innerHTML = '<p class="muted" style="padding:1rem"><span class="spinner"></span> Đang tải…</p>';

  try {
    if (filters.search) {
      const rows = await searchVocabulary(filters.search, { limit: 100, offset: 0 });
      const filtered = rows.filter(
        (r) =>
          (!filters.hsk || r.hsk === filters.hsk) &&
          (!filters.topic || r.topic === filters.topic) &&
          matchesSearch(r, filters.search),
      );
      total = filtered.length;
      const progressMap = new Map(state.rows.map((r) => [r.id, r.progress]));
      const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      renderRows(wrap, pageRows.map((r) => ({ ...r, progress: progressMap.get(r.id) || null })));
    } else {
      const { rows, count } = await listVocabularyPage({
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
        hsk: filters.hsk,
        topic: filters.topic,
        sort: filters.sort,
      });
      total = count;
      const progressMap = new Map(state.rows.map((r) => [r.id, r.progress]));
      renderRows(wrap, rows.map((r) => ({ ...r, progress: progressMap.get(r.id) || null })));
    }
    renderPager(pager);
  } catch (error) {
    wrap.innerHTML = `<div class="boot-error" style="margin:1rem">${esc(getErrorMessage(error))}</div>`;
  }
}

function renderRows(wrap, rows) {
  wrap.innerHTML = '';
  if (!rows.length) {
    wrap.append(
      el('div', { class: 'empty-state' }, [
        el('h2', {}, 'Chưa có từ nào'),
        el('p', { class: 'muted' }, 'Hãy nhập CSV hoặc thêm từ thủ công.'),
        el('a', { class: 'btn btn-primary', href: '#import' }, 'Nhập CSV'),
      ]),
    );
    return;
  }
  const table = el('table', { class: 'data-table' });
  table.innerHTML = `<thead><tr>
      <th>Chữ Hán</th><th>Pinyin</th><th>Từ loại</th><th>Nghĩa</th><th>HSK</th><th>Chủ đề</th><th>Trạng thái</th><th></th>
    </tr></thead>`;
  const tbody = el('tbody');
  for (const row of rows) {
    const status = row.progress?.status;
    const statusLabel =
      {
        new: 'Mới',
        learning: 'Đang học',
        review: 'Đang ôn',
        remembered: 'Đã nhớ',
        mastered: 'Thành thạo',
      }[status] || (row.progress ? 'Đã học' : 'Chưa học');
    const tr = el('tr');
    tr.innerHTML = `
      <td class="han" lang="zh">${esc(row.word)}</td>
      <td class="pinyin-cell">${esc(row.pinyin)}</td>
      <td>${esc(row.pos || '')}</td>
      <td>${esc(row.meaning || '')}${row.example ? `<div class="muted small han">${esc(row.example)}</div>` : ''}</td>
      <td>${esc(labelHsk(row.hsk))}</td>
      <td>${esc(labelTopic(row.topic))}</td>
      <td><span class="tag ${status === 'mastered' ? 'tag-green' : status === 'learning' ? 'tag-amber' : ''}">${statusLabel}</span>
      ${row.progress?.next_review_at ? `<div class="muted small">Ôn: ${esc(formatDateTime(row.progress.next_review_at))}</div>` : ''}</td>
      <td class="actions-cell"></td>`;
    const actions = tr.querySelector('.actions-cell');
    actions.append(
      el('button', { class: 'btn btn-ghost btn-sm', type: 'button', onclick: () => editVocabularyFlow(row) }, 'Sửa'),
      el('button', {
        class: 'btn btn-ghost btn-sm',
        type: 'button',
        onclick: () => deleteVocabularyFlow(row),
      }, 'Xoá'),
      row.favorite
        ? el('button', {
            class: 'btn btn-ghost btn-sm',
            type: 'button',
            title: 'Bỏ yêu thích',
            onclick: async () => {
              try {
                await removeFavorite(row.id);
                toast('Đã bỏ yêu thích.', 'success');
                renderTable();
              } catch (error) {
                toast(getErrorMessage(error), 'error');
              }
            },
          }, '★')
        : null,
    );
    tbody.appendChild(tr);
  }
  table.appendChild(tbody);
  wrap.appendChild(table);
}

async function deleteVocabularyFlow(row) {
  const ok = await confirmDialog({
    title: 'Xoá từ',
    message: `Xoá “<b>${esc(row.word)}</b>” cùng toàn bộ lịch sử học của từ này?`,
    okText: 'Xoá',
    danger: true,
  });
  if (!ok) return;
  try {
    await deleteVocabulary(row.id);
    removeVocabularyLocal(row.id);
    toast('Đã xoá từ.', 'success');
    renderTable();
  } catch (error) {
    toast(getErrorMessage(error), 'error');
  }
}

function renderPager(host) {
  if (!host) return;
  host.innerHTML = '';
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  host.append(
    el('button', {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      disabled: page === 0,
      onclick: () => {
        page = Math.max(0, page - 1);
        renderTable();
      },
    }, '‹ Trước'),
    el('span', {}, `Trang ${page + 1} / ${pages} · ${total} từ`),
    el('button', {
      class: 'btn btn-ghost btn-sm',
      type: 'button',
      disabled: page + 1 >= pages,
      onclick: () => {
        page += 1;
        renderTable();
      },
    }, 'Sau ›'),
  );
}

/* -------------------------------------------------------------------------- */
/* THÊM / SỬA TỪ THỦ CÔNG                                                      */
/* -------------------------------------------------------------------------- */
function vocabForm(defaults = {}) {
  return new Promise((resolve) => {
    const dialog = el('dialog', { class: 'modal', style: { width: 'min(96vw, 560px)' } });
    const field = (name, label, { type = 'text', required = false, rows } = {}) => {
      const input = rows
        ? el('textarea', { class: 'input', name, rows, value: defaults[name] || '' })
        : el('input', { class: 'input', type, name, value: defaults[name] || '', required });
      return el('label', { class: 'field' }, [el('span', {}, label + (required ? ' *' : '')), input]);
    };
    const close = (value) => {
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    dialog.append(
      el('form', {
        method: 'dialog',
        class: 'modal-body',
        onsubmit: (e) => {
          e.preventDefault();
          close(Object.fromEntries(new FormData(e.target).entries()));
        },
      }, [
        el('h2', { class: 'modal-title' }, defaults.id ? 'Sửa từ vựng' : 'Thêm từ vựng'),
        el('div', { class: 'form-grid' }, [
          field('word', 'Chữ Hán', { required: true }),
          field('pinyin', 'Pinyin', { required: true }),
          field('pos', 'Từ loại'),
          field('meaning', 'Nghĩa tiếng Việt', { required: true }),
          field('hsk', 'HSK (ví dụ: HSK 1)'),
          field('topic', 'Chủ đề (ví dụ: school)'),
        ]),
        field('example', 'Câu ví dụ', { rows: 2 }),
        field('example_pinyin', 'Pinyin câu ví dụ'),
        field('example_meaning', 'Nghĩa câu ví dụ'),
        el('div', { class: 'modal-actions' }, [
          el('button', { class: 'btn btn-ghost', type: 'button', onclick: () => close(null) }, 'Huỷ'),
          el('button', { class: 'btn btn-primary', type: 'submit' }, 'Lưu'),
        ]),
      ]),
    );
    document.body.appendChild(dialog);
    dialog.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    dialog.showModal();
  });
}

async function addVocabularyFlow() {
  const data = await vocabForm();
  if (!data) return;
  try {
    const [row] = await insertVocabulary([data]);
    addVocabularyLocal({ ...data, ...row, progress: null, favorite: false });
    toast('Đã thêm từ mới.', 'success');
    renderTable();
  } catch (error) {
    if (/duplicate key|unique/i.test(error.message || '')) toast('Từ này đã có trong kho.', 'error');
    else toast(getErrorMessage(error), 'error');
  }
}

async function editVocabularyFlow(row) {
  const data = await vocabForm(row);
  if (!data) return;
  try {
    const updated = await updateVocabulary(row.id, data);
    updateVocabularyLocal(row.id, updated);
    toast('Đã cập nhật từ.', 'success');
    renderTable();
  } catch (error) {
    if (/duplicate key|unique/i.test(error.message || '')) toast('Chữ Hán này trùng với một từ khác trong kho.', 'error');
    else toast(getErrorMessage(error), 'error');
  }
}

function exportCsv() {
  const rows = state.rows.map((r) => Object.fromEntries(CSV_HEADER.map((k) => [k, r[k] || ''])));
  if (!rows.length) {
    toast('Kho từ đang trống.', 'error');
    return;
  }
  downloadBlob('kho-tu-vung.csv', toCsvText(rows), 'text/csv;charset=utf-8');
  toast(`Đã xuất ${rows.length} từ.`, 'success');
}
