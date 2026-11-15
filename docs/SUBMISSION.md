# Space Apps project page — text to paste

> Everything must stay in English. Test every link in a private/incognito window before submitting.

## Challenge
Planet X and SPHEREx

## Project Name
BLINKSCOPE — Blink the infrared sky. Catch what moves.

## High-Level Project Summary
BLINKSCOPE is a free web tool that turns NASA's SPHEREx all-sky infrared survey into a flipbook for any spot on the sky. Type an object name or RA/Dec and BLINKSCOPE finds every SPHEREx exposure covering that position, reads only the small patch needed straight from NASA's public SPHEREx archive, lines the patches up and plays them one frame per six-month sky pass, the same blink technique that found Pluto. Moving brown dwarfs, nearby stars and asteroids jump between frames, and variable stars brighten and fade. Users can stack SPHEREx's six detectors for cleaner images, subtract passes to highlight motion, view false-colour infrared, and click any source to build its 0.75–5 µm spectrum and light curve on the fly. With so much new SPHEREx data, discoveries need many eyes, and BLINKSCOPE gives anyone with a browser a way to look.

## Link to Project Demo
<YouTube link of the 30-second video recorded on Sunday (Public or Unlisted)>

## Link to Final Project
https://spherex-sky-eye.vercel.app · Code: https://github.com/asherbnsl/spherex-sky-eye

