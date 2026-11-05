/* Sinh js/env.js từ biến môi trường lúc build (Vercel / CI).
 * URL và anon key là thông tin public (RLS bảo vệ dữ liệu), không phải secret server.
 * Không bao giờ đưa service_role key vào đây. */

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
const anonKey = (
  process.env.SUPABASE_ANON_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  process.env.SUPABASE_PUBLISHABLE_KEY ||
  ''
).trim();

if (url && /service_role/.test(anonKey)) {
  console.error('❌ SUPABASE_ANON_KEY không được là service_role key.');
  process.exit(1);
}

if (!url || !anonKey) {
  console.warn('⚠️  Chưa có SUPABASE_URL / SUPABASE_ANON_KEY. Website sẽ hiển thị hướng dẫn cấu hình.');
}

const out = `/* Tự sinh bởi scripts/build.mjs — không sửa tay. */
export const ENV = {
  SUPABASE_URL: ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(anonKey)},
  BUILT_AT: ${JSON.stringify(new Date().toISOString())}
};
`;

mkdirSync(resolve(root, 'js'), { recursive: true });
writeFileSync(resolve(root, 'js/env.js'), out, 'utf8');
console.log(`✅ Đã sinh js/env.js ${url ? `(${new URL(url).host})` : '(thiếu biến môi trường)'}`);
