# Dự án CÒNG TAY — Tài liệu bàn giao

Tài liệu này tổng hợp toàn bộ dự án để tiếp tục làm việc trong môi trường mới (Claude Code / VS Code). Đọc file này trước, các file mã nguồn được đính kèm cùng.

---

## 1. Mục tiêu dự án

Một website thư viện video **tiếng Việt** về chủ đề **còng tay** (nội dung giải trí: thoát hiểm/escapology, ảo thuật, đánh giá sản phẩm, còng tay trong phim...). Chủ trang tự tải video lên từ máy. Người xem: công khai, miễn phí.

---

## 2. Công nghệ & lý do chọn

| Thành phần | Công nghệ | Lý do |
|---|---|---|
| Lưu trữ video | **Cloudflare R2** | Egress (băng thông tải xuống) **miễn phí** — rẻ hơn AWS S3 rất nhiều cho video công khai. Gói miễn phí 10GB vĩnh viễn. |
| Host website + API | **Cloudflare Workers** (static assets + Worker script) | Miễn phí, cùng hệ sinh thái Cloudflare. |
| Tự động deploy | **GitHub** + Workers Build | Push lên `main` → tự chạy `npx wrangler deploy`. |
| Tải video lớn | **rclone** | Dashboard R2 giới hạn 300MB/file; rclone tự chia phần. |
| Nén video | **HandBrake** | Trên Ubuntu. |
| Tạo thumbnail | **ffmpeg** | Lấy khung hình từ video. |

Môi trường máy người dùng: **Ubuntu**.

---

## 3. Thông tin cấu hình quan trọng

- **Cloudflare account / S3 endpoint:** `https://5ea6cfceb68ec86e22affd2d5688b259.r2.cloudflarestorage.com`
- **R2 bucket:** `handcuff` (khu vực Asia-Pacific / APAC)
- **Public Development URL:** `https://pub-xxxxxxxx.r2.dev` → *cần thay bằng giá trị thật từ R2 → Settings → Public Development URL.*
- **Tên Worker / project:** `cong-tay-web`
- **GitHub repo:** `thinhlt97/cong-tay-web`, nhánh production: `main`
- **Deploy command (Workers Build):** `npx wrangler deploy`, Root directory: `/`
- **R2 binding name (trong Worker):** `BUCKET`
- **Biến môi trường:** `PUBLIC_BASE` = địa chỉ `pub-xxxx.r2.dev`
- **Binding + biến được khai báo trong `wrangler.jsonc`** (không cấu hình qua dashboard).

---

## 4. Tám danh mục (đặt ở trường `category`)

Website nhóm video theo danh mục và tự gán biểu tượng dựa trên tên:

| Danh mục | Biểu tượng |
|---|---|
| Còng tay Trung Quốc | 🇨🇳 |
| Còng tay Việt Nam | 🇻🇳 |
| Còng tay Hàn Quốc | 🇰🇷 |
| Còng tay Thái Lan | 🇹🇭 |
| Còng tay quốc tế | 🌍 |
| Còng tay trong phim Việt Nam | 🎬 |
| Còng tay trong phim Trung Quốc | 🎬 |
| Còng tay trong phim nước ngoài | 🎬 |

Quy tắc gán icon (trong code): tên chứa "phim" → 🎬; còn lại dò theo quốc gia. Thứ tự hiển thị = thứ tự video xuất hiện lần đầu trong `videos.json`.

Phong cách giao diện: **sáng, hiện đại, tối giản**; font **Be Vietnam Pro**; màu nhấn đỏ cam `#ff3b25`; danh sách danh mục để phẳng (không gộp nhóm).

---

## 5. Kiến trúc hiện tại — website hoạt động thế nào

```
Trình duyệt
  │
  ├─ GET /                → worker.js trả file tĩnh index.html (trang công khai)
  ├─ GET /admin           → worker.js trả file tĩnh admin.html (trang quản trị)
  ├─ GET /api/videos      → worker.js đọc videos.json từ R2 (binding BUCKET) → trả JSON
  ├─ POST /api/admin/upload  → worker.js tải video lên R2 theo phần (multipart)
  └─ POST /api/admin/save    → worker.js lưu thumbnail + thêm mục vào videos.json

R2 bucket "handcuff" chứa: video (.mp4), thumbnail (.jpg), và videos.json
  - Video & thumbnail phát công khai trực tiếp qua https://pub-xxxx.r2.dev/<tên-file>
  - videos.json đọc qua /api/videos (cùng tên miền → KHÔNG cần CORS)
```

