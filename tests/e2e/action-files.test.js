// PDFs on an Action (2026-11-12), end to end over the Auth and Firestore emulators:
//   - added from the Action's sheet, kept inside the Action's own record in parts;
//   - opened in Ledger's viewer (pdf.js from vendor/pdfjs), every page drawn;
//   - a big one (over one Firestore document) split into parts and read back whole;
//   - only PDFs, and only up to 5 MB;
//   - shown live on another device; deleted with its parts.
//
//   cd tests/e2e && npm install
//   npx firebase emulators:exec --only firestore,auth --project ledger-6aec3 \
//     --config ../../firebase.json "node action-files.test.js"
const { chromium } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const ROOT = path.resolve(__dirname, '../..');
const PID = 'ledger-6aec3';
const PORT = 8958;
const APP = `http://127.0.0.1:${PORT}/index.html`;
const SDK = path.dirname(require.resolve('firebase/package.json')) + '/';
const ok = [], bad = [];
const check = (c, m, why) => { (c ? ok : bad).push(m); console.log((c ? 'PASS ' : 'FAIL ') + m + (!c && why ? ' — ' + why : '')); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TODAY = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });

const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.mjs': 'text/javascript' };
const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel.endsWith('/')) rel += 'index.html';
  const f = path.join(ROOT, rel);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()){ res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
const FS = `http://127.0.0.1:8080/v1/projects/${PID}/databases/(default)/documents`;
const ADMIN = { authorization: 'Bearer owner', 'content-type': 'application/json' };
async function put(docPath, fields){
  const r = await fetch(`${FS}/${docPath}`, { method: 'PATCH', headers: ADMIN, body: JSON.stringify({ fields }) });
  if (!r.ok) throw new Error('seed failed ' + docPath + ' ' + r.status);
}
const S = v => ({ stringValue: v });
// a Firestore REST value, as plain JSON
function dec(v){
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(dec);
  if ('mapValue' in v){ const o = {}; Object.entries(v.mapValue.fields || {}).forEach(([k, x]) => { o[k] = dec(x); }); return o; }
  return undefined;
}
async function list(coll){
  const r = await fetch(`${FS}/${coll}`, { headers: ADMIN });
  const j = r.ok ? await r.json() : {};
  return (j.documents || []).map(d => Object.assign({ id: d.name.split('/').pop() }, dec({ mapValue: { fields: d.fields } })));
}
async function wait(fn){ for (let i = 0; i < 25; i++){ const v = await fn(); if (v) return v; await sleep(300); } return null; }


// a real PDF: `pages` pages of text, and `pad` bytes of an unused stream to make it big
function makePdf(pages, pad){
  const objs = [];
  const kids = [];
  objs[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objs[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>';
  let n = 4;
  for (let i = 0; i < pages; i++){
    const text = 'BT /F1 36 Tf 72 700 Td (Invoice page ' + (i + 1) + ') Tj ET';
    objs[n] = '<< /Length ' + text.length + ' >>\nstream\n' + text + '\nendstream';
    objs[n + 1] = '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ' + n + ' 0 R >>';
    kids.push((n + 1) + ' 0 R');
    n += 2;
  }
  objs[2] = '<< /Type /Pages /Kids [' + kids.join(' ') + '] /Count ' + pages + ' >>';
  if (pad){ const junk = 'x'.repeat(pad); objs[n] = '<< /Length ' + junk.length + ' >>\nstream\n' + junk + '\nendstream'; n++; }
  let out = '%PDF-1.4\n';
  const offs = [];
  for (let i = 1; i < n; i++){ offs[i] = Buffer.byteLength(out, 'latin1'); out += i + ' 0 obj\n' + objs[i] + '\nendobj\n'; }
  const xref = Buffer.byteLength(out, 'latin1');
  out += 'xref\n0 ' + n + '\n0000000000 65535 f \n';
  for (let i = 1; i < n; i++) out += String(offs[i]).padStart(10, '0') + ' 00000 n \n';
  out += 'trailer\n<< /Size ' + n + ' /Root 1 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
  return Buffer.from(out, 'latin1');
}

(async () => {
  await fetch(`http://127.0.0.1:8080/emulator/v1/projects/${PID}/databases/(default)/documents`, { method: 'DELETE' });
  await fetch(`http://127.0.0.1:9099/emulator/v1/projects/${PID}/accounts`, { method: 'DELETE' });
  await new Promise(r => server.listen(PORT, '127.0.0.1', r));
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'shaun@example.com', password: 'pw-123456', returnSecureToken: true }) });
  const owner = (await r.json()).localId;
  await put(`ledger_users/${owner}`, { role: S('owner'), displayName: S('Shaun'), createdAt: S(TODAY) });
  await put('ledger_meta/presets', { prioritiesSeeded: { booleanValue: true } });
  await put('ledger_commitments/a1', { title: S('Pay the accountant'), date: S(TODAY), originalDate: S(TODAY), status: S('planned'),
    category: S('work'), createdAt: S(TODAY + 'T08:00:00Z') });

  const b = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  async function device(name, width){
    const ctx = await b.newContext({ viewport: { width, height: 900 }, isMobile: width < 768, hasTouch: width < 768, timezoneId: 'Europe/London' });
    await ctx.route(/api\.github\.com/, x => x.abort());
    await ctx.route(/gstatic\.com\/firebasejs\/10\.12\.2\/(firebase-[a-z-]+\.js)/, x => {
      const f = x.request().url().match(/(firebase-[a-z-]+\.js)/)[1];
      x.fulfill({ status: 200, contentType: 'application/javascript', body: fs.readFileSync(SDK + f) });
    });
    await ctx.addInitScript(() => { localStorage.setItem('ledger_emulator', '1'); });
    const p = await ctx.newPage(); p.errs = []; p.name = name;
    p.on('pageerror', e => p.errs.push(String(e)));
    await p.goto(APP);
    await p.waitForSelector('#authEmail', { timeout: 20000 });
    await p.fill('#authEmail', 'shaun@example.com'); await p.fill('#authPassword', 'pw-123456'); await p.click('#authSignIn');
    await p.waitForFunction(() => document.getElementById('authGate').hidden, null, { timeout: 25000 });
    return p;
  }
  const until = async (p, fn, arg, t) => { try { await p.waitForFunction(fn, arg, { timeout: t || 12000 }); return true; } catch (e){ return false; } };
  const text = (p, sel) => p.evaluate(s => { const e = document.querySelector(s); return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; }, sel);
  const goals = async p => { await p.click('.tab-btn[data-view="me"]'); await p.click('[data-me-sub="focus"]'); };
  const tab = (p, v) => p.click(`.tab-btn[data-view="${v}"]`);
  const pick = (p, id, v) => p.evaluate(([id, v]) => { const s = document.getElementById(id); s.value = v; s.dispatchEvent(new Event('change', { bubbles: true })); }, [id, v]);

  const phone = await device('phone', 390), mac = await device('mac', 1440);
  check(true, 'Shaun signed in on his phone and his Mac');
  const openAction = async p => {
    await p.waitForFunction(() => [...document.querySelectorAll('#commitmentsList .commitment-item')].some(x => /accountant/.test(x.innerText)), null, { timeout: 15000 });
    await p.evaluate(() => [...document.querySelectorAll('#commitmentsList .commitment-item')].find(x => /accountant/.test(x.innerText)).click());
    await p.waitForSelector('#commitFiles .fl-add', { timeout: 10000 });
  };
  const choose = async (p, name, buffer, mimeType) => {
    const [fc] = await Promise.all([p.waitForEvent('filechooser'), p.click('#commitFiles .fl-add')]);
    await fc.setFiles({ name, mimeType: mimeType || 'application/pdf', buffer });
  };
  const files = async () => list('ledger_commitments/a1/files');
  const parts = async id => list('ledger_commitments/a1/files/' + id + '/parts');

  // ---- a small PDF ----
  await openAction(phone); await openAction(mac);
  check(/Files/i.test(await text(phone, '#commitFiles')) && /Add a PDF/.test(await text(phone, '#commitFiles')), 'Phone: the Action has Files, with Add a PDF');
  const small = makePdf(2, 0);
  await choose(phone, 'Invoice 42.pdf', small);
  const f1 = await wait(async () => (await files()).find(x => x.name === 'Invoice 42.pdf'));
  check(f1 && f1.size === small.length && f1.mediaType === 'application/pdf' && f1.parts === 1 && f1.byUid === owner,
    'Saved inside the Action: name, size, one part, who added it', JSON.stringify(f1));
  const p1 = f1 && await parts(f1.id);
  check(p1 && p1.length === 1 && Buffer.from(p1[0].data, 'base64').equals(small), 'Saved: the bytes, exactly');
  check(await until(phone, () => /Invoice 42\.pdf/.test(document.getElementById('commitFiles').innerText) && /PDF · \d+ KB/.test(document.getElementById('commitFiles').innerText)),
    'Phone: listed by name and size');
  check(await until(mac, () => /Invoice 42\.pdf/.test((document.getElementById('commitFiles') || {}).innerText || '')), 'Mac: there too, live');

  // ---- opened: every page drawn ----
  const shot = async (p, n) => { if (process.env.SHOTS) await p.screenshot({ path: process.env.SHOTS + '/' + n + '.png' }); };
  await phone.evaluate(() => document.getElementById('commitFiles').scrollIntoView()); await shot(phone, 'files-sheet');
  await phone.click('#commitFiles .fl-row');
  check(await until(phone, () => document.querySelectorAll('#photoView .fv-page').length === 2, null, 20000), 'Phone: the viewer draws both pages (pdf.js, from Ledger itself)');
  check(await phone.evaluate(() => {
    const c = document.querySelector('#photoView .fv-page'), x = c.getContext('2d'), d = x.getImageData(0, 0, c.width, Math.floor(c.height / 4)).data;
    for (let i = 0; i < d.length; i += 4) if (d[i] < 100) return true;     // some dark text pixels
    return false;
  }), 'Phone: the page has its text on it');
  await shot(phone, 'files-viewer');
  check(await phone.evaluate(() => /Invoice 42\.pdf/.test(document.querySelector('#photoView .fv-name').textContent) && !document.querySelector('#photoView .fv-save').hidden),
    'Phone (browser): named at the top, with Download');
  await phone.click('#photoView .pv-close');

  // ---- a big one: in parts, read back whole ----
  const big = makePdf(3, 1600000);
  await choose(phone, 'Contract.pdf', big);
  const f2 = await wait(async () => (await files()).find(x => x.name === 'Contract.pdf'));
  const p2 = f2 && await parts(f2.id);
  const want = Math.ceil(big.toString('base64').length / 700000);
  check(f2 && want === 4 && f2.parts === want && p2.length === want, 'A 1.6 MB PDF is kept in four parts (each under Firestore\'s 1 MiB)', JSON.stringify(f2));
  check(p2 && Buffer.from(p2.sort((a, b) => a.i - b.i).map(x => x.data).join(''), 'base64').equals(big), 'Saved: the parts join back to the file exactly');
  await mac.evaluate(() => [...document.querySelectorAll('#commitFiles .fl-row')].find(x => /Contract/.test(x.innerText)).click());
  check(await until(mac, () => document.querySelectorAll('#photoView .fv-page').length === 3, null, 20000), 'Mac: opens it, all three pages');
  await mac.click('#photoView .pv-close');

  // ---- only PDFs, up to 5 MB ----
  await choose(phone, 'notes.txt', Buffer.from('just text, not a PDF'), 'text/plain');
  check(await until(phone, () => /Only PDFs can be added/.test(document.body.innerText)), 'A file that isn\'t a PDF is refused, and says so');
  await choose(phone, 'Huge.pdf', makePdf(1, 5.5 * 1024 * 1024));
  check(await until(phone, () => /PDFs up to 5 MB fit/.test(document.body.innerText)), 'Over 5 MB is refused, and says so');
  await sleep(800);
  check((await files()).length === 2, 'Nothing else was saved');

  // ---- deleted, with its parts ----
  await phone.evaluate(() => [...document.querySelectorAll('#commitFiles .fl-row')].find(x => /Contract/.test(x.innerText)).click());
  await phone.waitForSelector('#photoView .pv-del');
  await phone.click('#photoView .pv-del');
  check(await phone.evaluate(() => /Tap again/.test(document.querySelector('#photoView .pv-del').textContent)), 'Delete asks twice');
  await phone.click('#photoView .pv-del');
  const gone = await wait(async () => !(await files()).some(x => x.name === 'Contract.pdf') && (await parts(f2.id)).length === 0);
  check(gone, 'Deleted: the file and all its parts');
  check(await until(mac, () => !/Contract\.pdf/.test(document.getElementById('commitFiles').innerText) && /Invoice 42/.test(document.getElementById('commitFiles').innerText)),
    'Mac: gone there too; the other stays');

  for (const p of [phone, mac]) check(!p.errs.length, p.name + ': no page errors ' + p.errs.join(' | ').slice(0, 300));
  await b.close(); server.close();
  console.log(`\n${ok.length} passed, ${bad.length} failed`);
  process.exit(bad.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
