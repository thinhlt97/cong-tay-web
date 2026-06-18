-- Thống kê cho Còng Tay Web (D1)
-- Bảng đếm lượt xem từng video
CREATE TABLE IF NOT EXISTS videos (
  vkey      TEXT PRIMARY KEY,          -- định danh video (dùng URL src)
  title     TEXT,                      -- tiêu đề tại thời điểm xem gần nhất
  views     INTEGER NOT NULL DEFAULT 0,
  last_view TEXT                       -- ISO timestamp lần xem gần nhất
);

-- Bảng đếm theo ngày: metric = 'visit' (truy cập trang) hoặc 'view' (mở video)
CREATE TABLE IF NOT EXISTS daily (
  day    TEXT NOT NULL,                -- YYYY-MM-DD (giờ VN)
  metric TEXT NOT NULL,
  count  INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, metric)
);
