'use strict';
if (window.top !== window.self) { document.documentElement.innerHTML = ''; throw new Error('framed'); }

const $ = s => document.querySelector(s);
const BUILTIN = {
  mainnet: { name: 'Ethereum', id: 1, rpc: 'https://ethereum-rpc.publicnode.com', sym: 'ETH', scan: 'https://etherscan.io', c: '#627eea' },
  bsc: { name: 'BNB Smart Chain', id: 56, rpc: 'https://bsc-rpc.publicnode.com', sym: 'BNB', scan: 'https://bscscan.com', c: '#f0b90b' },
  polygon: { name: 'Polygon', id: 137, rpc: 'https://polygon-bor-rpc.publicnode.com', sym: 'POL', scan: 'https://polygonscan.com', c: '#8247e5' },
  arbitrum: { name: 'Arbitrum One', id: 42161, rpc: 'https://arbitrum-one-rpc.publicnode.com', sym: 'ETH', scan: 'https://arbiscan.io', c: '#28a0f0' },
  optimism: { name: 'Optimism', id: 10, rpc: 'https://optimism-rpc.publicnode.com', sym: 'ETH', scan: 'https://optimistic.etherscan.io', c: '#ff0420' },
  base: { name: 'Base', id: 8453, rpc: 'https://base-rpc.publicnode.com', sym: 'ETH', scan: 'https://basescan.org', c: '#0052ff' },
  avalanche: { name: 'Avalanche C-Chain', id: 43114, rpc: 'https://avalanche-c-chain-rpc.publicnode.com', sym: 'AVAX', scan: 'https://snowtrace.io', c: '#e84142' },
  sepolia: { name: 'Sepolia', id: 11155111, rpc: 'https://ethereum-sepolia-rpc.publicnode.com', sym: 'SepETH', scan: 'https://sepolia.etherscan.io', test: 1, c: '#627eea' },
  bsctest: { name: 'BNB Testnet', id: 97, rpc: 'https://bsc-testnet-rpc.publicnode.com', sym: 'tBNB', scan: 'https://testnet.bscscan.com', test: 1, c: '#f0b90b' },
  amoy: { name: 'Polygon Amoy', id: 80002, rpc: 'https://polygon-amoy-bor-rpc.publicnode.com', sym: 'POL', scan: 'https://amoy.polygonscan.com', test: 1, c: '#8247e5' },
  basesep: { name: 'Base Sepolia', id: 84532, rpc: 'https://base-sepolia-rpc.publicnode.com', sym: 'SepETH', scan: 'https://sepolia.basescan.org', test: 1, c: '#0052ff' }
};
const NKEY = 'mywallet.nets.v1';
let NETS = {};
function customNets() { try { return JSON.parse(localStorage.getItem(NKEY)) || []; } catch { return []; } }
function buildNets() { NETS = { ...BUILTIN }; customNets().forEach(n => { NETS['c' + n.id] = n; }); }
const TXKEY = 'mywallet.txpw.v1';
const KEY = 'mywallet.v1';
let wallet = null, net = 'sepolia', timer = null, temp = {};
buildNets();
try { const k = localStorage.getItem('mywallet.net'); if (k && NETS[k]) net = k; } catch {}
function setNet(k) { net = k; try { localStorage.setItem('mywallet.net', k); } catch {} }
const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = b => btoa(String.fromCharCode(...new Uint8Array(b)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const load = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); return true; } catch { return false; } };
const mk = s => s.t === 'm' ? ethers.Wallet.fromPhrase(s.v) : new ethers.Wallet(s.v);
const wait = () => new Promise(r => setTimeout(r, 40));

const LOGO = '<svg viewBox="0 0 32 32" aria-hidden="true"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#5b8cff"/><stop offset="1" stop-color="#1f5af6"/></linearGradient></defs><rect width="32" height="32" rx="10" fill="url(#lg)"/><path d="M11 9h6a7 7 0 010 14h-6z" fill="none" stroke="#fff" stroke-width="3" stroke-linejoin="round"/></svg>';
function show(h, right) {
  const bar = right === null ? '' : '<div class="top"><div class="brand">' + LOGO + '<span>Dorax</span></div>' + (right || '') + '</div>';
  $('#app').innerHTML = '<div class="pg">' + bar + h + '</div>'; window.scrollTo(0, 0);
}
function msg(id, t, ok) { const e = $('#' + id); if (e) { e.textContent = t; e.className = 'msg ' + (ok ? 'ok' : 'err'); } }
async function copyText(t, btn) {
  let ok = false;
  try { await navigator.clipboard.writeText(t); ok = true; } catch {}
  if (!ok) {
    const a = document.createElement('textarea');
    a.value = t; a.setAttribute('readonly', ''); a.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(a); a.focus(); a.select(); a.setSelectionRange(0, t.length);
    try { ok = document.execCommand('copy'); } catch {}
    a.remove();
  }
  if (btn) { const o = btn.textContent; btn.textContent = ok ? 'Copied' : 'Copy failed: press and hold the text'; setTimeout(() => btn.textContent = o, 2000); }
}

/* ---- encryption: PBKDF2 (600k) + AES-GCM, all in the browser ---- */
async function dk(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function seal(secret, address, pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12)), iter = 600000;
  const k = await dk(pw, salt, iter);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, k, enc.encode(JSON.stringify(secret)));
  return { v: 1, address, iter, salt: b64(salt), iv: b64(iv), ct: b64(ct) };
}
async function openSeal(r, pw) {
  const k = await dk(pw, unb64(r.salt), r.iter);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(r.iv) }, k, unb64(r.ct));
  return JSON.parse(dec.decode(pt));
}

/* ---- screens ---- */
function home() {
  const s = load();
  if (s && s.ct) return unlockView();
  show(`<div class="welcome"><div class="bigmark">${LOGO}</div><h1>Dorax Wallet</h1><p class="sub">A self-custody wallet. Your keys stay on this device. No account, no server holding your funds.</p></div>
  <div class="card"><button data-c="createStart()">Create new wallet</button>
  <button class="alt" data-c="importView()">Import recovery phrase or private key</button>
  <button class="alt" data-c="restoreView()">Restore from encrypted backup</button></div>
  <p class="note">Practice on Sepolia first. Do not keep real funds here until the app has had a security review.</p>`, null);
}

function createStart() { temp = {}; createView(); }
function createView() {
  sub('Create wallet', `<p class="sub">Step 1 of 3 &middot; Set a password</p><div class="card">
  <label>Password (at least 10 characters)</label><input id="p1" type="password" autocomplete="new-password" value="${esc(temp.pw || '')}">
  <label>Repeat password</label><input id="p2" type="password" autocomplete="new-password" value="${esc(temp.pw || '')}">
  <p class="note" style="margin:12px 0 0">The password only unlocks the wallet on this device. It cannot recover funds. Your recovery phrase can.</p>
  <button data-c="createNext()">Continue</button><div id="m"></div></div>`, 'home()');
}
function createNext() {
  const a = $('#p1').value, b = $('#p2').value;
  if (a.length < 10) return msg('m', 'Use at least 10 characters.');
  if (a !== b) return msg('m', 'The passwords do not match.');
  if (!temp.phrase) { const w = ethers.Wallet.createRandom(); temp.phrase = w.mnemonic.phrase; temp.address = w.address; }
  temp.pw = a;
  phraseView();
}
function phraseView() {
  const words = temp.phrase.split(' ');
  sub('Recovery phrase', `<p class="sub">Step 2 of 3 &middot; Write it down</p>
  <div class="card warn" style="margin-top:0">Write these 12 words on paper, in order. Anyone who has them controls your funds. If you lose them and forget the password, the funds are gone for good. No screenshots, no cloud notes.</div>
  <div class="words">${words.map((w, i) => `<span><i>${i + 1}</i>${w}</span>`).join('')}</div>
  <button data-c="verifyView()">I wrote it down</button>`, 'createView()');
}
function verifyView() {
  if (!temp.idx) temp.idx = [...Array(12).keys()].sort(() => Math.random() - .5).slice(0, 3).sort((a, b) => a - b);
  sub('Check your copy', `<p class="sub">Step 3 of 3 &middot; Confirm three words</p><div class="card">
  ${temp.idx.map(i => `<label>Word number ${i + 1}</label><input class="vw" autocapitalize="none" autocomplete="off" spellcheck="false">`).join('')}
  <button data-c="verifyDone()">Check and create wallet</button><div id="m"></div></div>`, 'phraseView()');
}
async function verifyDone() {
  const words = temp.phrase.split(' '), ins = [...document.querySelectorAll('.vw')];
  if (!ins.every((x, k) => x.value.trim().toLowerCase() === words[temp.idx[k]])) return msg('m', 'A word is wrong. Compare with your paper copy.');
  msg('m', 'Encrypting...', 1); await wait();
  await finish({ t: 'm', v: temp.phrase }, temp.address, temp.pw);
}
async function finish(secret, address, pw) {
  const rec = await seal(secret, address, pw);
  if (!save(rec)) return alert('This browser blocked storage (private mode?). The wallet was not saved.');
  try { localStorage.removeItem(TXKEY); } catch {}
  wallet = mk(secret); temp = {}; for (const k in bals) delete bals[k];
  mainView();
}

