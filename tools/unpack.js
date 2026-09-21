// Binary assets live in the repo as base64 text (the deploy path can only carry text);
// this writes them back to their real paths before wrangler uploads the site.
const fs = require('fs'), path = require('path');
const dir = path.join(__dirname, 'bin');
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.b64')) continue;
  const out = path.join(__dirname, '..', f.slice(0, -4).replace(/__/g, '/'));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(fs.readFileSync(path.join(dir, f), 'utf8'), 'base64'));
  console.log('unpacked', path.relative(path.join(__dirname, '..'), out));
}
