# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project overview

**Còng Tay Web** — a Vietnamese video library website about handcuffs (escapology, magic, product reviews, film clips), hosted entirely on Cloudflare. No build step, no npm dependencies — every file is deployed as-is via `npx wrangler deploy`.

## Deploy

```bash
# Deploy to Cloudflare Workers (requires wrangler auth)
npx wrangler deploy

# Preview locally (no R2 binding — APIs will fail, static pages work)
npx wrangler dev
```

The GitHub repo (`thinhlt97/cong-tay-web`, branch `main`) is connected to Cloudflare Workers Build, which runs `npx wrangler deploy` automatically on every push.

## Tooling for content management

```bash
# Generate thumbnail from video (frame at 5s, 640px wide)
ffmpeg -ss 00:00:05 -i "video.mp4" -frames:v 1 -vf "scale=640:-1" -q:v 3 "video.jpg"

# Upload a video to R2
rclone copy "video.mp4" r2:handcuff -P

# Upload all thumbnails
rclone copy . r2:handcuff --include "*.jpg" -P

# Sync videos.json to R2
rclone copy "videos.json" r2:handcuff -P

# List bucket contents
rclone ls r2:handcuff
```

## Architecture

The project is a **Cloudflare Workers static assets** deployment — a single `worker.js` handles API routes; all other requests fall through to the static file handler (`env.ASSETS.fetch`).

```
Browser
  ├─ GET /                → worker.js → ASSETS (index.html)
  ├─ GET /watch?v=<src>   → worker.js → ASSETS (watch.html), injects per-video
  │                         <title>/og:*/canonical + VideoObject JSON-LD
  ├─ GET /admin           → worker.js → ASSETS (admin.html)
  ├─ GET /api/videos      → worker.js reads videos.json from R2
  ├─ GET /api/categories  → worker.js reads categories.json from R2 (defaults if missing)
  ├─ GET /api/settings    → worker.js reads settings.json from R2 (defaults if missing)
  ├─ POST /api/admin/upload      → worker.js multipart upload to R2
  ├─ POST /api/admin/save        → worker.js saves thumbnail + prepends to videos.json
  │                                 (also auto-registers a new category in categories.json)
  ├─ POST /api/admin/thumb       → worker.js uploads one JPEG to R2, returns its public URL
  │                                 (used to change the thumbnail of an existing video)
  ├─ PUT  /api/admin/videos      → worker.js replaces videos.json (edit/delete/reorder)
  ├─ PUT  /api/admin/categories  → worker.js replaces categories.json
  └─ PUT  /api/admin/settings    → worker.js replaces settings.json

R2 bucket "handcuff": video files (.mp4), thumbnails (.jpg), videos.json,
                      categories.json, settings.json
  - Videos/thumbnails served publicly via https://pub-xxxx.r2.dev/<key>
  - JSON data served via /api/* (same-origin, no CORS needed)
```

**Admin page (`admin.html`) is a 4-tab management UI:**
- **Đăng video** — the drag-and-drop upload flow (unchanged).
- **Quản lý video** — list/edit/delete/reorder all videos; saves the whole list via `PUT /api/admin/videos`. Array order = display order on the homepage (within each category). Each row has a **"Đổi ảnh"** button that opens a thumbnail editor: it loads the existing video (cross-origin from `pub-*.r2.dev`) into a `<video>`, scrubs frames, captures one via canvas, and uploads it through `POST /api/admin/thumb` on save (under a new cache-busting key). Custom image upload is also offered.
- **Danh mục** — add/rename/delete/reorder categories + custom emoji icon; saves via `PUT /api/admin/categories`.
- **Trang chủ** — edit homepage texts (site title, kicker, subtitle, footer); saves via `PUT /api/admin/settings`.

Reordering uses a `makeSortable()` helper (HTML5 drag via the ⠿ handle, plus ▲▼ buttons). Order is read from the DOM at save time, so reordering needs no separate state sync.

**Key files:**
- `worker.js` — all server-side logic (API router + static fallback)
- `wrangler.jsonc` — Worker config: `main`, `assets`, R2 binding `BUCKET → handcuff`, env var `PUBLIC_BASE`
- `index.html` — public viewer: fetches `/api/videos`, renders grouped-by-category grid. Each card is an `<a href="/watch?v=<encoded src>">` (real link → good for SEO/crawlers); there is no longer an in-page modal player.
- `watch.html` — single-video watch page: reads `?v=<src>`, fetches `/api/videos`, plays that video (`<video>` or embed `<iframe>`) and renders a **"Video gợi ý"** grid (random suggestions, same-category first then random others). Fires `POST /api/track` view+visit. Per-video meta is injected server-side by `serveWatch()`.
- `admin.html` — drag-and-drop upload UI: reads duration/thumbnail client-side, calls `/api/admin/upload` (multipart, 50 MB chunks) then `/api/admin/save`
- `.assetsignore` — prevents `worker.js`, `wrangler.jsonc`, the `*.json` data files, etc. from being served as public assets
- `videos.json`, `categories.json`, `settings.json` — local samples only; the live data lives in R2

## Configuration

`PUBLIC_BASE` in `wrangler.jsonc` must be set to the real R2 public development URL (`pub-xxxx.r2.dev`). It is used by `worker.js` to build `src` and `thumb` URLs when saving new videos.

R2 binding name in `worker.js` is `BUCKET` (matches `wrangler.jsonc`).

## Security requirement

Routes `/admin` and `/api/admin/*` **must** be protected by Cloudflare Access (Zero Trust → Access → Applications → Self-hosted). Without it, anyone can upload to / delete from R2.

