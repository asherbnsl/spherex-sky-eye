// BLINKSCOPE — main controller: search, download, flipbook, overlays, analysis.
import { CONFIG } from './config.js';
import * as SX from './spherex.js';
import { drawFrame, LOOKS, frameToDataURL } from './render.js';
import { scatterChart } from './charts.js';
import { offsetToWorld, worldToOffset } from './wcs.js';
import { parseCoords } from './coords.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const EPOCH_COLORS = ['#00e5ff', '#ffb000', '#39ff88', '#ff3b5c', '#c77dff', '#ffffff'];

const state = {
  target: null,          // {name, ra, dec, pmra, pmdec, epoch, otype}
  center: null,          // fixed [ra, dec] of the flipbook grid
  fov: CONFIG.defaultFov, n: 64,
  images: [], epochs: [], cuts: [], frames: [], frameIdx: 0,
  playing: true, fps: 2, mode: 'epochs', dets: new Set([1, 2, 3, 4, 5, 6]),
  look: 'ironbow', lo: -1, hi: 20, autoHi: true, quality: 6,
  ov: { target: true, gaia: true, wise: false, movers: true },
  gaia: [], allwise: [], probe: null, token: 0, aladin: null,
};

// ---------------------------------------------------------------- utilities
function log(msg, cls = '') {
  const el = document.createElement('div');
  if (cls) el.className = cls;
  const t = new Date().toTimeString().slice(0, 8);
  el.innerHTML = `<b>[${t}]</b> ${msg}`;
  const box = $('#log-lines');
  box.prepend(el);
  while (box.children.length > 40) box.lastChild.remove();
}
const fmtDate = mjd => SX.mjdToDate(mjd).toISOString().slice(0, 10);
function hms(ra) { const h = ra / 15; const H = Math.floor(h), M = Math.floor((h - H) * 60), S = ((h - H) * 60 - M) * 60; return `${String(H).padStart(2, '0')}h${String(M).padStart(2, '0')}m${S.toFixed(2).padStart(5, '0')}s`; }
function dms(dec) { const s = dec < 0 ? '−' : '+'; const a = Math.abs(dec); const D = Math.floor(a), M = Math.floor((a - D) * 60), S = ((a - D) * 60 - M) * 60; return `${s}${String(D).padStart(2, '0')}°${String(M).padStart(2, '0')}′${S.toFixed(1).padStart(4, '0')}″`; }

async function resolveName(name) {
  const preset = CONFIG.presets.find(p => p.key === name || p.label.toLowerCase() === name.toLowerCase() || p.query.toLowerCase() === name.toLowerCase());
  const query = preset ? preset.query : name;
  try {
    // CDS Sesame allows browser requests directly
    const r = await fetch('https://cds.unistra.fr/cgi-bin/nph-sesame/-oxp/SNV?' + encodeURIComponent(query));
    const xml = await r.text();
    const g = tag => { const m = xml.match(new RegExp(`<${tag}>\\s*([^<]+)</${tag}>`)); return m ? m[1].trim() : null; };
    const ra = parseFloat(g('jradeg')), dec = parseFloat(g('jdedeg'));
    if (Number.isFinite(ra)) {
      return { name: preset ? preset.label : (g('oname') || name), ra, dec, pmra: parseFloat(g('pmRA')) || 0, pmdec: parseFloat(g('pmDE')) || 0, epoch: 2000, otype: g('otype'), preset };
    }
  } catch (e) { log('Sesame unreachable, trying proxy', 'err'); }
  try {
    const r = await fetch(`${CONFIG.apiBase}/api/resolve?name=${encodeURIComponent(query)}`);
    if (r.ok) { const j = await r.json(); return { ...j, name: preset ? preset.label : j.oname || name, preset }; }
  } catch { /* fall through */ }
  if (preset) return { name: preset.label, ...preset.fallback, preset };
  throw new Error('Could not resolve "' + name + '"');
}

async function pool(items, limit, fn) {
  let i = 0;
  const run = async () => { while (i < items.length) { const k = i++; await fn(items[k], k); } };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
}

// Position of the target at a given MJD (proper motion applied)
function targetAt(mjd) {
  const t = state.target; if (!t) return null;
  return SX.propagate(t.ra, t.dec, t.pmra, t.pmdec, t.epoch, SX.mjdToYear(mjd));
}
function worldToGrid(ra, dec) {
  const [e, n] = worldToOffset(state.center[0], state.center[1], ra, dec);
  const scale = state.fov / state.n, c = (state.n - 1) / 2;
  return [c - e / scale, c - n / scale];
}
function gridToWorld(i, j) {
  const scale = state.fov / state.n, c = (state.n - 1) / 2;
  return offsetToWorld(state.center[0], state.center[1], (c - i) * scale, (c - j) * scale);
}