function importView() {
  sub('Import wallet', `<div class="card">
  <p class="note">Paste your 12 or 24 word phrase, or a private key. A wallet already stored here will be replaced.</p>
  <label>Recovery phrase or private key</label><textarea id="sec" autocapitalize="none" autocomplete="off" spellcheck="false"></textarea>
  <label>New password (at least 10 characters)</label><input id="p1" type="password" autocomplete="new-password">
  <button data-c="importDo()">Import</button><div id="m"></div></div>`, 'home()');
}
async function importDo() {
  const raw = $('#sec').value.trim(), pw = $('#p1').value;
  if (pw.length < 10) return msg('m', 'Use a password of at least 10 characters.');
  let secret;
  if (/^(0x)?[0-9a-fA-F]{64}$/.test(raw)) secret = { t: 'k', v: raw.startsWith('0x') ? raw : '0x' + raw };
  else {
    const p = raw.toLowerCase().split(/\s+/).join(' ');
    if (!ethers.Mnemonic.isValidMnemonic(p)) return msg('m', 'Not a valid recovery phrase or private key.');
    secret = { t: 'm', v: p };
  }
  msg('m', 'Encrypting...', 1); await wait();
  await finish(secret, mk(secret).address, pw);
}

function unlockView() {
  const s = load();
  show(`<div class="welcome"><div class="bigmark">${LOGO}</div><h1>Welcome back</h1><p class="sub addr" style="user-select:none">${esc(short(s.address))}</p></div><div class="card">
  <label>Password</label><input id="pw" type="password" autocomplete="current-password">
  <button data-c="unlock()">Unlock</button><div id="m"></div></div>
  <div class="card"><h2>Forgot the password?</h2>
  <p class="note">The password cannot be reset. Import your recovery phrase again and choose a new one.</p>
  <button class="alt" data-c="importView()">Import recovery phrase</button></div>`, null);
}
async function unlock() {
  msg('m', 'Unlocking...', 1); await wait();
  try { wallet = mk(await openSeal(load(), $('#pw').value)); mainView(); }
  catch { msg('m', 'Wrong password.'); }
}
function lock() { closeSheet(); wallet = null; clearTimeout(timer); for (const k in bals) delete bals[k]; unlockView(); }
function arm() { clearTimeout(timer); timer = setTimeout(lock, 300000); }
['click', 'touchstart', 'keydown'].forEach(e => document.addEventListener(e, () => { if (wallet) arm(); }, { passive: true }));