- **`index.html`** (trang công khai): khi tải trang, `fetch("/api/videos")` → dựng lưới video nhóm theo danh mục, có thanh menu "Danh mục" (dropdown cuộn tới khu vực), ô tìm kiếm, trình phát modal, hiệu ứng hiện dần khi cuộn.
- **`worker.js`** (mã máy chủ): router xử lý 3 API ở trên; mọi đường dẫn khác trả về file tĩnh qua `env.ASSETS.fetch(request)`.
- **`admin.html`** (`/admin`): kéo-thả video → tự đọc thời lượng + tự chụp một khung hình làm thumbnail (có thanh trượt chọn khung, hoặc tải ảnh riêng) → điền tiêu đề, danh mục, mô tả → tải lên theo từng phần 50MB (gọi `/api/admin/upload`) → lưu metadata (gọi `/api/admin/save`). Có thanh tiến trình.
- **`wrangler.jsonc`**: khai báo `main: worker.js`, `assets` (file tĩnh), binding R2 `BUCKET` → `handcuff`, biến `PUBLIC_BASE`.
- **`.assetsignore`**: ngăn các file mã nguồn (worker.js, wrangler.jsonc, ...) bị phục vụ như tài nguyên công khai.

---

## 6. Lịch sử các cách đã thử (vì sao đến kiến trúc hiện tại)

1. **Dữ liệu nhúng cứng trong `index.html`** (mảng `VIDEOS`), deploy bằng kéo-thả file. → Bất tiện: phải sửa code + deploy lại mỗi lần thêm video.
2. **Tách dữ liệu ra `videos.json` đặt trên R2, fetch trực tiếp** → vướng CORS của `r2.dev`.
3. **Chuyển `videos.json` vào trong repo (cùng origin), fetch đường dẫn tương đối** → bỏ được CORS; chuyển sang GitHub + Cloudflare auto-deploy cho chuyên nghiệp.
4. **Trang admin — thử theo Cloudflare Pages Functions** (thư mục `functions/api/...`). → **KHÔNG chạy** vì dự án thực chất là một **Worker** (deploy bằng `npx wrangler deploy`), mà mô hình Worker **không biên dịch thư mục `functions/`** (đó là quy ước của Pages). Triệu chứng: dashboard báo *"Variables cannot be added to a Worker that only has static assets"*.
5. **Hiện tại — mô hình Workers static assets:** gộp 3 file functions thành một **`worker.js`** + **`wrangler.jsonc`** khai báo binding/biến. `videos.json` chuyển về R2, đọc qua `/api/videos`. Đây là kiến trúc đang dùng.

---

## 7. Trạng thái hiện tại

| Hạng mục | Trạng thái |
|---|---|
| Trang công khai (xem video) | ✅ Hoạt động — hiển thị video từ R2. |
| Tải video thủ công qua rclone | ✅ Hoạt động (đã khắc phục các lỗi 403/NoSuchBucket). |
| Tạo thumbnail bằng ffmpeg | ✅ Có quy trình. |
| **Trang admin kéo-thả** | ⏳ **CHƯA HOÀN TẤT** — đã có đủ code (`worker.js`, `admin.html`, `wrangler.jsonc`, `.assetsignore`) nhưng chưa commit/triển khai xong + chưa bật Cloudflare Access. Đây là việc cần làm tiếp. |

---

## 8. Việc cần làm tiếp (next steps)

1. Đưa `worker.js`, `wrangler.jsonc`, `.assetsignore` vào **thư mục gốc** repo. Sửa `PUBLIC_BASE` trong `wrangler.jsonc` thành địa chỉ `pub-xxxx.r2.dev` thật.
2. **Xóa thư mục `functions/`** trong repo (đã thay bằng `worker.js`).
3. Đảm bảo `index.html` có `const DATA_URL = "/api/videos";` (đã cập nhật trong file đính kèm).
4. Commit → kiểm tra tab **Deployments**: build phải chạy `npx wrangler deploy` thành công và có **build log** (không còn là "Manually deployed" do upload tay). Sau bước này dự án không còn "static only".
5. **Bật Cloudflare Access** (Zero Trust → Access → Applications → Self-hosted) bảo vệ hai đường dẫn `/admin` và `/api/admin`, policy chỉ cho email của chủ trang. *Bắt buộc, nếu không ai cũng upload được.*
6. Đưa `videos.json` hiện có lên R2 một lần (`rclone copy "videos.json" r2:handcuff -P`) nếu muốn giữ dữ liệu cũ.
7. Test `/admin`: đăng nhập qua Access → kéo video → điền → đăng → kiểm tra trang chủ.