// ---------------------------------------------------------------- URL state
function readURL() {
  const p = new URLSearchParams(location.search);
  if (p.has('embed')) document.body.classList.add('embed');
  if (p.has('fov')) state.fov = Math.min(1800, Math.max(60, +p.get('fov') || CONFIG.defaultFov));
  if (p.has('det')) state.dets = new Set([...p.get('det')].map(Number).filter(d => d >= 1 && d <= 6));
  if (p.has('mode')) state.mode = p.get('mode');
  if (p.has('look') && LOOKS[p.get('look')]) state.look = p.get('look');
  if (p.has('q')) state.quality = +p.get('q') || 6;
  if (p.has('ra') && p.has('dec')) return { ra: +p.get('ra'), dec: +p.get('dec'), name: p.get('name') || null };
  if (p.has('target')) return { name: p.get('target') };
  return null;
}
function viewURL(embed = false) {
  const p = new URLSearchParams();
  const t = state.target;
  if (t) { p.set('ra', t.ra.toFixed(6)); p.set('dec', t.dec.toFixed(6)); if (t.name) p.set('name', t.name); }
  if (t && t.preset) { p.delete('ra'); p.delete('dec'); p.delete('name'); p.set('target', t.preset.key); }
  p.set('fov', state.fov); p.set('det', [...state.dets].sort().join('')); p.set('mode', state.mode); p.set('look', state.look);
  if (state.quality !== 6) p.set('q', state.quality);
  if (embed) p.set('embed', '1');
  return location.origin + location.pathname + '?' + p.toString();
}
function syncURL() { history.replaceState(null, '', viewURL()); }

// ---------------------------------------------------------------- globe
async function probe(url, ms = 5000) {
  try {
    const r = await Promise.race([fetch(url + '/properties'), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms))]);
    return r.ok;
  } catch { return false; }
}
async function initGlobe() {
  const sel = $('#layer');
  // probe every layer's mirrors in parallel; keep the first that answers
  const layers = await Promise.all(CONFIG.allSkyLayers.map(async l => {
    for (const u of l.urls) if (await probe(u)) return { ...l, url: u };
    return { ...l, url: null };
  }));
  layers.forEach((l, i) => { const o = new Option(l.name + (l.url ? '' : ' (offline)'), i); o.disabled = !l.url; sel.add(o); });
  const first = layers.findIndex(l => l.url);
  if (first < 0) { log('All-sky map servers unreachable — globe disabled, flipbook still works', 'err'); return; }
  sel.value = first;
  if (first > 0) log('SPHEREx all-sky maps (CDS) unreachable — globe using ' + layers[first].name, 'err');
  let A;
  try { A = (await import(CONFIG.aladinModule)).default; await A.init; }
  catch (e) { log('Sky globe library failed to load — flipbook still works', 'err'); return; }
  window.A = A;
  state.aladin = A.aladin('#sky', {
    survey: layers[first].url, fov: 200, projection: 'SIN', cooFrame: 'ICRSd',
    showReticle: true, reticleColor: '#00e5ff', showLayersControl: false, showGotoControl: false,
    showFullscreenControl: false, showShareControl: false, showFrame: false, showZoomControl: false,
    showSimbadPointerControl: false, showProjectionControl: false, showCooGridControl: false, showContextMenu: true,
    target: '266.4 -29.0',
  });
  state.footprint = A.graphicOverlay({ color: '#ffb000', lineWidth: 2 });
  state.aladin.addOverlay(state.footprint);
  log('Sky globe online · ' + layers[first].name, 'ok');
  let ra = 266.4;
  state.orbit = setInterval(() => { if (state.target) return clearInterval(state.orbit); ra = (ra + 0.25) % 360; state.aladin.gotoRaDec(ra, -10); }, 50);
  if (state.target && state.center) flyGlobe();
  sel.onchange = () => { const l = layers[+sel.value]; if (l.url) state.aladin.setBaseImageLayer(A.imageHiPS(l.url, { name: l.name })); };
  $('#aladin-gaia').onchange = e => {
    if (!state.target) return;
    if (e.target.checked) {
      state.aladinGaia = A.catalogFromVizieR('I/355/gaiadr3', `${state.center[0]} ${state.center[1]}`, state.fov / 3600, { name: 'Gaia DR3', sourceSize: 10, color: '#39ff88', onClick: 'showTable' });
      state.aladin.addCatalog(state.aladinGaia);
    } else if (state.aladinGaia) { state.aladinGaia.hide(); }
  };
}
function flyGlobe() {
  const al = state.aladin; if (!al || !state.center || !state.footprint) return;
  clearInterval(state.orbit);
  const [ra, dec] = state.center;
  try { al.animateToRaDec ? al.animateToRaDec(ra, dec, 2) : al.gotoRaDec(ra, dec); } catch { al.gotoRaDec(ra, dec); }
  setTimeout(() => { try { al.zoomToFoV ? al.zoomToFoV(state.fov / 3600 * 5, 2) : al.setFoV(state.fov / 3600 * 5); } catch { al.setFoV(state.fov / 3600 * 5); } }, 300);
  state.footprint.removeAll();
  const h = state.fov / 2;
  const corners = [[h, h], [-h, h], [-h, -h], [h, -h]].map(([e, n]) => offsetToWorld(ra, dec, e, n));
  state.footprint.add(window.A.polygon(corners, { color: '#ffb000' }));
}

