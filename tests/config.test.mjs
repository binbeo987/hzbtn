import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSupabaseUrl, validateSupabaseConfig } from '../js/config.js';

test('normalizeSupabaseUrl: thêm https, bỏ dấu / cuối', () => {
  assert.equal(normalizeSupabaseUrl('abc.supabase.co'), 'https://abc.supabase.co');
  assert.equal(normalizeSupabaseUrl('https://abc.supabase.co/'), 'https://abc.supabase.co');
  assert.equal(normalizeSupabaseUrl('  https://abc.supabase.co//  '), 'https://abc.supabase.co');
  assert.equal(normalizeSupabaseUrl(''), '');
});

test('validateSupabaseConfig: cấu hình hợp lệ', () => {
  assert.deepEqual(
    validateSupabaseConfig({
      url: 'https://mzfafbdcjqorymigahbu.supabase.co',
      key: 'sb_publishable_XB9yQjkxsyeA92TdIlOxhw_rSbv1c6j',
    }),
    [],
  );
  assert.deepEqual(
    validateSupabaseConfig({ url: 'abc.supabase.co', key: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiJ9.sig' }),
    [],
  );
});

test('validateSupabaseConfig: bắt lỗi URL sai', () => {
  assert.equal(validateSupabaseConfig({ url: '', key: 'x'.repeat(50) }).length, 1);
  assert.match(validateSupabaseConfig({ url: 'https://example.com', key: 'x'.repeat(50) })[0], /Project URL/);
});

test('validateSupabaseConfig: từ chối key ngắn, secret key, service_role', () => {
  assert.match(validateSupabaseConfig({ url: 'https://a.supabase.co', key: 'abc' })[0], /quá ngắn/);
  assert.match(validateSupabaseConfig({ url: 'https://a.supabase.co', key: 'sb_secret_123456789012345678901234567890' })[0], /secret key/);
  assert.match(validateSupabaseConfig({ url: 'https://a.supabase.co', key: 'service_role_1234567890123456789012345678' })[0], /secret key/);
});
