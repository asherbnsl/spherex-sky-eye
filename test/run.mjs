// Unit tests for the pure-math parts (no network). Run: npm test
import assert from 'node:assert/strict';
import { parseCoords } from '../public/js/coords.js';
import { TanSip, offsetToWorld, worldToOffset } from '../public/js/wcs.js';
import { parseCards, dataSize } from '../public/js/fits.js';
import { parseCSV } from '../api/_lib.js';
import { toS3 } from '../api/sia.js';

globalThis.location = { hostname: 'test' };
const SX = await import('../public/js/spherex.js');

let n = 0; const t = (name, fn) => { fn(); n++; console.log('ok -', name); };

t('parse decimal coords', () => assert.deepEqual(parseCoords('133.7951 -7.2452'), { ra: 133.7951, dec: -7.2452 }));
t('parse challenge sexagesimal coords (WISE 0855)', () => {
  const c = parseCoords('08h55m10.831s -7d14m42.53s');
  assert.ok(Math.abs(c.ra - 133.795129) < 1e-5 && Math.abs(c.dec - -7.245147) < 1e-5);
});
t('parse colon coords with unicode minus', () => {
  const c = parseCoords('17:57:48.5 −04:41:36'); assert.ok(c.dec < 0 && Math.abs(c.ra - 269.452083) < 1e-5);
});
t('reject names', () => assert.equal(parseCoords("Barnard's Star"), null));

const hdr = { CRPIX1: 1020.5, CRPIX2: 1020.5, CRVAL1: 134.414675682, CRVAL2: -9.0062724739, CDELT1: -0.0017, CDELT2: 0.0017,
  PC1_1: 0.94, PC1_2: 0.34, PC2_1: -0.34, PC2_2: 0.94, A_ORDER: 2, B_ORDER: 2, A_2_0: 2e-6, B_0_2: -1.5e-6, AP_ORDER: 2, BP_ORDER: 2, AP_2_0: -2e-6, BP_0_2: 1.5e-6 };
t('TAN-SIP pixel->world->pixel round trip < 1e-6 px', () => {
  const w = new TanSip(hdr);
  for (const [x, y] of [[1, 1], [1020, 300], [2040, 2040], [500, 1800]]) {
    const [ra, dec] = w.pixToWorld(x, y); const [x2, y2] = w.worldToPix(ra, dec);
    assert.ok(Math.hypot(x - x2, y - y2) < 1e-6, `${x},${y} -> ${x2},${y2}`);
  }
});
t('gnomonic offsets round trip', () => {
  const [ra, dec] = offsetToWorld(359.99, 66.7, 120, -45); const [e, nn] = worldToOffset(359.99, 66.7, ra, dec);
  assert.ok(Math.abs(e - 120) < 1e-6 && Math.abs(nn + 45) < 1e-6);
});
t("Barnard's Star moves ~4.4' north 2000->2025.9", () => {
  const [ra, dec] = SX.propagate(269.452077, 4.693365, -801.551, 10362.394, 2000, 2025.9);
  const [, north] = worldToOffset(269.452077, 4.693365, ra, dec);
  assert.ok(Math.abs(north - 268.4) < 1, north);
});
t('FITS card parsing incl. HIERARCH and strings', () => {
  const card = s => s.padEnd(80, ' ');
  const text = [card("XTENSION= 'IMAGE   '"), card('NAXIS   =                    2'), card('NAXIS1  =                 2040'), card('NAXIS2  =                 2040'), card('BITPIX  =                  -32'), card("HIERARCH L2 N_GHOST = 1234 / count"), card('END')].join('');
  const p = parseCards(text);
  assert.equal(p.cards.XTENSION, 'IMAGE'); assert.equal(p.cards['L2 N_GHOST'], 1234); assert.ok(p.end);
  assert.equal(dataSize(p.cards), Math.ceil(2040 * 2040 * 4 / 2880) * 2880);
});
t('CSV with quoted JSON field', () => {
  const rows = parseCSV('a,b,c\n1,"{""aws"": {""key"":""x,y""}}",3\n');
  assert.equal(JSON.parse(rows[0].b).aws.key, 'x,y'); assert.equal(rows[0].c, '3');
});
t('epoch grouping splits 6-month passes', () => {
  const ims = [60800, 60801, 60980, 60990, 61151, 61174].map((t, i) => ({ t, det: 1 + (i % 6) }));
  const e = SX.groupEpochs(ims, 30); assert.equal(e.length, 3);
});
t('stack rejects a hot pixel and keeps S/N units', () => {
  const mk = v => ({ n: 1, data: Float32Array.of(v), bg: 0, sigma: 1 });
  const s = SX.stack([mk(1), mk(1), mk(1), mk(1000)]);
  assert.ok(Math.abs(s.data[0] - Math.sqrt(3)) < 1e-6, s.data[0]);
});
t('wavelength lookup bilinear', () => {
  const X = [1, 2040], Y = [1, 2040], V = [1, 0.1, 1, 0.1, 2, 0.2, 2, 0.2];
  // 2x2 grid with nx=2: V index k + 2*(ix + 2*iy)
  const r = SX.lambdaAt({ X, Y, V }, 1000, 1020.5); assert.ok(Math.abs(r.wl - 1.5) < 1e-3, r.wl);
});
t('IRSA SIA CSV with unescaped cloud_access JSON keeps earlier columns + S3 mapping', () => {
  const head = 'obs_id,energy_bandpassname,t_min,access_url,cloud_access,o_ucd,upload_row_id';
  const row = '2025W36_1A_0095_1,SPHEREx-D1,60919.419647,https://irsa.ipac.caltech.edu/ibe/data/spherex/dr1/level2/2025W36_1A/l2b-v27-2026-232/1/x.fits,{"aws": {"bucket_name": "nasa-irsa-spherex", "key":"dr1/level2/2025W36_1A/l2b-v27-2026-232/1/x.fits", "region": "us-east-1"}},,1';
  const [r] = parseCSV(head + '\n' + row + '\n' + row + '\n');
  assert.equal(r.t_min, '60919.419647');
  assert.equal(toS3(r.access_url), 'https://nasa-irsa-spherex.s3.amazonaws.com/dr1/level2/2025W36_1A/l2b-v27-2026-232/1/x.fits');
  assert.equal(parseCSV(head + '\n' + row + '\n' + row + '\n').length, 2);
});
import { readFileSync } from 'node:fs';
t('snapshot of challenge targets is complete and well-formed', () => {
  const snap = JSON.parse(readFileSync(new URL('../public/data/snapshot.json', import.meta.url)));
  const want = { barnard: 239, epsindib: 345, wise0855: 258, rwaur: 226, rdra: 413 };
  for (const [k, n] of Object.entries(want)) assert.equal(snap.targets[k].length, n, k);
  const [obs, det, tt, ver] = snap.targets.barnard.find(r => r[0] === '2025W33_2C_0321_1' && r[1] === 6);
  const week = obs.split('_').slice(0, 2).join('_');
  assert.equal(`dr1/level2/${week}/l2b${ver}/${det}/level2_${obs}D${det}_spx_l2b${ver}.fits`, 'dr1/level2/2025W33_2C/l2b-v27-2026-228/6/level2_2025W33_2C_0321_1D6_spx_l2b-v27-2026-228.fits');
  assert.ok(Math.abs(tt - 60902.86472) < 1e-4);
});
console.log(`\n${n} tests passed`);