// ---------------------------------------------------------------- main flow
async function engage(input) {
  const token = ++state.token;
  state.cuts = []; state.frames = []; state.frameIdx = 0; state.probe = null; state.gaia = []; state.allwise = [];
  $('#fb-empty').classList.remove('hidden'); $('#fb-empty').textContent = 'Locking target…';
  setProgress(0, 'resolving target');
  try {
    let t;
    if (input.target) {
      t = input.target;
    } else if (input.ra !== undefined && input.dec !== undefined) {
      t = { name: input.name || `${hms(input.ra)} ${dms(input.dec)}`, ra: input.ra, dec: input.dec, pmra: 0, pmdec: 0, epoch: 2000, otype: 'coordinates' };
    } else {
      const c = parseCoords(input.name);
      t = c ? { name: input.name, ...c, pmra: 0, pmdec: 0, epoch: 2000, otype: 'coordinates' } : await resolveName(input.name);
    }
    if (token !== state.token) return;
    state.target = t;
    if (t.preset && !input.keepView) { state.fov = t.preset.fov; state.dets = new Set(t.preset.dets); }
    $('#fov').value = String(state.fov);
    if (![...$('#fov').options].some(o => o.value === String(state.fov))) $('#fov').add(new Option(`FOV ${(state.fov / 60).toFixed(1)}′`, state.fov, true, true));
    renderDets();
    showTarget();
    log(`TARGET LOCK ▸ ${t.name} (${t.ra.toFixed(4)}, ${t.dec.toFixed(4)})`, 'ok');

    // search near the target's present-day position
    const now = SX.propagate(t.ra, t.dec, t.pmra, t.pmdec, t.epoch, 2025.9);
    setProgress(0.03, 'querying NASA/IPAC archive (IRSA)…');
    const images = (await SX.searchImages(now[0], now[1])).filter(im => im.s3);
    if (token !== state.token) return;
    if (!images.length) throw new Error('No SPHEREx exposures cover this position yet');
    state.images = images;
    state.epochs = SX.groupEpochs(images, CONFIG.epochGapDays);
    log(`IRSA ▸ ${images.length} exposures · ${state.epochs.length} survey passes`);

    // the grid stays fixed on the sky (that is what makes motion visible);
    // centre it on where the target is in the middle of the SPHEREx data
    const tMean = images.reduce((s, x) => s + x.t, 0) / images.length;
    state.center = targetAt(tMean);
    state.n = Math.max(48, Math.min(160, Math.round(state.fov / CONFIG.pixelScale * 1.5)));
    showCoverage();
    flyGlobe();
    syncURL();
    loadCatalogs(token);
    await download(token);
  } catch (e) {
    if (token !== state.token) return;
    log('ERROR ▸ ' + e.message, 'err');
    setProgress(0, e.message);
    $('#fb-empty').textContent = e.message;
  }
}

function estimateBytes() {
  const rows = state.fov / CONFIG.pixelScale * 1.2 + 5;
  return rows * 2040 * 4 + 46080;
}

async function download(token) {
  const dets = [1, 2, 3, 4, 5, 6]; // fetch all detectors; display filter is instant
  const wanted = state.mode === 'rgb' ? dets : [...state.dets];
  state.inflight ||= new Set();
  if (state.inflightToken !== token) { state.inflight = new Set(); state.inflightToken = token; }
  const plan = SX.planDownloads(state.epochs, wanted, Math.ceil(state.quality / wanted.length))
    .filter(im => !state.inflight.has(im.id) && !state.cuts.some(c => c.im.id === im.id));
  plan.forEach(im => state.inflight.add(im.id));
  if (!plan.length) return;
  const est = plan.length * estimateBytes() / 1e6;
  log(`AWS ▸ reading ${plan.length} patches (~${est.toFixed(0)} MB) from s3://nasa-irsa-spherex`);
  let done = 0, failed = 0;
  const t0 = performance.now();
  setProgress(0.05, `downloading 0/${plan.length}`);
  await pool(plan, CONFIG.concurrency, async im => {
    if (token !== state.token) return;
    try {
      const cut = await SX.loadCutout(im, state.center[0], state.center[1], state.fov, state.n);
      if (token !== state.token) return;
      if (cut) { state.cuts.push(cut); scheduleRebuild(); }
    } catch (e) { failed++; state.inflight.delete(im.id); if (failed < 4) log(`skip ${im.obs} D${im.det}: ${e.message}`, 'err'); }
    done++;
    setProgress(0.05 + 0.95 * done / plan.length, `downloading ${done}/${plan.length}`);
  });
  if (token !== state.token) return;
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  setProgress(1, `${state.cuts.length} exposures loaded in ${secs}s${failed ? ` · ${failed} failed` : ''}`);
  log(`READY ▸ ${state.cuts.length} exposures in ${secs}s`, 'ok');
  if (!state.probe) setProbe(null);
}

async function loadCatalogs(token) {
  const [ra, dec] = state.center;
  const r = state.fov / 3600 * 0.75;
  for (const cat of ['gaia', 'allwise']) {
    fetch(`${CONFIG.apiBase}/api/catalog?cat=${cat}&ra=${ra}&dec=${dec}&r=${r.toFixed(4)}`)
      .then(x => x.ok ? x.json() : Promise.reject(new Error('HTTP ' + x.status)))
      .then(j => {
        if (token !== state.token) return;
        state[cat] = j.sources;
        const fast = cat === 'gaia' ? j.sources.filter(s => Math.hypot(s.pmra, s.pmdec) > 200).length : 0;
        log(`${cat === 'gaia' ? 'ESA Gaia DR3' : 'NASA AllWISE'} ▸ ${j.count} sources${fast ? ` · ${fast} high proper motion` : ''}`);
        draw();
      })
      .catch(e => log(`${cat} overlay unavailable (${e.message})`, 'err'));
  }
}

