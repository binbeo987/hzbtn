# Hán Ngữ – Từ điển & Ôn tập từ vựng tiếng Trung

Website học tiếng Trung cho người Việt gồm **từ điển Trung – Việt**, **flashcard** và **lịch ôn tập
tự động (spaced repetition)**. Không có chatbot, không mạng xã hội.

- Frontend: HTML5 + CSS3 + JavaScript ES6 (ES modules), **không cần Vite/React**.
- Dữ liệu: **Supabase PostgreSQL** (chính), Supabase Auth **Anonymous**.
- Triển khai: GitHub → **Vercel**.
- LocalStorage **chỉ** dùng cho cài đặt giao diện và vị trí buổi học đang dở (không phải nguồn dữ liệu chính).

---

## 1. Cấu trúc dự án

```
/
  index.html                 Giao diện duy nhất (SPA bằng hash router)
  /css
    style.css                Design system: nền trắng, xanh dương, card bo góc
    responsive.css           Tablet / mobile
  /js
    app.js                   Khởi động + điều hướng + sự kiện toàn cục
    config.js                Đọc cấu hình Supabase (meta → /api/config → js/env.js)
    env.js                   Sinh tự động khi build (scripts/build.mjs)
    supabase.js              Client + Anonymous Auth + tải dữ liệu học
    api.js                   Toàn bộ truy vấn Supabase (RPC, batch, import)
    store.js                 Trạng thái ứng dụng (Supabase là nguồn chính)
    dictionary.js            Tra từ theo Hán tự / pinyin / nghĩa Việt
    flashcard.js             Buổi ôn Flashcard (lưu ngay mỗi lượt đánh giá)
    scheduler.js             Thuật toán SM-2 cải tiến + lập lịch buổi học + lịch
    csv-parser.js            Parser CSV 9 trường (UTF-8/BOM, ngoặc kép, file lớn)
    csv-import.js            Luồng import CSV 4 bước + báo cáo lỗi
    vocabulary.js            Kho từ vựng: lọc, thêm, sửa, xoá, xuất CSV
    calendar.js              Lịch tháng / tuần
    backup.js                Sao lưu / khôi phục JSON, xuất CSV
    settings.js, home.js     Cài đặt, trang chủ
    session-cache.js         Cache tạm vị trí buổi học (LocalStorage)
    ui.js                    Tiện ích DOM, toast, modal, định dạng ngày giờ
    /vendor/supabase.js      supabase-js v2 (UMD, tải sẵn để trang mở nhanh)
  /database
    schema.sql               Bảng, khóa, trigger, index
    rls.sql                  Row Level Security + RPC tra từ / lưu kết quả
  /api/config.js             Vercel serverless trả URL + anon key từ biến môi trường
  /scripts
    build.mjs                Sinh js/env.js từ biến môi trường (Vercel)
    dev-server.mjs           Server tĩnh để chạy local
    normalize-seed.mjs       Chuẩn hoá CSV nguồn thành đúng 9 trường
  /samples
    sample-vocabulary.csv    CSV mẫu đúng 9 trường (1.653 từ HSK 1–5)
    seed-vocabulary.csv      CSV dữ liệu đầy đủ 4.213 từ HSK 1–5
  /assets                    manifest.json, icon, favicon
  /tests                     node:test (scheduler, CSV, backup)
  vercel.json, package.json, .env.example
```

---

## 2. Tạo Supabase project

1. Vào <https://supabase.com> → **New project** (chọn region gần Việt Nam, ví dụ Singapore).
2. Đặt mật khẩu database và lưu lại.
3. Mở **Project Settings → API**, ghi lại:
   - **Project URL** → dùng cho `SUPABASE_URL`
   - **anon public key** (hoặc publishable key) → dùng cho `SUPABASE_ANON_KEY`

> ⚠️ Không bao giờ dùng `service_role` key ở frontend. Key này bỏ qua RLS.

## 3. Chạy file SQL

Trong **SQL Editor** của Supabase, chạy lần lượt (theo đúng thứ tự):

1. `database/schema.sql` – tạo extension `pg_trgm`, 6 bảng, index, trigger kiểm tra quyền sở hữu,
   hàm `ensure_learning_settings()`.