## Detailed Project Description
**What it does**
- Enter a name (resolved with proper motion) or coordinates; choose a field of view from 2′ to 15′.
- PASSES mode plays one frame per SPHEREx survey pass (May 2025, late 2025, spring 2026 and onward), opening with a 2010 WISE image for a 15-year baseline: Barnard's Star jumps 2.7′. EXPOSURES plays every single exposure.
- DIFF subtracts each pass from the others: red marks where a source is now, blue where it was.
- IR COLOUR maps SPHEREx's six detector arrays to blue/green/red; STACK ALL adds everything for the deepest image.
- D1–D6 toggles combine any detectors with noise-weighting and outlier rejection to improve signal-to-noise.
- Click a source to get its spectrum (each exposure measured at its exact wavelength from SPHEREx's spectral calibration) and its light curve per detector.
- Gaia DR3 stars are drawn at their predicted position for each frame's date, and fast movers are flagged; AllWISE shows positions around 2010.
- A 3D sky globe shows SPHEREx, WISE, 2MASS and optical all-sky maps.
- Per-pixel contamination flags can be overlaid and are excluded from stacks; ⚑ FLAG files a public report of a candidate mover; the flipbook exports as a GIF.
- A frame-data table shows each exposure's date, detector, wavelength range and contamination-flag summary, with links to the original archive files.
- The whole view is encoded in the URL, so it can be shared or embedded in other sites (`?target=wise0855&mode=diff`).

**How it works**
SPHEREx images are 65 MB files. BLINKSCOPE never downloads them whole: it reads the header and only the image rows around the target using HTTP Range requests on NASA's public AWS copy of SPHEREx (about 0.5 MB per exposure). The browser then applies the full TAN-SIP astrometric solution and resamples every exposure onto one fixed north-up grid, so real motion on the sky shows up as motion in the flipbook. A small proxy is used only for the archive search and catalogue queries (those services do not allow direct browser access). New data releases are picked up by adding one collection name to a config file.

**Tested on** Barnard's Star, Epsilon Indi B, WISE 0855−0714, RW Aurigae and R Draconis (one-click buttons in the app). WISE 0855, the coldest known brown dwarf, is detected at S/N 10–14 in every SPHEREx pass at its predicted moving position.

**What the prototype demonstrates today**
- Works live on real NASA data for all five challenge targets (plus Luhman 16), in any browser.
- Detects WISE 0855−0714, the coldest known brown dwarf, at S/N 10–14 in every SPHEREx pass at its predicted moving position.
- Shows 15 years of motion (WISE 2010 → SPHEREx 2026), spectra, light curves, contamination flags; keeps working when NASA's archive search is down.

**What is future work (not built yet)**
- Automatic sky-wide search for movers (comparing SPHEREx with Gaia and WISE everywhere).
- Asteroid and comet mode using predicted orbits.
- A moderated public list of community flags (today, flags open public GitHub issues).
- Calibrated photometry for very bright, saturated stars (today it is relative).

**Benefits / goals** Anyone, without software or astronomy training, can inspect SPHEREx data for movers and variables within seconds, and share or embed what they find, in the spirit of Backyard Worlds-style citizen science.

**Tools** JavaScript (ES modules, no framework), HTML/CSS canvas, Node.js serverless functions (Vercel), Aladin Lite v3, IRSA SIA/TAP, ESA Gaia TAP, CDS Sesame and HiPS.

## NASA Data
How each NASA resource is used (problem → what the resource provides → how it shapes BLINKSCOPE):

| Resource | Problem | What it provides | How it shapes the solution |
|---|---|---|---|
| **SPHEREx Level 2 spectral images** (DR1 + newest Quick Release QR3) | New moving and variable objects hide among a billion sources | All-sky images every ~6 months in 102 infrared bands (0.75–5 µm) | The frames of the flipbook, the detector stacks, the DIFF images and the on-the-fly spectra |
| **NASA/IPAC IRSA archive (SIA search)** | Which of millions of exposures cover a given spot? | Lists every SPHEREx exposure over a position with its date, detector and wavelength | Finds 200–400 exposures per target and groups them into 6-month passes |
| **NASA AWS Open Data copy of SPHEREx** (`nasa-irsa-spherex`) | 65 MB per file is too slow for a browser | Public files that allow partial (range) reads | We read only ~0.5 MB around the target, so a flipbook loads in ~3 s with nothing to install |
| **IRSA SPHEREx tutorial notebooks** | Understanding the file format | File structure, astrometry (WCS), per-pixel wavelength table and quality flags | Our in-browser FITS/WCS reader, wavelength lookup and contamination-flag decoder |
| **NASA WISE / AllWISE** (catalogue, and unWISE coadds of WISE data) | One year of SPHEREx data shows only small motions | 2010 infrared images and positions | The WISE 2010 first frame gives a 15-year baseline: Barnard's Star jumps 2.7′ |
| **WiseView** | How should the public look at time-series sky data? | A proven flipbook interface used for hundreds of discoveries | The model for BLINKSCOPE's blink/flipbook design |
| **CFITSIO** (NASA HEASARC) | SPHEREx quality flags are Rice-compressed | The reference Rice (RICE_1) algorithm | Our in-browser decoder that reads per-pixel contamination flags |

## Space Agency Partner Data and Other References
- ESA Gaia DR3 (ESA Gaia Archive), with NASA MAST's copy of Gaia DR3 (linked in the challenge resources) as automatic backup.
- ESA ESASky HiPS mirrors (AllWISE, 2MASS) for the sky globe; CSIRO CASDA DSS2 mirror.
- CDS Strasbourg: SPHEREx all-sky HiPS maps, Aladin Lite v3, Sesame name resolver, 2MASS/DSS2 HiPS.
- God's Eye View by Bilawal Sidhu (MIT) — UI design inspiration only, no code reused.
- Google Fonts: JetBrains Mono, Orbitron (OFL).
- Tools: Node.js, Vercel (hosting and serverless functions), GitHub, jsDelivr CDN; astropy (used only to create a test file for the flag decoder); Google Chrome headless (rendering the backup slide deck).
- unWISE: Lang (2014); Meisner, Lang & Schlegel (2017).

## Use of Super Intelligence (SI)
Yes. An AI coding assistant (Claude by Anthropic) wrote and debugged much of the code under my direction (FITS/WCS reader, RICE decoder, proxy functions, UI), drafted the README and assembled a backup slide deck from real screenshots of the app. The core concept (a God's-Eye-View-style viewer for SPHEREx built around the challenge's suggestions), feature choices and testing direction are mine. The AI also suggested the project name and a few feature ideas (WISE 2010 reference frame, DIFF colour scheme, reports via GitHub issues). This is acknowledged in the README, the site footer, the page metadata and a disclosure line at the top of every source file. The demo video is my own screen recording. No AI-generated imagery: all images are real NASA data rendered by the app.
