/* =============================================================================
 * dictionary.js - Tra từ điển: chữ Hán, pinyin (bỏ dấu), nghĩa tiếng Việt
 * ============================================================================= */

import { searchVocabulary, addFavorite, removeFavorite } from './api.js';
import { state, setFavoriteLocal } from './store.js';
import { esc, el, toast, speak, speakable, labelTopic, getErrorMessage, debounce, labelHsk } from './ui.js';

let onReviewRequest = () => {};

export function setupDictionary({ onReview } = {}) {
  if (onReview) onReviewRequest = onReview;

  const form = document.getElementById('search-form');
  const input = document.getElementById('search-input');
  const results = document.getElementById('search-results');
  const hint = document.getElementById('search-hint');
  const filters = document.getElementById('quick-filters');

  let query = '';
  let page = 0;
      let filtersActive = { hsk: '', topic: '' };

  const runSearch = debounce(async (reset = true) => {
    const q = input.value.trim();
    query = q;
    if (!q) {
      page = 0;
      results.innerHTML = '';
      if (hint) {
        hint.hidden = false;
        results.appendChild(hint);
      }
      return;
    }
    if (reset) {
      page = 0;
      results.innerHTML = '<p class="muted empty-hint"><span class="spinner"></span> Đang tìm…</p>';
    }
    try {
      const rows = await searchVocabulary(q, { limit: 20, offset: page * 20 });
      const filtered = applyFilters(rows);
      if (reset) results.innerHTML = '';

      if (reset && !filtered.length) {
        results.innerHTML = `<p class="muted empty-hint">Không tìm thấy từ nào cho “<strong>${esc(q)}</strong>”.
          <br>Thử tra bằng chữ Hán hoặc pinyin không dấu (vd: <code>xuexi</code>).</p>`;
        return;
      }

      const frag = document.createDocumentFragment();
      for (const row of filtered) frag.appendChild(renderEntry(row));
      results.appendChild(frag);

      if (rows.length === 20) {
        const moreBtn = el('button', {
          class: 'btn btn-outline',
          type: 'button',
          onclick: () => {
            page += 1;
            runSearch(false);
          },
        }, 'Tải thêm kết quả');
        results.appendChild(el('div', { class: 'load-more-wrap' }, [moreBtn]));
      }
    } catch (error) {
      results.innerHTML = `<div class="boot-error">${esc(getErrorMessage(error))}</div>`;
    }
  }, 200);

  form?.addEventListener('submit', (e) => {
    e.preventDefault();
    runSearch(true);
  });
  input?.addEventListener('input', () => runSearch(true));

  // Lọc nhanh theo HSK / chủ đề
  if (filters) {
    const hskLevels = ['', 'HSK 1', 'HSK 2', 'HSK 3', 'HSK 4', 'HSK 5', 'HSK 6'];
    const topics = [['', 'Tất cả chủ đề'], ...Object.entries(topicOptions())];
    const hskRow = el('div', { class: 'chip-row', style: { margin: '0 0 0.4rem' } });
    hskLevels.forEach((lvl) => {
      const chip = el('button', {
        type: 'button',
        class: `chip${lvl === '' ? ' is-active' : ''}`,
        dataset: { filter: 'hsk', value: lvl },
      }, lvl || 'Mọi cấp độ');
      hskRow.appendChild(chip);
    });
    const topicRow = el('div', { class: 'chip-row', style: { margin: '0 0 1rem' } });
    topics.forEach(([value, label]) => {
      const chip = el('button', {
        type: 'button',
        class: `chip${value === '' ? ' is-active' : ''}`,
        dataset: { filter: 'topic', value },
      }, label);
      topicRow.appendChild(chip);
    });
    filters.append(hskRow, topicRow);

    filters.addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      const kind = chip.dataset.filter;
      const value = chip.dataset.value;
      filtersActive[kind] = value;
      chip.parentElement.querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c === chip));
      if (query) runSearch(true);
    });
  }

  function applyFilters(rows) {
    return rows.filter((r) => {
      if (filtersActive.hsk && r.hsk !== filtersActive.hsk) return false;
      if (filtersActive.topic && r.topic !== filtersActive.topic) return false;
      return true;
    });
  }

  return { search: (q) => {
    input.value = q;
    runSearch(true);
  } };
}