const ERC20 = ['function name() view returns (string)', 'function symbol() view returns (string)', 'function decimals() view returns (uint8)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)'];
const TKEY = 'mywallet.tokens.v1';
const DEFAULTS = { 11155111: [{ a: '0xf884e202ba30181B4c32FDdd6390F15816da0b4A', s: 'DRX', d: 18 }, { a: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238', s: 'USDC', d: 6 }] };
function allTokens() { try { return JSON.parse(localStorage.getItem(TKEY)) || {}; } catch { return {}; } }
function tokensFor(id) { return allTokens()[id] || DEFAULTS[id] || []; }
function tokens() { return tokensFor(NETS[net].id); }
function saveTokens(l) { const a = allTokens(); a[NETS[net].id] = l; try { localStorage.setItem(TKEY, JSON.stringify(a)); } catch {} }
const HKEY = 'mywallet.history.v1';
const hist = () => { try { return JSON.parse(localStorage.getItem(HKEY)) || []; } catch { return []; } };
const putHist = l => { try { localStorage.setItem(HKEY, JSON.stringify(l)); } catch {} };
const addHist = h => putHist([h, ...hist()].slice(0, 300));
const sig = h => (h.h || '').toLowerCase() + ':' + h.s + ':' + (h.d === 'in' ? 'in' : 'out');
function setHist(hash, st) { const l = hist(), x = l.find(i => i.h === hash); if (x) { x.st = st; putHist(l); } }
const fmt = v => { const [i, d = ''] = String(v).split('.'), t = d.slice(0, 6).replace(/0+$/, ''); return t ? i + '.' + t : (i === '0' && /[1-9]/.test(d) ? '<0.000001' : i); };
const short = a => a.slice(0, 8) + '...' + a.slice(-6);
function histRow(h) {
  const inn = h.d === 'in', st = inn ? 'Received' : h.st === 'ok' ? 'Confirmed' : h.st === 'fail' ? 'Failed' : 'Pending';
  return `<div class="row"><div class="ti ${inn ? 'in' : 'out'}">${inn ? IC.down : IC.up}</div><div class="rm"><b>${inn ? 'Received' : 'Sent'}</b><span>${inn ? 'From' : 'To'} ${esc(short(inn ? h.from : h.to))}</span><span>${esc(new Date(h.t).toLocaleString())} &middot; ${st}</span>${NETS[net].scan ? `<a class="vl" href="${NETS[net].scan}/tx/${esc(h.h)}" target="_blank" rel="noopener">View on explorer</a>` : ''}</div><div class="rb ${inn ? 'pos' : ''}">${inn ? '+' : '-'}${esc(fmt(h.a))} ${esc(h.s)}</div></div>`;
}
let histN = 20;
function renderHist() {
  const b = $('#hs'); if (!b || !wallet) return;
  const id = NETS[net].id, all = hist().filter(h => h.c === id && h.f === wallet.address).sort((x, y) => y.t - x.t), l = all.slice(0, histN);
  b.innerHTML = l.length ? l.map(histRow).join('') + (all.length > histN ? '<button class="alt" style="margin:12px 0 4px" data-c="moreHist()">Show more</button>' : '') : '<p class="note" style="padding:16px 0 2px">No transactions yet.</p>';
}
async function checkPending() {
  if (!wallet) return;
  const id = NETS[net].id, l = hist().filter(h => h.st === 'pending' && h.c === id && h.f === wallet.address);
  if (!l.length) return;
  const p = prov();
  try { for (const h of l) { const r = await p.getTransactionReceipt(h.h); if (r) setHist(h.h, r.status === 1 ? 'ok' : 'fail'); } } catch {}
  p.destroy(); renderHist();
}
const EXPL = { 1: 'https://eth.blockscout.com', 11155111: 'https://eth-sepolia.blockscout.com', 10: 'https://optimism.blockscout.com', 8453: 'https://base.blockscout.com', 42161: 'https://arbitrum.blockscout.com', 137: 'https://polygon.blockscout.com', 84532: 'https://base-sepolia.blockscout.com' };
const BKEY = 'mywallet.bskey.v1', HIDKEY = 'mywallet.hidden.v1';
const bsKey = () => { try { return localStorage.getItem(BKEY) || ''; } catch { return ''; } };
function bsUrls(id, path) {
  const u = [], k = bsKey(), q = path.includes('?') ? '&' : '?';
  if (k) u.push('https://api.blockscout.com/' + id + '/api/v2' + path + q + 'apikey=' + encodeURIComponent(k));
  if (EXPL[id]) u.push(EXPL[id] + '/api/v2' + path);
  return u;
}
async function bsGet(id, path) {
  for (const u of bsUrls(id, path)) {
    const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 12000);
    try { const r = await fetch(u, { signal: ctl.signal }); if (r.ok) return await r.json(); } catch {} finally { clearTimeout(to); }
  }
  return null;
}
const hidden = () => { try { return JSON.parse(localStorage.getItem(HIDKEY)) || {}; } catch { return {}; } };
function hideTok(id, a) { const h = hidden(); (h[id] = h[id] || []).push(a.toLowerCase()); try { localStorage.setItem(HIDKEY, JSON.stringify(h)); } catch {} }
const found = {}, lastEx = {};
let syncing = false;
async function syncTokens() {
  const n = NETS[net], me = wallet.address, key = 'mywallet.scan.' + n.id + '.' + me, p = prov();
  try {
    const latest = await p.getBlockNumber(), saved = localStorage.getItem(key);
    let from = saved ? Number(saved) + 1 : latest - 20000;
    if (latest - from > 20000) from = latest - 20000;
    if (from < 0) from = 0;
    const topic = ethers.id('Transfer(address,address,uint256)'), me32 = ethers.zeroPadValue(me, 32), have = new Set(hist().map(sig));
    for (const t of tokens()) {
      for (let s = from; s <= latest; s += 5000) {
        const logs = await p.getLogs({ address: t.a, topics: [topic, null, me32], fromBlock: s, toBlock: Math.min(s + 4999, latest) });
        for (const l of logs) {
          const sender = ethers.getAddress('0x' + l.topics[1].slice(26)), f = ethers.formatUnits(l.data, t.d);
          if (sender === me || !(Number(f) > 0)) continue;
          const e = { h: l.transactionHash, c: n.id, f: me, to: me, from: sender, a: f, s: t.s, t: 0, st: 'ok', d: 'in' };
          if (have.has(sig(e))) continue;
          const blk = await p.getBlock(l.blockNumber); e.t = blk ? blk.timestamp * 1000 : Date.now();
          have.add(sig(e)); addIn(e);
        }
      }
    }
    localStorage.setItem(key, String(latest));
    return true;
  } catch { return false; }
  finally { p.destroy(); }
}
async function syncExplorer(force) {
  const n = NETS[net], id = n.id, me = wallet.address, ck = id + ':' + me;
  if (!bsUrls(id, '/x').length) return null;
  if (!force && Date.now() - (lastEx[ck] || 0) < 100000) return true;
  lastEx[ck] = Date.now();
  const [tx, tt, tk] = await Promise.all([bsGet(id, '/addresses/' + me + '/transactions'), bsGet(id, '/addresses/' + me + '/token-transfers?type=ERC-20'), bsGet(id, '/addresses/' + me + '/tokens?type=ERC-20')]);
  if (!tx && !tt && !tk) { lastEx[ck] = 0; return false; }
  if (!wallet || wallet.address !== me || NETS[net].id !== id) return true;
  const ml = me.toLowerCase(), known = new Set(hist().map(sig)), mine = tokens(), fresh = [];
  const add = h => { const k = sig(h); if (known.has(k)) return; known.add(k); addHist(h); if (h.d === 'in' && Date.now() - h.t < 600000) fresh.push(h); };
  const dir = (x, a, s, hash, t, st) => {
    const f = x.from && x.from.hash, to = x.to && x.to.hash;
    if (!f || !to || !(Number(a) > 0)) return;
    const fl = f.toLowerCase(), tl = to.toLowerCase();
    if (fl === ml && tl !== ml) add({ h: hash, c: id, f: me, to: ethers.getAddress(to), a, s, t, st });
    else if (tl === ml && fl !== ml && st === 'ok') add({ h: hash, c: id, f: me, to: me, from: ethers.getAddress(f), a, s, t, st: 'ok', d: 'in' });
  };
  try {
    for (const x of (tx && tx.items) || []) {
      if (!x.value || x.value === '0') continue;
      dir(x, ethers.formatEther(x.value), n.sym, x.hash, Date.parse(x.timestamp) || Date.now(), x.status === 'ok' ? 'ok' : 'fail');
    }
    for (const x of (tt && tt.items) || []) {
      const a0 = x.token && x.token.address_hash, m = a0 && mine.find(t => t.a.toLowerCase() === a0.toLowerCase());
      if (!m || !x.total || x.total.value == null) continue;
      const dec = x.total.decimals != null ? Number(x.total.decimals) : m.d;
      dir(x, ethers.formatUnits(x.total.value, dec), m.s, x.transaction_hash, Date.parse(x.timestamp) || Date.now(), 'ok');
    }
    if (tk) {
      const have = new Set(mine.map(t => t.a.toLowerCase())), hid = new Set(hidden()[id] || []);
      found[id] = (tk.items || []).filter(x => x.token && x.token.address_hash && x.token.symbol && x.token.decimals != null && Number(x.token.decimals) >= 0 && Number(x.token.decimals) <= 36 && x.token.reputation !== 'scam' && x.value && x.value !== '0' && !have.has(x.token.address_hash.toLowerCase()) && !hid.has(x.token.address_hash.toLowerCase()))
        .slice(0, 25).map(x => ({ a: ethers.getAddress(x.token.address_hash), s: String(x.token.symbol).slice(0, 12), n: String(x.token.name || '').slice(0, 40), d: Number(x.token.decimals), v: ethers.formatUnits(x.value, Number(x.token.decimals)) }));
    }
  } catch { return false; }
  fresh.forEach(h => toast('Received ' + fmt(h.a) + ' ' + h.s));
  if (fresh.length) refresh();
  return true;
}
async function syncHistory(force) {
  if (!wallet || syncing) return;
  syncing = true;
  const t = await syncTokens(), e = await syncExplorer(force);
  syncing = false;
  renderHist(); paintFound();
  const n = $('#hn');
  if (n) n.textContent = e === null ? 'Full history is not available for this network, so only transfers this app saw are shown. A Blockscout key may add more (Settings, History and tokens).' : (t && e) ? '' : 'Some history could not be loaded right now. It will retry.';
}
function paintFound() {
  const e = $('#fnd'); if (!e) return;
  const l = found[NETS[net].id] || [];
  e.innerHTML = l.length ? `<button class="lnk" style="margin:0 0 12px" data-c="foundView()">${l.length} new token${l.length > 1 ? 's' : ''} found &middot; Review</button>` : '';
}
function foundView() {
  const id = NETS[net].id, l = found[id] || [];
  sub('Found tokens', `<p class="note">These tokens were found at your address on <b>${esc(NETS[net].name)}</b>. Anyone can send you a token, including fake ones. Add only tokens you recognise.</p>${l.length ? `<div class="list">${l.map((t, i) => `<div class="row"><div class="ti" style="background:hsl(${((t.s.charCodeAt(0) || 65) * 47) % 360} 55% 48%)">${esc(t.s.slice(0, 1))}</div><div class="rm"><b>${esc(t.s)}</b><span>${esc(t.n)} &middot; ${esc(short(t.a))}</span><span>Balance ${esc(fmt(t.v))}</span></div><div><button class="sm" style="margin:0 0 6px;display:block" data-c="foundAdd(${i})">Add</button><button class="sm alt" style="margin:0;display:block" data-c="foundHide(${i})">Hide</button></div></div>`).join('')}</div>` : '<p class="note">Nothing new.</p>'}`);
}
function foundAdd(i) {
  const id = NETS[net].id, t = (found[id] || [])[i]; if (!t) return;
  saveTokens([...tokens(), { a: t.a, s: t.s, d: t.d }]); found[id].splice(i, 1); lastAll = 0; lastPrice = 0; foundView();
}
function foundHide(i) { const id = NETS[net].id, t = (found[id] || [])[i]; if (!t) return; hideTok(id, t.a); found[id].splice(i, 1); foundView(); }
function histSetView() {
  tab = 'settings';
  const id = NETS[net].id, key = bsKey(), src = key ? 'Blockscout PRO API (your key)' : EXPL[id] ? 'Blockscout public explorer' : 'Not available';
  sub('History and tokens', `<div class="card"><p class="note" style="margin:0">History and tokens are read from the blockchain by address, so they come back with your recovery phrase on any device. The wallet asks a Blockscout explorer, which can see your address.</p></div>
  <div class="card"><div class="kv" style="border:0;padding:0"><span>Source on ${esc(NETS[net].name)}</span><b>${esc(src)}</b></div></div>
  <div class="card"><h2>Blockscout PRO API key (optional)</h2><p class="note">A free key from dev.blockscout.com raises the limits and may add more networks. It is stored in this browser.</p><input id="bk1" type="password" autocomplete="off" spellcheck="false" placeholder="proapi_..." value="${esc(key)}"><button data-c="bsSave()">Save key</button>${key ? '<button class="alt danger" data-c="bsClear()">Remove key</button>' : ''}</div>
  <button class="alt" data-c="bsNow()">Sync now</button><div id="m"></div>`);
}
function bsSave() {
  const k = $('#bk1').value.trim();
  if (!/^[\w.-]{8,200}$/.test(k)) return msg('m', 'That does not look like a valid key.');
  try { localStorage.setItem(BKEY, k); } catch {}
  for (const c in lastEx) delete lastEx[c];
  toast('Key saved'); histSetView();
}
function bsClear() { try { localStorage.removeItem(BKEY); } catch {} for (const c in lastEx) delete lastEx[c]; toast('Key removed'); histSetView(); }
async function bsNow() { msg('m', 'Syncing...', 1); await syncHistory(true); const m = $('#m'); if (m) msg('m', 'Done. ' + (found[NETS[net].id] || []).length + ' new token(s) found.', 1); }
function drawQR() {
  const b = $('#qr'); if (!b) return;
  if (!window.qrcode) { b.innerHTML = '<p class="note" style="line-height:1.4;padding:10px">QR library could not load. Copy the address instead.</p>'; return; }
  const q = qrcode(0, 'M'); q.addData(wallet.address); q.make();
  b.innerHTML = q.createSvgTag(6, 0);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && wallet) { refresh(); checkPending(); } });
