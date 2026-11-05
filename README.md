# Hán Ngữ – Từ điển & Ôn tập từ vựng tiếng Trung

Website học tiếng Trung cho người Việt gồm **từ điển Trung – Việt**, **flashcard** và **lịch ôn tập
tự động (spaced repetition)**. Không có chatbot, không mạng xã hội.

- Frontend: HTML5 + CSS3 + JavaScript ES6 (ES modules), **không cần Vite/React**.
- Dữ liệu: **Supabase PostgreSQL**, chế độ **một người dùng** – không đăng nhập, không tài khoản.
- Triển khai: GitHub → **Vercel**.
- LocalStorage **chỉ** lưu vị trí buổi học đang dở và mã truy cập (nếu bật).

---

## 1. Cấu trúc dự án

```
/
  index.html                 Giao diện chính (hash router, menu dropdown)
  /css
    style.css                Design system + menu dropdown / drawer
    responsive.css           Desktop ≥1025 · Tablet 721–1024 · Phone ≤720
  /js
    app.js                   Khởi động, menu dropdown, drawer, routing
    config.js                Đọc cấu hình Supabase (meta → /api/config → js/env.js)
    env.js                   Sinh tự động khi build (scripts/build.mjs)
    supabase.js              Client, mã truy cập, load dữ liệu qua RPC
    api.js                   Toàn bộ thao tác dữ liệu qua RPC
    store.js                 Trạng thái ứng dụng (Supabase là nguồn chính)
    dictionary.js            Tra từ theo Hán tự / pinyin / nghĩa Việt
    flashcard.js             Buổi ôn Flashcard (lưu ngay mỗi lượt đánh giá)
    scheduler.js             SM-2 cải tiến + lập lịch buổi học + lịch
    csv-parser.js            Parser CSV 9 trường (UTF-8/BOM, ngoặc kép, file lớn)
    csv-import.js            Import CSV 4 bước + báo cáo lỗi
    vocabulary.js            Kho từ vựng: lọc, thêm, sửa, xoá, xuất CSV
    calendar.js              Lịch tháng / tuần
    backup.js                Sao lưu / khôi phục JSON, xuất CSV
    settings.js, home.js     Cài đặt, trang chủ
    session-cache.js         Vị trí buổi học đang dở (LocalStorage)
    ui.js                    Tiện ích DOM, toast, modal, định dạng ngày giờ
    /vendor/supabase.js      supabase-js v2 (UMD, tải sẵn để trang mở nhanh)
  /database
    schema.sql               Bảng, khóa, trigger, index + migration từ bản có user_id
    rls.sql                  Quyền truy cập + toàn bộ RPC
  /api/config.js             Vercel serverless trả URL + anon key từ biến môi trường
  /scripts                   build.mjs (sinh js/env.js), serve.mjs (chạy local), normalize-seed.mjs
  /samples                   sample-vocabulary.csv (1.653 từ) · seed-vocabulary.csv (4.213 từ)
  /assets                    manifest.json, icon, favicon
  /tests                     node:test (scheduler, CSV, backup)
```

## 2. Tạo Supabase project

1. <https://supabase.com> → **New project** (region gần Việt Nam).
2. **Project Settings → API**, ghi lại **Project URL** và **anon / publishable key**.

> ⚠️ Không bao giờ dùng `service_role` key ở frontend.

## 3. Chạy file SQL

Trong **SQL Editor** của Supabase, chạy lần lượt:

1. `database/schema.sql` – 6 bảng, unique theo từng phần, index trgm, trigger `updated_at`,
   1 dòng `learning_settings` mặc định.
2. `database/rls.sql` – thu hồi quyền truy cập bảng của role `anon`, bật mã truy cập tuỳ chọn,
   tạo các RPC (`get_study_rows`, `search_vocabulary`, `record_review`, `import_vocabulary`,
   `mark_session`, `toggle_favorite`, `delete_vocabulary`, `restore_backup`, `delete_all_data`…).

Cả hai file chạy lại được nhiều lần. Nếu bạn đã từng chạy bản có `user_id` (Anonymous Auth),
`schema.sql` sẽ **tự bỏ cột user_id** và cộng dồn dữ liệu về một kho duy nhất.

> Không cần bật Anonymous sign-ins, không cần cấu hình Authentication.

## 4. Bảo vệ dữ liệu (khuyên dùng)

