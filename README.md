# Fit

Personal wardrobe app. Static site on Cloudflare Workers (static assets); rendering runs in a Supabase Edge Function.

Deploys: every push to `main` is built by Cloudflare Workers Builds — build command `npm run build` (unpacks the binary assets from `tools/bin`), deploy command `npx wrangler deploy`.

Layout: site at the root (`index.html`, `app.js`, …); `netlify/functions/render-background.mjs` is the render source of truth, ported to `supabase/functions/render/index.ts` by `tools-port.py`; `engine-lab/` is the engine test harness.