// ---------------------------------------------------------------- frames
let rebuildPending = false;
function scheduleRebuild() {
  if (rebuildPending) return;
  rebuildPending = true;
  setTimeout(() => { rebuildPending = false; buildFrames(); }, 250);
}

function buildFrames() {
  const cuts = state.cuts.filter(c => state.dets.has(c.im.det));
  const byEpoch = state.epochs.map(e => cuts.filter(c => c.im.epoch === e.index));
  const meta = (list, e) => ({ cuts: list, mjd: list.length ? list.reduce((s, c) => s + c.mjd, 0) / list.length : e?.tMid, epoch: e?.index });
  const label = (e, list) => `PASS ${e.index + 1} · ${fmtDate(e.tStart)} → ${fmtDate(e.tEnd)} · ${list.length} exp`;
  let frames = [];
  if (state.mode === 'exposures') {
    frames = [...cuts].sort((a, b) => a.mjd - b.mjd).map(c => ({
      kind: 'mono', n: c.n, data: c.data.map(v => (v - c.bg) / c.sigma),
      label: `${fmtDate(c.mjd)} · D${c.im.det} · ${c.im.wlMin.toFixed(2)}–${c.im.wlMax.toFixed(2)} µm`, ...meta([c], state.epochs[c.im.epoch]),
    }));
  } else if (state.mode === 'epochs') {
    frames = state.epochs.map((e, i) => byEpoch[i].length ? { kind: 'mono', ...SX.stack(byEpoch[i]), label: label(e, byEpoch[i]), ...meta(byEpoch[i], e) } : null).filter(Boolean);
  } else if (state.mode === 'deep') {
    if (cuts.length) frames = [{ kind: 'mono', ...SX.stack(cuts), label: `ALL PASSES STACKED · ${cuts.length} exposures`, ...meta(cuts) }];
  } else if (state.mode === 'diff') {
    const st = state.epochs.map((e, i) => byEpoch[i].length ? SX.stack(byEpoch[i]) : null);
    const avg = st.map(s => s && { ...s, data: s.data.map(v => v / Math.sqrt(s.count)) });
    frames = state.epochs.map((e, i) => {
      if (!avg[i]) return null;
      const others = avg.filter((s, j) => s && j !== i);
      if (!others.length) return null;
      const data = avg[i].data.map((v, k) => { let s = 0, m = 0; for (const o of others) if (Number.isFinite(o.data[k])) { s += o.data[k]; m++; } return m ? (v - s / m) * Math.sqrt(byEpoch[i].length) : NaN; });
      return { kind: 'diff', n: avg[i].n, data, label: `PASS ${i + 1} − OTHERS · red = now, blue = before`, ...meta(byEpoch[i], e) };
    }).filter(Boolean);
  } else if (state.mode === 'rgb') {
    const all = state.cuts;
    frames = state.epochs.map(e => {
      const pick = ds => { const l = all.filter(c => c.im.epoch === e.index && ds.includes(c.im.det)); return l.length ? SX.stack(l) : null; };
      const r = pick([5, 6]), g = pick([3, 4]), b = pick([1, 2]);
      const any = r || g || b; if (!any) return null;
      const list = all.filter(c => c.im.epoch === e.index);
      return { kind: 'rgb', n: any.n, r, g, b, label: `PASS ${e.index + 1} · B:D1+D2 G:D3+D4 R:D5+D6`, ...meta(list, e) };
    }).filter(Boolean);
  }
  state.frames = frames;
  if (state.autoHi) autoStretch();
  if (state.frameIdx >= frames.length) state.frameIdx = 0;
  $('#fb-empty').classList.toggle('hidden', frames.length > 0);
  if (!frames.length && state.target) $('#fb-empty').textContent = 'Loading SPHEREx exposures…';
  renderTimeline();
  draw();
  if (state.probe) updateAnalysis();
}

// One white level for the whole sequence so blinking compares like with like
const sliderToHi = v => 3 * 10 ** (v / 33);
const hiToSlider = h => Math.round(33 * Math.log10(h / 3));
function autoStretch() {
  const vals = [];
  for (const f of state.frames) {
    const chans = f.kind === 'rgb' ? [f.r, f.g, f.b].filter(Boolean).map(c => c.data) : [f.data];
    for (const d of chans) for (let k = 0; k < d.length; k += 3) if (Number.isFinite(d[k])) vals.push(f.kind === 'diff' ? Math.abs(d[k]) : d[k]);
  }
  if (vals.length < 20) return;
  vals.sort((a, b) => a - b);
  const p = vals[Math.floor(vals.length * 0.995)];
  state.hi = Math.max(8, Math.min(3000, p * 1.2));
  $('#hi').value = hiToSlider(state.hi);
}