**Tương lai:** mua tên miền riêng (gợi ý `.com` qua Cloudflare Registrar ~$10.44/năm) rồi gắn vào Worker qua tab **Domains/Custom domains** (tự cấp SSL, không cần hosting thêm).

---

## 9. Cấu trúc kho GitHub nên có

```
cong-tay-web/
├── index.html          # trang công khai (DATA_URL = "/api/videos")
├── admin.html          # trang quản trị kéo-thả  → URL /admin
├── worker.js           # Worker: API + phục vụ file tĩnh
├── wrangler.jsonc      # cấu hình: main, assets, binding BUCKET, biến PUBLIC_BASE
├── .assetsignore       # loại trừ file mã nguồn khỏi tài nguyên công khai
└── videos.json         # (tùy chọn) dữ liệu mẫu — dữ liệu chính nằm trên R2
```

---

## 10. Lệnh thường dùng

```bash
# Nén video (HandBrake dùng GUI; hoặc ffmpeg):
# Tạo thumbnail từ khung hình giây thứ 5, rộng 640px:
ffmpeg -ss 00:00:05 -i "video.mp4" -frames:v 1 -vf "scale=640:-1" -q:v 3 "video.jpg"

# Tải 1 video lên R2:
rclone copy "video.mp4" r2:handcuff -P

# Tải toàn bộ thumbnail (.jpg) lên R2:
rclone copy . r2:handcuff --include "*.jpg" -P

# Liệt kê nội dung bucket:
rclone ls r2:handcuff
```

**Cấu hình rclone (`~/.config/rclone/rclone.conf`) — phần `[r2]` phải đúng dạng:**
```
[r2]
type = s3
provider = Cloudflare
access_key_id = <Access Key ID, 32 ký tự hex, từ token Object Read & Write>
secret_access_key = <Secret Access Key, 64 ký tự hex>
endpoint = https://5ea6cfceb68ec86e22affd2d5688b259.r2.cloudflarestorage.com
no_check_bucket = true
```

---

## 11. Các lỗi đã gặp & cách khắc phục (gotchas)

- **Dashboard R2 chỉ cho upload ≤ 300MB** → dùng rclone cho file lớn.
- **403 AccessDenied khi rclone upload** → token phải là **Object Read & Write** (không phải Read only).
- **"Anonymous users cannot invoke this API"** → file rclone.conf thiếu access_key/secret (không lưu được khóa).
- **Đọc được (`ls`) nhưng ghi (`copy`) báo 403** → rclone kiểm tra/tạo bucket bằng quyền Admin mà token Object không có → thêm `--s3-no-check-bucket` (hoặc `no_check_bucket = true` trong config).
- **NoSuchBucket** → file rclone.conf **hỏng định dạng** (dấu nháy ngược lọt vào, các dòng dính nhau). Mỗi dòng phải dạng `khóa = giá_trị`.
- **"Variables cannot be added to a Worker that only has static assets"** → vì dự án là Worker, thư mục `functions/` không được biên dịch. Giải pháp: dùng `worker.js` + `wrangler.jsonc` (khai báo binding/biến trong config, không qua dashboard).
- **Deploy ghi "Manually deployed"** → đang upload tay, không build từ Git nên `functions/`/`worker.js` không được biên dịch. Phải để build chạy từ Git (push commit → `wrangler deploy`).
- **r2.dev** mang tính "development", có giới hạn tốc độ → khi lên production nên gắn **custom domain** cho bucket.
- **File `.webm` không phát trên Safari/iPhone** → ưu tiên **`.mp4` (H.264)** để tương thích mọi thiết bị.
- **Bảo mật:** không để lộ Access Key/Secret; nếu đã lộ thì xóa token cũ và tạo token mới. Trang `/admin` và `/api/admin` phải được khóa bằng Cloudflare Access.

---

## 12. Các file đính kèm

Cùng tài liệu này có các file: `index.html`, `admin.html`, `worker.js`, `wrangler.jsonc`, `.assetsignore`, `videos.json`. Toàn bộ nội dung từng file nằm trong các file đó (đã sẵn sàng đưa vào repo).
