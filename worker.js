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

// GET /api/videos -> đọc videos.json từ R2
async function getVideos(env) {
  try {
    const obj = await env.BUCKET.get("videos.json");
    const body = obj ? await obj.text() : "[]";
    return new Response(body, {
      headers: { "content-type": "application/json", "cache-control": "no-store" },
    });
  } catch (e) {
    return new Response("[]", { headers: { "content-type": "application/json" } });
  }
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

// POST /api/admin/save -> lưu thumbnail + thêm video vào videos.json
async function handleSave(request, env) {
  const BUCKET = env.BUCKET;
  const BASE = (env.PUBLIC_BASE || "").replace(/\/$/, "");
  try {
    const { title, category, desc, duration, videoKey, thumbBase64 } = await request.json();
    if (!title || !category || !videoKey) return json({ error: "Thiếu tiêu đề, danh mục hoặc file" }, 400);

    let thumb = "";
    if (thumbBase64) {
      const thumbKey = videoKey.replace(/\.[^.]+$/, "") + ".jpg";
      await BUCKET.put(thumbKey, b64ToBytes(thumbBase64), {
        httpMetadata: { contentType: "image/jpeg" },
      });
      thumb = `${BASE}/${thumbKey}`;
    }

    let list = [];
    const obj = await BUCKET.get("videos.json");
    if (obj) {
      try { list = await obj.json(); } catch (_) {}
      if (!Array.isArray(list)) list = [];
    }
    list.unshift({
      title, desc: desc || "", category, duration: duration || "",
      type: "file", src: `${BASE}/${videoKey}`, thumb,
    });
    await BUCKET.put("videos.json", JSON.stringify(list, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });
    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/api/videos") return getVideos(env);
    if (pathname === "/api/admin/upload" && request.method === "POST") return handleUpload(request, env);
    if (pathname === "/api/admin/save" && request.method === "POST") return handleSave(request, env);
    // còn lại: trả về file tĩnh (index.html, admin.html, ...)
    return env.ASSETS.fetch(request);
  },
};