function topicOptions() {
  const map = {};
  for (const row of state.rows) {
    if (row.topic && !map[row.topic]) map[row.topic] = labelTopic(row.topic);
  }
  return map;
}

/** Tạo card hiển thị một từ. */
export function renderEntry(row, { compact = false } = {}) {
  const progress = state.rows.find((r) => r.id === row.id)?.progress || null;
  const favorite = Boolean(state.rows.find((r) => r.id === row.id)?.favorite);
  const card = el('article', { class: 'entry-card', dataset: { id: row.id } });

  const head = el('div');
  head.append(
    el('div', { class: 'entry-top' }, [
      el('h2', { class: 'entry-word han', lang: 'zh' }, row.word),
      el('button', {
        class: 'btn btn-outline btn-icon',
        type: 'button',
        title: 'Nghe phát âm',
        'aria-label': `Nghe phát âm ${row.word}`,
        onclick: () => {
          if (!speakable(row.word)) return toast('Trình duyệt không hỗ trợ phát âm.', 'error');
          speak(row.word);
        },
      }, '🔊'),
    ]),
    el('p', { class: 'entry-pinyin' }, row.pinyin),
    el('div', { class: 'entry-meta' }, [
      row.pos ? el('span', { class: 'tag' }, row.pos) : null,
      row.hsk ? el('span', { class: 'tag tag-blue' }, labelHsk(row.hsk)) : null,
      row.topic ? el('span', { class: 'tag tag-green' }, labelTopic(row.topic)) : null,
      progress?.status === 'mastered' ? el('span', { class: 'tag tag-green' }, 'Thành thạo') : null,
    ]),
    el('p', { class: 'entry-meaning' }, row.meaning),
  );

  if (!compact && (row.example || row.example_meaning || row.example_pinyin)) {
    head.appendChild(
      el('div', { class: 'entry-example' }, [
        el('div', { class: 'han', lang: 'zh' }, row.example || ''),
        el('div', { class: 'pinyin-line' }, row.example_pinyin || ''),
        el('div', { class: 'vi-line' }, row.example_meaning || ''),
        row.example && speakable(row.example)
          ? el('button', {
              class: 'btn btn-ghost btn-sm',
              type: 'button',
              onclick: () => speak(row.example),
            }, '🔊 Nghe câu')
          : null,
      ]),
    );
  }

  const favBtn = el('button', {
    class: `btn btn-outline btn-sm${favorite ? ' is-on' : ''}`,
    type: 'button',
    onclick: async () => {
      const isFav = favBtn.classList.contains('is-on');
      favBtn.disabled = true;
      try {
        if (isFav) await removeFavorite(row.id);
        else await addFavorite(row.id);
        favBtn.classList.toggle('is-on', !isFav);
        setFavoriteLocal(row.id, !isFav);
        favBtn.textContent = !isFav ? '★ Yêu thích' : '☆ Yêu thích';
        toast(!isFav ? 'Đã thêm vào yêu thích.' : 'Đã bỏ yêu thích.', 'success', 1800);
      } catch (error) {
        toast(getErrorMessage(error), 'error');
      } finally {
        favBtn.disabled = false;
      }
    },
  }, favorite ? '★ Yêu thích' : '☆ Yêu thích');

  head.appendChild(
    el('div', { class: 'entry-actions' }, [
      favBtn,
      el('button', {
        class: 'btn btn-primary btn-sm',
        type: 'button',
        onclick: () => onReviewRequest(row),
      }, 'Đưa vào danh sách ôn tập'),
    ]),
  );

  card.appendChild(head);
  return card;
}
