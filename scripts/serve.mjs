/* Server tĩnh để CHẠY THỬ website ngay (không cần build, không cần Vercel CLI).
 * - Đọc SUPABASE_URL / SUPABASE_ANON_KEY từ biến môi trường nếu có.
 * - Không override js/env.js đang có (dùng được file env đã build trước đó).
 *
 * Chạy: node scripts/serve.mjs   (hoặc npm start)
 * Sau đó mở http://localhost:4173
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 4173);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://localhost:${port}`);

    if (url.pathname === '/api/config') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({
        SUPABASE_URL: process.env.SUPABASE_URL || '',
        SUPABASE_ANON_KEY: process.env.SUPABASE_ANON_KEY || '',
      }));
      return;
    }

    let filePath = normalize(join(root, decodeURIComponent(url.pathname)));
    const relative = filePath.slice(root.length);
    // chặn truy cập file ngoài thư mục dự án và các file nhạy cảm
    if (!filePath.startsWith(root) || /(^|[\\/])(\.env|\.git|node_modules|database[\\/]|scripts[\\/]|tests[\\/]|package-lock\.json)/.test(relative)) {
      res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }

    let info = await stat(filePath).catch(() => null);
    if (info?.isDirectory()) {
      filePath = join(filePath, 'index.html');
      info = await stat(filePath).catch(() => null);
    }
    if (!info) filePath = join(root, 'index.html');

    const body = await readFile(filePath);
    res.writeHead(200, {
      'content-type': MIME[extname(filePath).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-cache',
    });
    res.end(body);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    res.end(String(error));
  }
}).listen(port, () => {
  const configured = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_ANON_KEY);
  console.log(`Hán Ngữ đang chạy tại http://localhost:${port}`);
  console.log(configured ? 'Đã có biến môi trường Supabase.' : 'Chưa có biến môi trường: website sẽ hiển thị hướng dẫn cấu hình.');
});
