// ---------------------------------------------------------------------------
// One place to update when new SPHEREx data releases arrive.
// Add a new IRSA collection name (e.g. 'spherex_dr2') to `collections` and the
// whole tool picks it up — search, epochs, flipbook and spectra are all built
// on the fly from whatever the archive returns.
// ---------------------------------------------------------------------------
export const CONFIG = {
  appName: 'BLINKSCOPE',           // project name
  apiBase: '',                     // '' = same origin (Vercel or server.mjs)
  collections: ['spherex_dr1'],    // IRSA SIA collections to search
  pixelScale: 6.15,                // SPHEREx native pixel size, arcsec
  concurrency: 6,                  // parallel range requests to AWS
  aladinModule: 'https://cdn.jsdelivr.net/npm/aladin-lite@3.8.2/dist/aladin.js',
  defaultFov: 300,                 // arcsec
  epochGapDays: 30,                // gap that separates two survey passes
  // All-sky globe layers. Each is probed at start-up; unreachable mirrors are
  // skipped automatically and the first working layer is used.
  allSkyLayers: [
    { name: 'SPHEREx · colour (all-sky)', urls: ['https://alasky.cds.unistra.fr/SPHEREx/color', 'https://alaskybis.cds.unistra.fr/SPHEREx/color'] },
    { name: 'SPHEREx · D1 0.75–1.09 µm', urls: ['https://alasky.cds.unistra.fr/SPHEREx/D1'] },
    { name: 'SPHEREx · D2 1.10–1.62 µm', urls: ['https://alasky.cds.unistra.fr/SPHEREx/D2'] },
    { name: 'SPHEREx · D3 1.63–2.41 µm', urls: ['https://alasky.cds.unistra.fr/SPHEREx/D3'] },
    { name: 'SPHEREx · D4 2.42–3.82 µm', urls: ['https://alasky.cds.unistra.fr/SPHEREx/D4'] },
    { name: 'SPHEREx · D5 3.83–4.41 µm', urls: ['https://alasky.cds.unistra.fr/SPHEREx/D5'] },
    { name: 'SPHEREx · D6 4.42–5.00 µm', urls: ['https://alasky.cds.unistra.fr/SPHEREx/D6'] },
    { name: 'WISE · AllWISE colour', urls: ['https://cdn.skies.esac.esa.int/AllWISEColor', 'https://alasky.cds.unistra.fr/AllWISE/RGB-W4-W2-W1'] },
    { name: '2MASS · near-IR colour', urls: ['https://cdn.skies.esac.esa.int/2MASSColor', 'https://alasky.cds.unistra.fr/2MASS/Color'] },
    { name: 'DSS2 · optical colour', urls: ['https://casda.csiro.au/hips/DSS2/color', 'https://alasky.cds.unistra.fr/DSS/DSSColor'] },
  ],
  detectors: [
    { d: 1, wl: '0.75–1.09', color: '#7aa2ff' },
    { d: 2, wl: '1.10–1.62', color: '#62e0ff' },
    { d: 3, wl: '1.63–2.41', color: '#5dffb0' },
    { d: 4, wl: '2.42–3.82', color: '#ffe066' },
    { d: 5, wl: '3.83–4.41', color: '#ff9f43' },
    { d: 6, wl: '4.42–5.00', color: '#ff5a6e' },
  ],
  // Challenge test targets. Positions are resolved live (CDS Sesame, with proper
  // motion); `fallback` is used only if the resolver is unreachable.
  presets: [
    { key: 'barnard', label: "Barnard's Star", query: "Barnard's Star", fov: 360, dets: [1, 2, 3, 4, 5, 6], note: 'Fastest-moving star in the sky (10.4″/yr)',
      fallback: { ra: 269.4520770, dec: 4.6933650, pmra: -801.551, pmdec: 10362.394, epoch: 2000 } },
    { key: 'epsindib', label: 'Epsilon Indi B', query: 'eps Indi B', fov: 300, dets: [2, 5, 6], note: 'Pair of brown dwarfs orbiting ε Indi A',
      fallback: { ra: 331.0441466, dec: -56.7828442, pmra: 3981.977, pmdec: -2466.832, epoch: 2000 } },
    { key: 'wise0855', label: 'WISE 0855−0714', query: 'WISE J085510.83-071442.5', fov: 360, dets: [5, 6], note: 'Coldest known brown dwarf; 8.1″/yr',
      fallback: { ra: 133.8189083, dec: -7.247048, pmra: -8123.7, pmdec: 673.2, epoch: 2000 } },
    { key: 'rwaur', label: 'RW Aurigae', query: 'RW Aur', fov: 300, dets: [1, 2, 3, 4, 5, 6], note: 'Variable young star (T Tauri)',
      fallback: { ra: 76.9565260, dec: 30.4014382, pmra: 7.23, pmdec: -20.33, epoch: 2000 } },
    { key: 'rdra', label: 'R Draconis', query: 'R Dra', fov: 300, dets: [1, 2, 3, 4, 5, 6], note: 'Mira variable (~246-day cycle)',
      fallback: { ra: 248.1676108, dec: 66.7549794, pmra: -20.643, pmdec: 6.149, epoch: 2000 } },
  ],
};
