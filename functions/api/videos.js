// GET /api/videos  -> trả về videos.json từ R2 (cùng tên miền, không cần CORS)
export async function onRequestGet({ env }) {
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
