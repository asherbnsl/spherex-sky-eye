// SI disclosure: written with AI assistance (Claude, Anthropic) under the direction of Arsh Bansal (Team Shrapnel); reviewed and tested by the team.
// Interactive guided tour: spotlights one part of the screen at a time. The
// page stays clickable; steps with a "try it" action move on by themselves
// when the visitor does it (NEXT still works too).
const STEPS = [
  { sel: ['#search', '#presets'], text: '<b>Start here.</b> Type any star name or sky coordinates (RA Dec) in the <b>search box</b> and press ENGAGE, or use one of the <b>challenge targets</b> below it.', try: 'Try it: click a target, e.g. Barnard\'s Star.', waitFor: '#presets button, #search button[type=submit]' },
  { sel: '#stage', text: 'This is the <b>flipbook</b>: the same patch of sky on different dates. The first frame is WISE in 2010; the rest are SPHEREx passes, about 6 months apart. A dot that <b>jumps</b> between frames is moving.' },
  { sel: '#player', text: '<b>Play, pause or step</b> through time. The bright marks on the timeline are the dates.', try: 'Try it: press ▶ or ◀ to step.', waitFor: '#prev, #next, #play' },
  { sel: '#modes', text: '<b>PASSES</b> plays the frames. <b>DIFF</b> shows only what changed: red is where something is now, blue is where it was. <b>IR COLOUR</b> shows how hot things are.', try: 'Try it: click DIFF.', waitFor: '#modes button[data-mode=diff], #modes button[data-mode=rgb]' },
  { sel: '#stage', text: '<b>Click any star</b> in the flipbook: its infrared spectrum (0.75–5 µm) and how its brightness changes over time appear in the panel under the globe.', try: 'Try it: click a bright star.', waitFor: '#fb-ovl' },
  { sel: '#flag', text: 'Spotted a mover? <b>FLAG</b> it to report it publicly, or save the flipbook as a <b>GIF</b>.' },
  { sel: '#mode-btn', text: 'Want every control: detectors, contrast, contamination flags, catalogues? Switch to <b>PRO MODE</b>. Replay this tour any time with <b>▶ TOUR</b>.' },
];

let i = 0, armed = null;
const $ = s => document.querySelector(s);
const open = () => !$('#tour').classList.contains('hidden');

function onPageClick(e) {
  if (!open() || !armed || !e.target || !e.target.closest) return;
  if (e.target.closest(armed) && !e.target.closest('#tour-box')) {
    armed = null;
    $('#tour-try').textContent = '✓ Nice!';
    setTimeout(() => { if (open()) next(); }, 900);
  }
}
function next() { if (i < STEPS.length - 1) { i++; place(); } else end(); }

function place() {
  const step = STEPS[i];
  const els = [].concat(step.sel).map(q => $(q)).filter(e => e && e.getClientRects().length);
  const el = els[0];
  if (!el) { if (i < STEPS.length - 1) { i++; return place(); } return end(); }
  armed = step.waitFor || null;
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setTimeout(() => {
    const rs = els.map(e => e.getBoundingClientRect());
    const r = { left: Math.min(...rs.map(x => x.left)), top: Math.min(...rs.map(x => x.top)), right: Math.max(...rs.map(x => x.right)), bottom: Math.max(...rs.map(x => x.bottom)) };
    r.width = r.right - r.left; r.height = r.bottom - r.top;
    const pad = 6;
    Object.assign($('#tour-spot').style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + 2 * pad + 'px', height: r.height + 2 * pad + 'px' });
    const box = $('#tour-box'), bw = 330, bh = box.offsetHeight || 190;
    let top = r.bottom + 14, left = Math.min(Math.max(10, r.left), innerWidth - bw - 10);
    if (top + bh > innerHeight - 10) top = r.top - bh - 14;
    if (top < 10) { top = Math.max(10, Math.min(innerHeight - bh - 10, r.top + 10)); left = r.left > bw + 30 ? r.left - bw - 16 : Math.min(innerWidth - bw - 10, r.right + 16); }
    Object.assign(box.style, { top: top + 'px', left: left + 'px' });
  }, 280);
  $('#tour-step').textContent = `STEP ${i + 1} OF ${STEPS.length}`;
  $('#tour-text').innerHTML = step.text;
  $('#tour-try').textContent = step.try || '';
  $('#tour-try').style.display = step.try ? 'block' : 'none';
  $('#tour-back').style.visibility = i ? 'visible' : 'hidden';
  $('#tour-next').textContent = i === STEPS.length - 1 ? 'DONE ✓' : (step.try ? 'SKIP ▶' : 'NEXT ▶');
}
function end() {
  armed = null;
  $('#tour').classList.add('hidden');
  try { localStorage.setItem('blinkscope.toured.v2', '1'); } catch { /* storage unavailable */ }
}
export function startTour() {
  i = 0;
  $('#help')?.classList.add('hidden');
  $('#tour').classList.remove('hidden');
  place();
}
export function hasToured() {
  try { return localStorage.getItem('blinkscope.toured.v2') === '1'; } catch { return false; }
}
export function wireTour() {
  $('#tour-next').onclick = next;
  $('#tour-back').onclick = () => { if (i > 0) { i--; place(); } };
  $('#tour-skip').onclick = end;
  document.addEventListener('click', onPageClick, true);
  document.addEventListener('submit', () => { if (armed && armed.includes('#search')) onPageClick({ target: $('#search button[type=submit]') }); }, true);
  addEventListener('resize', () => { if (open()) place(); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && open()) end(); });
}
