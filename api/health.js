/* Vercel serverless function: /api/health
 * Endpoint gọn để kiểm tra deploy còn sống (không trả về bất kỳ khoá nào).
 */
export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({ ok: true, app: 'han-ngu', time: new Date().toISOString() });
}
