# Fit

Personal wardrobe app. Static site on Cloudflare Workers (static assets), Supabase for auth/data/storage, Supabase Edge Function `render` for garment images.

## Deploy

Every push to `main` is built and deployed by Cloudflare Workers Builds:

- build: `npm run build` (unpacks `tools/bin/*.b64` into the site root)
- deploy: `npx wrangler deploy`

Binary and large files are carried in `tools/bin/` as base64 (optionally gzipped, optionally split into `.partN` files) because they are pushed through a text-only connector.
