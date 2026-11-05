import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(resolve(root, 'js/app.js'), 'utf8');
const css = readFileSync(resolve(root, 'css/style.css'), 'utf8');

test('card lỗi được tạo bằng JS, không phụ thuộc markup có sẵn trong index.html', () => {
  assert.match(app, /function ensureBootCard\(\)/);
  assert.match(app, /document\.createElement\('div'\)/);
  assert.match(app, /boot\.appendChild\(card\)/);
});

test('không còn ẩn trang bằng display:none khi mất kết nối (flashcard vẫn bấm được sau khi kết nối lại)', () => {
  assert.doesNotMatch(css, /body\.is-disconnected \.page \{[^}]*display:\s*none/);
  assert.match(css, /body\.is-disconnected \.page \{/);
});

test('khi dữ liệu đã sẵn sàng, card lỗi bị gỡ khỏi DOM', () => {
  assert.match(app, /function hideBootError\(\)/);
  assert.match(app, /boot\.remove\(\)/);
});

test('nút bắt đầu học dẫn tới trang ôn tập', () => {
  const flash = readFileSync(resolve(root, 'js/flashcard.js'), 'utf8');
  assert.match(flash, /export function startToday\(\)/);
  assert.match(flash, /location\.hash = '#review'/);
});
