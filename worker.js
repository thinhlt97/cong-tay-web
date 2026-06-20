// worker.js — Worker chính: xử lý API + phục vụ file tĩnh
// Dùng cho mô hình Cloudflare Workers (lệnh deploy: npx wrangler deploy).

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// ── Giá trị mặc định (dùng khi file tương ứng chưa có trên R2) ──
const DEFAULT_CATEGORIES = [
  { name: "Còng tay Trung Quốc", icon: "🇨🇳" },
  { name: "Còng tay Việt Nam", icon: "🇻🇳" },
  { name: "Còng tay Hàn Quốc", icon: "🇰🇷" },
  { name: "Còng tay Thái Lan", icon: "🇹🇭" },
  { name: "Còng tay quốc tế", icon: "🌍" },
  { name: "Còng tay trong phim Việt Nam", icon: "🎬" },
  { name: "Còng tay trong phim Trung Quốc", icon: "🎬" },
  { name: "Còng tay trong phim nước ngoài", icon: "🎬" },
];

const DEFAULT_SETTINGS = {
  siteTitle: "CÒNG TAY",
  heroKicker: "Tuyển tập video",
  heroSubtitle: "Bộ sưu tập video giải trí, phân theo từng danh mục.",
  footer: "CÒNG TAY — Tuyển tập video giải trí.",
};

// Đọc một file JSON từ R2; nếu không có thì trả về giá trị mặc định.
async function readJSON(env, key, fallback) {
  try {
    const obj = await env.BUCKET.get(key);
    if (!obj) return fallback;
    const data = JSON.parse(await obj.text());
    return data;
  } catch (_) {
    return fallback;
  }
}

// Ghi một file JSON vào R2.
async function writeJSON(env, key, data) {
  await env.BUCKET.put(key, JSON.stringify(data, null, 2), {
    httpMetadata: { contentType: "application/json" },
  });
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });
}

// GET /api/videos -> đọc videos.json từ R2
async function getVideos(env) {
  const list = await readJSON(env, "videos.json", []);
  return jsonResponse(Array.isArray(list) ? list : []);
}

// GET /api/categories -> đọc categories.json (mặc định nếu chưa có)
async function getCategories(env) {
  const list = await readJSON(env, "categories.json", DEFAULT_CATEGORIES);
  return jsonResponse(Array.isArray(list) && list.length ? list : DEFAULT_CATEGORIES);
}

// GET /api/settings -> đọc settings.json (mặc định nếu chưa có)
async function getSettings(env) {
  const s = await readJSON(env, "settings.json", DEFAULT_SETTINGS);
  return jsonResponse({ ...DEFAULT_SETTINGS, ...(s && typeof s === "object" ? s : {}) });
}

