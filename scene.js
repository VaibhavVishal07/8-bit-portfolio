/* ==================================================================
   ROOFTOP — the background scene.

   Drawn on a 960x540 canvas and upscaled nearest-neighbour. That is
   how pixel art actually works: a fixed low-resolution grid, blown up
   whole-number style, never drawn at display resolution.

   Techniques, all period-correct:
     - 4x4 ordered (Bayer) dithering for every gradient, glow and haze
     - Three depths of skyline, each generated building by building
       with crowns, mullions, ledges, plant and its own window grid
     - Aerial perspective: each depth is washed toward the horizon, so
       distance is carried by contrast rather than by size alone
     - Window flicker done by repainting individual lit cells, the way
       a tile engine would, rather than redrawing the layer
     - Parallax across five depths, furthest slowest
     - A fixed 12fps tick, so all motion is inherently stepped

   Weather is not an overlay. Rain and snow are read by the *static*
   builders, so a wet roof is a different roof — different deck, different
   coping, different props — and a snowed roof is different again. The
   layers are rebuilt when the weather changes, exactly as they are when
   the theme changes.
   ================================================================== */

(function () {
  'use strict'

  const W = 960
  const H = 540
  const FPS = 12

  const SKYLINE = 410 // where the buildings meet the rooftop
  const ROOF_TOP = 404
  const ORB_X = 190
  // Low enough to clear the top of the crop once the canvas is anchored
  // at 72% — a moon with its head cut off is worse than a lower moon.
  const ORB_Y = 106
  const ORB_R = 38
  const VIA_Y = 360 // top of the elevated deck
  const VIA_H = 11
  const LOOP_W = W * 2

  const cv = document.getElementById('scene')
  if (!cv) return

  cv.width = W
  cv.height = H
  /* Double-buffered. The scene paints into an offscreen canvas at its
     fixed 12fps — that stepped motion is the project's identity — and a
     compositor presents it to the visible canvas every rAF frame. The
     split exists for the transitions: the dissolve mask and the falling
     weather run on the 60fps side, so a theme or weather change glides
     while the city behind it keeps its deliberate step. Retro hardware
     did exactly this — coarse background, smooth sprites. */
  const screenCtx = cv.getContext('2d')
  screenCtx.imageSmoothingEnabled = false
  const sceneCv = document.createElement('canvas')
  sceneCv.width = W
  sceneCv.height = H
  const ctx = sceneCv.getContext('2d')
  ctx.imageSmoothingEnabled = false

  /* Weather sits on its own canvas above the panel, so falling drops
     and flakes pass in front of the window. Anything that *lands*
     goes on the scene canvas instead, or it would settle on top of
     the panel it should be settling behind. */
  const wv = document.getElementById('weather')
  let wctx = null
  if (wv) {
    wv.width = W
    wv.height = H
    wctx = wv.getContext('2d')
    wctx.imageSmoothingEnabled = false
  }

  const animating = !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /* Every load opens the same way: night, rain, neon on wet streets.
     The scene at its best is the scene you land on. The weather
     buttons still work for the visit; the choice just does not follow
     you home. A portfolio gets to insist on its opening shot. */
  let weather = 'rain'

  /* ---- weather transitions ----
     Weather used to arrive all at once: press the button and two
     hundred drops appear mid-air with a wet roof already under them.
     It read as a jump-cut, because it was one.

     So there are now two states. `weather` is what has been *built* —
     which roof, which sky, which skyline. `target` is what has been
     asked for. Between them sits `wx`, an intensity from 0 to 1 that
     the particle count is scaled by, and the order of operations is
     what makes it feel like weather:

       turning on   the world swaps, then the fall builds up over five
                    and a half seconds from nothing
       turning off  the fall thins out FIRST, over four seconds, and
                    only once the last drop has gone does the roof dry

     Switching straight from rain to snow runs both halves in order, so
     the rain stops before the snow starts, which is what it does. */
  let target = weather
  let wx = weather === 'none' ? 0 : 1

  /* How much of the STATIC snow exists — the blanket, the caps, the
     banks, the sky wash. The fall used to arrive as a finished world:
     press the button and every ledge was already white before a single
     flake had landed. Now the builders scale their snow by this level
     and the transition rebuilds at quarter steps, so the scene whitens
     the way a real one does: accumulation first, evidence everywhere,
     no jump cut. Snow reads from surfaces, not from the air. */
  let snowLevel = weather === 'snow' ? 1 : 0

  /* Christmas lives in the snow palette: bulb colours for the string
     lights, the tree, and a scatter of festive windows in the city. */
  const FESTIVE = ['#e8484f', '#3fbf6f', '#f8c838']
  const RAMP_UP_MS = 5500
  const RAMP_DOWN_MS = 4000

  /* The canvases are `object-fit: cover` with `object-position: 50% 72%`
     — anchored low, so the crop on a wide viewport comes out of the sky
     rather than off the rooftop. Anything that maps between page
     coordinates and canvas coordinates has to undo exactly that, so the
     numbers live here once and everything else reads them. */
  const FIT_X = 0.5
  const FIT_Y = 0.72

  function viewMap() {
    const vw = window.innerWidth
    const vh = window.innerHeight
    const scale = Math.max(vw / W, vh / H)
    return { scale, ox: (vw - W * scale) * FIT_X, oy: (vh - H * scale) * FIT_Y }
  }

  /* Where the HUD panel sits, in canvas pixels. There is more than one
     window now, so the weather follows whichever one is up — the window
     manager marks it — and lands on nothing at all when they are all
     minimised. */
  function panelRect() {
    const el =
      document.querySelector('.window[data-active]') ||
      document.querySelector('.window:not([hidden])')
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (!r.width) return null
    const { scale, ox, oy } = viewMap()
    return {
      x0: (r.left - ox) / scale,
      x1: (r.right - ox) / scale,
      y0: (r.top - oy) / scale,
      y1: (r.bottom - oy) / scale,
    }
  }

  /* ---------------- helpers ---------------- */
  function mulberry32(a) {
    return function () {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /* ==================================================================
     THE DITHER KERNEL — 8x8 Bayer

     This used to be the 4x4 kernel, which gives sixteen levels between
     any two colours. Sixteen is an 8-bit number of steps and it looks
     like one: every gradient in the scene had visible bands in it and
     every glow had a hard shoulder where it ran out of levels.

     8x8 gives sixty-four. Four times the tonal resolution through the
     exact same two-colour palette — no new colours anywhere, the
     hardware just got better at pretending. Skies ramp, glows fall off
     smoothly, the aerial haze stops stepping. It is the single biggest
     difference between how a 1988 machine and a 1995 one render the
     same picture, and it costs one array.
     ================================================================== */
  const BAYER = [
    [0, 32, 8, 40, 2, 34, 10, 42],
    [48, 16, 56, 24, 50, 18, 58, 26],
    [12, 44, 4, 36, 14, 46, 6, 38],
    [60, 28, 52, 20, 62, 30, 54, 22],
    [3, 35, 11, 43, 1, 33, 9, 41],
    [51, 19, 59, 27, 49, 17, 57, 25],
    [15, 47, 7, 39, 13, 45, 5, 37],
    [63, 31, 55, 23, 61, 29, 53, 21],
  ]
  const BAYER_N = 64

  function makeBuffer(w, h) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    const x = c.getContext('2d')
    x.imageSmoothingEnabled = false
    return { c, x }
  }

  const px = (x, y, c) => {
    ctx.fillStyle = c
    ctx.fillRect(x, y, 1, 1)
  }

  /* One dithered pixel. Used where the intensity varies across x —
     glows, halos, haloes, bolts — and so cannot be laid down as a row. */
  function dot(g, x, y, t, col) {
    if (t <= 0) return
    if (t > (BAYER[y & 7][x & 7] + 0.5) / BAYER_N) {
      g.fillStyle = col
      g.fillRect(x, y, 1, 1)
    }
  }

  /* ==================================================================
     A 3x5 PIXEL FONT

     Three pixels is the narrowest a letter can be and still be a
     letter. A sign on the mid skyline is about ten pixels tall, which
     is exactly enough — so the signage can say something instead of
     being dark bars standing in for lettering, and the city stops being
     wallpaper and starts being a place with businesses in it.

     Each glyph is five octal digits, one per row, bit 4 leftmost.
     ================================================================== */
  const FONT = {
    A: '25755', B: '65656', C: '34443', D: '65556', E: '74647', F: '74644',
    G: '34553', H: '55755', I: '72227', J: '11152', K: '55655', L: '44447',
    M: '57755', N: '65555', O: '25552', P: '65644', Q: '25573', R: '65655',
    S: '34216', T: '72222', U: '55553', V: '55552', W: '55775', X: '55255',
    Y: '55222', Z: '71247',
    0: '75557', 1: '26227', 2: '61247', 3: '71317', 4: '55711',
    5: '74717', 6: '34757', 7: '71222', 8: '75757', 9: '75716',
    ' ': '00000', '-': '00700', '.': '00002', '!': '22202', '*': '05250',
  }

  const textW = (s) => s.length * 4 - 1

  function text(g, s, x, y, col) {
    g.fillStyle = col
    for (let i = 0; i < s.length; i++) {
      const gl = FONT[s[i]]
      if (!gl) continue
      for (let r = 0; r < 5; r++) {
        const bits = +gl[r]
        for (let c = 0; c < 3; c++) {
          if (bits & (4 >> c)) g.fillRect(x + i * 4 + c, y + r, 1, 1)
        }
      }
    }
  }

  /* What the city sells. Short, because a billboard is forty pixels
     across - and kind, because a skyline of good small businesses is a
     city you want to look at longer. Nothing here is a real brand. */
  const SIGNS = [
    'RAMEN', 'SUSHI', 'NOODLES', 'TACOS', 'HOT PIZZA', 'DUMPLING',
    'KARAOKE', 'LAUNDRY', 'GOOD SOUP', 'CATS ONLY', 'ROBOT BAR',
    'NAPS 24H', 'FREE HUGS', 'FLOWERS', 'BOOKS', 'OPEN LATE',
    'WARM BREAD', 'TEA HOUSE', 'MOON RENT', 'ARCADE',
  ]
  const TALL_SIGNS = [
    'RAMEN', 'BAR', 'SAKE', 'NEON', 'HOTEL', 'NOODLE',
    'CATS', 'PIZZA', 'SOUP', 'OPEN', 'BATHS', 'DONUT',
  ]

  /* The airship flies a different banner every time it comes round. */
  /* What the airship carries. Not gags - small kindnesses. A banner
     over a rainy city should feel like a hand on the shoulder, and one
     of them is a motto: greatness from small beginnings. The font has
     no comma, which keeps every line honest and short. */
  const BANNERS = [
    'SIC PARVIS MAGNA', 'THE CAT SAYS HI', 'YOU LOOKED UP. NICE.',
    'CARRYING GOOD NEWS', 'NO HURRY UP HERE', 'HOME BY DINNER',
  ]

  const MOVIES = ['NOW SHOWING', 'SOLD OUT', 'ONE NIGHT ONLY', 'BRING SNACKS']

  /* A dithered *wash* is the same kernel baked into a repeating fill
     pattern, so a full-width row costs one fillRect instead of 960.
     Every large flat gradient — the sky ramp, aerial haze, the snow
     blanket — goes through here, which is what keeps a rebuild under a
     frame even with this much more in the scene.

     At 8x8 the tile is sixty-four cells rather than sixteen, so there
     are sixty-four cached patterns per colour instead of sixteen. Still
     nothing: a 64-level ramp of eight-by-eight pixels is 4KB. */
  const washCache = new Map()
  function washPattern(col, lvl) {
    const key = col + '|' + lvl
    let p = washCache.get(key)
    if (p) return p
    const b = makeBuffer(8, 8)
    b.x.fillStyle = col
    for (let y = 0; y < 8; y++) {
      for (let x = 0; x < 8; x++) {
        if (BAYER[y][x] < lvl) b.x.fillRect(x, y, 1, 1)
      }
    }
    p = b.x.createPattern(b.c, 'repeat')
    washCache.set(key, p)
    return p
  }

  function washRow(g, y, w, col, t) {
    const lvl = Math.round(Math.max(0, Math.min(1, t)) * BAYER_N)
    if (lvl <= 0) return
    g.fillStyle = washPattern(col, lvl)
    g.fillRect(0, y, w, 1)
  }

  /* ==================================================================
     PALETTES

     Night is neon cyberpunk. Day is *also* cyberpunk — not a flat blue
     afternoon but a smog-lit one, the sky ramping from a hard teal at
     the zenith through amber pollution at the skyline, with the signage
     still burning through it. Bright, but not clean.
     ================================================================== */
  const THEMES = {
    night: {
      /* Deep violet-black base so the neon has somewhere dark to burn
         against. The haze near the skyline is the only place the purple
         gets bright, and even that stays under the sign colours. */
      sky: [
        '#05010a', '#090315', '#0e0522', '#150733', '#1d0a45',
        '#260f57', '#301269', '#3a1880', '#4a1d92',
      ],
      haze: '#7a1fb0',
      smog: '#5a1a8c',
      fog: '#3a1880',
      fogAmt: [0.42, 0.20, 0.02],
      rainSky: '#0d0520',
      snowSky: '#241c48',
      snowWash: [0.10, 0.26], blanket: [0.85, 0.15], fogSnowBoost: 0.18,
      lightning: '#c9b6ff', boltCore: '#ffffff',

      orb: '#ecd8ff', orbShade: '#b58ce0', orbGlow: '#6b1fa8',
      craters: true, orbShine: false,
      cloud: '#2c1159', cloudLit: '#4d219a', cloudDark: '#170733',
      star: '#ffffff', starDim: '#b98cf0', starWarm: '#ffd0a0', stars: true,

      /* The ridge behind everything: a fourth silhouette plane pitched
         just below the haze, so the far city has something to be in
         front of. Depth is planes, and three was one short. */
      cityFar: { fill: '#3a2270', lit: '#4a2e88', dark: '#2a1655', window: '#6b50b0', warm: '#8a63c8' },
      city: [
        { fill: '#2a1461', lit: '#3d1f85', dark: '#1a0b3e', window: '#9b74e8', warm: '#ff5cc4' },
        { fill: '#160a36', lit: '#241058', dark: '#0a0420', window: '#a86bff', warm: '#ff5cc4' },
        { fill: '#07020f', lit: '#12052a', dark: '#020007', window: '#c98cff', warm: '#ff7ad4' },
      ],
      // hot pink, cyan, neon purple, electric yellow, neon green
      neon: ['#ff2bb0', '#00f0ff', '#b026ff', '#faff00', '#00ff9d'],
      halo: 0.9,

      roof: '#090318', roofLit: '#2a0f5c', roofSpeck: '#150733', roofDark: '#03010c',
      rail: '#150a32', railLit: '#7a4fd8', railDark: '#040108',
      /* `edge` is the foreground's silhouette line and is used for
         nothing else, so it can be pushed as dark as it needs to go
         without dragging any other surface down with it. `sep` is the
         haze the city is lifted with just behind that line. */
      edge: '#020106', sep: '#6a2fb0', sepDark: '#150929',
      bounce: ['#ff2bb0', '#00f0ff', '#b026ff'],
      wet: ['#ff2bb0', '#00f0ff', '#b026ff'],
      wetDeck: '#0d0526', wetGloss: '#5a3ba8',
      puddle: '#1a0b3e', puddleRim: '#7a4fd8',

      viaduct: '#1a0f3e', viaductLit: '#331c72', viaductDark: '#080320',
      train: '#26155c', trainLit: '#5230a8', trainDark: '#0b0524',
      trainWin: '#c2e8ff', trainHead: '#fff3b0', trainStripe: '#00f0ff',

      /* The airship flies at about the mid skyline's distance, so its
         values are pitched to sit in that band. Anything as dark as the
         near layer reads as a cut-out pasted in front of the city. */
      ship: '#2a1a56', shipLit: '#48307e', shipDark: '#160a34', shipTrim: '#00f0ff',
      cat: '#060214', catRim: '#b026ff', catEye: '#7dfcff', catCollar: '#ff2bb0',
      sign: '#00f0ff', signBox: '#120630',
      lamp: '#ffbe5c', lampDim: '#7a4a1c',
      steam: '#6b4fa8',
      cloth: ['#8e3358', '#35617e', '#8a7038'],

      snowLie: '#4a4180', snowLit: '#a89ce6', snowDark: '#241b48', ice: '#8a7ec2',
      rainDrop: '#7d5cc8', rainHi: '#d0b8ff',
      snowFlake: '#cfc2ee', snowPile: '#7a6cb4',

      fire: true,
    },

    day: {
      /* Smog daylight. The ramp runs cold at the top and hot at the
         bottom — a teal zenith washing down through mauve into an amber
         pollution band sitting on the skyline. That amber is what makes
         it read as a poisoned afternoon rather than a nice one. */
      sky: [
        '#17558c', '#22659e', '#2f74ac', '#4a89bd', '#6a93c0',
        '#9099c1', '#b3a4bf', '#d3adb4', '#f6c193',
      ],
      haze: '#ffbc7a',
      smog: '#e8a878',
      fog: '#d9b6b4',
      fogAmt: [0.48, 0.28, 0.09],
      rainSky: '#6f7789',
      snowSky: '#dde0ec',
      /* Pale-on-pale: keep the sky wash sparse and the blanket near
         solid, so neither sits at the checkerboard midpoint. */
      snowWash: [0.08, 0.30], blanket: [0.78, 0.22], fogSnowBoost: 0.12,
      lightning: '#fff4e0', boltCore: '#ffffff',

      orb: '#fff8d2', orbShade: '#ffe6a0', orbGlow: '#ffd08a',
      craters: false, orbShine: true,
      cloud: '#c9b4c4', cloudLit: '#f6e6e0', cloudDark: '#9c8a9e',
      star: '#ffffff', starDim: '#cfe4f6', starWarm: '#ffe0b8', stars: false,

      /* Buildings stay cool and desaturated so the signage on them is
         the only saturated thing at this depth — daylight neon only
         reads if nothing else is competing for the colour. */
      cityFar: { fill: '#a9b3cb', lit: '#b8c1d5', dark: '#9aa4be', window: '#c6cede', warm: '#d4c8b8' },
      city: [
        { fill: '#8d9cc0', lit: '#a9b6d4', dark: '#7685ab', window: '#c6cfe6', warm: '#ffd7a4' },
        { fill: '#6c7aa6', lit: '#8894c0', dark: '#56638d', window: '#b0bada', warm: '#ffc78c' },
        { fill: '#49527e', lit: '#646d9c', dark: '#343b60', window: '#959fca', warm: '#ffb478' },
      ],
      /* Daylight neon is OFF. The signs keep their exact geometry — same
         random draws, so the city never rearranges between themes — but
         they render in unlit greys with no halo at all. Calm. */
      neon: ['#7c87a0', '#7a98a4', '#8a80a0', '#a89a78', '#7f9c8c'],
      halo: 0,

      /* The daylight roof was a mid grey and sat too close in value to
         the city behind it. It is the nearest plane in the scene; it
         should be the heaviest thing in it. */
      roof: '#5a5164', roofLit: '#7b7186', roofSpeck: '#685f74', roofDark: '#352f3e',
      rail: '#443c4e', railLit: '#988ca6', railDark: '#1c1724',
      edge: '#100c16', sep: '#efe6ec', sepDark: '#83879e',
      bounce: ['#ff8fc0', '#7fd8e8', '#ffd8a0'],
      wet: ['#ff6faa', '#4ec4dc', '#ffc27a'],
      wetDeck: '#4b4353', wetGloss: '#b6a9c2',
      puddle: '#5f5570', puddleRim: '#cbbdd6',

      viaduct: '#6a5f78', viaductLit: '#8d8299', viaductDark: '#403848',
      train: '#8b8098', trainLit: '#b3a8bf', trainDark: '#554c60',
      trainWin: '#f0e4f4', trainHead: '#fff8d8', trainStripe: '#8b97ad',

      ship: '#8f9ab8', shipLit: '#b9c1d6', shipDark: '#6a7593', shipTrim: '#0d7f96',
      cat: '#2a2436', catRim: '#ffbc7a', catEye: '#19d7e8', catCollar: '#ff3ea0',
      sign: '#66788f', signBox: '#3a3048',
      lamp: '#ffd89a', lampDim: '#a08258',
      steam: '#e8dce8',
      cloth: ['#b06a86', '#6e90aa', '#b8a070'],

      snowLie: '#d6d3e4', snowLit: '#fffbff', snowDark: '#a7a3bd', ice: '#eef2ff',
      /* Daylight flakes need a value the sky has not already got. Plain
         white over a pale blue sky at uniform density turned the whole
         frame into 1-bit static and the city stopped reading. */
      flakeEdge: '#5f7391',
      /* Daylight rain reads as darker streaks against a bright sky, not
         as pale ones — the reverse of night. */
      rainDrop: '#5a7ea8', rainHi: '#ffffff',
      snowFlake: '#ffffff', snowPile: '#e8e6f2',

      fire: false,
    },
  }

  let T = THEMES.night

  /* Under weather the horizon colour that everything washes toward is
     no longer the clear-sky one. */
  const fogColour = () =>
    weather === 'snow' ? T.snowSky : weather === 'rain' ? T.rainSky : T.fog
  const fogBoost = () => (weather === 'snow' ? T.fogSnowBoost * snowLevel : weather === 'rain' ? 0.13 : 0)

  /* ==================================================================
     STATIC LAYERS
     ================================================================== */
  let sky, clouds, roof, viaduct
  let city = []
  let ridge = null
  /* ---- the camera ----
     Sections are not windows stacked on top of each other any more,
     they are PLACES further along the same rooftop. Travelling to one
     slides this offset, and every parallax layer reads it, so the
     whole city drifts past at its own depth-appropriate rate. That
     drift is the entire reason the navigation feels like walking
     rather than like tabbing. */
  let panX = 0
  let panTo = 0

  let roofLights = []
  let puddles = []
  /* Lighthouse lanterns. Their beams sweep, so they cannot be baked
     into a parallax buffer — the buffer position is recorded here and
     the beam is drawn per frame at buffer-x minus that layer's offset. */
  let beamSources = []

  /* Nine bands rather than seven. The ramp is dithered between
     neighbours either way, but more stops means each dither has less
     distance to cover, so the banding tightens instead of showing. */
  const SKY_STOPS = [0, 50, 100, 152, 204, 256, 306, 358, SKYLINE]

  /* ---- Sky: seven bands dithered into each other, then strata ---- */
  function buildSky() {
    sky = makeBuffer(W, H)
    const g = sky.x
    const rnd = mulberry32(6161)

    /* The ramp is laid down two fillRects to a row: the band colour
       flat, then the next band washed over it at the blend amount. */
    for (let y = 0; y < SKYLINE + 8; y++) {
      let i = 0
      while (i < SKY_STOPS.length - 2 && y > SKY_STOPS[i + 1]) i++
      const span = Math.max(1, SKY_STOPS[i + 1] - SKY_STOPS[i])
      const t = Math.min(1, Math.max(0, (y - SKY_STOPS[i]) / span))
      g.fillStyle = T.sky[i]
      g.fillRect(0, y, W, 1)
      washRow(g, y, W, T.sky[Math.min(i + 1, T.sky.length - 1)], t)
    }

    /* Smog strata. Thin horizontal shelves of haze lying across the
       ramp, tapering at both ends — pollution settles in layers, and a
       sky with layers in it reads as air rather than as a gradient. */
    for (let n = 0; n < 7; n++) {
      const by = 120 + Math.floor(rnd() * (SKYLINE - 160))
      const bh = 3 + Math.floor(rnd() * 10)
      const bx = Math.floor(rnd() * W)
      const bw = 220 + Math.floor(rnd() * 520)
      for (let y = by; y < by + bh; y++) {
        const vy = 1 - Math.abs(y - (by + bh / 2)) / (bh / 2 + 0.5)
        for (let k = 0; k < bw; k++) {
          const x = (bx + k) % W
          const vx = 1 - Math.abs(k - bw / 2) / (bw / 2)
          dot(g, x, y, vx * vy * 0.32, T.smog)
        }
      }
    }

    /* There was a galactic band here — a swath of star dust running
       diagonally across the sky. On paper it is the thing that stops a
       starfield reading as an even scatter of dots. In practice it
       passed just to the right of the moon and read as a smear rather
       than as stars, and a broad soft diagonal is exactly the shape
       this scene has no vocabulary for: everything else in it is a hard
       edge or a deliberate dither, and that was neither. */

    /* High cirrus. Wisps rather than slabs — they sit above the cloud
       layer, taper to nothing at both ends and ride a long shallow
       sine, so they read as ice being blown along rather than as water
       hanging still. */
    for (let n = 0; n < 15; n++) {
      const cy = 12 + Math.floor(rnd() * 160)
      const cx = Math.floor(rnd() * W)
      const cw = 100 + Math.floor(rnd() * 240)
      const rows = 1 + Math.floor(rnd() * 2)
      const wob = 0.02 + rnd() * 0.03
      for (let r = 0; r < rows; r++) {
        for (let k = 0; k < cw; k++) {
          const x = (cx + k) % W
          const y = cy + r + Math.round(Math.sin(k * wob) * 2)
          if (y < 0 || y >= SKYLINE) continue
          dot(g, x, y, Math.sin((k / cw) * Math.PI) * 0.5, T.cloudLit)
        }
      }
    }

    // city glow pooling above the skyline — flat in x, so it washes
    for (let y = SKYLINE - 160; y < SKYLINE; y++) {
      const t = 1 - (SKYLINE - y) / 160
      washRow(g, y, W, T.haze, t * t * 0.85)
    }

    /* Coloured pools in that haze. A single flat haze colour is what
       made the night sky read as merely dark; broad, very sparse
       patches of sign colour bleeding upward give it life without
       lifting the base value. */
    if (T.bounce) {
      for (let i = 0; i < 12; i++) {
        const cx = Math.floor(rnd() * W)
        const cw = 110 + Math.floor(rnd() * 190)
        const ch = 60 + Math.floor(rnd() * 90)
        const col = T.bounce[Math.floor(rnd() * T.bounce.length)]
        for (let y = SKYLINE - ch; y < SKYLINE; y++) {
          const ty = 1 - (SKYLINE - y) / ch
          for (let x = cx; x < cx + cw && x < W; x++) {
            const tx = 1 - Math.abs(x - (cx + cw / 2)) / (cw / 2)
            dot(g, x, y, ty * tx * ty * tx * 0.5, col)
          }
        }
      }
    }

    /* The moon or sun is fixed, so it belongs in the buffer rather than
       being recomputed 12 times a second. Clouds blit after the sky, so
       baking it here also lets them drift in front of it. */
    drawOrbInto(g)

    /* Weather light. Rain drops the whole sky a stop; snow flattens it
       toward a pale grey-violet and kills the contrast the stars need,
       which is most of what makes a scene read as snowing before a
       single flake has fallen. */
    if (weather !== 'none') {
      const col = weather === 'snow' ? T.snowSky : T.rainSky
      const lvl = weather === 'snow' ? snowLevel : 1
      const base = (weather === 'snow' ? T.snowWash[0] : 0.14) * lvl
      const gain = (weather === 'snow' ? T.snowWash[1] : 0.30) * lvl
      for (let y = 0; y < SKYLINE + 8; y++) {
        washRow(g, y, W, col, base + gain * (y / SKYLINE))
      }
    }
  }

  function drawOrbInto(g) {
    /* The moon is drawn bare: a disc and its maria, nothing coming off
       it. The sun keeps its corona and its halo, because at noon
       through smog there genuinely is one — but at night the glow was
       the brightest thing in the top third of the frame and it pulled
       the eye off the city, which is what you are meant to be looking
       at. A hard-edged disc on a dithered sky is also simply more of a
       piece with everything else here. */
    if (!T.orbShine) {
      drawOrbDisc(g)
      return
    }

    /* A 22-degree halo. Haze throws a ring around a bright disc at a
       fixed angular distance from it, and drawing the ring *before* the
       near glow keeps the two from merging into one blob. */
    const ringR = ORB_R * 2.7
    const band = 9
    for (let y = Math.round(ORB_Y - ringR - band); y <= ORB_Y + ringR + band; y++) {
      if (y < 0 || y >= SKYLINE) continue
      for (let x = Math.round(ORB_X - ringR - band); x <= ORB_X + ringR + band; x++) {
        if (x < 0 || x >= W) continue
        const d = Math.hypot(x - ORB_X, y - ORB_Y)
        /* Wide and faint. A narrow, strong ring reads as something
           somebody drew; a soft one reads as the air.

           Clamped at zero BEFORE it is squared. dot() rejects a
           non-positive strength, but squaring turns every large
           negative — every pixel nowhere near the ring — back into a
           large positive, and the halo fills the whole sky. */
        const t = Math.max(0, 1 - Math.abs(d - ringR) / band)
        dot(g, x, y, t * t * 0.3, T.orbGlow)
      }
    }

    const reach = ORB_R + 52
    for (let y = ORB_Y - reach; y <= ORB_Y + reach; y++) {
      if (y < 0 || y >= SKYLINE) continue
      for (let x = ORB_X - reach; x <= ORB_X + reach; x++) {
        if (x < 0 || x >= W) continue
        const d = Math.hypot(x - ORB_X, y - ORB_Y)
        if (d <= ORB_R || d > reach) continue
        const t = 1 - (d - ORB_R) / (reach - ORB_R)
        dot(g, x, y, t * t * 0.9, T.orbGlow)
      }
    }

    drawOrbDisc(g)
  }

  function drawOrbDisc(g) {
    // disc
    for (let y = -ORB_R; y <= ORB_R; y++) {
      const span = Math.floor(Math.sqrt(ORB_R * ORB_R - y * y))
      g.fillStyle = T.orb
      g.fillRect(ORB_X - span, ORB_Y + y, span * 2 + 1, 1)
    }

    if (T.craters) {
      // maria, each with a darker floor and a lit western rim
      const seas = [
        [-14, -18, 11, 7], [6, -4, 9, 7], [-9, 13, 14, 6],
        [14, 17, 7, 5], [-20, 2, 6, 5], [2, 22, 8, 4],
      ]
      for (const [ox, oy, sw, sh] of seas) {
        g.fillStyle = T.orbShade
        g.fillRect(ORB_X + ox, ORB_Y + oy, sw, sh)
        g.fillStyle = T.orb
        g.fillRect(ORB_X + ox, ORB_Y + oy, 1, sh)
      }
    } else {
      // a hot core, so the sun is not a flat disc
      for (let y = -ORB_R + 12; y <= ORB_R - 12; y++) {
        const span = Math.floor(Math.sqrt((ORB_R - 12) * (ORB_R - 12) - y * y))
        g.fillStyle = T.orbShade
        g.fillRect(ORB_X - span, ORB_Y + y, span * 2 + 1, 1)
      }
    }

    // terminator along the lower-right limb
    g.fillStyle = T.orbShade
    for (let y = 5; y <= ORB_R; y++) {
      const span = Math.floor(Math.sqrt(ORB_R * ORB_R - y * y))
      g.fillRect(ORB_X + span - 5, ORB_Y + y, 5, 1)
    }
  }

  /* ---- Clouds ----
     Flat slabs with a lit crown row and a shadowed underside. Rain and
     snow bring more of them, lower and heavier. */
  function buildClouds() {
    clouds = makeBuffer(LOOP_W, H)
    const g = clouds.x
    const rnd = mulberry32(1900)
    const heavy = weather !== 'none'

    /* The same 46 clouds always exist in the same places; a clear sky
       simply does not draw the last twenty of them. Every random draw
       is made before that decision, so the field thickens under weather
       instead of being swapped for a different one — which is what
       toggling the rain used to do to the sky. */
    for (let k = 0; k < 46; k++) {
      const cx = Math.floor(rnd() * LOOP_W)
      const cy = 26 + Math.floor(rnd() * 244)
      const len = 26 + Math.floor(rnd() * 96)
      const rows = 3 + Math.floor(rnd() * 5)
      const lumps = []
      for (let l = 0; l < 3; l++) {
        lumps.push([
          cx + 4 + Math.floor(rnd() * len * 0.7),
          6 + Math.floor(rnd() * 18),
          rnd() < 0.4 ? 1 : 0,
        ])
      }
      const fringe = []
      for (let f = 0; f < 4; f++) {
        fringe.push([cx + 3 + Math.floor(rnd() * (len - 6)), 1 + Math.floor(rnd() * 3)])
      }
      if (!heavy && k >= 26) continue

      // Overcast takes the sun off the crown, so the slab flattens out.
      const crown = heavy ? T.cloud : T.cloudLit
      for (let r = 0; r < rows; r++) {
        const inset = Math.round((r / rows) * len * 0.34)
        const w = len - inset * 2
        if (w <= 2) continue
        g.fillStyle = r === 0 ? crown : r === rows - 1 ? T.cloudDark : T.cloud
        g.fillRect(cx + inset, cy + r, w, 1)
      }
      for (const [lx, lw, lift] of lumps) {
        g.fillStyle = crown
        g.fillRect(lx, cy - 1 - lift, lw, 2)
      }
      for (const [fx, fw] of fringe) {
        g.fillStyle = T.cloudDark
        g.fillRect(fx, cy + rows, fw, 1)
      }
    }
  }

  /* ---- Skyline ----
     Buildings are walked across the buffer one at a time. Each gets a
     body with a lit left edge and a shadowed right one, a stepped crown
     so the roof line is not a row of flat-topped boxes, mullions and
     floor ledges for structure, plant on the roof, and a window grid.
     A share of the lit windows is kept in a list so they can be
     flickered later without redrawing the layer. */
  function buildCity(seed, o) {
    const buf = makeBuffer(LOOP_W, H)
    const g = buf.x
    const rnd = mulberry32(seed)
    const windows = []
    const snowy = weather === 'snow'

    /* Snow lying on a horizontal edge. Ragged, because a straight white
       line on top of every ledge reads as piping, not as weather.

       It draws from its OWN generator. Sharing the building stream
       would mean the snow consuming random numbers that the dry city
       never consumes, so every building after the first ledge would
       come out somewhere else — and toggling snow would rebuild a
       different skyline instead of dressing this one. */
    const capRnd = mulberry32(seed ^ 0x5f5f5f)
    const cap = (sx, sy, sw, maxD) => {
      if (!snowy || sw < 2) return
      for (let i = 0; i < sw; i++) {
        // the draw always happens — determinism across staged rebuilds —
        // only the drawn depth scales
        const d = Math.round((1 + Math.floor(capRnd() * maxD)) * snowLevel)
        if (d < 1) continue
        g.fillStyle = T.snowLie
        g.fillRect(sx + i, sy - d + 1, 1, d)
        g.fillStyle = T.snowLit
        g.fillRect(sx + i, sy - d + 1, 1, 1)
      }
    }

    let x = -30
    while (x < LOOP_W + 30) {
      let w = o.minW + Math.floor(rnd() * (o.maxW - o.minW))
      let h = o.minH + Math.floor(rnd() * (o.maxH - o.minH))

      /* ---- archetypes ----
         BANDED  continuous lit floor strips instead of a window grid -
                 the office slab, the most recognisable shape in the
                 reference after the neon itself.
         NEEDLE  a narrow spire, far taller than its neighbours.
         SLAB    low, wide, nearer the street.
         GRID    the ordinary tower.
         Picked BEFORE w and h are used, so a needle reshapes itself
         rather than being a normal tower wearing a mast. */
      const roll = rnd()
      const type = roll < 0.22 ? 'banded' : roll < 0.32 ? 'needle' : roll < 0.46 ? 'slab' : 'grid'
      if (type === 'needle') {
        w = Math.max(6, Math.floor(w * 0.45))
        h = Math.floor(h * 1.35)
      } else if (type === 'slab') {
        w = Math.floor(w * 1.5)
        h = Math.floor(h * 0.55)
      }
      const top = SKYLINE - h

      // body
      g.fillStyle = o.fill
      g.fillRect(x, top, w, SKYLINE - top)
      g.fillStyle = o.dark
      g.fillRect(x + w - 1, top, 1, SKYLINE - top)
      g.fillStyle = o.lit
      g.fillRect(x, top, 1, SKYLINE - top)
      g.fillRect(x, top, w, 1)

      /* Mullions and floor ledges. Without them a tower is a flat slab
         with dots on it; a couple of vertical seams and a ledge every
         few floors is enough to give the face a grid to sit in. */
      if (w > 9) {
        g.fillStyle = o.dark
        for (let mx = x + 3; mx < x + w - 2; mx += o.step * 2) {
          g.fillRect(mx, top + 2, 1, SKYLINE - top - 2)
        }
        for (let ly = top + 5; ly < SKYLINE; ly += o.step * 4) {
          g.fillRect(x + 1, ly, w - 2, 1)
        }
      }

      // a mechanical floor — a dead band where no windows are let
      let bandY = -99
      let bandH = 0
      if (h > 70 && rnd() < 0.55) {
        bandH = 4
        bandY = top + 16 + Math.floor(rnd() * Math.max(1, h - 44))
        g.fillStyle = o.dark
        g.fillRect(x + 1, bandY, w - 2, bandH)
        g.fillStyle = o.lit
        g.fillRect(x + 1, bandY, w - 2, 1)
      }

      /* Crown: narrower blocks stacked on the roof. Walks up from the
         body, insetting and shortening, and the last one carries the
         plant — so masts and tanks sit on the crown, not in mid-air. */
      let cx = x
      let cw = w
      let cy = top
      if (h > 78 && w > 12) {
        const steps = 1 + Math.floor(rnd() * 3)
        for (let s = 0; s < steps; s++) {
          const inset = 2 + Math.floor(rnd() * 3)
          if (cw - inset * 2 < 6) break
          const sh = 4 + Math.floor(rnd() * 9)
          cx += inset
          cw -= inset * 2
          cy -= sh
          g.fillStyle = o.fill
          g.fillRect(cx, cy, cw, sh + 1)
          g.fillStyle = o.dark
          g.fillRect(cx + cw - 1, cy, 1, sh)
          g.fillStyle = o.lit
          g.fillRect(cx, cy, cw, 1)
          g.fillRect(cx, cy, 1, sh)
        }
        // a lit band around the top of the crown
        if (rnd() < 0.45 && cw > 5) {
          g.fillStyle = o.neon[Math.floor(rnd() * o.neon.length)]
          g.fillRect(cx + 1, cy + 2, cw - 2, 1)
        }
      }
      cap(cx, cy + 1, cw, 3)
      if (cx > x) {
        cap(x, top + 1, cx - x, 3)
        cap(cx + cw, top + 1, x + w - (cx + cw), 3)
      }

      // rooftop plant: a box, a tank, or a vent stack
      if (rnd() < 0.55 && cw > 10) {
        const aw = 3 + Math.floor(rnd() * 7)
        const ah = 2 + Math.floor(rnd() * 4)
        const ax = cx + 2 + Math.floor(rnd() * Math.max(1, cw - aw - 3))
        g.fillStyle = o.fill
        g.fillRect(ax, cy - ah, aw, ah)
        g.fillStyle = o.lit
        g.fillRect(ax, cy - ah, aw, 1)
        cap(ax, cy - ah + 1, aw, 2)
      }

      // mast, with guy wires and an aircraft warning light
      if (rnd() < 0.34) {
        const mx = cx + Math.floor(cw / 2)
        const mh = 8 + Math.floor(rnd() * 22)
        g.fillStyle = o.dark
        g.fillRect(mx, cy - mh, 1, mh)
        g.fillStyle = o.lit
        for (let k = 0; k < 3; k++) g.fillRect(mx - 2, cy - mh + 6 + k * 6, 5, 1)
        // guys, one either side, stepped a pixel every three rows
        g.fillStyle = o.dark
        for (let k = 0; k < mh; k += 1) {
          if (k % 3) continue
          const dx = Math.round((k / mh) * 6)
          g.fillRect(mx - dx, cy - mh + k, 1, 1)
          g.fillRect(mx + dx, cy - mh + k, 1, 1)
        }
        if (rnd() < 0.55) windows.push({ x: mx, y: cy - mh - 1, w: 1, h: 1, beacon: true })
      }

      /* A banded tower wears continuous strips of lit floor instead of
         a grid of cells: one long window per storey, broken only where
         the structure crosses it. Cheaper to draw than the grid it
         replaces and far more legible at this scale. */
      if (type === 'banded') {
        for (let ly = top + 5; ly < SKYLINE - 3; ly += o.step + 1) {
          if (ly + 1 > bandY && ly < bandY + bandH) continue
          const lit = rnd() < 0.55
          g.fillStyle = lit ? o.window : o.dark
          g.fillRect(x + 2, ly, w - 4, Math.min(2, o.wh))
          if (lit) {
            // a few warm rooms among the cold ones
            if (rnd() < 0.3) {
              g.fillStyle = o.warm
              const sx2 = x + 2 + Math.floor(rnd() * Math.max(1, w - 8))
              g.fillRect(sx2, ly, 3, Math.min(2, o.wh))
            }
            // and the mullions cutting the strip into offices
            g.fillStyle = o.dark
            for (let mx = x + 4; mx < x + w - 3; mx += 4) g.fillRect(mx, ly, 1, Math.min(2, o.wh))
            if (rnd() < 0.3) windows.push({ x: x + 2, y: ly, w: w - 4, h: Math.min(2, o.wh) })
          }
        }
      }

      // window grid
      const cols = type === 'banded' ? 0 : Math.floor((w - 3) / o.step)
      const rows = Math.floor((h - 5) / o.step)
      for (let c = 0; c < cols; c++) {
        // a whole unlet stack reads as a real building, not a texture
        const colDark = rnd() < 0.13
        for (let r = 0; r < rows; r++) {
          /* The unlit cells are DRAWN, not skipped. That is where the
             reference's density actually comes from: every storey of
             every tower carries a visible grid of dark recesses, and
             the lit ones are the minority burning inside it. Skipping
             them left bare wall and forced the lit count up to
             compensate, which is what turned the city amber. */
          const wx0 = x + 2 + c * o.step
          const wy0 = top + 4 + r * o.step
          if (wy0 > SKYLINE - o.wh - 1) continue
          if (wy0 + o.wh > bandY && wy0 < bandY + bandH) continue
          if (colDark || rnd() > o.litChance) {
            g.fillStyle = o.dark
            g.fillRect(wx0, wy0, o.ww, o.wh)
            continue
          }
          const wx = x + 2 + c * o.step
          const wy = top + 4 + r * o.step
          if (wy > SKYLINE - o.wh - 1) continue
          if (wy + o.wh > bandY && wy < bandY + bandH) continue
          const tall = o.wh > 2 && rnd() < 0.12
          const hh = tall ? o.wh + 2 : o.wh
          const warmOne = rnd() < 0.12
          g.fillStyle = warmOne
            ? (snowy ? FESTIVE[((wx >> 2) + wy) % 3] : o.warm)
            : o.window
          g.fillRect(wx, wy, o.ww, hh)
          // a body at the glass — one darker pixel, and the floor lives
          if (o.ww > 2 && rnd() < 0.18) {
            g.fillStyle = o.dark
            g.fillRect(wx + 1, wy + hh - 1, 1, 1)
          }
          if (rnd() < 0.24) windows.push({ x: wx, y: wy, w: o.ww, h: hh })
        }
      }

      /* Neon. A vertical strip, a horizontal band, a billboard or a
         stacked glyph column — each with a dithered halo bleeding onto
         the wall, which is what sells it as light rather than as paint. */
      if (o.neonChance && rnd() < o.neonChance && h > 40 && w > 8) {
        const col = o.neon[Math.floor(rnd() * o.neon.length)]
        const kind = rnd()
        /* Registered as a flickering tube. `sign` entries invert the
           window logic: a window is repainted to go OUT, a sign is
           repainted to come back ON brighter, then drops to a dim
           state between catches. */
        const tube = (tx, ty, tw, th) => {
          windows.push({ x: tx, y: ty, w: tw, h: th, sign: true, col: col, off: o.dark })
        }

        const halo = (hx, hy, hw, hh) => {
          const reach = 8
          for (let yy = hy - reach; yy < hy + hh + reach; yy++) {
            if (yy < top - 2 || yy > SKYLINE) continue
            for (let xx = hx - reach; xx < hx + hw + reach; xx++) {
              if (xx < x || xx > x + w - 1) continue
              const dx = Math.max(0, Math.max(hx - xx, xx - (hx + hw - 1)))
              const dy = Math.max(0, Math.max(hy - yy, yy - (hy + hh - 1)))
              const d = Math.hypot(dx, dy)
              if (d === 0 || d > reach) continue
              const t = 1 - d / reach
              dot(g, xx, yy, t * t * o.halo, col)
            }
          }
        }

        /* ---- the big board ----
           The thing the reference is really built around: a tall lit
           hoarding bolted to a building face, bright frame, dark
           field, rows of glyph blocks down it. At this size a sign
           stops being decoration on a tower and becomes the reason
           the tower is in frame at all. */
        if (kind < 0.20 && h > 90 && w > 18) {
          const bw = Math.min(w - 6, 12 + Math.floor(rnd() * 10))
          const bh = Math.min(h - 30, 40 + Math.floor(rnd() * 60))
          const bx = x + 2 + Math.floor(rnd() * Math.max(1, w - bw - 4))
          const by = top + 8 + Math.floor(rnd() * 20)

          halo(bx, by, bw, bh)
          // the field, then the frame - the tube is the edge, and the
          // panel inside it only catches what the tube throws
          g.fillStyle = o.dark
          g.fillRect(bx, by, bw, bh)
          g.fillStyle = col
          g.fillRect(bx, by, bw, 1)
          g.fillRect(bx, by + bh - 1, bw, 1)
          g.fillRect(bx, by, 1, bh)
          g.fillRect(bx + bw - 1, by, 1, bh)

          /* Glyph blocks running down it. Deliberately not letters:
             invented signage reads as a city you do not have the
             language for, which is exactly the note the reference
             hits, and it never accidentally spells anything. */
          const gs = 3 + Math.floor(rnd() * 2)
          for (let gy = by + 4; gy < by + bh - gs - 2; gy += gs + 3) {
            const inset = 2 + Math.floor(rnd() * 2)
            const gw = bw - inset * 2
            if (gw < 2) continue
            g.fillStyle = col
            // each glyph is a broken bar, not a solid one
            for (let gx = bx + inset; gx < bx + inset + gw; gx++) {
              if (rnd() < 0.24) continue
              g.fillRect(gx, gy, 1, gs)
            }
          }

          // the whole board is one tube, so it guts as a unit
          tube(bx, by, bw, 1)
          tube(bx, by + bh - 1, bw, 1)
          if (rnd() < 0.5) {
            // and a service light on the gantry holding it up
            g.fillStyle = o.warm
            g.fillRect(bx - 1, by + bh + 1, 1, 1)
            g.fillRect(bx + bw, by + bh + 1, 1, 1)
          }
        } else if (kind < 0.3) {
          // vertical strip
          const sx = x + 2 + Math.floor(rnd() * Math.max(1, w - 5))
          const sy = top + 8
          const sh = Math.min(h - 16, 24 + Math.floor(rnd() * 46))
          halo(sx, sy, 2, sh)
          g.fillStyle = col
          g.fillRect(sx, sy, 2, sh)
          tube(sx, sy, 2, sh)
        } else if (kind < 0.52) {
          // horizontal band near the top
          const sy = top + 6 + Math.floor(rnd() * 14)
          halo(x + 2, sy, w - 4, 2)
          g.fillStyle = col
          g.fillRect(x + 2, sy, w - 4, 2)
          tube(x + 2, sy, w - 4, 2)
        } else if (kind < 0.78) {
          /* Billboard. The word is chosen to fit the wall rather than
             the wall being sized to the word, so a narrow tower gets
             BAR and a wide one gets KARAOKE. */
          const room = Math.floor((w - 10) / 4)
          const word = SIGNS.filter((s) => s.length <= room)
          if (word.length) {
            const s = word[Math.floor(rnd() * word.length)]
            const bw = textW(s) + 6
            const bh = 11
            const bx = x + Math.floor((w - bw) / 2)
            const by = top + 10 + Math.floor(rnd() * 18)
            halo(bx, by, bw, bh)
            g.fillStyle = o.dark
            g.fillRect(bx - 1, by - 1, bw + 2, bh + 2)
            g.fillStyle = col
            g.fillRect(bx, by, bw, bh)
            text(g, s, bx + 3, by + 3, o.dark)
          }
        } else {
          /* Vertical signage — a letter to a cell, stacked down a thin
             box. The one arrangement of type this genre never does
             without, and now it is actually spelling a word. */
          const s = TALL_SIGNS[Math.floor(rnd() * TALL_SIGNS.length)]
          const gw = 7
          const gx = x + 2 + Math.floor(rnd() * Math.max(1, w - gw - 3))
          const gy = top + 8
          const gh = s.length * 7
          if (gy + gh < SKYLINE - 4) {
            halo(gx, gy, gw, gh)
            g.fillStyle = o.dark
            g.fillRect(gx - 1, gy - 1, gw + 2, gh + 2)
            g.fillStyle = col
            for (let k = 0; k < s.length; k++) g.fillRect(gx, gy + k * 7, gw, 6)
            for (let k = 0; k < s.length; k++) text(g, s[k], gx + 2, gy + k * 7, o.dark)
          }
        }
      }

      x += w + (rnd() < 0.35 ? 1 + Math.floor(rnd() * 3) : 0)
    }

    // Landmarks go in with the buildings, before the wash, so they take
    // the same aerial perspective as everything else at this depth.
    if (o.landmarks) o.landmarks(g, o, windows, beamSources)

    /* Aerial perspective. Everything at this depth is washed toward the
       horizon colour — stronger the further back, stronger again in fog
       or snow. source-atop keeps it off the transparent sky. */
    const amt = o.fog + fogBoost() * (o.fog > 0.15 ? 1.2 : 0.7)
    if (amt > 0.01) {
      const col = fogColour()
      g.globalCompositeOperation = 'source-atop'
      for (let y = 0; y < SKYLINE + 2; y++) {
        washRow(g, y, LOOP_W, col, amt * (0.42 + 0.58 * (y / SKYLINE)))
      }
      g.globalCompositeOperation = 'source-over'
    }

    return { buf, windows, fill: o.fill }
  }

  /* ==================================================================
     LANDMARKS

     A generated skyline has one problem that no amount of extra
     rendering fixes: every building is the same building. There is
     nothing to point at, so the eye slides off it.

     What fixes it is not more detail — it is a few shapes you can
     *name*. A ferris wheel, a clock tower, a pagoda, a crane, a dome.
     Each one is deliberately plain, because a landmark has to read as
     itself in a single glance at a hundred pixels tall, and anything
     fussy at that size just turns back into skyline.

     They are drawn into the parallax buffers with the buildings, before
     the aerial wash, so they sit at their layer's depth and come round
     with everything else.
     ================================================================== */

  function ferrisWheel(g, o, x, windows) {
    const cy = SKYLINE - 100
    const R = 52
    const CABS = 14

    // A-frame legs down to the ground
    g.fillStyle = o.dark
    for (let k = 0; k <= 100; k++) {
      const t = k / 100
      g.fillRect(Math.round(x - t * 36), cy + k, 2, 1)
      g.fillRect(Math.round(x + t * 36), cy + k, 2, 1)
    }

    /* Outlines use o.window — the brightest structural colour the layer
       has. A landmark drawn in the same values as the buildings around
       it is not a landmark, it is more skyline; it has to sit a step
       above the noise or there is no point placing it by hand. */
    g.fillStyle = o.window
    for (let a = 0; a < 360; a++) {
      const th = (a * Math.PI) / 180
      g.fillRect(Math.round(x + Math.cos(th) * R), Math.round(cy + Math.sin(th) * R), 2, 2)
    }

    // spokes, and a lit cabin at the end of each
    for (let c = 0; c < CABS; c++) {
      const th = (c / CABS) * Math.PI * 2
      const dx = Math.cos(th)
      const dy = Math.sin(th)
      g.fillStyle = o.lit
      for (let k = 5; k < R; k++) {
        g.fillRect(Math.round(x + dx * k), Math.round(cy + dy * k), 1, 1)
      }
      const bx = Math.round(x + dx * (R + 3)) - 2
      const by = Math.round(cy + dy * (R + 3)) - 2
      g.fillStyle = o.warm
      g.fillRect(bx, by, 4, 4)
      // handed to the flicker list so the lights chase round the wheel
      windows.push({ x: bx, y: by, w: 4, h: 4, cabin: true })
    }

    g.fillStyle = o.window
    g.fillRect(x - 4, cy - 4, 8, 8)
  }

  function clockTower(g, o, x) {
    const h = 148
    const top = SKYLINE - h
    const w = 26

    g.fillStyle = o.fill
    g.fillRect(x, top, w, h)
    g.fillStyle = o.window
    g.fillRect(x, top, 1, h)
    g.fillRect(x, top, w, 1)
    g.fillStyle = o.dark
    g.fillRect(x + w - 1, top, 1, h)

    // belfry — a wider stage with arches cut into it
    g.fillStyle = o.fill
    g.fillRect(x - 4, top - 22, w + 8, 22)
    g.fillStyle = o.window
    g.fillRect(x - 4, top - 22, w + 8, 1)
    g.fillRect(x - 4, top - 22, 1, 22)
    g.fillStyle = o.dark
    for (let k = 0; k < 3; k++) g.fillRect(x + 1 + k * 9, top - 17, 5, 14)

    // spire, walked down from the tip so the finial can be lit
    for (let k = 0; k < 28; k++) {
      const half = Math.round((k / 28) * 7)
      g.fillStyle = k < 4 ? o.warm : o.fill
      g.fillRect(x + w / 2 - half, top - 50 + k, half * 2 + 1, 1)
    }

    // the face, with hands. Ten past ten, because every clock in every
    // advertisement is set to ten past ten and it looks right.
    const fx = x + w / 2
    const fy = top + 32
    const fr = 11
    for (let dy = -fr; dy <= fr; dy++) {
      const span = Math.floor(Math.sqrt(Math.max(0, fr * fr - dy * dy)))
      g.fillStyle = o.dark
      g.fillRect(fx - span, fy + dy, span * 2 + 1, 1)
      if (span > 1) {
        g.fillStyle = o.warm
        g.fillRect(fx - span + 1, fy + dy, span * 2 - 1, 1)
      }
    }
    // hands, two pixels thick, or at this size there are no hands
    g.fillStyle = o.dark
    for (let k = 0; k < 8; k++) g.fillRect(fx - k, fy - Math.round(k * 0.6), 2, 2)
    for (let k = 0; k < 6; k++) g.fillRect(fx + k, fy - Math.round(k * 0.8), 2, 2)
  }

  function pagoda(g, o, x) {
    let y = SKYLINE
    let w = 46
    for (let t = 0; t < 5; t++) {
      const bh = 18
      /* Half-widths are rounded before use. The tiers step down by an
         odd number, so x - w/2 lands on a half pixel every other tier —
         and a fillRect on a half pixel is the one thing that puts a
         soft edge in a scene whose whole premise is that there are
         none. */
      const hw = Math.round(w / 2)
      g.fillStyle = o.fill
      g.fillRect(x - hw + 6, y - bh, w - 12, bh)
      g.fillStyle = o.lit
      g.fillRect(x - hw + 6, y - bh, 1, bh)
      g.fillStyle = o.warm
      g.fillRect(x - 4, y - bh + 5, 8, 6)
      // roof: a flat slab with both ends turned up, which is the entire
      // silhouette anyone actually recognises
      g.fillStyle = o.dark
      g.fillRect(x - hw, y - bh - 4, w, 4)
      g.fillStyle = o.window
      g.fillRect(x - hw, y - bh - 4, w, 1)
      g.fillRect(x - hw - 3, y - bh - 6, 4, 2)
      g.fillRect(x + hw - 1, y - bh - 6, 4, 2)
      y -= bh + 6
      w -= 7
    }
    g.fillStyle = o.warm
    g.fillRect(x - 1, y - 11, 2, 11)
    g.fillRect(x - 3, y - 13, 6, 2)
  }

  function crane(g, o, x, windows) {
    const top = SKYLINE - 188

    // lattice mast: two legs and a run of diagonals between them
    g.fillStyle = o.window
    g.fillRect(x, top, 1, SKYLINE - top)
    g.fillRect(x + 8, top, 1, SKYLINE - top)
    g.fillStyle = o.lit
    for (let y = top; y < SKYLINE - 8; y += 8) {
      for (let k = 0; k < 8; k++) g.fillRect(x + k, y + k, 1, 1)
    }

    // apex, jib and counter-jib
    g.fillStyle = o.fill
    g.fillRect(x + 2, top - 12, 5, 12)
    g.fillStyle = o.window
    g.fillRect(x - 32, top + 6, 32, 2)
    g.fillRect(x + 9, top + 6, 76, 2)
    g.fillStyle = o.lit
    g.fillRect(x - 32, top + 8, 12, 7) // counterweight
    for (let k = 0; k < 76; k++) {
      g.fillRect(x + 9 + k, top + 6 - Math.round((1 - k / 76) * 16), 1, 1)
    }

    /* On the hook: a grand piano. It is the oldest joke in the book and
       it is worth it — a crane with a crate on it is a crane, and a
       crane with a piano on it is a scene. */
    g.fillRect(x + 60, top + 8, 1, 40)
    g.fillStyle = o.dark
    g.fillRect(x + 48, top + 48, 26, 7) // case
    g.fillRect(x + 70, top + 44, 8, 4) // the curved tail, squared off
    g.fillStyle = o.window
    g.fillRect(x + 48, top + 48, 26, 1) // lid, catching light
    g.fillRect(x + 50, top + 50, 14, 2) // keys
    g.fillStyle = o.dark
    for (let k = 0; k < 5; k++) g.fillRect(x + 51 + k * 3, top + 50, 1, 1)
    g.fillStyle = o.dark
    g.fillRect(x + 51, top + 55, 2, 3) // legs
    g.fillRect(x + 70, top + 55, 2, 3)

    windows.push({ x: x + 3, y: top - 14, w: 2, h: 2, beacon: true })
  }

  /* ---- the small ones, out in the city ----
     Each is a few pixels on a building somebody else lives in. */

  // A cat sitting in a lit window, which is what cats do.
  function windowCat(g, o, x, y) {
    g.fillStyle = o.warm
    g.fillRect(x, y, 13, 13)
    g.fillStyle = o.dark
    g.fillRect(x + 4, y + 5, 5, 8) // body
    g.fillRect(x + 5, y + 3, 3, 2) // head
    g.fillRect(x + 4, y + 2, 1, 2) // ears
    g.fillRect(x + 8, y + 2, 1, 2)
    g.fillRect(x + 9, y + 9, 3, 1) // tail
    g.fillRect(x, y + 6, 13, 1) // the glazing bar it sits behind
  }

  // A gargoyle leaning off a corner, watching the street.
  function gargoyle(g, o, x, y) {
    g.fillStyle = o.dark
    g.fillRect(x, y + 6, 9, 5) // haunches
    g.fillRect(x + 2, y + 2, 5, 5) // body
    g.fillRect(x + 5, y, 4, 3) // head, craned forward
    g.fillRect(x + 8, y + 1, 2, 1) // snout
    g.fillRect(x - 5, y + 1, 6, 6) // folded wing
    g.fillRect(x + 9, y + 9, 5, 2) // the corbel it crouches on
    g.fillStyle = o.warm
    g.fillRect(x + 7, y + 1, 1, 1) // eye
  }

  // A rooftop pool with a diving board, forty floors up.
  function rooftopPool(g, o, x, y) {
    g.fillStyle = o.dark
    g.fillRect(x - 2, y - 2, 34, 12)
    g.fillStyle = o.window
    g.fillRect(x, y, 30, 8)
    g.fillStyle = o.warm
    for (let k = 0; k < 3; k++) g.fillRect(x + 3 + k * 10, y + 2 + (k & 1) * 3, 5, 1)
    g.fillStyle = o.dark
    g.fillRect(x + 30, y - 5, 9, 2) // board
    g.fillRect(x + 36, y - 3, 2, 3)
  }

  /* A window-washers' cradle, halfway down a face, with two ropes going
     up out of frame and a very small person in it. */
  function windowWashers(g, o, x, top, y) {
    g.fillStyle = o.dark
    g.fillRect(x, top, 1, y - top)
    g.fillRect(x + 17, top, 1, y - top)
    g.fillRect(x - 2, y, 22, 2)
    g.fillRect(x - 2, y, 1, 6)
    g.fillRect(x + 19, y, 1, 6)
    g.fillRect(x - 2, y + 6, 22, 1)
    g.fillStyle = o.lit
    g.fillRect(x + 6, y - 5, 3, 5) // the washer
    g.fillRect(x + 5, y - 7, 5, 2)
    g.fillRect(x + 10, y - 4, 4, 1) // the squeegee, mid-stroke
  }

  function observatory(g, o, x) {
    const R = 26
    const cy = SKYLINE - 54

    g.fillStyle = o.fill
    g.fillRect(x - R, cy, R * 2, 54)
    g.fillStyle = o.window
    g.fillRect(x - R, cy, 1, 54)
    g.fillStyle = o.dark
    g.fillRect(x + R - 1, cy, 1, 54)
    g.fillStyle = o.warm
    for (let k = 0; k < 5; k++) g.fillRect(x - R + 5 + k * 10, cy + 20, 4, 7)

    for (let dy = 0; dy <= R; dy++) {
      const span = Math.floor(Math.sqrt(Math.max(0, R * R - dy * dy)))
      g.fillStyle = o.fill
      g.fillRect(x - span, cy - dy, span * 2 + 1, 1)
      g.fillStyle = o.window
      g.fillRect(x - span, cy - dy, 2, 1)
      if (dy > R - 3) g.fillRect(x - span, cy - dy, span * 2 + 1, 1)
    }

    // the shutter, open, with the instrument sticking out of it
    g.fillStyle = o.dark
    g.fillRect(x - 3, cy - R, 6, R)
    g.fillStyle = o.lit
    g.fillRect(x - 2, cy - R - 9, 4, 13)
  }

  function driveIn(g, o, x, windows) {
    const w = 140
    const h = 76
    const top = SKYLINE - 110

    // legs
    g.fillStyle = o.dark
    g.fillRect(x - 58, top + h, 7, 34)
    g.fillRect(x + 51, top + h, 7, 34)
    for (let k = 0; k < 34; k += 7) g.fillRect(x - 58, top + h + k, 116, 2)

    // frame and picture
    g.fillStyle = o.dark
    g.fillRect(x - 70, top, w, h)
    g.fillStyle = o.window
    g.fillRect(x - 70, top, w, 2)
    g.fillRect(x - 70, top, 2, h)
    g.fillStyle = o.warm
    g.fillRect(x - 65, top + 5, w - 10, h - 10)

    /* Something is playing. A horizon, a sun going down behind it and a
       couple of hills is about as much of a film as forty pixels of
       height can hold, and it is enough to read as a picture rather
       than as a lit rectangle. */
    g.fillStyle = o.dark
    for (let dy = 0; dy <= 13; dy++) {
      const span = Math.floor(Math.sqrt(Math.max(0, 169 - dy * dy)))
      g.fillRect(x - 20 - span, top + 34 - dy, span * 2 + 1, 1)
    }
    g.fillRect(x - 65, top + 40, w - 10, h - 45)
    g.fillStyle = o.fill
    for (let k = 0; k < 46; k++) {
      g.fillRect(x + 4 + k, top + 40 - Math.round(Math.sin((k / 46) * Math.PI) * 14), 1, 14)
    }

    // the marquee under it
    text(g, MOVIES[0], x - Math.round(textW(MOVIES[0]) / 2), top + h + 12, o.window)

    // the picture flickers, the way a projector does
    windows.push({ x: x - 65, y: top + 5, w: w - 10, h: 8 })
    windows.push({ x: x - 65, y: top + h - 13, w: w - 10, h: 8 })
  }

  function lighthouse(g, o, x, beams) {
    const h = 132
    const top = SKYLINE - h

    for (let k = 0; k < h; k++) {
      const half = Math.round(4 + (k / h) * 8)
      g.fillStyle = o.fill
      g.fillRect(x - half, top + k, half * 2, 1)
      g.fillStyle = o.window
      g.fillRect(x - half, top + k, 1, 1)
    }
    // the hoops. A lighthouse without its bands is just a chimney.
    g.fillStyle = o.dark
    for (let k = 12; k < h; k += 24) {
      const half = Math.round(4 + (k / h) * 8)
      g.fillRect(x - half, top + k, half * 2, 5)
    }
    // gallery, lantern room and cap
    g.fillStyle = o.dark
    g.fillRect(x - 9, top - 4, 18, 4)
    g.fillStyle = o.warm
    g.fillRect(x - 5, top - 15, 10, 11)
    g.fillStyle = o.dark
    g.fillRect(x - 7, top - 21, 14, 6)
    g.fillRect(x - 1, top - 26, 2, 5)

    beams.push({ x, y: top - 10 })
  }

  function rocket(g, o, x) {
    const h = 154
    const top = SKYLINE - h

    // service gantry alongside it
    g.fillStyle = o.lit
    g.fillRect(x + 16, top + 18, 2, h - 18)
    g.fillRect(x + 32, top + 18, 2, h - 18)
    g.fillStyle = o.dark
    for (let y = top + 18; y < SKYLINE; y += 11) g.fillRect(x + 16, y, 18, 2)

    // body, with a shadowed side
    g.fillStyle = o.window
    g.fillRect(x - 8, top + 28, 16, h - 28)
    g.fillStyle = o.fill
    g.fillRect(x + 4, top + 28, 4, h - 28)
    g.fillStyle = o.dark
    g.fillRect(x - 8, top + 62, 16, 3)

    // nose cone, walked down from the tip
    g.fillStyle = o.warm
    for (let k = 0; k < 28; k++) {
      const half = Math.round((k / 28) * 8)
      g.fillRect(x - half, top + k, half * 2 + 1, 1)
    }
    // fins
    for (let k = 0; k < 24; k++) {
      const s = Math.round((k / 24) * 9)
      if (!s) continue
      g.fillRect(x - 8 - s, SKYLINE - 24 + k, s, 1)
      g.fillRect(x + 8, SKYLINE - 24 + k, s, 1)
    }
  }

  function stadium(g, o, x) {
    const w = 132
    const h = 42
    const cy = SKYLINE

    // a bowl is widest at its rim, which is the only thing that keeps it
    // from reading as a hill
    for (let dy = 0; dy < h; dy++) {
      const half = Math.round((w / 2) * (0.62 + 0.38 * (dy / h)))
      g.fillStyle = dy > h - 4 ? o.window : o.fill
      g.fillRect(x - half, cy - dy, half * 2, 1)
    }
    g.fillStyle = o.dark
    g.fillRect(x - Math.round(w / 2) + 6, cy - h + 1, w - 12, 3)

    // floodlight masts, which is what says stadium and not arena
    for (const dx of [-54, -19, 19, 54]) {
      g.fillStyle = o.lit
      g.fillRect(x + dx, cy - h - 28, 2, 28)
      g.fillStyle = o.warm
      g.fillRect(x + dx - 5, cy - h - 34, 12, 6)
    }
  }

  function bridge(g, o, x) {
    const span = 224
    const half = span / 2
    const deckY = SKYLINE - 34
    const towerTop = SKYLINE - 132
    const ax = x - half
    const bx = x + half

    g.fillStyle = o.fill
    g.fillRect(ax - 46, deckY, span + 92, 5)
    g.fillStyle = o.window
    g.fillRect(ax - 46, deckY, span + 92, 1)

    for (const tx of [ax, bx]) {
      g.fillStyle = o.fill
      g.fillRect(tx - 4, towerTop, 3, SKYLINE - towerTop)
      g.fillRect(tx + 3, towerTop, 3, SKYLINE - towerTop)
      g.fillStyle = o.window
      g.fillRect(tx - 4, towerTop, 10, 2)
      g.fillRect(tx - 4, towerTop + 26, 10, 2)
    }

    /* Main cable as a real catenary between the towers, with a hanger
       dropped to the deck every twelve pixels. The hangers are what make
       it a suspension bridge rather than an arch. */
    for (let k = 0; k <= span; k++) {
      const y = Math.round(towerTop + Math.sin((k / span) * Math.PI) * 64)
      g.fillStyle = o.window
      g.fillRect(ax + k, y, 1, 1)
      if (k % 12 === 0 && y < deckY) {
        g.fillStyle = o.lit
        g.fillRect(ax + k, y, 1, deckY - y)
      }
    }
    // back stays down to the abutments
    g.fillStyle = o.window
    for (let k = 0; k < 46; k++) {
      g.fillRect(ax - 46 + k, towerTop + Math.round((1 - k / 46) * 46), 1, 1)
      g.fillRect(bx + k, towerTop + Math.round((k / 46) * 46), 1, 1)
    }
  }

  function radioDish(g, o, x) {
    const R = 33
    const cy = SKYLINE - 66

    g.fillStyle = o.dark
    g.fillRect(x - 3, cy, 7, 66)
    g.fillRect(x - 15, SKYLINE - 9, 31, 9)

    // the pan, then a smaller one cut out of it, so it reads as a dish
    // with a face rather than as a ball
    for (let dy = -R; dy <= R; dy++) {
      const s = Math.floor(Math.sqrt(Math.max(0, R * R - dy * dy)))
      g.fillStyle = o.window
      g.fillRect(x - s, cy + dy, s * 2 + 1, 1)
    }
    for (let dy = -R + 5; dy <= R - 5; dy++) {
      const s = Math.floor(Math.sqrt(Math.max(0, (R - 5) * (R - 5) - dy * dy)))
      g.fillStyle = o.fill
      g.fillRect(x - s + 4, cy + dy, s * 2 + 1, 1)
    }

    // feed horn on its tripod
    g.fillStyle = o.window
    g.fillRect(x - 2, cy - 17, 5, 7)
    for (let k = 0; k < 17; k++) {
      g.fillRect(x - Math.round(k * 1.1), cy - 17 + k, 1, 1)
      g.fillRect(x + Math.round(k * 1.1), cy - 17 + k, 1, 1)
    }
  }

  /* Standing outside the natural history museum, presumably. */
  function dinosaur(g, o, x) {
    g.fillStyle = o.dark
    g.fillRect(x - 36, SKYLINE - 11, 72, 11)
    const B = SKYLINE - 11

    g.fillRect(x - 7, B - 27, 9, 27) // legs
    g.fillRect(x + 6, B - 25, 9, 25)
    for (let k = 0; k < 28; k++) {
      const half = Math.round(15 * Math.sin((k / 28) * Math.PI) + 5)
      g.fillRect(x - half + 4, B - 27 - k, half * 2, 1)
    }
    for (let k = 0; k < 36; k++) {
      const t = k / 36
      g.fillRect(x + 17 + k, B - 46 + Math.round(t * t * 30), Math.max(1, Math.round(8 * (1 - t))), 3)
    }
    for (let k = 0; k < 22; k++) {
      const t = k / 22
      g.fillRect(x - 13 - Math.round(t * 13), B - 52 - Math.round(t * 17), 8, 3)
    }
    g.fillRect(x - 35, B - 72, 17, 9) // head
    g.fillRect(x - 40, B - 67, 6, 4) // jaw
    g.fillStyle = o.warm
    g.fillRect(x - 31, B - 70, 2, 2) // eye
  }

  /* A lit signboard standing on a building's roof, with a support
     lattice and a dithered halo. Drawn into a skyline buffer so it
     parallaxes with the building it belongs to. */
  function signboard(g, x, y, word) {
    const w = 78
    const h = 28

    for (let yy = y - 9; yy < y + h + 9; yy++) {
      for (let xx = x - 9; xx < x + w + 9; xx++) {
        if (xx < 0 || xx >= LOOP_W) continue
        const dx = Math.max(0, Math.max(x - xx, xx - (x + w - 1)))
        const dy = Math.max(0, Math.max(y - yy, yy - (y + h - 1)))
        const d = Math.hypot(dx, dy)
        if (d === 0 || d > 9) continue
        dot(g, xx, yy, (1 - d / 9) * 0.75, T.sign)
      }
    }

    // support lattice rather than a plain leg
    g.fillStyle = T.signBox
    g.fillRect(x + w / 2 - 7, y + h, 3, 18)
    g.fillRect(x + w / 2 + 4, y + h, 3, 18)
    for (let k = 0; k < 3; k++) g.fillRect(x + w / 2 - 7, y + h + 4 + k * 5, 14, 2)

    // box, frame and the name on it
    g.fillStyle = T.signBox
    g.fillRect(x, y, w, h)
    g.fillStyle = T.sign
    g.fillRect(x + 2, y + 2, w - 4, 2)
    g.fillRect(x + 2, y + h - 4, w - 4, 2)
    text(g, word, x + Math.round((w - textW(word)) / 2), y + 11, T.sign)
  }

  function buildSkyline() {
    beamSources = []

    /* The far ridge: low, wide, nearly featureless towers one step off
       the haze colour. No neon, almost no windows, no flicker — at that
       distance a city is a shape, not an event. It drifts slowest of
       all, which is what tells the eye it is furthest away. */
    ridge = buildCity(7777, {
      minW: 26, maxW: 60, minH: 18, maxH: 64,
      step: 6, ww: 1, wh: 1, litChance: 0.1,
      neon: T.neon, neonChance: 0, halo: 0, fog: 0.46,
      ...T.cityFar,
    })

    city = [
      buildCity(4411, {
        minW: 12, maxW: 26, minH: 60, maxH: 150,
        step: 4, ww: 2, wh: 2, litChance: 0.30,
        neon: T.neon, neonChance: 0.18, halo: T.halo, fog: T.fogAmt[0],
        ...T.city[0],
        landmarks: (g, o) => {
          stadium(g, o, 420)
          bridge(g, o, 1020)
          radioDish(g, o, 1640)
        },
      }),
      buildCity(881, {
        minW: 16, maxW: 34, minH: 90, maxH: 205,
        step: 5, ww: 2, wh: 3, litChance: 0.34,
        neon: T.neon, neonChance: 0.32, halo: T.halo, fog: T.fogAmt[1],
        ...T.city[1],
        /* Spread across the loop so that at any moment one or two are
           in frame and the rest are on their way round. */
        landmarks: (g, o, windows) => {
          ferrisWheel(g, o, 140, windows)
          driveIn(g, o, 560, windows)
          clockTower(g, o, 900)
          crane(g, o, 1300, windows)
          rocket(g, o, 1750)
          windowCat(g, o, 372, SKYLINE - 96)
          windowWashers(g, o, 1075, SKYLINE - 190, SKYLINE - 96)
          rooftopPool(g, o, 690, SKYLINE - 152)
        },
      }),
      buildCity(2266, {
        minW: 22, maxW: 46, minH: 50, maxH: 130,
        step: 7, ww: 3, wh: 3, litChance: 0.3,
        neon: T.neon, neonChance: 0.36, halo: T.halo, fog: T.fogAmt[2],
        ...T.city[2],
        landmarks: (g, o, windows, beams) => {
          lighthouse(g, o, 180, beams)
          pagoda(g, o, 690)
          dinosaur(g, o, 1080)
          observatory(g, o, 1500)
          gargoyle(g, o, 940, SKYLINE - 118)
          windowCat(g, o, 1666, SKYLINE - 74)
        },
      }),
    ]

    // signboards on the mid skyline, spread so one is usually in frame
    signboard(city[1].buf.x, 210, SKYLINE - 172, 'RAMEN 24H')
    signboard(city[1].buf.x, 980, SKYLINE - 146, 'HELLO WORLD')
    signboard(city[1].buf.x, 1560, SKYLINE - 190, 'STAY AWHILE')

    /* One tower has its lit windows arranged to spell something. It is
       drawn at two pixels to a letter-pixel on the *mid* skyline, on the
       same grid pitch as every other window, so it reads as an ordinary
       office block until the moment it doesn't. */
    const g = city[1].buf.x
    const msg = 'HI'
    for (let i = 0; i < msg.length; i++) {
      const gl = FONT[msg[i]]
      for (let r = 0; r < 5; r++) {
        const bits = +gl[r]
        for (let c = 0; c < 3; c++) {
          if (!(bits & (4 >> c))) continue
          g.fillStyle = T.city[1].warm
          g.fillRect(1300 + i * 10 + c * 3, SKYLINE - 128 + r * 3, 2, 2)
        }
      }
    }
  }

  /* ==================================================================
     ELEVATED LINE

     A viaduct across the middle distance, between the near buildings
     and the rooftop. It carries the scene's third depth plane, and
     every so often a train crosses it.

     The deck is a lattice girder rather than a plain band, and there is
     a catenary strung above it — the train's pantographs reach up to
     that wire, which is what stops a fast train reading as a sticker
     sliding along a shelf.
     ================================================================== */
  const WIRE_Y = VIA_Y - 46

  function buildViaduct() {
    viaduct = makeBuffer(LOOP_W, H)
    const g = viaduct.x
    const snowy = weather === 'snow'

    // Piers, dropping out of frame behind the parapet.
    for (let x = 30; x < LOOP_W; x += 104) {
      const pierH = ROOF_TOP - VIA_Y
      g.fillStyle = T.viaduct
      g.fillRect(x, VIA_Y + VIA_H, 15, pierH)
      g.fillStyle = T.viaductLit
      g.fillRect(x, VIA_Y + VIA_H, 2, pierH)
      g.fillStyle = T.viaductDark
      g.fillRect(x + 13, VIA_Y + VIA_H, 2, pierH)
      // haunch where the pier meets the deck
      g.fillStyle = T.viaduct
      g.fillRect(x - 5, VIA_Y + VIA_H, 25, 4)
      g.fillStyle = T.viaductLit
      g.fillRect(x - 5, VIA_Y + VIA_H, 25, 1)
      // grime running down from the deck joint
      g.fillStyle = T.viaductDark
      for (let k = 0; k < 4; k++) {
        g.fillRect(x + 3 + k * 3, VIA_Y + VIA_H + 5, 1, 6 + ((k * 5) % 11))
      }
    }

    /* Lattice girder under the deck: a top and bottom chord with
       alternating diagonals between them. Stepping each diagonal one
       pixel across per row is how a diagonal is drawn on a grid. */
    const gT = VIA_Y + VIA_H
    const gB = VIA_Y + VIA_H + 9
    g.fillStyle = T.viaductDark
    g.fillRect(0, gB - 1, LOOP_W, 2)
    for (let x = 0; x < LOOP_W; x += 14) {
      g.fillStyle = T.viaduct
      for (let k = 0; k < 9; k++) {
        g.fillRect(x + Math.round((k / 9) * 13), gT + k, 1, 1)
        g.fillRect(x + 13 - Math.round((k / 9) * 13), gT + k, 1, 1)
      }
      g.fillStyle = T.viaductLit
      g.fillRect(x, gT, 1, 9)
    }

    // Deck.
    g.fillStyle = T.viaductDark
    g.fillRect(0, VIA_Y - 1, LOOP_W, 1)
    g.fillStyle = T.viaductLit
    g.fillRect(0, VIA_Y, LOOP_W, 2)
    g.fillStyle = T.viaduct
    g.fillRect(0, VIA_Y + 2, LOOP_W, VIA_H - 4)
    g.fillStyle = T.viaductDark
    g.fillRect(0, VIA_Y + VIA_H - 2, LOOP_W, 2)

    // Sleepers and the two running rails.
    g.fillStyle = T.viaductDark
    for (let x = 0; x < LOOP_W; x += 4) g.fillRect(x, VIA_Y + 2, 2, 3)
    g.fillStyle = T.viaductLit
    g.fillRect(0, VIA_Y + 2, LOOP_W, 1)
    g.fillRect(0, VIA_Y + 5, LOOP_W, 1)

    // A neon strip along the deck edge — the line advertising itself.
    g.fillStyle = T.trainStripe
    g.fillRect(0, VIA_Y + VIA_H - 4, LOOP_W, 1)
    for (let x = 0; x < LOOP_W; x++) {
      dot(g, x, VIA_Y + VIA_H - 5, 0.5, T.trainStripe)
      dot(g, x, VIA_Y + VIA_H - 3, 0.5, T.trainStripe)
    }

    // Guard posts, and a lamp every fifth one.
    for (let x = 8, i = 0; x < LOOP_W; x += 16, i++) {
      g.fillStyle = T.viaductLit
      g.fillRect(x, VIA_Y - 6, 1, 6)
      if (i % 5) continue
      g.fillStyle = T.viaductLit
      g.fillRect(x - 1, VIA_Y - 14, 1, 8)
      g.fillRect(x - 3, VIA_Y - 14, 3, 1)
      g.fillStyle = T.trainWin
      g.fillRect(x - 4, VIA_Y - 13, 3, 2)
      // dithered pool of lamplight on the deck
      for (let dy = 0; dy < 6; dy++) {
        for (let dx = -8; dx <= 8; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= LOOP_W) continue
          dot(g, xx, VIA_Y - 1 + dy, (1 - Math.abs(dx) / 9) * (1 - dy / 6) * 0.55, T.trainWin)
        }
      }
    }

    /* Catenary. Masts every 104px with a cantilever arm, and the
       contact wire the pantographs run under. */
    for (let x = 82; x < LOOP_W; x += 104) {
      g.fillStyle = T.viaductDark
      g.fillRect(x, WIRE_Y - 8, 2, VIA_Y - WIRE_Y + 8)
      g.fillStyle = T.viaductLit
      g.fillRect(x, WIRE_Y - 8, 1, VIA_Y - WIRE_Y + 8)
      g.fillRect(x - 12, WIRE_Y - 8, 14, 1)
      g.fillStyle = T.viaductDark
      g.fillRect(x - 12, WIRE_Y - 7, 1, 7)
    }
    g.fillStyle = T.viaductDark
    g.fillRect(0, WIRE_Y, LOOP_W, 1)

    // Snow lying on every horizontal the line offers.
    if (snowy) {
      const rnd = mulberry32(5150)
      for (let x = 0; x < LOOP_W; x++) {
        const d = Math.round((1 + Math.floor(rnd() * 2)) * snowLevel)
        if (d < 1) continue
        g.fillStyle = T.snowLie
        g.fillRect(x, VIA_Y - d, 1, d)
        g.fillStyle = T.snowLit
        g.fillRect(x, VIA_Y - d, 1, 1)
      }
    }
  }

  /* ==================================================================
     THE ROOFTOP

     Static, so anything standing on it stays put while the city slides
     past behind. Three versions of it get built from the same code:

       dry   gravel, tar seams, a little neon bounce on the coping
       wet   the deck goes dark and reflective, the coping picks up a
             specular line and drips down its face, and the whole field
             carries vertical streaks of sign colour
       snow  a blanket over the deck, a cap on every horizontal, and
             icicles hanging off the coping's undercut
     ================================================================== */
  function buildRoof() {
    roof = makeBuffer(W, H)
    const g = roof.x
    const rnd = mulberry32(808)
    const wet = weather === 'rain'
    const snowy = weather === 'snow'
    roofLights = []
    puddles = []

    const capY = ROOF_TOP + 3

    /* Snow lying on a horizontal edge, ragged along its top. */
    const capRnd = mulberry32(9090)
    const snowCap = (sx, sy, sw, maxD) => {
      if (!snowy || sw < 1) return
      const d0 = maxD || 3
      for (let i = 0; i < sw; i++) {
        const d = Math.round((1 + Math.floor(capRnd() * d0)) * snowLevel)
        if (d < 1) continue
        g.fillStyle = T.snowLie
        g.fillRect(sx + i, sy - d + 1, 1, d + 1)
        g.fillStyle = T.snowLit
        g.fillRect(sx + i, sy - d + 1, 1, 1)
      }
    }

    /* Every prop is built from the same four faces so it reads as a
       solid: a lit top, a lit left, a shadowed right, a dark foot. */
    const box = (bx, by, bw, bh, capped) => {
      g.fillStyle = T.rail
      g.fillRect(bx, by, bw, bh)
      g.fillStyle = T.roofLit
      g.fillRect(bx, by, bw, 2)
      g.fillRect(bx, by, 2, bh)
      g.fillStyle = T.railDark
      g.fillRect(bx + bw - 2, by, 2, bh)
      g.fillRect(bx, by + bh - 1, bw, 1)
      if (capped !== false) snowCap(bx, by, bw, 3)
    }

    // ---- deck ----
    g.fillStyle = wet ? T.wetDeck : T.roof
    g.fillRect(0, ROOF_TOP, W, H - ROOF_TOP)
    g.fillStyle = T.roofLit
    g.fillRect(0, ROOF_TOP, W, 2)

    /* Gravel. Every stone is a lit pixel with a dark one directly under
       it — a chip with its own shadow, which is what separates texture
       from noise. A loose scatter of single pixels in three colours is
       just dirt on the screen, so there are far fewer of them than a
       scatter would use and only two values in play. */
    for (let i = 0; i < 900; i++) {
      const x = Math.floor(rnd() * W)
      const y = ROOF_TOP + 8 + Math.floor(rnd() * (H - ROOF_TOP - 12))
      const sw = rnd() < 0.28 ? 2 : 1
      // Wet ballast is mostly under water. The same stones are drawn in
      // both states, just fewer of them — drawing a *different* number
      // of them would consume the stream differently and shuffle the
      // whole deck every time the rain is toggled.
      if (wet && i % 5) continue
      g.fillStyle = T.roofSpeck
      g.fillRect(x, y, sw, 1)
      g.fillStyle = T.roofDark
      g.fillRect(x, y + 1, sw, 1)
    }

    /* Tar seams. Straight runs with one deliberate step in each, rather
       than a random walk — a seam is laid by a person, so it is
       basically straight, and a wobbling line reads as a mistake. */
    g.fillStyle = T.roofDark
    for (let y = ROOF_TOP + 58, s = 0; y < H; y += 38, s++) {
      const step = 260 + s * 90
      for (let x = 0; x < W; x++) g.fillRect(x, y + (x > step ? 1 : 0), 1, 1)
    }

    /* ---- wet field ----
       The whole deck, not a patch of it. Vertical streaks of sign colour
       bleeding down the roof are what make a surface read as reflective;
       the puddles then sit on top as harder, brighter mirrors. */
    if (wet) {
      // a broad mirror band along the near side of the parapet
      for (let k = 0; k < 26; k++) {
        const t = 1 - k / 26
        washRow(g, capY + 44 + k, W, T.wetGloss, t * 0.3)
      }
      /* Reflection streaks. Sparse, and each one starts at a tar seam
         rather than anywhere at all — water runs from somewhere. They
         are dim on purpose: a reflection is a *hint* of the colour
         above it, and at full strength every one of them reads as a
         stray line of neon lying on the floor. */
      for (let i = 0; i < 62; i++) {
        const x = Math.floor(rnd() * W)
        const len = 12 + Math.floor(rnd() * 40)
        const col = T.wet[Math.floor(rnd() * T.wet.length)]
        const y0 = ROOF_TOP + 58 + Math.floor(rnd() * 3) * 38
        for (let k = 0; k < len; k++) {
          const y = y0 + k
          if (y >= H) break
          dot(g, x, y, (1 - k / len) * 0.3, col)
        }
      }

      /* Puddles. Flattened pools with a bright rim and horizontal bands
         of sign colour lying in them — a reflection is banded, because
         the water is not flat. */
      for (let i = 0; i < 9; i++) {
        const pw = 40 + Math.floor(rnd() * 90)
        const ph = 7 + Math.floor(rnd() * 10)
        const pxc = Math.floor(rnd() * (W - pw))
        const pyc = ROOF_TOP + 34 + Math.floor(rnd() * (H - ROOF_TOP - 50))
        puddles.push({ x: pxc, y: pyc, w: pw, h: ph })
        for (let y = 0; y < ph; y++) {
          const half = Math.round((pw / 2) * Math.sqrt(Math.max(0, 1 - ((y - ph / 2) / (ph / 2)) ** 2)))
          if (half < 1) continue
          const cx0 = pxc + pw / 2
          g.fillStyle = T.puddle
          g.fillRect(Math.round(cx0 - half), pyc + y, half * 2, 1)
        }
        /* Two reflection bands, laid across the middle of the pool and
           tapering out at the ends. Any more and the water stops being
           water and becomes a stripe. */
        for (let b = 0; b < 2; b++) {
          const by = pyc + 2 + b * 3
          if (by >= pyc + ph - 1) break
          const half = Math.round((pw / 2) * 0.7)
          const col = T.wet[Math.floor(rnd() * T.wet.length)]
          for (let x = -half; x <= half; x++) {
            dot(g, Math.round(pxc + pw / 2 + x), by, (1 - Math.abs(x) / half) * 0.45, col)
          }
        }
        // a dark lip along the far edge is what seats the pool in the
        // deck; a bright rim all the way round makes it float
        g.fillStyle = T.roofDark
        for (let x = 0; x < pw; x++) {
          const t = 1 - Math.abs(x - pw / 2) / (pw / 2)
          if (t < 0.2) continue
          g.fillRect(pxc + x, pyc + Math.round((ph / 2) * (1 - Math.sqrt(t))), 1, 1)
        }
      }
    }

    /* ---- snow field ----
       A blanket over the whole deck. It thickens toward the viewer, and
       the gravel is left showing through at the top of the field so the
       deck does not become a flat white slab. */
    if (snowy) {
      for (let y = ROOF_TOP + 2; y < H; y++) {
        const t = (T.blanket[0] + T.blanket[1] * ((y - ROOF_TOP) / (H - ROOF_TOP))) * snowLevel
        washRow(g, y, W, T.snowLie, t)
      }
      /* Drifts. Six of them, wide and shallow, each drawn as a *form*
         rather than as a cloud of dither: a lit crown along the top of
         the mound and a shadow immediately under its foot. Two lines is
         all it takes to make a bank read; thirty patches of speckle
         only make the deck look dirty. */
      for (let i = 0; i < 6; i++) {
        const dw = 150 + Math.floor(rnd() * 220)
        const dx = Math.floor(rnd() * W) - dw / 2
        const dy = ROOF_TOP + 46 + Math.floor(rnd() * (H - ROOF_TOP - 66))
        const dh = 4 + Math.floor(rnd() * 6)
        for (let k = 0; k < dw; k++) {
          const x = Math.round(dx + k)
          if (x < 0 || x >= W) continue
          const rise = Math.round(dh * Math.sin((k / dw) * Math.PI) * snowLevel)
          if (rise < 1) continue
          g.fillStyle = T.snowLie
          g.fillRect(x, dy - rise, 1, rise)
          g.fillStyle = T.snowLit
          g.fillRect(x, dy - rise, 1, 1)
          g.fillStyle = T.snowDark
          g.fillRect(x, dy, 1, 1)
        }
      }
    }

    /* ---- parapet ----
       A flat bar reads as a sticker. This is built as a solid with
       thickness: a coping stone whose TOP face catches light and whose
       FRONT face falls into shadow, a dark undercut beneath it, then
       balusters lit on one side and shadowed on the other. */

    /* ---- separating the roof from the city ----

       These two planes kept collapsing into one. The roof and the
       skyline can land on the same value — badly in day, worst of all
       under snow, where the deck goes pale AND the city is washed pale
       by the snow light, so the two meet with nothing between them.

       Two things fix it, and it needs both:

       1. A short dithered band of haze laid over the city immediately
          above the parapet, lifting the background away from the
          foreground's value. This is the atmospheric trick done on
          purpose — the further plane pales as it approaches the nearer
          one's edge — and it gives the silhouette something to be dark
          against no matter what the weather has done to either. */
    /* Which way the band goes depends on what the foreground is doing,
       and getting that backwards is worse than not having it.

       Dry, the roof is the darker plane, so the city is *lifted* behind
       it and the silhouette bites. Under snow both planes go pale — the
       deck from the blanket, the city from the snow light — and lifting
       the background is then exactly the wrong move: it walks the two
       values together. So under snow the buildings' bottoms are
       *darkened* instead, and the pale roof reads against them. */
    const sepCol = snowy ? T.sepDark : T.sep
    const sepAmt = snowy ? 0.66 : 0.5
    for (let k = 0; k < 24; k++) {
      washRow(g, ROOF_TOP - 1 - k, W, sepCol, (1 - k / 24) * sepAmt)
    }

    /*  2. The single most important line in the whole scene: a hard,
          near-black rim along the very top of the coping, in a colour
          used for nothing else so it can go as dark as it needs to. A
          silhouette edge is what separates a foreground from a
          background in pixel art, and three pixels was not enough of
          it once the coping could be covered in snow. */
    g.fillStyle = T.edge
    g.fillRect(0, capY - 4, W, 4)

    // coping — top face, front face, undercut
    g.fillStyle = T.railLit
    g.fillRect(0, capY, W, 3)
    g.fillStyle = T.rail
    g.fillRect(0, capY + 3, W, 6)
    g.fillStyle = T.railDark
    g.fillRect(0, capY + 9, W, 3)

    // coping joints every stone's length, and a chipped corner or two
    g.fillStyle = T.railDark
    for (let x = 13; x < W; x += 41) g.fillRect(x, capY, 1, 9)
    for (let i = 0; i < 22; i++) {
      const x = Math.floor(rnd() * W)
      g.fillStyle = T.railDark
      g.fillRect(x, capY, 1 + Math.floor(rnd() * 2), 1)
    }

    // balusters, each with its own lit and shadowed side
    for (let x = 5; x < W; x += 27) {
      g.fillStyle = T.rail
      g.fillRect(x, capY + 12, 6, 22)
      g.fillStyle = T.railLit
      g.fillRect(x, capY + 12, 1, 22)
      g.fillStyle = T.railDark
      g.fillRect(x + 5, capY + 12, 1, 22)
      g.fillRect(x + 1, capY + 32, 4, 2)
      snowCap(x, capY + 12, 6, 3)
    }

    // bottom rail
    g.fillStyle = T.railLit
    g.fillRect(0, capY + 34, W, 2)
    g.fillStyle = T.rail
    g.fillRect(0, capY + 36, W, 5)
    g.fillStyle = T.railDark
    g.fillRect(0, capY + 41, W, 2)

    /* Neon bounce. The city throws coloured light up onto the coping and
       across the near deck; dithered patches of sign colour along the
       cap are what stop the whole foreground reading as flat black. */
    // Sixteen pools, not thirty-four: enough to keep the coping from
    // reading flat, few enough that none of it reads as stray pixels.
    for (let i = 0; i < 16; i++) {
      const bx = Math.floor(rnd() * W)
      const bw = 20 + Math.floor(rnd() * 46)
      const col = T.bounce[Math.floor(rnd() * T.bounce.length)]
      for (let k = 0; k < 4; k++) {
        const y = capY + k
        const t = (1 - k / 4) * (wet ? 0.5 : 0.24)
        for (let x = bx; x < bx + bw && x < W; x++) {
          dot(g, x, y, t * (1 - Math.abs(x - (bx + bw / 2)) / (bw / 2)), col)
        }
      }
    }

    /* ---- the railing in the wet ----
       A hard specular line along the coping's top face, and water
       running down the front of it. Wet stone is not darker everywhere,
       it is darker with a bright edge — that contrast is the whole
       reading. */
    if (wet) {
      /* One specular line along the coping's top face and nothing else
         on it. A scatter of bright pixels along a highlight does not
         read as water — it reads as damage. The line breaks only where
         the coping joints already are, so what interrupts it is the
         stonework rather than randomness. */
      g.fillStyle = T.wetGloss
      g.fillRect(0, capY, W, 1)
      g.fillStyle = T.railDark
      for (let x = 13; x < W; x += 41) g.fillRect(x, capY, 1, 1)

      /* Drips hang from the joints, because that is where water
         collects and runs — not from every third pixel. */
      for (let x = 13; x < W; x += 41) {
        const len = 4 + ((x * 7) % 6)
        for (let k = 0; k < len; k++) dot(g, x, capY + 4 + k, (1 - k / len) * 0.5, T.wetGloss)
      }

      // a thin sheen on the bottom rail, at half the strength of the cap
      for (let x = 0; x < W; x++) dot(g, x, capY + 34, 0.5, T.wetGloss)
    }

    /* ---- the railing under snow ----
       This is where it should pile deepest: a horizontal ledge at chest
       height catches everything. A thick ragged bank along the coping,
       plus icicles hanging off the undercut, which is the detail that
       says it has been snowing for a while rather than for a minute. */
    if (snowy) {
      /* The bank on the coping. Its top edge steps once every few
         pixels rather than every pixel — a per-pixel random walk is
         static, not snow — and it is laid down in three parts: a hard
         dark rim, a lit crown just under it, then the body. That rim is
         the same silhouette line the dry coping carries. Weather is
         allowed to change the shape of the parapet; it is not allowed
         to dissolve its edge. */
      let d = 6
      for (let x = 0; x < W; x++) {
        if (x % 5 === 0) d += rnd() < 0.5 ? 1 : -1
        if (d < 5) d = 5
        if (d > 8) d = 8
        const dl = Math.max(1, Math.round(d * snowLevel))
        const topY = capY - dl
        g.fillStyle = T.snowLie
        g.fillRect(x, topY, 1, dl + 4)
        g.fillStyle = T.snowLit
        g.fillRect(x, topY + 2, 1, 1)
        /* Two pixels of the silhouette colour, not one. The bank is the
           palest thing in the scene and it sits against a sky the snow
           light has also gone pale — one pixel of rim disappears
           between them. */
        g.fillStyle = T.edge
        g.fillRect(x, topY, 1, 2)
        g.fillStyle = T.snowDark
        g.fillRect(x, topY + 3, 1, 1) // shade under the crown
        g.fillRect(x, capY + 4, 1, 1)
      }
      // icicles, hanging from the coping joints — only once the snow is
      // established; melt needs something to melt from
      if (snowLevel > 0.6)
      for (let x = 13; x < W; x += 41) {
        const len = 4 + ((x * 5) % 7)
        g.fillStyle = T.ice
        g.fillRect(x, capY + 12, 1, len)
        g.fillStyle = T.snowLit
        g.fillRect(x, capY + 12, 1, 2)
      }
      // and lying flat along the bottom rail
      g.fillStyle = T.snowLie
      g.fillRect(0, capY + 33, W, 2)
      g.fillStyle = T.snowLit
      g.fillRect(0, capY + 33, W, 1)

      /* Somebody has strung lights along the whole railing. The
         positions join roofLights, so they twinkle and cycle festive
         colours through the same code as the deck garlands. */
      if (snowLevel > 0.3) {
        for (let x = 18; x < W; x += 36) roofLights.push({ x, y: capY - 7 })
        // and wound the light poles in red - candy canes, effectively
        for (const pole of [58, 302, 566, 830]) {
          for (let y = ROOF_TOP + 30; y < ROOF_TOP + 98; y += 8) {
            g.fillStyle = FESTIVE[0]
            g.fillRect(pole, y, 3, 4)
          }
        }
      }

      /* ---- the tree ----
         Somebody has put a tree up on the deck, because it snowed and
         that is what people do. Three green tiers, a trunk, a star, and
         festive bulbs baked on. It appears once the snow has settled
         in, not with the first flake. */
      if (snowLevel > 0.4) {
        const tx = 550
        const tb = ROOF_TOP + 88
        g.fillStyle = '#2a1a10'
        g.fillRect(tx - 2, tb - 4, 5, 5)
        for (let tier = 0; tier < 3; tier++) {
          const ty = tb - 8 - tier * 9
          const half = 11 - tier * 3
          for (let r = 0; r < 8; r++) {
            const hw = Math.round(half * (1 - r / 9))
            g.fillStyle = r % 3 ? '#1d5c33' : '#2a7a44'
            g.fillRect(tx - hw, ty - r, hw * 2 + 1, 1)
          }
        }
        // bulbs, wound round the tiers
        for (let b = 0; b < 9; b++) {
          const ty = tb - 9 - b * 3
          const sway = Math.round(Math.sin(b * 2.1) * (9 - b))
          g.fillStyle = FESTIVE[b % 3]
          g.fillRect(tx + sway, ty, 2, 2)
        }
        // the star
        g.fillStyle = T.gold || '#f8c838'
        g.fillRect(tx - 1, tb - 36, 3, 3)
        g.fillRect(tx, tb - 38, 1, 7)
        g.fillRect(tx - 3, tb - 35, 7, 1)
        // snow on the tiers
        g.fillStyle = T.snowLit
        g.fillRect(tx - 8, tb - 10, 6, 1)
        g.fillRect(tx + 3, tb - 19, 5, 1)
        g.fillRect(tx - 4, tb - 27, 4, 1)

        // presents under it, ribbons crossed
        g.fillStyle = FESTIVE[0]
        g.fillRect(tx - 18, tb - 8, 11, 8)
        g.fillStyle = '#f8c838'
        g.fillRect(tx - 14, tb - 8, 2, 8)
        g.fillRect(tx - 18, tb - 5, 11, 2)
        g.fillStyle = FESTIVE[1]
        g.fillRect(tx + 10, tb - 7, 9, 7)
        g.fillStyle = FESTIVE[0]
        g.fillRect(tx + 13, tb - 7, 2, 7)
        g.fillStyle = T.snowLit
        g.fillRect(tx - 18, tb - 9, 11, 1)

        /* and a wreath on the hutch door: a green diamond ring with a
           red bow, eight pixels of Christmas */
        const wx2 = 150
        const wy2 = ROOF_TOP + 52
        g.fillStyle = '#2a7a44'
        g.fillRect(wx2 - 3, wy2 - 1, 2, 3)
        g.fillRect(wx2 + 2, wy2 - 1, 2, 3)
        g.fillRect(wx2 - 1, wy2 - 3, 3, 2)
        g.fillRect(wx2 - 1, wy2 + 2, 3, 2)
        g.fillStyle = FESTIVE[0]
        g.fillRect(wx2 - 1, wy2 + 3, 3, 2)
      }
    }

    /* ---- separation, re-asserted last ----
       Whatever the weather has just done to the coping, the parapet has
       to go on reading as a plane standing in front of the city, and
       that reading rests on two edges: the hard rim along its top, and
       a shadow under its foot where it meets the deck. The rim is drawn
       into the coping above; this is the foot. Both are laid down after
       the weather so that nothing can bury them. */
    g.fillStyle = T.edge
    g.fillRect(0, capY + 43, W, 2)
    for (let k = 0; k < 6; k++) {
      washRow(g, capY + 45 + k, W, T.roofDark, (1 - k / 6) * 0.62)
    }

    /* ---- props ---- */

    // stairwell hutch, left of centre, with a door and a neon over it
    box(108, ROOF_TOP + 16, 96, 68)
    g.fillStyle = T.railDark
    g.fillRect(140, ROOF_TOP + 44, 22, 40)
    g.fillStyle = T.roofLit
    g.fillRect(140, ROOF_TOP + 44, 22, 1)
    g.fillRect(158, ROOF_TOP + 60, 2, 4)
    g.fillStyle = T.signBox
    g.fillRect(126, ROOF_TOP + 26, 52, 12)
    g.fillStyle = T.sign
    g.fillRect(129, ROOF_TOP + 29, 46, 2)
    for (let k = 0; k < 5; k++) g.fillRect(130 + k * 9, ROOF_TOP + 33, 6, 3)
    for (let y = ROOF_TOP + 20; y < ROOF_TOP + 46; y++) {
      for (let x = 116; x < 190; x++) {
        const dx = Math.max(0, Math.max(126 - x, x - 177))
        const dy = Math.max(0, Math.max(ROOF_TOP + 26 - y, y - (ROOF_TOP + 37)))
        const d = Math.hypot(dx, dy)
        if (d === 0 || d > 8) continue
        dot(g, x, y, (1 - d / 8) * 0.7, T.sign)
      }
    }
    // graffiti tag on the hutch flank
    g.fillStyle = T.neon[0]
    for (let k = 0; k < 7; k++) {
      g.fillRect(112 + k * 3, ROOF_TOP + 56 + ((k * 5) % 7), 2, 8 - ((k * 3) % 5))
    }

    // water tank on legs, far left
    g.fillStyle = T.railDark
    g.fillRect(28, ROOF_TOP + 52, 3, 22)
    g.fillRect(74, ROOF_TOP + 52, 3, 22)
    box(22, ROOF_TOP + 22, 60, 32)
    g.fillStyle = T.railDark
    for (let k = 0; k < 3; k++) g.fillRect(22, ROOF_TOP + 28 + k * 9, 60, 1)
    g.fillStyle = T.roofLit // ladder
    for (let k = 0; k < 7; k++) g.fillRect(84, ROOF_TOP + 24 + k * 5, 6, 1)
    g.fillRect(84, ROOF_TOP + 22, 1, 34)
    g.fillRect(89, ROOF_TOP + 22, 1, 34)

    // stacked crates, with slats
    box(330, ROOF_TOP + 48, 30, 22)
    box(338, ROOF_TOP + 30, 22, 18)
    g.fillStyle = T.railDark
    for (let k = 0; k < 3; k++) g.fillRect(332, ROOF_TOP + 53 + k * 6, 26, 1)

    // air handling units, right, with fan grills and louvers
    box(786, ROOF_TOP + 38, 74, 36)
    box(872, ROOF_TOP + 52, 40, 24)
    g.fillStyle = T.railDark
    for (let r = 0; r < 5; r++) g.fillRect(790, ROOF_TOP + 44 + r * 5, 30, 2)
    for (let ring = 3; ring <= 11; ring += 4) {
      for (let a = 0; a < 28; a++) {
        const th = (a / 28) * Math.PI * 2
        g.fillRect(Math.round(838 + Math.cos(th) * ring), Math.round(ROOF_TOP + 56 + Math.sin(th) * ring), 1, 1)
      }
    }

    // ducting between them, with support brackets and an elbow
    g.fillStyle = T.rail
    g.fillRect(96, ROOF_TOP + 92, 236, 6)
    g.fillRect(596, ROOF_TOP + 100, 192, 6)
    g.fillStyle = T.roofLit
    g.fillRect(96, ROOF_TOP + 92, 236, 1)
    g.fillRect(596, ROOF_TOP + 100, 192, 1)
    g.fillStyle = T.railDark
    for (let x = 104; x < 330; x += 26) g.fillRect(x, ROOF_TOP + 92, 2, 6)
    for (let x = 604; x < 786; x += 26) g.fillRect(x, ROOF_TOP + 100, 2, 6)
    snowCap(96, ROOF_TOP + 92, 236, 2)
    snowCap(596, ROOF_TOP + 100, 192, 2)

    // satellite dish with a feed arm and a mount
    g.fillStyle = T.rail
    for (let i = 0; i < 17; i++) {
      const span = Math.floor(Math.sqrt(Math.max(0, 289 - (i - 8) * (i - 8) * 4)))
      g.fillRect(930 - span, ROOF_TOP + 14 + i, span * 2, 1)
    }
    g.fillStyle = T.roofLit
    for (let i = 0; i < 17; i++) {
      const span = Math.floor(Math.sqrt(Math.max(0, 289 - (i - 8) * (i - 8) * 4)))
      g.fillRect(930 - span, ROOF_TOP + 14 + i, 1, 1)
    }
    g.fillStyle = T.railDark
    g.fillRect(929, ROOF_TOP + 30, 3, 18)
    g.fillRect(922, ROOF_TOP + 46, 17, 3)
    g.fillRect(936, ROOF_TOP + 18, 1, 6)
    g.fillRect(933, ROOF_TOP + 22, 4, 1)

    /* String lights across the deck. Poles with a catenary sagging
       between them, a bulb every few pixels — the one warm colour in a
       foreground otherwise lit entirely by signage. */
    const poles = [58, 302, 566, 830]
    for (const p of poles) {
      g.fillStyle = T.rail
      g.fillRect(p, ROOF_TOP + 26, 3, 74)
      g.fillStyle = T.roofLit
      g.fillRect(p, ROOF_TOP + 26, 1, 74)
      g.fillStyle = T.railDark
      g.fillRect(p - 3, ROOF_TOP + 26, 9, 2)
      snowCap(p - 3, ROOF_TOP + 26, 9, 2)
    }
    for (let s = 0; s < poles.length - 1; s++) {
      const x0 = poles[s] + 1
      const x1 = poles[s + 1] + 1
      const span = x1 - x0
      for (let x = x0; x <= x1; x++) {
        const t = (x - x0) / span
        const y = Math.round(ROOF_TOP + 27 + Math.sin(t * Math.PI) * 22)
        g.fillStyle = T.railDark
        g.fillRect(x, y, 1, 1)
        if ((x - x0) % 34 === 16) roofLights.push({ x, y: y + 1 })
      }
    }

    /* A washing line between the hutch and the second light pole.
       Somebody lives up here. Nothing else on this roof says that, and
       one line of laundry says it instantly. */
    g.fillStyle = T.railDark
    for (let x = 204; x <= 302; x++) {
      const t = (x - 204) / 98
      g.fillRect(x, Math.round(ROOF_TOP + 34 + Math.sin(t * Math.PI) * 7), 1, 1)
    }

    /* ==================================================================
       SOMEBODY'S ROOF

       The deck is the biggest-pixel real estate in the scene — nothing
       is more than a metre or two away — so it is where detail actually
       pays. Everything below is a discrete object you can name, placed
       by hand, none of it overlapping anything else. The point is that
       you can sit and go round it: the telescope, the deck chair, the
       tomatoes, the bike, the chess game nobody finished.
       ================================================================== */

    // antenna array on the hutch roof
    g.fillStyle = T.railDark
    g.fillRect(150, ROOF_TOP - 2, 1, 18)
    for (let k = 0; k < 4; k++) g.fillRect(144, ROOF_TOP + 2 + k * 4, 13, 1)
    g.fillRect(176, ROOF_TOP + 4, 1, 12)
    g.fillRect(172, ROOF_TOP + 4, 9, 1)

    // weathervane on the water tank, pointing east because it always is
    g.fillStyle = T.railDark
    g.fillRect(52, ROOF_TOP + 8, 1, 14)
    g.fillRect(46, ROOF_TOP + 12, 13, 1)
    g.fillStyle = T.roofLit
    g.fillRect(56, ROOF_TOP + 9, 4, 3)

    /* Everything below lives between y 452 and 494 — the strip of deck
       between the foot of the parapet and the lowest row that survives
       the crop on a wide viewport. It is only forty pixels tall, which
       is the real constraint on this whole scene: the closest, most
       detailed part of it is also the thinnest. */

    // a bike, leaning on the hutch
    g.fillStyle = T.railDark
    for (const wx of [210, 228]) {
      for (let a = 0; a < 22; a++) {
        const th = (a / 22) * Math.PI * 2
        g.fillRect(Math.round(wx + Math.cos(th) * 6), Math.round(484 + Math.sin(th) * 6), 1, 1)
      }
    }
    g.fillRect(212, 476, 15, 1)
    g.fillRect(216, 478, 1, 7)
    g.fillRect(224, 478, 1, 7)
    g.fillRect(226, 473, 5, 1) // bars
    g.fillRect(213, 474, 4, 1) // saddle

    /* Telescope on a tripod, pointed up and to the left — at the moon,
       which is up and to the left. */
    g.fillStyle = T.railDark
    g.fillRect(386, 478, 1, 14)
    g.fillRect(380, 480, 1, 12)
    g.fillRect(392, 480, 1, 12)
    g.fillRect(380, 486, 13, 1)
    for (let k = 0; k < 16; k++) g.fillRect(392 - k, 476 - Math.round(k * 0.6), 2, 3)
    g.fillStyle = T.roofLit
    g.fillRect(376, 466, 3, 3) // the objective end, catching light
    g.fillRect(390, 476, 3, 1)

    // deck chair, striped
    g.fillStyle = T.railDark
    g.fillRect(414, 484, 2, 9)
    g.fillRect(430, 484, 2, 9)
    for (let k = 0; k < 14; k++) {
      g.fillStyle = k & 2 ? T.cloth[1] : T.cloth[2]
      g.fillRect(416 + k, 474 + Math.round(k * 0.62), 1, 10)
    }

    /* A planter run — somebody is growing tomatoes up here. Each plant
       is a cane, a stem and two leaves, which at this size is a plant. */
    box(482, 482, 70, 11)
    for (let p = 0; p < 5; p++) {
      const cane = 488 + p * 13
      g.fillStyle = T.railDark
      g.fillRect(cane, 462, 1, 21)
      // The third one did not make it. Four thriving plants is a
      // planter; three thriving and one brown stick is a person.
      const dead = p === 2
      g.fillStyle = dead ? '#7a6038' : '#3d7a3a'
      g.fillRect(cane - 3, dead ? 474 : 470, 3, 1)
      if (!dead) {
        g.fillRect(cane + 1, 466, 3, 1)
        g.fillRect(cane - 2, 476, 3, 1)
      }
      if (!dead && p % 2) {
        g.fillStyle = '#c8402c'
        g.fillRect(cane + 1, 473, 2, 2)
      }
    }

    // a skateboard, left where it was stepped off
    g.fillStyle = T.railDark
    g.fillRect(572, 488, 18, 2)
    g.fillRect(574, 490, 2, 2)
    g.fillRect(586, 490, 2, 2)
    g.fillStyle = T.cloth[0]
    g.fillRect(572, 487, 18, 1)

    // a boombox, and the coffee nobody finished
    box(600, 478, 22, 11, false)
    g.fillStyle = T.railDark
    for (const sx of [604, 615]) {
      for (let a = 0; a < 14; a++) {
        const th = (a / 14) * Math.PI * 2
        g.fillRect(Math.round(sx + Math.cos(th) * 3), Math.round(484 + Math.sin(th) * 3), 1, 1)
      }
    }
    g.fillStyle = T.lamp
    g.fillRect(607, 480, 5, 1)

    /* A chess game on a crate. Nobody has moved in a while. */
    box(638, 470, 26, 23)
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 4; c++) {
        g.fillStyle = (r + c) & 1 ? T.roofLit : T.railDark
        g.fillRect(641 + c * 5, 473 + r * 4, 5, 4)
      }
    }
    g.fillStyle = T.roofLit
    g.fillRect(643, 471, 2, 3)
    g.fillRect(658, 483, 2, 3)
    g.fillStyle = T.railDark
    g.fillRect(653, 475, 2, 3)
    g.fillStyle = T.cloth[2] // a mug on the corner
    g.fillRect(660, 467, 3, 4)

    // paint cans and a ladder lying flat
    box(676, 480, 9, 10, false)
    box(687, 484, 8, 7, false)
    g.fillStyle = T.roofLit
    g.fillRect(676, 480, 9, 2)
    g.fillStyle = T.railDark
    g.fillRect(672, 492, 32, 1)
    for (let k = 0; k < 5; k++) g.fillRect(675 + k * 7, 492, 1, 3)

    // traffic cones, because there is always a reason
    for (const cone of [716, 730]) {
      for (let k = 0; k < 10; k++) {
        const half = Math.round((k / 10) * 4)
        g.fillStyle = k > 3 && k < 6 ? T.roofLit : '#c85a2a'
        g.fillRect(cone - half, 482 + k, half * 2 + 1, 1)
      }
      g.fillStyle = '#c85a2a'
      g.fillRect(cone - 5, 492, 11, 2)
    }

    // a stack of tyres
    for (let k = 0; k < 3; k++) {
      g.fillStyle = T.railDark
      g.fillRect(748, 488 - k * 5, 22, 5)
      g.fillStyle = T.roofSpeck
      g.fillRect(748, 488 - k * 5, 22, 1)
      g.fillStyle = T.rail
      g.fillRect(755, 490 - k * 5, 8, 2)
    }

    // the cat's bowl, directly under where the cat sits
    g.fillStyle = T.railDark
    g.fillRect(778, 488, 12, 5)
    g.fillStyle = T.roofLit
    g.fillRect(778, 488, 12, 1)
    g.fillStyle = T.catCollar
    g.fillRect(782, 490, 4, 1)

    /* ---- the small ones ----
       None of these is bigger than a few pixels and none of them is on
       the path your eye takes the first time. That is the point: the
       scene should still have something left in it on the fourth look.
       ---------------------------------------------------------------- */

    // A spider has taken the corner where the parapet meets the hutch.
    g.fillStyle = T.roofSpeck
    for (let k = 1; k <= 7; k++) {
      g.fillRect(96, 452 + k, 1, 1)
      g.fillRect(96 + k, 452, 1, 1)
      g.fillRect(96 + k, 452 + (8 - k), 1, 1)
    }
    g.fillStyle = T.railDark
    g.fillRect(99, 455, 2, 2)

    // A mouse hole in the hutch skirting, and a trail of crumbs.
    g.fillStyle = T.railDark
    g.fillRect(196, 483, 5, 5)
    g.fillStyle = T.roofDark
    g.fillRect(197, 484, 3, 4)
    g.fillStyle = T.roofLit
    for (let k = 0; k < 4; k++) g.fillRect(203 + k * 5, 486 + (k & 1), 1, 1)

    // A doormat at the hutch door, and the key nobody hides well.
    g.fillStyle = T.railDark
    g.fillRect(138, 489, 26, 5)
    g.fillStyle = T.roofSpeck
    for (let k = 0; k < 12; k++) g.fillRect(140 + k * 2, 490, 1, 3)
    g.fillStyle = T.lamp
    g.fillRect(166, 492, 3, 1)
    g.fillRect(169, 491, 1, 3)

    // The cat's toy mouse, nowhere near the cat.
    g.fillStyle = T.roofSpeck
    g.fillRect(796, 490, 5, 3)
    g.fillStyle = T.catCollar
    g.fillRect(801, 491, 4, 1) // tail

    /* Pawprints, crossing the deck and stopping at the parapet, which
       is where the cat is. */
    g.fillStyle = T.roofDark
    for (let k = 0; k < 9; k++) {
      const fx = 700 - k * 13
      const fy = 490 - k * 3 - (k & 1 ? 3 : 0)
      if (fy < 456) break
      g.fillRect(fx, fy, 2, 2)
      g.fillRect(fx - 2, fy - 1, 1, 1)
      g.fillRect(fx + 2, fy - 1, 1, 1)
    }

    // One slice of last night's pizza, still in the box.
    g.fillStyle = T.roofSpeck
    g.fillRect(626, 490, 12, 4)
    g.fillStyle = T.lamp
    g.fillRect(628, 491, 8, 2)
    g.fillStyle = '#c8402c'
    g.fillRect(630, 492, 1, 1)
    g.fillRect(634, 491, 1, 1)

    // A coin, on its edge in a crack. It has been there a while.
    g.fillStyle = T.lamp
    g.fillRect(470, 492, 1, 3)
    g.fillStyle = T.lampDim
    g.fillRect(471, 493, 1, 2)

    /* A rubber duck. There is no explaining a rubber duck. */
    g.fillStyle = '#e8c23a'
    g.fillRect(928, 484, 11, 7)
    g.fillRect(935, 479, 6, 5)
    g.fillStyle = '#c8942a'
    g.fillRect(928, 490, 11, 1)
    g.fillStyle = '#e0662a'
    g.fillRect(941, 481, 3, 2)
    g.fillStyle = T.railDark
    g.fillRect(939, 480, 1, 1)

    /* Steam vent. The plume itself is drawn per frame; this is the pipe
       it comes out of. */
    g.fillStyle = T.rail
    g.fillRect(468, ROOF_TOP + 66, 12, 26)
    g.fillStyle = T.roofLit
    g.fillRect(468, ROOF_TOP + 66, 12, 2)
    g.fillRect(468, ROOF_TOP + 66, 2, 26)
    g.fillStyle = T.railDark
    g.fillRect(466, ROOF_TOP + 64, 16, 3)
  }

  function buildStatic() {
    buildSky()
    buildSkyline()
    buildClouds()
    buildViaduct()
    buildRoof()
  }

  /* ==================================================================
     PARTICLES
     ================================================================== */
  const stars = (function () {
    const rnd = mulberry32(9271)
    const out = []
    for (let i = 0; i < 900; i++) {
      const x = Math.floor(rnd() * W)
      const y = Math.floor(rnd() * (SKYLINE - 130))
      if (rnd() < y / (SKYLINE - 130)) continue
      if (Math.hypot(x - ORB_X, y - ORB_Y) < ORB_R + 22) continue
      out.push({
        x, y,
        bright: rnd(),
        warm: rnd() < 0.06,
        phase: Math.floor(rnd() * 40),
        rate: 16 + Math.floor(rnd() * 30),
      })
    }
    return out
  })()

  const birds = (function () {
    const rnd = mulberry32(4242)
    const out = []
    for (let i = 0; i < 10; i++) {
      out.push({
        x: rnd() * W,
        y: 60 + rnd() * 150,
        sp: 0.7 + rnd() * 1.3,
        rate: 2 + Math.floor(rnd() * 2),
        phase: Math.floor(rnd() * 4),
        size: rnd() < 0.4 ? 3 : 4,
      })
    }
    return out
  })()

  /* Craft crossing the skyline, blinking as they go. */
  const craft = [
    { y: 118, sp: 0.55, off: 0, len: 11 },
    { y: 196, sp: -0.38, off: 620, len: 8 },
    { y: 70, sp: 0.28, off: 300, len: 13 },
    { y: 152, sp: -0.62, off: 940, len: 9 },
    { y: 232, sp: 0.44, off: 160, len: 7 },
  ]

  /* Satellites. Two pixels crossing very slowly and very high, one of
     them tumbling so it winks out every few seconds. They are the
     smallest possible thing in the scene, and the sky needs something
     that moves at almost no speed at all to sit against the clouds. */
  /* Felis Minor. Ears, head, chest, back, rump, tail. */
  const CAT_NODES = [
    [688, 100], [698, 86], [708, 100], [690, 118],
    [712, 124], [734, 138], [754, 128], [766, 104],
  ]
  const CAT_LINES = [
    [688, 100, 698, 86], [698, 86, 708, 100], [688, 100, 690, 118],
    [708, 100, 712, 124], [690, 118, 712, 124], [712, 124, 734, 138],
    [734, 138, 754, 128], [754, 128, 766, 104],
  ]

  const satellites = [
    { y: 38, sp: 0.20, off: 120, blink: 0 },
    { y: 88, sp: -0.14, off: 640, blink: 17 },
  ]

  /* ---- Rain ----
     Drops fall in front of the panel, but what they *hit* is drawn on
     the scene canvas, so a splash lands behind the window rather than
     on top of it.

     Landings are spread three ways: most along the parapet — the roof's
     leading edge, where a line of spray reads best — the rest out across
     the deck, plus a share marked to fall past everything, which keeps
     the curtain full height instead of stopping dead at the railing. */
  const RAIN_N = 240
  const drops = []
  const splashes = []
  const rainRnd = mulberry32(3141)

  function resetDrop(d, high) {
    d.x = rainRnd() * (W + 160) - 80
    d.y = high ? -10 - rainRnd() * 60 : -10 - rainRnd() * 420
    d.len = 7 + Math.floor(rainRnd() * 12)
    d.sp = 16 + rainRnd() * 13
    const roll = rainRnd()
    d.passes = roll < 0.2
    if (d.passes) d.landY = H + 20
    else if (roll < 0.62) d.landY = ROOF_TOP + 2 + rainRnd() * 10
    else d.landY = ROOF_TOP + 48 + rainRnd() * (H - ROOF_TOP - 52)
    return d
  }
  for (let i = 0; i < RAIN_N; i++) drops.push(resetDrop({}, false))

  function stepRain(p, live, k) {
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i]
      d.y += d.sp * k
      d.x += 2.4 * k
      if (d.x > W + 80) d.x -= W + 160

      // The panel is a surface too — anything over it lands on its lip.
      let landY = d.landY
      let onPanel = false
      if (p && d.x >= p.x0 && d.x <= p.x1 && p.y0 > 0 && p.y0 < landY) {
        landY = p.y0
        onPanel = true
      }
      if (d.y >= landY) {
        // only live drops land, or the roof keeps being hit by rain
        // that is no longer falling
        if (i < live && landY < H) {
          splashes.push({ x: Math.round(d.x), y: Math.round(landY), age: 0, onPanel })
        }
        resetDrop(d, true)
      }
    }
  }

  function drawDrops(live) {
    const g = wctx
    for (let i = 0; i < live; i++) {
      const d = drops[i]
      const hx = Math.round(d.x)
      const hy = Math.round(d.y)
      if (hy < -20) continue
      g.fillStyle = T.rainDrop
      for (let k = 1; k < d.len; k++) g.fillRect(hx - Math.round(k * 0.24), hy - k, 1, 1)
      g.fillStyle = T.rainHi
      g.fillRect(hx, hy, 1, 2)
    }
  }

  /* A splash plays three drawn frames and dies — sprite animation, not
     a fade. Ground splashes go on the scene canvas, panel ones on the
     overlay, so each is occluded by the right thing. */
  function drawSplashes(g, onPanel) {
    for (const s of splashes) {
      if (!!s.onPanel !== onPanel) continue
      const a = Math.floor(s.age)
      if (a <= 0) {
        g.fillStyle = T.rainHi
        g.fillRect(s.x, s.y, 2, 1)
      } else if (a === 1) {
        g.fillStyle = T.rainHi
        g.fillRect(s.x - 2, s.y - 1, 1, 1)
        g.fillRect(s.x + 2, s.y - 1, 1, 1)
        g.fillRect(s.x - 1, s.y, 3, 1)
      } else {
        g.fillStyle = T.rainDrop
        g.fillRect(s.x - 3, s.y - 1, 1, 1)
        g.fillRect(s.x + 3, s.y - 1, 1, 1)
        g.fillRect(s.x - 2, s.y, 5, 1)
      }
    }
  }

  function ageSplashes(k) {
    for (let i = splashes.length - 1; i >= 0; i--) {
      splashes[i].age += k
      if (splashes[i].age > 2.5) splashes.splice(i, 1)
    }
  }

  /* Ripple rings in the standing water, one puddle at a time so the
     field keeps moving without every pool pulsing in step. */
  function drawRipples() {
    if (!puddles.length) return
    for (let k = 0; k < 3; k++) {
      const p = puddles[(frame * 5 + k * 7) % puddles.length]
      const r = 1 + ((frame + k * 4) % 5)
      const cx = p.x + Math.round((((frame * 13 + k * 29) % 97) / 97) * p.w)
      const cy = p.y + Math.round(p.h / 2)
      ctx.fillStyle = T.puddleRim
      for (let a = 0; a < 14; a++) {
        const th = (a / 14) * Math.PI * 2
        const rx = Math.round(cx + Math.cos(th) * r * 2)
        const ry = Math.round(cy + Math.sin(th) * r * 0.6)
        if (rx < p.x || rx > p.x + p.w || ry < p.y || ry > p.y + p.h) continue
        ctx.fillRect(rx, ry, 1, 1)
      }
    }
  }

  /* ---- Water on the glass ----
     The panel is the one surface in the scene facing the viewer, so
     rain hitting it does not splash and vanish — it sticks. Beads sit
     on the pane, and every so often one gets heavy enough to run,
     sweeping up the beads it passes and leaving a clean track behind
     it. That track is the whole effect: a streak nobody has wiped.

     Everything is held in normalised panel space, 0 to 1 across and
     down, so the water stays on the window when the viewport changes
     shape instead of sliding off it.

     Two rules govern it.

     WHERE. Only the outer sixth of the pane, each side. Water tracking
     across a line of type makes the type harder to read and starts
     looking like dirt on the screen rather than weather on a window, so
     the middle is left alone entirely.

     HOW. A drop on glass does not slide, it creeps. Surface tension
     pins it; it builds until it tears loose, runs a little way, picks
     up whatever it touches, gets heavier and faster for it, and pins
     again. So a runner carries a mass, accelerates from nothing, stalls
     at intervals, and only reaches its top speed once it has swept up a
     few beads on the way down. Drops moving at a constant speed were
     the whole reason the first attempt read as rain drawn on top of a
     window instead of water sitting on one. */
  const EDGE = 0.16 // how far in from each side the water may come

  const beads = []
  const runners = []
  const glassRnd = mulberry32(1717)

  const edgeU = () => (glassRnd() < 0.5 ? glassRnd() * EDGE : 1 - glassRnd() * EDGE)

  function resetBead(b) {
    b.u = edgeU()
    b.v = glassRnd()
    b.big = glassRnd() < 0.24
    return b
  }
  for (let i = 0; i < 48; i++) beads.push(resetBead({}))

  function stepGlass(k) {
    // a new runner now and then, started from a bead that has grown
    if (runners.length < 3 && glassRnd() < 0.03 * k) {
      const b = beads[Math.floor(glassRnd() * beads.length)]
      runners.push({ u: b.u, from: b.v, v: b.v, sp: 0.0015, mass: 1, stall: 0 })
      resetBead(b)
    }

    for (let i = runners.length - 1; i >= 0; i--) {
      const r = runners[i]

      if (r.stall > 0) {
        r.stall -= k
        r.sp *= Math.pow(0.45, k) // pinned: it drags to a halt rather than stopping dead
      } else {
        // top speed rises with mass, so a fat drop outruns a thin one
        r.sp = Math.min(0.004 + r.mass * 0.0016, r.sp + 0.0009 * k)
        if (glassRnd() < 0.1 * k) r.stall = 2 + Math.floor(glassRnd() * 6)
      }
      r.v += r.sp * k

      // water finds a path rather than falling straight, but it is not
      // allowed to wander in over the type
      if (glassRnd() < 0.14 * k) {
        r.u += (glassRnd() - 0.5) * 0.01
        r.u = r.u < 0.5 ? Math.min(r.u, EDGE) : Math.max(r.u, 1 - EDGE)
        r.u = Math.max(0, Math.min(1, r.u))
      }

      // sweep up what it runs over, and get heavier for it
      for (const b of beads) {
        if (Math.abs(b.u - r.u) < 0.008 && b.v > r.from && b.v < r.v) {
          r.mass++
          resetBead(b)
        }
      }

      if (r.v > 1) runners.splice(i, 1)
    }
  }

  function drawGlass(p) {
    if (!p || p.y0 <= 0) return
    const pw = p.x1 - p.x0
    const ph = p.y1 - p.y0
    if (pw < 8 || ph < 8) return
    const g = wctx

    // the glass wets and dries at the same rate as the fall
    const live = Math.round(beads.length * wx)
    for (let i = 0; i < live; i++) {
      const b = beads[i]
      const x = Math.round(p.x0 + b.u * pw)
      const y = Math.round(p.y0 + b.v * ph)
      if (b.big) {
        g.fillStyle = T.rainDrop
        g.fillRect(x, y, 2, 2)
      }
      g.fillStyle = T.rainHi
      g.fillRect(x, y, 1, 1)
    }

    for (const r of runners) {
      const x = Math.round(p.x0 + r.u * pw)
      const y0 = Math.round(p.y0 + r.from * ph)
      const y = Math.min(Math.round(p.y0 + r.v * ph), Math.round(p.y1) - 1)
      const span = Math.max(1, y - y0)
      /* The track dries from the top down — faintest where it is oldest,
         wettest just behind the head. A track at one strength all the
         way up is a ruled line, not a trail. */
      for (let yy = y0; yy < y; yy++) {
        dot(g, x, yy, 0.1 + 0.38 * ((yy - y0) / span), T.rainDrop)
      }
      if (r.v >= 1) continue
      g.fillStyle = T.rainDrop
      g.fillRect(x, y, 2, 3) // the head, heavier than its own track
      g.fillStyle = T.rainHi
      g.fillRect(x, y, 1, 1)
    }
  }

  /* ---- Lightning ----
     A strike is an event on a timer, the same way the train is. It runs
     a short envelope of discrete steps rather than a fade: a hard
     flash, a gap of almost nothing, then a weaker second one — which is
     what a strike actually does, and what a smooth fade never reads as.
     Each step is one whole frame at 12fps, so it is stepped for free.

     At the peak the sky is washed *to the lightning colour itself*,
     because for that frame the storm is the only light source in the
     scene and everything else should lose to it. The bolt's halo is
     drawn in that same colour, so on the peak frame the halo disappears
     into the flashed sky and what is left is a clean white channel —
     and on the weaker frames the halo comes back. */
  const BOLT_ENV = [1, 0.5, 0.05, 0.8, 0.34, 0.12, 0.04]
  let strikeAt = 96
  let strikeSeed = 7331

  function strikeStep() {
    if (weather !== 'rain') return -1
    const d = frame - strikeAt
    if (d < 0) return -1
    if (d < BOLT_ENV.length) return d
    // done — roll the next one, eight to twenty-eight seconds out
    strikeSeed = (Math.imul(strikeSeed, 1103515245) + 12345) >>> 0
    strikeAt = frame + 96 + (strikeSeed % 240)
    return -1
  }

  function drawBolt(seed) {
    const rnd = mulberry32(seed)
    const bottom = SKYLINE - 40 - Math.floor(rnd() * 90)

    /* A channel is drawn as a solid core with a dithered halo either
       side. Both are walked from a path worked out first, so a fork can
       be hung off the main channel at the right x. */
    const channel = (path, y0, w) => {
      for (let k = 0; k < path.length; k++) {
        const y = y0 + k
        if (y < 0 || y >= SKYLINE) break
        const cx = path[k]
        for (let s = 1; s <= 4; s++) {
          dot(ctx, cx - s, y, (1 - s / 5) * 0.85, T.lightning)
          dot(ctx, cx + w - 1 + s, y, (1 - s / 5) * 0.85, T.lightning)
        }
        ctx.fillStyle = T.boltCore
        ctx.fillRect(cx, y, w, 1)
      }
    }

    let x = 110 + Math.floor(rnd() * (W - 220))
    const main = []
    for (let y = 0; y < bottom; y++) {
      if ((y & 1) === 0) x += Math.round((rnd() - 0.5) * 5)
      main.push(x)
    }
    channel(main, 0, 2)

    // forks, peeling away from the channel and dying out
    for (let f = 0; f < 3; f++) {
      const fy = 50 + Math.floor(rnd() * Math.max(1, bottom - 100))
      const flen = 30 + Math.floor(rnd() * 80)
      const dir = rnd() < 0.5 ? -1 : 1
      let fx = main[Math.min(fy, bottom - 1)]
      const fork = []
      for (let k = 0; k < flen; k++) {
        fx += dir * (rnd() < 0.6 ? 1 : 0)
        if (rnd() < 0.25) fx += Math.round((rnd() - 0.5) * 3)
        fork.push(fx)
      }
      channel(fork, fy, 1)
    }
  }

  /* ---- Snow ----
     Slower than rain and drifting sideways on a sine. Instead of
     splashing it settles: each flake that lands adds a pixel to a
     per-column depth array. Landing in the *lowest* of the three
     columns under the flake gives the bank an angle of repose, so it
     grows into drifts rather than into a comb. */
  const SNOW_N = 220
  const PILE_CAP = 18
  const PANEL_CAP = 14
  const flakes = []
  const snowPile = new Int8Array(W)
  const panelPile = new Int8Array(W)
  const snowRnd = mulberry32(2718)

  function resetFlake(f, high) {
    f.x = snowRnd() * (W + 40) - 20
    f.y = high ? -6 - snowRnd() * 50 : -6 - snowRnd() * 540
    f.sp = 1.4 + snowRnd() * 2.3
    f.amp = 4 + snowRnd() * 16
    f.ph = snowRnd() * Math.PI * 2
    f.sz = snowRnd() < 0.3 ? 2 : 1
    // a share are drawn as actual snowflakes, not specks
    f.icon = snowRnd() < 0.16
    f.passes = snowRnd() < 0.3
    f.landY = f.passes ? H + 20 : ROOF_TOP + 2 + snowRnd() * 10
    return f
  }
  for (let i = 0; i < SNOW_N; i++) flakes.push(resetFlake({}, false))

  /* A landing adds GROW pixels, not one. A single pixel per flake is
     what a simulation would do; at 12fps with a couple of hundred
     flakes it takes several minutes for a ledge to read as covered,
     which is several minutes of the scene looking like it has only
     just started snowing. The bank has to build while you are watching
     it, so each flake is worth a few. */
  const GROW = 4

  function settle(pile, cx, cap) {
    for (let k = 0; k < GROW; k++) {
      let best = cx
      for (const n of [cx - 1, cx + 1]) {
        if (n < 0 || n >= W) continue
        if (pile[n] < pile[best]) best = n
      }
      if (pile[best] >= cap) return
      pile[best]++
    }
  }

  /* When the snow is switched on the roof already carries a blanket, so
     the ledges cannot start bare — the parapet and the window lip are
     seeded with a shallow, slightly uneven bank and grow from there. */
  function seedPanelPile() {
    const p = panelRect()
    if (!p || p.y0 <= 0) return
    const from = Math.max(0, Math.ceil(p.x0))
    const to = Math.min(W - 1, Math.floor(p.x1))
    for (let x = from; x <= to; x++) panelPile[x] = 3 + ((x >> 2) % 4 === 0 ? 1 : 0)
  }

  function seedPiles() {
    for (let x = 0; x < W; x++) snowPile[x] = 2 + ((x >> 2) % 3 === 0 ? 1 : 0)
    seedPanelPile()
  }

  function stepSnow(p, live, k) {
    for (let i = 0; i < flakes.length; i++) {
      const f = flakes[i]
      f.y += f.sp * k
      f.ph += 0.18 * k
      const x = Math.round(f.x + Math.sin(f.ph) * f.amp)

      let landY = f.landY
      let onPanel = false
      if (p && x >= p.x0 && x <= p.x1 && p.y0 > 0 && p.y0 < landY) {
        landY = p.y0
        onPanel = true
      }
      if (f.y >= landY) {
        const cx = Math.max(0, Math.min(W - 1, x))
        if (i < live) {
          if (onPanel) settle(panelPile, cx, PANEL_CAP)
          else if (!f.passes) settle(snowPile, cx, PILE_CAP)
        }
        resetFlake(f, true)
      }
    }
  }

  /* The fall is deliberately understated — snow is evident from what it
     lands on, not from the air — so both themes thin the field: day to
     45% (white on pale reads as screen-door), night to 65% (a full
     field of pale dots on near-black reads as static).

     And it is not all specks. A share of the flakes are proper
     six-armed pixel snowflakes — a centre, four arms, four diagonal
     tips — because a sky with two kinds of thing falling in it reads
     as weather, and a sky with one kind reads as particles. */
  function drawFlakes(live) {
    const g = wctx
    const outline = T.flakeEdge
    const n = Math.round(live * (outline ? 0.45 : 0.65))
    for (let i = 0; i < n; i++) {
      const f = flakes[i]
      const y = Math.round(f.y)
      if (y < -6) continue
      const x = Math.round(f.x + Math.sin(f.ph) * f.amp)

      if (f.icon) {
        // the big flake: + arms and x tips, five pixels across
        g.fillStyle = T.snowFlake
        g.fillRect(x, y, 1, 1)
        g.fillRect(x - 2, y, 1, 1)
        g.fillRect(x + 2, y, 1, 1)
        g.fillRect(x, y - 2, 1, 1)
        g.fillRect(x, y + 2, 1, 1)
        if (outline) g.fillStyle = outline
        g.fillRect(x - 1, y - 1, 1, 1)
        g.fillRect(x + 1, y - 1, 1, 1)
        g.fillRect(x - 1, y + 1, 1, 1)
        g.fillRect(x + 1, y + 1, 1, 1)
        continue
      }

      if (outline) {
        g.fillStyle = outline
        g.fillRect(x, y + f.sz, f.sz, 1)
        g.fillRect(x + f.sz, y, 1, f.sz)
      }
      g.fillStyle = T.snowFlake
      g.fillRect(x, y, f.sz, f.sz)
    }
  }

  /* The bank along the railing, on the scene canvas so the panel
     occludes it. It sits on top of the blanket the static roof already
     carries, so it reads as drift on lying snow rather than as the
     only snow in the scene. */
  /* Read the bank one column smoothed against its neighbours. Settling
     alone leaves single-pixel spikes standing on the crown, and a spike
     one pixel wide is not snow — it is noise. The depths themselves are
     left alone; only what is drawn is smoothed. */
  function depth(pile, x) {
    const l = x > 0 ? pile[x - 1] : pile[x]
    const r = x < W - 1 ? pile[x + 1] : pile[x]
    return Math.round((l + pile[x] * 2 + r) / 4)
  }

  /* The bank is scaled by the transition too, so it settles in as the
     fall builds and melts back as it thins, rather than being there in
     full the instant the button is pressed. */
  function drawParapetSnow() {
    for (let x = 0; x < W; x++) {
      const d = Math.round(depth(snowPile, x) * wx)
      if (!d) continue
      const y0 = ROOF_TOP + 3 - d
      ctx.fillStyle = T.snowPile
      ctx.fillRect(x, y0, 1, d)
      ctx.fillStyle = T.snowLit
      ctx.fillRect(x, y0, 1, 1)
    }
  }

  /* Snow on the window.
     The panel's top lip is a ledge like any other, so it collects the
     same way the coping does. Once there is enough of it the bank laps
     *over* the edge and hangs a little way down the dark face below,
     with icicles off the deeper parts — which is what stops it reading
     as a white line ruled along the top of a box and starts it reading
     as weight sitting on something. */
  function drawPanelSnow(p) {
    if (!p || p.y0 <= 0) return
    const from = Math.max(0, Math.ceil(p.x0))
    const to = Math.min(W - 1, Math.floor(p.x1))
    const lip = Math.round(p.y0)

    for (let x = from; x <= to; x++) {
      const d = Math.round(depth(panelPile, x) * wx)
      if (!d) continue
      const over = Math.min(5, Math.floor(d / 2.5))
      wctx.fillStyle = T.snowPile
      wctx.fillRect(x, lip - d, 1, d + over)
      wctx.fillStyle = T.snowLit
      wctx.fillRect(x, lip - d + 1, 1, 1)
      wctx.fillStyle = T.snowDark
      wctx.fillRect(x, lip - d, 1, 1)
      if (over > 1) wctx.fillRect(x, lip + over - 1, 1, 1)
    }

    // icicles off the overhang, at intervals rather than everywhere
    for (let x = from + 9; x <= to; x += 23) {
      const d = Math.round(depth(panelPile, x) * wx)
      if (d < 6) continue
      const len = 3 + (d - 6)
      wctx.fillStyle = T.ice
      wctx.fillRect(x, lip + 2, 1, len)
      wctx.fillStyle = T.snowLit
      wctx.fillRect(x, lip + 2, 1, 2)
    }
  }

  /* ==================================================================
     PER-FRAME
     ================================================================== */
  let frame = 0
  let last = 0

  function blit(buf, offset) {
    const o = ((offset % W) + W) % W
    ctx.drawImage(buf.c, o, 0, W, H, 0, 0, W, H)
  }

  function drawStars() {
    for (const s of stars) {
      if ((frame + s.phase) % s.rate <= s.rate * 0.2) continue
      // a handful run warm — a sky of identical white dots is a texture
      px(s.x, s.y, s.warm ? T.starWarm : s.bright > 0.7 ? T.star : T.starDim)
      if (s.bright > 0.95) {
        px(s.x - 1, s.y, T.starDim)
        px(s.x + 1, s.y, T.starDim)
        px(s.x, s.y - 1, T.starDim)
        px(s.x, s.y + 1, T.starDim)
      }
    }

    for (const s of satellites) {
      const span = W + 60
      let x = (s.off + frame * s.sp) % span
      if (x < 0) x += span
      if ((frame + s.blink) % 23 < 4) continue // one of them tumbles
      px(Math.round(x) - 30, s.y, T.starDim)
    }

    /* A constellation, in the shape of a sitting cat. The stars are the
       bright part; the lines between them are dithered down almost to
       nothing, so it reads as an ordinary patch of sky until you notice
       it doesn't. */
    for (const [ax, ay, bx, by] of CAT_LINES) {
      const steps = Math.max(Math.abs(bx - ax), Math.abs(by - ay))
      for (let k = 1; k < steps; k++) {
        dot(ctx, Math.round(ax + ((bx - ax) * k) / steps), Math.round(ay + ((by - ay) * k) / steps), 0.16, T.starDim)
      }
    }
    for (const [sx2, sy2] of CAT_NODES) {
      px(sx2, sy2, T.star)
      if ((frame + sx2) % 34 > 4) {
        px(sx2 - 1, sy2, T.starDim)
        px(sx2 + 1, sy2, T.starDim)
      }
    }

    /* A shooting star, rarely. Six frames, then the sky is empty again
       for the best part of a minute — which is the only thing that
       keeps it worth seeing. */
    const t = frame % 780
    if (t < 6) {
      const sx = 640 - t * 13
      const sy = 58 + t * 6
      ctx.fillStyle = T.star
      ctx.fillRect(sx, sy, 2, 1)
      for (let k = 1; k < 9; k++) dot(ctx, sx + k * 2, sy - k, 1 - k / 9, T.starDim)
    }
  }

  function drawCraft() {
    for (let i = 0; i < craft.length; i++) {
      const c = craft[i]
      const span = W + 160
      let x = (c.off + frame * c.sp) % span
      if (x < 0) x += span
      x -= 80
      const y = c.y
      const rx = Math.round(x)
      // hull, with a lit upper edge and a cabin bump
      ctx.fillStyle = T.city[2].fill
      ctx.fillRect(rx, y, c.len, 3)
      ctx.fillRect(rx + 2, y - 1, c.len - 5, 1)
      ctx.fillStyle = T.city[2].lit
      ctx.fillRect(rx, y, c.len, 1)
      // engine wash trailing behind
      for (let k = 1; k < 5; k++) {
        dot(ctx, rx - k, y + 1, 1 - k / 5, T.trainStripe)
      }
      // nav lights, out of phase with each other
      if ((frame + i * 3) % 10 < 4) px(rx - 1, y, '#ff3ea5')
      if ((frame + i * 3 + 5) % 10 < 4) px(rx + c.len, y, '#3ef0ff')
    }
  }

  /* ---- The airship ----
     The one landmark that cannot be baked into a parallax buffer,
     because the whole point of it is that it goes past. It crosses in
     roughly a minute and then the sky is its own again for two, and it
     carries the name on its flank — which is the joke the reference
     makes, and the only place in this scene where the type is part of
     the city rather than part of the interface. */
  const SHIP_CYCLE = 2100
  const SHIP_RUN = 760

  function drawAirship() {
    const t = frame % SHIP_CYCLE
    if (t >= SHIP_RUN) return
    const x = Math.round(-130 + (t / SHIP_RUN) * (W + 260))
    const y = 146 + Math.round(Math.sin(t * 0.02) * 5)

    const L = 52 // half length. The nose is at +x: it flies left to right.
    const V = 13 // half height
    const tail = x - L + 2

    /* Hull, three values down the section: a crown catching the sky, a
       body, and a belly in shadow. A lozenge filled at one value is
       what made this read as a sticker rather than as a volume. */
    for (let dy = -V; dy <= V; dy++) {
      const s = Math.round(L * Math.sqrt(Math.max(0, 1 - (dy / V) ** 2)))
      if (!s) continue
      ctx.fillStyle = dy < -V * 0.5 ? T.shipLit : dy > V * 0.45 ? T.shipDark : T.ship
      ctx.fillRect(x - s, y + dy, s * 2, 1)
    }

    /* Ring frames — the hoops the envelope is built around. Dashed, so
       they read as structure showing through fabric rather than as
       stripes painted on it. Plus one longitudinal seam. */
    ctx.fillStyle = T.shipDark
    for (let k = -3; k <= 3; k++) {
      const rx = k * 15
      const h = Math.round(V * Math.sqrt(Math.max(0, 1 - (rx / L) ** 2)))
      for (let dy = -h; dy <= h; dy++) {
        if ((dy + 100) & 1) continue
        ctx.fillRect(x + rx, y + dy, 1, 1)
      }
    }
    ctx.fillStyle = T.shipLit
    ctx.fillRect(x - L + 8, y - 2, L * 2 - 16, 1)

    // nose cap and mooring cone
    ctx.fillStyle = T.shipDark
    ctx.fillRect(x + L - 5, y - 4, 5, 8)
    ctx.fillRect(x + L, y - 1, 4, 2)

    // cruciform tail: an upper fin, a lower fin, and the side fin seen
    // almost edge-on
    ctx.fillStyle = T.ship
    ctx.fillRect(tail, y - V - 9, 17, 11)
    ctx.fillRect(tail, y + V - 2, 17, 11)
    ctx.fillStyle = T.shipLit
    ctx.fillRect(tail, y - V - 9, 17, 1)
    ctx.fillRect(tail, y + V + 8, 17, 1)
    ctx.fillStyle = T.shipDark
    ctx.fillRect(tail, y - 2, 15, 4)
    ctx.fillRect(tail + 12, y - V - 9, 1, 11) // rudder hinges
    ctx.fillRect(tail + 12, y + V - 2, 1, 11)

    // engine nacelles, with two-frame propellers
    for (const ex of [x - 26, x + 12]) {
      ctx.fillStyle = T.shipDark
      ctx.fillRect(ex, y + V - 3, 11, 7)
      ctx.fillStyle = T.ship
      ctx.fillRect(ex, y + V - 3, 11, 1)
      ctx.fillStyle = T.shipLit
      if (frame & 1) ctx.fillRect(ex + 12, y + V - 6, 1, 13)
      else {
        ctx.fillRect(ex + 12, y + V - 4, 1, 3)
        ctx.fillRect(ex + 12, y + V + 2, 1, 3)
      }
    }

    // gondola, slung under on two struts
    ctx.fillStyle = T.shipDark
    ctx.fillRect(x - 13, y + V - 1, 1, 3)
    ctx.fillRect(x + 14, y + V - 1, 1, 3)
    ctx.fillRect(x - 15, y + V + 2, 31, 8)
    ctx.fillStyle = T.ship
    ctx.fillRect(x - 15, y + V + 2, 31, 1)
    ctx.fillStyle = T.trainWin
    for (let k = 0; k < 5; k++) ctx.fillRect(x - 12 + k * 6, y + V + 4, 3, 3)

    /* The banner is a lit sign board mounted on the flank — framed,
       with its own bezel — not type painted straight onto the envelope.
       That was the other half of why the words sat on top of the
       airship instead of on it. */
    const s = BANNERS[Math.floor(frame / SHIP_CYCLE) % BANNERS.length]
    const bw = textW(s) + 7
    const bx = x - Math.round(bw / 2)
    ctx.fillStyle = T.shipDark
    ctx.fillRect(bx - 1, y - 7, bw + 2, 13)
    ctx.fillStyle = T.shipTrim
    ctx.fillRect(bx - 1, y - 7, bw + 2, 1)
    ctx.fillRect(bx - 1, y + 5, bw + 2, 1)
    text(ctx, s, bx + 3, y - 4, T.shipTrim)

    // navigation lights, out of phase: starboard at the nose, port aft
    if (frame % 12 < 5) px(x + L + 4, y, '#3ef0ff')
    if ((frame + 6) % 12 < 5) px(tail - 1, y, '#ff3ea5')
  }

  /* The lighthouse beams. Drawn at buffer-x minus the near layer's
     offset, so they stay on their tower as it parallaxes. The beam
     fades out as it turns edge-on to the viewer, which is what reads as
     rotation rather than as a light going on and off. */
  function drawLightBeams(offset) {
    if (!beamSources.length) return
    const o = ((offset % W) + W) % W
    for (const src of beamSources) {
      const sx = src.x - o
      if (sx < -200 || sx > W + 200) continue
      for (const turn of [0, Math.PI]) {
        const cos = Math.cos(frame * 0.11 + turn)
        if (Math.abs(cos) < 0.2) continue
        for (let k = 8; k < 190; k++) {
          const bx = Math.round(sx + cos * k)
          if (bx < 0 || bx >= W) continue
          const by = src.y - k * 0.1
          const half = 1 + k * 0.04
          for (let d = -half; d <= half; d++) {
            const yy = Math.round(by + d)
            if (yy < 0 || yy >= SKYLINE) continue
            dot(ctx, bx, yy, (1 - k / 190) * 0.55 * Math.abs(cos), T.lamp)
          }
        }
      }
    }
  }

  /* ==================================================================
     CAMEOS

     The whole point of a screensaver city is that you glance up and
     something is happening that was not happening last time. So the sky
     runs an event queue: one cameo at a time, a long quiet gap after
     it, and the next picked at random from the pool — never the same
     one twice running, so you cannot predict what is coming.

     Each is a short scene with a beginning and an end rather than a
     loop, which is what keeps them worth catching.
     ================================================================== */

  const CAMEOS = [
    {
      // UFO. Comes in fast, stops dead, thinks about it, leaves faster.
      run: 150,
      draw(t) {
        let x, y
        if (t < 42) {
          x = Math.round(W + 50 - (t / 42) * (W * 0.45))
          y = 84
        } else if (t < 110) {
          x = Math.round(W + 50 - W * 0.45)
          y = 84 + Math.round(Math.sin((t - 42) * 0.25) * 5)
        } else {
          x = Math.round(W + 50 - W * 0.45 - ((t - 110) / 40) * (W + 200))
          y = 84 - Math.round((t - 110) * 0.9)
        }
        ctx.fillStyle = T.city[2].lit
        ctx.fillRect(x - 15, y, 30, 3)
        ctx.fillRect(x - 10, y - 3, 20, 3)
        ctx.fillStyle = T.city[2].fill
        ctx.fillRect(x - 6, y - 7, 13, 4)
        ctx.fillStyle = T.trainWin
        ctx.fillRect(x - 4, y - 6, 9, 2)
        for (let k = 0; k < 5; k++) {
          if ((frame + k) % 5 === 0) px(x - 13 + k * 6, y + 3, T.neon[k % T.neon.length])
        }
        // a tractor beam, while it is parked
        if (t > 54 && t < 100) {
          for (let k = 0; k < 60; k++) {
            const w2 = 2 + k * 0.22
            for (let d = -w2; d <= w2; d++) {
              dot(ctx, Math.round(x + d), y + 4 + k, (1 - k / 60) * 0.5, T.trainWin)
            }
          }
        }
      },
    },
    {
      // Fireworks: three shells, each rising then bursting.
      run: 210,
      draw(t, seed) {
        const rnd = mulberry32(seed)
        for (let s = 0; s < 3; s++) {
          const at = s * 58
          const lt = t - at
          if (lt < 0 || lt > 60) continue
          const cx = 180 + Math.floor(rnd() * 600)
          const cy = 88 + Math.floor(rnd() * 90)
          if (lt < 22) {
            ctx.fillStyle = T.lamp
            ctx.fillRect(cx, Math.round(SKYLINE - (lt / 22) * (SKYLINE - cy)), 1, 4)
            continue
          }
          const age = lt - 22
          const col = T.neon[(s + Math.floor(seed / 7)) % T.neon.length]
          for (let a = 0; a < 30; a++) {
            const th = (a / 30) * Math.PI * 2
            const rr = age * 3 * (0.75 + ((a * 7) % 5) / 10)
            dot(
              ctx,
              Math.round(cx + Math.cos(th) * rr),
              Math.round(cy + Math.sin(th) * rr * 0.85 + age * age * 0.05),
              1 - age / 38,
              col
            )
          }
        }
      },
    },
    {
      // A police helicopter, working a searchlight over the rooftops.
      run: 290,
      draw(t) {
        const x = Math.round(-60 + (t / 290) * (W + 120))
        const y = 150 + Math.round(Math.sin(t * 0.05) * 8)
        const c = T.city[2]
        ctx.fillStyle = c.fill
        ctx.fillRect(x - 12, y, 24, 9)
        ctx.fillRect(x + 10, y + 2, 22, 3) // tail boom
        ctx.fillStyle = c.lit
        ctx.fillRect(x - 12, y, 24, 1)
        ctx.fillRect(x + 30, y - 4, 3, 10) // fin
        ctx.fillStyle = T.trainWin
        ctx.fillRect(x - 9, y + 2, 7, 4) // canopy
        // main rotor, two frames
        ctx.fillStyle = c.dark
        if (frame & 1) ctx.fillRect(x - 26, y - 5, 52, 1)
        else {
          ctx.fillRect(x - 10, y - 5, 8, 1)
          ctx.fillRect(x + 4, y - 5, 8, 1)
        }
        ctx.fillRect(x - 1, y - 5, 2, 5)
        if (frame % 8 < 3) px(x + 31, y - 5, T.neon[0])
        // the searchlight, swinging under it
        const sw = Math.sin(t * 0.07) * 60
        for (let k = 0; k < 120; k++) {
          const cxk = x + (sw * k) / 120
          const w2 = 2 + k * 0.14
          for (let d = -w2; d <= w2; d++) {
            dot(ctx, Math.round(cxk + d), y + 9 + k, (1 - k / 120) * 0.45, T.lamp)
          }
        }
      },
    },
    {
      // A little plane towing a banner. The banner is the joke.
      run: 420,
      draw(t, seed) {
        const x = Math.round(W + 120 - (t / 420) * (W + 280))
        const y = 108 + Math.round(Math.sin(t * 0.04) * 4)
        const c = T.city[2]
        ctx.fillStyle = c.fill
        ctx.fillRect(x, y, 14, 4)
        ctx.fillRect(x + 12, y - 2, 4, 3)
        ctx.fillStyle = c.lit
        ctx.fillRect(x + 3, y - 3, 7, 2) // wing
        ctx.fillRect(x + 1, y + 4, 6, 2)
        ctx.fillRect(x - 1, y - 4, 2, 5) // tailplane
        if (frame % 6 < 3) px(x + 16, y, T.neon[3])

        const s = BANNERS[seed % BANNERS.length]
        const bw = textW(s) + 8
        ctx.fillStyle = c.dark
        ctx.fillRect(x - 12 - bw, y - 5, bw, 13)
        ctx.fillStyle = c.lit
        ctx.fillRect(x - 12 - bw, y - 5, bw, 1)
        ctx.fillRect(x - 12 - bw, y + 7, bw, 1)
        for (let k = 0; k < 10; k++) dot(ctx, x - 2 - k, y + 1, 1, c.lit) // tow line
        text(ctx, s, x - 8 - bw, y - 2, T.neon[1])
      },
    },
    {
      // A meteor shower — several at once, out of phase.
      run: 120,
      draw(t, seed) {
        const rnd = mulberry32(seed)
        for (let m = 0; m < 7; m++) {
          const at = Math.floor(rnd() * 90)
          const sx = Math.floor(rnd() * W)
          const lt = t - at
          if (lt < 0 || lt > 10) continue
          const x = sx - lt * 14
          const y = 30 + Math.floor(rnd() * 120) + lt * 7
          ctx.fillStyle = T.star
          ctx.fillRect(x, y, 2, 1)
          for (let k = 1; k < 11; k++) dot(ctx, x + k * 2, y - k, 1 - k / 11, T.starDim)
        }
      },
    },
    {
      // A flock, crossing in a V.
      run: 260,
      draw(t) {
        const x = Math.round(-40 + (t / 260) * (W + 80))
        const y = 132 + Math.round(Math.sin(t * 0.03) * 10)
        ctx.fillStyle = T.city[2].dark
        for (let b = 0; b < 9; b++) {
          const side = b % 2 ? 1 : -1
          const rank = Math.floor(b / 2)
          const bx = Math.round(x - rank * 11)
          const by = Math.round(y + side * rank * 6)
          const up = (frame + b) % 6 < 3
          ctx.fillRect(bx - 3, by + (up ? -1 : 1), 3, 1)
          ctx.fillRect(bx + 2, by + (up ? -1 : 1), 3, 1)
          ctx.fillRect(bx - 1, by, 3, 1)
        }
      },
    },
  ]

  let cameoAt = 200
  let cameoIdx = 0
  let cameoSeed = 20260809

  function drawCameo() {
    const d = frame - cameoAt
    if (d < 0) return
    const c = CAMEOS[cameoIdx]
    if (d < c.run) {
      c.draw(d, cameoSeed)
      return
    }
    // pick the next one, never repeating the one just shown
    cameoSeed = (Math.imul(cameoSeed, 1103515245) + 12345) >>> 0
    cameoIdx = (cameoIdx + 1 + (cameoSeed % (CAMEOS.length - 1))) % CAMEOS.length
    cameoAt = frame + 190 + (cameoSeed % 420)
  }

  function drawBirds() {
    ctx.fillStyle = T.city[2].fill
    for (const b of birds) {
      b.x += b.sp
      if (b.x > W + 10) b.x = -10
      const up = ((frame + b.phase) % (b.rate * 2)) < b.rate
      const x = Math.round(b.x)
      const y = Math.round(b.y)
      const s = b.size
      ctx.fillRect(x - s * 2, y + (up ? -1 : 1), s, 1)
      ctx.fillRect(x + s, y + (up ? -1 : 1), s, 1)
      ctx.fillRect(x - s, y, s * 2, 1)
    }
  }

  /* Window flicker.
     The layer is blitted with every window lit, then a rolling slice of
     the kept list is painted back out in the building colour. Repainting
     individual cells is how a tile engine would do it — far cheaper than
     regenerating the layer, and it reads as a city going about its
     night. Beacons invert: they blink ON rather than off. */
  function flicker(layer, offset) {
    const o = ((offset % W) + W) % W
    const list = layer.windows
    for (let i = 0; i < list.length; i++) {
      const wnd = list[i]
      const beacon = wnd.beacon

      /* A neon tube is not a window. A window is either occupied or it
         is not; a tube is a gas discharge on an ageing transformer,
         which means it holds steady for a long while and then STUTTERS
         — out, back, out, caught — in a fast burst. So signs run their
         own cycle: mostly nothing, and a couple of frames of trouble
         every few seconds, at a period unique to each sign so no two
         ever gutter together. */
      if (wnd.sign) {
        const period = 150 + ((i * 37) % 130)
        const beat = (frame + i * 13) % period
        // the stutter: three flicks in the last handful of frames
        if (beat < period - 7) continue
        const k = beat - (period - 7)
        const dark = k === 0 || k === 2 || k === 5
        const sx2 = wnd.x - o
        if (sx2 < -40 || sx2 >= W) continue
        ctx.fillStyle = dark ? wnd.off : wnd.col
        ctx.fillRect(sx2, wnd.y, wnd.w, wnd.h)
        continue
      }

      /* Cabins darken in a travelling band rather than at random, which
         is what reads as the wheel's lights chasing round it. */
      const on = wnd.cabin
        ? (frame + i * 2) % 26 < 9
        : ((frame + i * 7) % (beacon ? 8 : 46)) < (beacon ? 3 : 6)
      if (!on) continue
      const sx = wnd.x - o
      if (sx < -8 || sx >= W) continue
      ctx.fillStyle = beacon ? '#ff5a4a' : layer.fill
      ctx.fillRect(sx, wnd.y, wnd.w, wnd.h)
    }
  }

  /* ==================================================================
     THE TRAIN

     An event, not a loop: it crosses, then the line is empty for a
     while. Eleven cars at 76px is longer than the canvas is wide, and
     it clears the frame in about four seconds, so it reads as an
     express rather than as a shuttle.

     Drawn in screen space rather than into the viaduct buffer, so it
     runs along the deck at its own speed instead of being carried by
     the parallax.
     ================================================================== */
  const TRAIN_CYCLE = 340
  const TRAIN_RUN = 132
  const CAR_W = 76
  const CARS = 11
  const CAR_H = 30

  function drawTrain() {
    const t = frame % TRAIN_CYCLE
    if (t >= TRAIN_RUN) return

    const len = CARS * CAR_W
    const x0 = Math.round(-len - 30 + (t / TRAIN_RUN) * (W + len * 2 + 60))
    const top = VIA_Y - CAR_H
    const body = CAR_W - 6

    /* Speed streaks. Drawn first so the cars sit on top of them: a
       smear of window light left behind along the whole train, which is
       most of what makes 20 pixels a frame feel fast rather than
       merely quick. */
    for (let k = 0; k < 12; k++) {
      const sx = x0 - k * 4
      if (sx + len < 0) break
      const fade = 1 - k / 12
      for (let s = 0; s < 2; s++) {
        const y = top + 11 + s * 6
        for (let x = Math.max(0, sx); x < Math.min(W, sx + len); x += 1) {
          dot(ctx, x, y, fade * 0.11, T.trainWin)
        }
      }
    }

    for (let i = 0; i < CARS; i++) {
      const cx = x0 + i * CAR_W
      if (cx > W || cx + CAR_W < 0) continue
      const lead = i === CARS - 1

      ctx.fillStyle = T.train
      ctx.fillRect(cx, top, body, CAR_H)
      ctx.fillStyle = T.trainLit
      ctx.fillRect(cx, top, body, 2) // roof catches the sky
      ctx.fillRect(cx, top, 1, CAR_H)
      ctx.fillStyle = T.trainDark
      ctx.fillRect(cx, top + CAR_H - 4, body, 4) // skirt
      ctx.fillRect(cx + body - 1, top, 1, CAR_H)

      // roof rib, and the ventilators along it
      ctx.fillStyle = T.trainDark
      ctx.fillRect(cx + 4, top + 2, body - 8, 1)
      for (let k = 0; k < 4; k++) ctx.fillRect(cx + 8 + k * 16, top + 3, 6, 1)

      // Windows. A few blink as passengers pass them.
      for (let k = 0; k < 5; k++) {
        const litWin = (frame * 3 + i * 7 + k * 13) % 47 > 5
        ctx.fillStyle = litWin ? T.trainWin : T.trainDark
        ctx.fillRect(cx + 5 + k * 13, top + 7, 10, 12)
        if (litWin && (i + k) % 3 === 0) {
          ctx.fillStyle = T.trainDark // a passenger at the glass
          ctx.fillRect(cx + 8 + k * 13, top + 12, 4, 7)
        }
      }

      // door seams, and the neon stripe running the length of the train
      ctx.fillStyle = T.trainDark
      ctx.fillRect(cx + 2, top + 5, 1, CAR_H - 9)
      ctx.fillRect(cx + body - 3, top + 5, 1, CAR_H - 9)
      ctx.fillStyle = T.trainStripe
      ctx.fillRect(cx, top + CAR_H - 7, body, 2)

      // bogies, tucked under the skirt
      ctx.fillStyle = T.trainDark
      ctx.fillRect(cx + 9, top + CAR_H, 14, 3)
      ctx.fillRect(cx + body - 23, top + CAR_H, 14, 3)

      // pantograph, reaching up to the contact wire
      if (i % 5 === 2) {
        const pxm = cx + Math.round(body / 2)
        ctx.fillStyle = T.trainLit
        for (let k = 0; k < top - WIRE_Y; k++) {
          const dx = Math.round((k / (top - WIRE_Y)) * 7)
          ctx.fillRect(pxm - dx, top - k, 1, 1)
          ctx.fillRect(pxm + dx, top - k, 1, 1)
        }
        ctx.fillRect(pxm - 8, WIRE_Y, 17, 1)
        // the arc where the shoe meets the wire
        if ((frame + i) % 7 === 0) px(pxm + 4, WIRE_Y - 1, '#ffffff')
      }

      if (!lead) continue
      // destination board and headlights
      ctx.fillStyle = T.trainHead
      ctx.fillRect(cx + body - 22, top + 4, 16, 2)
      ctx.fillRect(cx + body - 5, top + 18, 4, 4)
      ctx.fillRect(cx + body - 5, top + CAR_H - 12, 4, 3)
      // beam thrown forward along the deck
      for (let k = 0; k < 46; k++) {
        const bx = cx + body + k
        if (bx >= W) break
        for (let dy = 0; dy < 7; dy++) {
          dot(ctx, bx, top + 17 + dy, (1 - k / 46) * (1 - dy / 7) * 0.7, T.trainHead)
        }
      }
    }

    // Light spilling from the windows onto the deck below.
    for (let x = Math.max(0, x0); x < Math.min(W, x0 + len); x++) {
      for (let dy = 0; dy < 6; dy++) {
        dot(ctx, x, VIA_Y + dy, (1 - dy / 6) * 0.5, T.trainWin)
      }
    }
  }

  /* ---- The cat, sitting on the parapet ----
     Placed right of centre so it clears the window, and high enough
     that its silhouette falls against the lit skyline rather than
     against the near-black rooftop, where it would vanish.

     Read as a silhouette first: the body stays a solid block, and every
     added detail is either a rim light on the lit side or a single
     bright accent. Anything mid-value inside the shape would break the
     cut-out and it would stop reading against the city. */
  const CAT_X = 790
  const CAT_BASE = ROOF_TOP + 6

  let pokeAt = -999
  let secret = false

  /* Click the cat and it notices you. The hit test undoes the same
     object-fit: cover mapping the panel uses, and it listens on the
     window rather than on the canvas because the stage sits over it. */
  window.addEventListener('click', (e) => {
    const { scale, ox, oy } = viewMap()
    const cx = (e.clientX - ox) / scale
    const cy = (e.clientY - oy) / scale
    if (Math.abs(cx - CAT_X) > 18) return
    if (cy < CAT_BASE - 58 || cy > CAT_BASE + 4) return
    pokeAt = frame
  })

  function drawCat() {
    const c = T.cat
    const rim = T.catRim
    ctx.fillStyle = c

    // tail, curling right — two frames
    const flickTail = (frame % 26) < 13 ? 0 : -2
    for (let i = 0; i < 22; i++) {
      const tx = CAT_X + 11 + i
      const ty = CAT_BASE - 1 - Math.round(Math.sin((i / 22) * 2.1) * 13) - (i > 14 ? flickTail : 0)
      ctx.fillRect(tx, ty, 2, 3)
    }

    // haunches and body
    for (let i = 0; i < 30; i++) {
      const y = CAT_BASE - 1 - i
      const half = Math.round(13 - (i / 30) * 6.5)
      ctx.fillRect(CAT_X - half, y, half * 2, 1)
    }

    // shoulders into head
    for (let i = 0; i < 16; i++) {
      const y = CAT_BASE - 31 - i
      const half = Math.round(7 + Math.sin((i / 16) * 3.14) * 2.5)
      ctx.fillRect(CAT_X - half, y, half * 2, 1)
    }

    // the head is turned a little to the left, so a muzzle breaks the
    // profile and one eye can catch the city
    ctx.fillRect(CAT_X - 11, CAT_BASE - 44, 4, 5)

    /* Ears. The far one twitches every few seconds — one pixel, for two
       frames. It is the smallest possible thing that can happen and it
       is most of why the cat reads as alive rather than as a decal. */
    const twitch = frame % 83 < 2 ? 1 : 0
    for (let i = 0; i < 8; i++) {
      const y = CAT_BASE - 47 - i
      const w = 4 - Math.floor(i / 2)
      ctx.fillRect(CAT_X - 8, y, w, 1)
      ctx.fillRect(CAT_X + 8 - w, y - twitch, w, 1)
    }

    // moonlit rim down the left side
    ctx.fillStyle = rim
    for (let i = 0; i < 30; i++) {
      const y = CAT_BASE - 1 - i
      const half = Math.round(13 - (i / 30) * 6.5)
      ctx.fillRect(CAT_X - half, y, 1, 1)
    }
    for (let i = 0; i < 16; i++) {
      const y = CAT_BASE - 31 - i
      const half = Math.round(7 + Math.sin((i / 16) * 3.14) * 2.5)
      ctx.fillRect(CAT_X - half, y, 1, 1)
    }
    ctx.fillRect(CAT_X - 8, CAT_BASE - 54, 1, 8)
    ctx.fillRect(CAT_X - 11, CAT_BASE - 44, 1, 5) // muzzle edge
    ctx.fillRect(CAT_X - 7, CAT_BASE - 46, 1, 1) // inner ear
    ctx.fillRect(CAT_X + 6, CAT_BASE - 46, 1, 1)
    // whiskers, on the lit side only
    ctx.fillRect(CAT_X - 14, CAT_BASE - 43, 3, 1)
    ctx.fillRect(CAT_X - 14, CAT_BASE - 41, 2, 1)

    // a collar with a lit tag, and one eye, blinking
    ctx.fillStyle = T.catCollar
    ctx.fillRect(CAT_X - 7, CAT_BASE - 32, 14, 1)
    ctx.fillRect(CAT_X - 1, CAT_BASE - 31, 2, 2)

    /* Say hello to it and it turns round to look at you. Two eyes
       instead of one is the whole animation — the head does not need to
       move for the gaze to. */
    const noticed = frame - pokeAt < 30 || secret
    if (noticed || frame % 47 > 1) {
      ctx.fillStyle = T.catEye
      ctx.fillRect(CAT_X - 8, CAT_BASE - 44, 2, 2)
      if (noticed) ctx.fillRect(CAT_X - 3, CAT_BASE - 44, 2, 2)
    }

    if (noticed) {
      // 7x6 heart, floating up a pixel at a time
      const HEART = [0b0110110, 0b1111111, 0b1111111, 0b0111110, 0b0011100, 0b0001000]
      const rise = secret ? Math.round(Math.sin(frame * 0.3)) : Math.floor((frame - pokeAt) / 5)
      ctx.fillStyle = T.catCollar
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 7; c++) {
          if (HEART[r] & (64 >> c)) ctx.fillRect(CAT_X - 3 + c, CAT_BASE - 64 - rise + r, 1, 1)
        }
      }
    }

    // snow on the head, back and tail — once there is snow to wear
    if (weather === 'snow' && snowLevel > 0.5) {
      ctx.fillStyle = T.snowLit
      ctx.fillRect(CAT_X - 8, CAT_BASE - 48, 16, 2)
      ctx.fillRect(CAT_X - 4, CAT_BASE - 50, 8, 1)
      for (let i = 0; i < 22; i += 3) {
        const tx = CAT_X + 11 + i
        const ty = CAT_BASE - 2 - Math.round(Math.sin((i / 22) * 2.1) * 13)
        ctx.fillRect(tx, ty, 2, 1)
      }
    }
  }

  /* ---- Brazier on the roof ----
     The flame is generated per frame rather than being a fixed sprite:
     each row tapers toward the tip, is displaced by two out-of-phase
     sines, and is filled in four bands from a dark red rim to a
     near-white core. */
  const FIRE_X = 268
  const FIRE_BASE = ROOF_TOP + 78
  const FIRE_H = 28

  function drawFire() {
    /* The fire reads the weather harder than anything else on the roof,
       because a fire is the one object whose whole purpose changes with
       it. In snow it is banked right up and throwing twice the light —
       somebody needs it. In rain it is guttering and barely holding on.
       Same twenty-eight rows of flame; three numbers different. */
    const snowy = weather === 'snow'
    const wet = weather === 'rain'
    const reach = snowy ? 78 : wet ? 42 : 58
    const height = snowy ? 1.25 : wet ? 0.7 : 1
    const flick = (wet ? 0.5 : snowy ? 0.86 : 0.72) + (frame % 5 === 0 ? 0.1 : 0)
    for (let y = FIRE_BASE - FIRE_H - 20; y <= FIRE_BASE + 18; y++) {
      if (y < 0 || y >= H) continue
      for (let x = FIRE_X - reach; x <= FIRE_X + reach; x++) {
        if (x < 0 || x >= W) continue
        const d = Math.hypot((x - FIRE_X) / 1.25, y - (FIRE_BASE - FIRE_H * 0.35))
        if (d > reach) continue
        dot(ctx, x, y, (1 - d / reach) * (1 - d / reach) * flick, '#4a2a14')
      }
    }

    // the drum, with hoops and a punched vent glowing at the base
    ctx.fillStyle = '#1c1636'
    ctx.fillRect(FIRE_X - 13, FIRE_BASE - 1, 26, 18)
    ctx.fillStyle = '#2a2250'
    ctx.fillRect(FIRE_X - 13, FIRE_BASE - 1, 2, 18)
    ctx.fillRect(FIRE_X - 13, FIRE_BASE + 4, 26, 1)
    ctx.fillRect(FIRE_X - 13, FIRE_BASE + 11, 26, 1)
    ctx.fillStyle = frame % 3 ? '#b8330d' : '#ef7714'
    ctx.fillRect(FIRE_X - 6, FIRE_BASE + 7, 4, 3)
    ctx.fillRect(FIRE_X + 3, FIRE_BASE + 8, 3, 2)

    for (let i = 0; i < FIRE_H; i++) {
      const y = FIRE_BASE - 2 - i
      const p = i / FIRE_H
      const wob = Math.sin(frame * 0.85 + i * 0.5) * 2 + Math.sin(frame * 0.47 + i * 0.9) * 1.4
      const breathe = Math.sin(frame * 0.6) * 1.1
      const w = Math.round(((1 - p) * 8 + breathe * (1 - p)) * height)
      if (w <= 0) continue
      const cx = Math.round(FIRE_X + wob * p * 1.5)
      ctx.fillStyle = '#b8330d'
      ctx.fillRect(cx - w, y, w * 2 + 1, 1)
      const w2 = w - 1
      if (w2 > 0) {
        ctx.fillStyle = '#ef7714'
        ctx.fillRect(cx - w2, y, w2 * 2 + 1, 1)
      }
      const w3 = w - 2
      if (w3 > 0 && p < 0.58) {
        ctx.fillStyle = '#ffd23a'
        ctx.fillRect(cx - w3, y, w3 * 2 + 1, 1)
      }
      if (w3 > 1 && p < 0.3) {
        ctx.fillStyle = '#fff4b0'
        ctx.fillRect(cx - w3 + 1, y, w3 * 2 - 1, 1)
      }
    }

    for (let i = 0; i < 13; i++) {
      const t = (frame * 0.6 + i * 6.5) % 52
      if (t < 4 || t > 48) continue
      const ey = Math.round(FIRE_BASE - 24 - t * 1.2)
      const ex = Math.round(FIRE_X + Math.sin(frame * 0.28 + i * 2.1) * (3 + t * 0.16) + (i - 6) * 2)
      px(ex, ey, t < 15 ? '#ffd23a' : t < 30 ? '#ef7714' : '#7a3210')
    }
  }

  /* Steam off the vent pipe — a column that widens and drifts as it
     rises, redrawn each frame so it never repeats exactly. */
  function drawSteam() {
    // Cold air makes the plume. In snow the vent is the most obvious
    // thing on the roof; in the rain it barely shows at all.
    const n = weather === 'snow' ? 52 : weather === 'rain' ? 16 : 30
    for (let i = 0; i < n; i++) {
      const age = (frame * 1.4 + i * 2.6) % 44
      const y = Math.round(ROOF_TOP + 62 - age)
      if (y < ROOF_TOP - 28) continue
      const spread = 1.5 + age * 0.22
      const drift = Math.sin(age * 0.14 + i * 1.7) * spread
      const x = Math.round(474 + drift)
      /* Each puff is a small block that widens as it rises, not a
         single pixel. A column of lone pixels does not read as steam at
         this scale — it reads as dirt on the lens. */
      const w = 2 + Math.round(age / 15)
      const t = 1 - age / 44
      for (let k = 0; k < w; k++) {
        dot(ctx, x + k, y, t, T.steam)
        dot(ctx, x + k, y - 1, t * 0.55, T.steam)
      }
    }
  }

  /* Washing on the line, swaying out of phase with each other. Drawn
     per frame rather than baked, because a shirt that never moves is
     a shirt painted on a wall. */
  const WASHING = [
    { x: 219, w: 10, h: 13, c: 0 },
    { x: 240, w: 8, h: 10, c: 1 },
    { x: 258, w: 11, h: 14, c: 2 },
    { x: 278, w: 7, h: 9, c: 1 },
  ]

  /* ==================================================================
     WHAT THE WEATHER DOES TO EVERYONE

     Rain and snow used to change only the *surfaces* — a wet deck, a
     white one — while the roof carried on behaving identically
     underneath. A rooftop where the washing is still out in a
     downpour, and the pigeon is picking about in a blizzard, is a
     rooftop nobody actually lives on.

     So the life on it now reads the weather too. None of this is
     expensive; it is mostly deciding not to draw something.
     ================================================================== */

  function drawWashing() {
    // Nobody leaves the washing out in the rain. It has been taken in.
    if (weather === 'rain') return
    for (let i = 0; i < WASHING.length; i++) {
      const g = WASHING[i]
      const t = (g.x - 204) / 98
      const y = Math.round(ROOF_TOP + 34 + Math.sin(t * Math.PI) * 7)
      /* The sway is a whole pixel or nothing — there is no half a
         pixel. Under snow it is frozen solid and does not sway at all,
         which is a one-line difference that says more about the
         temperature than any amount of blue would. */
      const sway =
        weather === 'snow' ? 0 : Math.sin(frame * 0.18 + i * 1.9) > 0.4 ? 1 : 0
      const x = g.x + sway
      /* Cloth, not signage. These sit two metres from the viewer in a
         foreground otherwise lit entirely by neon, so at full
         saturation four shirts out-shout the entire city behind them. */
      ctx.fillStyle = T.cloth[g.c]
      ctx.fillRect(x, y, g.w, g.h)
      ctx.fillStyle = T.railDark
      ctx.fillRect(x, y, g.w, 1) // the line's shadow across the shoulder
      ctx.fillRect(x + g.w - 2, y + 1, 2, g.h - 1) // shadowed fold
      ctx.fillRect(x, y + g.h - 1, g.w, 1)
    }
  }

  /* ---- The pigeon ----
     It arrives, pecks at the coping, has a look round and leaves, then
     the parapet is empty for the best part of a minute. A bird that is
     always there is scenery; a bird that turns up is an event. */
  const PIGEON_X = 596
  const PIGEON_CYCLE = 620

  function drawPigeon() {
    // It sits the rain out somewhere else. In snow it turns up anyway,
    // but hunched into a ball, which is exactly what they do.
    if (weather === 'rain') return
    const t = frame % PIGEON_CYCLE
    if (t > 156) return // thirteen seconds out of fifty-two
    const base = ROOF_TOP + 2
    const puffed = weather === 'snow'

    // flying in for the first twenty frames, and out for the last twenty
    let x = PIGEON_X
    let y = base
    let flying = false
    if (t < 20) {
      flying = true
      x = Math.round(-20 + (t / 20) * (PIGEON_X + 20))
      y = Math.round(base - 60 + (t / 20) * 60)
    } else if (t > 136) {
      flying = true
      const k = (t - 136) / 20
      x = Math.round(PIGEON_X + k * (W + 20 - PIGEON_X))
      y = Math.round(base - k * 70)
    }

    // body, head and tail — six pixels of silhouette and a lit back
    const peck = !flying && !puffed && t % 47 < 6
    ctx.fillStyle = T.cat
    ctx.fillRect(x - 4, y - (puffed ? 6 : 5), 8, puffed ? 6 : 5)
    if (puffed) ctx.fillRect(x - 5, y - 5, 10, 4) // fluffed out sideways
    ctx.fillRect(x + 3, y - 4, 4, 2) // tail
    ctx.fillRect(x - 5, y - (peck ? 5 : puffed ? 7 : 8), 3, 3) // head, down when pecking
    ctx.fillStyle = T.catRim
    ctx.fillRect(x - 4, y - (puffed ? 6 : 5), 6, 1)
    if (puffed) {
      ctx.fillStyle = T.snowLit
      ctx.fillRect(x - 3, y - 7, 5, 1) // a cap of snow on its back
    }
    ctx.fillStyle = T.catEye
    ctx.fillRect(x - 5, y - (peck ? 4 : puffed ? 6 : 7), 1, 1)

    if (!flying) {
      ctx.fillStyle = T.cat
      ctx.fillRect(x - 2, y, 1, 2) // legs
      ctx.fillRect(x, y, 1, 2)
      return
    }
    // wings, two frames, up or down
    ctx.fillStyle = T.cat
    const up = frame % 4 < 2
    ctx.fillRect(x - 3, y - (up ? 9 : 2), 7, 2)
  }

  /* ---- The delivery drone ----
     Crosses the roof every so often with a parcel slung under it. Four
     rotor dashes that swap every frame do more for the illusion than
     any amount of detail on the body would. */
  const DRONE_CYCLE = 900
  const DRONE_RUN = 140

  function drawDrone() {
    // Grounded in snow. Everything is grounded in snow.
    if (weather === 'snow') return
    const t = frame % DRONE_CYCLE
    if (t >= DRONE_RUN) return
    const x = Math.round(-40 + (t / DRONE_RUN) * (W + 80))
    const y = Math.round(ROOF_TOP - 66 + Math.sin(t * 0.09) * 5)

    ctx.fillStyle = T.rail
    ctx.fillRect(x - 7, y, 14, 4) // chassis
    ctx.fillRect(x - 11, y - 1, 4, 2) // arms
    ctx.fillRect(x + 7, y - 1, 4, 2)
    ctx.fillStyle = T.roofLit
    ctx.fillRect(x - 7, y, 14, 1)

    // rotor discs, drawn as dashes that swap phase every frame
    ctx.fillStyle = T.railLit
    const ph = frame & 1
    for (const rx of [x - 12, x + 6]) {
      if (ph) ctx.fillRect(rx, y - 3, 7, 1)
      else {
        ctx.fillRect(rx + 1, y - 3, 2, 1)
        ctx.fillRect(rx + 4, y - 3, 2, 1)
      }
    }

    // the parcel, and a beacon underneath
    ctx.fillStyle = T.lamp
    ctx.fillRect(x - 4, y + 4, 8, 6)
    ctx.fillStyle = T.railDark
    ctx.fillRect(x - 4, y + 6, 8, 1)
    if (frame % 8 < 3) px(x, y + 11, T.neon[0])
  }

  /* ---- three small things that move ---- */

  /* A rat runs the length of the parapet's foot and is gone. Twelve
     seconds out of ninety, and it never stops, so you have to be
     looking at the right part of the roof at the right moment. */
  function drawRat() {
    // Out in the rain quite happily. Not in the snow.
    if (weather === 'snow') return
    const t = frame % 1080
    if (t > 140) return
    const x = Math.round(-20 + (t / 140) * (W + 40))
    const y = ROOF_TOP + 52 + (t % 4 < 2 ? 0 : 1) // it bobs as it runs
    ctx.fillStyle = T.roofDark
    ctx.fillRect(x, y, 7, 3)
    ctx.fillRect(x + 6, y - 1, 3, 2) // head
    ctx.fillRect(x - 6, y + 1, 6, 1) // tail
    ctx.fillRect(x + 1, y + 3, 1, 1) // feet, alternating
    ctx.fillRect(x + 5, y + 3, 1, 1)
    ctx.fillStyle = T.roofSpeck
    ctx.fillRect(x + 5, y - 1, 1, 1)
  }

  /* Moths round the string lights. They orbit on their own phase and
     each one is a single pixel, which at this scale is a moth. */
  function drawMoths() {
    // Moths do not fly in weather. Nothing this small does.
    if (weather !== 'none' || !T.fire || !roofLights.length) return
    for (let i = 0; i < 5; i++) {
      const l = roofLights[(i * 7) % roofLights.length]
      const a = frame * (0.16 + i * 0.03) + i * 2.1
      const rx = 5 + (i % 3) * 2
      ctx.fillStyle = (frame + i) % 5 ? T.lamp : T.lampDim
      ctx.fillRect(Math.round(l.x + Math.cos(a) * rx), Math.round(l.y + Math.sin(a * 1.4) * 4), 1, 1)
    }
  }

  /* A paper plane comes over the parapet, glides down across the deck
     and lands. Somebody upstairs is bored. */
  function drawPaperPlane() {
    // Only in clear weather. A paper plane in the rain is a wet napkin.
    if (weather !== 'none') return
    const t = frame % 1500
    if (t > 190) return
    const x = Math.round(W + 20 - (t / 190) * (W + 60))
    const y = Math.round(ROOF_TOP - 34 + (t / 190) * 96 + Math.sin(t * 0.09) * 5)
    if (y > H) return
    ctx.fillStyle = T.roofLit
    ctx.fillRect(x, y, 8, 1)
    ctx.fillRect(x + 2, y + 1, 6, 1)
    ctx.fillRect(x + 5, y - 1, 3, 1)
    ctx.fillStyle = T.roofSpeck
    ctx.fillRect(x + 7, y, 2, 1)
  }

  /* The tree's bulbs, repainted per frame over the baked ones so they
     twinkle â€” each on its own cycle, the way real tree lights never
     quite agree with each other. */
  function drawTreeLights() {
    if (weather !== 'snow' || snowLevel <= 0.4) return
    const tx = 550
    const tb = ROOF_TOP + 88
    for (let b = 0; b < 9; b++) {
      const ty = tb - 9 - b * 3
      const sway = Math.round(Math.sin(b * 2.1) * (9 - b))
      const on = (frame + b * 5) % 13 < 9
      ctx.fillStyle = on ? FESTIVE[b % 3] : '#1d5c33'
      ctx.fillRect(tx + sway, ty, 2, 2)
    }
  }

  /* The string lights, repainted per frame so a few can gutter. */
  function drawRoofLights() {
    for (let i = 0; i < roofLights.length; i++) {
      const l = roofLights[i]
      const on = secret || (frame + i * 5) % 61 > 3
      const bulb = weather === 'snow' ? FESTIVE[i % 3] : T.lamp
      ctx.fillStyle = on ? bulb : T.lampDim
      ctx.fillRect(l.x, l.y, 1, 2)
      if (!on) continue
      // against snow the glow reaches further - festive, not forensic
      const R = weather === 'snow' ? 3.5 : 2.5
      const Ri = Math.ceil(R)
      for (let dy = -Ri; dy <= Ri; dy++) {
        for (let dx = -Ri; dx <= Ri; dx++) {
          const d = Math.hypot(dx, dy)
          if (d === 0 || d > R) continue
          dot(ctx, l.x + dx, l.y + dy, 1 - d / R, bulb)
        }
      }
    }
  }

  /* ---- the dissolve ----
     A rebuild swaps the world in a single frame, which lands as a cut
     however gently the particles are ramped. So the old frame is
     snapshotted first and then dithered away over the next second — a
     dissolve, which is exactly how eight-bit hardware did a transition
     and the only kind of fade this scene is allowed to use. There is no
     opacity anywhere in it: at each step a few more of the old pixels
     simply stop being drawn.

     It is kept short. The snapshot is a still, so anything moving
     underneath it ghosts, and a long dissolve turns that ghost into a
     stutter — which is the very thing this is here to remove. */
  const DISSOLVE_MS = 600
  let dissolveT0 = 0
  let snapA = null
  let snapB = null
  let ready = false

  function beginDissolve() {
    if (!ready || !animating) return
    if (!snapA) {
      snapA = makeBuffer(W, H)
      snapB = makeBuffer(W, H)
    }
    snapA.x.clearRect(0, 0, W, H)
    snapA.x.drawImage(sceneCv, 0, 0)
    dissolveT0 = performance.now()
  }

  function drawDissolve() {
    if (!dissolveT0) return
    const el = performance.now() - dissolveT0
    if (el >= DISSOLVE_MS) {
      dissolveT0 = 0
      return
    }
    /* At 60fps over 600ms the mask walks ~36 of the kernel's 64 levels
       — the same ordered dither, four times finer in time. Still no
       opacity anywhere: every frame is a hard mask. */
    const lvl = Math.round((1 - el / DISSOLVE_MS) * BAYER_N)
    if (lvl <= 0) return
    const b = snapB.x
    b.clearRect(0, 0, W, H)
    b.drawImage(snapA.c, 0, 0)
    // keep the snapshot only where the Bayer mask passes
    b.globalCompositeOperation = 'destination-in'
    b.fillStyle = washPattern('#ffffff', lvl)
    b.fillRect(0, 0, W, H)
    b.globalCompositeOperation = 'source-over'
    screenCtx.drawImage(snapB.c, 0, 0)
  }

  /* ---- presenting through the tube ----

     A real CRT is a curved sheet of glass, so the picture bows: the
     middle of the screen bulges toward you and the corners fall away.
     Rounded corners and a vignette imply that; they do not do it. This
     does it, by presenting the finished frame as a stack of horizontal
     bands, each stretched a little wider the nearer it is to the
     centre line, and nudged vertically by the same curve.

     Thirty-two bands is enough that the seams disappear at this pixel
     size, and it costs thirty-two drawImage calls a frame instead of
     the per-pixel warp a filter would need. */
  const BANDS = 32
  const BOW = 0.018 // how far the glass bulges. Past ~0.03 it reads as a fishbowl.

  function present(src) {
    const bh = H / BANDS
    for (let i = 0; i < BANDS; i++) {
      const sy = i * bh
      // -1 at the top, 0 at the centre line, +1 at the bottom
      const t = (i + 0.5) / BANDS * 2 - 1
      const bulge = (1 - t * t) * BOW
      const dw = W * (1 + bulge)
      const dx = (W - dw) / 2
      // the band also rises toward the middle, which is the vertical
      // half of the same curve
      const dy = sy - bulge * H * 0.5 * t
      screenCtx.drawImage(src, 0, sy, W, bh + 1, dx, dy, dw, bh + 1.2)
    }
  }

  function swapWorld() {
    weather = target
    snowLevel = weather === 'snow' ? wx : 0
    splashes.length = 0
    runners.length = 0
    snowPile.fill(0)
    panelPile.fill(0)
    beginDissolve()
    buildStatic()
    if (weather === 'snow') seedPiles()
  }

  function stepTransition(dt) {
    if (target !== weather) {
      // thin out what is already falling before swapping the world
      if (wx > 0) {
        wx = Math.max(0, wx - dt / RAMP_DOWN_MS)
        // melting: the blanket recedes with the fall, in quarter steps
        if (weather === 'snow' && Math.abs(wx - snowLevel) >= 0.25) {
          snowLevel = wx
          buildStatic()
        }
        return
      }
      swapWorld()
      return
    }
    const want = weather === 'none' ? 0 : 1
    if (wx < want) wx = Math.min(want, wx + dt / RAMP_UP_MS)
    else if (wx > want) wx = Math.max(want, wx - dt / RAMP_DOWN_MS)

    /* settling: as the fall builds, the world whitens in quarter steps
       behind it — accumulation is the evidence, so it is the thing
       that has to arrive gradually */
    if (weather === 'snow' && Math.abs(wx - snowLevel) >= 0.25) {
      snowLevel = wx
      buildStatic()
    }
  }

  /* ==================================================================
     RENDER
     ================================================================== */
  function render() {

    /* The canvas is cleared every frame. The layers do not cover every
       pixel, and without a clear those rows keep the previous frame —
       which on a theme switch means the old palette bleeding through. */
    ctx.fillStyle = T.roof
    ctx.fillRect(0, 0, W, H)

    ctx.drawImage(sky.c, 0, 0)

    /* The flash goes in over the sky and under everything else, so the
       skyline stays a silhouette against it rather than being washed
       out with it. */
    const strike = strikeStep()
    const flash = strike >= 0 ? BOLT_ENV[strike] : 0
    if (flash) for (let y = 0; y < SKYLINE; y++) washRow(ctx, y, W, T.lightning, flash)

    if (T.stars && (weather === 'none' || snowLevel < 0.5)) drawStars()
    blit(clouds, -Math.floor(frame / 7))
    if (flash > 0.5) drawBolt(strikeSeed)
    drawCraft()
    drawCameo()
    if (!T.stars) drawBirds()

    /* The camera catches up in steps, never smoothly: this scene has
       no easing anywhere else and would not survive it here. */
    if (panX !== panTo) {
      const d = panTo - panX
      const step = Math.sign(d) * Math.max(6, Math.round(Math.abs(d) / 5))
      panX = Math.abs(d) <= Math.abs(step) ? panTo : panX + step
    }

    // Parallax: furthest layer slowest. The ridge barely moves at all.
    if (ridge) blit(ridge.buf, -Math.floor(frame / 40) - Math.round(panX * 0.10))
    const o0 = -Math.floor(frame / 26) - Math.round(panX * 0.22)
    const o1 = -Math.floor(frame / 17) - Math.round(panX * 0.42)
    const o2 = -Math.floor(frame / 11) - Math.round(panX * 0.68)

    blit(city[0].buf, o0)
    flicker(city[0], o0)
    blit(city[1].buf, o1)
    flicker(city[1], o1)
    blit(city[2].buf, o2)
    flicker(city[2], o2)
    if (T.stars) drawLightBeams(o2) // a lighthouse beam by day is a smudge

    // In front of the skyline, behind the elevated line — it is flying
    // over the city, not through it.
    drawAirship()

    // The elevated line sits in front of the city and behind the roof.
    // It drifts at its own rate, faster than the nearest buildings, so
    // it reads as the closest thing that is still far away.
    blit(viaduct, -Math.floor(frame / 8))
    drawTrain()

    // The rooftop is deliberately static — the cat and the brazier stand
    // on it, so it cannot scroll underneath them.
    blit(roof, 0)
    drawWashing()
    drawRoofLights()
    drawTreeLights()
    drawMoths()
    drawSteam()
    drawRat()
    drawPaperPlane()
    drawDrone()
    drawPigeon()

    /* Anything that has *landed* belongs on this canvas, behind the
       panel. Only what is still falling goes on the overlay. */
    if (weather === 'snow') drawParapetSnow()
    if (weather === 'rain') {
      drawSplashes(ctx, false)
      drawRipples()
    }

    drawCat()
    if (T.fire) drawFire()

    /* No second flash pass here. An earlier version also washed the
       city and the roof on a strike, which is what lightning physically
       does — and it made the whole screen jump, which is distracting to
       read a menu against. The flash stays in the sky, where it reads
       as weather rather than as a fault. */

    /* Reduced motion has no compositor loop, so a one-off render
       presents itself. */
    if (!animating) {
      present(sceneCv)
      overlay(0)
    }
  }

  /* ==================================================================
     THE 60FPS SIDE

     Everything transitional lives here: the intensity ramps, the
     falling weather, the water on the glass, and (via composite) the
     dissolve mask. Speeds were authored per 12fps frame, so the sim
     scales by k — the fraction of a legacy frame this rAF represents —
     and positions still snap to whole pixels when drawn. Pixel-snapped
     sixty, not antialiased sixty.
     ================================================================== */
  function overlay(dt) {
    const k = (dt * FPS) / 1000
    stepTransition(dt)

    const live = Math.round((weather === 'rain' ? RAIN_N : SNOW_N) * wx)
    const p = weather === 'none' ? null : panelRect()

    if (weather === 'rain') {
      stepRain(p, live, k)
      stepGlass(k)
    } else if (weather === 'snow') stepSnow(p, live, k)

    if (wctx) {
      wctx.clearRect(0, 0, W, H)
      if (weather === 'rain') {
        drawGlass(p)
        drawDrops(live)
        drawSplashes(wctx, true)
      } else if (weather === 'snow') {
        drawFlakes(live)
        drawPanelSnow(p)
      }
    }

    if (weather === 'rain') ageSplashes(k)
  }

  /* ==================================================================
     THEME AND WEATHER SWITCHING

     Both rebuild the static layers, because both change them. A wet
     roof is not a dry roof with rain in front of it.
     ================================================================== */
  function setTheme(name) {
    T = THEMES[name] || THEMES.night
    beginDissolve()
    buildStatic()
    render()
  }

  /* Only records what was asked for. stepTransition does the work on
     the next frame, in the right order, at the right speed. */
  function setWeather(next) {
    if (next === target) return
    target = next
    if (animating) return

    // Reduced motion: no ramp and no dissolve, just the new world.
    wx = next === 'none' ? 0 : 1
    swapWorld()
    render()
  }

  /* The piles are indexed by canvas column, and the panel moves under
     them when the viewport changes shape — so its bank is re-seeded
     against wherever the window has ended up. */
  window.addEventListener('resize', () => {
    if (weather !== 'snow') return
    panelPile.fill(0)
    seedPanelPile()
  })

  setTheme('night')

  /* A reload straight into snow never passes through setWeather, so the
     ledges are seeded here too. */
  if (weather === 'snow') {
    seedPiles()
    render()
  }

  /* Everything above is the first build. Dissolves are armed only after
     it, so the page does not open by fading in from an empty canvas. */
  ready = true

  /* Deliberately nothing persists: the landing is a directed shot,
     not a saved state. */
  function persistWeather() {}

  window.__scene = {
    setTheme(name) {
      setTheme(name)
    },
    /* Where the camera is looking, in scene pixels. The navigation
       drives this; the scene does not care why. */
    panTo(v) {
      panTo = v
    },
    current: () => (T === THEMES.day ? 'day' : 'night'),

    /* Rain and snow are mutually exclusive — it is one sky. The
       getters report the *target*, not what is currently on screen, so
       the buttons answer the moment they are pressed even though the
       sky takes a few seconds to agree. */
    setRain(on) {
      setWeather(on ? 'rain' : target === 'rain' ? 'none' : target)
      persistWeather()
    },
    raining: () => target === 'rain',

    setSnow(on) {
      setWeather(on ? 'snow' : target === 'snow' ? 'none' : target)
      persistWeather()
    },
    snowing: () => target === 'snow',

    /* The reward for the Konami code: every bulb on the roof burns
       steady, and the cat turns round and stays turned round. */
    setSecret(on) {
      secret = !!on
      render()
    },
    secret: () => secret,
  }

  /* ==================================================================
     TICK — fixed 12fps, so every motion is inherently stepped
     ================================================================== */
  let lastRaf = 0

  function loop(t) {
    requestAnimationFrame(loop)
    const dt = Math.min(120, lastRaf ? t - lastRaf : 1000 / 60)
    lastRaf = t

    overlay(dt)

    if (t - last >= 1000 / FPS) {
      last = t
      frame++
      render()
    }

    // present: the offscreen scene through the curve of the glass,
    // then the dissolve mask over it
    present(sceneCv)
    drawDissolve()
  }

  if (animating) requestAnimationFrame(loop)
})()