Frontend dùng anon key (public) và chỉ gọi RPC. Tuy vậy, ai biết URL + anon key vẫn gọi được RPC,
nên hãy đặt **mã truy cập**:

```sql
-- Chạy trong SQL Editor, KHÔNG commit mã này lên GitHub
update public.app_config set value = 'MOT-MA-DAI-VA-KHO-DOAN' where key = 'app_access_key';
```

- Mở website → màn hình yêu cầu mã → mã được lưu trên máy đó.
- Đổi mã ở **Cài đặt → Mã truy cập**.
- Biến môi trường `APP_ACCESS_KEY` trên Vercel là tuỳ chọn, dùng chung giá trị với mã để đối chiếu.

Nếu muốn riêng tư tuyệt đối: chặn public access của Supabase (không cho truy cập từ ngoài),
hoặc chuyển sang schema có `user_id` + Anonymous Auth (bản cũ trong lịch sử git).

### Cấu hình ngay trong website (không cần deploy lại)

Mở **Cài đặt → Kết nối Supabase → Thay đổi**, nhập **Project URL** và **anon / publishable key**,
bấm **Kiểm tra kết nối** rồi **Lưu và kết nối**. Giá trị được lưu trên trình duyệt hiện tại
(LocalStorage, chỉ chứa thông tin công khai) và có độ ưu tiên cao nhất:

1. Nhập ở trang Cài đặt
2. meta trong index.html
3. js/env.js (sinh lúc build)
4. /api/config (biến môi trường Vercel)

Nút **Dùng cấu hình mặc định** xoá cấu hình nhập tay và tải lại trang. Ô **Mã truy cập** nằm cùng
nhóm để nhập mã bảo vệ kho dữ liệu. Hệ thống từ chối secret key (sb_secret_…) và service_role
để tránh lộ quyền. Thiếu bảng/RPC, sai key hay sai URL đều được báo ngay trong ô phản hồi.

## 5. Cấu hình biến môi trường

