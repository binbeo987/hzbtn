/* =============================================================================
 * quiz.js - Ôn từ vựng bằng trắc nghiệm
 * - Sinh câu hỏi: Hán tự → nghĩa, nghĩa → Hán tự, Hán tự → pinyin
 * - Ưu tiên từ đến hạn / tồn đọng (cùng hàng đợi với flashcard)
 * - Trả lời sai → đưa từ vào danh sách ôn ngay (RPC queue_for_review)
 * - Kết thúc lượt: lưu điểm cao nhất (LocalStorage) để xem thành tích
 * ============================================================================= */

import { state } from './store.js';
import { queueForReview } from './api.js';
import { buildDailyQueue } from './scheduler.js';
import { el, toast, speak, getErrorMessage } from './ui.js';

export const BEST_KEY = 'hanngu:quiz-best';
const COUNTS = [10, 20, 30];
const QUESTION_MODES = {
  han2mean: { label: 'Hán tự → nghĩa' },
  mean2han: { label: 'Nghĩa → Hán tự' },
  han2pinyin: { label: 'Hán tự → pinyin' },
};
const ALL_MODES = Object.keys(QUESTION_MODES);

let mounted = false;
let session = null; // { questions, index, answers, startedAt, finishedAt, mode, count }

/* -------------------------------------------------------------------------- */
/* TIỆN ÍCH                                                                    */
/* -------------------------------------------------------------------------- */
function shuffle(list) {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function cleanMeaning(meaning) {
  return String(meaning || '')
    .split(/[,;、\/]/)
    .map((s) => s.trim())
    .filter(Boolean)[0] || String(meaning || '').trim();
}

/** Chọn tối đa `count` từ, ưu tiên từ đến hạn/tồn đọng rồi tới từ đã học. */
function pickWords(count) {
  const plan = buildDailyQueue(state.rows, { new_words_per_day: count, max_words_per_day: count }, new Date(), state.settings?.timezone);
  const chosen = [];
  const seen = new Set();
  const add = (rows) => {
    for (const row of rows) {
      if (chosen.length >= count) return;
      if (seen.has(row.id) || !row.word || !row.meaning) continue;
      seen.add(row.id);
      chosen.push(row);
    }
  };

  add(plan.items.filter((r) => r.bucket !== 'new'));
  add(plan.items.filter((r) => r.bucket === 'new'));
  add(shuffle(state.rows.filter((r) => r.progress?.last_reviewed_at)));
  add(shuffle(state.rows.filter((r) => !r.progress?.last_reviewed_at)));
  return chosen;
}

/**
 * Tạo danh sách câu hỏi trắc nghiệm.
 * words: [{ id, word, pinyin, meaning, hsk, topic }]
 * pool : toàn bộ từ trong kho (để lấy đáp án nhiễu)
 */
export function buildQuestions(words, mode, pool = words) {
  const questions = [];
  const modes = mode === 'mix' ? ALL_MODES : [mode];

  for (const word of words) {
    const useMode = modes[Math.floor(Math.random() * modes.length)];
    let prompt = '';
    let answer = '';
    let answerKey = '';

    if (useMode === 'han2mean') {
      prompt = word.word;
      answer = cleanMeaning(word.meaning);
      answerKey = 'meaning';
    } else if (useMode === 'mean2han') {
      prompt = cleanMeaning(word.meaning);
      answer = word.word;
      answerKey = 'word';
    } else {
      prompt = word.word;
      answer = word.pinyin;
      answerKey = 'pinyin';
    }
    if (!prompt || !answer) continue;

    // Đáp án nhiễu: ưu tiên từ cùng HSK/chủ đề, khác đáp án đúng.
    const others = pool.filter((r) => r.id !== word.id && r[answerKey]);
    const priority = others.filter((r) => (r.hsk && r.hsk === word.hsk) || (r.topic && r.topic === word.topic));
    const pick = (list, n) => shuffle(list).filter((r) => {
      const value = answerKey === 'meaning' ? cleanMeaning(r.meaning) : r[answerKey];
      return value && value !== answer;
    }).slice(0, n);

    const distractors = [];
    const used = new Set([answer]);
    for (const r of [...pick(priority, 1), ...pick(others, 6)]) {
      const value = answerKey === 'meaning' ? cleanMeaning(r.meaning) : r[answerKey];
      if (used.has(value)) continue;
      used.add(value);
      distractors.push(value);
      if (distractors.length === 3) break;
    }
    if (distractors.length < 3) continue; // không đủ đáp án nhiễu

    questions.push({
      id: word.id,
      word,
      mode: useMode,
      prompt,
      answer,
      options: shuffle([answer, ...distractors]),
    });
  }

  return questions.slice(0, words.length);
}

function loadBest() {
  try {
    const data = JSON.parse(localStorage.getItem(BEST_KEY) || 'null');
    return data && typeof data === 'object' ? data : null;
  } catch {
    return null;
  }
}

function saveBest(score, total) {
  const best = loadBest();
  if (!best || score > best.score || (score === best.score && total > best.total)) {
    const next = { score, total, at: new Date().toISOString() };
    try {
      localStorage.setItem(BEST_KEY, JSON.stringify(next));
    } catch {
      /* bỏ qua */
    }
    return { best: next, isNew: true };
  }
  return { best, isNew: false };
}

/* -------------------------------------------------------------------------- */
/* GIAO DIỆN                                                                   */
/* -------------------------------------------------------------------------- */
export function mountQuiz() {
  if (mounted) return;
  mounted = true;
  // Nút "Bắt đầu"/"Chơi lại" được dựng động nên bắt sự kiện qua event delegation.
  const page = document.getElementById('page-quiz');
  page?.addEventListener('click', (event) => {
    if (event.target.closest('#quiz-start')) startQuiz();
    else if (event.target.closest('#quiz-restart')) restartQuiz();
    else if (event.target.closest('#quiz-review-wrong')) reviewWrongWords();
  });
}

export function renderQuiz() {
  mountQuiz();
  const host = document.getElementById('quiz-body');
  if (!host) return;

  if (!state.rows.length) {
    host.replaceChildren(
      el('div', { class: 'card empty-state' }, [
        el('h2', {}, 'Kho từ đang trống'),
        el('p', { class: 'muted' }, 'Nhập CSV hoặc thêm từ để bắt đầu chơi trắc nghiệm.'),
        el('a', { class: 'btn btn-primary', href: '#import' }, 'Nhập CSV'),
      ]),
    );
    return;
  }

  if (!session) {
    host.replaceChildren(renderSetup());
    return;
  }

  if (session.index >= session.questions.length) {
    host.replaceChildren(renderResult());
    return;
  }

  host.replaceChildren(renderQuestion());
}

function renderSetup() {
  const best = loadBest();
  const modes = Object.entries({ ...QUESTION_MODES, mix: { label: 'Ngẫu nhiên cả 3 kiểu' } });

  const modeField = el('div', { class: 'field' }, [
    el('span', {}, 'Kiểu câu hỏi'),
    el('div', { class: 'chip-row', style: { margin: '0.3rem 0 0' } },
      modes.map(([value, meta], i) =>
        el('label', { class: 'chip-radio' }, [
          el('input', { type: 'radio', name: 'quiz-mode', value, checked: i === 0 }),
          el('span', {}, meta.label),
        ]),
      )),
  ]);

  const countField = el('div', { class: 'field' }, [
    el('span', {}, 'Số câu'),
    el('div', { class: 'chip-row', style: { margin: '0.3rem 0 0' } },
      COUNTS.map((value, i) =>
        el('label', { class: 'chip-radio' }, [
          el('input', { type: 'radio', name: 'quiz-count', value: String(value), checked: i === 1 }),
          el('span', {}, `${value} câu`),
        ]),
      )),
  ]);

  return el('div', { class: 'card quiz-setup' }, [
    el('div', { class: 'card-head' }, [
      el('h2', {}, 'Chọn cách chơi'),
      best ? el('span', { class: 'tag tag-green' }, `Kỷ lục: ${best.score}/${best.total}`) : null,
    ]),
    el('p', { class: 'muted' }, 'Hệ thống ưu tiên từ đã đến hạn và từ tồn đọng. Trả lời sai, từ sẽ được xếp vào buổi ôn hôm nay.'),
    modeField,
    countField,
    el('div', { class: 'button-row wrap', style: { marginTop: '1rem' } }, [
      el('button', { class: 'btn btn-primary btn-lg', type: 'button', id: 'quiz-start' }, 'Bắt đầu chơi'),
    ]),
    best?.at ? el('p', { class: 'muted small' }, `Lần chơi tốt nhất: ${new Date(best.at).toLocaleString('vi-VN')}`) : null,
  ]);
}

export function startQuiz(options = {}) {
  if (typeof document === 'undefined') return;
  const mode = options.mode || document.querySelector('input[name="quiz-mode"]:checked')?.value || 'han2mean';
  const count = Number(options.count || document.querySelector('input[name="quiz-count"]:checked')?.value || 20);

  const words = pickWords(count);
  if (words.length < 4) {
    toast('Cần ít nhất 4 từ trong kho để tạo câu hỏi trắc nghiệm.', 'error');
    return;
  }

  const questions = buildQuestions(words, mode, state.rows);
  if (!questions.length) {
    toast('Chưa đủ dữ liệu (từ, nghĩa, pinyin) để tạo câu hỏi.', 'error');
    return;
  }
  if (questions.length < words.length) {
    toast('Kho từ hiện có ' + state.rows.length + ' từ nên buổi chơi chỉ có ' + questions.length + ' câu.', 'info', 4000);
  }

  session = {
    questions,
    index: 0,
    answers: [],
    startedAt: Date.now(),
    finishedAt: null,
    mode,
    count,
    streak: 0,
    bestStreak: 0,
  };
  renderQuiz();
}

function renderQuestion() {
  const q = session.questions[session.index];
  const total = session.questions.length;
  const score = session.answers.filter((a) => a.correct).length;
  const pct = Math.round((session.index / total) * 100);
  const isHanPrompt = q.mode !== 'mean2han';

  const optionButtons = q.options.map((value, i) =>
    el('button', {
      class: `quiz-option${q.mode === 'mean2han' ? ' is-han' : ''}`,
      type: 'button',
      dataset: { value },
      onclick: (e) => answerQuestion(value, e.currentTarget),
    }, [
      el('span', { class: 'quiz-key' }, String.fromCharCode(65 + i)),
      el('span', {}, value),
    ]),
  );

  return el('div', { class: 'quiz-play' }, [
    el('div', { class: 'quiz-topbar' }, [
      el('span', { class: 'review-progress-text' }, `Câu ${session.index + 1}/${total}`),
      el('div', { class: 'progress' }, [el('span', { style: { width: `${pct}%` } })]),
      el('span', { class: 'tag' }, `Đúng ${score}`),
      el('span', { class: 'tag tag-blue' }, `🔥 ${session.streak}`),
    ]),
    el('div', { class: 'card quiz-card' }, [
      el('p', { class: 'quiz-question-label' }, QUESTION_MODES[q.mode].label),
      el('div', { class: `quiz-prompt${isHanPrompt ? ' han' : ''}`, lang: 'zh' }, q.prompt),
      isHanPrompt
        ? el('button', {
            class: 'btn btn-outline btn-icon quiz-sound',
            type: 'button',
            title: 'Nghe phát âm',
            'aria-label': 'Nghe phát âm',
            onclick: (e) => {
              e.stopPropagation();
              speak(q.word.word);
            },
          }, '🔊')
        : null,
      el('div', { class: 'quiz-options', role: 'group', 'aria-label': 'Đáp án' }, optionButtons),
      el('p', { class: 'quiz-feedback', 'aria-live': 'polite' }, ''),
    ]),
    el('p', { class: 'muted small quiz-help' }, 'Mẹo: bấm 1–4 hoặc A–D để chọn nhanh.'),
  ]);
}

async function answerQuestion(value, button) {
  const q = session.questions[session.index];
  if (session.locked) return;
  session.locked = true;

  const correct = value === q.answer;
  const card = document.querySelector('.quiz-card');
  const feedback = document.querySelector('.quiz-feedback');
  const buttons = [...document.querySelectorAll('.quiz-option')];

  buttons.forEach((btn) => {
    btn.disabled = true;
    if (btn.dataset.value === q.answer) btn.classList.add('is-correct');
    if (btn === button && !correct) btn.classList.add('is-wrong');
  });

  if (correct) {
    session.streak += 1;
    session.bestStreak = Math.max(session.bestStreak, session.streak);
    if (feedback) feedback.className = 'quiz-feedback is-ok';
    if (feedback) feedback.textContent = `Chính xác! ${q.word.word} · ${q.word.pinyin} · ${cleanMeaning(q.word.meaning)}`;
    card?.classList.add('flash-ok');
  } else {
    session.streak = 0;
    if (feedback) feedback.className = 'quiz-feedback is-bad';
    if (feedback) {
      feedback.textContent = `Chưa đúng. Đáp án: ${q.answer}`;
      const detail = el('span', { class: 'quiz-detail' }, `${q.word.word} · ${q.word.pinyin} · ${cleanMeaning(q.word.meaning)}`);
      feedback.appendChild(detail);
    }
    card?.classList.add('flash-bad');
  }

  session.answers.push({ id: q.id, correct });

  // Trả lời sai → đưa từ vào danh sách ôn ngay (không chặn giao diện).
  if (!correct) {
    queueForReview(q.id).then((progress) => {
      const row = state.rows.find((r) => r.id === q.id);
      if (row && progress) row.progress = progress;
    }).catch((error) => console.warn('queue_for_review failed', getErrorMessage(error)));
  }

  setTimeout(() => {
    session.locked = false;
    session.index += 1;
    renderQuiz();
  }, correct ? 650 : 1300);
}

function renderResult() {
  const total = session.questions.length;
  const score = session.answers.filter((a) => a.correct).length;
  const pct = Math.round((score / total) * 100);
  const { best, isNew } = saveBest(score, total);
  const wrong = session.answers.filter((a) => !a.correct);

  return el('div', { class: 'card quiz-result' }, [
    el('p', { class: 'eyebrow' }, isNew ? 'Kỷ lục mới!' : 'Kết quả'),
    el('h2', {}, `${score}/${total} câu đúng`),
    el('div', { class: 'quiz-score-ring', style: { '--pct': `${pct}%` } }, [el('strong', {}, `${pct}%`)]),
    el('p', { class: 'muted' }, pct >= 90 ? 'Tuyệt vời! Bạn đã nhớ rất tốt.' : pct >= 60 ? 'Khá tốt, tiếp tục luyện thêm nhé.' : 'Cần ôn lại — các từ sai đã được xếp vào buổi ôn hôm nay.'),
    el('div', { class: 'import-summary-cards', style: { maxWidth: '520px', width: '100%' } }, [
      el('div', { class: 'mini-stat is-updated' }, [el('b', {}, score), el('span', {}, 'Đúng')]),
      el('div', { class: 'mini-stat is-failed' }, [el('b', {}, total - score), el('span', {}, 'Sai')]),
      el('div', { class: 'mini-stat is-new' }, [el('b', {}, session.bestStreak), el('span', {}, 'Chuỗi dài nhất')]),
      el('div', { class: 'mini-stat is-skipped' }, [el('b', {}, `${best.score}`), el('span', {}, 'Kỷ lục')]),
    ]),
    wrong.length
      ? el('div', { class: 'quiz-wrong-list' }, [
          el('p', { class: 'muted small' }, `Từ cần ôn lại (${wrong.length}):`),
          el('div', { class: 'chip-row' }, wrong.map((a) => {
            const row = state.rows.find((r) => r.id === a.id);
            return el('span', { class: 'tag tag-amber' }, `${row?.word || ''} · ${row?.pinyin || ''}`);
          })),
        ])
      : null,
    el('div', { class: 'review-done-actions' }, [
      el('button', { class: 'btn btn-primary', type: 'button', id: 'quiz-restart' }, 'Chơi lại'),
      wrong.length ? el('button', { class: 'btn btn-outline', type: 'button', id: 'quiz-review-wrong' }, 'Ôn tập các từ này') : null,
      el('a', { class: 'btn btn-ghost', href: '#home' }, 'Về trang chủ'),
    ]),
  ]);
}

/** Phím tắt 1–4 / A–D trong lúc chơi. */
export function handleQuizKey(event) {
  if (!session || session.locked) return false;
  if (session.index >= session.questions.length) return false;
  const key = event.key.toUpperCase();
  const letters = ['A', 'B', 'C', 'D'];
  const numbers = ['1', '2', '3', '4'];
  const idx = letters.includes(key) ? letters.indexOf(key) : numbers.indexOf(key);
  if (idx < 0) return false;
  const button = document.querySelectorAll('.quiz-option')[idx];
  if (!button) return false;
  event.preventDefault();
  button.click();
  return true;
}

export function getQuizSession() {
  return session;
}

/** Xếp các từ trả lời sai vào buổi ôn rồi chuyển sang Flashcard. */
export async function reviewWrongWords() {
  if (!session) return;
  const wrongIds = session.answers.filter((a) => !a.correct).map((a) => a.id);
  await Promise.all(
    wrongIds.map(async (id) => {
      try {
        const progress = await queueForReview(id);
        const row = state.rows.find((r) => r.id === id);
        if (row && progress) row.progress = progress;
      } catch (error) {
        console.warn('queue_for_review failed', getErrorMessage(error));
      }
    }),
  );
  toast('Đã xếp ' + wrongIds.length + ' từ vào buổi ôn hôm nay.', 'success', 2500);
  location.hash = '#review';
}

/** Chơi lại với cùng kiểu câu hỏi và số câu đã chọn. */
export function restartQuiz() {
  if (typeof document === 'undefined') return;
  const mode = session?.mode || 'han2mean';
  const count = session?.count || 20;
  session = null;
  renderQuiz();
  // Tin cậy biến đã lưu hơn giá trị radio vừa dựng lại.
  startQuiz({ mode, count });
}