// ---------------------------------------------------------------- drawing
function draw() {
  const f = state.frames[state.frameIdx];
  const img = $('#fb-img'), ovl = $('#fb-ovl');
  if (!f) { img.getContext('2d').clearRect(0, 0, img.width, img.height); ovl.getContext('2d').clearRect(0, 0, ovl.width, ovl.height); return; }
  drawFrame(img, f, { lo: state.lo, hi: state.hi, look: state.look });
  $('#fb-label').textContent = f.label;
  $('#fb-corner').innerHTML = `${state.frameIdx + 1}/${state.frames.length}<br>${(state.fov / 60).toFixed(1)}′ · N↑ E←`;
  drawOverlay(f);
  $$('#timeline .tick').forEach((el, i) => el.classList.toggle('cur', i === state.frameIdx));
  if ($('#meta') && !$('#meta').classList.contains('hidden')) renderMeta();
}

function drawOverlay(f) {
  const cv = $('#fb-ovl');
  const W = cv.clientWidth, dpr = window.devicePixelRatio || 1;
  cv.width = W * dpr; cv.height = W * dpr;
  const ctx = cv.getContext('2d'); ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const s = W / state.n;
  const P = (ra, dec) => { const [i, j] = worldToGrid(ra, dec); return [(i + 0.5) * s, (j + 0.5) * s]; };
  const year = SX.mjdToYear(f.mjd);
  ctx.lineWidth = 1.2; ctx.font = '10px "JetBrains Mono", monospace';

  if (state.ov.wise) {
    ctx.strokeStyle = 'rgba(255,176,0,0.8)';
    for (const w of state.allwise) { const [x, y] = P(w.ra, w.dec); if (x < 0 || y < 0 || x > W || y > W) continue; ctx.strokeRect(x - 5, y - 5, 10, 10); }
  }
  if (state.ov.gaia || state.ov.movers) {
    for (const g of state.gaia) {
      const pm = Math.hypot(g.pmra, g.pmdec);
      const fast = pm > 200;
      if (!state.ov.gaia && !(fast && state.ov.movers)) continue;
      const [ra, dec] = SX.propagate(g.ra, g.dec, g.pmra, g.pmdec, g.epoch, year);
      const [x, y] = P(ra, dec); if (x < -20 || y < -20 || x > W + 20 || y > W + 20) continue;
      ctx.strokeStyle = fast && state.ov.movers ? '#ff3b5c' : 'rgba(57,255,136,0.75)';
      ctx.beginPath(); ctx.arc(x, y, fast ? 9 : 5, 0, 7); ctx.stroke();
      if (fast && state.ov.movers) {
        const [ra2, dec2] = SX.propagate(g.ra, g.dec, g.pmra, g.pmdec, g.epoch, year + 1);
        const [x2, y2] = P(ra2, dec2);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (x2 - x) * 3, y + (y2 - y) * 3); ctx.stroke();
        ctx.fillStyle = '#ff3b5c'; ctx.fillText(`${(pm / 1000).toFixed(2)}″/yr`, x + 11, y - 6);
      }
    }
  }
  if (state.ov.target && state.target && (state.target.pmra || state.target.pmdec)) {
    // predicted track across all passes
    ctx.strokeStyle = 'rgba(0,229,255,0.6)'; ctx.setLineDash([4, 4]);
    ctx.beginPath();
    state.epochs.forEach((e, i) => { const [x, y] = P(...targetAt(e.tMid)); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
    ctx.stroke(); ctx.setLineDash([]);
    state.epochs.forEach(e => { const [x, y] = P(...targetAt(e.tMid)); ctx.fillStyle = 'rgba(0,229,255,0.7)'; ctx.fillRect(x - 1.5, y - 1.5, 3, 3); });
  }
  if (state.ov.target && state.target) {
    const [x, y] = P(...targetAt(f.mjd));
    ctx.strokeStyle = '#00e5ff'; ctx.lineWidth = 1.5;
    const r = 12, g = 6;
    ctx.beginPath();
    ctx.moveTo(x - r - g, y); ctx.lineTo(x - g, y); ctx.moveTo(x + g, y); ctx.lineTo(x + r + g, y);
    ctx.moveTo(x, y - r - g); ctx.lineTo(x, y - g); ctx.moveTo(x, y + g); ctx.lineTo(x, y + r + g);
    ctx.stroke();
    ctx.fillStyle = '#00e5ff'; ctx.fillText(state.target.name.slice(0, 24), x + 14, y + 22);
  }
  if (state.probe) {
    const [x, y] = [(state.probe.i + 0.5) * s, (state.probe.j + 0.5) * s];
    ctx.strokeStyle = '#ffb000'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 9 / (state.fov / state.n) * s, 0, 7); ctx.stroke();
  }
  // scale bar (1 arcmin) + compass
  const bar = 60 / (state.fov / state.n) * s;
  ctx.strokeStyle = '#fff'; ctx.fillStyle = '#fff'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(10, W - 14); ctx.lineTo(10 + bar, W - 14); ctx.stroke();
  ctx.fillText('1′', 12, W - 18);
}

