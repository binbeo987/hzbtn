/* =============================================================================
 * csv-parser.js - Đọc & phân tích CSV 9 trường (hỗ trợ UTF-8/BOM, dấu phẩy,
 * ngoặc kép, xuống dòng trong ô, file hàng chục nghìn dòng).
 * Chạy được cả trên trình duyệt (ES module) và Node (test).
 * ============================================================================= */

export const CSV_HEADER = [
  'word',
  'pinyin',
  'pos',
  'meaning',
  'hsk',
  'topic',
  'example',
  'example_pinyin',
  'example_meaning',
];

export const CSV_REQUIRED = ['word', 'pinyin', 'meaning'];

/**
 * Tách toàn bộ nội dung CSV thành mảng các dòng (mảng ô).
 * Parser chạy tuần tự một lượt, không regex backtracking → an toàn với file lớn.
 */
export function parseCsvText(text, { delimiter = ',' } = {}) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let rowStartLine = 1;
  let line = 1;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        if (ch === '\n') line += 1;
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      // bỏ qua, xử lý ở '\n'
    } else if (ch === '\n') {
      row.push(field);
      rows.push({ cells: row, line: rowStartLine });
      row = [];
      field = '';
      line += 1;
      rowStartLine = line;
    } else {
      field += ch;
    }
  }
  row.push(field);
  if (row.some((c) => c !== '') || rows.length === 0) {
    rows.push({ cells: row, line: rowStartLine });
  }
  return rows;
}

export function normalizeHeader(cell) {
  return String(cell ?? '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase();
}

/**
 * Phân tích CSV thành dữ liệu từ vựng + danh sách lỗi.
 * Trả về:
 *  { rows: [{ line, data }], errors: [{ line, type, message, raw }], headerOk, total, duplicateWordCount }
 */
export function analyzeCsv(text) {
  const parsed = parseCsvText(text);
  if (!parsed.length) {
    return { rows: [], errors: [{ line: 0, type: 'fatal', message: 'File rỗng.' }], headerOk: false, total: 0 };
  }

  // Tìm dòng tiêu đề đầu tiên có chứa "word" (bỏ qua dòng trống đầu file).
  let headerIndex = -1;
  for (let i = 0; i < Math.min(parsed.length, 5); i += 1) {
    const cells = parsed[i].cells.map(normalizeHeader);
    if (cells[0] === 'word' || cells.includes('word')) {
      headerIndex = i;
      break;
    }
  }

  if (headerIndex === -1) {
    return {
      rows: [],
      errors: [{ line: 1, type: 'fatal', message: `Không tìm thấy dòng tiêu đề. Cần đúng 9 trường: ${CSV_HEADER.join(',')}` }],
      headerOk: false,
      total: 0,
    };
  }

  const headerCells = parsed[headerIndex].cells.map(normalizeHeader);
  const errors = [];

  if (headerCells.length !== CSV_HEADER.length) {
    errors.push({
      line: parsed[headerIndex].line,
      type: 'fatal',
      message: `Dòng tiêu đề phải có đúng 9 trường, tìm thấy ${headerCells.length}: ${parsed[headerIndex].cells.join(',')}`,
    });
    return { rows: [], errors, headerOk: false, total: parsed.length - headerIndex - 1 };
  }

  const missing = CSV_HEADER.filter((h, idx) => headerCells[idx] !== h);
  if (missing.length) {
    errors.push({
      line: parsed[headerIndex].line,
      type: 'fatal',
      message: `Tên/cột tiêu đề không đúng. Bắt buộc: ${CSV_HEADER.join(',')}`,
    });
    return { rows: [], errors, headerOk: false, total: parsed.length - headerIndex - 1 };
  }

  const rows = [];
  const seen = new Map();

  for (let i = headerIndex + 1; i < parsed.length; i += 1) {
    const { cells, line: lineNo } = parsed[i];
    if (cells.length === 1 && cells[0].trim() === '') continue; // dòng trống

    if (cells.length !== CSV_HEADER.length) {
      errors.push({
        line: lineNo,
        type: 'column_count',
        message: `Có ${cells.length} trường, cần 9 trường.`,
        raw: cells.join(','),
      });
      continue;
    }

    // Chuẩn hoá Unicode NFC để tiếng Việt có dấu luôn được so sánh/hiển thị nhất quán.
    const [word, pinyin, pos, meaning, hsk, topic, example, examplePinyin, exampleMeaning] =
      cells.map((c) => c.trim().normalize('NFC'));

    if (!word) {
      errors.push({ line: lineNo, type: 'missing_word', message: 'Thiếu trường bắt buộc: word.', raw: cells.join(',') });
      continue;
    }
    if (!pinyin) {
      errors.push({ line: lineNo, type: 'missing_pinyin', message: 'Thiếu trường bắt buộc: pinyin.', raw: cells.join(',') });
      continue;
    }
    if (!meaning) {
      errors.push({ line: lineNo, type: 'missing_meaning', message: 'Thiếu trường bắt buộc: meaning.', raw: cells.join(',') });
      continue;
    }

    const data = {
      word,
      pinyin,
      pos: pos || '',
      meaning,
      hsk: hsk || '',
      topic: topic || '',
      example: example || '',
      example_pinyin: examplePinyin || '',
      example_meaning: exampleMeaning || '',
    };

    if (seen.has(word)) {
      const first = seen.get(word);
      errors.push({
        line: lineNo,
        type: 'duplicate_in_file',
        message: `Từ "${word}" bị trùng với dòng ${first} trong cùng file.`,
        raw: cells.join(','),
      });
      continue;
    }
    seen.set(word, lineNo);
    rows.push({ line: lineNo, data });
  }

  return {
    rows,
    errors,
    headerOk: true,
    total: rows.length + errors.length,
    uniqueWordCount: rows.length,
  };
}

/** Tạo nội dung CSV (có BOM) để xuất file / báo cáo lỗi. */
export function toCsvText(rows, header = CSV_HEADER) {
  const escape = (value) => {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const row of rows) {
    lines.push(header.map((h) => escape(row[h])).join(','));
  }
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}

export function errorReportCsv(errors) {
  const header = ['line', 'type', 'message', 'raw'];
  const escape = (value) => {
    const s = value === null || value === undefined ? '' : String(value);
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [header.join(',')];
  for (const e of errors) lines.push(header.map((h) => escape(e[h])).join(','));
  return `\uFEFF${lines.join('\r\n')}\r\n`;
}