**Current state (configured 2026-06-11):** one self-hosted Access app (id `e65a9bc3-…`) with an
Allow policy for `luongtuanthinh101197@gmail.com` via the One-time PIN IdP. Public read APIs
(`/api/videos`, `/api/categories`, `/api/settings`) are intentionally left open.

**Custom domain (added 2026-06-18):** the site now serves on `congtay.com` / `www.congtay.com`
(custom_domain routes in `wrangler.jsonc`); the old `*.workers.dev` URL is disabled
(`workers_dev` not set). **The Access app `destinations` MUST include the live host** — i.e.
`congtay.com/admin` and `congtay.com/api/admin` (add `www.` variants too if used). After the
domain switch, `/admin` was briefly world-writable because the app still only listed the old
`workers.dev` host. Whenever the serving host changes, update the Access app destinations to match.

⚠️ **Gotcha:** the Access app `domain`/`destinations` must use the **exact live host serving the
Worker** (now `congtay.com`), not the account apex. An app pointed at the wrong/old host silently
protects nothing — `/admin` and every write endpoint become world-writable. Verify with
`curl -sI https://congtay.com/admin`: a protected route returns a 302 redirect to a
`*.cloudflareaccess.com` login page; a bare `200` (the admin HTML) means it is NOT protected.

## Video categories and icon mapping

Categories now live in `categories.json` (`[{name, icon}]`) on R2 — order and icons are
editable from the admin **Danh mục** tab. The homepage reads `/api/categories` and renders
sections in that order; any category found on a video but missing from the list is appended
last. If `categories.json` doesn't exist yet, `worker.js` serves these eight defaults, and
`index.html` falls back to keyword-based icons (`guessIcon`: names containing "phim" → 🎬,
otherwise matched by country keyword):

| Category | Icon |
|---|---|
| Còng tay Trung Quốc | 🇨🇳 |
| Còng tay Việt Nam | 🇻🇳 |
| Còng tay Hàn Quốc | 🇰🇷 |
| Còng tay Thái Lan | 🇹🇭 |
| Còng tay quốc tế | 🌍 |
| Còng tay trong phim Việt Nam | 🎬 |
| Còng tay trong phim Trung Quốc | 🎬 |
| Còng tay trong phim nước ngoài | 🎬 |

The same keyword fallback (`guessIcon`) lives in `worker.js` to pick an icon when a brand-new
category is auto-registered during upload.

## Known gotchas

- **`.webm` files don't play on Safari/iOS** — always use `.mp4` (H.264).
- **Thumbnail frame-capture needs R2 CORS** — capturing a frame from an already-published video in the admin "Quản lý video" tab loads it cross-origin from `pub-*.r2.dev`; without a CORS rule (`AllowedOrigins: *`, `GET`/`HEAD`) on the `handcuff` bucket the canvas becomes tainted and `toDataURL()` throws. The bucket CORS policy is already configured for this.
- **R2 dashboard upload limit is 300 MB** — use rclone for larger files.
- **rclone 403 on write** — token must be "Object Read & Write", not "Read only"; also requires `no_check_bucket = true` in rclone config (Object tokens lack bucket-admin permission).
- **`functions/` directory is ignored** — this is a Worker project (`npx wrangler deploy`), not a Pages project. The `functions/` convention only applies to Pages; adding it here does nothing.
- **"Variables cannot be added to a Worker that only has static assets"** — means there is no `worker.js` or it isn't referenced in `wrangler.jsonc`. Bindings and vars must be declared in `wrangler.jsonc`, not via the dashboard.
- **`wrangler dev` won't bind R2** locally without additional setup — test API routes against the deployed Worker.
- **`run_worker_first: true`** in `wrangler.jsonc` — the Worker runs before static assets on *every* request so it can (1) force HTTPS, (2) redirect `www.congtay.com` → `congtay.com` (301), (3) inject a dynamic `og:image` (latest video thumbnail) into the homepage via `HTMLRewriter` in `serveHome()`, and (4) inject per-video `<title>`/`og:*`/`canonical` + `VideoObject` JSON-LD into `/watch` via `serveWatch()` (fetches `watch.html` as an asset, then rewrites it). Other requests still fall through to `env.ASSETS.fetch`. HTTPS is enforced in code (not via the zone's "Always Use HTTPS" toggle) because the available API token can't edit zone settings.
- **SEO/social files:** `favicon.svg`, `robots.txt` are served as static assets (not in `.assetsignore`). `admin.html` is `noindex,nofollow`. Open Graph/Twitter meta live in `index.html`/`watch.html`; the image (and per-video meta on `/watch`) is filled server-side. **`sitemap.xml` is generated dynamically** by `serveSitemap()` in `worker.js` (homepage + one `/watch?v=…` URL per video, each with a `<video:video>` Google video-sitemap block) — there is no static `sitemap.xml` file anymore.
- **Web Analytics** beacon snippet is embedded manually in `index.html` (token `3f9adff8…`) because auto-install doesn't inject into Worker-served HTML. The dashboard gives site-wide traffic.
- **Per-video view stats (D1):** binding `STATS` → D1 database `congtay-stats` (`schema.sql`: tables `videos` and `daily`). `index.html` fires `POST /api/track` `{type:"visit"}` on the homepage; `watch.html` fires both `{type:"visit"}` and `{type:"view",key:src,title}` on load (one view per watch-page load). The worker upserts counts (SQLite `ON CONFLICT … DO UPDATE`). Admin **Thống kê** tab reads `GET /api/admin/stats` (Access-protected) — totals, 14-day visit/view chart, per-video view table. Edit schema with `npx wrangler d1 execute congtay-stats --remote --file=schema.sql`. The custom counter isn't bot-filtered (Web Analytics is the authoritative traffic source); the value-add is per-video views (each video now has its own `/watch?v=…` URL).
