/* ==================================================================
   ROOFTOP — the background scene.

   Drawn on a 960x540 canvas and upscaled nearest-neighbour. That is
   how pixel art actually works: a fixed low-resolution grid, blown up
   whole-number style, never drawn at display resolution.

   Techniques, all period-correct:
     - 4x4 ordered (Bayer) dithering for every gradient and glow
     - Three depths of skyline, each generated building by building
       with its own window grid
     - Window flicker done by repainting individual lit cells, the way
       a tile engine would, rather than redrawing the layer
     - Parallax across five layers, furthest slowest
     - A fixed 12fps tick, so all motion is inherently stepped

   Two palettes drive everything; switching theme rebuilds the static
   layers and nothing else.
   ================================================================== */

(function () {
  'use strict'

  const W = 960
  const H = 540
  const FPS = 12

  const SKYLINE = 410 // where the buildings meet the rooftop
  const ROOF_TOP = 404
  const ORB_X = 190
  const ORB_Y = 92
  const ORB_R = 38

  const cv = document.getElementById('scene')
  if (!cv) return

  cv.width = W
  cv.height = H
  const ctx = cv.getContext('2d')
  ctx.imageSmoothingEnabled = false

  /* Weather sits on its own canvas above the panel. */
  const wv = document.getElementById('weather')
  let wctx = null
  if (wv) {
    wv.width = W
    wv.height = H
    wctx = wv.getContext('2d')
    wctx.imageSmoothingEnabled = false
  }

  /* Where the HUD panel sits, in canvas pixels.
     Both canvases are object-fit: cover, so the mapping is the same
     scale-and-centre the browser applies to the bitmap. */
  function panelRect() {
    const el = document.querySelector('.window')
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (!r.width) return null
    const vw = window.innerWidth
    const vh = window.innerHeight
    const scale = Math.max(vw / W, vh / H)
    const ox = (vw - W * scale) / 2
    const oy = (vh - H * scale) / 2
    return {
      x0: (r.left - ox) / scale,
      x1: (r.right - ox) / scale,
      y0: (r.top - oy) / scale,
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

  /* 4x4 Bayer matrix — the classic ordered dither kernel */
  const BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ]

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

  /* ==================================================================
     PALETTES
     ================================================================== */
  const THEMES = {
    night: {
      /* Deep violet-black base so the neon has somewhere dark to burn
         against. The haze near the skyline is the only place the purple
         gets bright, and even that stays under the sign colours. */
      sky: ['#08030f', '#0d0520', '#140831', '#1d0c46', '#2a1160', '#3a1880'],
      haze: '#7a1fb0',
      orb: '#ecd8ff',
      orbShade: '#b58ce0',
      orbGlow: '#6b1fa8',
      cloud: '#331466',
      cloudLit: '#54249c',
      star: '#ffffff',
      starDim: '#b98cf0',
      city: [
        { fill: '#150931', lit: '#22104c', window: '#7b4fd8', warm: '#ff2bb0' },
        { fill: '#1c0d42', lit: '#2c1566', window: '#a86bff', warm: '#ff5cc4' },
        { fill: '#0c0420', lit: '#170838', window: '#c98cff', warm: '#ff7ad4' },
      ],
      // hot pink, cyan, neon purple, electric yellow, neon green
      neon: ['#ff2bb0', '#00f0ff', '#b026ff', '#faff00', '#00ff9d'],
      roof: '#090318', roofLit: '#2a0f5c', roofSpeck: '#150733',
      rail: '#150a32', railLit: '#4a2490', railDark: '#05010e',
      bounce: ['#ff2bb0', '#00f0ff', '#b026ff'],
      wet: ['#ff2bb0', '#00f0ff', '#b026ff'],
      cat: '#060214',
      catRim: '#b026ff',
      sign: '#00f0ff',
      signBox: '#120630',
      rainDrop: '#7d5cc8',
      rainHi: '#d0b8ff',
      snowFlake: '#e2d4ff',
      snowPile: '#c0a8f0',
      stars: true,
      fire: true,
    },
    day: {
      sky: ['#3f86d4', '#529ae4', '#68aeef', '#82c2f6', '#9fd6fb', '#c0e9fe'],
      haze: '#d8f0ff',
      orb: '#fffbd8',
      orbShade: '#ffeaa2',
      orbGlow: '#ffe9a8',
      cloud: '#ffffff',
      cloudLit: '#dfeefa',
      star: '#ffffff',
      starDim: '#cfe4f6',
      city: [
        { fill: '#93a6c2', lit: '#adbcd4', window: '#7e93b4', warm: '#8fa2c0' },
        { fill: '#7f94b4', lit: '#9aabc6', window: '#6b82a6', warm: '#7b90b0' },
        { fill: '#5d7191', lit: '#7387a4', window: '#4d6182', warm: '#5a6e8e' },
      ],
      neon: ['#d05a7a', '#4a9ec8', '#8a7ab0', '#c8a44a', '#5ab08a'],
      roof: '#4b5468',
      roofLit: '#5f6a80',
      roofSpeck: '#556076',
      rail: '#3a4254', railLit: '#6b7890', railDark: '#232a37',
      bounce: ['#8fa8c4', '#a0b4cc', '#7e94b0'],
      wet: ['#8fa8c4', '#a0b4cc', '#7e94b0'],
      cat: '#333b4c',
      catRim: '#5c6a80',
      sign: '#2f6f9e',
      signBox: '#c8d4e4',
      /* Daylight rain reads as darker streaks against a bright sky, not
         as pale ones — the reverse of night. */
      rainDrop: '#5a7ea8',
      rainHi: '#ffffff',
      snowFlake: '#ffffff',
      snowPile: '#eef5fc',
      stars: false,
      fire: false,
    },
  }

  let T = THEMES.night

  /* ==================================================================
     STATIC LAYERS
     ================================================================== */
  const LOOP_W = W * 2
  let sky, clouds, roof
  let city = []

  /* ---- Sky: six bands, ordered-dithered into each other ---- */
  function buildSky() {
    sky = makeBuffer(W, H)
    const g = sky.x
    const stops = [0, 90, 175, 250, 320, SKYLINE]

    for (let y = 0; y < SKYLINE + 6; y++) {
      let i = 0
      while (i < stops.length - 2 && y > stops[i + 1]) i++
      const a = T.sky[i]
      const b = T.sky[Math.min(i + 1, T.sky.length - 1)]
      const span = Math.max(1, stops[i + 1] - stops[i])
      const t = Math.min(1, Math.max(0, (y - stops[i]) / span))
      const brow = BAYER[y & 3]
      for (let x = 0; x < W; x++) {
        g.fillStyle = t > (brow[x & 3] + 0.5) / 16 ? b : a
        g.fillRect(x, y, 1, 1)
      }
    }

    // city glow pooling above the skyline
    for (let y = SKYLINE - 150; y < SKYLINE; y++) {
      const t = 1 - (SKYLINE - y) / 150
      const brow = BAYER[y & 3]
      for (let x = 0; x < W; x++) {
        if (t * t * 0.85 > (brow[x & 3] + 0.5) / 16) {
          g.fillStyle = T.haze
          g.fillRect(x, y, 1, 1)
        }
      }
    }

    /* Coloured pools in that haze. A single flat haze colour is what
       made the night sky read as merely dark; broad, very sparse
       patches of sign colour bleeding upward give it life without
       lifting the base value. */
    if (T.bounce) {
      const rnd = mulberry32(6161)
      for (let i = 0; i < 26; i++) {
        const cx = Math.floor(rnd() * W)
        const cw = 90 + Math.floor(rnd() * 190)
        const ch = 60 + Math.floor(rnd() * 90)
        const col = T.bounce[Math.floor(rnd() * T.bounce.length)]
        for (let y = SKYLINE - ch; y < SKYLINE; y++) {
          const ty = 1 - (SKYLINE - y) / ch
          const brow = BAYER[y & 3]
          for (let x = cx; x < cx + cw && x < W; x++) {
            const tx = 1 - Math.abs(x - (cx + cw / 2)) / (cw / 2)
            const t = ty * tx
            if (t > 0 && t * t * 0.5 > (brow[x & 3] + 0.5) / 16) {
              g.fillStyle = col
              g.fillRect(x, y, 1, 1)
            }
          }
        }
      }
    }
  }

  /* ---- Skyline ----
     Buildings are walked across the buffer one at a time, each with its
     own height, a lit left edge, roof furniture, and a grid of windows.
     A share of the lit windows is kept in a list so they can be
     flickered later without redrawing the layer. */
  function buildCity(seed, o) {
    const buf = makeBuffer(LOOP_W, H)
    const g = buf.x
    const rnd = mulberry32(seed)
    const windows = []

    let x = -24
    while (x < LOOP_W + 24) {
      const w = o.minW + Math.floor(rnd() * (o.maxW - o.minW))
      const h = o.minH + Math.floor(rnd() * (o.maxH - o.minH))
      const top = SKYLINE - h

      g.fillStyle = o.fill
      g.fillRect(x, top, w, SKYLINE - top)

      // lit left edge and roof lip
      g.fillStyle = o.lit
      g.fillRect(x, top, 1, SKYLINE - top)
      g.fillRect(x, top, w, 1)

      // rooftop furniture
      if (rnd() < 0.45 && w > 10) {
        const aw = 3 + Math.floor(rnd() * 6)
        const ax = x + 2 + Math.floor(rnd() * (w - aw - 3))
        g.fillStyle = o.fill
        g.fillRect(ax, top - 3, aw, 3)
        g.fillStyle = o.lit
        g.fillRect(ax, top - 3, aw, 1)
      }
      if (rnd() < 0.3) {
        const mx = x + Math.floor(w / 2)
        const mh = 6 + Math.floor(rnd() * 12)
        g.fillStyle = o.fill
        g.fillRect(mx, top - mh, 1, mh)
        // aircraft warning light
        if (rnd() < 0.4) windows.push({ x: mx, y: top - mh, w: 1, h: 1, beacon: true })
      }

      // window grid
      const cols = Math.floor((w - 3) / o.step)
      const rows = Math.floor((h - 5) / o.step)
      for (let c = 0; c < cols; c++) {
        for (let r = 0; r < rows; r++) {
          if (rnd() > o.litChance) continue
          const wx = x + 2 + c * o.step
          const wy = top + 4 + r * o.step
          if (wy > SKYLINE - o.wh - 1) continue
          g.fillStyle = rnd() < 0.1 ? o.warm : o.window
          g.fillRect(wx, wy, o.ww, o.wh)
          if (rnd() < 0.22) windows.push({ x: wx, y: wy, w: o.ww, h: o.wh })
        }
      }

      /* Neon. A vertical strip down the face, a horizontal band, or a
         billboard — each with a dithered halo bleeding onto the wall,
         which is what sells it as light rather than as paint. */
      if (o.neonChance && rnd() < o.neonChance && h > 40 && w > 8) {
        const col = o.neon[Math.floor(rnd() * o.neon.length)]
        const kind = rnd()

        const halo = (hx, hy, hw, hh) => {
          const reach = 7
          for (let yy = hy - reach; yy < hy + hh + reach; yy++) {
            if (yy < top - 2 || yy > SKYLINE) continue
            const brow = BAYER[yy & 3]
            for (let xx = hx - reach; xx < hx + hw + reach; xx++) {
              if (xx < x || xx > x + w - 1) continue
              const dx = Math.max(0, Math.max(hx - xx, xx - (hx + hw - 1)))
              const dy = Math.max(0, Math.max(hy - yy, yy - (hy + hh - 1)))
              const d = Math.hypot(dx, dy)
              if (d === 0 || d > reach) continue
              const t = 1 - d / reach
              if (t * t * 0.9 > (brow[xx & 3] + 0.5) / 16) {
                g.fillStyle = col
                g.fillRect(xx, yy, 1, 1)
              }
            }
          }
        }

        if (kind < 0.4) {
          // vertical strip
          const sx = x + 2 + Math.floor(rnd() * Math.max(1, w - 5))
          const sy = top + 8
          const sh = Math.min(h - 16, 24 + Math.floor(rnd() * 46))
          halo(sx, sy, 2, sh)
          g.fillStyle = col
          g.fillRect(sx, sy, 2, sh)
        } else if (kind < 0.7) {
          // horizontal band near the top
          const sy = top + 6 + Math.floor(rnd() * 14)
          halo(x + 2, sy, w - 4, 2)
          g.fillStyle = col
          g.fillRect(x + 2, sy, w - 4, 2)
        } else {
          // billboard
          const bw = Math.max(6, w - 6)
          const bh = 8 + Math.floor(rnd() * 10)
          const bx = x + 3
          const by = top + 10 + Math.floor(rnd() * 18)
          halo(bx, by, bw, bh)
          g.fillStyle = o.fill
          g.fillRect(bx - 1, by - 1, bw + 2, bh + 2)
          g.fillStyle = col
          g.fillRect(bx, by, bw, bh)
          // a couple of dark bars so it reads as lettering
          g.fillStyle = o.fill
          for (let k = 0; k < 3; k++) {
            g.fillRect(bx + 1 + k * 3, by + 2, 1, bh - 4)
          }
        }
      }

      x += w + (rnd() < 0.35 ? 1 + Math.floor(rnd() * 3) : 0)
    }

    return { buf, windows, fill: o.fill }
  }

  /* A lit signboard standing on a building's roof, with a support leg
     and a dithered halo. Drawn into a skyline buffer so it scrolls. */
  function signboard(g, x, y) {
    const w = 78
    const h = 28

    // halo
    for (let yy = y - 8; yy < y + h + 8; yy++) {
      const brow = BAYER[yy & 3]
      for (let xx = x - 8; xx < x + w + 8; xx++) {
        if (xx < 0 || xx >= LOOP_W) continue
        const dx = Math.max(0, Math.max(x - xx, xx - (x + w - 1)))
        const dy = Math.max(0, Math.max(y - yy, yy - (y + h - 1)))
        const d = Math.hypot(dx, dy)
        if (d === 0 || d > 8) continue
        if ((1 - d / 8) * 0.8 > (brow[xx & 3] + 0.5) / 16) {
          g.fillStyle = T.sign
          g.fillRect(xx, yy, 1, 1)
        }
      }
    }

    // support leg
    g.fillStyle = T.signBox
    g.fillRect(x + w / 2 - 2, y + h, 4, 16)

    // box and lettering bars
    g.fillStyle = T.signBox
    g.fillRect(x, y, w, h)
    g.fillStyle = T.sign
    g.fillRect(x + 2, y + 2, w - 4, 2)
    g.fillRect(x + 2, y + h - 4, w - 4, 2)
    for (let i = 0; i < 7; i++) g.fillRect(x + 7 + i * 10, y + 8, 6, 13)
  }

  function buildSkyline() {
    city = [
      buildCity(4411, {
        minW: 12, maxW: 26, minH: 60, maxH: 150,
        step: 5, ww: 2, wh: 2, litChance: 0.34,
        neon: T.neon, neonChance: 0.16,
        ...T.city[0],
      }),
      buildCity(881, {
        minW: 16, maxW: 34, minH: 90, maxH: 200,
        step: 6, ww: 2, wh: 3, litChance: 0.38,
        neon: T.neon, neonChance: 0.3,
        ...T.city[1],
      }),
      buildCity(2266, {
        minW: 22, maxW: 46, minH: 50, maxH: 130,
        step: 7, ww: 3, wh: 3, litChance: 0.3,
        neon: T.neon, neonChance: 0.34,
        ...T.city[2],
      }),
    ]

    // signboards on the mid skyline, spread so one is usually in frame
    signboard(city[1].buf.x, 210, SKYLINE - 168)
    signboard(city[1].buf.x, 980, SKYLINE - 142)
    signboard(city[1].buf.x, 1560, SKYLINE - 186)
  }

  /* ---- Clouds: small flat slabs, as in the reference ---- */
  function buildClouds() {
    clouds = makeBuffer(LOOP_W, H)
    const g = clouds.x
    const rnd = mulberry32(1900)
    for (let n = 0; n < 26; n++) {
      const cx = Math.floor(rnd() * LOOP_W)
      const cy = 24 + Math.floor(rnd() * 220)
      const len = 26 + Math.floor(rnd() * 74)
      const rows = 3 + Math.floor(rnd() * 4)
      for (let r = 0; r < rows; r++) {
        const inset = Math.round((r / rows) * len * 0.34)
        const w = len - inset * 2
        if (w <= 2) continue
        g.fillStyle = r === 0 ? T.cloudLit : T.cloud
        g.fillRect(cx + inset, cy + r, w, 1)
      }
      // a lump or two on top
      for (let k = 0; k < 2; k++) {
        const lx = cx + 6 + Math.floor(rnd() * len * 0.6)
        const lw = 8 + Math.floor(rnd() * 18)
        g.fillStyle = T.cloudLit
        g.fillRect(lx, cy - 1, lw, 2)
      }
    }
  }

  /* ---- Rooftop: static, so anything standing on it stays put ---- */
  function buildRoof() {
    roof = makeBuffer(W, H)
    const g = roof.x
    const rnd = mulberry32(808)

    g.fillStyle = T.roof
    g.fillRect(0, ROOF_TOP, W, H - ROOF_TOP)
    g.fillStyle = T.roofLit
    g.fillRect(0, ROOF_TOP, W, 2)

    // gravel speckle
    for (let i = 0; i < 9000; i++) {
      const x = Math.floor(rnd() * W)
      const y = ROOF_TOP + 4 + Math.floor(rnd() * (H - ROOF_TOP - 4))
      g.fillStyle = rnd() < 0.35 ? T.roofLit : T.roofSpeck
      g.fillRect(x, y, 1 + Math.floor(rnd() * 2), 1)
    }

    /* Parapet.
       A flat bar reads as a sticker. This is built as a solid with
       thickness: a coping stone whose TOP face catches light and whose
       FRONT face falls into shadow, a dark undercut beneath it, then
       balusters with a lit left edge and a shadowed right edge, and a
       bottom rail treated the same way. */
    const capY = ROOF_TOP + 3

    // coping — top face, front face, undercut
    g.fillStyle = T.railLit
    g.fillRect(0, capY, W, 3)
    g.fillStyle = T.rail
    g.fillRect(0, capY + 3, W, 6)
    g.fillStyle = T.railDark
    g.fillRect(0, capY + 9, W, 3)

    // balusters, each with its own lit and shadowed side
    for (let x = 5; x < W; x += 27) {
      g.fillStyle = T.rail
      g.fillRect(x, capY + 12, 6, 22)
      g.fillStyle = T.railLit
      g.fillRect(x, capY + 12, 1, 22)
      g.fillStyle = T.railDark
      g.fillRect(x + 5, capY + 12, 1, 22)
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
    for (let i = 0; i < 34; i++) {
      const bx = Math.floor(rnd() * W)
      const bw = 14 + Math.floor(rnd() * 46)
      const col = T.bounce[Math.floor(rnd() * T.bounce.length)]
      for (let k = 0; k < 4; k++) {
        const y = capY + k
        // fade in from both ends so a patch is a pool, not a bar
        const t = (1 - k / 4) * 0.34
        for (let x = bx; x < bx + bw && x < W; x++) {
          const edge = 1 - Math.abs(x - (bx + bw / 2)) / (bw / 2)
          if (t * edge > (BAYER[y & 3][x & 3] + 0.5) / 16) {
            g.fillStyle = col
            g.fillRect(x, y, 1, 1)
          }
        }
      }
    }

    /* Wet asphalt. Vertical neon streaks bleeding down the roof, which
       is what makes the surface read as reflective rather than as a
       flat slab of dark. */
    for (let i = 0; i < 60; i++) {
      const x = Math.floor(rnd() * W)
      const len = 8 + Math.floor(rnd() * 46)
      const col = T.wet[Math.floor(rnd() * T.wet.length)]
      const y0 = ROOF_TOP + 4 + Math.floor(rnd() * 40)
      for (let k = 0; k < len; k++) {
        const y = y0 + k
        if (y >= H) break
        const t = 1 - k / len
        if (t * 0.5 > (BAYER[y & 3][x & 3] + 0.5) / 16) {
          g.fillStyle = col
          g.fillRect(x, y, 1, 1)
        }
      }
    }

    // ---- props: a boxed panel helper so each reads as a solid volume
    const box = (bx, by, bw, bh) => {
      g.fillStyle = T.rail
      g.fillRect(bx, by, bw, bh)
      g.fillStyle = T.roofLit
      g.fillRect(bx, by, bw, 2)
      g.fillRect(bx, by, 2, bh)
    }

    // water tank and vent, left
    box(52, ROOF_TOP + 34, 46, 28)
    g.fillStyle = T.rail
    g.fillRect(70, ROOF_TOP + 22, 6, 12)
    g.fillRect(84, ROOF_TOP + 26, 4, 8)

    // stacked crates, left of centre
    box(352, ROOF_TOP + 46, 26, 20)
    box(360, ROOF_TOP + 30, 20, 16)

    // air handling units, right
    box(806, ROOF_TOP + 40, 62, 32)
    box(884, ROOF_TOP + 52, 34, 20)

    // ducting running between them
    g.fillStyle = T.rail
    g.fillRect(98, ROOF_TOP + 54, 250, 5)
    g.fillRect(614, ROOF_TOP + 62, 194, 5)
    g.fillStyle = T.roofLit
    g.fillRect(98, ROOF_TOP + 54, 250, 1)
    g.fillRect(614, ROOF_TOP + 62, 194, 1)

    // satellite dish
    g.fillStyle = T.rail
    for (let i = 0; i < 15; i++) {
      const span = Math.floor(Math.sqrt(Math.max(0, 225 - (i - 7) * (i - 7) * 4)))
      g.fillRect(936 - span, ROOF_TOP + 18 + i, span * 2, 1)
    }
    g.fillRect(935, ROOF_TOP + 32, 3, 14)
    g.fillStyle = T.roofLit
    g.fillRect(926, ROOF_TOP + 20, 8, 2)

    /* The lit sign used to live here, on the static rooftop, so it sat
       still while the city slid past behind it. It belongs to a
       building, so it is drawn into a skyline layer instead and
       parallaxes with it. */
  }

  function buildStatic() {
    buildSky()
    buildSkyline()
    buildClouds()
    buildRoof()
  }

  /* ---- Particles ---- */
  const stars = (function () {
    const rnd = mulberry32(9271)
    const out = []
    for (let i = 0; i < 900; i++) {
      const x = Math.floor(rnd() * W)
      const y = Math.floor(rnd() * (SKYLINE - 130))
      if (rnd() < y / (SKYLINE - 130)) continue
      if (Math.hypot(x - ORB_X, y - ORB_Y) < ORB_R + 22) continue
      out.push({
        x,
        y,
        bright: rnd(),
        phase: Math.floor(rnd() * 40),
        rate: 16 + Math.floor(rnd() * 30),
      })
    }
    return out
  })()

  const birds = (function () {
    const rnd = mulberry32(4242)
    const out = []
    for (let i = 0; i < 8; i++) {
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

  /* ---- Rain ----
     Splashes land along the parapet — the roof's leading edge — rather
     than scattered across the deck, so the impacts read as a line of
     spray on the border. A third of the drops are marked to fall past
     that edge without splashing, which keeps the curtain full height
     instead of stopping dead at the parapet.

     On impact a drop hands off to a splash, which plays three drawn
     frames and dies — sprite animation, not a fade. */
  let raining = false
  const RAIN_N = 190
  const drops = []
  const splashes = []
  const rainRnd = mulberry32(3141)

  function resetDrop(d, high) {
    d.x = rainRnd() * (W + 160) - 80
    d.y = high ? -10 - rainRnd() * 60 : -10 - rainRnd() * 420
    d.len = 7 + Math.floor(rainRnd() * 11)
    d.sp = 15 + rainRnd() * 12
    d.passes = rainRnd() < 0.34
    d.landY = d.passes ? H + 20 : ROOF_TOP + 2 + rainRnd() * 12
    return d
  }

  for (let i = 0; i < RAIN_N; i++) drops.push(resetDrop({}, false))

  function drawRain(p) {
    const g = wctx
    const c = T.rainDrop
    const cHi = T.rainHi
    g.fillStyle = c

    for (const d of drops) {
      d.y += d.sp
      d.x += 2.4
      if (d.x > W + 80) d.x -= W + 160

      // The panel is a surface too — anything over it lands on its lip.
      let landY = d.landY
      if (p && d.x >= p.x0 && d.x <= p.x1 && p.y0 > 0 && p.y0 < landY) landY = p.y0

      if (d.y >= landY) {
        if (landY < H) splashes.push({ x: Math.round(d.x), y: Math.round(landY), age: 0 })
        resetDrop(d, true)
        continue
      }

      // slanted streak, brighter at its head
      const hx = Math.round(d.x)
      const hy = Math.round(d.y)
      for (let k = 1; k < d.len; k++) {
        g.fillRect(hx - Math.round(k * 0.24), hy - k, 1, 1)
      }
      g.fillStyle = cHi
      g.fillRect(hx, hy, 1, 2)
      g.fillStyle = c
    }

    // splashes — three drawn frames
    for (let i = splashes.length - 1; i >= 0; i--) {
      const s = splashes[i]
      if (s.age === 0) {
        g.fillStyle = cHi
        g.fillRect(s.x, s.y, 2, 1)
      } else if (s.age === 1) {
        g.fillStyle = cHi
        g.fillRect(s.x - 2, s.y - 1, 1, 1)
        g.fillRect(s.x + 2, s.y - 1, 1, 1)
        g.fillRect(s.x - 1, s.y, 3, 1)
      } else {
        g.fillStyle = c
        g.fillRect(s.x - 3, s.y - 1, 1, 1)
        g.fillRect(s.x + 3, s.y - 1, 1, 1)
        g.fillRect(s.x - 2, s.y, 5, 1)
      }
      s.age++
      if (s.age > 2) splashes.splice(i, 1)
    }
  }

  /* ---- Snow ----
     Slower than rain and drifting sideways on a sine, and instead of
     splashing it settles: each flake that reaches the parapet adds a
     pixel to a per-column depth array, capped, which is drawn back as
     a ragged line of lying snow along the border. */
  let snowing = false
  const SNOW_N = 160
  const flakes = []
  const snowPile = new Int8Array(W)
  const panelPile = new Int8Array(W)
  const snowRnd = mulberry32(2718)

  function resetFlake(f, high) {
    f.x = snowRnd() * (W + 40) - 20
    f.y = high ? -6 - snowRnd() * 50 : -6 - snowRnd() * 540
    f.sp = 1.5 + snowRnd() * 2.4
    f.amp = 4 + snowRnd() * 15
    f.ph = snowRnd() * Math.PI * 2
    f.sz = snowRnd() < 0.28 ? 2 : 1
    f.passes = snowRnd() < 0.3
    f.landY = f.passes ? H + 20 : ROOF_TOP + 2 + snowRnd() * 12
    return f
  }

  for (let i = 0; i < SNOW_N; i++) flakes.push(resetFlake({}, false))

  function drawSnow(p) {
    const g = wctx
    g.fillStyle = T.snowFlake

    for (const f of flakes) {
      f.y += f.sp
      f.ph += 0.18
      const x = Math.round(f.x + Math.sin(f.ph) * f.amp)

      let landY = f.landY
      let onPanel = false
      if (p && x >= p.x0 && x <= p.x1 && p.y0 > 0 && p.y0 < landY) {
        landY = p.y0
        onPanel = true
      }

      if (f.y >= landY) {
        const cx = Math.max(0, Math.min(W - 1, x))
        if (onPanel) {
          if (panelPile[cx] < 5) panelPile[cx]++
        } else if (!f.passes) {
          if (snowPile[cx] < 4) snowPile[cx]++
        }
        resetFlake(f, true)
        continue
      }
      g.fillRect(x, Math.round(f.y), f.sz, f.sz)
    }

    // settled snow lying along the parapet
    g.fillStyle = T.snowPile
    for (let x = 0; x < W; x++) {
      const d = snowPile[x]
      if (d > 0) g.fillRect(x, ROOF_TOP + 3 - d, 1, d)
    }

    // and along the top edge of the panel
    if (p && p.y0 > 0) {
      const from = Math.max(0, Math.ceil(p.x0))
      const to = Math.min(W - 1, Math.floor(p.x1))
      for (let x = from; x <= to; x++) {
        const d = panelPile[x]
        if (d > 0) g.fillRect(x, Math.round(p.y0) - d, 1, d)
      }
    }
  }

  /* Craft crossing the skyline, blinking as they go */
  const craft = [
    { y: 118, sp: 0.55, off: 0, len: 9 },
    { y: 196, sp: -0.38, off: 620, len: 7 },
    { y: 70, sp: 0.28, off: 300, len: 11 },
  ]

  /* ==================================================================
     PER-FRAME
     ================================================================== */
  let frame = 0
  let last = 0

  function drawCraft() {
    for (let i = 0; i < craft.length; i++) {
      const c = craft[i]
      const span = W + 160
      let x = (c.off + frame * c.sp) % span
      if (x < 0) x += span
      x -= 80
      const y = c.y
      // hull
      ctx.fillStyle = T.city[2].fill
      ctx.fillRect(Math.round(x), y, c.len, 2)
      // blinking nav lights, out of phase with each other
      if ((frame + i * 3) % 10 < 4) px(Math.round(x) - 1, y, '#ff3ea5')
      if ((frame + i * 3 + 5) % 10 < 4) px(Math.round(x) + c.len, y, '#3ef0ff')
    }
  }

  function drawOrb() {
    const reach = ORB_R + 46
    for (let y = ORB_Y - reach; y <= ORB_Y + reach; y++) {
      if (y < 0 || y >= SKYLINE) continue
      const brow = BAYER[y & 3]
      for (let x = ORB_X - reach; x <= ORB_X + reach; x++) {
        if (x < 0 || x >= W) continue
        const d = Math.hypot(x - ORB_X, y - ORB_Y)
        if (d <= ORB_R || d > reach) continue
        const t = 1 - (d - ORB_R) / (reach - ORB_R)
        if (t * t * 0.9 > (brow[x & 3] + 0.5) / 16) px(x, y, T.orbGlow)
      }
    }
    for (let y = -ORB_R; y <= ORB_R; y++) {
      const span = Math.floor(Math.sqrt(ORB_R * ORB_R - y * y))
      ctx.fillStyle = T.orb
      ctx.fillRect(ORB_X - span, ORB_Y + y, span * 2 + 1, 1)
    }
    if (T.stars) {
      ctx.fillStyle = T.orbShade
      ctx.fillRect(ORB_X - 14, ORB_Y - 18, 11, 7)
      ctx.fillRect(ORB_X + 6, ORB_Y - 4, 9, 7)
      ctx.fillRect(ORB_X - 9, ORB_Y + 13, 14, 6)
      ctx.fillRect(ORB_X + 14, ORB_Y + 17, 7, 5)
    }
    ctx.fillStyle = T.orbShade
    for (let y = 5; y <= ORB_R; y++) {
      const span = Math.floor(Math.sqrt(ORB_R * ORB_R - y * y))
      ctx.fillRect(ORB_X + span - 5, ORB_Y + y, 5, 1)
    }
  }

  function drawStars() {
    for (const s of stars) {
      if ((frame + s.phase) % s.rate <= s.rate * 0.2) continue
      px(s.x, s.y, s.bright > 0.7 ? T.star : T.starDim)
      // the brightest get a four-point sparkle
      if (s.bright > 0.95) {
        px(s.x - 1, s.y, T.starDim)
        px(s.x + 1, s.y, T.starDim)
        px(s.x, s.y - 1, T.starDim)
        px(s.x, s.y + 1, T.starDim)
      }
    }
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

  function blit(buf, offset) {
    const o = ((offset % W) + W) % W
    ctx.drawImage(buf.c, o, 0, W, H, 0, 0, W, H)
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
    const n = list.length
    if (!n) return
    for (let i = 0; i < n; i++) {
      const wnd = list[i]
      const beacon = wnd.beacon
      const on = ((frame + i * 7) % (beacon ? 8 : 46)) < (beacon ? 3 : 6)
      if (!on) continue
      const sx = wnd.x - o
      if (sx < -8 || sx >= W) continue
      ctx.fillStyle = beacon ? '#ff5a4a' : layer.fill
      ctx.fillRect(sx, wnd.y, wnd.w, wnd.h)
    }
  }

  /* ---- The cat, sitting on the parapet ----
     Placed right of centre so it clears the window, and high enough
     that its silhouette falls against the lit skyline rather than
     against the near-black rooftop, where it would vanish. */
  const CAT_X = 790
  const CAT_BASE = ROOF_TOP + 6

  function drawCat() {
    const c = T.cat
    const rim = T.catRim
    ctx.fillStyle = c

    // tail, curling right — two frames
    const flickTail = (frame % 26) < 13 ? 0 : -2
    for (let i = 0; i < 22; i++) {
      const tx = CAT_X + 11 + i
      const ty = CAT_BASE - 1 - Math.round(Math.sin(i / 22 * 2.1) * 13) - (i > 14 ? flickTail : 0)
      ctx.fillRect(tx, ty, 2, 3)
    }

    // haunches and body
    for (let i = 0; i < 30; i++) {
      const y = CAT_BASE - 1 - i
      const t = i / 30
      const half = Math.round(13 - t * 6.5)
      ctx.fillRect(CAT_X - half, y, half * 2, 1)
    }

    // shoulders into head
    for (let i = 0; i < 16; i++) {
      const y = CAT_BASE - 31 - i
      const t = i / 16
      const half = Math.round(7 + Math.sin(t * 3.14) * 2.5)
      ctx.fillRect(CAT_X - half, y, half * 2, 1)
    }

    // ears
    for (let i = 0; i < 8; i++) {
      const y = CAT_BASE - 47 - i
      const w = 4 - Math.floor(i / 2)
      ctx.fillRect(CAT_X - 8, y, w, 1)
      ctx.fillRect(CAT_X + 8 - w, y, w, 1)
    }

    // moonlit rim down the left side
    ctx.fillStyle = rim
    for (let i = 0; i < 30; i++) {
      const y = CAT_BASE - 1 - i
      const t = i / 30
      const half = Math.round(13 - t * 6.5)
      ctx.fillRect(CAT_X - half, y, 1, 1)
    }
    for (let i = 0; i < 16; i++) {
      const y = CAT_BASE - 31 - i
      const t = i / 16
      const half = Math.round(7 + Math.sin(t * 3.14) * 2.5)
      ctx.fillRect(CAT_X - half, y, 1, 1)
    }
    ctx.fillRect(CAT_X - 8, CAT_BASE - 54, 1, 8)
  }

  /* ---- Brazier on the roof (night only) ---- */
  const FIRE_X = 268
  const FIRE_BASE = ROOF_TOP + 78
  const FIRE_H = 26

  function drawFire() {
    const reach = 54
    for (let y = FIRE_BASE - FIRE_H - 18; y <= FIRE_BASE + 16; y++) {
      if (y < 0 || y >= H) continue
      const brow = BAYER[y & 3]
      for (let x = FIRE_X - reach; x <= FIRE_X + reach; x++) {
        if (x < 0 || x >= W) continue
        const d = Math.hypot((x - FIRE_X) / 1.25, y - (FIRE_BASE - FIRE_H * 0.35))
        if (d > reach) continue
        const t = 1 - d / reach
        const flick = 0.72 + (frame % 5 === 0 ? 0.1 : 0)
        if (t * t * flick > (brow[x & 3] + 0.5) / 16) px(x, y, '#4a2a14')
      }
    }

    // the drum
    ctx.fillStyle = '#1c1636'
    ctx.fillRect(FIRE_X - 13, FIRE_BASE - 1, 26, 18)
    ctx.fillStyle = '#2a2250'
    ctx.fillRect(FIRE_X - 13, FIRE_BASE - 1, 2, 18)

    for (let i = 0; i < FIRE_H; i++) {
      const y = FIRE_BASE - 2 - i
      const p = i / FIRE_H
      const wob = Math.sin(frame * 0.85 + i * 0.5) * 2 + Math.sin(frame * 0.47 + i * 0.9) * 1.4
      const breathe = Math.sin(frame * 0.6) * 1.1
      const w = Math.round((1 - p) * 8 + breathe * (1 - p))
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

    for (let i = 0; i < 11; i++) {
      const t = (frame * 0.6 + i * 6.5) % 52
      if (t < 4 || t > 48) continue
      const ey = Math.round(FIRE_BASE - 24 - t * 1.2)
      const ex = Math.round(
        FIRE_X + Math.sin(frame * 0.28 + i * 2.1) * (3 + t * 0.16) + (i - 5) * 2
      )
      px(ex, ey, t < 15 ? '#ffd23a' : t < 30 ? '#ef7714' : '#7a3210')
    }
  }

  function render() {
    ctx.fillStyle = T.roof
    ctx.fillRect(0, 0, W, H)

    ctx.drawImage(sky.c, 0, 0)
    if (T.stars) drawStars()
    blit(clouds, -Math.floor(frame / 7))
    drawOrb()
    drawCraft()
    if (!T.stars) drawBirds()

    // Parallax: furthest layer slowest.
    const o0 = -Math.floor(frame / 26)
    const o1 = -Math.floor(frame / 17)
    const o2 = -Math.floor(frame / 11)

    blit(city[0].buf, o0)
    flicker(city[0], o0)
    blit(city[1].buf, o1)
    flicker(city[1], o1)
    blit(city[2].buf, o2)
    flicker(city[2], o2)

    // The rooftop is deliberately static — the cat and the brazier stand
    // on it, so it cannot scroll underneath them.
    blit(roof, 0)

    drawCat()
    if (T.fire) drawFire()

    // Weather goes on the overlay canvas, in front of the panel.
    if (wctx) {
      wctx.clearRect(0, 0, W, H)
      if (raining || snowing) {
        const p = panelRect()
        if (raining) drawRain(p)
        if (snowing) drawSnow(p)
      }
    }
  }

  /* ==================================================================
     THEME SWITCHING
     ================================================================== */
  function setTheme(name) {
    T = THEMES[name] || THEMES.night
    buildStatic()
    render()
  }

  const saved = (function () {
    try {
      return localStorage.getItem('scene-theme')
    } catch (e) {
      return null
    }
  })()

  setTheme(saved === 'day' ? 'day' : 'night')

  try {
    raining = localStorage.getItem('scene-rain') === 'on'
    snowing = localStorage.getItem('scene-snow') === 'on'
  } catch (e) {
    /* storage unavailable */
  }

  window.__scene = {
    setTheme(name) {
      setTheme(name)
      try {
        localStorage.setItem('scene-theme', name)
      } catch (e) {
        /* storage unavailable — the choice just won't persist */
      }
    },
    current: () => (T === THEMES.day ? 'day' : 'night'),

    /* Rain and snow are mutually exclusive — it is one sky. */
    setRain(on) {
      raining = !!on
      if (raining) snowing = false
      if (!raining) splashes.length = 0
      if (!snowing) { snowPile.fill(0); panelPile.fill(0) }
      persistWeather()
      render()
    },
    raining: () => raining,

    setSnow(on) {
      snowing = !!on
      if (snowing) raining = false
      if (!snowing) { snowPile.fill(0); panelPile.fill(0) }
      if (!raining) splashes.length = 0
      persistWeather()
      render()
    },
    snowing: () => snowing,
  }

  function persistWeather() {
    try {
      localStorage.setItem('scene-rain', raining ? 'on' : 'off')
      localStorage.setItem('scene-snow', snowing ? 'on' : 'off')
    } catch (e) {
      /* storage unavailable — the choice just won't persist */
    }
  }

  /* ==================================================================
     TICK — fixed 12fps, so every motion is inherently stepped
     ================================================================== */
  function loop(t) {
    requestAnimationFrame(loop)
    if (t - last < 1000 / FPS) return
    last = t
    frame++
    render()
  }

  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)')
  if (!reduce.matches) requestAnimationFrame(loop)
})()
