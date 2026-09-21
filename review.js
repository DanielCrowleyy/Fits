/* Fit — The Fit Review. Analytics as a monthly issue rather than a dashboard: a cover, then
   spreads. Everything here is candid about thin data: a spread that has nothing to say says so
   in one line instead of drawing an empty chart. Pure rendering; the app hands in the data. */
window.FitReview = (function () {
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const NEUTRALS = new Set(['white', 'cream', 'black', 'grey', 'charcoal', 'navy', 'denim', 'stone', 'khaki', 'tan', 'brown']);

  // ---------- data shaping ----------
  // wear: [{item_id, worn_on, outfit_id}], outfits: [{id, name, pinned, items:[item]}],
  // signals: [{kind, reason, created_at}], jobs: [{cost_usd, created_at, kind}]
  function shape(d) {
    const { items, wear, outfits, signals, jobs, aesthetics, swatch, monthStart } = d;
    const byId = new Map(items.map(i => [i.id, i]));
    const wears = new Map();                       // item id → wears this period
    const days = new Set();
    for (const w of wear) { days.add(w.worn_on); wears.set(w.item_id, (wears.get(w.item_id) || 0) + 1); }
    // co-wear edges from logged days (grouped by outfit_id, else by date) and from saved looks
    const groups = new Map();
    for (const w of wear) { const k = w.outfit_id || w.worn_on; (groups.get(k) || groups.set(k, new Set()).get(k)).add(w.item_id); }
    for (const o of outfits) if (o.pinned) groups.set('pin:' + o.id, new Set(o.items.map(i => i.id)));
    const edges = new Map();
    for (const g of groups.values()) {
      const ids = [...g].filter(id => byId.has(id)).sort();
      for (let a = 0; a < ids.length; a++) for (let b = a + 1; b < ids.length; b++) { const k = ids[a] + '|' + ids[b]; edges.set(k, (edges.get(k) || 0) + 1); }
    }
    const worn = items.filter(i => wears.has(i.id));
    const outfitCounts = new Map();
    for (const w of wear) if (w.outfit_id) outfitCounts.set(w.outfit_id, (outfitCounts.get(w.outfit_id) || 0) + 1);
    const topOutfitId = [...outfitCounts.entries()].sort((a, b) => b[1] - a[1])[0];
    const topOutfit = topOutfitId ? outfits.find(o => o.id === topOutfitId[0]) : null;

    // palettes
    const fam = arr => { const m = new Map(); for (const [f, n] of arr) m.set(f, (m.get(f) || 0) + n); return m; };
    const palAes = fam(aesthetics.flatMap(a => (a.palette || []).map(f => [f, 1])));
    const palOwn = fam(items.filter(i => !i.is_basic && i.colour_family).map(i => [i.colour_family, 1]));
    const palWorn = fam(worn.filter(i => i.colour_family).map(i => [i.colour_family, wears.get(i.id)]));

    // cost per wear (lifetime wears would be better; this period is what we have)
    const priced = items.filter(i => i.price != null);
    const cpw = priced.map(i => ({ item: i, wears: wears.get(i.id) || 0, cpw: Number(i.price) / Math.max(1, wears.get(i.id) || 0) })).sort((a, b) => b.cpw - a.cpw);

    // bench: active, not basic, not worn this period
    const bench = items.filter(i => i.status === 'active' && !i.is_basic && !wears.has(i.id));

    // skips
    const skips = signals.filter(s => s.kind === 'skipped');
    const shown = signals.filter(s => s.kind === 'shown').length;
    const reasons = new Map();
    for (const s of skips) if (s.reason) reasons.set(s.reason, (reasons.get(s.reason) || 0) + 1);

    const spend = jobs.reduce((a, j) => a + Number(j.cost_usd || 0), 0);
    const spendMonth = jobs.filter(j => j.created_at >= monthStart).reduce((a, j) => a + Number(j.cost_usd || 0), 0);

    return { byId, wears, days: days.size, edges, worn, topOutfit, palAes, palOwn, palWorn, cpw, priced, bench, skips, shown, reasons, spend, spendMonth, swatch, outfits: outfits.length, distinct: groups.size };
  }

  // ---------- drawing ----------
  function ring(map, swatch, size = 140, label) {
    const total = [...map.values()].reduce((a, b) => a + b, 0);
    if (!total) return `<div class="ring empty"><div class="lbl">${esc(label)}</div><div class="small">nothing yet</div></div>`;
    const r = size / 2, ri = r * 0.62, c = r;
    let a0 = -Math.PI / 2, paths = '';
    for (const [f, n] of [...map.entries()].sort((x, y) => y[1] - x[1])) {
      const a1 = a0 + (n / total) * Math.PI * 2;
      const big = a1 - a0 > Math.PI ? 1 : 0;
      const p = (rad, a) => `${c + rad * Math.cos(a)} ${c + rad * Math.sin(a)}`;
      paths += `<path d="M ${p(r, a0)} A ${r} ${r} 0 ${big} 1 ${p(r, a1)} L ${p(ri, a1)} A ${ri} ${ri} 0 ${big} 0 ${p(ri, a0)} Z" fill="${swatch[f] || '#999'}" stroke="var(--bg, #fff)" stroke-width="1.5"><title>${esc(f)} ${Math.round(100 * n / total)}%</title></path>`;
      a0 = a1;
    }
    const top = [...map.entries()].sort((x, y) => y[1] - x[1]).slice(0, 3).map(([f, n]) => `${f} ${Math.round(100 * n / total)}%`).join(' · ');
    return `<div class="ring"><svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${esc(label)}">${paths}</svg><div class="lbl">${esc(label)}</div><div class="small">${esc(top)}</div></div>`;
  }

  // Force layout on a canvas. n ≤ 60, so O(n²) per step is nothing.
  function graph(canvas, d) {
    const nodes = [...d.byId.values()].filter(i => !i.is_basic && i.status !== 'retired');
    const idx = new Map(nodes.map((n, i) => [n.id, i]));
    const links = [...d.edges.entries()].map(([k, w]) => { const [a, b] = k.split('|'); return { a: idx.get(a), b: idx.get(b), w }; }).filter(l => l.a != null && l.b != null);
    const deg = new Array(nodes.length).fill(0); for (const l of links) { deg[l.a] += l.w; deg[l.b] += l.w; }
    const W = canvas.width, H = canvas.height, cx = W / 2, cy = H / 2;
    const P = nodes.map((n, i) => { const t = i / nodes.length * Math.PI * 2, rr = Math.min(W, H) * (deg[i] ? 0.22 : 0.42); return { x: cx + rr * Math.cos(t), y: cy + rr * Math.sin(t), vx: 0, vy: 0 }; });
    for (let step = 0; step < 260; step++) {
      const k = 1 - step / 260;
      for (let i = 0; i < P.length; i++) for (let j = i + 1; j < P.length; j++) {
        let dx = P[j].x - P[i].x, dy = P[j].y - P[i].y, d2 = dx * dx + dy * dy + 0.01, f = 1800 / d2;
        dx *= f; dy *= f; P[i].vx -= dx; P[i].vy -= dy; P[j].vx += dx; P[j].vy += dy;
      }
      for (const l of links) {
        const dx = P[l.b].x - P[l.a].x, dy = P[l.b].y - P[l.a].y, dist = Math.sqrt(dx * dx + dy * dy) || 1, f = (dist - 70) * 0.02 * Math.min(3, l.w);
        P[l.a].vx += dx / dist * f; P[l.a].vy += dy / dist * f; P[l.b].vx -= dx / dist * f; P[l.b].vy -= dy / dist * f;
      }
      for (const p of P) { p.vx += (cx - p.x) * 0.004; p.vy += (cy - p.y) * 0.004; p.x += p.vx * k * 0.6; p.y += p.vy * k * 0.6; p.vx *= 0.6; p.vy *= 0.6; }
    }
    const g = canvas.getContext('2d');
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    g.clearRect(0, 0, W, H);
    g.lineCap = 'round';
    for (const l of links) { g.strokeStyle = dark ? 'rgba(255,255,255,.18)' : 'rgba(0,0,0,.14)'; g.lineWidth = Math.min(6, 1 + l.w); g.beginPath(); g.moveTo(P[l.a].x, P[l.a].y); g.lineTo(P[l.b].x, P[l.b].y); g.stroke(); }
    nodes.forEach((n, i) => {
      const r = 5 + Math.min(14, Math.sqrt(d.wears.get(n.id) || 0) * 4);
      g.beginPath(); g.arc(P[i].x, P[i].y, r, 0, Math.PI * 2);
      g.fillStyle = d.swatch[n.colour_family] || n.colour_hex || '#999'; g.fill();
      g.strokeStyle = deg[i] ? (dark ? '#fff' : '#111') : (dark ? 'rgba(255,255,255,.35)' : 'rgba(0,0,0,.3)'); g.lineWidth = deg[i] ? 1.5 : 1; g.stroke();
    });
    return { nodes, P, deg };
  }

  // ---------- the issue ----------
  function html(d, meta) {
    const { month, issueNo, coverUrl, coverName, currency } = meta;
    const n = x => x.toLocaleString();
    const money = x => `${currency}${x.toFixed(2)}`;
    const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
    const thin = d.days < 7;
    const util = pct(d.worn.length, [...d.byId.values()].filter(i => !i.is_basic && i.status === 'active').length);

    const cover = `<section class="spread cover">
      <div class="masthead"><div class="eyebrow">The Fit Review</div><h1>${esc(month)}</h1><div class="small">Issue ${issueNo}</div></div>
      ${coverUrl ? `<img src="${coverUrl}" alt="${esc(coverName || '')}">` : '<div class="nocover small">No photograph yet — the cover is your most-worn look once one exists.</div>'}
      ${coverName ? `<div class="caption">${esc(coverName)}</div>` : ''}
    </section>`;

    const numbers = `<section class="spread"><h2>By the numbers</h2>
      <div class="stats">
        <div><b>${n(d.days)}</b><span>days logged</span></div>
        <div><b>${n(d.worn.length)}</b><span>pieces worn</span></div>
        <div><b>${n(d.distinct)}</b><span>distinct outfits</span></div>
        <div><b>${util}%</b><span>of the wardrobe used</span></div>
        <div><b>${money(d.spendMonth)}</b><span>on photographs this month</span></div>
      </div>
      ${thin ? `<p class="small">${d.days ? `Only ${d.days} day${d.days === 1 ? '' : 's'} logged so far` : 'Nothing logged yet'} — tap “Wearing this” each morning and this issue fills itself in. Most of what follows needs about a month.</p>` : ''}
    </section>`;

    const hubs = [...d.byId.values()].map(i => [i, [...d.edges.entries()].filter(([k]) => k.includes(i.id)).reduce((a, [, w]) => a + w, 0)]).filter(x => x[1]).sort((a, b) => b[1] - a[1]).slice(0, 3);
    const orphans = [...d.byId.values()].filter(i => !i.is_basic && i.status === 'active' && ![...d.edges.keys()].some(k => k.includes(i.id)));
    const graphSpread = `<section class="spread"><h2>The wardrobe as a graph</h2>
      <p class="small">Every piece is a point; every time two were worn together, a line. The hubs are what your wardrobe is really built on. Points with no lines have never been worn with anything.</p>
      <canvas id="rv-graph" width="720" height="480" aria-label="Co-wear graph"></canvas>
      ${d.edges.size ? `<div class="two"><div><div class="eyebrow">Workhorses</div>${hubs.map(([i, w]) => `<div class="li"><span>${esc(i.name)}</span><b>${w}</b></div>`).join('')}</div>
        <div><div class="eyebrow">Never paired</div>${orphans.length ? orphans.slice(0, 6).map(i => `<div class="li"><span>${esc(i.name)}</span></div>`).join('') + (orphans.length > 6 ? `<div class="small">and ${orphans.length - 6} more</div>` : '') : '<div class="small">none</div>'}</div></div>` : '<p class="small">No lines yet: nothing has been logged or saved. Save a look or log a day and the graph starts to form.</p>'}
    </section>`;

    const gap = (() => {
      const tot = m => [...m.values()].reduce((a, b) => a + b, 0);
      if (!tot(d.palWorn) || !tot(d.palOwn)) return '';
      const rows = [...d.palOwn.entries()].map(([f, n]) => [f, n / tot(d.palOwn), (d.palWorn.get(f) || 0) / tot(d.palWorn)]);
      const under = rows.filter(r => r[1] >= 0.08 && r[2] < r[1] / 2).sort((a, b) => (b[1] - b[2]) - (a[1] - a[2]))[0];
      const over = rows.sort((a, b) => (b[2] - b[1]) - (a[2] - a[1]))[0];
      let s = '';
      if (over && over[2] > over[1] * 1.4) s += `You wore ${over[0]} ${Math.round(over[2] * 100)}% of the time; it is ${Math.round(over[1] * 100)}% of what you own. `;
      if (under) s += `${under[0][0].toUpperCase() + under[0].slice(1)} is ${Math.round(under[1] * 100)}% of the wardrobe and ${Math.round(under[2] * 100)}% of what you wore.`;
      return s;
    })();
    const palette = `<section class="spread"><h2>Your true palette</h2>
      <p class="small">What you say you like, what you bought, and what you actually wore.</p>
      <div class="rings">${ring(d.palAes, d.swatch, 140, 'Aesthetics')}${ring(d.palOwn, d.swatch, 140, 'Wardrobe')}${ring(d.palWorn, d.swatch, 140, 'Worn')}</div>
      ${gap ? `<p class="pull">${esc(gap)}</p>` : ''}
    </section>`;

    const unpriced = [...d.byId.values()].filter(i => i.price == null && !i.is_basic && i.status === 'active').length;
    const cost = `<section class="spread"><h2>Cost per wear</h2>
      ${d.priced.length ? `<div class="table">${d.cpw.slice(0, 6).map(r => `<div class="li"><span>${esc(r.item.name)}<em>${money(Number(r.item.price))} · worn ${r.wears}×</em></span><b>${money(r.cpw)}</b></div>`).join('')}</div>
        ${d.cpw[0] && d.cpw[0].wears === 0 ? `<p class="pull">The most expensive thing you own per wear is the ${esc(d.cpw[0].item.name.toLowerCase())}: ${money(Number(d.cpw[0].item.price))}, not worn this period.</p>` : ''}` : ''}
      ${unpriced ? `<p class="small">${d.priced.length ? `${unpriced} pieces have no price yet` : 'Add prices to your pieces (Wardrobe → open a piece → Price)'} and this spread works out what each one really costs you per wear.</p>` : ''}
      <div class="eyebrow" style="margin-top:18px">The bench</div>
      <p class="small">${d.bench.length ? `${d.bench.length} pieces went unworn${d.days ? ' this period' : ''}.` : 'Everything got worn.'} ${d.bench.length ? 'A few that deserve a day:' : ''}</p>
      ${d.bench.length ? `<div class="chips">${d.bench.slice(0, 8).map(i => `<span class="chip">${esc(i.name)}</span>`).join('')}</div>` : ''}
    </section>`;

    const totalR = [...d.reasons.values()].reduce((a, b) => a + b, 0);
    const LABEL = { colour: 'Colour', 'too-smart': 'Too smart', 'too-casual': 'Too casual', 'seen-it': 'Seen it', no: 'Just no' };
    const skipsSpread = `<section class="spread"><h2>Why you said no</h2>
      ${d.skips.length ? `<p class="small">${d.skips.length} rerolls${d.shown ? ` out of ${d.shown} proposals (${pct(d.skips.length, d.shown)}%)` : ''}${totalR ? `, ${totalR} with a reason.` : '. None had a reason yet — the chips after a reroll are where the engine learns fastest.'}</p>
        ${totalR ? `<div class="bars">${[...d.reasons.entries()].sort((a, b) => b[1] - a[1]).map(([r, n]) => `<div class="bar"><span>${esc(LABEL[r] || r)}</span><div class="track"><div class="fill" style="width:${pct(n, totalR)}%"></div></div><b>${pct(n, totalR)}%</b></div>`).join('')}</div>` : ''}
        ${totalR && [...d.reasons.entries()].sort((a, b) => b[1] - a[1])[0][1] / totalR >= 0.5 ? `<p class="pull">${esc(LABEL[[...d.reasons.entries()].sort((a, b) => b[1] - a[1])[0][0]])} is more than half of your skips. That is a rule waiting to be written.</p>` : ''}`
        : '<p class="small">No rerolls recorded yet.</p>'}
    </section>`;

    const drift = `<section class="spread"><h2>Taste drift</h2><p class="small">${d.days >= 30 ? 'Learned weights arrive here once the first month’s signals have been fitted.' : `Needs about a month of logged days (${d.days} so far). This is where the engine shows what it has learned about you — and where you correct it.`}</p></section>`;

    const colophon = `<section class="spread colophon"><div class="small">The Fit Review is compiled from your wear log, saved looks, rerolls and photographs. Lifetime photograph spend ${money(d.spend)}. Nothing here leaves your wardrobe.</div></section>`;

    return cover + numbers + graphSpread + palette + cost + skipsSpread + drift + colophon;
  }

  function mount(container, d) {
    const c = container.querySelector('#rv-graph');
    if (c) { const r = graph(c, d); c.title = `${r.nodes.length} pieces`; }
  }

  return { shape, html, mount, MONTHS };
})();
