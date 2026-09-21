/* Fit — the photoreal layer. Each piece is rendered onto the mannequin once and kept for ever; outfits are
   composed instantly from those layers in a canvas, and the finished photograph is cached per outfit. */
window.FitRender = (function () {
  // The render service is a Supabase Edge Function ("render"). It answers 202 at once and keeps
  // working in the background; the browser polls render_jobs. The Netlify path is kept as a
  // fallback only while the old site still exists.
  const FN = 'https://xgfdcyslfujvcqrlbxuu.supabase.co/functions/v1/render';
  const ANON = 'sb_publishable_295EUK4NsgOJazGnEvkfrg_rqD91DHx';
  const W = 1024, H = 1536;
  const ORDER = { shoes: 1, trousers: 2, accessory: 3, top: 4, shirt: 4.5, knit: 5, layer: 5.5, outer: 6 };
  // Played in this order it reads as someone standing, shifting their weight and turning away,
  // rather than an object revolving. Must stay in step with POSES in the render function.
  const POSES = [
    { id: 'front',   label: 'Front' },
    { id: 'shift',   label: 'Weight shifted' },
    { id: 'quarter', label: 'Three-quarter' },
    { id: 'side',    label: 'Side' },
    { id: 'back34',  label: 'Turning away' },
    { id: 'back',    label: 'Back' },
  ];

  let ctx = null;   // { sb, wardrobeId, signedUrl, token }
  function init(o) { ctx = o; }

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function job(payload, onTick) {
    const { data: row, error } = await ctx.sb.from('render_jobs').insert({ wardrobe_id: ctx.wardrobeId, kind: payload.op === 'polish' ? 'polish' : payload.op, ref: payload.ref || null }).select().single();
    if (error) throw new Error(error.message);
    const { data: { session } } = await ctx.sb.auth.getSession();
    if (!session) throw new Error('Signed out — sign in again');
    let res;
    try {
      res = await fetch(FN, { method: 'POST', headers: { 'content-type': 'application/json', apikey: ANON, authorization: `Bearer ${session.access_token}` }, body: JSON.stringify(Object.assign({ job_id: row.id, wardrobe_id: ctx.wardrobeId }, payload)) });
    } catch (e) {
      try { await ctx.sb.from('render_jobs').update({ status: 'error', error: 'Could not reach the render service (network).' }).eq('id', row.id); } catch (_) {}
      throw new Error('Could not reach the render service. Check your connection and try again.');
    }
    const fail = async (msg) => {
      try { await ctx.sb.from('render_jobs').update({ status: 'error', error: msg }).eq('id', row.id); } catch (e) {}
      throw new Error(msg);
    };
    if (res.status === 404) await fail('The render service isn’t deployed.');
    if (res.status === 401) await fail('The render service rejected your sign-in. Sign out and in again.');
    if (res.status === 413) await fail('The request was too large for the render service. Nothing was sent or charged.');
    if (!res.ok && res.status !== 202) await fail(`Render service returned ${res.status}`);
    // poll the job row: the work happens in the background and survives a reload
    const started = Date.now();
    for (let i = 0; Date.now() - started < 9 * 60 * 1000; i++) {
      await sleep(i < 5 ? 1500 : 3000);
      const { data } = await ctx.sb.from('render_jobs').select('status, path, error, cost_usd, ms, model, quality').eq('id', row.id).single();
      if (!data) continue;
      onTick && onTick(data.status, data);
      if (data.status === 'done') { last = data; return payload.full ? data : data.path; }
      if (data.status === 'error') throw new Error(data.error || 'Render failed');
    }
    throw new Error('Timed out waiting for the render');
  }
  let last = null;
  function lastJob() { return last; }

  // ---------------- pre-flight ----------------
  // The cheapest possible call that still exercises the whole path: key, model name,
  // transparency and the storage round-trip stay untouched, so nothing can be cached wrong.
  async function probe(onTick) {
    const d = await job({ op: 'probe', full: true }, onTick);
    const cost = d.cost_usd != null ? `$${Number(d.cost_usd).toFixed(4)}` : 'cost unknown';
    return `${d.error || 'OK'} · ${cost} · ${Math.round((d.ms || 0) / 100) / 10}s`;
  }

  // ---------------- mannequin ----------------
  async function makeMannequin(finish, onTick) { return job({ op: 'mannequin', finish }, onTick); }
  async function makePose(finish, poseId, onTick) { return job({ op: 'mannequin', finish, pose: poseId }, onTick); }

  // ---------------- garments ----------------
  function photoPaths(item) { const p = []; if (item.cutout_path) p.push(item.cutout_path); if (item.photo_path) p.push(item.photo_path); return p; }
  async function renderGarment(item, basePath, opts = {}, onTick) {
    return job({ op: 'garment', ref: item.id, base_path: basePath, quality_override: opts.quality || null, force: !!opts.force,
      item: { id: item.id, name: item.name, slot: item.slot, category: item.category, colour_family: item.colour_family, fabric: item.fabric, tags: item.tags || [], photo_paths: photoPaths(item) } }, onTick);
  }
  // render a whole wardrobe, a couple at a time, reporting as it goes
  async function renderAll(items, basePath, opts, onProgress) {
    const queue = items.slice(); const done = [], failed = [];
    const lanes = Array.from({ length: opts.concurrency || 2 }, async () => {
      while (queue.length) {
        const it = queue.shift();
        onProgress && onProgress({ item: it, state: 'running', done: done.length, failed: failed.length, left: queue.length });
        try { const path = await renderGarment(it, basePath, opts); it.worn_path = path; done.push(it); }
        catch (e) { failed.push({ item: it, error: e.message || String(e) }); }
        onProgress && onProgress({ item: it, state: 'done', done: done.length, failed: failed.length, left: queue.length });
      }
    });
    await Promise.all(lanes);
    return { done, failed };
  }

  // ---------------- instant composite ----------------
  const imgCache = new Map();
  async function load(path) {
    if (!path) return null;
    if (imgCache.has(path)) return imgCache.get(path);
    const p = (async () => { const url = await ctx.signedUrl(path); if (!url) return null; const im = new Image(); im.crossOrigin = 'anonymous'; await new Promise((res, rej) => { im.onload = res; im.onerror = rej; im.src = url; }); return im; })();
    imgCache.set(path, p); return p;
  }
  // layers(): what the free canvas preview can stack — needs a worn render for each piece.
  function layers(items) { return items.filter(i => i.worn_path).slice().sort((a, b) => (ORDER[a.slot] || 9) - (ORDER[b.slot] || 9)); }
  // dressable(): what a real photograph can include — works from the original cut-out, so a
  // piece does NOT need its own worn render first. Keying the outfit off layers() meant an
  // un-rendered garment was silently dropped from the photograph AND from its cache key.
  // Basics count: a white tee under a jumper is part of the outfit even though it was never
  // photographed. Pieces without a photo are described to the model in words instead.
  function dressable(items) {
    return items.filter(i => i.is_basic || i.cutout_path || i.photo_path)
                .slice().sort((a, b) => (ORDER[a.slot] || 9) - (ORDER[b.slot] || 9));
  }
  function cacheKey(items) { return dressable(items).map(i => i.id.slice(0, 8)).sort().join('-'); }
  // Photographs taken before basics counted were keyed without them; still honour those keys.
  function legacyKey(items) { return dressable(items).filter(i => !i.is_basic).map(i => i.id.slice(0, 8)).sort().join('-'); }
  function keysFor(items) { const k = cacheKey(items), l = legacyKey(items); return k === l ? [k] : [k, l]; }
  function ready(items, base) { return !!base && layers(items).length >= 2; }

  // Each worn render was cut out of a scene with a pale mannequin in it, so its edge carries a
  // fringe of paper-white plus a soft halo. Stacked, those fringes are most of what makes the
  // preview look pasted on. Erode the alpha edge by a couple of pixels and drop near-white,
  // low-saturation pixels that sit on it. Done once per layer and cached.
  const cleanCache = new Map();
  function cleanLayer(im) {
    if (cleanCache.has(im)) return cleanCache.get(im);
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    g.drawImage(im, 0, 0, W, H);
    const id = g.getImageData(0, 0, W, H), d = id.data, N = W * H;
    const a0 = new Uint8Array(N); for (let i = 0; i < N; i++) a0[i] = d[i * 4 + 3];
    let cur = a0;
    for (let pass = 0; pass < 2; pass++) {
      const next = new Uint8Array(cur);
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x; if (!cur[i]) continue;
        if (cur[i - 1] < 40 || cur[i + 1] < 40 || cur[i - W] < 40 || cur[i + W] < 40) next[i] = 0;
      }
      cur = next;
    }
    for (let i = 0; i < N; i++) {
      if (!cur[i]) { d[i * 4 + 3] = 0; continue; }
      // near the edge (eroded within 4px) and pale + grey → mannequin fringe, not garment
      const x = i % W, y = (i / W) | 0;
      let edge = false;
      for (let k = 1; k <= 4 && !edge; k++) edge = !cur[i - k] || !cur[i + k] || (y >= k && !cur[i - k * W]) || (y + k < H && !cur[i + k * W]);
      if (edge) { const r = d[i * 4], gg = d[i * 4 + 1], b = d[i * 4 + 2]; const mx = Math.max(r, gg, b), mn = Math.min(r, gg, b); if (mx > 205 && mx - mn < 28) d[i * 4 + 3] = 0; }
    }
    g.putImageData(id, 0, 0);
    cleanCache.set(im, c); return c;
  }
  async function composite(items, basePath, opts = {}) {
    const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
    const base = await load(basePath);
    if (base) g.drawImage(base, 0, 0, W, H);
    for (const it of layers(items)) { const im = await load(it.worn_path); if (im) g.drawImage(opts.raw ? im : cleanLayer(im), 0, 0, W, H); }
    return c;
  }

  // ---------------- the finished photograph ----------------
  async function polish(items, basePath, opts = {}, onTick) {
    const key = cacheKey(items);
    const { data: hits } = await ctx.sb.from('renders').select('path').eq('wardrobe_id', ctx.wardrobeId).in('key', keysFor(items)).eq('pose', 'front').limit(1);
    const hit = hits && hits[0];
    if (hit && hit.path && !opts.force) return hit.path;
    const c = await composite(items, basePath);
    // A 1024x1536 PNG base64s to several megabytes, and a function request body is capped
    // at ~6MB — which is what returned 413. Put it in storage and pass the path instead;
    // the function already reads from there, and there is no size limit on this route.
    const blob = await new Promise(res => c.toBlob(res, 'image/png'));
    const path = `${ctx.wardrobeId}/tmp/composite-${key}.png`;
    const { error: upErr } = await ctx.sb.storage.from('wardrobe').upload(path, blob, { upsert: true, contentType: 'image/png' });
    if (upErr) throw new Error(`Could not stage the composite: ${upErr.message}`);
    try { return await job({ op: 'polish', ref: key, cache_key: key, composite_path: path, quality_override: opts.quality || null, force: !!opts.force, names: items.map(i => i.name) }, onTick); }
    finally { ctx.sb.storage.from('wardrobe').remove([path]).catch(() => {}); }   // the staged composite is scratch
  }
  // ---------------- the real photograph ----------------
  // Dressing the figure in every piece at once, rather than polishing a stack of flats.
  // Same cost as polish, but the garments can actually relate to each other.
  function pieces(items) {
    return dressable(items).map(i => ({ id: i.id, name: i.name, slot: i.slot, category: i.category,
      colour_family: i.colour_family, fabric: i.fabric, photo_paths: photoPaths(i) }));
  }
  async function dress(items, basePath, opts = {}, onTick) {
    const key = cacheKey(items);
    return job({ op: 'outfit', ref: key, cache_key: key, base_path: basePath,
      pieces: pieces(items), force: !!opts.force }, onTick);
  }

  // ---------------- lookbook ----------------
  // Every frame is generated from the SAME approved front photograph, never from the previous
  // frame — otherwise small drifts compound around the set and the jumper changes colour by
  // the time the figure has its back to you.
  async function frames(items) {
    const { data } = await ctx.sb.from('renders').select('pose, path').eq('wardrobe_id', ctx.wardrobeId).in('key', keysFor(items));
    const map = {};
    (data || []).forEach(r => { map[r.pose || 'front'] = r.path; });
    return map;
  }

  async function lookbook(items, basePath, opts = {}, onProgress) {
    const key = cacheKey(items);
    const have = await frames(items);
    const report = (poseId, state, extra) => onProgress && onProgress(Object.assign({ pose: poseId, state, have: Object.keys(have).length }, extra));

    // the front frame is the anchor for everything else, so it has to be a real finished photo
    let anchor = have.front;
    if (!anchor) {
      report('front', 'running');
      try { anchor = await dress(items, basePath, opts, st => report('front', st)); }
      catch (e) {
        // if the figure can't be dressed in one pass, fall back to reconciling the stack
        report('front', 'running', { note: 'dressing failed, polishing the composite instead' });
        anchor = await polish(items, basePath, opts, st => report('front', st));
      }
      have.front = anchor;
      report('front', 'done');
    }

    const names = items.map(i => i.name);
    const todo = POSES.filter(p => p.id !== 'front' && !have[p.id]);
    for (const p of todo) {
      report(p.id, 'running');
      try {
        have[p.id] = await job({ op: 'lookbook', ref: `${key}-${p.id}`, cache_key: key, anchor_path: anchor,
          pose_id: p.id, pose_base_path: (opts.poseBases || {})[p.id] || null, names, force: !!opts.force }, st => report(p.id, st));
        report(p.id, 'done');
      } catch (e) { report(p.id, 'error', { error: e.message || String(e) }); }
    }
    return have;
  }

  async function cachedPolish(items) {
    const { data } = await ctx.sb.from('renders').select('path').eq('wardrobe_id', ctx.wardrobeId).in('key', keysFor(items)).eq('pose', 'front').limit(1);
    return data && data[0] ? data[0].path : null;
  }

  return { init, probe, lastJob, makeMannequin, makePose, dress, lookbook, frames, POSES, dressable, renderGarment, renderAll, composite, polish, cachedPolish, cacheKey, keysFor, layers, ready, load, W, H };
})();
