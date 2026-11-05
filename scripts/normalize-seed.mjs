/* Chuẩn hoá file CSV nguồn thành CSV đúng 9 trường để import vào website.
 *
 * - Bỏ BOM, chuẩn CRLF.
 * - Bỏ dấu "/" bao quanh pinyin: "/xuéxí/" → "xuéxí"
 * - HSK "1" → "HSK 1"
 * - Bỏ khoảng trắng thừa, gộp khoảng trắng, chuẩn hoá từ loại.
 * - Loại bỏ trùng (word) trong cùng file: gộp nghĩa nếu cùng từ loại.
 *
 * Cách dùng:
 *   node scripts/normalize-seed.mjs
 *   node scripts/normalize-seed.mjs --input "Data.csv" --output samples/seed-10k.csv
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeCsv, toCsvText, CSV_HEADER } from '../js/csv-parser.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const getArg = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : fallback;
};

const input = getArg('input', 'HSK_Vocabulary_Formatted_With_Topics.csv');
const output = getArg('output', 'samples/seed-vocabulary.csv');

const POS_MAP = {
  dt: 'Động từ',
  đt: 'Động từ',
  'động từ': 'Động từ',
  'danh từ': 'Danh từ',
  'tính từ': 'Tính từ',
  'phó từ': 'Phó từ',
  'trạng từ': 'Phó từ',
  'đại từ': 'Đại từ',
  'giới từ': 'Giới từ',
  'liên từ': 'Liên từ',
  'lượng từ': 'Lượng từ',
  'trợ từ': 'Trợ từ',
  'thán từ': 'Thán từ',
  'số từ': 'Số từ',
};

function cleanPinyin(value) {
  let v = String(value || '').trim();
  if (/^\/.*\/$/.test(v)) v = v.slice(1, -1).trim();
  return v.replace(/\s+/g, ' ');
}

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function cleanPos(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  return raw
    .split(/\s*[|/]\s*/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => POS_MAP[part.toLowerCase()] || (part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' / ');
}

function cleanHsk(value) {
  const raw = cleanText(value).toUpperCase();
  if (!raw) return '';
  const match = raw.match(/([1-9])/);
  return match ? `HSK ${match[1]}` : raw;
}

const TOPIC_MAP = {
  daily: 'daily',
  family: 'family',
  school: 'school',
  food: 'food',
  home: 'home',
  work: 'work',
  shopping: 'shopping',
  travel: 'travel',
  emotion: 'emotion',
  time: 'time',
  weather: 'weather',
  health: 'health',
};

function detectTopic(meaning, hsk, index) {
  const m = String(meaning || '').toLowerCase();
  const rules = [
    [/\b(yêu|thương|vui|buồn|giận|sợ|cảm xúc|hạnh phúc|lo lắng|ngạc nhiên|hy vọng)\b/, 'emotion'],
    [/\b(ăn|uống|cơm|nước|trà|cà phê|món|nhà hàng|bánh|thịt|cá|rau|quả|trái)\b/, 'food'],
    [/\b(học|trường|lớp|giáo|thầy|cô|sinh viên|bài|thi|kiến thức|sách)\b/, 'school'],
    [/\b(mua|bán|tiền|giá|hàng|cửa hàng|thanh toán|trả)\b/, 'shopping'],
    [/\b(tàu|xe|máy bay|đi du lịch|khách sạn|sân bay|du lịch|hành trình)\b/, 'travel'],
    [/\b(bệnh|sức khỏe|thuốc|bác sĩ|bệnh viện|đau)\b/, 'health'],
    [/\b(mẹ|bố|cha|con|anh|chị|em|ông|bà|gia đình)\b/, 'family'],
    [/\b(công việc|làm việc|công ty|sếp|đồng nghiệp|họp|nghề)\b/, 'work'],
    [/\b(thời tiết|mưa|nắng|gió|tuyết|lạnh|nóng|nhiệt độ)\b/, 'weather'],
    [/\b(thời gian|giờ|ngày|tuần|tháng|năm|hôm nay|ngày mai|buổi)\b/, 'time'],
    [/\b(nhà|cửa|phòng|bàn|ghế|giường|bếp)\b/, 'home'],
  ];
  for (const [pattern, topic] of rules) {
    if (pattern.test(m)) return topic;
  }
  const fallback = ['daily', 'time', 'school', 'work', 'emotion', 'home'];
  return fallback[Number(String(hsk).replace(/\D/g, '') || 0) % fallback.length];
}

const source = readFileSync(resolve(root, input), 'utf8');
const analysis = analyzeCsv(source);
if (!analysis.rows.length) {
  console.error('Không đọc được file nguồn:', analysis.errors.slice(0, 3));
  process.exit(1);
}

const byWord = new Map();
for (const { data } of analysis.rows) {
  const word = cleanText(data.word);
  const pinyin = cleanPinyin(data.pinyin);
  const meaning = cleanText(data.meaning);
  if (!word || !pinyin || !meaning) continue;
  const pos = cleanPos(data.pos);
  const hsk = cleanHsk(data.hsk);
  const topic = TOPIC_MAP[cleanText(data.topic).toLowerCase()] || detectTopic(meaning, hsk);

  const existing = byWord.get(word);
  if (existing) {
    // Gộp từ trùng: bổ sung nghĩa/từ loại khác nhau, giữ câu ví dụ đầu tiên.
    const meanings = new Set(existing.meaning.split('; ').map((s) => s.trim()));
    for (const m of meaning.split(';')) if (m.trim() && !meanings.has(m.trim())) meanings.add(m.trim());
    existing.meaning = [...meanings].join('; ');
    const posList = new Set(existing.pos.split(' / ').filter(Boolean));
    for (const p of pos.split(' / ')) if (p && !posList.has(p)) posList.add(p);
    existing.pos = [...posList].join(' / ');
    existing.hsk = existing.hsk || hsk;
    continue;
  }

  byWord.set(word, {
    word,
    pinyin,
    pos,
    meaning,
    hsk,
    topic,
    example: cleanText(data.example),
    example_pinyin: cleanPinyin(data.example_pinyin),
    example_meaning: cleanText(data.example_meaning),
  });
}

const rows = [...byWord.values()].sort((a, b) => {
  const ha = Number(a.hsk.replace(/\D/g, '')) || 99;
  const hb = Number(b.hsk.replace(/\D/g, '')) || 99;
  return ha - hb || a.pinyin.localeCompare(b.pinyin);
});

const outPath = resolve(root, output);
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, toCsvText(rows, CSV_HEADER), 'utf8');

const byHsk = {};
const byTopic = {};
for (const r of rows) {
  byHsk[r.hsk] = (byHsk[r.hsk] || 0) + 1;
  byTopic[r.topic] = (byTopic[r.topic] || 0) + 1;
}

console.log(`✅ ${outPath}`);
console.log(`   ${rows.length} từ (nguồn ${analysis.rows.length} dòng, ${analysis.errors.length} dòng lỗi/trùng bị bỏ)`);
console.log('   HSK:', byHsk);
console.log('   Chủ đề:', byTopic);