2. `database/rls.sql` – bật **RLS** cho mọi bảng, tạo policy `user_id = auth.uid()` và các RPC:
   - `search_vocabulary(query, limit, offset)` – tra từ không phân biệt hoa/thường,
     tìm bằng pinyin không dấu (vd: `xuexiao` ra 学校).
   - `record_review(...)` – ghi `review_records` + cập nhật `learning_progress` trong một transaction.
   - `mark_session(...)` – cập nhật `daily_sessions` theo ngày địa phương.

Hai file có thể chạy lại nhiều lần (idempotent).

## 4. Bật Anonymous Auth

**Authentication → Sign In / Providers → Anonymous sign-ins** → bật **Enable anonymous sign-ins**.

Không cần tạo policy nào thêm: policy dùng `auth.uid()`; vai trò `authenticated` của phiên ẩn danh
được Supabase cấp quyền bảng và RLS sẽ tách dữ liệu giữa các phiên.

**Tuỳ chọn giới hạn:** Authentication → Rate Limits (chặn tạo phiên ẩn danh hàng loạt).

## 5. Cấu hình biến môi trường

Dùng **đúng 2 biến** (giá trị public, được bảo vệ bởi RLS):

| Biến | Giá trị |
| --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | anon / publishable key |

`VITE_SUPABASE_URL` và `VITE_SUPABASE_ANON_KEY` cũng được hỗ trợ (cùng giá trị) nếu bạn quen dùng tên đó.

### Trên Vercel
Project → **Settings → Environment Variables** → thêm 2 biến cho **Production, Preview, Development**.
Mỗi lần đổi biến cần **Redeploy**.

### Chạy local
Trang đọc cấu hình theo thứ tự: `<meta name="supabase-url">` trong `index.html` → `/api/config` → `js/env.js`.

```bash
# Cách nhanh nhất (server dev đã hỗ trợ /api/config)
set SUPABASE_URL=https://xxx.supabase.co
set SUPABASE_ANON_KEY=eyJhbGciOi...
npm start           # mở http://localhost:4173
```

Hoặc đặt thông tin vào meta trong `index.html` (chỉ khi dev, không commit).

## 6. Import dữ liệu

1. Mở **Kho từ vựng → Nhập CSV**.
2. Chọn file CSV **đúng 9 trường**:

```csv
word,pinyin,pos,meaning,hsk,topic,example,example_pinyin,example_meaning
学习,xuéxí,Động từ,"Học, học tập",HSK 1,school,我每天学习中文。,Wǒ měitiān xuéxí Zhōngwén.,Tôi học tiếng Trung mỗi ngày.
```

- Bắt buộc: `word`, `pinyin`, `meaning`. Các cột khác được để trống.
- Hỗ trợ UTF-8 / UTF-8 BOM, tiếng Việt có dấu, dấu phẩy và ngoặc kép trong nội dung,
  file có hàng chục nghìn dòng. Nút "Tải file CSV mẫu" trong trang Nhập CSV tạo file mẫu đúng định dạng;
  `samples/seed-vocabulary.csv` chứa 4.213 từ HSK 1–5 để nhập thử.
- 4 bước: chọn file → xem trước & kiểm tra → chọn xử lý từ trùng → import theo batch (500 dòng/lần) → báo cáo.
- Từ trùng xác định theo khóa `(user_id, word)`:
  - **Bỏ qua**: giữ nguyên dữ liệu cũ và lịch sử học.
  - **Cập nhật**: chỉ cập nhật các trường từ vựng; bảng `learning_progress` không bị chạm tới,
    nên **lịch ôn, trạng thái, số lần ôn, ngày ôn giữ nguyên**.
- Có báo cáo tổng dòng / từ mới / cập nhật / bỏ qua / lỗi và **tải báo cáo lỗi CSV**.

## 7. Đưa mã nguồn lên GitHub