| Biến | Giá trị |
| --- | --- |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` |
| `SUPABASE_ANON_KEY` | anon / publishable key |

`VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` cũng được hỗ trợ. Trên Vercel: **Settings →
Environment Variables** (Production + Preview + Development) rồi **Redeploy**.
Nếu để trống, hệ thống dùng giá trị mặc định trong `api/config.js` và `scripts/build.mjs`.

### Chạy local

```bash
npm start                 # http://localhost:4173
set SUPABASE_URL=https://xxx.supabase.co
set SUPABASE_ANON_KEY=eyJ...
npm start
```

## 6. Import dữ liệu

**Từ vựng → Nhập CSV** – file đúng 9 trường:

```csv
word,pinyin,pos,meaning,hsk,topic,example,example_pinyin,example_meaning
学习,xuéxí,Động từ,"Học, học tập",HSK 1,school,我每天学习中文。,Wǒ měitiān xuéxí Zhōngwén.,Tôi học tiếng Trung mỗi ngày.
```

- Bắt buộc `word`, `pinyin`, `meaning`; hỗ trợ UTF-8/BOM, tiếng Việt có dấu, dấu phẩy/ngoặc kép.
- Luồng: chọn file → xem trước & kiểm tra → chọn xử lý trùng → import theo batch 500 dòng → báo cáo + tải CSV lỗi.
- Trùng theo khóa `word`: **Bỏ qua** giữ nguyên dữ liệu cũ; **Cập nhật** chỉ đổi nội dung từ vựng,
  không chạm `learning_progress` (lịch ôn, trạng thái, số lần ôn giữ nguyên).
- Nút tải file CSV mẫu ngay trong trang; dữ liệu mẫu lớn ở `samples/`.

## 7. Đưa mã nguồn lên GitHub

```bash
git init
git add .
git commit -m "feat: Hán Ngữ dictionary & flashcard app"
git branch -M main
git remote add origin https://github.com/<user>/<repo>.git
git push -u origin main
```

## 8. Deploy Vercel

1. <https://vercel.com> → **Add New → Project** → import repo.
2. Framework Preset: **Other**; Build Command `npm run build`; **Output Directory để trống**
   (`vercel.json` đã đặt `"outputDirectory": "."`); Root Directory để trống.
3. Thêm biến môi trường ở mục 5 → **Deploy**.
4. Kiểm tra: mở `/`, `/api/config` phải trả JSON; nếu hiện hướng dẫn cấu hình, xem lại biến môi trường.

## 9. Sao lưu & phục hồi

- **Cài đặt → Xuất JSON đầy đủ**: một file gồm từ vựng, tiến trình, lịch sử ôn, buổi học, yêu thích, cài đặt.
- **Khôi phục**: kiểm tra cấu trúc → xem trước → xác nhận → ghi qua RPC `restore_backup`.
  Có tuỳ chọn xoá dữ liệu hiện tại trước khi khôi phục (kèm hộp thoại xác nhận).

---

## 10. Giao diện

- **Desktop ≥ 1025px**: menu **dropdown** 3 nhóm – 📘 *Học* (Trang chủ, Ôn tập hôm nay, Lịch ôn tập),
  📚 *Từ vựng* (Tra từ, Kho từ vựng, Nhập CSV), ⚙️ *Cài đặt*; nút **Học ngay** luôn hiện.
- **Tablet 721–1024px**: logo gọn + nút Học ngay + nút menu; menu mở thành drawer bên phải (có lớp nền mờ đóng khi bấm ra ngoài).
- **Phone ≤ 720px**: header cao 56px, chỉ logo + Học ngay + menu; lưới 1 cột; chữ Hán lớn, nút đánh giá 2×2.
- Dropdown đóng bằng `Esc`, click ngoài, hoặc chọn mục; `aria-expanded`/`aria-haspopup` được cập nhật.

## 11. Thuật toán ôn tập

| Đánh giá | Lần đầu | Các lần sau |
| --- | --- | --- |
| Chưa nhớ | 10 phút | 10 phút, repetition = 0, EF −0.2 |
| Khó nhớ | 1 ngày | interval × 1.2, EF −0.15 |
| Đã nhớ | 3 ngày | interval × EF (SM-2) |
| Rất dễ | 7 ngày | interval × EF × 1.3, EF +0.15 |

EF tối thiểu 1.3; từ đạt `interval ≥ 21 ngày` và `repetition ≥ 5` được đánh dấu **thành thạo**.
Thời gian lưu **UTC**, hiển thị theo múi giờ máy.

**Buổi học hằng ngày**: từ cũ đến hạn → từ tồn đọng → từ mới (mặc định 10, tối đa 30 buổi).
Vượt giới hạn thì cắt từ mới (chưa đánh dấu đã học, tự xét cho buổi sau); không lặp từ trong buổi;
nghỉ một ngày thì hôm sau các từ đến hạn tự thành tồn đọng.

## 12. Trắc nghiệm từ vựng (game ôn tập)

Menu **Học → Trắc nghiệm** (`#quiz`):

- **Kiểu câu hỏi**: Hán tự → nghĩa · Nghĩa → Hán tự · Hán tự → pinyin · Ngẫu nhiên cả 3.
- **Số câu**: 10 / 20 / 30 (tự giảm nếu kho từ chưa đủ).
- Ưu tiên từ **đến hạn và tồn đọng** (cùng hàng đợi với Flashcard), sau đó tới từ đã học / từ mới.
- 4 đáp án, đáp án nhiễu ưu tiên cùng HSK/chủ đề; hiển thị kết quả đúng/sai ngay và phím tắt **1–4 / A–D**.
- Trả lời **sai** → từ được xếp vào buổi ôn hôm nay (RPC `queue_for_review`), không tạo bản ghi ôn giả.
- Màn kết quả: điểm, %, chuỗi đúng dài nhất, danh sách từ sai, nút **Ôn tập các từ này** (đưa sang Flashcard), **Chơi lại** (giữ kiểu câu hỏi và số câu).
- Kỷ lục lưu ở LocalStorage (`hanngu:quiz-best`), chỉ dùng để hiển thị thành tích.
- File: `js/quiz.js`; test: `tests/quiz.test.mjs` (sinh câu hỏi, đáp án nhiễu, kiểu câu hỏi).

## 13. Kiểm thử

```bash
npm test
```

Đã kiểm: khoảng cách ban đầu, SM-2, EF ≥ 1.3, due/backlog/new, giới hạn buổi, tồn đọng, lịch tháng,
parser CSV (UTF-8/BOM/ngoặc kép/10.000 dòng), validate backup.

## 14. Cập nhật phiên bản

Sửa `APP_CONFIG.version` (`js/config.js`) và `version` (`package.json`), commit, push.
Thay đổi schema: thêm `database/migrations/YYYYMMDD_mo-ta.sql`, chạy trên Supabase trước khi deploy.
