# BLINKSCOPE — blink the infrared sky, catch what moves

**Team Shrapnel** · Arsh Bansal · **NASA Space Apps Challenge 2026** · Challenge: **Planet X and SPHEREx**, *display images of the sky from the SPHEREx mission so anyone can quickly see how they change over time.*

### ▶ Try it: **https://spherex-sky-eye.vercel.app**

Opens on Barnard's Star with a 30-second guided tour. No install, no login.

▶ **30-second demo video:** https://youtu.be/_S3L5-DITko

Pluto was found in 1930 by flipping between two photographs of the same patch of sky on a *blink comparator* and noticing one dot that moved. BLINKSCOPE does the same thing with NASA's SPHEREx all-sky infrared survey, in a browser, for any position you type.

Enter an object name or coordinates. BLINKSCOPE finds every SPHEREx exposure that covers that spot, reads only the small patch around it from NASA's public SPHEREx archive, aligns the patches north-up and plays them like a short video, one frame per six-month sky pass. Anything that jumps between frames is moving.

---

## What it does

| Feature | How |
|---|---|
| **Guided tour** | A 7-step spotlight tour starts on the first visit (replay with ▶ TOUR) and walks through search, flipbook, modes, spectra and flagging. |
| **SIMPLE / PRO modes** | Opens in SIMPLE mode (flipbook, PASSES / DIFF / IR COLOUR, detectors, spectrum). PRO MODE adds every control: exposure-by-exposure playback, contrast, colour looks, catalogues, contamination flags, frame data, event log. |
| **3D sky globe with smooth flight** | Picking a target flies the globe there: zoom out, glide along the great circle, dive in. |
| **Flipbook of any sky position** | RA/Dec (decimal or sexagesimal) or any object name (CDS Sesame). Frames are aligned on a fixed sky grid, so moving sources visibly jump. |
| **PASSES / EXPOSURES / DIFF / IR COLOUR / STACK ALL** | Play one frame per survey pass, or every exposure; subtract passes (red = now, blue = before); false-colour composite (D1+D2 / D3+D4 / D5+D6); or add everything for the deepest image. |
| **Detector stacking (D1–D6)** | Each of SPHEREx's 6 detector arrays covers part of 0.75–5.0 µm. Toggle any combination; exposures are noise-normalised and combined with outlier rejection (removes hot pixels, cosmic rays, streaks). |
| **Spectra on the fly** | Click a source: aperture photometry on every loaded exposure, each at its exact wavelength from the SPHEREx spectral WCS (linear variable filter), so you see a 0.75–5 µm spectrum per pass. |
| **WISE 2010 reference frame** | The flipbook opens with an unWISE 4.6 µm image from the original 2010 WISE mission, giving a ~15-year baseline like WiseView. Barnard's Star jumps 2.7′; WISE 0855 about 2′. |
| **Light curves** | Median flux per detector per pass, so variable stars (RW Aur, R Dra) stand out. Saturated bright stars switch to PSF-wing photometry (flagged as relative). |
| **User-chosen field of view** | 2′–15′. Bigger fields track faster movers but download more (the estimate is shown in the log). |
| **Gaia DR3 overlay with proper motion** | Every Gaia source is moved to each frame's date, and fast movers (>0.2″/yr) are flagged red with motion vectors. |
| **AllWISE overlay** | Where things were around 2010, for a ~15-year motion baseline. |
| **Sky layers** | Aladin Lite in orthographic (globe) projection with the SPHEREx all-sky maps (colour + D1–D6), AllWISE, 2MASS and DSS layers; unreachable map servers are skipped automatically. |
| **Per-pixel contamination flags** | Toggle *contamination*: the FLAGS extension (RICE-compressed) is decoded in the browser, flagged pixels (ghosts, crosstalk, persistence, hot pixels, streaks...) are drawn in red and left out of the stacks. |
| **Flag a mover** | ⚑ FLAG files a pre-filled public GitHub issue with the position and a link back to the view, so anyone can review candidates. |
| **GIF export** | Save the whole flipbook as an animated GIF to share. |
| **Contamination metadata** | FRAME DATA tab lists every exposure in the frame with UTC, detector, wavelength range, exposure time, the share of the detector flagged (ghosts, crosstalk, persistence, snowballs…) and a link to the original IRSA file. |
| **URL queries and embedding** | `?ra=133.7951&dec=-7.2452&fov=360&det=56&mode=diff`, or `?target=barnard`. **EMBED** copies an `<iframe>` (`&embed=1` shows only the flipbook). |
| **Easy to update** | New data releases: add the collection name to `collections` in `public/js/config.js` (DR1 + the newest Quick Release, QR3, are both loaded: data through Sept 2026). Everything else (epochs, frames, spectra) is computed live from what the archive returns. |

### Challenge test targets (one-click chips)

Barnard's Star · Epsilon Indi B · WISE 0855−0714 · RW Aurigae · R Draconis, plus a bonus: Luhman 16, the closest brown-dwarf pair to the Sun, itself found by blinking WISE images. Names are resolved live, with proper motion, and the target's predicted track across the passes is drawn on the flipbook.

---

## How it works

```
browser ──/api/sia──▶ tiny proxy ──▶ NASA/IPAC IRSA SIA (list exposures)      [IRSA sends no CORS headers]
browser ──HTTP Range─▶ s3://nasa-irsa-spherex (NASA AWS Open Data)            [direct, no proxy]
           reads ~45 KB of headers + only the image rows around the target
           → TAN-SIP WCS → reproject to common north-up grid → stack / diff
browser ──/api/catalog▶ proxy ──▶ ESA Gaia DR3 TAP, IRSA AllWISE TAP
browser ──────────────▶ CDS Sesame (names), CDS HiPS (globe layers)
```