```bash
cd hzbtn
git init
git add .
git commit -m "feat: Hán Ngữ dictionary & flashcard app"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

`.gitignore` đã loại `.env`, `js/env.js` không chứa secret thật khi chưa build.

## 8. Kết nối GitHub với Vercel và deploy

1. <https://vercel.com> → **Add New → Project** → import repo GitHub.
2. Framework Preset: **Other**. Build Command: `npm run build` (mặc định trong `package.json`).
   Output Directory: để trống (site tĩnh ở thư mục gốc).
3. Thêm biến môi trường `SUPABASE_URL`, `SUPABASE_ANON_KEY` (mục 5).
4. **Deploy**. Mỗi lần push lên `main` Vercel tự build và deploy lại.
5. Mở domain Vercel, kiểm tra phiên ẩn danh được tạo (Cài đặt → Mã người dùng ẩn danh).

## 9. Sao lưu & phục hồi

- **Cài đặt → Xuất JSON đầy đủ**: từ vựng, `learning_progress`, `review_records`, `daily_sessions`,
  `favorites`, cài đặt.
- **Khôi phục**: chọn file JSON → hệ thống kiểm tra cấu trúc, hiển thị xem trước (số bảng ghi, lỗi,
  cảnh báo trùng) → bạn xác nhận mới ghi. Mặc định chỉ thêm bản ghi mới; có tuỳ chọn xoá dữ liệu
  hiện tại trước (kèm hộp thoại xác nhận).
- Nếu xoá dữ liệu trình duyệt (mất session ẩn danh), website tạo uid mới → dùng file JSON để
  khôi phục; dữ liệu cũ vẫn nằm trong Supabase theo uid cũ (quản lý qua Supabase Dashboard
  nếu cần xuất trực tiếp).

---

## 10. Thuật toán ôn tập

| Đánh giá | Lần đầu | Các lần sau |
| --- | --- | --- |
| Chưa nhớ | 10 phút | 10 phút, repetition = 0, EF −0.2 |
| Khó nhớ | 1 ngày | interval × 1.2, EF −0.15 |
| Đã nhớ | 3 ngày | interval × EF (SM-2), EF giữ nguyên |
| Rất dễ | 7 ngày | interval × EF × 1.3, EF +0.15 |

`EF` (easiness factor) tối thiểu 1.3; từ đạt `interval ≥ 21 ngày` và `repetition ≥ 5` được đánh dấu
**thành thạo**. Mọi mốc thời gian lưu ở Supabase theo **UTC**, hiển thị theo múi giờ máy người dùng.

**Lập buổi học hằng ngày** (`buildDailyQueue`):

1. Từ cũ **đến hạn** hôm nay (sắp xếp theo hạn cũ nhất).
2. Từ **tồn đọng** (hạn trước hôm nay nhưng chưa ôn; từ vừa trả lời sai lên trước).
3. Từ **mới** (tối đa `new_words_per_day`, mặc định 10), không vượt `max_words_per_day` (mặc định 30).

Nếu vượt giới hạn: ưu tiên từ cũ, cắt từ mới — từ mới chưa được phân bổ **không bị đánh dấu đã học**
và tự động được xét cho buổi sau. Không từ nào xuất hiện 2 lần trong cùng buổi. Ngày không học
thì hôm sau các từ đến hạn tự chuyển thành tồn đọng. Lịch không tạo trước cho cả năm mà tính động.

## 11. Kiểm thử

```bash
npm test
```

Đã bao gồm: khoảng cách ban đầu, SM-2 tăng dần, EF ≥ 1.3, phân loại due/backlog/new/scheduled,
thứ tự ưu tiên và giới hạn buổi học, không lặp từ, tính tồn đọng, lịch tháng, parser CSV với
UTF-8/BOM/dấu phẩy/ngoặc kép/nhiều dòng, file 10.000 dòng (< 1.5s), cấu trúc backup.

Checklist thủ công (cần project Supabase thật):
import CSV 9 trường · import tiếng Trung/Việt · import 10.000 từ · từ trùng (bỏ qua/cập nhật) ·
tra bằng Hán tự / pinyin / nghĩa · flashcard 4 mức · lịch ôn cập nhật · từ tồn đọng ·
học từ mới + từ cũ cùng buổi · đóng/mở trình duyệt vẫn còn dữ liệu · kiểm tra bảng trên Supabase ·
RLS: đăng xuất tạo uid mới không thấy dữ liệu cũ · giao diện mobile · deploy Vercel.

## 12. Cập nhật phiên bản

Sửa `APP_CONFIG.version` trong `js/config.js` + `version` trong `package.json`, commit và push.
Nếu có thay đổi schema, thêm file mới `database/migrations/YYYYMMDD_mo-ta.sql` và chạy trên Supabase
trước khi deploy.