let tickN = 0;
setInterval(() => {
  if (!wallet || document.hidden || (!$('#bal') && !$('#db'))) return;
  refresh();
  if (++tickN % 3 === 0) { syncHistory(); checkPending(); }
  if (tickN % 6 === 0) { loadPrices(); refreshAll(); }
}, 10000);
const provFor = n => new ethers.JsonRpcProvider(n.rpc, n.id, { staticNetwork: ethers.Network.from(n.id) });
const prov = () => provFor(NETS[net]);

const IC = {
  up: '<svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12l7 7 7-7"/></svg>',
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 012-2h9"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
  chev: '<svg viewBox="0 0 24 24"><path d="M6 9l6 6 6-6"/></svg>',
  eth: '<svg viewBox="0 0 24 24" style="fill:#fff;stroke:none"><path d="M12 2l6 10-6 3.5L6 12zM12 16.7l6-3.5L12 22 6 13.2z"/></svg>'
};
let tab = 'assets';
function sub(title, body, back) {
  show(`<div class="bar"><button class="back" data-c="${back || 'mainView()'}" aria-label="Back">${IC.back}</button><div class="bt">${title}</div><span class="sp"></span></div>${body}`, null);
}
function setTab(t) {
  tab = t;
  ['assets', 'activity', 'settings'].forEach(k => { const p = $('#p-' + k), b = $('#t-' + k); if (p) p.hidden = k !== t; if (b) b.classList.toggle('on', k === t); });
}
function mainView() {
  arm();
  const n = NETS[net], hue = parseInt(wallet.address.slice(2, 8), 16) % 360;
  show(`<div class="hdr"><div class="brand">${LOGO}<span>Dorax</span></div><button class="pill" data-c="networksView()"><i style="background:${n.c || '#6b7a99'}"></i><span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(n.name)}</span>${IC.chev}</button></div>
  ${n.test ? '' : `<div class="card warn" style="margin:0 0 12px">${esc(n.name)} is a real-money network. Check every address twice.</div>`}
  <section class="bc"><div class="bt1"><div class="acc"><div class="avt" style="background:linear-gradient(135deg,hsl(${hue} 80% 65%),hsl(${(hue + 60) % 360} 80% 50%))"></div><div><div class="an">Account 1</div><button class="ad" data-c="copyText('${wallet.address}', this)">${short(wallet.address)}</button></div></div><button class="ib" data-c="addView()" aria-label="Add token">${IC.plus}</button></div>
  <div class="bl"><span>Total balance</span><div class="bv" id="tot">...</div><div class="bs2" id="bal">...</div></div>
  <div class="ac"><button class="ab" data-c="sendView('')">${IC.up}<span>Send</span></button><button class="ab" data-c="receiveView('')">${IC.down}<span>Receive</span></button><button class="ab" data-c="copyCard('${wallet.address}', this)">${IC.copy}<span>Copy</span></button></div></section>
  <div class="tabs"><button id="t-assets" data-c="setTab('assets')">Assets</button><button id="t-activity" data-c="setTab('activity')">Activity</button><button id="t-settings" data-c="setTab('settings')">Settings</button></div>
  <div id="p-assets"><div id="fnd"></div><div class="list"><div class="row clk" data-c="assetView('')"><div class="ti" style="background:${n.c || '#6b7a99'}">${esc(n.sym.slice(0, 1))}</div><div class="rm"><b>${esc(n.sym)}</b><span id="np">${esc(n.name)}</span></div><div class="rb"><div id="nb">...</div><small class="fv" id="nv"></small></div></div><div id="tk">${tokens().map(tokRow).join('')}</div></div><button class="lnk" data-c="addView()">+ Add token</button><p class="note" id="pnote" style="margin-top:12px"></p></div>
  <div id="p-activity"><div class="list" id="hs"></div><p class="note" id="hn" style="margin-top:12px"></p><p class="note">Shows what you sent from this app and what you received.</p></div>
  <div id="p-settings"><button class="srow" style="margin-top:0" data-c="networksView()">Networks <span>&rsaquo;</span></button><button class="srow" data-c="manageView()">Manage tokens <span>&rsaquo;</span></button><button class="srow" data-c="histSetView()">History and tokens <span>&rsaquo;</span></button><button class="srow" data-c="txpwView()">Transaction password <span>${loadTx() ? 'On' : 'Off'} &rsaquo;</span></button><button class="srow" data-c="secView()">Recovery phrase and private key <span>&rsaquo;</span></button><button class="srow" data-c="backupView()">Export encrypted backup <span>&rsaquo;</span></button><button class="srow" data-c="lock()">Lock wallet <span>&rsaquo;</span></button><button class="srow dng" data-c="wipeView()">Remove wallet from this device</button><p class="note" style="margin-top:16px">Dorax Wallet. Non-custodial: your keys never leave this device.</p></div>`, null);
  setTab(tab); paint(); refresh(); refreshAll(); loadPrices(); syncHistory(); renderHist(); checkPending();
}
const loadTx = () => { try { return JSON.parse(localStorage.getItem(TXKEY)); } catch { return null; } };
let txFails = 0, txLockUntil = 0;
function closeSheet() { const o = $('#ov'); if (o) o.remove(); }
function askTxPw() {
  const wait = Math.ceil((txLockUntil - Date.now()) / 1000);
  if (wait > 0) return toast('Too many wrong attempts. Try again in ' + wait + ' seconds.');
  closeSheet();
  const t = temp.tx || {}, o = document.createElement('div');
  o.className = 'ov'; o.id = 'ov';
  o.innerHTML = `<div class="sheet" id="sh" role="dialog" aria-modal="true"><div class="shi">${IC.lock}</div><div class="sht">Transaction password</div><p class="note" style="text-align:center;margin:4px 0 14px">Enter your transaction password to send ${esc(t.amt || '')} ${esc(t.sym || '')}.</p><input id="tpw" type="password" autocomplete="off" placeholder="Password" data-enter="txSubmit()"><div class="msg err" id="tpm" style="min-height:1.2em"></div><button id="tpb" data-c="txSubmit()">Confirm</button><button class="alt" data-c="closeSheet()">Cancel</button></div>`;
  document.body.appendChild(o);
  setTimeout(() => { const i = $('#tpw'); if (i) i.focus(); }, 60);
}
async function txSubmit() {
  const inp = $('#tpw'), btn = $('#tpb');
  if (!inp || btn.disabled) return;
  btn.disabled = true;
  const ok = await txCheck(inp.value);
  if (ok) { txFails = 0; temp.auth = Date.now(); closeSheet(); sendNow(); return; }
  txFails++;
  if (txFails >= 3) {
    txFails = 0; txLockUntil = Date.now() + 30000;
    closeSheet(); temp.busy = false; temp.tx = null; temp.form = null; temp.ret = ''; tab = 'assets';
    mainView(); toast('Send cancelled: 3 wrong passwords');
    return;
  }
  const left = 3 - txFails, sh = $('#sh');
  $('#tpm').textContent = 'Wrong password. ' + left + (left === 1 ? ' attempt' : ' attempts') + ' left.';
  inp.value = ''; inp.focus(); btn.disabled = false;
  if (sh) { sh.classList.remove('shake'); void sh.offsetWidth; sh.classList.add('shake'); }
}
async function txDerive(pw, salt, iter) {
  const base = await crypto.subtle.importKey('raw', enc.encode(pw), 'PBKDF2', false, ['deriveBits']);
  return b64(await crypto.subtle.deriveBits({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, 256));
}
async function txCheck(pw) { const r = loadTx(); if (!r) return true; try { return (await txDerive(pw, unb64(r.salt), r.iter)) === r.h; } catch { return false; } }
async function txSave(pw) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), iter = 300000;
  localStorage.setItem(TXKEY, JSON.stringify({ salt: b64(salt), iter, h: await txDerive(pw, salt, iter) }));
}
function txpwView() {
  tab = 'settings';
  const on = !!loadTx();
  sub('Transaction password', on ? `<div class="card"><b>Status: On</b><p class="note" style="margin:6px 0 0">Every send asks for this password before it goes out.</p></div>
  <div class="card"><h2>Change password</h2><label>Current transaction password</label><input id="tp0" type="password" autocomplete="off"><label>New password (at least 6 characters)</label><input id="tp1" type="password" autocomplete="new-password"><label>Repeat new password</label><input id="tp2" type="password" autocomplete="new-password"><button data-c="txChange()">Change password</button></div>
  <div class="card"><h2>Turn off</h2><label>Current transaction password</label><input id="tp3" type="password" autocomplete="off"><button class="alt danger" data-c="txOff()">Turn off</button></div>
  <div class="card"><h2>Forgot it?</h2><p class="note">Enter your wallet password to remove the transaction password.</p><label>Wallet password</label><input id="tp4" type="password" autocomplete="current-password"><button class="alt" data-c="txReset()">Remove with wallet password</button></div><div id="m"></div>`
  : `<div class="card"><b>Status: Off</b><p class="note" style="margin:6px 0 0">Add a separate password that must be entered to confirm every send. Use something different from your wallet password.</p></div>
  <div class="card"><label>New transaction password (at least 6 characters)</label><input id="tp1" type="password" autocomplete="new-password"><label>Repeat password</label><input id="tp2" type="password" autocomplete="new-password"><button data-c="txSet()">Turn on</button><div id="m"></div></div>`);
}
async function txSet() {
  const a = $('#tp1').value, b = $('#tp2').value;
  if (a.length < 6) return msg('m', 'Use at least 6 characters.');
  if (a !== b) return msg('m', 'The passwords do not match.');
  msg('m', 'Saving...', 1); await wait();
  try { await txSave(a); } catch { return msg('m', 'Could not save in this browser.'); }
  toast('Transaction password is on'); txpwView();
}
async function txChange() {
  const a = $('#tp1').value, b = $('#tp2').value;
  msg('m', 'Checking...', 1); await wait();
  if (!(await txCheck($('#tp0').value))) return msg('m', 'The current transaction password is wrong.');
  if (a.length < 6) return msg('m', 'Use at least 6 characters.');
  if (a !== b) return msg('m', 'The new passwords do not match.');
  try { await txSave(a); } catch { return msg('m', 'Could not save in this browser.'); }
  toast('Transaction password changed'); txpwView();
}
async function txOff() {
  msg('m', 'Checking...', 1); await wait();
  if (!(await txCheck($('#tp3').value))) return msg('m', 'The current transaction password is wrong.');
  try { localStorage.removeItem(TXKEY); } catch {}
  toast('Transaction password is off'); txpwView();
}
async function txReset() {
  msg('m', 'Checking...', 1); await wait();
  try { await openSeal(load(), $('#tp4').value); } catch { return msg('m', 'The wallet password is wrong.'); }
  try { localStorage.removeItem(TXKEY); } catch {}
  toast('Transaction password removed'); txpwView();
}
function pickNet(k) { if (!NETS[k]) return; setNet(k); tab = 'assets'; if (wallet) mainView(); else home(); }
function networksView() {
  const row = ([k, n]) => `<div class="nrow"><button class="nsel" data-c="pickNet('${k}')"><span class="nd" style="background:${n.c || '#6b7a99'}"></span><span><b>${esc(n.name)}</b><small>Chain ID ${n.id} &middot; ${esc(n.sym)}</small></span>${k === net ? '<span class="chk">&#10003;</span>' : ''}</button>${k[0] === 'c' ? `<button class="nrm" data-c="rmNet('${k}')">Remove</button>` : ''}</div>`;
  const all = Object.entries(NETS);
  sub('Networks', `<h2>Networks</h2>${all.filter(([, n]) => !n.test).map(row).join('')}<h2 style="margin-top:18px">Test networks</h2>${all.filter(([, n]) => n.test).map(row).join('')}<button class="alt" data-c="netAddView()">+ Add custom network</button><p class="note" style="margin-top:14px">Every network uses the same wallet address and recovery phrase. Non-EVM chains such as Bitcoin or Solana are not supported yet.</p>`);
}
function netAddView() {
  sub('Add network', `<div class="fm"><label>Network name</label><input id="nn" autocomplete="off" placeholder="My Network"><label>RPC URL</label><input id="nr" autocomplete="off" spellcheck="false" placeholder="https://..."><label>Chain ID</label><input id="ni" inputmode="numeric" placeholder="1337"><label>Currency symbol</label><input id="ns" autocomplete="off" placeholder="ETH"><label>Block explorer URL (optional)</label><input id="ne" autocomplete="off" spellcheck="false" placeholder="https://..."><label style="display:flex;align-items:center;margin-top:16px"><input type="checkbox" id="nt">This is a test network</label><button data-c="netAddDo()">Add network</button><div id="m"></div><p class="note" style="margin-top:14px">Only add RPC servers you trust. An RPC can see your address and balances.</p></div>`, 'networksView()');
}
async function netAddDo() {
  const name = $('#nn').value.trim(), rpc = $('#nr').value.trim(), id = Number($('#ni').value), sym = $('#ns').value.trim(), scan = $('#ne').value.trim().replace(/\/$/, ''), test = $('#nt').checked;
  if (!/^[\w .+()-]{1,32}$/.test(name) || !/^[\w.+-]{1,10}$/.test(sym)) return msg('m', 'Use a short name and symbol (letters, numbers, space, dot, dash).');
  if (!/^https:\/\/[^\s"'<>]+$/.test(rpc)) return msg('m', 'The RPC URL must start with https://');
  if (scan && !/^https:\/\/[^\s"'<>]+$/.test(scan)) return msg('m', 'The explorer URL must start with https://');
  if (!Number.isInteger(id) || id < 1) return msg('m', 'Enter a valid chain ID.');
  if (Object.values(NETS).some(n => n.id === id)) return msg('m', 'A network with this chain ID already exists.');
  msg('m', 'Checking the RPC...', 1);
  try {
    const r = await fetch(rpc, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }) });
    const got = parseInt((await r.json()).result, 16);
    if (got !== id) return msg('m', 'This RPC reports chain ID ' + got + ', not ' + id + '.');
  } catch { return msg('m', 'Could not reach this RPC.'); }
  const l = customNets(); l.push({ name, id, rpc, sym, scan, test, c: '#6b7a99' });
  try { localStorage.setItem(NKEY, JSON.stringify(l)); } catch {}
  buildNets(); pickNet('c' + id);
}
function rmNet(k) {
  if (!confirm('Remove this network from the list? Your funds are not affected.')) return;
  try { localStorage.setItem(NKEY, JSON.stringify(customNets().filter(n => 'c' + n.id !== k))); } catch {}
  buildNets(); if (net === k) setNet('sepolia'); networksView();
}
function receiveView(ret) {
  if (ret !== undefined) temp.rret = ret;
  sub('Receive', `<div class="rcv"><div class="qrbox" id="qr"></div><p class="note" style="margin-top:14px">Scan to receive</p><div class="addr" style="font-size:14px;padding:0 8px">${wallet.address}</div><button data-c="copyText('${wallet.address}', this)">Copy address</button><p class="note" style="margin-top:14px">Network: ${esc(NETS[net].name)}. The same address works on all Ethereum-style networks, so the sender must pick the right one.</p></div>`, temp.rret || 'mainView()');
  drawQR();
}
function addView(ret) {
  sub('Add token', `<div class="fm"><div class="row" style="border:0;padding:0 0 4px"><div class="ti" style="background:${NETS[net].c || '#6b7a99'}">${esc(NETS[net].sym.slice(0, 1))}</div><div class="rm"><b>${esc(NETS[net].name)}</b><span>Tokens are added per network. Change the network on the home screen first.</span></div></div><label>Token contract address</label><input id="ta" autocomplete="off" spellcheck="false" placeholder="0x..."><button data-c="lookupToken()">Look up token</button><div id="tm"></div><p class="note" style="margin-top:14px">Anyone can create a token with any name, even a fake "USDC". Add only addresses from the official source.</p></div>`, ret || 'mainView()');
}
function sendView(ret) {
  if (ret !== undefined) temp.ret = ret;
  const f = temp.form || {};
  sub('Send', `<div class="fm"><p class="note" style="margin:0">Network: <b>${esc(NETS[net].name)}</b></p><label>Asset</label><select id="as"><option value="">${esc(NETS[net].sym)}</option>${tokens().map(t => `<option value="${esc(t.a)}" ${t.a === f.as ? 'selected' : ''}>${esc(t.s)}</option>`).join('')}</select>
  <label>Recipient address</label><div class="in2"><input id="to" autocomplete="off" spellcheck="false" placeholder="0x..." value="${esc(f.to || '')}"><button class="pb" data-c="pasteTo()">Paste</button></div>
  <label>Amount</label><input id="amt" inputmode="decimal" placeholder="0.0" value="${esc(f.amt || '')}">
  <button data-c="sendPrep()">Continue</button><div id="m"></div></div>`, temp.ret || 'mainView()');
}
async function pasteTo() {
  try { $('#to').value = (await navigator.clipboard.readText()).trim(); } catch { msg('m', 'Paste is not allowed here. Press and hold in the field to paste.'); }
}
const bals = {};
let refreshing = false, refreshingAll = false, lastAll = 0, lastPrice = 0;
const CHAIN = { 1: 'ethereum', 56: 'bsc', 137: 'polygon', 42161: 'arbitrum', 10: 'optimism', 8453: 'base', 43114: 'avax' };
const GECKO = { 1: 'ethereum', 56: 'binancecoin', 137: 'polygon-ecosystem-token', 42161: 'ethereum', 10: 'ethereum', 8453: 'ethereum', 43114: 'avalanche-2' };
const PKEY = 'mywallet.prices.v1';
let prices = {}, pricesAt = 0, pricesFail = false;
try { const c = JSON.parse(localStorage.getItem(PKEY)); if (c && c.p) { prices = c.p; pricesAt = c.t || 0; } } catch {}
const pkey = (id, a) => a ? CHAIN[id] + ':' + a.toLowerCase() : 'coingecko:' + GECKO[id];
const priceOf = (id, a) => CHAIN[id] ? prices[pkey(id, a)] : undefined;
const usd = v => v === 0 ? '$0.00' : v < 0.01 ? '<$0.01' : '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const px = v => v >= 1 ? '$' + v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '$' + v.toPrecision(4);
function tokRow(t, i) { return `<div class="row clk" data-c="assetView('${t.a}')"><div class="ti" style="background:hsl(${((t.s.charCodeAt(0) || 65) * 47) % 360} 55% 48%)">${esc(t.s.slice(0, 1))}</div><div class="rm"><b>${esc(t.s)}</b><span id="tp${i}">${esc(short(t.a))}</span></div><div class="rb"><div id="tb${i}">...</div><small class="fv" id="tv${i}"></small></div></div>`; }
async function fetchBals(nk, me) {
  const n = NETS[nk], list = tokensFor(n.id), p = provFor(n), res = {};
  try { const f = ethers.formatEther(await p.getBalance(me)); res[nk + ':'] = { s: fmt(f), v: Number(f) }; } catch { res[nk + ':'] = null; }
  await Promise.all(list.map(async t => {
    try { const f = ethers.formatUnits(await new ethers.Contract(t.a, ERC20, p).balanceOf(me), t.d); res[nk + ':' + t.a] = { s: fmt(f), v: Number(f) }; } catch { res[nk + ':' + t.a] = null; }
  }));
  p.destroy(); return res;
}
function merge(res) { for (const k in res) { if (res[k]) bals[k] = res[k]; else if (bals[k] === undefined) bals[k] = null; } }
async function refresh() {
  if (!wallet || refreshing) return;
  refreshing = true;
  const nk = net, me = wallet.address, res = await fetchBals(nk, me);
  refreshing = false;
  if (!wallet || wallet.address !== me) return;
  merge(res); paint();
  if (net !== nk) refresh();
}
async function refreshAll(force) {
  if (!wallet || refreshingAll || (!force && Date.now() - lastAll < 45000)) return;
  refreshingAll = true; lastAll = Date.now();
  const me = wallet.address, ks = Object.keys(NETS).filter(k => !NETS[k].test && CHAIN[NETS[k].id]);
  const parts = await Promise.all(ks.map(k => fetchBals(k, me)));
  refreshingAll = false;
  if (!wallet || wallet.address !== me) return;
  parts.forEach(merge); paint();
}
async function loadPrices(force) {
  if (!force && Date.now() - lastPrice < 45000) return;
  lastPrice = Date.now();
  const keys = new Set();
  Object.values(NETS).forEach(n => { if (n.test || !CHAIN[n.id]) return; keys.add(pkey(n.id)); tokensFor(n.id).forEach(t => keys.add(pkey(n.id, t.a))); });
  const ctl = new AbortController(), to = setTimeout(() => ctl.abort(), 9000);
  try {
    const r = await fetch('https://coins.llama.fi/prices/current/' + [...keys].join(','), { signal: ctl.signal });
    if (!r.ok) throw 0;
    const j = await r.json(), low = {};
    for (const k in j.coins || {}) low[k.toLowerCase()] = j.coins[k].price;
    keys.forEach(k => { const v = low[k.toLowerCase()]; if (typeof v === 'number') prices[k] = v; });
    pricesAt = Date.now(); pricesFail = false;
    try { localStorage.setItem(PKEY, JSON.stringify({ t: pricesAt, p: prices })); } catch {}
  } catch { pricesFail = true; }
  finally { clearTimeout(to); }
  paint();
}
function totalUSD() {
  let sum = 0, missing = false;
  for (const k of Object.keys(NETS)) {
    const n = NETS[k]; if (n.test || !CHAIN[n.id]) continue;
    for (const a of [''].concat(tokensFor(n.id).map(t => t.a))) {
      const b = bals[k + ':' + a]; if (!b || !(b.v > 0)) continue;
      const pr = priceOf(n.id, a); if (pr === undefined) { missing = true; continue; }
      sum += b.v * pr;
    }
  }
  return { sum, missing };
}
function paint() {
  if (!wallet) return;
  const n = NETS[net], id = n.id, val = x => x === undefined ? '...' : x === null ? 'Offline' : x.s, v = bals[net + ':'];
  const bal = $('#bal'); if (bal) bal.innerHTML = v === undefined ? '...' : v === null ? 'Could not load' : esc(v.s) + ' ' + esc(n.sym);
  const tot = $('#tot');
  if (tot) { const have = Object.keys(prices).length, T = totalUSD(); tot.textContent = !have ? (pricesFail ? '$\u2014' : '...') : usd(T.sum) + (T.missing ? '+' : ''); }
  const np = priceOf(id, ''), npe = $('#np'); if (npe) npe.textContent = np !== undefined ? px(np) : n.name;
  const nb = $('#nb'); if (nb) nb.textContent = val(v);
  const nv = $('#nv'); if (nv) nv.textContent = np !== undefined && v ? usd(v.v * np) : '';
  tokens().forEach((t, i) => {
    const b = bals[net + ':' + t.a], pr = priceOf(id, t.a);
    const e1 = $('#tb' + i), e2 = $('#tp' + i), e3 = $('#tv' + i);
    if (e1) e1.textContent = val(b);
    if (e2) e2.textContent = pr !== undefined ? px(pr) : short(t.a);
    if (e3) e3.textContent = pr !== undefined && b ? usd(b.v * pr) : '';
  });
  const d = $('#db');
  if (d) {
    const a = temp.asset || '', b = bals[net + ':' + a], pr = priceOf(id, a), tk = a ? tokens().find(t => t.a === a) : null, sym = tk ? tk.s : n.sym;
    d.textContent = val(b);
    const dv = $('#dv'); if (dv) dv.textContent = pr !== undefined ? (b ? '\u2248 ' + usd(b.v * pr) + ' \u00b7 ' : '') + px(pr) + ' per ' + sym : n.test ? 'Test network assets have no market value' : 'Price not available';
  }
  paintFound();
  const pn = $('#pnote'); if (pn) pn.textContent = pricesFail ? 'Prices could not be loaded. Showing the last known values.' : 'Prices come from DefiLlama and update about once a minute. Test networks have no value.';
}
let toastT;
function toast(t) { const e = $('#toast'); if (!e) return; e.textContent = t; e.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => e.classList.remove('on'), 4500); }
function addIn(h) { addHist(h); if (Date.now() - h.t < 600000) { toast('Received ' + fmt(h.a) + ' ' + h.s); refresh(); } }
async function lookupToken() {
  const raw = $('#ta').value.trim();
  if (!ethers.isAddress(raw)) return msg('tm', 'That is not a valid contract address.');
  const a = ethers.getAddress(raw);
  if (tokens().some(t => t.a === a)) return msg('tm', 'This token is already in your list.');
  msg('tm', 'Reading the token...', 1);
  const p = prov();
  try {
    if ((await p.getCode(a)) === '0x') return msg('tm', 'No contract at this address on ' + NETS[net].name + '. Check the network.');
    const c = new ethers.Contract(a, ERC20, p);
    const [s, d, b] = await Promise.all([c.symbol(), c.decimals(), c.balanceOf(wallet.address)]);
    let nm = ''; try { nm = await c.name(); } catch {}
    const dn = Number(d), sy = String(s).slice(0, 12);
    if (!(dn >= 0 && dn <= 36)) throw 0;
    temp.tkn = { a, s: sy, d: dn };
    $('#tm').className = '';
    $('#tm').innerHTML = `<div class="card"><div class="row" style="border:0"><div class="ti" style="background:hsl(${((sy.charCodeAt(0) || 65) * 47) % 360} 55% 48%)">${esc(sy.slice(0, 1))}</div><div class="rm"><b>${esc(sy)}</b><span>${esc(String(nm).slice(0, 40))}</span></div><div class="rb">${esc(fmt(ethers.formatUnits(b, dn)))}</div></div><div class="kv"><span>Contract</span><b class="addr">${esc(short(a))}</b></div><div class="kv"><span>Decimals</span><b>${dn}</b></div><div class="kv"><span>Network</span><b>${esc(NETS[net].name)}</b></div><button data-c="addToken()">Add to wallet</button></div>`;
  } catch { msg('tm', 'This does not look like a standard token on this network.'); }
  finally { p.destroy(); }
}
function addToken() { if (!temp.tkn) return; saveTokens([...tokens(), temp.tkn]); temp.tkn = null; tab = 'assets'; lastAll = 0; lastPrice = 0; mainView(); }
function manageView() {
  tab = 'settings';
  const l = tokens();
  sub('Manage tokens', `<p class="note">Tokens on <b>${esc(NETS[net].name)}</b>. Removing a token only hides it here. Your tokens stay in your wallet.</p>${l.length ? `<div class="list">${l.map((t, i) => `<div class="row"><div class="ti" style="background:hsl(${((t.s.charCodeAt(0) || 65) * 47) % 360} 55% 48%)">${esc(t.s.slice(0, 1))}</div><div class="rm"><b>${esc(t.s)}</b><span>${esc(short(t.a))}</span></div><button class="sm alt danger" style="margin:0" data-c="rmToken(${i})">Remove</button></div>`).join('')}</div>` : '<p class="note">No tokens added on this network.</p>'}<button class="alt" data-c="addView('manageView()')">+ Add token</button>`);
}
function rmToken(i) {
  if (!confirm('Remove this token from the list? Your tokens are not deleted.')) return;
  const l = tokens(), r = l.splice(i, 1)[0]; if (r) hideTok(NETS[net].id, r.a); saveTokens(l); manageView();
}
function sendFor(a) { temp.form = { as: a, to: '', amt: '' }; sendView("assetView('" + a + "')"); }
function receiveFor(a) { receiveView("assetView('" + a + "')"); }
function assetView(a) {
  temp.asset = a;
  const n = NETS[net], tk = a ? tokens().find(t => t.a === a) : null;
  if (a && !tk) return mainView();
  const sym = tk ? tk.s : n.sym, bg = tk ? `hsl(${((sym.charCodeAt(0) || 65) * 47) % 360} 55% 48%)` : (n.c || '#6b7a99');
  const l = hist().filter(h => h.c === n.id && h.f === wallet.address && h.s === sym).sort((x, y) => y.t - x.t).slice(0, 15);
  sub(esc(sym), `<div class="cfm"><div class="ti big" style="background:${bg}">${esc(sym.slice(0, 1))}</div><div class="ca"><span id="db">...</span> <small>${esc(sym)}</small></div><p class="note" id="dv" style="margin:0 0 2px"></p><p class="note">${tk ? 'Token' : 'Native coin'} on ${esc(n.name)}</p></div>
  <div class="ac2"><button class="ab2" data-c="sendFor('${a}')">${IC.up}<span>Send</span></button><button class="ab2" data-c="receiveFor('${a}')">${IC.down}<span>Receive</span></button></div>
  <h2>Details</h2><div class="list"><div class="kv"><span>Network</span><b>${esc(n.name)}</b></div><div class="kv"><span>Chain ID</span><b>${n.id}</b></div><div class="kv" ${tk ? '' : 'style="border:0"'}><span>Type</span><b>${tk ? 'ERC-20 token' : 'Native coin'}</b></div>${tk ? `<div class="kv"><span>Decimals</span><b>${tk.d}</b></div><div class="kv" style="border:0"><span>Contract (tap to copy)</span><b class="addr" style="cursor:pointer" data-c="copyText('${tk.a}', this)">${esc(short(tk.a))}</b></div>` : ''}</div>
  ${n.scan ? `<a class="lnk" style="display:block;text-align:center;padding:14px;border-radius:14px;margin-top:12px" href="${n.scan}/${tk ? 'token/' + tk.a : 'address/' + wallet.address}" target="_blank" rel="noopener">View on explorer</a>` : ''}
  <h2 style="margin-top:18px">Activity</h2><div class="list">${l.length ? l.map(histRow).join('') : '<p class="note" style="padding:16px 0 2px">No transactions with this asset yet.</p>'}</div>`, 'mainView()');
  paint();
}

