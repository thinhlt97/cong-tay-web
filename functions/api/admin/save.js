// POST /api/admin/save  -> lưu thumbnail + thêm video mới vào videos.json
// Được bảo vệ bằng Cloudflare Access.

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

export async function onRequestPost({ request, env }) {
  const BUCKET = env.BUCKET;
  const BASE = (env.PUBLIC_BASE || "").replace(/\/$/, "");
  try {
    const { title, category, desc, duration, videoKey, thumbBase64 } = await request.json();
    if (!title || !category || !videoKey) return json({ error: "Thiếu tiêu đề, danh mục hoặc file" }, 400);

    // lưu thumbnail (nếu có)
    let thumb = "";
    if (thumbBase64) {
      const thumbKey = videoKey.replace(/\.[^.]+$/, "") + ".jpg";
      await BUCKET.put(thumbKey, b64ToBytes(thumbBase64), {
        httpMetadata: { contentType: "image/jpeg" },
      });
      thumb = `${BASE}/${thumbKey}`;
    }

    // đọc danh sách hiện có, thêm video mới lên đầu
    let list = [];
    const obj = await BUCKET.get("videos.json");
    if (obj) {
      try { list = await obj.json(); } catch (_) {}
      if (!Array.isArray(list)) list = [];
    }
    list.unshift({
      title,
      desc: desc || "",
      category,
      duration: duration || "",
      type: "file",
      src: `${BASE}/${videoKey}`,
      thumb,
    });

    await BUCKET.put("videos.json", JSON.stringify(list, null, 2), {
      httpMetadata: { contentType: "application/json" },
    });

    return json({ ok: true });
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
