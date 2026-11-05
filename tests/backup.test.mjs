import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateBackup } from '../js/backup.js';

function goodBackup(extra = {}) {
  return {
    app: 'han-ngu',
    version: '1.0.0',
    exported_at: '2026-11-05T00:00:00.000Z',
    settings: { new_words_per_day: 10, max_words_per_day: 30 },
    vocabulary: [
      { id: 'v1', word: '\u5b66\u4e60', pinyin: 'xu\u00e9x\u00ed', meaning: 'h\u1ecdc' },
      { id: 'v2', word: '\u5b66\u6821', pinyin: 'xu\u00e9xi\u00e0o', meaning: 'tr\u01b0\u1eddng h\u1ecdc' },
    ],
    learning_progress: [
      { vocabulary_id: 'v1', status: 'review', next_review_at: '2026-11-08T00:00:00.000Z' },
    ],
    review_records: [{ vocabulary_id: 'v1', rating: 'good', reviewed_at: '2026-11-05T00:00:00.000Z' }],
    daily_sessions: [{ session_date: '2026-11-05', status: 'completed' }],
    favorites: [{ vocabulary_id: 'v2' }],
    ...extra,
  };
}

test('file sao lưu hợp lệ được chấp nhận và đếm đúng', () => {
  const result = validateBackup(goodBackup());
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.counts, {
    vocabulary: 2,
    learning_progress: 1,
    review_records: 1,
    daily_sessions: 1,
    favorites: 1,
  });
});

test('từ vựng thiếu trường bắt buộc bị báo lỗi', () => {
  const data = goodBackup();
  data.vocabulary.push({ id: 'v3', word: 'x', pinyin: '' });
  const result = validateBackup(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('thiếu word/pinyin/meaning')));
});

test('tiến trình trỏ tới từ không có trong file bị báo lỗi', () => {
  const data = goodBackup();
  data.learning_progress.push({ vocabulary_id: 'missing', status: 'review' });
  const result = validateBackup(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('không có trong file')));
});

test('rating / status không hợp lệ bị báo lỗi', () => {
  const data = goodBackup();
  data.review_records.push({ vocabulary_id: 'v1', rating: 'perfect' });
  data.learning_progress.push({ vocabulary_id: 'v2', status: 'unknown' });
  const result = validateBackup(data);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((e) => e.includes('rating không hợp lệ')));
  assert.ok(result.errors.some((e) => e.includes('status không hợp lệ')));
});

test('từ trùng trong file chỉ là cảnh báo, vẫn khôi phục được', () => {
  const data = goodBackup();
  const first = data.vocabulary[0];
  data.vocabulary.push({ id: first.id, word: first.word, pinyin: 'x', meaning: 'y' });
  const result = validateBackup(data);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.equal(result.warnings.length, 1);
  assert.equal(result.counts.vocabulary, 3);
});

test('object rỗng / không phải JSON object bị từ chối', () => {
  assert.equal(validateBackup(null).ok, false);
  assert.equal(validateBackup([]).ok, false);
  assert.equal(validateBackup({ foo: 'bar' }).ok, false);
});