async function sendPrep() {
  const to = $('#to').value.trim(), amt = $('#amt').value.trim(), as = $('#as').value;
  temp.form = { to, amt, as };
  const tk = as ? tokens().find(t => t.a === as) : null;
  const sym = tk ? tk.s : NETS[net].sym;
  if (!ethers.isAddress(to)) return msg('m', 'That is not a valid address.');
  let v; try { v = ethers.parseUnits(amt, tk ? tk.d : 18); if (v <= 0n) throw 0; } catch { return msg('m', 'Enter an amount greater than 0.'); }
  msg('m', 'Checking balance and fee...', 1);
  const p = prov();
  try {
    const f = await p.getFeeData(), ethBal = await p.getBalance(wallet.address);
    let gas;
    if (tk) {
      const c = new ethers.Contract(tk.a, ERC20, p);
      if ((await c.balanceOf(wallet.address)) < v) return msg('m', 'Not enough ' + sym + ' balance.');
      gas = await c.transfer.estimateGas(to, v, { from: wallet.address });
    } else gas = await p.estimateGas({ from: wallet.address, to, value: v });
    const fee = (f.maxFeePerGas ?? f.gasPrice) * gas;
    if (ethBal < fee + (tk ? 0n : v)) return msg('m', 'Not enough ' + NETS[net].sym + ' for the amount plus the fee (about ' + ethers.formatEther(fee) + ').');
    temp.tx = { to, v, tk, amt, sym }; temp.busy = false;
    sub('Confirm', `<div class="cfm"><div class="ca">${esc(amt)} <small>${esc(sym)}</small></div></div>
    <div class="kv"><span>To</span><b class="addr">${to}</b></div>
    <div class="kv"><span>From</span><b class="addr">${esc(short(wallet.address))}</b></div>
    <div class="kv"><span>Network</span><b>${NETS[net].name}</b></div>
    ${tk ? `<div class="kv"><span>Token</span><b class="addr">${esc(short(tk.a))}</b></div>` : ''}
    <div class="kv"><span>Max network fee</span><b>${esc(fmt(ethers.formatEther(fee)))} ${NETS[net].sym}</b></div>
    <button id="cf" data-c="sendNow()">Confirm</button><button class="alt" data-c="sendView()">Back</button><div id="m"></div>`, 'sendView()');
  } catch (e) { msg('m', 'Failed: ' + (e.shortMessage || e.message)); }
  finally { p.destroy(); }
}
async function waitTx(p, hash, ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { const r = await p.getTransactionReceipt(hash); if (r) return r; } catch {}
    await new Promise(r => setTimeout(r, 3000));
  }
  return null;
}
let stageSeq = 0;
function stg(sid, k, title, text, extra) {
  const e = $('#stg'); if (!e || e.dataset.sid !== String(sid)) return;
  e.dataset.k = k; $('#stt').textContent = title; $('#sts').textContent = text; $('#stx').innerHTML = extra || '';
  const run = k === 'send' || k === 'wait';
  $('#stb').textContent = run ? 'Back to wallet' : 'Done';
  $('#stn').style.display = run ? '' : 'none';
}
function steps(n) { return '<div class="steps">' + ['Signed', 'Broadcast', 'Confirmed'].map((x, i) => `<div class="${i < n ? 'on' : i === n ? 'cur' : ''}"><i></i>${x}</div>`).join('') + '</div>'; }
function fin() { temp.form = null; temp.ret = ''; tab = 'activity'; if (wallet) mainView(); else home(); }
async function sendNow() {
  if (temp.busy) return;
  if (loadTx()) {
    if (!temp.auth || Date.now() - temp.auth > 60000) return askTxPw();
    temp.auth = 0;
  }
  temp.busy = true;
  const sid = ++stageSeq, p = prov(), t = temp.tx, me = wallet.address, id = NETS[net].id, link = NETS[net].scan, what = t.amt + ' ' + t.sym + ' to ' + short(t.to);
  const view = h => link ? `<a class="vl" style="font-size:14px" href="${link}/tx/${h}" target="_blank" rel="noopener">View on explorer</a>` : '';
  const away = () => { const e = $('#stg'); return !e || e.dataset.sid !== String(sid); };
  show(`<div class="stage" id="stg" data-sid="${sid}" data-k="send"><div class="sico"><div class="ring"></div><svg class="arr" viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg><svg class="ck" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M15 27l8 8 14-16"/></svg><svg class="xx" viewBox="0 0 52 52"><circle cx="26" cy="26" r="24"/><path d="M18 18l16 16M34 18L18 34"/></svg></div><div class="st" id="stt"></div><div class="ss" id="sts"></div><div id="stx"></div><p class="note" id="stn">You can leave this screen. The transaction keeps going in the background.</p><button class="alt" id="stb" data-c="fin()">Back to wallet</button></div>`, null);
  stg(sid, 'send', 'Sending', what, steps(0));
  let tx;
  try {
    const w = wallet.connect(p);
    tx = t.tk ? await new ethers.Contract(t.tk.a, ERC20, w).transfer(t.to, t.v) : await w.sendTransaction({ to: t.to, value: t.v });
  } catch (e) {
    temp.busy = false;
    stg(sid, 'fail', 'Not sent', e.shortMessage || e.message, '<button data-c="sendView()">Try again</button>');
    if (away()) toast('Not sent: ' + (e.shortMessage || e.message));
    p.destroy(); return;
  }
  addHist({ h: tx.hash, c: id, f: me, to: t.to, a: t.amt, s: t.sym, t: Date.now(), st: 'pending' });
  renderHist();
  stg(sid, 'wait', 'Waiting for confirmation', what, steps(2) + view(tx.hash));
  let r = null;
  try { r = await waitTx(p, tx.hash, 180000); } catch {}
  p.destroy();
  if (!r) { stg(sid, 'pend', 'Still pending', 'It may confirm later. Check the Activity tab.', steps(2) + view(tx.hash)); if (away()) toast('Still pending: ' + what); return; }
  const ok = r.status === 1;
  setHist(tx.hash, ok ? 'ok' : 'fail'); renderHist();
  stg(sid, ok ? 'ok' : 'fail', ok ? 'Sent' : 'Transaction failed', what, (ok ? steps(3) : '') + view(tx.hash));
  if (away()) toast(ok ? 'Sent ' + t.amt + ' ' + t.sym + ' \u2713' : 'Transaction failed: ' + what);
  refresh();
}

