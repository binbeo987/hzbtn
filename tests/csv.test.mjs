import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCsv, parseCsvText, toCsvText, errorReportCsv, CSV_HEADER } from '../js/csv-parser.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

test('tiêu đề đúng 9 trường, dữ liệu có tiếng Trung và tiếng Việt', () => {
  const csv = `\uFEFFword,pinyin,pos,meaning,hsk,topic,example,example_pinyin,example_meaning\r\n学习,xuéxí,Động từ,"Học, học tập",HSK 1,school,我每天学习中文。,Wǒ měitiān xuéxí Zhōngwén.,Tôi học tiếng Trung mỗi ngày.\r\n`;
  const result = analyzeCsv(csv);
  assert.equal(result.headerOk, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.errors.length, 0);
  assert.equal(result.rows[0].data.meaning, 'Học, học tập');
  assert.equal(result.rows[0].data.example, '我每天学习中文。');
});

test('hỗ trợ dấu ngoặc kép escape và xuống dòng trong ô', () => {
  const csv = `word,pinyin,pos,meaning,hsk,topic,example,example_pinyin,example_meaning
说,shuō,Động từ,"Nói ""xin chào""","HSK 1",daily,"他说：
你好。",Tā shuō: nǐ hǎo.,Anh ấy nói: xin chào.`;
  const result = analyzeCsv(csv);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].data.meaning, 'Nói "xin chào"');
  assert.ok(result.rows[0].data.example.includes('\n'));
});

test('thiếu trường bắt buộc → báo lỗi rõ ràng', () => {
  const csv = `word,pinyin,pos,meaning,hsk,topic,example,example_pinyin,example_meaning
,xue,,học,,, ,,`;
  const result = analyzeCsv(csv);
  assert.equal(result.rows.length, 0);
  assert.ok(result.errors.some((e) => e.type === 'missing_word'));
});

test('sai số cột → dòng được đưa vào lỗi, không chặn dòng khác', () => {
  const csv = `word,pinyin,pos,meaning,hsk,topic,example,example_pinyin,example_meaning
学习,xuéxí,Động từ,Học tập,HSK 1,school,,,
你好,nǐ hǎo`;
  const result = analyzeCsv(csv);
  assert.equal(result.rows.length, 1);
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].type, 'column_count');
});

test('tiêu đề sai tên cột → lỗi fatal', () => {
  const csv = `word,pinyin,meaning,hsk\na,b,c,d`;
  const result = analyzeCsv(csv);
  assert.equal(result.headerOk, false);
  assert.equal(result.rows.length, 0);
});

test('trùng từ trong cùng file bị loại và báo dòng gốc', () => {
  const csv = `word,pinyin,pos,meaning,hsk,topic,example,example_pinyin,example_meaning
爱好,àihào,Động từ,Yêu thích,HSK 1,daily,,,
爱好,àihào,Danh từ,Sở thích,HSK 1,daily,,,`;
  const result = analyzeCsv(csv);
  assert.equal(result.rows.length, 1);
  assert.equal(result.errors[0].type, 'duplicate_in_file');
  assert.match(result.errors[0].message, /dòng 2/);
});

test('toCsvText → analyzeCsv roundtrip giữ nguyên nội dung', () => {
  const rows = [
    { word: '朋友', pinyin: 'péngyou', pos: 'Danh từ', meaning: 'Bạn bè, "bầu bạn"', hsk: 'HSK 1', topic: 'daily', example: '他是朋友。', example_pinyin: 'Tā shì péngyou.', example_meaning: 'Anh ấy là bạn.' },
  ];
  const text = toCsvText(rows);
  assert.ok(text.startsWith('\uFEFF'));
  const back = analyzeCsv(text);
  assert.equal(back.rows.length, 1);
  assert.deepEqual(back.rows[0].data, rows[0]);
});

test('errorReportCsv tạo file báo cáo hợp lệ', () => {
  const csv = errorReportCsv([{ line: 2, type: 'missing_word', message: 'Thiếu word, dòng lỗi', raw: 'a,b' }]);
  const parsed = parseCsvText(csv);
  assert.equal(parsed[0].cells.join(','), 'line,type,message,raw');
  assert.equal(parsed[1].cells[2], 'Thiếu word, dòng lỗi');
});

test('file thật: samples/seed-vocabulary.csv đọc được toàn bộ', () => {
  const file = resolve(root, 'samples/seed-vocabulary.csv');
  if (!existsSync(file)) return;
  const result = analyzeCsv(readFileSync(file, 'utf8'));
  assert.ok(result.rows.length > 1000);
  assert.equal(result.errors.length, 0, `Lỗi: ${JSON.stringify(result.errors.slice(0, 3))}`);
  const words = result.rows.map((r) => r.data.word);
  assert.equal(new Set(words).size, words.length);
});

test('hiệu năng: 10.000 từ được phân tích < 1.5s', () => {
  const rows = [];
  for (let i = 0; i < 10000; i += 1) {
    rows.push({
      word: `词${i}`,
      pinyin: `cí ${i}`,
      pos: 'Danh từ',
      meaning: `Từ số ${i}, nghĩa "đặc biệt"`,
      hsk: 'HSK 1',
      topic: 'daily',
      example: `这是第 ${i} 个词。`,
      example_pinyin: `Zhè shì dì ${i} gè cí.`,
      example_meaning: `Đây là từ số ${i}.`,
    });
  }
  const text = toCsvText(rows);
  const started = Date.now();
  const result = analyzeCsv(text);
  const elapsed = Date.now() - started;
  assert.equal(result.rows.length, 10000);
  assert.equal(result.errors.length, 0);
  assert.ok(elapsed < 1500, `Phân tích 10.000 dòng mất ${elapsed}ms`);
  assert.deepEqual(CSV_HEADER.length, 9);
});
