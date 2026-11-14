// 30-second guided tour: spotlights one part of the screen at a time.
const STEPS = [
  { sel: ['#search', '#presets'], text: '<b>Start here.</b> Type any star name or sky coordinates (RA Dec) in the <b>search box</b> and press ENGAGE, or click one of the <b>challenge targets</b> below it.' },
  { sel: '#stage', text: 'This is the <b>flipbook</b>: the same patch of sky on different dates. The first frame is WISE in 2010; the rest are SPHEREx passes, about 6 months apart. A dot that <b>jumps</b> between frames is moving.' },
  { sel: '#player', text: '<b>Play, pause or step</b> through time. The bright marks on the timeline are the dates.' },
  { sel: '#modes', text: '<b>PASSES</b> plays the frames. <b>DIFF</b> shows only what changed: red is where something is now, blue is where it was. <b>IR COLOUR</b> shows how hot things are.' },
  { sel: '#analysis', text: '<b>Click any star</b> in the flipbook to measure its infrared spectrum (0.75–5 µm) and how its brightness changes over time.' },
  { sel: '#flag', text: 'Spotted a mover? <b>FLAG</b> it to report it publicly, or save the flipbook as a <b>GIF</b>.' },
  { sel: '#mode-btn', text: 'Want every control: detectors, contrast, contamination flags, catalogues? Switch to <b>PRO MODE</b>. Replay this tour any time with <b>▶ TOUR</b>.' },
];

let i = 0;
const $ = s => document.querySelector(s);

function place() {
  const step = STEPS[i];
  const els = [].concat(step.sel).map(q => $(q)).filter(e => e && e.getClientRects().length);
  const el = els[0];
  if (!el) { if (i < STEPS.length - 1) { i++; return place(); } return end(); }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => {
    const rs = els.map(e => e.getBoundingClientRect());
    const r = { left: Math.min(...rs.map(x => x.left)), top: Math.min(...rs.map(x => x.top)), right: Math.max(...rs.map(x => x.right)), bottom: Math.max(...rs.map(x => x.bottom)) };
    r.width = r.right - r.left; r.height = r.bottom - r.top;
    const pad = 6;
    const spot = $('#tour-spot');
    Object.assign(spot.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + 2 * pad + 'px', height: r.height + 2 * pad + 'px' });
    const box = $('#tour-box'), bw = 330, bh = box.offsetHeight || 170;
    let top = r.bottom + 14, left = Math.min(Math.max(10, r.left), innerWidth - bw - 10);
    if (top + bh > innerHeight - 10) top = r.top - bh - 14;
    if (top < 10) { top = Math.max(10, Math.min(innerHeight - bh - 10, r.top + 10)); left = r.left > bw + 30 ? r.left - bw - 16 : Math.min(innerWidth - bw - 10, r.right + 16); }
    Object.assign(box.style, { top: top + 'px', left: left + 'px' });
  }, 280);
  $('#tour-step').textContent = `STEP ${i + 1} OF ${STEPS.length}`;
  $('#tour-text').innerHTML = step.text;
  $('#tour-back').style.visibility = i ? 'visible' : 'hidden';
  $('#tour-next').textContent = i === STEPS.length - 1 ? 'DONE ✓' : 'NEXT ▶';
}
function end() {
  $('#tour').classList.add('hidden');
  try { localStorage.setItem('blinkscope.toured', '1'); } catch { /* storage unavailable */ }
}
export function startTour() {
  i = 0;
  $('#help')?.classList.add('hidden');
  $('#tour').classList.remove('hidden');
  place();
}
export function hasToured() {
  try { return localStorage.getItem('blinkscope.toured') === '1'; } catch { return false; }
}
export function wireTour() {
  $('#tour-next').onclick = () => { if (i < STEPS.length - 1) { i++; place(); } else end(); };
  $('#tour-back').onclick = () => { if (i > 0) { i--; place(); } };
  $('#tour-skip').onclick = end;
  addEventListener('resize', () => { if (!$('#tour').classList.contains('hidden')) place(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#tour').classList.contains('hidden')) end(); });
}