function renderTimeline() {
  const tl = $('#timeline'); tl.innerHTML = '';
  const fr = state.frames; if (!fr.length) return;
  const t0 = Math.min(...fr.map(f => f.mjd)), t1 = Math.max(...fr.map(f => f.mjd));
  const pos = m => t1 === t0 ? 50 : 3 + 94 * (m - t0) / (t1 - t0);
  fr.forEach((f, i) => {
    const el = document.createElement('div'); el.className = 'tick'; el.style.left = pos(f.mjd) + '%';
    el.title = f.label; el.onclick = ev => { ev.stopPropagation(); state.frameIdx = i; draw(); };
    tl.appendChild(el);
  });
  const seen = new Set();
  state.epochs.forEach(e => {
    const lab = fmtDate(e.tMid).slice(0, 7); if (seen.has(lab)) return; seen.add(lab);
    const el = document.createElement('div'); el.className = 'lab'; el.style.left = pos(e.tMid) + '%'; el.textContent = lab; tl.appendChild(el);
  });
}

// ---------------------------------------------------------------- panels
function showTarget() {
  const t = state.target;
  $('#tgt-name').textContent = t.name;
  $('#t-ra').textContent = `${hms(t.ra)}  ${t.ra.toFixed(5)}°`;
  $('#t-dec').textContent = `${dms(t.dec)}  ${t.dec.toFixed(5)}°`;
  const pm = Math.hypot(t.pmra, t.pmdec);
  $('#t-pm').textContent = pm ? `${(pm / 1000).toFixed(3)}″/yr (${t.pmra.toFixed(0)}, ${t.pmdec.toFixed(0)} mas/yr)` : 'none / unknown';
  $('#t-type').textContent = (t.otype || '—') + (t.preset ? ` · ${t.preset.note}` : '');
}
function showCoverage() {
  const rows = state.epochs.map(e => {
    const c = d => e.images.filter(im => im.det === d).length;
    return `<tr><td>P${e.index + 1} ${fmtDate(e.tStart).slice(0, 7)}</td>${[1, 2, 3, 4, 5, 6].map(d => `<td>${c(d)}</td>`).join('')}</tr>`;
  }).join('');
  const span = (state.images.at(-1).t - state.images[0].t) / 365.25;
  $('#coverage').innerHTML = `<table><tr><th>pass</th>${[1, 2, 3, 4, 5, 6].map(d => `<th>D${d}</th>`).join('')}</tr>${rows}</table>
    <div class="muted" style="margin-top:4px">${state.images.length} exposures · ${span.toFixed(2)} yr baseline · ${CONFIG.collections.join(', ')}</div>`;
}
function setProgress(f, txt) { $('#bar').style.width = (f * 100).toFixed(0) + '%'; $('#prog-txt').textContent = txt; }

function renderDets() {
  const box = $('#dets'); box.innerHTML = '';
  for (const { d, wl, color } of CONFIG.detectors) {
    const b = document.createElement('button');
    b.innerHTML = `<span style="color:${color}">D${d}</span><small>${wl}</small>`;
    b.title = `Detector ${d}: ${wl} µm`;
    b.classList.toggle('on', state.dets.has(d));
    b.onclick = () => toggleDet(d);
    box.appendChild(b);
  }
}
function toggleDet(d) {
  if (state.dets.has(d) && state.dets.size > 1) state.dets.delete(d); else state.dets.add(d);
  renderDets(); syncURL();
  const missing = state.epochs.length && !state.cuts.some(c => c.im.det === d);
  if (missing && state.dets.has(d)) download(state.token);
  buildFrames();
}
function setMode(m) {
  state.mode = m;
  $$('#modes button').forEach(b => b.classList.toggle('on', b.dataset.mode === m));
  syncURL();
  if (m === 'rgb' && state.epochs.length) download(state.token);
  buildFrames();
}

// ---------------------------------------------------------------- analysis
let analysisTab = 'spec';
function setProbe(ij) {
  if (!state.center) return;
  if (ij) {
    state.probe = { i: ij[0], j: ij[1], target: false };
  } else {
    const [i, j] = worldToGrid(...targetAt(state.images.reduce((s, x) => s + x.t, 0) / state.images.length));
    state.probe = { i, j, target: true };
  }
  const [ra, dec] = state.probe.target ? state.center : gridToWorld(state.probe.i, state.probe.j);
  $('#probe-txt').innerHTML = `${state.probe.target ? 'Target' : 'Probe'} at ${ra.toFixed(5)}, ${dec.toFixed(5)}${state.probe.target && (state.target.pmra || state.target.pmdec) ? ' · aperture follows proper motion' : ''} · 9″ aperture`;
  draw();
  updateAnalysis();
}

