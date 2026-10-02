// Fit Worker. The site itself is served from static assets; this script only exists so the
// Worker can run a cron that keeps the Supabase free-tier project from being paused for
// inactivity (it pauses after 7 days without API traffic). Nothing here touches user data:
// the ping is an anonymous REST call with the public key, which RLS answers with an empty set.
const SUPABASE_URL = 'https://xgfdcyslfujvcqrlbxuu.supabase.co';
const PUBLISHABLE_KEY = 'sb_publishable_295EUK4NsgOJazGnEvkfrg_rqD91DHx';

export default {
  async scheduled(event, env, ctx) {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/aesthetics?select=id&limit=1`, {
      headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${PUBLISHABLE_KEY}` },
    });
    console.log(`supabase keepalive: ${r.status}`);
  },
  // Anything that isn't a static asset (assets are served first) gets the SPA shell.
  async fetch(request, env) {
    return env.ASSETS.fetch(new Request(new URL('/', request.url), request));
  },
};
