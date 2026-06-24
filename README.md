# Inner Circle Group — Business Dashboard

A self-hosted business intelligence dashboard for Inner Circle Group. It reads
live data directly from **HubSpot** and **Meta (Facebook) Ads** and renders KPIs,
marketing trends, consultant/strategist performance, contract pipeline, and
financials in a single password-protected view.

- **Frontend:** React + Vite + Recharts + Tailwind (light/dark)
- **Backend:** Node/Express, built to a single `dist/index.cjs`
- **Data:** HubSpot CRM (deals/pipelines) + Meta Marketing API (ad spend/leads)
- **Auth:** simple shared-password login (no cookies — token sent per request)

---

## How it gets data

The server talks to the upstream APIs **directly** using tokens you supply as
environment variables:

| Service | Env var | Endpoint used |
| --- | --- | --- |
| HubSpot | `HUBSPOT_TOKEN` | `https://api.hubapi.com` with `Authorization: Bearer <token>` |
| Meta Ads | `META_TOKEN` | `https://graph.facebook.com` with `?access_token=<token>` |

If `META_TOKEN` is missing or expired, the Meta section degrades gracefully and
shows an amber "refresh your token" notice — the rest of the dashboard keeps
working.

---

## 1. Get your tokens

### HubSpot (required)

1. HubSpot → **Settings → Integrations → Private Apps → Create a private app**.
2. Under **Scopes**, add:
   - `crm.objects.deals.read` (required)
   - `crm.objects.owners.read` (optional — gives live consultant/strategist
     names; without it the dashboard uses a baked-in name map)
3. Copy the access token (starts with `pat-`). This is your `HUBSPOT_TOKEN`.

### Meta / Facebook Ads (optional)

1. Generate a **long-lived** or **system-user** token (a normal user token
   expires in ~1 hour and will break the Meta section).
   - Business Settings → **System Users** → add a system user → **Generate token**
     → select your ad account → scope `ads_read`.
2. Copy it. This is your `META_TOKEN`.

> The Meta token previously in use expired on 19 June. Use a system-user token
> so it doesn't expire again.

---

## 2. Run locally (optional)

```bash
npm install
cp .env.example .env      # then fill in HUBSPOT_TOKEN / META_TOKEN
npm run build
npm start                 # serves on http://localhost:5000
```

Log in with the value of `DASHBOARD_PASSWORD` (default `InnerCircle2026`).

---

## 3. Deploy to Railway

Railway auto-detects this as a Node app and runs **install → build → start** with
no extra config. (The build tooling lives in `devDependencies`, which Railway
installs by default — do **not** set `--omit=dev`, or the build step will fail.)

1. Push this repo to GitHub (see below) — or use the Railway CLI.
2. Railway → **New Project → Deploy from GitHub repo** → pick this repo.
3. Railway → your service → **Variables**, add:

   | Variable | Value |
   | --- | --- |
   | `HUBSPOT_TOKEN` | your HubSpot private-app token |
   | `META_TOKEN` | your Meta system-user token (optional) |
   | `DASHBOARD_PASSWORD` | the login password you want |

   You do **not** need to set `PORT` — Railway injects it and the server reads it.

4. Railway builds and deploys automatically. The default commands are:
   - Install: `npm install`
   - Build: `npm run build`
   - Start: `npm start` (`NODE_ENV=production node dist/index.cjs`)

   If Railway ever fails to detect them, set the Start command to
   `npm start` in **Settings → Deploy**.

5. Open the Railway-provided URL (e.g. `something.up.railway.app`) and confirm
   the dashboard loads and logs in.

---

## 4. Custom domain — dashboard.innercirclegroup.com.au

### In Railway

1. Railway → your service → **Settings → Networking → Custom Domain**.
2. Enter `dashboard.innercirclegroup.com.au`.
3. Railway shows a **CNAME target** (something like
   `xxxx.up.railway.app`). Copy it. Railway will issue the SSL certificate
   automatically once DNS resolves.

### In Cloudflare

1. Cloudflare → the `innercirclegroup.com.au` zone → **DNS → Add record**.
2. Add:
   - **Type:** `CNAME`
   - **Name:** `dashboard`
   - **Target:** the Railway CNAME target from above
   - **Proxy status:** start with **DNS only** (grey cloud) so Railway can
     validate and issue its certificate. Once it's live with valid SSL you can
     switch to **Proxied** (orange cloud) if you want Cloudflare in front — but
     if you do, set SSL/TLS mode to **Full (strict)** to avoid redirect loops.
3. Wait for DNS to propagate (usually a few minutes). Railway flips the domain
   to "Active" and issues the cert.
4. Visit `https://dashboard.innercirclegroup.com.au`.

---

## Project layout

```
server/
  index.ts          # Express bootstrap, reads PORT, dotenv/config
  routes.ts         # /api/login, /api/dashboard, /api/meta, /api/health
  icg/
    proxy.ts        # apiFetch() — direct HubSpot/Meta calls via env tokens
    hubspot.ts      # throttled deal search/count (handles 429s)
    meta.ts         # Meta Ads fetch (graceful expiry handling)
    metrics.ts      # buildDashboard() — assembles all sections
    reference.ts    # pipeline/stage/owner maps + helpers
client/src/
  pages/            # login + dashboard
  components/       # KPI cards, sections, logo
  lib/              # api client + AUD/number formatters
script/build.ts     # builds client (vite) + server (esbuild) → dist/
```

## Notes

- **Caching:** the dashboard caches data for 5 minutes. Append `?refresh=1` to
  the dashboard API or use the in-app refresh button to force a reload.
- **HubSpot rate limits:** deal searches are serialized (~3.5 req/sec) with
  automatic retry on HTTP 429, so large pipelines load without errors.
- **Security:** `.env` is git-ignored. Never commit real tokens — set them in
  Railway Variables instead.