// POST /api/admin/upload -> tải video lên R2 theo từng phần (multipart)
async function handleUpload(request, env) {
  const url = new URL(request.url);
  const action = url.searchParams.get("action");
  const BUCKET = env.BUCKET;
  try {
    if (action === "start") {
      const { key, contentType } = await request.json();
      const mp = await BUCKET.createMultipartUpload(key, {
        httpMetadata: { contentType: contentType || "video/mp4" },
      });
      return json({ key: mp.key, uploadId: mp.uploadId });
    }
    if (action === "part") {
      const key = url.searchParams.get("key");
      const uploadId = url.searchParams.get("uploadId");
      const part = parseInt(url.searchParams.get("part"), 10);
      const mp = BUCKET.resumeMultipartUpload(key, uploadId);
      const data = await request.arrayBuffer();
      const up = await mp.uploadPart(part, data);
      return json({ partNumber: up.partNumber, etag: up.etag });
    }
    if (action === "complete") {
      const { key, uploadId, parts } = await request.json();
      const mp = BUCKET.resumeMultipartUpload(key, uploadId);
      await mp.complete(parts);
      return json({ ok: true });
    }
    return json({ error: "unknown action" }, 400);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// Suy ra icon cho danh mục mới theo từ khóa (giống logic ở trang chủ).
function guessIcon(cat) {
  const c = (cat || "").toLowerCase();
  if (c.includes("phim")) return "🎬";
  if (c.includes("trung qu")) return "🇨🇳";
  if (c.includes("việt nam") || c.includes("viet nam")) return "🇻🇳";
  if (c.includes("hàn") || c.includes("han")) return "🇰🇷";
  if (c.includes("thái") || c.includes("thai")) return "🇹🇭";
  if (c.includes("quốc tế") || c.includes("quoc te")) return "🌍";
  return "🔒";
}

// POST /api/admin/save -> lưu thumbnail + thêm video vào đầu videos.json
async function handleSave(request, env) {
  const BUCKET = env.BUCKET;
  const BASE = (env.PUBLIC_BASE || "").replace(/\/$/, "");
  try {
    const { title, category, desc, duration, videoKey, thumbBase64 } = await request.json();
    if (!title || !videoKey) return json({ error: "Thiếu tiêu đề hoặc file" }, 400);
    // Danh mục có thể để trống lúc tải lên — phân loại lại sau trong tab Quản lý.
    const cat = String(category || "").trim() || "Chưa phân loại";

    let thumb = "";
    if (thumbBase64) {
      const thumbKey = videoKey.replace(/\.[^.]+$/, "") + ".jpg";
      await BUCKET.put(thumbKey, b64ToBytes(thumbBase64), {
        httpMetadata: { contentType: "image/jpeg" },
      });
      thumb = `${BASE}/${thumbKey}`;
    }

    const list = await readJSON(env, "videos.json", []);
    const videos = Array.isArray(list) ? list : [];
    videos.unshift({
      title, desc: desc || "", category: cat, duration: duration || "",
      type: "file", src: `${BASE}/${videoKey}`, thumb, createdAt: Date.now(),
    });
    await writeJSON(env, "videos.json", videos);

    // Tự đăng ký danh mục mới nếu chưa tồn tại (bỏ qua mục giữ chỗ "Chưa phân loại")
    if (cat !== "Chưa phân loại") {
      const cats = await readJSON(env, "categories.json", DEFAULT_CATEGORIES);
      const catList = Array.isArray(cats) ? cats : DEFAULT_CATEGORIES;
      if (!catList.some((c) => c.name === cat)) {
        catList.push({ name: cat, icon: guessIcon(cat) });
        await writeJSON(env, "categories.json", catList);
      }
    }

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// POST /api/admin/thumb -> lưu một ảnh thumbnail (JPEG) lên R2, trả về URL công khai
async function handleThumb(request, env) {
  const BUCKET = env.BUCKET;
  const BASE = (env.PUBLIC_BASE || "").replace(/\/$/, "");
  try {
    const { key, thumbBase64 } = await request.json();
    if (!key || !thumbBase64) return json({ error: "Thiếu key hoặc ảnh" }, 400);
    const safeKey = String(key).replace(/^\/+/, "");
    await BUCKET.put(safeKey, b64ToBytes(thumbBase64), {
      httpMetadata: { contentType: "image/jpeg" },
    });
    return json({ ok: true, thumb: `${BASE}/${safeKey}` });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// PUT /api/admin/videos -> thay toàn bộ videos.json (sửa/xóa/sắp xếp)
async function saveVideos(request, env) {
  try {
    const body = await request.json();
    if (!Array.isArray(body)) return json({ error: "Dữ liệu phải là một mảng" }, 400);
    // Chỉ giữ các trường hợp lệ, đảm bảo có tiêu đề + danh mục
    const clean = body.map((v) => {
      const o = {
        title: String(v.title || "").trim(),
        desc: String(v.desc || ""),
        category: String(v.category || "").trim(),
        duration: String(v.duration || ""),
        type: v.type === "embed" ? "embed" : "file",
        src: String(v.src || ""),
        thumb: String(v.thumb || ""),
      };
      // Giữ lại dấu thời gian tải lên (để trang chủ sắp theo "mới nhất")
      if (v.createdAt != null && !isNaN(+v.createdAt)) o.createdAt = +v.createdAt;
      return o;
    });
    await writeJSON(env, "videos.json", clean);
    return json({ ok: true, count: clean.length });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// PUT /api/admin/categories -> thay toàn bộ categories.json
async function saveCategories(request, env) {
  try {
    const body = await request.json();
    if (!Array.isArray(body)) return json({ error: "Dữ liệu phải là một mảng" }, 400);
    const seen = new Set();
    const clean = [];
    for (const c of body) {
      const name = String(c.name || "").trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      clean.push({ name, icon: String(c.icon || guessIcon(name)).trim() || guessIcon(name) });
    }
    if (!clean.length) return json({ error: "Cần ít nhất một danh mục" }, 400);
    await writeJSON(env, "categories.json", clean);
    return json({ ok: true, count: clean.length });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// PUT /api/admin/settings -> thay settings.json
async function saveSettings(request, env) {
  try {
    const body = await request.json();
    if (!body || typeof body !== "object") return json({ error: "Dữ liệu không hợp lệ" }, 400);
    const merged = {
      siteTitle: String(body.siteTitle ?? DEFAULT_SETTINGS.siteTitle).trim() || DEFAULT_SETTINGS.siteTitle,
      heroKicker: String(body.heroKicker ?? DEFAULT_SETTINGS.heroKicker).trim(),
      heroSubtitle: String(body.heroSubtitle ?? DEFAULT_SETTINGS.heroSubtitle).trim(),
      footer: String(body.footer ?? DEFAULT_SETTINGS.footer).trim(),
    };
    await writeJSON(env, "settings.json", merged);
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// Ngày hiện tại theo giờ VN (UTC+7), dạng YYYY-MM-DD
function dayVN(offsetDays = 0) {
  return new Date(Date.now() + 7 * 3600e3 - offsetDays * 86400e3).toISOString().slice(0, 10);
}

// POST /api/track -> đếm lượt truy cập / lượt xem video (công khai)
//   { type: "visit" }                          -> +1 lượt truy cập trang
//   { type: "view", key, title }               -> +1 lượt xem video
async function handleTrack(request, env) {
  try {
    if (!env.STATS) return json({ ok: false });
    const body = await request.json().catch(() => ({}));
    const type = body.type === "view" ? "view" : "visit";
    const day = dayVN();
    const stmts = [
      env.STATS.prepare(
        "INSERT INTO daily(day,metric,count) VALUES(?1,?2,1) ON CONFLICT(day,metric) DO UPDATE SET count=count+1"
      ).bind(day, type),
    ];
    if (type === "view" && body.key) {
      const now = new Date().toISOString();
      stmts.push(
        env.STATS.prepare(
          "INSERT INTO videos(vkey,title,views,last_view) VALUES(?1,?2,1,?3) " +
          "ON CONFLICT(vkey) DO UPDATE SET views=views+1, last_view=?3, title=COALESCE(NULLIF(?2,''),title)"
        ).bind(String(body.key), String(body.title || ""), now)
      );
    }
    await env.STATS.batch(stmts);
    return json({ ok: true });
  } catch (e) {
    return json({ ok: false, error: String((e && e.message) || e) });
  }
}

// GET /api/admin/stats -> tổng hợp thống kê cho trang admin (được Access bảo vệ)
async function getStats(env) {
  try {
    if (!env.STATS) return json({ error: "D1 (STATS) chưa được cấu hình" }, 500);
    const since = dayVN(13); // 14 ngày gần nhất
    const [totals, videos, daily] = await Promise.all([
      env.STATS.prepare(
        "SELECT (SELECT COALESCE(SUM(views),0) FROM videos) AS totalViews, " +
        "(SELECT COALESCE(SUM(count),0) FROM daily WHERE metric='visit') AS totalVisits, " +
        "(SELECT COUNT(*) FROM videos) AS trackedVideos"
      ).first(),
      env.STATS.prepare("SELECT vkey,title,views,last_view FROM videos ORDER BY views DESC LIMIT 300").all(),
      env.STATS.prepare("SELECT day,metric,count FROM daily WHERE day>=?1 ORDER BY day").bind(since).all(),
    ]);
    return jsonResponse({
      totals: totals || { totalViews: 0, totalVisits: 0, trackedVideos: 0 },
      videos: videos.results || [],
      daily: daily.results || [],
    });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

// GET / -> phục vụ index.html, chèn động og:image = ảnh đại diện video mới nhất.
// (Trình quét của Facebook/Zalo không chạy JS nên phải chèn ở server.)
async function serveHome(request, env) {
  const res = await env.ASSETS.fetch(request);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;

  let img = "";
  let list = [];
  try {
    const raw = await readJSON(env, "videos.json", []);
    list = Array.isArray(raw) ? raw : [];
    const v = list.find((x) => x && x.thumb);
    if (v) img = v.thumb;
  } catch (_) {}

  const setOrRemove = { element(e) { img ? e.setAttribute("content", img) : e.remove(); } };

  // JSON-LD: danh sách video (giúp Google hiểu nội dung + cơ hội rich result)
  const vids = list.filter((v) => v && v.title).slice(0, 30).map((v) => {
    const o = {
      "@type": "VideoObject",
      name: v.title,
      description: v.desc || v.title,
      thumbnailUrl: v.thumb || img || undefined,
      uploadDate: v.createdAt ? new Date(v.createdAt).toISOString() : undefined,
      contentUrl: v.type === "file" ? v.src : undefined,
      embedUrl: v.type === "embed" ? v.src : undefined,
    };
    Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]);
    return o;
  });
  let ld = "";
  if (vids.length) {
    const doc = {
      "@context": "https://schema.org",
      "@type": "ItemList",
      name: "Tuyển tập video còng tay",
      itemListElement: vids.map((it, i) => ({ "@type": "ListItem", position: i + 1, item: it })),
    };
    // chèn JSON vào HTML: thay "<" để không phá thẻ <script>
    ld = `<script type="application/ld+json">${JSON.stringify(doc).replace(/</g, "\\u003c")}</script>`;
  }

  let rw = new HTMLRewriter()
    .on('meta[property="og:image"]', setOrRemove)
    .on('meta[name="twitter:image"]', setOrRemove);
  if (ld) rw = rw.on("head", { element(e) { e.append(ld, { html: true }); } });
  return rw.transform(res);
}

// GET /watch?v=<src> -> phục vụ watch.html, chèn động tiêu đề + og:image + JSON-LD
// cho đúng video (bot mạng xã hội / Google không chạy JS nên phải chèn ở server).
async function serveWatch(request, env) {
  const url = new URL(request.url);
  const assetReq = new Request(new URL("/watch.html", url), { method: "GET", headers: request.headers });
  const res = await env.ASSETS.fetch(assetReq);
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("text/html")) return res;

  const want = url.searchParams.get("v") || "";
  let video = null;
  try {
    const raw = await readJSON(env, "videos.json", []);
    const list = Array.isArray(raw) ? raw : [];
    video = list.find((x) => x && (x.src || "") === want) || null;
  } catch (_) {}

  const site = "CÒNG TAY";
  const title = video ? `${video.title} · ${site}` : `Đang xem · ${site}`;
  const desc = video ? (video.desc || video.title) : "Xem video còng tay - tuyển tập video giải trí.";
  const img = video ? (video.thumb || "") : "";
  const canon = `https://congtay.com/watch${want ? "?v=" + encodeURIComponent(want) : ""}`;

  const setContent = (val) => ({ element(e) { val ? e.setAttribute("content", val) : e.remove(); } });

  let rw = new HTMLRewriter()
    .on("title", { element(e) { e.setInnerContent(title); } })
    .on('meta[name="description"]', setContent(desc))
    .on('meta[property="og:title"]', setContent(title))
    .on('meta[property="og:description"]', setContent(desc))
    .on('meta[property="og:url"]', setContent(canon))
    .on('meta[property="og:image"]', setContent(img))
    .on('meta[name="twitter:title"]', setContent(title))
    .on('meta[name="twitter:description"]', setContent(desc))
    .on('meta[name="twitter:image"]', setContent(img))
    .on('link[rel="canonical"]', { element(e) { e.setAttribute("href", canon); } });

  if (video) {
    const o = {
      "@context": "https://schema.org",
      "@type": "VideoObject",
      name: video.title,
      description: video.desc || video.title,
      thumbnailUrl: video.thumb || undefined,
      uploadDate: video.createdAt ? new Date(video.createdAt).toISOString() : undefined,
      contentUrl: video.type === "file" ? video.src : undefined,
      embedUrl: video.type === "embed" ? video.src : undefined,
    };
    Object.keys(o).forEach((k) => o[k] === undefined && delete o[k]);
    const ld = `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, "\\u003c")}</script>`;
    rw = rw.on("head", { element(e) { e.append(ld, { html: true }); } });
  }
  return rw.transform(res);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const method = request.method;

    // ── Ép HTTPS + gộp www.congtay.com về congtay.com (301) ──
    let scheme = url.protocol.replace(":", "");
    const cfv = request.headers.get("CF-Visitor");
    if (cfv) { try { const o = JSON.parse(cfv); if (o && o.scheme) scheme = o.scheme; } catch (_) {} }
    const isWww = url.hostname === "www.congtay.com";
    if (scheme !== "https" || isWww) {
      const targetHost = isWww ? "congtay.com" : url.hostname;
      return Response.redirect(`https://${targetHost}${url.pathname}${url.search}`, 301);
    }

    const { pathname } = url;

    // ── Trang chủ: chèn og:image động ──
    if ((pathname === "/" || pathname === "/index.html") && method === "GET")
      return serveHome(request, env);

    // ── Trang xem video riêng: chèn meta động cho từng video ──
    if (pathname === "/watch" && method === "GET")
      return serveWatch(request, env);

    // ── API đọc (công khai) ──
    if (pathname === "/api/videos") return getVideos(env);
    if (pathname === "/api/categories") return getCategories(env);
    if (pathname === "/api/settings") return getSettings(env);
    if (pathname === "/api/track" && method === "POST") return handleTrack(request, env);

    // ── API admin (phải được Cloudflare Access bảo vệ) ──
    if (pathname === "/api/admin/stats" && method === "GET") return getStats(env);
    if (pathname === "/api/admin/upload" && method === "POST") return handleUpload(request, env);
    if (pathname === "/api/admin/save" && method === "POST") return handleSave(request, env);
    if (pathname === "/api/admin/thumb" && method === "POST") return handleThumb(request, env);
    if (pathname === "/api/admin/videos" && method === "PUT") return saveVideos(request, env);
    if (pathname === "/api/admin/categories" && method === "PUT") return saveCategories(request, env);
    if (pathname === "/api/admin/settings" && method === "PUT") return saveSettings(request, env);

    // còn lại: trả về file tĩnh (index.html, admin.html, ...)
    return env.ASSETS.fetch(request);
  },
};
