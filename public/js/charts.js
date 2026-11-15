// SI disclosure: written with AI assistance (Claude, Anthropic) under the direction of Arsh Bansal (Team Shrapnel); reviewed and tested by the team.
// Lightweight canvas scatter/line charts (no dependencies), HUD-styled.

export function scatterChart(canvas, { series, xLabel, yLabel, xFmt = v => v.toFixed(2), yFmt, title, logY = false, xRange }) {
  const dpr = window.devicePixelRatio || 1;
  const W = canvas.clientWidth, H = canvas.clientHeight;
  canvas.width = W * dpr; canvas.height = H * dpr;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const pad = { l: 58, r: 12, t: 22, b: 30 };
  const pts = series.flatMap(s => s.points).filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && (!logY || p.y > 0));
  ctx.font = '11px "JetBrains Mono", monospace';
  if (!pts.length) {
    ctx.fillStyle = '#6f8aa0'; ctx.fillText('No data yet', W / 2 - 35, H / 2);
    return null;
  }
  const tf = v => logY ? Math.log10(v) : v;
  let [x0, x1] = xRange || [Math.min(...pts.map(p => p.x)), Math.max(...pts.map(p => p.x))];
  const ys = pts.map(p => tf(p.y)).sort((a, b) => a - b);
  let y0 = ys[Math.floor(ys.length * 0.02)], y1 = ys[Math.ceil(ys.length * 0.98) - 1];
  if (x1 === x0) { x0 -= 1; x1 += 1; }
  if (y1 === y0) { y0 -= 1; y1 += 1; }
  const py = (y1 - y0) * 0.12; y0 -= py; y1 += py;
  const X = x => pad.l + (x - x0) / (x1 - x0) * (W - pad.l - pad.r);
  const Y = y => H - pad.b - (tf(y) - y0) / (y1 - y0) * (H - pad.t - pad.b);
  // grid
  ctx.strokeStyle = 'rgba(0,229,255,0.12)'; ctx.fillStyle = '#7fa6bd'; ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const yv = y0 + (y1 - y0) * i / 4, yy = H - pad.b - (H - pad.t - pad.b) * i / 4;
    ctx.beginPath(); ctx.moveTo(pad.l, yy); ctx.lineTo(W - pad.r, yy); ctx.stroke();
    const lab = logY ? (10 ** yv).toPrecision(2) : (yFmt ? yFmt(yv) : yv.toPrecision(3));
    ctx.fillText(lab, 4, yy + 4);
  }
  for (let i = 0; i <= 5; i++) {
    const xv = x0 + (x1 - x0) * i / 5, xx = X(xv);
    ctx.beginPath(); ctx.moveTo(xx, pad.t); ctx.lineTo(xx, H - pad.b); ctx.stroke();
    ctx.fillText(xFmt(xv), xx - 16, H - 10);
  }
  ctx.fillStyle = '#a9d8ea';
  if (title) ctx.fillText(title, pad.l, 14);
  ctx.save(); ctx.translate(12, H / 2 + 30); ctx.rotate(-Math.PI / 2); ctx.fillText(yLabel || '', 0, 0); ctx.restore();
  ctx.fillText(xLabel || '', W - pad.r - ctx.measureText(xLabel || '').width, H - pad.b - 6);
  // data
  for (const s of series) {
    const sp = s.points.filter(p => Number.isFinite(p.x) && Number.isFinite(p.y) && (!logY || p.y > 0));
    if (s.line && sp.length > 1) {
      ctx.strokeStyle = s.color; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.8;
      ctx.beginPath(); sp.forEach((p, i) => i ? ctx.lineTo(X(p.x), Y(p.y)) : ctx.moveTo(X(p.x), Y(p.y))); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    for (const p of sp) {
      if (Number.isFinite(p.err) && !logY) {
        ctx.strokeStyle = s.color; ctx.globalAlpha = 0.35;
        ctx.beginPath(); ctx.moveTo(X(p.x), Y(p.y - p.err)); ctx.lineTo(X(p.x), Y(p.y + p.err)); ctx.stroke();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = s.color;
      ctx.beginPath(); ctx.arc(X(p.x), Y(p.y), s.size || 2.6, 0, 7); ctx.fill();
    }
  }
  // legend
  let lx = W - pad.r;
  for (const s of [...series].reverse()) {
    if (!s.name) continue;
    const w = ctx.measureText(s.name).width + 18; lx -= w;
    ctx.fillStyle = s.color; ctx.fillRect(lx, 7, 8, 8);
    ctx.fillStyle = '#a9d8ea'; ctx.fillText(s.name, lx + 11, 15);
  }
  return { X, Y };
}