let analysisSeq = 0;
async function updateAnalysis() {
  if (!state.probe || !state.cuts.length) return;
  const seq = ++analysisSeq;
  const pr = state.probe;
  const pts = await Promise.all(state.cuts.map(async c => {
    let i = pr.i, j = pr.j, ra, dec;
    if (pr.target) { [ra, dec] = targetAt(c.mjd); [i, j] = worldToGrid(ra, dec); }
    else[ra, dec] = gridToWorld(i, j);
    const { flux, err } = SX.apertureFlux(c, i, j, 9);
    let wl = (c.im.wlMin + c.im.wlMax) / 2;
    try { wl = (await SX.wavelengthAt(c.im, ra, dec)).wl; } catch { /* fall back to band centre */ }
    return { c, flux, err, wl };
  }));
  if (seq !== analysisSeq) return;
  state.analysisPts = pts;
  drawAnalysis();
}
function drawAnalysis() {
  const pts = state.analysisPts || [];
  const cv = $('#chart');
  if (analysisTab === 'spec') {
    const series = state.epochs.map((e, k) => ({
      name: `P${k + 1} ${fmtDate(e.tMid).slice(0, 7)}`, color: EPOCH_COLORS[k % EPOCH_COLORS.length],
      points: pts.filter(p => p.c.im.epoch === k).map(p => ({ x: p.wl, y: p.flux, err: p.err })),
    }));
    scatterChart(cv, { series, xLabel: 'wavelength µm', yLabel: 'flux mJy (approx.)', xRange: [0.7, 5.05], xFmt: v => v.toFixed(1), title: 'SPECTRUM · each dot = one SPHEREx exposure' });
  } else if (analysisTab === 'lc') {
    const series = CONFIG.detectors.map(({ d, color }) => {
      const per = state.epochs.map(e => {
        const l = pts.filter(p => p.c.im.det === d && p.c.im.epoch === e.index && Number.isFinite(p.flux)).map(p => p.flux).sort((a, b) => a - b);
        return l.length ? { x: SX.mjdToYear(e.tMid), y: l[l.length >> 1] } : null;
      }).filter(Boolean);
      return { name: `D${d}`, color, line: true, size: 3.5, points: per };
    });
    scatterChart(cv, { series, xLabel: 'year', yLabel: 'median flux mJy', xFmt: v => v.toFixed(2), title: 'LIGHT CURVE · per detector, per survey pass' });
  }
}
function renderMeta() {
  const f = state.frames[state.frameIdx];
  if (!f) { $('#meta').innerHTML = '<span class="muted">No frame.</span>'; return; }
  const keys = ['GHOST', 'GHOST_FPA', 'XTALK', 'PERSIST', 'SNOWBALL', 'BLOOM', 'HALO', 'TRANSIENT', 'OUTLIER', 'HOT'];
  const rows = f.cuts.slice().sort((a, b) => a.mjd - b.mjd).map(c => {
    const fl = keys.map(k => c.flagCounts['L2 N_' + k] || 0);
    const total = fl.reduce((a, b) => a + b, 0);
    const pct = total / (2040 * 2040) * 100;
    return `<tr><td>${(c.dateObs || fmtDate(c.mjd)).replace('T', ' ').slice(0, 16)}</td><td>D${c.im.det}</td><td>${c.im.wlMin.toFixed(2)}–${c.im.wlMax.toFixed(2)}</td><td>${c.im.exp.toFixed(0)}s</td><td class="${pct > 2 ? 'warn' : ''}">${pct.toFixed(2)}%</td><td title="${keys.map((k, i) => `${k}: ${fl[i]}`).join('\n')}">${keys.filter((k, i) => fl[i] > 20000).join(' ') || '—'}</td><td><a href="${c.im.url}" target="_blank" rel="noopener">${c.im.obs}</a></td></tr>`;
  }).join('');
  $('#meta').innerHTML = `<table><tr><th>UTC</th><th>det</th><th>µm</th><th>exp</th><th title="Share of the detector flagged for contamination (header counts)">flagged</th><th>main flags</th><th>IRSA file</th></tr>${rows}</table>
  <div class="muted" style="margin-top:4px">Flag shares come from each exposure's FLAGS summary (whole detector). Hover for counts. Files open from NASA/IPAC IRSA.</div>`;
}

// ---------------------------------------------------------------- player
function tick() {
  if (state.playing && state.frames.length > 1) { state.frameIdx = (state.frameIdx + 1) % state.frames.length; draw(); }
  setTimeout(tick, 1000 / state.fps);
}

