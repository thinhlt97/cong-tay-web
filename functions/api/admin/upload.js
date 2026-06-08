// POST /api/admin/upload  -> tải video lên R2 theo từng phần (multipart)
// Dùng R2 binding nên không cần khóa S3, không cần CORS.
// Đường dẫn /api/admin/* được bảo vệ bằng Cloudflare Access.

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export async function onRequestPost({ request, env }) {
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
