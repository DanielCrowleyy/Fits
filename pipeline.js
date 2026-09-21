/* Fit — in-browser garment pipeline: background removal, crease softening, straighten, crop, colour. */
window.FitPipeline = (function () {
  const MAX_SIDE = 1600, OUT_SIDE = 1200, THUMB = 320;
  const CDN = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/+esm';
  const DATA = 'https://cdn.jsdelivr.net/npm/@imgly/background-removal-data@1.5.5/dist/';
  let lib = null;

  async function load(onProgress) {
    if (lib) return lib;
    onProgress && onProgress('Loading cut-out model…');
    lib = await import(CDN);
    return lib;
  }

  async function fileToCanvas(file) {
    const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const s = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height); bmp.close && bmp.close();
    return c;
  }

  async function removeBg(canvas, onProgress) {
    const l = await load(onProgress);
    const blob = await new Promise(r => canvas.toBlob(r, 'image/jpeg', 0.92));
    const opts = { publicPath: DATA, model: 'isnet', output: { format: 'image/png', quality: 1 },
      progress: (k, cur, tot) => { if (onProgress && /fetch/.test(k)) onProgress(`Fetching model ${Math.round(cur / Math.max(1, tot) * 100)}%`); } };
    let out;
    try { out = await l.removeBackground(blob, opts); }
    catch (e) { delete opts.publicPath; out = await l.removeBackground(blob, opts); }   // fall back to the library default host
    const bmp = await createImageBitmap(out);
    const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0); return c;
  }

  // --- image maths on ImageData ---------------------------------------------------
  function boxBlur(src, w, h, r) {
    // separable box blur on a Float32Array, returns new array
    const tmp = new Float32Array(w * h), out = new Float32Array(w * h); const n = 2 * r + 1;
    for (let y = 0; y < h; y++) { let acc = 0; const row = y * w;
      for (let x = -r; x <= r; x++) acc += src[row + Math.min(w - 1, Math.max(0, x))];
      for (let x = 0; x < w; x++) { tmp[row + x] = acc / n; acc += src[row + Math.min(w - 1, x + r + 1)] - src[row + Math.max(0, x - r)]; } }
    for (let x = 0; x < w; x++) { let acc = 0;
      for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) { out[y * w + x] = acc / n; acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x]; } }
    return out;
  }

  function softenCreases(cut, strength) {
    const w = cut.width, h = cut.height, ctx = cut.getContext('2d');
    const img = ctx.getImageData(0, 0, w, h), d = img.data;
    const L = new Float32Array(w * h), A = new Float32Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) { L[p] = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]; A[p] = d[i + 3] / 255; }
    const rMid = Math.max(6, Math.round(Math.min(w, h) / 90)), rFine = 1;
    const low = boxBlur(boxBlur(L, w, h, rMid), w, h, rMid);   // two passes ≈ gaussian
    const fineBase = boxBlur(L, w, h, rFine);
    const cap = 14;                                            // creases are subtle; seams/buttons are not
    for (let p = 0, i = 0; p < L.length; p++, i += 4) {
      if (A[p] < 0.6) continue;
      const mid = (fineBase[p] - low[p]);                      // mid-frequency shading = creases
      const corr = Math.max(-cap, Math.min(cap, mid)) * strength * A[p];
      const k = (L[p] - corr) / Math.max(1, L[p]);             // scale RGB to keep chroma
      d[i] = Math.min(255, d[i] * k); d[i + 1] = Math.min(255, d[i + 1] * k); d[i + 2] = Math.min(255, d[i + 2] * k);
    }
    ctx.putImageData(img, 0, 0);
  }

  function neutraliseCast(original, cut) {
    // use the (removed) background near the frame edge as a grey reference; apply gain to the cut-out
    const w = original.width, h = original.height;
    const o = original.getContext('2d').getImageData(0, 0, w, h).data;
    const a = cut.getContext('2d').getImageData(0, 0, w, h).data;
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < o.length; i += 16) { if (a[i + 3] < 8) { r += o[i]; g += o[i + 1]; b += o[i + 2]; n++; } }
    if (n < 500) return;
    r /= n; g /= n; b /= n; const m = (r + g + b) / 3;
    const gr = m / Math.max(1, r), gg = m / Math.max(1, g), gb = m / Math.max(1, b);
    if (Math.abs(gr - 1) < 0.02 && Math.abs(gb - 1) < 0.02) return;
    const ctx = cut.getContext('2d'), img = ctx.getImageData(0, 0, w, h), d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = Math.min(255, d[i] * gr); d[i + 1] = Math.min(255, d[i + 1] * gg); d[i + 2] = Math.min(255, d[i + 2] * gb); }
    ctx.putImageData(img, 0, 0);
  }

  function maskStats(cut) {
    const w = cut.width, h = cut.height, d = cut.getContext('2d').getImageData(0, 0, w, h).data;
    let n = 0, sx = 0, sy = 0, sxx = 0, syy = 0, sxy = 0, minx = w, miny = h, maxx = 0, maxy = 0;
    let r = 0, g = 0, b = 0;
    for (let y = 0; y < h; y += 2) for (let x = 0; x < w; x += 2) {
      const i = (y * w + x) * 4; if (d[i + 3] < 128) continue;
      n++; sx += x; sy += y; sxx += x * x; syy += y * y; sxy += x * y;
      if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y;
      r += d[i]; g += d[i + 1]; b += d[i + 2];
    }
    if (!n) return null;
    const mx = sx / n, my = sy / n, cxx = sxx / n - mx * mx, cyy = syy / n - my * my, cxy = sxy / n - mx * my;
    const angle = 0.5 * Math.atan2(2 * cxy, cxx - cyy) * 180 / Math.PI;   // principal axis
    return { n, bbox: [minx, miny, maxx, maxy], angle, mean: [r / n, g / n, b / n] };
  }

  // Slot-aware orientation. Every quarter turn is scored on the silhouette alone — how the width profile sits,
  // where the widest row falls, and (for trousers) where the two legs separate — so the result is the same
  // whichever way the photo happened to be taken.
  function silhouette(c) {
    const W = c.width, H = c.height, d = c.getContext('2d').getImageData(0, 0, W, H).data;
    const step = Math.max(1, Math.round(Math.min(W, H) / 400));
    let y0 = -1, y1 = -1, x0 = W, x1 = 0; const rows = [];
    for (let y = 0; y < H; y += step) {
      let l = -1, r = -1, runs = 0, prev = -99;
      for (let x = 0; x < W; x += step) {
        if (d[(y * W + x) * 4 + 3] > 128) { if (l < 0) l = x; r = x; if (x - prev > step * 3) runs++; prev = x; }
      }
      if (l < 0) { rows.push(null); continue; }
      if (y0 < 0) y0 = y; y1 = y; if (l < x0) x0 = l; if (r > x1) x1 = r;
      rows.push({ y, w: r - l + 1, runs });
    }
    if (y0 < 0) return null;
    const band = rows.filter(r => r && r.y >= y0 && r.y <= y1);
    return { rows: band, H: y1 - y0 + 1, W: x1 - x0 + 1, y0, y1 };
  }
  function uprightScore(c, slot) {
    const s = silhouette(c); if (!s || s.rows.length < 8) return -9;
    const ws = s.rows.map(r => r.w), n = ws.length;
    const mean = Math.max(1, ws.reduce((a, b) => a + b, 0) / n);
    const third = Math.max(1, Math.floor(n / 3));
    const avg = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
    const tall = slot === 'trousers';
    let sc = 1.2 * Math.tanh(((tall ? s.H / s.W : s.W / s.H) - 1) * 1.5);      // trousers stand tall, tops lie wide
    sc += 2.0 * (0.5 - ws.indexOf(Math.max(...ws)) / Math.max(1, n - 1));      // widest row (shoulders / waist) belongs near the top
    sc += 0.6 * Math.tanh((avg(ws.slice(0, third)) - avg(ws.slice(-third))) / (mean * 0.25));
    if (tall) {                                                                // two legs separate towards the hem
      const split = s.rows.map((r, i) => r.runs >= 2 ? i : -1).filter(i => i >= 0);
      if (split.length > n * 0.08) sc += 4.0 * (avg(split) / Math.max(1, n - 1) - 0.5);
    }
    return sc;
  }
  function turn(c, k) {
    if (!k) return c;
    const o = document.createElement('canvas'); const sw = k % 2 ? c.height : c.width, sh = k % 2 ? c.width : c.height;
    o.width = sw; o.height = sh; const g = o.getContext('2d');
    g.translate(sw / 2, sh / 2); g.rotate(-k * Math.PI / 2); g.drawImage(c, -c.width / 2, -c.height / 2); return o;
  }
  function orient(cut, slot) {
    if (!['top', 'shirt', 'knit', 'layer', 'outer', 'trousers'].includes(slot)) return cut;
    let best = 0, bestScore = -Infinity;
    for (let k = 0; k < 4; k++) { const v = uprightScore(turn(cut, k), slot); if (v > bestScore) { bestScore = v; best = k; } }
    return best ? turn(cut, best) : cut;
  }
  function straightenAndCrop(cut, st, slot) {
    let ang = st.angle;                       // small tilt only: make the principal axis vertical or horizontal, whichever is closer
    ang = ((ang % 90) + 90) % 90; if (ang > 45) ang -= 90;
    if (Math.abs(ang) > 8) ang = 0;
    const w = cut.width, h = cut.height;
    let c = document.createElement('canvas'); c.width = w; c.height = h; const ctx = c.getContext('2d');
    ctx.translate(w / 2, h / 2); ctx.rotate(-ang * Math.PI / 180); ctx.drawImage(cut, -w / 2, -h / 2);
    c = orient(c, slot);
    const st2 = maskStats(c) || st; const [x0, y0, x1, y1] = st2.bbox;
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
    const cx0 = Math.max(0, x0 - pad), cy0 = Math.max(0, y0 - pad), cw = Math.min(c.width, x1 + pad) - cx0, ch = Math.min(c.height, y1 + pad) - cy0;
    const s = Math.min(1, OUT_SIDE / Math.max(cw, ch));
    const out = document.createElement('canvas'); out.width = Math.round(cw * s); out.height = Math.round(ch * s);
    out.getContext('2d').drawImage(c, cx0, cy0, cw, ch, 0, 0, out.width, out.height);
    return out;
  }
  // re-examine a stored cut-out and stand it the right way up for its slot; returns null when it is already correct
  async function reorient(blob, slot) {
    const bmp = await createImageBitmap(blob);
    const src = document.createElement('canvas'); src.width = bmp.width; src.height = bmp.height;
    src.getContext('2d').drawImage(bmp, 0, 0); bmp.close && bmp.close();
    const out = orient(src, slot);
    if (out === src) return null;                     // already upright
    const st = maskStats(out); if (!st) return null;
    const [x0, y0, x1, y1] = st.bbox;
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
    const cx0 = Math.max(0, x0 - pad), cy0 = Math.max(0, y0 - pad), cw = Math.min(out.width, x1 + pad) - cx0, ch = Math.min(out.height, y1 + pad) - cy0;
    const sc = Math.min(1, OUT_SIDE / Math.max(cw, ch));
    const fin = document.createElement('canvas'); fin.width = Math.round(cw * sc); fin.height = Math.round(ch * sc);
    fin.getContext('2d').drawImage(out, cx0, cy0, cw, ch, 0, 0, fin.width, fin.height);
    const [cutoutBlob, thumbBlob] = await Promise.all([toBlob(fin, 'image/png'), toBlob(thumb(fin), 'image/webp', 0.85)]);
    return { cutoutBlob, thumbBlob, previewUrl: URL.createObjectURL(thumbBlob) };
  }

  // rotate an existing cut-out by quarter turns (k = 1 clockwise, -1 anticlockwise) and return new blobs
  async function rotateBlob(blob, k) {
    const bmp = await createImageBitmap(blob); const c = document.createElement('canvas');
    c.width = k % 2 ? bmp.height : bmp.width; c.height = k % 2 ? bmp.width : bmp.height;
    const g = c.getContext('2d'); g.translate(c.width / 2, c.height / 2); g.rotate(k * Math.PI / 2); g.drawImage(bmp, -bmp.width / 2, -bmp.height / 2);
    const [cutoutBlob, thumbBlob] = await Promise.all([toBlob(c, 'image/png'), toBlob(thumb(c), 'image/webp', 0.85)]);
    return { cutoutBlob, thumbBlob, previewUrl: URL.createObjectURL(thumbBlob) };
  }
  function thumb(canvas) {
    const s = Math.min(1, THUMB / Math.max(canvas.width, canvas.height));
    const t = document.createElement('canvas'); t.width = Math.round(canvas.width * s); t.height = Math.round(canvas.height * s);
    t.getContext('2d').drawImage(canvas, 0, 0, t.width, t.height); return t;
  }

  function colourFamily([r, g, b]) {
    const hex = '#' + [r, g, b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
    const mx = Math.max(r, g, b) / 255, mn = Math.min(r, g, b) / 255, l = (mx + mn) / 2, dlt = mx - mn;
    const s = dlt === 0 ? 0 : dlt / (1 - Math.abs(2 * l - 1));
    let hue = 0; if (dlt) { const R = r / 255, G = g / 255, B = b / 255;
      hue = mx === R ? ((G - B) / dlt) % 6 : mx === G ? (B - R) / dlt + 2 : (R - G) / dlt + 4; hue = (hue * 60 + 360) % 360; }
    let fam;
    if (l > 0.86 && s < 0.25) fam = 'white'; else if (l > 0.72 && s < 0.35 && hue > 20 && hue < 70) fam = 'cream';
    else if (l < 0.13) fam = 'black'; else if (s < 0.1) fam = l < 0.3 ? 'charcoal' : 'grey';
    else if (hue >= 190 && hue <= 260) fam = l < 0.3 ? 'navy' : l < 0.55 ? 'denim' : 'light-blue';
    else if (hue > 160 && hue < 190) fam = 'teal';
    else if (hue >= 60 && hue <= 160) fam = l < 0.28 ? 'forest-green' : s < 0.3 ? 'olive' : l > 0.55 ? 'sage' : 'green';
    else if (hue >= 20 && hue < 60) fam = l > 0.62 ? 'stone' : l > 0.45 ? 'tan' : 'brown';
    else if (hue < 20 || hue > 330) fam = l < 0.35 ? 'burgundy' : 'rust';
    else fam = 'grey';
    return { hex, family: fam };
  }

  async function toBlob(canvas, type, q) { return new Promise(r => canvas.toBlob(r, type, q)); }

  async function process(file, onProgress, opts = {}) {
    onProgress && onProgress('Reading photo');
    const original = await fileToCanvas(file);
    onProgress && onProgress('Cutting out');
    let cut = await removeBg(original, onProgress);
    if (cut.width !== original.width) { const c = document.createElement('canvas'); c.width = original.width; c.height = original.height; c.getContext('2d').drawImage(cut, 0, 0, c.width, c.height); cut = c; }
    onProgress && onProgress('Balancing colour');
    neutraliseCast(original, cut);
    onProgress && onProgress('Softening creases');
    softenCreases(cut, opts.strength ?? 0.6);
    const st = maskStats(cut); if (!st) throw new Error('Nothing found in the photo');
    onProgress && onProgress('Straightening');
    const out = straightenAndCrop(cut, st, opts.slot);
    const col = colourFamily(maskStats(out).mean);
    const [cutoutBlob, thumbBlob, origBlob] = await Promise.all([toBlob(out, 'image/png'), toBlob(thumb(out), 'image/webp', 0.85), toBlob(original, 'image/jpeg', 0.85)]);
    return { cutoutBlob, thumbBlob, origBlob, colour_hex: col.hex, colour_family: col.family, width: out.width, height: out.height, previewUrl: URL.createObjectURL(thumbBlob) };
  }

  return { process, load, colourFamily, cutout: removeBg, rotateBlob, reorient };
})();