// ---------------------------------------------------------------- wiring
function wire() {
  $('#app-name').textContent = CONFIG.appName;
  document.title = `${CONFIG.appName} — blink the infrared sky`;
  const pre = $('#presets');
  for (const p of CONFIG.presets) {
    const b = document.createElement('button');
    b.innerHTML = `<b>◎</b> ${p.label}`; b.title = p.note;
    b.onclick = () => { $('#q').value = p.label; engage({ name: p.key }); };
    pre.appendChild(b);
  }
  $('#search').onsubmit = e => { e.preventDefault(); const v = $('#q').value.trim(); if (v) engage({ name: v, keepView: true }); };
  $('#fov').onchange = e => { state.fov = +e.target.value; if (state.target) engage({ target: state.target, keepView: true }); };
  $('#quality').value = String(state.quality);
  $('#quality').onchange = e => { state.quality = +e.target.value; syncURL(); if (state.epochs.length) download(state.token); };
  $$('#modes button').forEach(b => b.onclick = () => setMode(b.dataset.mode));
  setMode(state.mode);
  for (const [k, v] of Object.entries(LOOKS)) $('#look').add(new Option('LOOK · ' + v.name, k));
  $('#look').value = state.look;
  $('#look').onchange = e => { state.look = e.target.value; syncURL(); draw(); };
  $('#lo').oninput = e => { state.lo = +e.target.value; draw(); };
  $('#hi').oninput = e => { state.hi = sliderToHi(+e.target.value); state.autoHi = false; $('#auto').checked = false; draw(); };
  $('#auto').onchange = e => { state.autoHi = e.target.checked; if (state.autoHi) autoStretch(); draw(); };
  $('#pix').onchange = e => $('#fb-img').classList.toggle('pix', e.target.checked);
  $('#o-target').onchange = e => { state.ov.target = e.target.checked; draw(); };
  $('#o-gaia').onchange = e => { state.ov.gaia = e.target.checked; draw(); };
  $('#o-wise').onchange = e => { state.ov.wise = e.target.checked; draw(); };
  $('#o-movers').onchange = e => { state.ov.movers = e.target.checked; draw(); };
  $('#play').onclick = () => { state.playing = !state.playing; $('#play').textContent = state.playing ? '❚❚' : '▶︎'; };
  $('#prev').onclick = () => { state.playing = false; $('#play').textContent = '▶︎'; state.frameIdx = (state.frameIdx - 1 + state.frames.length) % Math.max(1, state.frames.length); draw(); };
  $('#next').onclick = () => { state.playing = false; $('#play').textContent = '▶︎'; state.frameIdx = (state.frameIdx + 1) % Math.max(1, state.frames.length); draw(); };
  $('#speed').oninput = e => { state.fps = +e.target.value; $('#speed-txt').textContent = state.fps + ' fps'; };
  $('#timeline').onclick = e => {
    if (!state.frames.length) return;
    const r = e.currentTarget.getBoundingClientRect(); const x = (e.clientX - r.left) / r.width;
    const t0 = Math.min(...state.frames.map(f => f.mjd)), t1 = Math.max(...state.frames.map(f => f.mjd));
    const m = t0 + (x - 0.03) / 0.94 * (t1 - t0);
    let best = 0; state.frames.forEach((f, i) => { if (Math.abs(f.mjd - m) < Math.abs(state.frames[best].mjd - m)) best = i; });
    state.frameIdx = best; draw();
  };
  $('#fb-ovl').onclick = e => {
    if (!state.center) return;
    const r = e.currentTarget.getBoundingClientRect();
    const i = (e.clientX - r.left) / r.width * state.n - 0.5, j = (e.clientY - r.top) / r.height * state.n - 0.5;
    setProbe([i, j]);
  };
  $('#fb-ovl').ondblclick = () => setProbe(null);
  $$('#atabs button').forEach(b => b.onclick = () => {
    analysisTab = b.dataset.tab;
    $$('#atabs button').forEach(x => x.classList.toggle('on', x === b));
    $('#chart').classList.toggle('hidden', analysisTab === 'meta');
    $('#meta').classList.toggle('hidden', analysisTab !== 'meta');
    if (analysisTab === 'meta') renderMeta(); else drawAnalysis();
  });
  $('#share').onclick = () => copy(viewURL(), 'Link copied');
  $('#embed').onclick = () => copy(`<iframe src="${viewURL(true)}" width="640" height="820" style="border:0" loading="lazy" title="SPHEREx flipbook"></iframe>`, 'Embed code copied');
  $('#save-png').onclick = () => {
    const f = state.frames[state.frameIdx]; if (!f) return;
    const c = frameToDataURL(f, { lo: state.lo, hi: state.hi, look: state.look, pixelated: $('#pix').checked }, 768);
    const ctx = c.getContext('2d'); ctx.drawImage($('#fb-ovl'), 0, 0, 768, 768);
    ctx.fillStyle = '#fff'; ctx.font = '14px monospace'; ctx.fillText(`${state.target?.name || ''} · ${f.label}`, 10, 20);
    ctx.fillText('NASA SPHEREx data via IRSA/AWS', 10, 758);
    const a = document.createElement('a'); a.href = c.toDataURL('image/png'); a.download = `spherex_${(state.target?.name || 'sky').replace(/\W+/g, '_')}_${state.frameIdx + 1}.png`; a.click();
  };
  $('#help-btn').onclick = () => $('#help').classList.toggle('hidden');
  $('#help-close').onclick = () => $('#help').classList.add('hidden');
  window.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' && e.target.type !== 'range') return;
    if (e.key === ' ') { e.preventDefault(); $('#play').click(); }
    else if (e.key === 'ArrowLeft') $('#prev').click();
    else if (e.key === 'ArrowRight') $('#next').click();
    else if (/^[1-6]$/.test(e.key)) toggleDet(+e.key);
    else if (e.key.toLowerCase() === 'm') { const ms = ['epochs', 'exposures', 'diff', 'rgb', 'deep']; setMode(ms[(ms.indexOf(state.mode) + 1) % ms.length]); }
  });
  window.addEventListener('resize', () => { draw(); drawAnalysis(); });
}
function copy(text, msg) {
  navigator.clipboard?.writeText(text).then(() => log(msg, 'ok'), () => prompt('Copy:', text));
}

// ---------------------------------------------------------------- boot
const initial = readURL();
wire();
renderDets();
initGlobe();
log(`${CONFIG.appName} online · collections: ${CONFIG.collections.join(', ')}`, 'ok');
tick();
if (initial) {
  if (initial.ra !== undefined && Number.isFinite(initial.ra)) engage({ ra: initial.ra, dec: initial.dec, name: initial.name, keepView: true });
  else if (initial.name) { $('#q').value = initial.name; engage({ name: initial.name, keepView: true }); }
} else {
  $('#help').classList.remove('hidden');
}
