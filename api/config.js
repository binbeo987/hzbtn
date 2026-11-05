/* Vercel serverless function: /api/config
 * Trả về URL + anon key (public) của Supabase để frontend khởi tạo client.
 * KHÔNG bao giờ trả về service_role key.
 */
const DEFAULTS = {
  SUPABASE_URL: 'https://ohicfsquvraayliscprg.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_maYsjTviq5zdUI5IVTTi3g_2rydIS3Q',
};

export default function handler(req, res) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULTS.SUPABASE_URL;
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    DEFAULTS.SUPABASE_ANON_KEY;

  // Anon key là thông tin công khai: cache để giảm 1 request mỗi lần mở trang.
  res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anonKey,
  });
}
