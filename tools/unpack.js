// Unpacks tools/bin/*.b64 (and *.gz.b64) into the site root.
// Filenames use "__" for "/" (icons__icon-64.png -> icons/icon-64.png).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const dir = path.join(__dirname, 'bin');
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.b64')) continue;
  let name = f.slice(0, -4);
  let buf = Buffer.from(fs.readFileSync(path.join(dir, f), 'utf8'), 'base64');
  if (name.endsWith('.gz')) { name = name.slice(0, -3); buf = zlib.gunzipSync(buf); }
  const out = path.join(__dirname, '..', name.replace(/__/g, '/'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, buf);
  console.log('unpacked', path.relative(path.join(__dirname, '..'), out), buf.length);
}
