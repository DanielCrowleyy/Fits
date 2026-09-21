// Unpacks tools/bin/*.b64 (and *.gz.b64, optionally split into .partN files)
// into the site root. Filenames use "__" for "/" (icons__icon-64.png -> icons/icon-64.png).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const dir = path.join(__dirname, 'bin');
const groups = {};
for (const f of fs.readdirSync(dir)) {
  if (!/\.b64(\.part\d+)?$/.test(f)) continue;
  const base = f.replace(/\.part\d+$/, '');
  (groups[base] ||= []).push(f);
}
for (const base of Object.keys(groups)) {
  const parts = groups[base].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const text = parts.map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('');
  let name = base.slice(0, -4);
  let buf = Buffer.from(text.replace(/\s+/g, ''), 'base64');
  if (name.endsWith('.gz')) { name = name.slice(0, -3); buf = zlib.gunzipSync(buf); }
  const out = path.join(__dirname, '..', name.replace(/__/g, '/'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log('unpacked', path.relative(path.join(__dirname, '..'), out), buf.length);
}
