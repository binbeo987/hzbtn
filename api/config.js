/* Vercel serverless function: /api/config
 * Trả về URL + anon key (public) của Supabase để frontend khởi tạo client.
 * KHÔNG bao giờ trả về service_role key.
 */
export default function handler(req, res) {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const anonKey =
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    '';

  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.status(200).json({
    SUPABASE_URL: url,
    SUPABASE_ANON_KEY: anonKey,
  });
}
