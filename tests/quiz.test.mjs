import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildQuestions, cleanMeaning } from '../js/quiz.js';

const pool = [
  { id: '1', word: '学习', pinyin: 'xuéxí', meaning: 'Học, học tập', hsk: 'HSK 1', topic: 'school' },
  { id: '2', word: '学校', pinyin: 'xuéxiào', meaning: 'Trường học', hsk: 'HSK 1', topic: 'school' },
  { id: '3', word: '学生', pinyin: 'xuésheng', meaning: 'Học sinh', hsk: 'HSK 1', topic: 'school' },
  { id: '4', word: '老师', pinyin: 'lǎoshī', meaning: 'Giáo viên', hsk: 'HSK 1', topic: 'school' },
  { id: '5', word: '吃', pinyin: 'chī', meaning: 'Ăn', hsk: 'HSK 1', topic: 'food' },
  { id: '6', word: '爱', pinyin: 'ài', meaning: 'Yêu', hsk: 'HSK 1', topic: 'emotion' },
];

test('cleanMeaning lấy nghĩa đầu tiên trước dấu phẩy', () => {
  assert.equal(cleanMeaning('Học, học tập'), 'Học');
  assert.equal(cleanMeaning('Ăn; uống'), 'Ăn');
  assert.equal(cleanMeaning('Trường học'), 'Trường học');
});

test('câu hỏi Hán tự → nghĩa có 4 lựa chọn, đúng 1 đáp án', () => {
  const [q] = buildQuestions([pool[0]], 'han2mean', pool);
  assert.equal(q.prompt, '学习');
  assert.equal(q.answer, 'Học');
  assert.equal(q.options.length, 4);
  assert.ok(q.options.includes('Học'));
  assert.equal(new Set(q.options).size, 4);
});

test('câu hỏi nghĩa → Hán tự hiển thị nghĩa và đáp án là chữ Hán', () => {
  const [q] = buildQuestions([pool[1]], 'mean2han', pool);
  assert.equal(q.prompt, 'Trường học');
  assert.equal(q.answer, '学校');
  assert.ok(q.options.includes('学校'));
  assert.equal(q.options.length, 4);
});

test('câu hỏi Hán tự → pinyin', () => {
  const [q] = buildQuestions([pool[4]], 'han2pinyin', pool);
  assert.equal(q.prompt, '吃');
  assert.equal(q.answer, 'chī');
  assert.equal(q.options.length, 4);
});

test('không đủ đáp án nhiễu thì bỏ câu đó (không sinh câu thiếu lựa chọn)', () => {
  const two = pool.slice(0, 2);
  const qs = buildQuestions([pool[0]], 'han2mean', two);
  assert.equal(qs.length, 0);
});

test('mode "mix" trộn nhiều kiểu câu hỏi', () => {
  const qs = buildQuestions(pool, 'mix', pool);
  assert.ok(qs.length >= 4);
  const modes = new Set(qs.map((q) => q.mode));
  assert.ok([...modes].every((m) => ['han2mean', 'mean2han', 'han2pinyin'].includes(m)));
});

test('mọi câu hỏi đều có đáp án đúng trong danh sách lựa chọn', () => {
  for (const mode of ['han2mean', 'mean2han', 'han2pinyin', 'mix']) {
    const qs = buildQuestions(pool, mode, pool);
    for (const q of qs) {
      assert.ok(q.options.includes(q.answer), `${mode}: ${q.prompt}`);
      assert.equal(q.options.length, 4);
    }
  }
});
