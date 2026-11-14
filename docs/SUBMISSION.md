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

**Benefits / goals** Anyone, without software or astronomy training, can inspect SPHEREx data for movers and variables within seconds, and share or embed what they find, in the spirit of Backyard Worlds-style citizen science.

**Tools** JavaScript (ES modules, no framework), HTML/CSS canvas, Node.js serverless functions (Vercel), Aladin Lite v3, IRSA SIA/TAP, ESA Gaia TAP, CDS Sesame and HiPS.

## NASA Data
- SPHEREx Level 2 spectral images, DR1 — NASA/IPAC Infrared Science Archive (IRSA) search service and NASA's AWS Open Data bucket `nasa-irsa-spherex`.
- IRSA SPHEREx tutorial notebooks (file structure, spectral WCS, cutouts).
- AllWISE Source Catalog and WISE/unWISE all-sky maps (NASA WISE mission).
- unWISE coadds of NASA WISE data (unwise.me) for the 2010 reference frame.
- WiseView (byw.tools/wiseview) as the inspiration for the flipbook interface.

## Space Agency Partner Data and Other References
- ESA Gaia DR3 (ESA Gaia Archive).
- ESA ESASky HiPS mirrors (AllWISE, 2MASS) for the sky globe; CSIRO CASDA DSS2 mirror.
- CDS Strasbourg: SPHEREx all-sky HiPS maps, Aladin Lite v3, Sesame name resolver, 2MASS/DSS2 HiPS.
- God's Eye View by Bilawal Sidhu (MIT) — UI design inspiration only, no code reused.
- Google Fonts: JetBrains Mono, Orbitron (OFL).

## Use of Super Intelligence (SI)
Yes. An AI coding assistant (Claude by Anthropic) wrote and debugged much of the code under my direction (FITS/WCS reader, RICE decoder, proxy functions, UI), drafted the README and assembled a backup slide deck from real screenshots of the app. The core concept (a God's-Eye-View-style viewer for SPHEREx built around the challenge's suggestions), feature choices and testing direction are mine. The AI also suggested the project name and a few feature ideas (WISE 2010 reference frame, DIFF colour scheme, reports via GitHub issues). This is acknowledged in the README and the site footer. The demo video is my own screen recording. No AI-generated imagery: all images are real NASA data rendered by the app.