* **No full downloads.** A SPHEREx spectral image is a 65 MB multi-extension FITS file. BLINKSCOPE reads the header and just the rows it needs with HTTP Range requests (about 0.5 MB per exposure at a 5′ field), straight from NASA's public AWS bucket. IRSA's cutout service is not needed (it was returning "Server busy" during development).
* **Astrometry in the browser:** full TAN-SIP world coordinate system with Newton-refined inverse, then bilinear resampling onto a fixed gnomonic grid.
* **Wavelength per pixel:** read from each detector's `WCS-WAVE` lookup table (cached per detector).
* **Survey passes:** exposures are clustered by time gaps of more than 30 days; SPHEREx maps the whole sky every ~6 months.
* **Resilience:** the archive search is retried, cached at the CDN edge (served stale if IRSA is down), and the five challenge targets also ship with a saved archive listing (`public/data/snapshot.json`, taken 2026-11-14) as a last-resort fallback. All-sky globe layers are probed at start-up and switch to working mirrors automatically (CDS, ESA ESASky, CSIRO).
* **Validated:** WISE 0855−0714, the coldest known brown dwarf, is detected at S/N 10–14 in each SPHEREx pass exactly at its proper-motion-predicted position.
* **Security:** all remote and user text is escaped before display, a strict Content-Security-Policy and standard security headers are set, the proxy only forwards validated numeric queries to fixed hosts and is rate-limited per IP. No accounts, cookies or personal data.
* Plain ES modules with no build step and no framework. Three small serverless functions for the proxy.

## Run it

```bash
node server.mjs          # http://localhost:8080   (Node 18+)
npm test                 # 16 unit tests: WCS, coordinate parsing, FITS cards, CSV quirks, stacking, photometry, wavelength lookup, RICE decoder, snapshot
```

Deploy: import the repo into Vercel (framework preset "Other"). `public/` is served statically and `api/*.js` become serverless functions.

## Repository layout

```
public/index.html        UI shell
public/css/app.css       HUD styling
public/js/config.js      data collections, presets, layers  ← update for new releases
public/js/app.js         controller: search, download, flipbook, overlays, analysis
public/js/spherex.js     archive search, range-read cutouts, reprojection, stacking, photometry
public/js/fits.js        minimal FITS header/HDU reader over HTTP Range
public/js/wcs.js         TAN-SIP WCS
public/js/rice.js        RICE_1 decoder for the compressed FLAGS images
public/js/gif.js         animated GIF encoder
public/js/wise.js        WISE 2010 reference frame (unWISE cutouts)
public/js/tour.js        guided tour
public/data/snapshot.json saved archive listing for the 5 challenge targets (fallback)
public/js/render.js      stretches and colour maps
public/js/charts.js      spectrum / light-curve charts
api/sia.js               proxy: IRSA SIA → compact JSON
api/catalog.js           proxy: Gaia DR3 (ESA) / AllWISE (IRSA) cone search
api/resolve.js           proxy fallback for CDS Sesame
server.mjs               local server (static + API)
test/run.mjs             unit tests
```

## Team

**Team Shrapnel**: Arsh Bansal ([@asherbnsl](https://github.com/asherbnsl)).

## Data, resources and tools used

**NASA data and resources**
* SPHEREx spectral images (Level 2, DR1 and the newest Quick Release QR3) — NASA/IPAC Infrared Science Archive (IRSA) SIA service and NASA AWS Open Data bucket `nasa-irsa-spherex`.
* IRSA SPHEREx tutorial notebooks: FITS structure, cutouts, spectral WCS.
* WiseView (byw.tools/wiseview): inspiration for the flipbook concept.
* AllWISE Source Catalog (NASA WISE mission, via IRSA TAP) and AllWISE / unWISE HiPS maps.
* unWISE coadds of NASA WISE data (Lang 2014; Meisner, Lang & Schlegel 2017), via the unwise.me cutout service, used for the WISE 2010 frame.

**Space agency partner data**
* ESA Gaia DR3 (`gaiadr3.gaia_source`, ESA Gaia Archive TAP), with NASA MAST's copy of Gaia DR3 (the challenge's linked resource) as automatic backup.
* ESA ESASky HiPS mirrors (AllWISE, 2MASS colour) for the sky globe.

**Other resources**
* SPHEREx QR2 all-sky HiPS maps (D1–D6 and colour) produced and hosted by CDS Strasbourg (ODbL).
* Aladin Lite v3 (CDS Strasbourg), CDS Sesame name resolver.
* 2MASS and DSS2 HiPS (via CDS, ESA ESASky and CSIRO CASDA mirrors).
* Fonts: JetBrains Mono, Orbitron (Google Fonts, OFL).
* CFITSIO (NASA HEASARC): reference Rice (RICE_1) compression algorithm, ported for the flags decoder.
* Tools: Node.js, Vercel, GitHub, jsDelivr; astropy (creating the decoder's test file only).
* UI design language (tactical HUD, sensor "looks", event log, shareable view links) inspired by **God's Eye View** by Bilawal Sidhu (MIT License, https://github.com/bilawalsidhu/gods-eye-view). No code from that project is included.

## AI assistance (disclosure)

The project concept (a God's-Eye-View-style viewer for SPHEREx), feature choices, target selection and testing direction are by Team Shrapnel (Arsh Bansal). An AI coding assistant (Claude, by Anthropic) was used to write and debug much of the code and this README and it suggested the project name and some feature ideas. All AI-assisted code was reviewed and tested by the team. Every source file starts with an SI-disclosure line, and the web page carries an `ai-assistance` meta tag. No AI-generated imagery, video or audio is used; every sky image is real NASA/ESA data.

## Licence

MIT. See `LICENSE`. Not affiliated with or endorsed by NASA; no NASA logos or insignia are used.