function secView() {
  show(`<h1>Show secrets</h1><div class="card warn">Make sure nobody can see your screen.</div><div class="card">
  <label>Password</label><input id="pw" type="password" autocomplete="current-password">
  <button data-c="secShow()">Show</button><button class="alt" data-c="mainView()">Back</button><div id="m"></div></div>`);
}
async function secShow() {
  msg('m', 'Checking...', 1); await wait();
  try {
    const s = await openSeal(load(), $('#pw').value), w = mk(s);
    show(`<h1>Your secrets</h1><div class="card warn">Never share these or type them into any website. Hide this screen when done.</div>
    ${s.t === 'm' ? `<div class="words">${s.v.split(' ').map((x, i) => `<span><i>${i + 1}</i>${x}</span>`).join('')}</div>` : '<p class="note">This wallet was imported from a private key, so it has no phrase.</p>'}
    <div class="card"><label>Private key</label><div class="addr">${w.privateKey}</div></div>
    <button data-c="mainView()">Hide</button>`);
  } catch { msg('m', 'Wrong password.'); }
}

function backupView() {
  show(`<h1>Encrypted backup</h1><div class="card">
  <p class="note">This text is your wallet encrypted with your password. Save it somewhere safe. Restoring needs this text and the password. It does not replace your recovery phrase.</p>
  <textarea id="bk" readonly>${esc(JSON.stringify(load()))}</textarea>
  <button data-c="copyBackup(this)">Copy backup</button><button class="alt" data-c="mainView()">Back</button></div>`);
}
function restoreView() {
  sub('Restore backup', `<div class="card"><label>Paste the encrypted backup text</label><textarea id="bk"></textarea>
  <button data-c="restoreDo()">Restore</button><div id="m"></div></div>`, 'home()');
}
function restoreDo() {
  try {
    const r = JSON.parse($('#bk').value.trim());
    const ok = r.v === 1 && ethers.isAddress(r.address) && r.iter >= 100000 && r.iter <= 5000000 && r.salt && r.iv && r.ct;
    if (!ok) throw 0;
    if (!save({ v: 1, address: r.address, iter: r.iter, salt: r.salt, iv: r.iv, ct: r.ct })) return msg('m', 'Could not save in this browser.');
    unlockView();
  } catch { msg('m', 'This is not a valid backup.'); }
}

