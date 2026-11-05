/* Tải supabase-js UMD nếu chưa có (khi chạy qua HTTP, index.html đã tải sẵn). */
(function () {
  if (window.supabase && window.supabase.createClient) return;
  var s = document.createElement('script');
  s.src = new URL('./supabase.js', document.currentScript ? document.currentScript.src : location.href).toString();
  s.async = false;
  document.head.appendChild(s);
})();