function wipeView() {
  show(`<h1>Remove wallet</h1><div class="card warn">This deletes the wallet from this device. You can only get it back with your recovery phrase or backup. Make sure you have one.</div>
  <div class="card"><label>Type DELETE to confirm</label><input id="c" autocapitalize="characters" autocomplete="off">
  <button class="danger alt" data-c="wipeDo()">Remove wallet</button><button data-c="mainView()">Cancel</button><div id="m"></div></div>`);
}
function wipeDo() {
  if ($('#c').value.trim() !== 'DELETE') return msg('m', 'Type DELETE exactly.');
  try { localStorage.removeItem(KEY); localStorage.removeItem(TXKEY); } catch {}
  wallet = null; clearTimeout(timer); home();
}


function copyBackup(el) { copyText($('#bk').value, el); }
function copyCard(a, el) { copyText(a, el.querySelector('span')); }
function moreHist() { histN += 20; renderHist(); }

/* ---- CSP-safe click handling: no inline scripts, no eval ---- */
const ACT = { addToken, addView, assetView, backupView, bsClear, bsNow, bsSave, closeSheet, copyBackup, copyCard, copyText, createNext, createStart, createView, fin, foundAdd, foundHide, foundView, histSetView, home, importDo, importView, lock, lookupToken, mainView, manageView, moreHist, netAddDo, netAddView, networksView, pasteTo, phraseView, pickNet, receiveFor, receiveView, restoreDo, restoreView, rmNet, rmToken, secShow, secView, sendFor, sendNow, sendPrep, sendView, setTab, txChange, txOff, txReset, txSet, txSubmit, txpwView, unlock, unlockView, verifyDone, verifyView, wipeDo, wipeView };
function run(code, el) {
  const m = /^([A-Za-z_]\w*)\(([\s\S]*)\)$/.exec(String(code).trim());
  if (!m || !Object.prototype.hasOwnProperty.call(ACT, m[1])) return;
  const args = [], rest = m[2].trim();
  if (rest) {
    const re = /\s*(?:'([^']*)'|"([^"]*)"|(-?\d+(?:\.\d+)?)|(this))\s*(?:,|$)/y;
    let p;
    while (re.lastIndex < rest.length && (p = re.exec(rest))) args.push(p[4] ? el : p[1] !== undefined ? p[1] : p[2] !== undefined ? p[2] : Number(p[3]));
    if (re.lastIndex < rest.length) return;
  }
  ACT[m[1]](...args);
}
document.addEventListener('click', e => { const el = e.target.closest('[data-c]'); if (el) run(el.dataset.c, el); });
document.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const el = e.target.closest('[data-enter]'); if (el) run(el.dataset.enter, el); });

if (!window.ethers) show('<h1>Dorax Wallet</h1><div class="card warn">The file ethers.umd.min.js is missing or could not be loaded. Upload it next to index.html (see get-libs.html), then reload.</div>');
else if (!window.crypto || !crypto.subtle) show('<h1>My Wallet</h1><div class="card warn">This page needs a secure connection (https). Open it from GitHub Pages or localhost.</div>');
else home();
