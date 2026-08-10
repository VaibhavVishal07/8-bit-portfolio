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
  /* Shared by the static prop in buildRoof and the per-frame occupant
     shared with the prop below it. */
  const PIPE_X = 636
  const VIA_Y = 360 // top of the elevated deck
  const VIA_H = 11
  const LOOP_W = W * 2

  /* ==================================================================
     SUPERSAMPLING

     The scene is composed on a 960x540 grid and always will be —
     every coordinate in this file, every landmark, every prop and the
     whole rooftop are authored against it, and re-authoring that is a
     different job from this one.

     What changes here is how many real pixels back each of those
     authored ones. The canvas is S times larger in each axis and every
     drawing context carries a matching transform, so all the code
     below goes on speaking in 960x540 coordinates and does not know
     the difference — but anything that chooses to work at a finer
     grain than one authored pixel now can, and the browser is no
     longer stretching a 960-wide image across a 3200-wide display.

     The thing that immediately cashes this in is the DITHER. Every
     large wash in the scene — the aerial haze on each skyline, the
     city glow, the weather wash, the snow blanket — is an ordered
     dither, and an ordered dither is only as fine as the pixels it has
     to work with. At S=3 those washes get nine times the cells to
     place tone in, so the haze that used to read as a coarse pattern
     laid over the city reads as tone. That is where "more detail"
     actually comes from here: not more things, but the gradients
     between them no longer being chunky.

     S is chosen from how much upscale the display is actually giving
     us, because there is no point rendering three times the pixels
     into a viewport that cannot show them — and because at S=3 the two
     looping city buffers alone are 5760x1620, which is memory a phone
     should never be asked for. */
  const S = (() => {
    const up = Math.max(window.innerWidth / W, window.innerHeight / H)
    return up >= 2.6 ? 3 : up >= 1.7 ? 2 : 1
  })()

  // authored units -> device pixels, for anything compositing whole buffers
  const dev = (n) => n * S

  const cv = document.getElementById('scene')
  if (!cv) return

  cv.width = dev(W)
  cv.height = dev(H)
  /* Double-buffered. The scene paints into an offscreen canvas at its
     fixed 12fps — that stepped motion is the project's identity — and a
     compositor presents it to the visible canvas every rAF frame. The
     split exists for the transitions: the dissolve mask and the falling
     weather run on the 60fps side, so a theme or weather change glides
     while the city behind it keeps its deliberate step. Retro hardware
     did exactly this — coarse background, smooth sprites. */
  const screenCtx = cv.getContext('2d')
  screenCtx.imageSmoothingEnabled = false
  screenCtx.setTransform(S, 0, 0, S, 0, 0)
  const sceneCv = document.createElement('canvas')
  sceneCv.width = dev(W)
  sceneCv.height = dev(H)
  const ctx = sceneCv.getContext('2d')
  ctx.imageSmoothingEnabled = false
  ctx.setTransform(S, 0, 0, S, 0, 0)

  /* Weather sits on its own canvas above the panel, so falling drops
     and flakes pass in front of the window. Anything that *lands*
     goes on the scene canvas instead, or it would settle on top of
     the panel it should be settling behind. */
  const wv = document.getElementById('weather')
  let wctx = null
  if (wv) {
    wv.width = dev(W)
    wv.height = dev(H)
    wctx = wv.getContext('2d')
    wctx.imageSmoothingEnabled = false
    wctx.setTransform(S, 0, 0, S, 0, 0)
  }

  const animating = !window.matchMedia('(prefers-reduced-motion: reduce)').matches

  /* Every load opens the same way: a clear night over the city.

     It used to open in the rain, on the reasoning that the scene at
     its best is the scene you land on and a portfolio gets to insist
     on its opening shot. Both halves of that are true and the
     conclusion was still wrong: two hundred falling drops are the
     busiest thing this page can do, and they were the first thing a
     visitor met, over the top of the words they came to read. Rain is
     a mood you should be able to CHOOSE, which is what the switch in
     the corner is for.

     Clear by default. The city is quieter, the type sits on it
     without competing, and the fire is lit because nothing is falling
     on it. */
  let weather = 'none'

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

  /* How much snow is LYING, as a continuous 0..1. `snowLevel` is this
     value quantised to the steps at which the static layers are
     actually rebuilt; this is the one that moves every frame. Keeping
     them apart is what lets the accumulation be smooth without
     rebuilding the whole city sixty times a second. */
  let snowDepth = snowLevel

  /* Christmas lives in the snow palette: bulb colours for the string
     lights, the tree, and a scatter of festive windows in the city. */
  const FESTIVE = ['#e8484f', '#3fbf6f', '#f8c838']
  const RAMP_UP_MS = 5500
  const RAMP_DOWN_MS = 4000

  /* How long the ledges take to go white once it is snowing properly.
     Deliberately far longer than the fall ramp: the air filling and
     the ground covering are not the same event, and collapsing them
     into one is what made the snow land already-settled. */
  const SETTLE_MS = 26000

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
      /* The column of content, not the page — a page fills the frame
         now, and rain landing on the whole viewport is rain landing on
         nothing. What the weather settles on, and what shelters the
         brazier, is the box the words are actually in. */
      document.querySelector('.page[data-active] .col') ||
      document.querySelector('.page.is-on .col')
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

  /* Every layer buffer is supersampled and pre-transformed, so callers
     keep passing authored 960x540-space sizes and coordinates. */
  function makeBuffer(w, h) {
    const c = document.createElement('canvas')
    c.width = dev(w)
    c.height = dev(h)
    const x = c.getContext('2d')
    x.imageSmoothingEnabled = false
    x.setTransform(S, 0, 0, S, 0, 0)
    return { c, x }
  }

  const px = (x, y, c) => {
    ctx.fillStyle = c
    ctx.fillRect(x, y, 1, 1)
  }

  /* One dithered pixel. Used where the intensity varies across x —
     glows, halos, bolts — and so cannot be laid down as a row.

     At S > 1 the authored pixel is subdivided and each of its S x S
     device cells is thresholded on its own, against the Bayer matrix
     indexed in DEVICE space. That is the whole supersampling payoff
     for glows: a halo bleeding off a neon tube used to have sixty-four
     levels to fall through and one pixel of spatial resolution to do
     it in, so it stepped. It now has nine times the cells, and the
     falloff is smooth enough to read as light rather than as a
     pattern. */
  const SUB = 1 / S

  /* ==================================================================
     LIGHT

     Everything else in this file is dithered, and dithering is the
     right answer for a SURFACE — a hazy sky, a wash over a building,
     snow lying on a ledge. It is the wrong answer for a SOURCE.

     A neon tube's bleed was drawn with the same ordered dither as the
     haze, at a falloff that spent most of its range down in the sparse
     levels, and a sparse ordered dither is a regular lattice. So every
     sign in the city was surrounded by a field of hard single pixels
     in the sign's own colour: not light coming off the glass, static
     sitting next to it. It read as noise because structurally it WAS
     noise — a fixed pattern with no tonal continuity in it.

     Light gets real alpha instead. A radial falloff, composited
     `lighter` so two signs near each other add up the way two lights
     actually do, and no threshold anywhere: at the tube it is bright,
     and it goes smoothly to nothing. This is the one place the project
     spends a gradient, and it spends it on the one thing in the frame
     that is not a surface.
     ================================================================== */
  const rgbaCache = new Map()

  function rgba(hex, a) {
    const key = hex + '|' + a
    let out = rgbaCache.get(key)
    if (out) return out
    const n = parseInt(hex.slice(1), 16)
    out = `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`
    rgbaCache.set(key, out)
    return out
  }

  /* The bleed off a lit thing. `reach` is how far the light carries
     beyond the shape's own edge; `amt` scales the whole thing so a
     daylight theme can turn it off by passing zero. */
  function glow(g, x, y, w, h, reach, col, amt) {
    if (!(amt > 0) || reach <= 0) return
    const cx = x + w / 2
    const cy = y + h / 2
    const rx = w / 2 + reach
    const ry = h / 2 + reach
    const R = Math.max(rx, ry)

    g.save()
    g.globalCompositeOperation = 'lighter'
    g.translate(cx, cy)
    // one gradient, squashed to the shape's proportions, so a long
    // horizontal tube throws a long horizontal glow
    g.scale(rx / R, ry / R)
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, R)
    /* The core is deliberately short and the tail deliberately long.
       A linear falloff reads as a disc with an edge; this reads as
       light, because light does most of its dying close in. */
    grd.addColorStop(0, rgba(col, Math.min(1, 0.62 * amt)))
    grd.addColorStop(0.18, rgba(col, Math.min(1, 0.34 * amt)))
    grd.addColorStop(0.45, rgba(col, Math.min(1, 0.12 * amt)))
    grd.addColorStop(1, rgba(col, 0))
    g.fillStyle = grd
    g.fillRect(-R, -R, R * 2, R * 2)
    g.restore()
  }

  /* A cone of light thrown from a point — a searchlight under a drone,
     a tractor beam under a saucer.

     These were dithered, and a dithered cone is the worst case for an
     ordered kernel: the intensity falls off across BOTH axes at once,
     so most of the cone sits down in the sparse levels where Bayer
     stops being a gradient and becomes a stencil. What you got was a
     triangle of loose speckle that read as debris falling out of the
     thing rather than as light coming out of it.

     A clipped radial falloff instead, composited `lighter` like every
     other light in the scene. Same reasoning as the neon: a beam is a
     source, not a surface. */
  function beam(g, x, y, spread, length, col, amt) {
    if (!(amt > 0)) return
    g.save()
    g.globalCompositeOperation = 'lighter'
    g.beginPath()
    g.moveTo(x - 2, y)
    g.lineTo(x + 2, y)
    g.lineTo(x + spread, y + length)
    g.lineTo(x - spread, y + length)
    g.closePath()
    g.clip()
    const grd = g.createRadialGradient(x, y, 0, x, y, length)
    grd.addColorStop(0, rgba(col, Math.min(1, 0.55 * amt)))
    grd.addColorStop(0.35, rgba(col, Math.min(1, 0.2 * amt)))
    grd.addColorStop(1, rgba(col, 0))
    g.fillStyle = grd
    g.fillRect(x - spread, y, spread * 2, length)
    g.restore()
  }

  /* A soft pool of light in the air — the high cold patches near the
     zenith, the sign colour bouncing off the underside of the smog,
     the strata lying across the ramp.

     All of these were per-pixel dithered, which was wrong twice over.
     Wrong to look at, because a big soft blob rendered through an
     ordered kernel at low intensity is a lattice, not a haze. And
     ruinously slow: nine pools at five hundred by a hundred and ninety
     is most of a million dot() calls, each of which does nine
     sub-pixel tests at S=3, and that single loop was eighty
     milliseconds of the rebuild on its own.

     One gradient fill each instead. Faster by three orders of
     magnitude, and it finally looks like air. */
  function pool(g, cx, cy, rw, rh, col, amt) {
    if (!(amt > 0)) return
    const R = Math.max(rw, rh)
    g.save()
    g.globalCompositeOperation = 'lighter'
    g.translate(cx, cy)
    g.scale(rw / R, rh / R)
    const grd = g.createRadialGradient(0, 0, 0, 0, 0, R)
    grd.addColorStop(0, rgba(col, amt))
    grd.addColorStop(0.5, rgba(col, amt * 0.4))
    grd.addColorStop(1, rgba(col, 0))
    g.fillStyle = grd
    g.fillRect(-R, -R, R * 2, R * 2)
    g.restore()
  }

  function dot(g, x, y, t, col) {
    if (t <= 0) return
    if (S === 1) {
      if (t > (BAYER[y & 7][x & 7] + 0.5) / BAYER_N) {
        g.fillStyle = col
        g.fillRect(x, y, 1, 1)
      }
      return
    }
    const dx = x * S
    const dy = y * S
    g.fillStyle = col
    for (let j = 0; j < S; j++) {
      const row = BAYER[(dy + j) & 7]
      for (let i = 0; i < S; i++) {
        if (t > (row[(dx + i) & 7] + 0.5) / BAYER_N) {
          g.fillRect(x + i * SUB, y + j * SUB, SUB, SUB)
        }
      }
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

  /* What the city sells.

     It was ramen, sushi, tacos and sake — a generic east-Asian
     cyberpunk street that every one of these scenes has, and one
     that says nothing about whose city this is. It is an Indian one
     now: the businesses that are actually open at midnight on a road
     like this, and the ones with the good signage.

     Short, because a billboard is forty pixels across — and kind,
     because a skyline of good small businesses is a city you want to
     look at for longer. Nothing here is a real brand. */
  const SIGNS = [
    'CHAI', 'DOSA', 'IRANI CAFE', 'PAAN', 'BIRYANI', 'KULFI',
    'TIFFIN', 'SAMOSA', 'JALEBI', 'CHAAT', 'FILTER KAPI', 'THALI',
    'LASSI', 'VADA PAV', 'SWEETS', 'OPEN LATE', 'TAILOR', 'BOOKS',
    'XEROX', 'STD ISD PCO',
  ]
  const TALL_SIGNS = [
    'CHAI', 'BAR', 'HOTEL', 'DHABA', 'MESS', 'CAFE',
    'PAAN', 'SWEET', 'IDLI', 'OPEN', 'LODGE', 'TIFFIN',
  ]

  /* The airship and its banner are gone, and so is the plane that
     towed one. Both put WORDS in the backdrop, and a page whose job
     is to be read cannot afford a second thing in the frame asking to
     be read — least of all one that moves. */

  const MOVIES = ['HOUSEFULL', 'MATINEE', 'FIRST DAY FIRST SHOW', 'INTERVAL']

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
    /* The tile is built RAW — eight by eight actual pixels, no
       supersampling transform on it — and then handed a pattern
       transform of 1/S so that when it is painted through a context
       scaled by S it lands one tile cell per DEVICE pixel.

       Without that the tile would be scaled up with everything else
       and each Bayer cell would come out as an S x S block, which is
       the opposite of the point: the washes would get coarser as the
       resolution went up. This is the line that turns the extra pixels
       into finer haze instead of bigger haze. */
    const c = document.createElement('canvas')
    c.width = 8
    c.height = 8
    const x = c.getContext('2d')
    x.imageSmoothingEnabled = false
    x.fillStyle = col
    for (let y = 0; y < 8; y++) {
      for (let i = 0; i < 8; i++) {
        if (BAYER[y][i] < lvl) x.fillRect(i, y, 1, 1)
      }
    }
    p = x.createPattern(c, 'repeat')
    if (S !== 1 && p.setTransform) p.setTransform(new DOMMatrix([SUB, 0, 0, SUB, 0, 0]))
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
     COLOUR SHIFT

     Every colour in the palettes below is authored as a flat hex, which
     is right for a fixed palette and wrong the moment you want three
     hundred buildings not to all be the same building. Rather than
     grow a variant of every entry, a colour can be nudged a few points
     per channel at draw time.

     Results are cached, and there are only a few dozen distinct
     (colour, delta) pairs in the whole scene, so the parsing happens
     once per palette per theme and never again.
     ================================================================== */
  const clamp255 = (v) => (v < 0 ? 0 : v > 255 ? 255 : v)
  const shiftCache = new Map()

  function shift(hex, d, amt) {
    if (!d) return hex
    const key = hex + '|' + d + '|' + amt
    let out = shiftCache.get(key)
    if (out) return out
    const n = parseInt(hex.slice(1), 16)
    const r = clamp255(((n >> 16) & 255) + Math.round(d[0] * amt))
    const gg = clamp255(((n >> 8) & 255) + Math.round(d[1] * amt))
    const b = clamp255((n & 255) + Math.round(d[2] * amt))
    out = '#' + (((1 << 24) | (r << 16) | (gg << 8) | b).toString(16).slice(1))
    shiftCache.set(key, out)
    return out
  }

  /* Blend two palette entries, quantised to a fixed number of steps.

     This is how a ramp is supposed to be built on hardware with a
     palette: you spend palette entries on the gradient and you do not
     dither it at all. Dithering is what you do when you have run OUT
     of entries.

     The sky ramp was dithered between neighbouring stops, and that is
     what put a screen-door over the entire top half of the frame. An
     ordered dither at a low blend fraction is not subtle — it is a
     perfectly regular lattice, the same handful of pixels lighting up
     in every 8x8 cell across four hundred rows. Sparse and regular is
     the most visible thing a dither can be, which is why the sky read
     as textured everywhere rather than as air.

     Cached on the same principle as `shift`: a few hundred distinct
     (a, b, step) triples for the whole ramp, parsed once. */
  const mixCache = new Map()

  function mix(a, b, t, steps) {
    const q = Math.round(t * steps) / steps
    if (q <= 0) return a
    if (q >= 1) return b
    const key = a + '|' + b + '|' + q
    let out = mixCache.get(key)
    if (out) return out
    const na = parseInt(a.slice(1), 16)
    const nb = parseInt(b.slice(1), 16)
    const r = Math.round(((na >> 16) & 255) + (((nb >> 16) & 255) - ((na >> 16) & 255)) * q)
    const gg = Math.round(((na >> 8) & 255) + (((nb >> 8) & 255) - ((na >> 8) & 255)) * q)
    const bl = Math.round((na & 255) + ((nb & 255) - (na & 255)) * q)
    out = '#' + (((1 << 24) | (r << 16) | (gg << 8) | bl).toString(16).slice(1))
    mixCache.set(key, out)
    return out
  }

  const luma = (hex) => {
    const n = parseInt(hex.slice(1), 16)
    return 0.3 * ((n >> 16) & 255) + 0.6 * ((n >> 8) & 255) + 0.1 * (n & 255)
  }

  /* ---- what a building is made of ----
     Concrete, brick, glass, something in shadow, something the sodium
     lamps have stained. Six small shifts along a warm/cool axis,
     applied to a layer's three body values.

     Small on purpose. Two towers that touch have to separate; the layer
     as a whole still has to read as one distance, because that is the
     job aerial perspective is doing over the top of it. */
  /* Nine materials rather than six, and each travels further than it
     used to. Six shifts of a dozen points across a whole skyline is
     not enough to stop three hundred towers reading as one wall with a
     pattern on it — you need the difference between two neighbours to
     be obvious at a glance, because at this scale a glance is all any
     one building gets.

     The axis is warm/cool with a lightness component, which is what
     separates brick from glass from concrete in a real skyline. How
     far each shift actually travels is still scaled by `matAmt` off
     the layer's own brightness, so the near layer does not blow out. */
  const MATERIAL = [
    null,             // the layer exactly as authored
    [30, 8, -12],     // brick
    [-16, 0, 34],     // glass
    [24, 20, 10],     // pale concrete
    [-24, -14, -2],   // in shadow
    [36, 16, -18],    // sodium-stained
    [-10, 14, 6],     // green glass
    [18, -6, 22],     // stained render
    [8, 4, -22],      // dark brick
  ]

  /* ==================================================================
     PALETTES

     Night is neon cyberpunk. Day is *also* cyberpunk — not a flat blue
     afternoon but a smog-lit one, the sky ramping from a hard teal at
     the zenith through amber pollution at the skyline, with the signage
     still burning through it. Bright, but not clean.
     ================================================================== */
  const THEMES = {
    night: {
      /* ---- CYBERPUNK ----

         This ramp was Batman Beyond: near-black overhead burning to
         oxblood red on the rooftops. That is a beautiful sky and it
         is a *comic book* sky — one silhouette against one hot band
         of firelight, and firelight is warm, which is the one thing
         cyberpunk is not.

         Cyberpunk is COLD light in a dark place. The city is not lit
         by a sunset behind it, it is lit by itself: mercury vapour,
         argon tubes, a hundred storeys of fluorescent glass throwing
         magenta and cyan up into the smog. So the ramp keeps its
         shape — dark at the zenith, bright at the skyline, all the
         colour down where the buildings are — and rotates the whole
         thing off the red axis onto the violet one.

         Nine stops. Ink blue overhead, through indigo and electric
         violet, into a magenta glow sitting on the rooftops. The red
         is gone entirely; nothing in this sky is warmer than pink. */
      sky: [
        '#04041c', '#07082c', '#0b0b40', '#120e56', '#1d116c',
        '#31147f', '#4e188c', '#761f92', '#a52590',
      ],
      haze: '#d63ba6',
      smog: '#4a1a72',
      fog: '#3a1880',
      fogAmt: [0.26, 0.11, 0.0],
      rainSky: '#0d0520',
      snowSky: '#241c48',
      snowWash: [0.06, 0.16], blanket: [0.85, 0.15], fogSnowBoost: 0.09,
      lightning: '#c9b6ff', boltCore: '#ffffff',

      orb: '#ecd8ff', orbShade: '#b58ce0', orbGlow: '#6b1fa8',
      craters: true, orbShine: false,
      /* Cloud is lit from BELOW here. There is no moon doing this work
         — the city is, and a city throws magenta up at its own weather.
         The underside was the same violet as the body, which made every
         cloud a flat cut-out. */
      cloud: '#2e1257', cloudLit: '#66259b', cloudDark: '#180835',
      // cold teal, deep indigo, one thin violet — see the high pools
      high: ['#0f3a6b', '#241a72', '#521a8c'],
      /* Four tiers, not three. A sky of white dots and a few amber ones
         is a texture; adding a blue-white tier between them is what
         makes it read as stars at different temperatures. No extra
         random draw — the tiers are cut out of `bright`, which every
         star already carries. */
      star: '#ffffff', starDim: '#b98cf0', starCool: '#9fd8ff', starWarm: '#ffd0a0', stars: true,

      /* The ridge behind everything: a fourth silhouette plane pitched
         just below the haze, so the far city has something to be in
         front of. Depth is planes, and three was one short. */
      /* ---- glass ----
         A city at night is not one colour of lit window. It is mostly
         the building's own cold glass, with sodium, fluorescent, a
         screen and the odd late kitchen scattered through it — and
         that scatter is where nearly all the apparent detail in a
         skyline comes from. One window colour per layer is why the
         towers read as texture rather than as buildings full of
         people.

         Weighted by repetition: the cold base wins most draws, so the
         saturated ones stay rare enough that the neon signs are still
         the loudest thing at each depth. Nearer layers get more of
         them, because that is where you could actually see in. */
      /* ---- the depth ramp ----

         Furthest is lightest and nearest is darkest, which is right for
         a night city: the far towers sit in the glow and the near ones
         are unlit bulk in front of it.

         The nearest layer had taken that to #07020f with a #020007
         shadow — three values inside six points of black. Nothing drawn
         on it could survive: the lit edge, the shadowed edge, the
         mullions, the ledges, the crown steps and the mechanical floor
         were all rendering in colours nothing can tell apart, so a
         tower that has eight separate pieces of structure on it arrived
         as one flat black rectangle.

         Every layer now carries a real interval between fill, lit and
         dark — roughly a doubling up to `lit` and a halving down to
         `dark` — so the same drawing code that was always there has
         values to draw in. The near layer is still the darkest thing in
         the frame and still reads as the nearest; it is just no longer
         a silhouette of itself. */
      /* The glass ramps rotate with the sky. They were built for the
         oxblood horizon, so the dominant window colour on every layer
         was a warm one — coral, sodium, ember — and a city whose
         windows are all firelight is a city on fire, not a cyberpunk
         one. The repeated (dominant) entry is now cold on every
         layer: cyan on the near towers, blue-white far away. Warm
         stays in as the RARE draw, one or two slots out of eight,
         which is what makes a lit kitchen at 2am read as a lit
         kitchen instead of as the general weather. */
      cityFar: {
        fill: '#2c2450', lit: '#3e3470', dark: '#1c1838', window: '#6e7cc4', warm: '#9a76c8',
        glass: ['#7c8ad4', '#7c8ad4', '#7c8ad4', '#8a7ccc', '#6e7cc4', '#a47cc8', '#7e94dc', '#7c8ad4'],
      },
      city: [
        {
          fill: '#241a48', lit: '#3c2c6e', dark: '#160f30', window: '#6ad8ff', warm: '#ff8ad0',
          glass: ['#6ad8ff', '#6ad8ff', '#8ae8ff', '#ffd88a', '#ff6ad0', '#b06aff', '#5a9ad8', '#e8f4ff'],
        },
        {
          fill: '#170f3a', lit: '#2e1c5c', dark: '#0b0722', window: '#6ae4ff', warm: '#ffc46b',
          glass: ['#6ae4ff', '#6ae4ff', '#9af0ff', '#ffc46b', '#ff5cc8', '#c26aff', '#4a86d8', '#fff0c0'],
        },
        {
          fill: '#0c0828', lit: '#22144c', dark: '#030210', window: '#7aeaff', warm: '#ffd88a',
          glass: ['#7aeaff', '#7aeaff', '#aaf4ff', '#ffd88a', '#ff4ad0', '#d06aff', '#5a96e8', '#ffe0a8'],
        },
      ],
      // hot pink, cyan, neon purple, electric yellow, neon green,
      // sodium orange, and a red that only ever means BAR
      // hot pink, cyan, neon purple, electric yellow, neon green,
      // sodium orange, and a red that only ever means BAR
      neon: ['#ff2bb0', '#00f0ff', '#b026ff', '#faff00', '#00ff9d', '#ff7a1a', '#ff2d55'],
      halo: 0.5,

      roof: '#08061a', roofLit: '#241a44', roofSpeck: '#130f2c', roofDark: '#020210',
      rail: '#140e28', railLit: '#5a3f8c', railGlint: '#e8c8ff', railDark: '#040210',
      /* `edge` is the foreground's silhouette line and is used for
         nothing else, so it can be pushed as dark as it needs to go
         without dragging any other surface down with it. `sep` is the
         haze the city is lifted with just behind that line. */
      edge: '#040210', sep: '#7a2f9e', sepDark: '#170a26',
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
      /* `catShade` is the ONE mid value the cat is allowed inside its
         silhouette — chest, haunch crease and tabby bars. It has to sit
         close enough to `cat` that the cut-out against the lit city
         never breaks, and far enough that the marks read at all. */
      cat: '#060214', catShade: '#100828', catRim: '#b026ff',
      catEye: '#7dfcff', catNose: '#ff6fae', catCollar: '#ff2bb0',
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
      fogAmt: [0.30, 0.15, 0.03],
      rainSky: '#6f7789',
      snowSky: '#dde0ec',
      /* Pale-on-pale: keep the sky wash sparse and the blanket near
         solid, so neither sits at the checkerboard midpoint. */
      snowWash: [0.05, 0.18], blanket: [0.78, 0.22], fogSnowBoost: 0.07,
      lightning: '#fff4e0', boltCore: '#ffffff',

      orb: '#fff8d2', orbShade: '#ffe6a0', orbGlow: '#ffd08a',
      craters: false, orbShine: true,
      cloud: '#c9b4c4', cloudLit: '#f6e6e0', cloudDark: '#9c8a9e',
      /* Daylight pools are close in value to the ramp they sit on — the
         point here is a sky that is not one flat sheet, not colour.
         They were not actually close: a pale mauve and a pale amber
         over a mid blue is a big jump, and a sparse ordered dither of
         a big jump is a lattice of visible dots rather than a change
         in the air. Pulled back toward the ramp. */
      high: ['#2f6ea0', '#5b7fa8', '#8f8fa4'],
      star: '#ffffff', starDim: '#cfe4f6', starCool: '#dceaff', starWarm: '#ffe0b8', stars: false,

      /* Buildings stay cool and desaturated so the signage on them is
         the only saturated thing at this depth — daylight neon only
         reads if nothing else is competing for the colour. */
      /* Daylight glass is not lit rooms, it is reflected sky, so the
         spread here is much tighter than at night — a few degrees of
         blue either side of the layer's own value. Same eight entries
         so the two themes stay symmetrical. */
      cityFar: {
        fill: '#a9b3cb', lit: '#b8c1d5', dark: '#9aa4be', window: '#c6cede', warm: '#d4c8b8',
        glass: ['#c6cede', '#c6cede', '#c6cede', '#cfd6e4', '#bcc5d8', '#d2d8e6', '#c0c9dc', '#c6cede'],
      },
      city: [
        {
          fill: '#8d9cc0', lit: '#a9b6d4', dark: '#7685ab', window: '#c6cfe6', warm: '#ffd7a4',
          glass: ['#c6cfe6', '#c6cfe6', '#c6cfe6', '#d4dcee', '#cdd0d8', '#bcc8e2', '#c9d4e0', '#d0d6e8'],
        },
        {
          fill: '#6c7aa6', lit: '#8894c0', dark: '#56638d', window: '#b0bada', warm: '#ffc78c',
          glass: ['#b0bada', '#b0bada', '#bfc8e4', '#a9b2d0', '#b6bed6', '#c2cae6', '#aab6d8', '#b8c0dc'],
        },
        {
          fill: '#49527e', lit: '#646d9c', dark: '#343b60', window: '#959fca', warm: '#ffb478',
          glass: ['#959fca', '#959fca', '#a4aed8', '#8b95c0', '#9ba5d0', '#a8b0d6', '#8f9ac4', '#9da7d2'],
        },
      ],
      /* Daylight neon is OFF. The signs keep their exact geometry — same
         random draws, so the city never rearranges between themes — but
         they render in unlit greys with no halo at all. Calm. */
      neon: ['#7c87a0', '#7a98a4', '#8a80a0', '#a89a78', '#7f9c8c', '#a08a72', '#a0808a'],
      halo: 0,

      /* The daylight roof was a mid grey and sat too close in value to
         the city behind it. It is the nearest plane in the scene; it
         should be the heaviest thing in it. */
      roof: '#5a5164', roofLit: '#7b7186', roofSpeck: '#685f74', roofDark: '#352f3e',
      rail: '#443c4e', railLit: '#988ca6', railGlint: '#ffffff', railDark: '#1c1724',
      edge: '#100c16', sep: '#efe6ec', sepDark: '#83879e',
      bounce: ['#ff8fc0', '#7fd8e8', '#ffd8a0'],
      wet: ['#ff6faa', '#4ec4dc', '#ffc27a'],
      wetDeck: '#4b4353', wetGloss: '#b6a9c2',
      puddle: '#5f5570', puddleRim: '#cbbdd6',

      viaduct: '#6a5f78', viaductLit: '#8d8299', viaductDark: '#403848',
      train: '#8b8098', trainLit: '#b3a8bf', trainDark: '#554c60',
      trainWin: '#f0e4f4', trainHead: '#fff8d8', trainStripe: '#8b97ad',

      ship: '#8f9ab8', shipLit: '#b9c1d6', shipDark: '#6a7593', shipTrim: '#0d7f96',
      cat: '#2a2436', catShade: '#463c58', catRim: '#ffbc7a',
      catEye: '#19d7e8', catNose: '#e88aa8', catCollar: '#ff3ea0',
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
  const fogBoost = () => (weather === 'snow' ? T.fogSnowBoost * snowLevel : weather === 'rain' ? 0.07 : 0)

  /* The hard ceiling on any aerial wash, weather included. An ordered
     dither is a texture below this and a checkerboard at 0.5 — and a
     checkerboard laid over one-pixel mullions and two-pixel windows is
     not weather, it is the building being deleted every other pixel.
     Everything that hazes the city clamps to this. */
  const FOG_CAP = 0.34

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

  /* ==================================================================
     PARALLAX

     This used to be counted in frames: `-Math.floor(frame / 26)` and
     friends, ticked by the 12fps counter. Which meant the far skyline
     advanced ONE PIXEL EVERY TWENTY-SIX FRAMES — one pixel every 2.2
     seconds, upscaled to nearly two on screen. That is not slow
     motion, it is a still image that lurches, and it is what read as
     jitter: the eye gets nothing at all for two seconds and then a
     jump, which is the exact signature of a dropped frame.

     Two changes fix it, and they have to happen together.

     ONE — speed. Integer-pixel art cannot move smoothly below about
     ten steps a second, because there is no such thing as half a pixel
     and a step you can count is a step you can see. The layers now
     drift in pixels per second, fast enough that the nearest ones step
     ten to twenty times a second and read as continuous drift. The
     city crosses the frame in a minute or two rather than a quarter of
     an hour.

     TWO — the clock. Frames are the wrong unit for this. Speeds are
     authored here in pixels per second and read off elapsed time, so
     the drift is identical on any machine, and — crucially — a layer
     can now step BETWEEN 12fps ticks. The scene still renders its
     content at twelve; it simply also renders when a parallax layer
     has something new to say. The upper bound on that is the fastest
     drift, so this costs about twenty renders a second at worst, not
     sixty.

     Everything else in the scene is still counted in frames and still
     steps at twelve. The stepped identity is in the cat, the fire, the
     window flicker and the train — not in whether the background is
     allowed to move.
     ================================================================== */
  /* Ridge, city 0..2, viaduct — in scene pixels per second.

     The viaduct is ZERO, and that is a correction rather than a
     tuning. Parallax is what a scene does when the CAMERA moves, and
     this camera does not: it is a fixed shot from one rooftop. The
     distant skylines are allowed to drift because at that distance the
     drift reads as the city being alive — cloud shadow, haze moving,
     the sheer scale of it. The elevated line is thirty feet away and
     bolted to the ground. Sliding it sideways said the viewer was
     travelling, which contradicted everything else in the frame, and
     it was the nearest moving thing so it contradicted it loudest.

     The line holds still now. The TRAIN still runs along it, which is
     the only thing on that structure that should ever move. */
  /* Divisors, not speeds. A layer advances one pixel every N frames
     of the 12fps tick, so every step is exactly the same length —
     which is the whole cure for the jitter. Driving this off elapsed
     milliseconds meant steps landed at uneven intervals and the eye
     reads uneven steps as stutter even when the average speed is
     right. Ridge 3px/s, near layer 12px/s. */
  const DIV = [4, 3, 2, 1, 0]

  /* ---- reading mode ----

     0 is the city awake, 1 is the city settled down to read against.

     The city goes DARK and STILL, and one thing is left burning.

     This went through two wrong answers first. Dimming everything
     kept the neon legible, and a dimmed sign is still a sign asking
     to be read — quieter, but competing. Slowing everything down kept
     eleven separate small movements going at a third speed, which is
     eleven things to ignore instead of eleven things to look at.

     Off is the answer. Every layer from the sky to the deck goes
     under a heavy wash of the darkest colour in the palette, which
     takes the signage, the lit windows, the string lights, the glow
     and the parallax with it. Nothing crosses the sky. Nothing
     flickers.

     The brazier is drawn after that wash, at full strength, so the
     fire is the only light in the frame — and a single fire in a dark
     city is about as calm as this scene knows how to be. */
  const FOCUS_MS = 520
  /* How far the city goes down. Deliberately most of the way: the
     point is that the lights are OFF, not low. */
  const LIGHTS_OUT = 0.88
  let focus = 0
  let focusTo = 0

  const drift = (i) => (DIV[i] ? -Math.floor(frame / DIV[i]) : 0)

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

  /* Steps blended between each neighbouring pair of authored stops.
     Eight puts a new colour every six or seven rows, and the delta
     between two adjacent stops is small enough that each of those
     steps moves two or three points per channel — under what the eye
     picks up as a band, and far under what a dither costs in texture. */
  const SKY_LEVELS = 8

  /* ---- Sky: seven bands dithered into each other, then strata ---- */
  function buildSky() {
    sky = makeBuffer(W, H)
    const g = sky.x
    const rnd = mulberry32(6161)

    /* The ramp is one flat fill per row, on an interpolated palette.

       It used to be two: the band colour flat, then the NEXT band
       dithered over it at the blend amount. Nine authored stops across
       four hundred rows meant every row in the frame carried a partial
       dither of the stop below it, and a partial ordered dither is a
       regular lattice — so the entire sky wore a screen-door texture
       that no amount of tuning further down could undo, because it was
       under everything else.

       The stops are still the only authored colours; they are control
       points now rather than the whole palette, with SKY_LEVELS steps
       blended between each neighbouring pair. That is how a machine
       with a palette actually drew a sky: spend entries on the ramp,
       and save the dithering for the things you cannot spend entries
       on. Which is exactly what everything below this still does — the
       strata, the pools, the glow and the weather wash are all still
       dithered, and they read as texture now because they are the only
       texture there is. */
    for (let y = 0; y < SKYLINE + 8; y++) {
      let i = 0
      while (i < SKY_STOPS.length - 2 && y > SKY_STOPS[i + 1]) i++
      const span = Math.max(1, SKY_STOPS[i + 1] - SKY_STOPS[i])
      const t = Math.min(1, Math.max(0, (y - SKY_STOPS[i]) / span))
      g.fillStyle = mix(T.sky[i], T.sky[Math.min(i + 1, T.sky.length - 1)], t, SKY_LEVELS)
      g.fillRect(0, y, W, 1)
    }

    /* Smog strata. Thin horizontal shelves of haze lying across the
       ramp, tapering at both ends — pollution settles in layers, and a
       sky with layers in it reads as air rather than as a gradient. */
    for (let n = 0; n < 7; n++) {
      const by = 120 + Math.floor(rnd() * (SKYLINE - 160))
      const bh = 3 + Math.floor(rnd() * 10)
      const bx = Math.floor(rnd() * W)
      const bw = 220 + Math.floor(rnd() * 520)
      // a long flat lens, tapering to nothing at both ends
      pool(g, (bx + bw / 2) % W, by + bh / 2, bw / 2, bh, T.smog, 0.13)
    }

    /* ---- high pools ----
       The top third of the frame had the ramp in it and nothing else.
       The strata sit lower than this, the city glow pools at the
       skyline, and there is no signage within two hundred pixels — so
       it was nine stops of violet and a scatter of white dots covering
       a third of the picture.

       These are the same dithered pools the city glow uses down at the
       skyline, moved up and cooled off: the last of the atmosphere
       catching what little reaches it, in colours the ground never
       gets. Cold teal, deep indigo, one thin rose, all very sparse.

       Note what they are NOT. The galactic band below was removed
       because a broad soft diagonal is a shape this scene has no
       vocabulary for — everything in it is a hard edge or a deliberate
       dither. A dithered pool is a shape it already speaks, which is
       the whole reason this works where that did not. */
    if (T.high) {
      for (let i = 0; i < 9; i++) {
        const cx = Math.floor(rnd() * W)
        const cw = 180 + Math.floor(rnd() * 320)
        const cy = 8 + Math.floor(rnd() * 150)
        const ch = 70 + Math.floor(rnd() * 120)
        const col = T.high[Math.floor(rnd() * T.high.length)]
        pool(g, cx + cw / 2, cy + ch / 2, cw / 2, ch / 2, col, 0.11)
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

    /* City glow pooling above the skyline — flat in x, so it washes.

       This is the band the whole skyline is drawn against, and four
       separate dithered things were stacking in it: the ramp, the smog
       strata, this glow at 0.85, and the bounce pools on top. By the
       time a building was laid over that, its silhouette had nothing
       clean to be a silhouette against — the sky was as busy as the
       city. Cubed rather than squared, and topping out below the
       checkerboard, so the glow is still there but it is a field the
       towers can sit in front of. */
    for (let y = SKYLINE - 160; y < SKYLINE; y++) {
      const t = 1 - (SKYLINE - y) / 160
      washRow(g, y, W, T.haze, t * t * t * 0.52)
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
        // centred ON the skyline so only its upper half shows — the
        // glow is coming up off the streets, not sitting in the air
        pool(g, cx + cw / 2, SKYLINE, cw / 2, ch, col, 0.16)
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

    /* `o` is re-pointed at a tinted copy of itself for the duration of
       each building (see MATERIAL, and the top of the loop), so the
       three body colours vary tower to tower without every draw call
       in here having to be rewritten to name a different object. The
       original is kept to restore afterwards, because the landmarks
       and the returned fill must be the layer's own values, not
       whatever the last tower happened to be made of.

       How far the tint is allowed to travel scales with how bright the
       layer is. The same delta that separates two mid-grey towers
       turns two near-black ones into different colours entirely, and
       the near layer here is nearly black on purpose. */
    const base = o
    const matAmt = Math.max(0.35, Math.min(1, luma(base.fill) / 70))

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

         There were four, and all four were rectangles: an office slab,
         a thin rectangle, a short wide rectangle, and a rectangle. So
         the skyline was three hundred boxes of varying height, which
         is why every building read as the same building no matter how
         much detail went on its face. Silhouette is the first thing
         the eye reads and the last thing it forgets, and a city where
         every roofline is flat has thrown that away.

         Five more, all of them defined by the shape of their TOP,
         because that is the part that meets the sky:

         BANDED    continuous lit floor strips instead of a window grid
                   - the office slab, the most recognisable shape in
                   the reference after the neon itself.
         NEEDLE    a narrow spire, far taller than its neighbours.
         SLAB      low, wide, nearer the street.
         DOME      a drum with a half-round cap - a capitol, a museum,
                   an observatory that is not the landmark one.
         DRUM      a true cylinder: curved shoulders both sides and
                   vertical shading, the round hotel tower.
         ZIGGURAT  art deco, stepping in hard three or four times.
         PITCHED   a low hall under a peaked roof - a market, a depot,
                   the older stock every real city keeps at its feet.
         BARREL    a low block under a half-round vault, the shed with
                   an arched roof that sits between the towers.
         GRID      the ordinary tower, still the most common thing.

         Picked BEFORE w and h are used, so a needle reshapes itself
         rather than being a normal tower wearing a mast. */
      /* Weighted hard toward DECO.

         Nine archetypes at roughly equal odds gave a skyline with a
         bit of everything in it, which is another way of saying it had
         no character — a barrel vault beside a pitched hall beside a
         drum reads as a sample book, not as a place. A real city has a
         period.

         This one now has an American one: the setback tower is more
         than a third of everything built, and the pitched sheds and
         barrel-vaulted warehouses that were littering the roofline are
         gone from the mix entirely. */
      const roll = rnd()
      const type =
        roll < 0.38 ? 'ziggurat'
        : roll < 0.52 ? 'banded'
        : roll < 0.62 ? 'needle'
        : roll < 0.70 ? 'slab'
        : roll < 0.77 ? 'dome'
        : roll < 0.84 ? 'drum'
        : 'grid'

      if (type === 'needle') {
        w = Math.max(6, Math.floor(w * 0.45))
        h = Math.floor(h * 1.35)
      } else if (type === 'slab') {
        w = Math.floor(w * 1.5)
        h = Math.floor(h * 0.55)
      } else if (type === 'dome' || type === 'drum') {
        // a round building is read by its width, so it needs some
        w = Math.max(12, Math.floor(w * 1.15))
        h = Math.floor(h * (type === 'dome' ? 0.62 : 0.9))
      } else if (type === 'ziggurat') {
        w = Math.floor(w * 1.35)
        h = Math.floor(h * 0.85)
      } else if (type === 'pitched' || type === 'barrel') {
        w = Math.floor(w * 1.4)
        h = Math.max(14, Math.floor(h * 0.3))
      }
      const top = SKYLINE - h

      // the roofline sits above `top` for anything with a cap on it,
      // and the crown/plant/mast code further down has to know
      let capH = 0
      if (type === 'dome') capH = Math.floor(w * 0.42)
      else if (type === 'pitched') capH = Math.floor(w * 0.3)
      else if (type === 'barrel') capH = Math.floor(w * 0.26)
      else if (type === 'drum') capH = 3

      // what this one is made of
      const mat = MATERIAL[Math.floor(rnd() * MATERIAL.length)]
      o = mat
        ? {
            ...base,
            fill: shift(base.fill, mat, matAmt),
            lit: shift(base.lit, mat, matAmt),
            dark: shift(base.dark, mat, matAmt),
          }
        : base

      // body
      g.fillStyle = o.fill
      g.fillRect(x, top, w, SKYLINE - top)
      g.fillStyle = o.dark
      g.fillRect(x + w - 1, top, 1, SKYLINE - top)
      g.fillStyle = o.lit
      g.fillRect(x, top, 1, SKYLINE - top)
      g.fillRect(x, top, w, 1)

      /* ---- the roofline ----
         Everything that is not a flat-topped box gets its shape here,
         drawn UP from `top` so the window grid below is untouched. All
         of it is lit top-left and shadowed bottom-right, the same rule
         the flat bodies follow, because that is what keeps nine
         different silhouettes reading as one city. */
      if (type === 'dome' || type === 'barrel') {
        // a half-round cap: for each column, how far up the arc reaches
        const r = w / 2
        const cxm = x + r
        for (let i = 0; i < w; i++) {
          const u = (i + 0.5 - r) / r
          const rise = Math.round(Math.sqrt(Math.max(0, 1 - u * u)) * capH)
          if (rise < 1) continue
          g.fillStyle = o.fill
          g.fillRect(x + i, top - rise, 1, rise)
          // the lit quarter is the upper left of the curve
          g.fillStyle = u < -0.15 ? o.lit : u > 0.45 ? o.dark : o.fill
          g.fillRect(x + i, top - rise, 1, 1)
        }
        // a lantern on the dome, and a finial
        if (type === 'dome' && w > 16) {
          g.fillStyle = o.lit
          g.fillRect(Math.round(cxm) - 2, top - capH - 3, 4, 3)
          g.fillStyle = o.neon[Math.floor(rnd() * o.neon.length)]
          g.fillRect(Math.round(cxm), top - capH - 6, 1, 3)
        }
      } else if (type === 'pitched') {
        // a peak: two straight rakes meeting in the middle
        const r = w / 2
        for (let i = 0; i < w; i++) {
          const rise = Math.round((1 - Math.abs(i + 0.5 - r) / r) * capH)
          if (rise < 1) continue
          g.fillStyle = i + 0.5 < r ? o.lit : o.dark
          g.fillRect(x + i, top - rise, 1, rise)
        }
        // ridge line
        g.fillStyle = o.dark
        g.fillRect(Math.round(x + r) - 1, top - capH, 2, 1)
      } else if (type === 'drum') {
        /* A cylinder is shading, not outline: a lit band a third of
           the way across and a shadowed one down the far side, held
           all the way down the body. Round the shoulders by one pixel
           either side so the top does not read as a flat lid. */
        const band = Math.max(1, Math.floor(w / 7))
        g.fillStyle = o.lit
        g.fillRect(x + band, top, band, SKYLINE - top)
        g.fillStyle = o.dark
        g.fillRect(x + w - band * 2, top, band, SKYLINE - top)
        g.fillStyle = o.fill
        g.fillRect(x + 1, top - 2, w - 2, 2)
        g.fillStyle = o.lit
        g.fillRect(x + 1, top - 2, w - 2, 1)
        g.fillRect(x + 2, top - 3, w - 4, 1)
      } else if (type === 'ziggurat') {
        /* ---- the setback tower ----

           The shape the 1930s put on every skyline in America, and it
           is three things rather than one. It was only doing the first.

           THE SETBACKS. The body steps in as it rises, drawn downward
           from the top so each shelf shadows the one beneath it.

           THE FLUTING. Vertical piers running the full height of every
           stage, with recesses between them. This is the part that was
           missing and it is the part that makes the style read: a deco
           tower is not a stack of boxes, it is a bundle of vertical
           lines that happens to step. Without the piers the same
           silhouette is just a wedding cake.

           THE CROWN. A narrow finial on the last stage with a lit tip.
           Every one of these buildings ends in a point, because the
           whole argument of the style is upward. */
        let zx = x
        let zw = w
        let zy = top
        const stages = 3 + Math.floor(rnd() * 2)

        for (let s = 0; s < stages && zw > 8; s++) {
          const inset = Math.max(2, Math.floor(zw * 0.14))
          const sh = 10 + Math.floor(rnd() * 14)
          zx += inset
          zw -= inset * 2
          zy -= sh
          if (zw < 5) break

          g.fillStyle = o.fill
          g.fillRect(zx, zy, zw, sh + 1)
          g.fillStyle = o.dark
          g.fillRect(zx + zw - 1, zy, 1, sh)
          g.fillStyle = o.lit
          g.fillRect(zx, zy, zw, 1)
          g.fillRect(zx, zy, 1, sh)

          // piers and recesses, every three pixels across the face
          for (let fx = zx + 2; fx < zx + zw - 2; fx += 3) {
            g.fillStyle = o.dark
            g.fillRect(fx, zy + 2, 1, sh - 1)
            g.fillStyle = o.lit
            g.fillRect(fx + 1, zy + 2, 1, sh - 1)
          }

          // a shelf line under each setback, catching the light
          g.fillStyle = o.lit
          g.fillRect(zx - inset, zy + sh, zw + inset * 2, 1)
          cap(zx, zy + 1, zw, 3)
        }

        // the crown: a stepped finial, lit at the tip
        const fx0 = Math.round(zx + zw / 2)
        for (let k = 0; k < 3; k++) {
          const fw = 5 - k * 2
          if (fw < 1) break
          g.fillStyle = o.fill
          g.fillRect(fx0 - (fw >> 1), zy - 6 - k * 5, fw, 6)
          g.fillStyle = o.lit
          g.fillRect(fx0 - (fw >> 1), zy - 6 - k * 5, 1, 6)
        }
        g.fillStyle = o.window
        g.fillRect(fx0, zy - 24, 1, 6)
      }

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
         plant — so masts and tanks sit on the crown, not in mid-air.

         Only flat-topped buildings get one. A dome, a pitched roof, a
         vault and a ziggurat have already said what their top is, and
         stacking a crown on them would put a box through the middle of
         the shape that makes them recognisable in the first place. */
      const flatTop =
        type !== 'dome' && type !== 'pitched' && type !== 'barrel' && type !== 'ziggurat'
      let cx = x
      let cw = w
      let cy = top
      if (flatTop && h > 78 && w > 12) {
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
      if (flatTop) {
        cap(cx, cy + 1, cw, 3)
        if (cx > x) {
          cap(x, top + 1, cx - x, 3)
          cap(cx + cw, top + 1, x + w - (cx + cw), 3)
        }
      }

      // rooftop plant: a box, a tank, or a vent stack
      if (rnd() < 0.16 && flatTop && cw > 10) {
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
      if (rnd() < 0.12 && flatTop) {
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
          // one storey, one tenant, one colour of light
          const pane = o.glass[Math.floor(rnd() * o.glass.length)]
          const lit = rnd() < 0.55
          g.fillStyle = lit ? pane : o.dark
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
            // `wall` is this tower's own body colour — see flicker(),
            // which paints a window out by painting the wall back in
            if (rnd() < 0.3) windows.push({ x: x + 2, y: ly, w: w - 4, h: Math.min(2, o.wh), wall: o.fill })
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
          /* Which room this is. The draw is taken whether or not it
             gets used, so night and day walk the same random stream
             and the city never rearranges itself on a theme toggle —
             the same rule the signage geometry already follows. */
          const pane = o.glass[Math.floor(rnd() * o.glass.length)]
          const warmOne = rnd() < 0.12
          g.fillStyle = warmOne
            ? (snowy ? FESTIVE[((wx >> 2) + wy) % 3] : o.warm)
            : pane
          g.fillRect(wx, wy, o.ww, hh)
          // a body at the glass — one darker pixel, and the floor lives
          if (o.ww > 2 && rnd() < 0.18) {
            g.fillStyle = o.dark
            g.fillRect(wx + 1, wy + hh - 1, 1, 1)
          }
          if (rnd() < 0.24) windows.push({ x: wx, y: wy, w: o.ww, h: hh, wall: o.fill })
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

        /* The bleed onto the wall. It is clipped to the tower it is
           bolted to — light spilling off the sides of a building it is
           mounted flat against would be light with nothing to land on
           — but within that it is a real falloff now rather than a
           dither, so a tube looks lit instead of surrounded by
           speckle. */
        /* The bleed off the tube.

           This used to be clipped to the tower the tube is bolted to,
           on the reasoning that light spilling off the sides of a
           building it is mounted flat against is light with nothing to
           land on. That reasoning is wrong, and it is why the city had
           no glow in it: a neon tube is a gas discharge in open air,
           and the thing that makes one read as LIT rather than as
           painted is precisely the halo you see against the sky beside
           it. Clipping that away left every sign looking like a decal.

           Unclipped, and with real reach. It spills onto the wall, off
           the edges, and into the sky — which is what neon does. */
        const halo = (hx, hy, hw, hh) => {
          if (!o.halo) return
          glow(g, hx, hy, hw, hh, 22, col, o.halo * 2.6)
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

    // back to the layer's own colours before anything that is not a
    // building gets drawn in them
    o = base

    // Landmarks go in with the buildings, before the wash, so they take
    // the same aerial perspective as everything else at this depth.
    if (o.landmarks) o.landmarks(g, o, windows, beamSources)

    /* Aerial perspective. Everything at this depth is washed toward the
       horizon colour — stronger the further back, stronger again in fog
       or snow. source-atop keeps it off the transparent sky.

       Two rules govern this wash, and breaking either one dissolves the
       city into noise:

       ONE — it never reaches the checkerboard. An ordered dither at
       t = 0.5 replaces every other pixel, which at this scale is not
       haze, it is a destroyed image: the mullions are one pixel wide,
       the windows are two, and half of every one of them goes. FOG_CAP
       holds the wash below that, so the dither stays a texture laid
       over the buildings rather than a texture that has eaten them.

       TWO — it pools at the base. It used to carry 42% of its strength
       at the very top of the frame, so a tower's crown, its mast and
       its whole upper half were hazed as hard as its feet. Haze is
       densest where the air is thickest, which is at street level, and
       squaring the ramp puts it there: near nothing up high, full
       strength along the skyline. That is what lets a building have a
       readable silhouette and still sit back in the distance. */
    const amt = Math.min(FOG_CAP, o.fog + fogBoost() * (o.fog > 0.15 ? 1.2 : 0.7))
    if (amt > 0.01) {
      const col = fogColour()
      g.globalCompositeOperation = 'source-atop'
      for (let y = 0; y < SKYLINE + 2; y++) {
        const t = Math.max(0, y / SKYLINE)
        washRow(g, y, LOOP_W, col, amt * (0.06 + 0.94 * t * t))
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
    // the marquee is blank now — no words in the backdrop

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
  /* ==================================================================
     THE QUIET REFERENCES

     These used to be cameos — a Triforce that assembled itself in mid
     air, a question block that floated over the skyline, a pipe that
     rose out of nowhere. They read as stickers, because that is what
     they were: things happening AT the city rather than in it.

     So they are buildings now. A Triforce is a neon sign, and a city
     full of neon signs is exactly where one belongs; it hangs on a
     roof with a lattice under it and a halo bleeding onto the wall
     behind it, drawn by the same code that draws RAMEN 24H, and it
     parallaxes with the layer it is standing on. Nobody is told it is
     there. You either catch it on the skyline or you do not, which is
     the only way an easter egg is worth anything.
     ================================================================== */

  /* Three triangles in gold neon on a roof-mounted frame. Drawn as
     outline tubes rather than solid, because that is what a neon sign
     is — bent glass, not a painted panel. */
  function triforceSign(g, x, y) {
    const R = 21
    const GOLD = '#f8d038'
    const half = (r) => Math.round(((r + 1) / R) * R * 0.58)

    // the halo first, so the tubes sit on top of it
    glow(g, x - R, y, R * 2, R * 2, 16, GOLD, T.halo * 2.2)

    // the mounting frame, same lattice the billboards use
    g.fillStyle = T.signBox
    g.fillRect(x - 2, y + R * 2, 4, 16)
    for (let k = 0; k < 2; k++) g.fillRect(x - 8, y + R * 2 + 4 + k * 6, 16, 2)

    /* One triangle as a tube: the two rakes and the base. Stepping the
       rakes by whole pixels is what makes it read as bent glass rather
       than as a vector shape somebody pasted in. */
    const tri = (ox, oy) => {
      for (let r = 0; r < R; r++) {
        const hw = half(r)
        g.fillStyle = GOLD
        g.fillRect(ox - hw, oy + r, 2, 1)
        g.fillRect(ox + hw - 2, oy + r, 2, 1)
      }
      g.fillRect(ox - half(R - 1), oy + R - 1, half(R - 1) * 2, 2)
    }

    tri(x, y)
    tri(x - Math.round(R * 0.58), y + R)
    tri(x + Math.round(R * 0.58), y + R)
  }

  /* A question block, as a lit sign on the side of a tower. It is the
     one shape from that game everybody can draw from memory, so it
     survives being twelve pixels across on a distant building. */
  function queryBlock(g, x, y) {
    const s = 14
    glow(g, x, y, s, s, 12, '#e8901f', T.halo * 2)
    g.fillStyle = '#e8901f'
    g.fillRect(x, y, s, s)
    g.fillStyle = '#a8600f'
    g.fillRect(x, y + s - 2, s, 2)
    g.fillRect(x + s - 2, y, 2, s)
    g.fillStyle = '#3a2408'
    for (const [rx, ry] of [[1, 1], [11, 1], [1, 11], [11, 11]]) g.fillRect(x + rx, y + ry, 2, 2)
    // the "?" itself
    g.fillRect(x + 5, y + 4, 4, 2)
    g.fillRect(x + 8, y + 5, 2, 2)
    g.fillRect(x + 6, y + 7, 3, 2)
    g.fillRect(x + 6, y + 10, 2, 2)
  }

  /* ==================================================================
     THE REST OF THEM

     Written as sprite strings — one character per pixel, '.' is a hole
     — because that is the only way pixel art in a source file stays
     editable. Each one is mounted on a roof as a lit sign with a real
     glow under it, at whatever scale the layer it lands on can carry.

     They are deliberately scattered across all three skylines rather
     than lined up on one, so no single frame contains more than two or
     three of them and the city never turns into a quiz. Most visitors
     will catch one. Nobody is going to catch all of them without
     sitting there, which is the point.
     ================================================================== */
  function signboard(g, x, y, word) {
    const w = 78
    const h = 28

    glow(g, x, y, w, h, 18, T.sign, T.halo ? 1.5 : 0.35)

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

  /* ==================================================================
     AERIAL PERSPECTIVE, DONE IN THE PALETTE

     Depth was being carried entirely by a dithered wash laid over each
     finished layer, and that wash had to be kept weak or it turned the
     city into a checkerboard. Weak wash, no separation: four skylines
     sitting at almost the same value, which is exactly what "flat"
     looks like.

     The fix is to stop asking the dither to do it. Every colour a
     layer is built FROM is blended toward the horizon before a single
     building is drawn — so the far city is genuinely made of paler,
     lower-contrast material, not the near city with fog on top of it.
     No pixels are spent, nothing is thresholded, and the separation
     can now be as strong as the picture needs because it costs no
     texture at all.

     The `glass` array recedes with everything else. Lit windows that
     stayed saturated while their walls went pale were the other half
     of the flatness: distance kills contrast, and a window is contrast. */
  function recede(pal, amt) {
    if (!(amt > 0)) return pal
    const sky = fogColour()
    const to = (hex) => mix(hex, sky, amt, 24)
    const out = { ...pal }
    for (const k of ['fill', 'lit', 'dark', 'window', 'warm']) {
      if (out[k]) out[k] = to(out[k])
    }
    if (Array.isArray(out.glass)) out.glass = out.glass.map(to)
    return out
  }

  /* The skyline is built as five independent steps rather than one
     call, so a rebuild can be spread across frames instead of landing
     as a single stall. Each city buffer is 5760x1620 at S=3 and takes
     roughly a fortieth of a second to fill; four of them plus the sky,
     the clouds, the viaduct and the roof in one synchronous block came
     to about 134ms, which at 60fps is eight frames dropped in a row —
     and it landed at precisely the moment the weather changed, which
     is the moment you are looking. See stageRebuild. */
  const skylineSteps = () => [
    () => {
      beamSources = []
      buildRidge()
    },
    () => buildLayer0(),
    () => buildLayer1(),
    () => buildLayer2(),
    () => buildSignage(),
  ]

  function buildSkyline() {
    for (const step of skylineSteps()) step()
  }

  function buildRidge() {
    /* The far ridge: low, wide, nearly featureless towers one step off
       the haze colour. No neon, almost no windows, no flicker — at that
       distance a city is a shape, not an event. It drifts slowest of
       all, which is what tells the eye it is furthest away. */
    /* The four RECEDE amounts are the depth ramp. They are what makes
       this read as four distances rather than four heights, and they
       are deliberately far apart — half the palette's distance to the
       horizon for the ridge, none at all for the near layer, which
       keeps its full authored contrast because it is the thing you are
       standing closest to. */
    ridge = buildCity(7777, {
      minW: 26, maxW: 60, minH: 18, maxH: 64,
      step: 6, ww: 1, wh: 1, litChance: 0.1,
      neon: T.neon, neonChance: 0, halo: 0, fog: 0.10,
      ...recede(T.cityFar, 0.5),
    })
  }

  function buildLayer0() {
    city[0] = buildCity(4411, {
        minW: 12, maxW: 26, minH: 60, maxH: 150,
        step: 4, ww: 2, wh: 2, litChance: 0.30,
        neon: T.neon, neonChance: 0.10, halo: T.halo, fog: 0.08,
        ...recede(T.city[0], 0.32),
        landmarks: (g, o) => {
          stadium(g, o, 420)
          bridge(g, o, 1020)
          radioDish(g, o, 1640)
        },
    })
  }

  function buildLayer1() {
    city[1] = buildCity(881, {
        minW: 16, maxW: 34, minH: 90, maxH: 205,
        step: 5, ww: 2, wh: 3, litChance: 0.34,
        neon: T.neon, neonChance: 0.18, halo: T.halo, fog: 0.04,
        ...recede(T.city[1], 0.14),
        /* Spread across the loop so that at any moment one or two are
           in frame and the rest are on their way round. */
        landmarks: (g, o, windows) => {
          ferrisWheel(g, o, 140, windows)
          driveIn(g, o, 560, windows)
          clockTower(g, o, 900)
          crane(g, o, 1300, windows)
          rocket(g, o, 1750)
          /* The quiet references, standing on roofs like any other
             sign. Spaced so no two are ever in the same frame. */
          triforceSign(g, 1480, SKYLINE - 196)
          windowCat(g, o, 372, SKYLINE - 96)
          windowWashers(g, o, 1075, SKYLINE - 190, SKYLINE - 96)
          rooftopPool(g, o, 690, SKYLINE - 152)
        },
    })
  }

  function buildLayer2() {
    city[2] = buildCity(2266, {
        minW: 22, maxW: 46, minH: 50, maxH: 130,
        step: 7, ww: 3, wh: 3, litChance: 0.3,
        neon: T.neon, neonChance: 0.22, halo: T.halo, fog: 0,
        ...T.city[2],
        landmarks: (g, o, windows, beams) => {
          lighthouse(g, o, 180, beams)
          pagoda(g, o, 690)
          dinosaur(g, o, 1080)
          observatory(g, o, 1500)
          gargoyle(g, o, 940, SKYLINE - 118)
          windowCat(g, o, 1666, SKYLINE - 74)
        },
    })
  }

  function buildSignage() {

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
    /* Nine hundred stones was too many. Every one is a lit pixel with a
       dark one under it — a chip with its own shadow — which is the
       right way to draw ballast and also means each one is competing
       with the props standing on the same deck. At this density the
       floor was reading as texture rather than as floor, and the air
       handlers and crates were sitting in a field of noise.

       Fewer, and thinned toward the front: the near half of the deck
       is where the objects are and where the eye goes, so that is the
       half that has to stay quiet. */
    for (let i = 0; i < 560; i++) {
      const x = Math.floor(rnd() * W)
      const y = ROOF_TOP + 8 + Math.floor(rnd() * (H - ROOF_TOP - 12))
      const sw = rnd() < 0.28 ? 2 : 1
      // thin out as the deck comes toward the viewer
      if (y > ROOF_TOP + 70 && i % 2) continue
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

       1. There WAS a dithered band of haze here — twenty-four rows of
          `sep` laid over the city immediately above the parapet, at up
          to 0.5 dry and 0.66 under snow, meant to lift the background
          away from the foreground's value.

          It is gone. Both of those amounts are at or past the
          checkerboard, so what it actually put on screen was a solid
          slab of alternating pixels twenty-four rows deep, running the
          full width of the frame, sitting exactly across the bottom
          storeys of the near city — which is where the street-level
          signage is. Every sign down there was being read through it.
          It was the single largest patch of pure noise left in the
          scene and it was destroying the most legible thing in it.

          The job it was supposedly doing is done properly, and with
          one flat line instead of a field of dither, by the rim
          below. */

    /*  2. The single most important line in the whole scene: a hard,
          near-black rim along the very top of the coping, in a colour
          used for nothing else so it can go as dark as it needs to. A
          silhouette edge is what separates a foreground from a
          background in pixel art, and three pixels was not enough of
          it once the coping could be covered in snow. */
    g.fillStyle = T.edge
    g.fillRect(0, capY - 6, W, 6)

    /* ---- the catch light ----

       This one line is doing more work than everything else on the
       parapet put together.

       The problem was never that the roof and the city were the wrong
       values — it was that at the seam between them there was nothing
       for the eye to LOCK onto. Two dark planes meeting at a dark edge
       is one plane. What separates a foreground in any picture drawn
       this way is a hard bright rim along its topmost surface: the
       near thing catches the light that the far thing is generating,
       and the moment that line exists the two stop being the same
       distance away.

       So the coping now goes near-black immediately above (six pixels
       of `edge`, up from four), then a single bright pixel of catch
       along its very top, then its lit face, its front, its undercut.
       Reading down: shadow, light, mid, dark. Four values in twelve
       pixels, and the picture gains a foreground. */
    g.fillStyle = T.railGlint || T.railLit
    g.fillRect(0, capY, W, 1)
    g.fillStyle = T.railLit
    g.fillRect(0, capY + 1, W, 2)
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

    /* ---- no props ----

       The terrace carried a stairwell hutch, a water tank on legs, two
       air handlers, ducting, crates, a satellite dish, four poles of
       string lights, a washing line, a chess game, traffic cones, a
       bicycle, a rubber duck, a pizza box, a coin and a green pipe.

       Every one of them was drawn with care and together they were a
       junk shop sitting directly under the column of text. A rooftop
       with one fire on it reads as somewhere a person goes to be
       quiet, which is the mood this page is actually after; the same
       rooftop with eighteen objects on it reads as an I-spy puzzle.

       What is left is the deck, the parapet and the brazier — and the
       brazier is drawn per frame in drawFire, not here. */
  }

  function buildStatic() {
    buildSky()
    buildSkyline()
    buildClouds()
    buildViaduct()
    buildRoof()
  }

  /* ==================================================================
     REBUILDING WITHOUT A STALL

     Toggling the rain rebuilds every static layer, because rain
     changes them: the sky carries a wash, the roof is wet, and the
     colour the whole city recedes toward is different. That is right,
     and it is also about 134ms of synchronous canvas work — eight
     frames dropped in a row, landing at the exact moment the weather
     changes, which is the exact moment you are watching. That stall
     was the jitter. Not the ramp, not the dissolve: a hang.

     So the work is queued instead, one piece per frame, and the
     dissolve snapshot is HELD over the top while it drains. The
     snapshot is a picture of the world as it was, so the fact that the
     layers underneath are half old and half new for a few frames is
     invisible — and the falling weather is on its own canvas at 60fps,
     so the frame never actually freezes. When the queue empties the
     dissolve is released and plays out normally.

     Nine steps at roughly 15ms each, under a full frame budget. */
  let rebuildQueue = []

  function stageRebuild() {
    // Before first paint, and under reduced motion, there is nothing to
    // hide behind and nothing watching — just do it.
    if (!ready || !animating) {
      rebuildQueue = []
      buildStatic()
      return
    }
    beginDissolve()
    rebuildQueue = [
      buildSky,
      ...skylineSteps(),
      buildClouds,
      buildViaduct,
      buildRoof,
    ]
  }

  function drainRebuild() {
    if (!rebuildQueue.length) return false
    rebuildQueue.shift()()
    // hold the dissolve at full while there is more to do
    if (rebuildQueue.length) dissolveT0 = performance.now()
    return true
  }

  /* ==================================================================
     PARTICLES
     ================================================================== */
  const stars = (function () {
    const rnd = mulberry32(9271)
    const out = []
    for (let i = 0; i < 420; i++) {
      const x = Math.floor(rnd() * W)
      const y = Math.floor(rnd() * (SKYLINE - 130))
      if (rnd() < y / (SKYLINE - 130)) continue
      if (Math.hypot(x - ORB_X, y - ORB_Y) < ORB_R + 22) continue
      out.push({
        x, y,
        bright: rnd() * 0.72,
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
     flakes it takes several minutes for a ledge to read as covered.

     But four was the other end of the same mistake. Two hundred flakes
     landing at four pixels each fills an eighteen-pixel cap in about
     two seconds — so the bank did not build, it appeared, which is
     most of what made the snow read as arriving all at once. Two is
     the number that lets you watch it happen. */
  const GROW = 2

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

  /* The ledges are seeded so they do not start bare — but only in
     proportion to how much snow has actually fallen.

     They used to be seeded flat, at a fixed depth, the instant the
     weather swapped: press the button and there was already a bank on
     the parapet and a bank on the window before one flake had landed.
     Scaling the seed by snowLevel — which is zero at the moment of the
     swap and climbs with the fall — means the first frame of snow has
     nothing lying on it, and everything you see afterwards got there
     by falling. */
  function seedPanelPile() {
    const p = panelRect()
    if (!p || p.y0 <= 0) return
    const from = Math.max(0, Math.ceil(p.x0))
    const to = Math.min(W - 1, Math.floor(p.x1))
    const d = 3 * snowLevel
    for (let x = from; x <= to; x++) {
      panelPile[x] = Math.round(d + ((x >> 2) % 4 === 0 ? snowLevel : 0))
    }
  }

  function seedPiles() {
    const d = 2 * snowLevel
    for (let x = 0; x < W; x++) {
      snowPile[x] = Math.round(d + ((x >> 2) % 3 === 0 ? snowLevel : 0))
    }
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

  function blit(buf, offset, lift) {
    const o = ((offset % W) + W) % W
    // source rect is in device pixels, destination in authored ones —
    // the context transform scales the latter back up, so the copy is
    // 1:1 and nothing is resampled
    ctx.drawImage(buf.c, dev(o), 0, dev(W), dev(H), 0, -(lift || 0), W, H)
  }

  /* ---- the ground line ----

     Every skyline was standing on the SAME line. Four ranks of
     buildings, all with their feet at y = SKYLINE, which is not what
     distance does: the further away a thing is, the higher its base
     sits in your view. That single shared baseline was doing more to
     flatten this picture than any amount of haze, because no amount of
     value separation can undo the statement "all of these are the same
     distance away" made by four feet on one floor.

     Each layer is lifted now, furthest highest. Below its feet goes a
     band of its own darkest value — the undifferentiated mass of city
     at that distance — so a gap between near towers shows the layer
     behind it going down to the ground rather than showing sky at
     street level. The nearer layer draws over the top of all of it. */
  /* ==================================================================
     SEPARATING THE NEAR PLANE

     The rooftop and the city behind it were sitting in the same space.
     Not because the values were wrong — the layers recede properly now
     — but because there was nothing marking the BOUNDARY between the
     furthest thing you are standing in and the nearest thing you are
     looking at. Two planes at similar value with a hard edge between
     them read as one flat picture with a line on it, which is exactly
     what was happening.

     Real depth at that boundary comes from two things, and both are
     gradients, and both were impossible here until light got real
     alpha. Now that it has:

     ONE — the city falls into shadow as it comes down to meet the
     parapet. Distance does not only desaturate, it also darkens at the
     base where the air is thickest and no light is getting out. A
     smooth fall into `edge` over the last fifty pixels does more to
     push the skyline back than any amount of haze on the buildings
     themselves, because it is the only cue in the frame that says
     "this stops here and something else starts".

     TWO — the deck recedes. A rooftop seen from standing height is a
     plane going away from you, so it is darkest at the far edge and
     opens up toward your feet. It was painted at one flat value from
     the parapet to the bottom of the frame, which is a wall, not a
     floor.

     Both are drawn as linear gradients rather than dithered, and that
     is deliberate: a dither is a texture, and a texture laid over the
     most detailed part of the picture is what caused every problem
     this scene has had. These are pure value, no pattern, invisible as
     an effect and only legible as space. */
  function separateCity() {
    /* Taller and much deeper than the first attempt. Half a stop of
       shadow was polite and did not separate anything; the city has to
       genuinely go out as it comes down to the near plane, so the last
       few pixels above the coping are nearly solid. Against that, the
       catch light on the coping has something to be bright against —
       the two cues only work as a pair. */
    const top = ROOF_TOP - 74
    const grd = ctx.createLinearGradient(0, top, 0, ROOF_TOP + 4)
    grd.addColorStop(0, rgba(T.edge, 0))
    grd.addColorStop(0.4, rgba(T.edge, 0.18))
    grd.addColorStop(0.75, rgba(T.edge, 0.52))
    grd.addColorStop(1, rgba(T.edge, 0.88))
    ctx.fillStyle = grd
    ctx.fillRect(0, top, W, ROOF_TOP + 4 - top)
  }

  function recedeDeck() {
    // starts below the parapet's foot so the coping keeps its own
    // modelling — the rail is an object, not part of the floor
    /* Kept deliberately light. The first pass ran this to 0.5 and the
       deck read as space beautifully — and every object standing on it
       went to silhouette, because the props are modelled in three
       close values and half a stop of black eats all three. The floor
       only has to fall away enough to be a floor; the things on it
       have to stay readable, and that is the more important of the
       two. */
    const from = ROOF_TOP + 48
    const grd = ctx.createLinearGradient(0, from, 0, H)
    grd.addColorStop(0, rgba(T.edge, 0.3))
    grd.addColorStop(0.5, rgba(T.edge, 0.09))
    grd.addColorStop(1, rgba(T.edge, 0))
    ctx.fillStyle = grd
    ctx.fillRect(0, from, W, H - from)
  }

  function ground(colour, lift) {
    if (!lift) return
    ctx.fillStyle = colour
    ctx.fillRect(0, SKYLINE - lift, W, lift + 2)
  }

  const LIFT = [20, 13, 6, 0] // ridge, city 0..2 — in authored pixels

  function drawStars() {
    for (const s of stars) {
      if ((frame + s.phase) % s.rate <= s.rate * 0.2) continue
      // a handful run warm, and the middle of the range runs blue —
      // a sky of identical white dots is a texture, not a sky
      px(
        s.x, s.y,
        s.warm ? T.starWarm
          : s.bright > 0.85 ? T.star
          : s.bright > 0.55 ? T.starCool
          : T.starDim
      )
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

    /* The cat constellation used to be drawn here — eight nodes with
       dithered lines between them. It was a nice thing to find and it
       was one more thing in a sky that already had too much in it. */

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
        /* A tractor beam, while it is parked. It opens and closes
           rather than snapping on, because a light that arrives at
           full width is a rectangle appearing, not a beam. */
        if (t > 54 && t < 100) {
          const k = Math.min(1, (t - 54) / 10, (100 - t) / 10)
          beam(ctx, x, y + 4, 16 * k, 62, T.trainWin, 1.5 * k)
          glow(ctx, x - 5, y + 2, 10, 3, 8, T.trainWin, 1.2 * k)
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
  function flicker(layer, offset, lift) {
    const ly = lift || 0
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
        ctx.fillRect(sx2, wnd.y - ly, wnd.w, wnd.h)
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
      /* Painted out in the wall it is set into, which since buildings
         started carrying their own tint is no longer the same as the
         layer's fill. Landmarks have no tint and fall back to it. */
      ctx.fillStyle = beacon ? '#ff5a4a' : wnd.wall || layer.fill
      ctx.fillRect(sx, wnd.y - ly, wnd.w, wnd.h)
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
  let pokes = 0
  let secret = false

  /* What it says when you poke it.

     The first line is fixed, because the first poke is the one
     everybody makes and it should always land the same joke. After
     that it is drawn at random from the pool, never repeating the line
     just used — so a second visitor gets a different cat, and somebody
     who keeps poking gets a cat with opinions rather than a list they
     can reach the end of.

     The last entry is not in the random pool. It is the reward for
     eight pokes, and once it is reached it stays. */
  const CAT_SAYS = [
    'DO NOT TOUCH ME',
    'I SAID DO NOT',
    'THIS IS MY ROOF',
    'I AM WORKING',
    'RUDE',
    'PAWS OFF',
    'GO READ THE MENU',
    'THE DUCK LIKES THIS',
    'I WAS HERE FIRST',
    'ASK THE PIGEON',
    'NOT A BUTTON',
    'HMPH',
  ]
  const CAT_RELENTS = 'FINE. ONE PAT.'

  let catLine = CAT_SAYS[0]

  /* What it DOES, on top of what it says. One of three, picked with
     the line: a paw swipe, a full turn of the back, or an ear-flat
     hunch. The action is what makes the poke feel answered — a speech
     bubble on a motionless cat is a caption, not a reaction. */
  const CAT_ACTS = ['swipe', 'turn', 'hunch']
  let catAct = 'swipe'

  /* Click the cat and it notices you. The hit test undoes the same
     object-fit: cover mapping the panel uses, and it listens on the
     window rather than on the canvas because the stage sits over it. */
  window.addEventListener('click', (e) => {
    const { scale, ox, oy } = viewMap()
    const cx = (e.clientX - ox) / scale
    const cy = (e.clientY - oy) / scale

    // the cat
    if (Math.abs(cx - CAT_X) <= 18 && cy >= CAT_BASE - 58 && cy <= CAT_BASE + 4) {
      pokeAt = frame
      pokes++
      if (pokes >= 8) {
        catLine = CAT_RELENTS
        catAct = 'turn'
      } else if (pokes === 1) {
        catLine = CAT_SAYS[0]
        catAct = 'hunch'
      } else {
        let next = catLine
        while (next === catLine) next = CAT_SAYS[Math.floor(Math.random() * CAT_SAYS.length)]
        catLine = next
        catAct = CAT_ACTS[Math.floor(Math.random() * CAT_ACTS.length)]
      }
    }
  })

  /* A speech bubble in the pixel font, with a tail pointing down at
     whoever is talking. Hard edges and a one-pixel rim, like every
     other box in this project — the bubble is a UI element that has to
     live inside the picture, so it is built out of the picture's
     vocabulary rather than out of a rounded rectangle. */
  function bubble(cx, baseY, line, col) {
    const tw = textW(line)
    const bw = tw + 10
    const bh = 15
    const bx = Math.round(cx - bw / 2)
    const by = baseY - bh

    ctx.fillStyle = T.signBox
    ctx.fillRect(bx, by, bw, bh)
    ctx.fillStyle = col
    ctx.fillRect(bx, by, bw, 1)
    ctx.fillRect(bx, by + bh - 1, bw, 1)
    ctx.fillRect(bx, by, 1, bh)
    ctx.fillRect(bx + bw - 1, by, 1, bh)

    // the tail, three stepped rows narrowing to a point
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = T.signBox
      ctx.fillRect(cx - 3 + i, by + bh + i, 6 - i * 2, 1)
      ctx.fillStyle = col
      ctx.fillRect(cx - 3 + i, by + bh + i, 1, 1)
      ctx.fillRect(cx + 2 - i, by + bh + i, 1, 1)
    }

    text(ctx, line, bx + 5, by + 5, col)
  }

  function drawCat() {
    const c = T.cat
    const rim = T.catRim
    ctx.fillStyle = c

    const poked = frame - pokeAt
    const cross = poked < 72 && !secret
    const noticed = poked < 30 || cross || secret

    /* Turning its back is the most withering thing a cat can do and it
       costs almost nothing to draw: take away the muzzle, the whiskers,
       the nose and the eyes, and what is left is the back of a head.
       The absence IS the animation. */
    const turned = cross && catAct === 'turn'

    // tail, curling right — two frames, and lashing twice as fast when
    // it is cross, because that is the other thing a cross cat does
    const flickTail = (frame % (cross ? 12 : 26)) < (cross ? 6 : 13) ? 0 : -2
    for (let i = 0; i < 22; i++) {
      const tx = CAT_X + 11 + i
      const ty = CAT_BASE - 1 - Math.round(Math.sin((i / 22) * 2.1) * 13) - (i > 14 ? flickTail : 0)
      ctx.fillRect(tx, ty, 2, 3)
    }

    /* ---- the body ----
       Two stacked cones with a waist between them was a snowman. A
       sitting cat has a HEAVY seat that flares at the floor, a waist
       that pulls in above it, and a chest that comes forward again —
       so the profile is a shallow S, not a triangle. Driving the width
       off a curve rather than a straight taper is the whole
       difference, and it costs one sine. */
    for (let i = 0; i < 30; i++) {
      const y = CAT_BASE - 1 - i
      const u = i / 30
      const half = Math.round(14 - u * 8 + Math.sin(u * 3.0) * 1.8)
      ctx.fillRect(CAT_X - half, y, half * 2, 1)
    }

    // shoulders into head, with a neck that actually narrows
    for (let i = 0; i < 16; i++) {
      const y = CAT_BASE - 31 - i
      const u = i / 16
      const half = Math.round(6.5 + Math.sin(u * 3.14) * 2.2 + u * 1.8)
      ctx.fillRect(CAT_X - half, y, half * 2, 1)
    }

    /* Cheek ruff. A cat's face is wider than its skull because of the
       fur either side of it, and squaring that off is what stops the
       head reading as a ball on a neck. Two stepped pixels a side. */
    if (!turned) {
      ctx.fillRect(CAT_X - 11, CAT_BASE - 42, 2, 4)
      ctx.fillRect(CAT_X + 9, CAT_BASE - 42, 2, 4)
      ctx.fillRect(CAT_X - 10, CAT_BASE - 38, 2, 2)
      ctx.fillRect(CAT_X + 8, CAT_BASE - 38, 2, 2)
    }

    // the head is turned a little to the left, so a muzzle breaks the
    // profile and one eye can catch the city
    if (!turned) ctx.fillRect(CAT_X - 11, CAT_BASE - 44, 4, 5)

    /* ---- detail without breaking the cut-out ----

       The first attempt at this put a pale chest, a haunch crescent
       and four tabby bars INSIDE the body, and it destroyed the cat:
       the whole animal works because it is one unbroken dark shape
       against a lit city, and every mid-value patch laid into it read
       as a hole rather than as fur.

       So the detail goes on the EDGE instead, where a silhouette can
       actually carry it. A notch between the forelegs, toes bitten out
       of the paws, a rim down the near leg and round the haunch. Same
       amount of information, none of it costing the cut-out — which is
       the only reason the cat reads at all from across the roof. */

    // forelegs: one dark seam between them, and toes cut into the paws
    ctx.fillStyle = T.catShade || c
    ctx.fillRect(CAT_X - 1, CAT_BASE - 14, 1, 12)
    ctx.fillRect(CAT_X - 4, CAT_BASE - 2, 1, 2)
    ctx.fillRect(CAT_X + 3, CAT_BASE - 2, 1, 2)

    // the haunch crease, a short arc rather than a filled crescent
    for (let i = 0; i < 9; i++) {
      const r = Math.round(Math.sin((i / 9) * 3.14) * 4)
      ctx.fillRect(CAT_X + 6 + r, CAT_BASE - 13 + i, 1, 1)
    }

    /* Tabby bars over the back. One pixel, and only on the shadowed
       flank where they sit against body colour rather than against the
       skyline — a bar that reaches the silhouette edge would notch it. */
    for (let b = 0; b < 4; b++) {
      const y = CAT_BASE - 27 + b * 5
      ctx.fillRect(CAT_X + 3, y, Math.round(7 - b * 1.1), 1)
    }

    /* Ears. The far one twitches every few seconds — one pixel, for two
       frames. It is the smallest possible thing that can happen and it
       is most of why the cat reads as alive rather than as a decal. */
    const twitch = frame % 83 < 2 ? 1 : 0
    if (!cross && !turned) {
      /* Taller than they were and tapering a pixel every other row, so
         they read as ears rather than as two square tabs. */
      for (let i = 0; i < 9; i++) {
        const y = CAT_BASE - 48 - i
        const w = Math.max(1, 5 - Math.floor(i / 2))
        ctx.fillRect(CAT_X - 9, y, w, 1)
        ctx.fillRect(CAT_X + 9 - w, y - twitch, w, 1)
      }
      // and a slice of pink inside each. An ear with no inner ear is a horn.
      ctx.fillStyle = T.catNose || rim
      for (let i = 0; i < 4; i++) {
        const w = Math.max(1, 3 - Math.floor(i / 2))
        ctx.fillRect(CAT_X - 8, CAT_BASE - 47 - i, w, 1)
        ctx.fillRect(CAT_X + 8 - w, CAT_BASE - 47 - i - twitch, w, 1)
      }
      ctx.fillStyle = c
    }

    /* Moonlit rim down the left side. It has to follow exactly the
       same curves the body was built from or it drifts off the
       silhouette and reads as a scratch. */
    ctx.fillStyle = rim
    for (let i = 0; i < 30; i++) {
      const y = CAT_BASE - 1 - i
      const u = i / 30
      const half = Math.round(14 - u * 8 + Math.sin(u * 3.0) * 1.8)
      ctx.fillRect(CAT_X - half, y, 1, 1)
      // the rim doubles where the form turns hardest, at the shoulder
      if (i > 20 && i < 27) ctx.fillRect(CAT_X - half + 1, y, 1, 1)
    }
    for (let i = 0; i < 16; i++) {
      const y = CAT_BASE - 31 - i
      const u = i / 16
      const half = Math.round(6.5 + Math.sin(u * 3.14) * 2.2 + u * 1.8)
      ctx.fillRect(CAT_X - half, y, 1, 1)
    }
    if (!cross) {
      // rim up the outer edge of the near ear, following its new taper
      for (let i = 0; i < 9; i++) ctx.fillRect(CAT_X - 9, CAT_BASE - 48 - i, 1, 1)
    }

    /* Rim down the near foreleg and along the top of the front paw.
       This is the leg's only definition and it has to be on the lit
       side, because that is the side the moon and the city are on. */
    ctx.fillRect(CAT_X - 6, CAT_BASE - 14, 1, 12)
    ctx.fillRect(CAT_X - 7, CAT_BASE - 3, 6, 1)
    // and the curve of the chest, three pixels of it
    ctx.fillRect(CAT_X - 9, CAT_BASE - 28, 1, 3)
    ctx.fillRect(CAT_X - 10, CAT_BASE - 25, 1, 4)
    if (!turned) {
      ctx.fillRect(CAT_X - 11, CAT_BASE - 44, 1, 5) // muzzle edge
      // whiskers — three a side now, and they fan rather than sit
      // parallel, which is the difference between whiskers and a barcode
      ctx.fillRect(CAT_X - 15, CAT_BASE - 44, 4, 1)
      ctx.fillRect(CAT_X - 16, CAT_BASE - 42, 5, 1)
      ctx.fillRect(CAT_X - 15, CAT_BASE - 40, 4, 1)

      // nose and the line of the mouth under it
      ctx.fillStyle = T.catNose || rim
      ctx.fillRect(CAT_X - 10, CAT_BASE - 42, 2, 2)
      ctx.fillStyle = T.catShade || c
      ctx.fillRect(CAT_X - 9, CAT_BASE - 40, 1, 2)
      ctx.fillRect(CAT_X - 11, CAT_BASE - 39, 2, 1)
      ctx.fillRect(CAT_X - 8, CAT_BASE - 39, 2, 1)
    } else {
      // the back of the skull: one soft crease down the centre, and
      // both ears now read from behind rather than in profile
      ctx.fillStyle = T.catShade || c
      ctx.fillRect(CAT_X - 1, CAT_BASE - 46, 2, 10)
      ctx.fillStyle = c
      for (let i = 0; i < 8; i++) {
        const y = CAT_BASE - 47 - i
        const w2 = 4 - Math.floor(i / 2)
        ctx.fillRect(CAT_X - 9, y, w2, 1)
        ctx.fillRect(CAT_X + 9 - w2, y, w2, 1)
      }
    }

    // three rings down the tail, spaced wider as it thins
    ctx.fillStyle = T.catShade || c
    for (let r = 0; r < 3; r++) {
      const i = 6 + r * 5
      const tx = CAT_X + 11 + i
      const ty = CAT_BASE - 1 - Math.round(Math.sin((i / 22) * 2.1) * 13)
      ctx.fillRect(tx, ty, 2, 2)
    }

    // a collar with a lit tag, and one eye, blinking
    ctx.fillStyle = T.catCollar
    ctx.fillRect(CAT_X - 7, CAT_BASE - 32, 14, 1)
    ctx.fillRect(CAT_X - 1, CAT_BASE - 31, 2, 2)

    /* Poke it and it turns round to look at you. Two eyes instead of
       one is the whole animation — the head does not need to move for
       the gaze to.

       Being LOOKED at and being GLARED at are different things, so the
       poke and the Konami code diverge here: the secret keeps the cat
       adoring and floats a heart, while a poke narrows its eyes, flattens
       its ears and gives it something to say. */
    if (cross) {
      /* Ears back. Two flat wedges laid along the top of the skull
         instead of the two upright triangles drawn above — the single
         clearest thing a cat does when it has had enough, and it costs
         eight pixels. */
      ctx.fillStyle = c
      ctx.fillRect(CAT_X - 12, CAT_BASE - 49, 6, 3)
      ctx.fillRect(CAT_X + 6, CAT_BASE - 49, 6, 3)
      ctx.fillStyle = rim
      ctx.fillRect(CAT_X - 12, CAT_BASE - 49, 1, 3)
    }

    if (!turned && (noticed || frame % 47 > 1)) {
      ctx.fillStyle = T.catEye
      if (cross) {
        // narrowed to slits, and angled inward. One row, not two.
        ctx.fillRect(CAT_X - 8, CAT_BASE - 43, 3, 1)
        ctx.fillRect(CAT_X - 3, CAT_BASE - 43, 3, 1)
        ctx.fillStyle = c
        ctx.fillRect(CAT_X - 8, CAT_BASE - 44, 2, 1)
        ctx.fillRect(CAT_X - 1, CAT_BASE - 44, 2, 1)
      } else {
        ctx.fillRect(CAT_X - 8, CAT_BASE - 44, 2, 2)
        if (noticed) ctx.fillRect(CAT_X - 3, CAT_BASE - 44, 2, 2)
      }
    }

    /* ---- what it DOES ----
       The action runs over the first third of the reaction, before the
       bubble has finished being read, so the cat moves and then holds
       its glare while you read what it said. */
    if (cross && poked < 26) {
      if (catAct === 'swipe') {
        /* A paw comes off the floor, out, and back. Three positions,
           no interpolation — the whole gesture is over in half a
           second and that is exactly how a cat does it. */
        const k = poked < 8 ? 0 : poked < 17 ? 1 : 2
        const ox = [0, -7, -3][k]
        const oy = [0, -9, -5][k]
        ctx.fillStyle = c
        ctx.fillRect(CAT_X - 7 + ox, CAT_BASE - 15 + oy, 4, 12 - oy)
        ctx.fillRect(CAT_X - 8 + ox, CAT_BASE - 16 + oy, 6, 3)
        if (k === 1) {
          // three claws out at full extension
          ctx.fillStyle = rim
          for (let i = 0; i < 3; i++) ctx.fillRect(CAT_X - 11 + ox + i * 2, CAT_BASE - 19 + oy, 1, 2)
        }
      } else if (catAct === 'hunch') {
        // shoulders up: one row of body pushed above the shoulder line
        ctx.fillStyle = c
        ctx.fillRect(CAT_X - 10, CAT_BASE - 34, 20, 3)
        ctx.fillStyle = rim
        ctx.fillRect(CAT_X - 10, CAT_BASE - 34, 1, 3)
      }
    }

    if (cross) {
      const soft = catLine === CAT_RELENTS
      bubble(CAT_X, CAT_BASE - 58, catLine, soft ? T.catCollar : T.neon[0])
    } else if (noticed) {
      // 7x6 heart, floating up a pixel at a time
      const HEART = [0b0110110, 0b1111111, 0b1111111, 0b0111110, 0b0011100, 0b0001000]
      const rise = secret ? Math.round(Math.sin(frame * 0.3)) : Math.floor(poked / 5)
      ctx.fillStyle = T.catCollar
      for (let r = 0; r < 6; r++) {
        for (let ci = 0; ci < 7; ci++) {
          if (HEART[r] & (64 >> ci)) ctx.fillRect(CAT_X - 3 + ci, CAT_BASE - 64 - rise + r, 1, 1)
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

  /* ==================================================================
     FIREWORKS

     Click the sky. One goes up.

     This replaced, in order, a step sequencer, a drawing pad, a
     falling-block puzzle and a rooftop runner — and the reason it beat
     all four is that it has no rules, no failure state, nothing to
     learn and nothing to read. You click, and something lovely
     happens, and you understand the whole thing before the first one
     has finished bursting. Every one of the others needed a sentence
     of explanation first, and a portfolio is not a place anybody has
     agreed to be taught something.

     It is also the only one that happens IN the city rather than in a
     box on the page. That is the thing worth showing off here: the
     backdrop is a program, so it can answer you.

     Each shell is a rise, a burst and a fall. Thirty sparks on a
     circle, each with its own drag, all of them fading through the
     same three-stop ramp — hot core, sign colour, ember — which is
     what makes a burst read as burning rather than as a scatter of
     dots that happen to be moving apart.
     ================================================================== */
  const shells = []
  const SHELL_RISE = 26
  const SHELL_LIVE = 62

  function firework(sx, sy, col, power) {
    if (shells.length > 6) return
    shells.push({
      x: Math.max(20, Math.min(W - 20, sx)),
      y: Math.max(30, Math.min(SKYLINE - 30, sy)),
      t: 0,
      col: col || T.neon[Math.floor(Math.random() * T.neon.length)],
      pow: power || 1,
      spin: Math.random() * Math.PI,
    })
  }

  function drawShells() {
    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i]
      s.t++
      if (s.t > SHELL_LIVE) {
        shells.splice(i, 1)
        continue
      }

      if (s.t < SHELL_RISE) {
        // the shell going up, with a short tail behind it
        const k = s.t / SHELL_RISE
        const y = SKYLINE - (SKYLINE - s.y) * k
        ctx.fillStyle = T.lamp
        ctx.fillRect(s.x, Math.round(y), 1, 3)
        for (let n = 1; n < 6; n++) {
          dot(ctx, s.x, Math.round(y + n * 2), (1 - n / 6) * 0.6, T.lamp)
        }
        if (s.t === SHELL_RISE - 1) glow(ctx, s.x - 2, s.y - 2, 4, 4, 14, s.col, 1.4)
        continue
      }

      /* The burst. Age runs 0..1 across the remaining frames; the
         sparks fly out on a curve that flattens, which is drag, and
         then fall, which is gravity — two lines of arithmetic that are
         the whole difference between fireworks and a starburst. */
      const age = (s.t - SHELL_RISE) / (SHELL_LIVE - SHELL_RISE)
      const reach = (1 - Math.pow(1 - age, 2.4)) * 46 * s.pow
      const fade = 1 - age

      glow(ctx, s.x - 6, s.y - 6, 12, 12, Math.round(30 * fade * s.pow), s.col, fade * 1.8)

      for (let n = 0; n < 30; n++) {
        const a = s.spin + (n / 30) * Math.PI * 2
        const spread = 0.72 + ((n * 7) % 5) / 9
        const px2 = Math.round(s.x + Math.cos(a) * reach * spread)
        const py2 = Math.round(s.y + Math.sin(a) * reach * spread + age * age * 26)
        if (px2 < 0 || px2 >= W || py2 < 0 || py2 >= SKYLINE + 10) continue
        ctx.fillStyle = age < 0.22 ? '#ffffff' : age < 0.62 ? s.col : T.lamp
        ctx.fillRect(px2, py2, 2, 2)
      }
    }
  }

  /* Click anywhere that is not the page's own column. The hit test
     undoes the same object-fit mapping the weather uses. */
  window.addEventListener('pointerdown', (e) => {
    /* `target` is only guaranteed to be an Element for a real click —
       an event dispatched at window has window as its target, and
       window has no closest(). Guarding it rather than assuming. */
    const t = e.target
    if (t && t.closest && t.closest('.col, .controls, .page__head')) return
    const { scale, ox, oy } = viewMap()
    firework((e.clientX - ox) / scale, (e.clientY - oy) / scale)
  })

  /* ---- Campfire on the roof ----
     It used to be an oil drum: twenty-six pixels across, eighteen
     tall, and a flame you could cover with a thumb. That was fine
     while it was scenery, and wrong the moment it became something
     that can go out — an event you cannot see is not an event.

     So it is a campfire. Four logs stacked over a bed of embers with
     a ring of stones round the front, and a flame half again as tall
     over twice the footprint, which is enough that losing it is
     obvious from across the frame.

     Drawn back to front — back log, leaners, embers, flame, front log,
     stones — so the flame comes out from *between* the logs instead of
     standing in front of them. That order is the only reason a stack
     of flat bars reads as a fire with depth in it.

     The flame is still generated per frame rather than being a fixed
     sprite: each row tapers toward the tip, is displaced by two
     out-of-phase sines, and is filled in four bands from a dark red
     rim to a near-white core. */
  /* Moved in from 268. The brazier is sheltered by whatever window is
     up — that is the whole reason it goes out when you drag one off it
     — and the title screen is a good deal narrower than it used to be,
     which left the fire standing out in the rain on first load. A
     landing shot with a dead fire in it is not the landing shot.

     460 sits inside the window's footprint at every viewport width the
     clamp produces, and in the clear stretch of deck between the
     crates and the pipe. */
  const FIRE_X = 812
  const FIRE_BASE = ROOF_TOP + 78
  const FIRE_H = 44

  const LOG_MID = '#4b3524'
  const LOG_LIT = '#6f4d34'
  const LOG_DARK = '#281a11'
  const LOG_END = '#8d6a49'
  const LOG_CHAR = '#1b1210'

  /* One log. Walked along its long axis a pixel at a time with a run
     laid across it, the leading edge catching light and the trailing
     one falling into shadow — the two-tone rule every other surface on
     this roof follows.

     `char` is how much of it has burnt black. Burn is taken from the
     middle outward and the ends stay sound, because that is both what
     a log in a fire looks like and what keeps the stack readable once
     the flame is over the top of it: four black bars would vanish. */
  function fireLog(x0, y0, x1, y1, th, char, glow) {
    const dx = x1 - x0
    const dy = y1 - y0
    const steps = Math.max(Math.abs(dx), Math.abs(dy), 1)
    const flat = Math.abs(dx) >= Math.abs(dy)
    for (let s = 0; s <= steps; s++) {
      const t = s / steps
      const x = Math.round(x0 + dx * t)
      const y = Math.round(y0 + dy * t)
      const burnt = char * (1 - Math.abs(t - 0.5) * 2.2) > 0.35
      ctx.fillStyle = burnt ? LOG_CHAR : LOG_MID
      if (flat) ctx.fillRect(x, y, 1, th)
      else ctx.fillRect(x, y, th, 1)
      ctx.fillStyle = burnt ? LOG_DARK : LOG_LIT
      ctx.fillRect(x, y, 1, 1)
      ctx.fillStyle = LOG_DARK
      if (flat) ctx.fillRect(x, y + th - 1, 1, 1)
      else ctx.fillRect(x + th - 1, y, 1, 1)
      // a split still glowing somewhere in the charred stretch
      if (burnt && glow > 0.04 && (s * 7 + frame * 3) % 17 < glow * 6) {
        px(flat ? x : x + 1, flat ? y + 1 : y, frame % 3 ? '#8c2a0a' : '#d1560f')
      }
    }
    // end grain, or a stack of logs is a pile of sticks
    ctx.fillStyle = LOG_END
    if (flat) ctx.fillRect(x1, y1 + 1, 1, Math.max(1, th - 2))
    else ctx.fillRect(x1 + 1, y1, Math.max(1, th - 2), 1)
  }

  /* ---- whether it is under cover ----
     The panel sits directly over the brazier, which is why the fire
     has survived every rainstorm this scene has ever run: the rain
     already treats the panel as a surface and lands on its lip rather
     than on the roof underneath. The fire was the one object on the
     roof still drawn as though none of that mattered.

     So it depends on the window now. Take the panel out of the column
     above the brazier — drag it aside, minimise it, close it — while
     it is raining or snowing, and the flame drops, guts, and is out in
     about two and a half seconds, leaving embers and a thread of
     smoke. Put cover back and it catches again, but slower than it
     went out, because nothing relights as fast as it dies.

     The shelter test is the rain's own test with one clause dropped:
     the rain requires the panel's lip to be on screen before a drop
     will land on it, and a maximised window has its lip at or above
     zero. Invisible either way — a maximised window covers the whole
     roof — but a fire that quietly dies behind it and needs relighting
     when you come back is a worse answer than one that was under cover
     the whole time, which it was. */
  const FIRE_DIE = 2.4 // seconds, lit to out
  const FIRE_CATCH = 4.2 // seconds, out to lit
  let fireLife = 1

  const fireSheltered = (p) =>
    !!p && FIRE_X >= p.x0 && FIRE_X <= p.x1 && p.y0 < FIRE_BASE - FIRE_H

  /* ---- putting it out, and getting it lit again ----

     Moving the window off the brazier used to relight it. The rain
     stopped falling on the wood, so the wood simply caught: no spark,
     no cause, a fire that reassembled itself because the geometry said
     it could. It was the one event on the roof that happened for no
     reason.

     Going out is still physics and still gradual — rain reaches it,
     it gutters, it dies. Coming back is now an EVENT. Wet wood sits
     there dead until something ignites it, and the only thing on this
     roof capable of that is the weather: a strike comes down on the
     brazier, the frame goes white, and the wood catches from it.

     `fireArmed` is the wood being ready to take a spark — exposed but
     unlit. `igniteAt` is the frame the bolt lands on. */
  let fireArmed = false
  let igniteAt = -1
  let igniteFrom = 0

  function stepFire(dt, p) {
    const sheltered = fireSheltered(p)
    const wetted = weather !== 'none' && T.fire && !sheltered

    if (wetted) {
      // rain is getting to it: it dies, and stays dead
      fireLife = Math.max(0, fireLife - dt / 1000 / FIRE_DIE)
      if (fireLife <= 0) {
        fireArmed = true
        if (igniteAt < 0) {
          // a strike is coming, but not immediately — the wait is what
          // makes it read as weather rather than as a switch
          igniteAt = frame + 90 + Math.floor(Math.random() * 170)
        }
      }
      return
    }

    /* Sheltered, or clear weather. If it was already burning it
       recovers; if the rain killed it, it needs the strike first. */
    if (!fireArmed) {
      fireLife = Math.min(1, fireLife + dt / 1000 / FIRE_CATCH)
      return
    }
    /* Out of the rain with dead wood. The wood is dry now but it is
       still dead, and dry wood does not light itself — so it waits for
       the strike. The wait is a second or two, long enough that the
       relight is clearly an event with a cause rather than a
       consequence of having moved the window. */
    if (igniteAt < 0) igniteAt = frame + 60 + Math.floor(Math.random() * 120)
    if (frame >= igniteAt) {
      fireArmed = false
      igniteFrom = frame
      igniteAt = -1
    }
  }

  /* The strike itself. A single channel down onto the brazier, stepped
     three pixels at a time with one kink in it, and a hard white flash
     across the whole roof on the frame it lands. Six frames, total —
     lightning is over before you have finished seeing it. */
  function drawIgnition() {
    const age = frame - igniteFrom
    if (igniteFrom <= 0 || age > 6) return

    if (age < 2) {
      ctx.fillStyle = rgba(T.lightning, age === 0 ? 0.5 : 0.2)
      ctx.fillRect(0, ROOF_TOP - 20, W, H - ROOF_TOP + 20)
    }
    if (age > 3) return

    let bx = FIRE_X + 6
    ctx.fillStyle = age === 0 ? T.boltCore : T.lightning
    for (let y = 0; y < FIRE_BASE - FIRE_H - 2; y += 3) {
      const swing = ((y >> 3) % 2 ? 1 : -1) * (1 + ((y >> 4) % 2))
      bx += swing
      ctx.fillRect(bx, y, age === 0 ? 2 : 1, 3)
    }
    // where it lands, a burst of embers
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2
      ctx.fillStyle = k % 2 ? '#ffd21f' : '#ff7a1a'
      ctx.fillRect(
        Math.round(FIRE_X + Math.cos(a) * (4 + age * 4)),
        Math.round(FIRE_BASE - 6 + Math.sin(a) * (3 + age * 2)),
        2,
        2
      )
    }
  }

  /* ---- how big the fire is ----

     It is the only object left on the terrace, so it has to carry the
     whole foreground on its own — and at its old size it was a
     forty-four pixel brazier alone on a hundred-and-thirty pixel deck,
     which read as abandoned rather than as quiet.

     Five thirds, and the fraction is the point. At S = 3 every
     authored pixel is backed by three device pixels, so a scale of
     5/3 makes each one exactly five — a whole number. Any scale that
     is not a multiple of 1/S puts the flame's edges on fractions of a
     device pixel and the one object in the frame that is supposed to
     be the sharpest thing in it comes out soft.

     Anchored at the foot, so it grows upward out of the deck rather
     than away from it. */
  const FIRE_SCALE = 5 / 3

  function drawFire() {
    ctx.save()
    ctx.translate(FIRE_X, FIRE_BASE)
    ctx.scale(FIRE_SCALE, FIRE_SCALE)
    ctx.translate(-FIRE_X, -FIRE_BASE)
    drawFireAt()
    ctx.restore()
  }

  function drawFireAt() {
    /* The fire reads the weather harder than anything else on the roof,
       because a fire is the one object whose whole purpose changes with
       it. In snow it is banked right up and throwing twice the light —
       somebody needs it. In rain it is guttering and barely holding on.
       Same twenty-eight rows of flame; three numbers different.

       And all of it now runs through L, which is how much fire there
       still is. At 1 this is exactly the fire it always was. */
    const snowy = weather === 'snow'
    const wet = weather === 'rain'
    const L = fireLife
    const reach = (snowy ? 112 : wet ? 62 : 86) * L
    const height = (snowy ? 1.25 : wet ? 0.7 : 1) * L
    const flick = ((wet ? 0.5 : snowy ? 0.86 : 0.72) + (frame % 5 === 0 ? 0.1 : 0)) * L
    if (reach > 1) {
      for (let y = FIRE_BASE - FIRE_H - 24; y <= FIRE_BASE + 24; y++) {
        if (y < 0 || y >= H) continue
        for (let x = FIRE_X - reach; x <= FIRE_X + reach; x++) {
          if (x < 0 || x >= W) continue
          const d = Math.hypot((x - FIRE_X) / 1.25, y - (FIRE_BASE - FIRE_H * 0.35))
          if (d > reach) continue
          dot(ctx, x, y, (1 - d / reach) * (1 - d / reach) * flick, '#4a2a14')
        }
      }
    }

    /* The stack. One log laid across the back goes down here, behind
       the flame; the two leaners and the front log go on afterwards,
       in front of it.

       The leaners were originally behind as well and were completely
       invisible — a dark log inside a bright flame is nothing. In
       front they are silhouettes crossing the light, which is both the
       strongest read a campfire has and the thing that makes it
       obvious there is fuel here rather than a jet.

       Char does not track the fire. A stack that has burnt is black in
       the middle whether or not it is burning right now, and having it
       lighten as the fire died looked like the logs were healing. Burn
       is taken from the middle outward so the ends stay wood-coloured,
       which is the only reason four dark bars are still legible. What
       does track the fire is `glow` — the splits still lit inside the
       charred stretch, and they go out with everything else. */
    const char = 0.55
    fireLog(FIRE_X - 23, FIRE_BASE + 5, FIRE_X + 21, FIRE_BASE + 2, 6, char, L)

    /* The ember bed, and the reason going out reads as going out
       rather than as the fire being deleted. Coals stay hot long after
       there is nothing burning above them — they are the last warm
       thing on this roof, and they cool rather than switch off. */
    for (let i = 0; i < 30; i++) {
      const ex = FIRE_X - 16 + ((i * 7) % 33)
      const ey = FIRE_BASE + 2 + ((i * 5) % 8)
      const beat = (frame * 0.6 + i * 3.7) % 12
      const heat = (L * 0.62 + 0.38) * (beat < 6 ? 1 : 0.56)
      px(ex, ey, heat > 0.74 ? '#ffb03a' : heat > 0.52 ? '#d1560f' : heat > 0.3 ? '#8c2a0a' : '#481605')
    }

    for (let i = 0; i < FIRE_H; i++) {
      const y = FIRE_BASE + 1 - i
      const p = i / FIRE_H
      const wob = Math.sin(frame * 0.85 + i * 0.5) * 2.4 + Math.sin(frame * 0.47 + i * 0.9) * 1.7
      const breathe = Math.sin(frame * 0.6) * 1.6
      /* A teepee, not a cone. The first term narrows hard on the way
         up; the second pinches the bottom two or three rows back in,
         because a flame is thinnest where it meets the fuel and the
         straight linear taper this used to run made the base wider
         than the log stack it was supposed to be sitting in. */
      const taper = Math.pow(1 - p, 1.35) * (0.5 + 0.5 * Math.min(1, p * 7))
      const w = Math.round((taper * 12 + breathe * taper) * height)
      if (w <= 0) continue
      const cx = Math.round(FIRE_X + wob * p * 1.5)
      ctx.fillStyle = '#b8330d'
      ctx.fillRect(cx - w, y, w * 2 + 1, 1)
      /* The bands are a FRACTION of the width, not a fixed inset. At
         eight pixels across, insetting one and two pixels put the
         yellow and the white at three quarters of the flame; at twelve
         it made the whole thing a white column with a red edge. */
      const w2 = Math.round(w * 0.76)
      if (w2 > 0) {
        ctx.fillStyle = '#ef7714'
        ctx.fillRect(cx - w2, y, w2 * 2 + 1, 1)
      }
      /* The hot bands go first as it dies. A dying fire does not
         shrink evenly — it loses its white heart, then its yellow, and
         what is left is the dull red that was always at the rim.
         Gating both on L is what makes the last second read as cooling
         rather than as the same flame scaled down. */
      const w3 = Math.round(w * 0.46)
      if (w3 > 0 && p < 0.44 * L) {
        ctx.fillStyle = '#ffd23a'
        ctx.fillRect(cx - w3, y, w3 * 2 + 1, 1)
      }
      const w4 = Math.round(w * 0.22)
      if (w4 > 0 && p < 0.19 * L) {
        ctx.fillStyle = '#fff4b0'
        ctx.fillRect(cx - w4, y, w4 * 2 + 1, 1)
      }
    }

    // the leaners, silhouetted against the flame they are feeding
    fireLog(FIRE_X - 21, FIRE_BASE + 8, FIRE_X + 3, FIRE_BASE - 17, 5, char, L)
    fireLog(FIRE_X + 21, FIRE_BASE + 8, FIRE_X - 3, FIRE_BASE - 17, 5, char, L)

    // the front log, and the ring, which is what puts the fire inside
    // the stones rather than on top of them
    fireLog(FIRE_X - 25, FIRE_BASE + 13, FIRE_X + 23, FIRE_BASE + 9, 7, char * 0.7, L * 0.7)

    /* Front arc only. The back of the ring is behind the logs and
       would be six pixels of grey nobody can see.

       Each is drawn as a body with a narrower row on top rather than
       as one rect: a stone at this scale needs its top corners taken
       off or the ring reads as a course of bricks, which is what it
       did. The sizes are all slightly different for the same reason. */
    const STONES = [[-31, 13, 9, 6], [-22, 15, 7, 5], [-12, 16, 9, 5],
                    [0, 16, 8, 5], [10, 15, 8, 5], [19, 13, 10, 6]]
    for (const [sx, sy, sw, sh] of STONES) {
      const x = FIRE_X + sx
      const y = FIRE_BASE + sy
      ctx.fillStyle = '#332c4e'
      ctx.fillRect(x, y + 1, sw, sh - 1)
      ctx.fillRect(x + 1, y, sw - 2, 1)
      ctx.fillStyle = '#4c4470'
      ctx.fillRect(x + 1, y, sw - 2, 1)
      ctx.fillStyle = '#1d1830'
      ctx.fillRect(x, y + sh - 1, sw, 1)
      // the inner face takes the fire, which is what lights the ring
      if (L > 0.04) {
        ctx.fillStyle = L > 0.5 ? '#8a4a22' : '#54301a'
        ctx.fillRect(x + 2, y, sw - 4, 1)
      }
    }

    const sparks = Math.round(20 * L)
    for (let i = 0; i < sparks; i++) {
      const t = (frame * 0.6 + i * 4.3) % 58
      if (t < 4 || t > 54) continue
      const ey = Math.round(FIRE_BASE - 32 - t * 1.35)
      const ex = Math.round(FIRE_X + Math.sin(frame * 0.28 + i * 2.1) * (4 + t * 0.2) + (i - 10) * 2)
      px(ex, ey, t < 16 ? '#ffd23a' : t < 34 ? '#ef7714' : '#7a3210')
    }

    /* ---- smoke ----
       It comes in as the flame goes down and is thickest just after it
       is out, which is when a real one smokes hardest: the fuel is
       still hot and there is no longer a flame burning the smoke off.
       Drawn on the same dithered column the vent steam uses, but grey
       rather than the steam's violet, so the two never read as the
       same thing.

       It has to be a good deal lighter than smoke actually is. The
       roof it rises off is `#090318` — near black — and a physically
       honest dark grey plume against that is invisible, which is the
       usual trade in a dark scene: value separation beats accuracy. */
    const smoke = 1 - L
    if (smoke > 0.03) {
      for (let i = 0; i < 34; i++) {
        const age = (frame * 1.15 + i * 1.7) % 56
        const y = Math.round(FIRE_BASE - 4 - age * 1.2)
        if (y < ROOF_TOP - 56 || y >= H) continue
        const spread = 2.5 + age * 0.24
        const drift = Math.sin(age * 0.13 + i * 1.7) * spread
        const x = Math.round(FIRE_X - 2 + drift)
        const fade = (1 - age / 56) * smoke
        /* Blocks that widen as they rise, for the same reason the vent
           steam is blocks: a column of lone pixels at this scale does
           not read as smoke, it reads as dirt on the lens. */
        const w = 3 + Math.round(age / 9)
        for (let k = 0; k < w; k++) {
          dot(ctx, x + k, y, fade * 0.9, age < 15 ? '#8d84a6' : '#665d7e')
          dot(ctx, x + k, y - 1, fade * 0.5, '#554d6b')
        }
      }
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

    /* A searchlight down onto the roof, and a beacon that pulses. The
       beacon used to be a single pixel appearing and vanishing, which
       at this distance is indistinguishable from a dead pixel — it now
       carries a glow, so it reads as a lamp. */
    beam(ctx, x, y + 10, 13, 54, T.lamp, T.fire ? 1 : 0.4)
    if (frame % 8 < 3) {
      px(x, y + 11, T.neon[0])
      glow(ctx, x - 1, y + 10, 3, 3, 7, T.neon[0], 1.4)
    }
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

  /* ---- the cross-fade ----

     A rebuild swaps the world in a single frame, which lands as a cut
     however gently the particles are ramped. So the old frame is
     snapshotted first and taken away over the next second.

     This WAS a Bayer dissolve — the old frame eroded through the same
     ordered kernel as everything else, on the reasoning that a hard
     mask is what eight-bit hardware would have done and opacity was
     not allowed anywhere.

     It is a real fade now, and the reason is the same one that applied
     to the neon and to the beams. An ordered dither is a fixed lattice
     at every level between the ends: erode a whole frame through it
     and what you see is not a picture becoming another picture, it is
     a grid crawling across the screen. At sixty frames a second that
     grid is the most obviously moving thing in the transition, which
     is precisely backwards — a transition's job is to be the one thing
     you do not notice.

     One drawImage at a falling alpha. Cheaper than the mask it
     replaces, which needed a second full-size buffer, a clear, a copy
     and a composited pattern fill every frame — that buffer is gone. */
  const DISSOLVE_MS = 620
  let dissolveT0 = 0
  let snapA = null
  let ready = false

  function beginDissolve() {
    if (!ready || !animating) return
    if (!snapA) snapA = makeBuffer(W, H)
    snapA.x.clearRect(0, 0, W, H)
    snapA.x.drawImage(sceneCv, 0, 0, W, H)
    dissolveT0 = performance.now()
  }

  function drawDissolve() {
    if (!dissolveT0) return
    const el = performance.now() - dissolveT0
    if (el >= DISSOLVE_MS) {
      dissolveT0 = 0
      return
    }
    /* Eased out rather than linear. A straight ramp holds the old
       frame at half strength right through the middle of the fade,
       which is where a cross-fade is most visible; pushing the curve
       forward gets the bulk of the change done early and lets the last
       third arrive as almost nothing. */
    const t = el / DISSOLVE_MS
    const a = (1 - t) * (1 - t)
    if (a <= 0.002) return
    screenCtx.save()
    screenCtx.globalAlpha = a
    screenCtx.drawImage(snapA.c, 0, 0, W, H)
    screenCtx.restore()
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

  /* BOW is OFF, and this is the single biggest thing that was costing
     the scene its crispness.

     The bow cannot be done on a pixel grid. Every band was drawn from
     960 source pixels into 960 x (1 + bulge) destination pixels — a
     fractional ratio — with smoothing disabled, so nearest-neighbour
     duplicated whichever columns happened to fall on the seams. A
     different set of columns per band, at a fractional vertical offset,
     re-resampled every frame, and then the browser upscaled the result
     to the viewport at a second fractional ratio. Two stacked
     non-integer resamples is precisely how a hard-edged picture turns
     into a soft one, and no amount of `image-rendering: pixelated`
     downstream can undo it: the damage is already baked into the
     buffer by the time CSS sees it.

     So the frame is presented 1:1 now — one blit, whole pixels, the
     grid intact all the way to the CSS upscale. The curved-glass
     reading is carried by the `.crt` overlay instead, which does it
     with a vignette and a glare and costs the picture nothing.

     Set BOW back above zero to restore the warp; the banded path is
     kept intact below it. It will soften the picture again. */
  const BOW = 0

  function present(src) {
    if (!BOW) {
      screenCtx.drawImage(src, 0, 0, W, H)
      return
    }
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
    /* Accumulation starts from nothing and is built by the fall — that
       is the whole point of settling. Reduced motion has no fall and no
       ramp to settle over, though, so there the world has to arrive
       already finished or it would arrive permanently bare. */
    snowDepth = animating ? 0 : weather === 'snow' ? 1 : 0
    snowLevel = snowDepth
    splashes.length = 0
    runners.length = 0
    snowPile.fill(0)
    panelPile.fill(0)
    // stageRebuild takes the snapshot itself
    stageRebuild()
    if (weather === 'snow') seedPiles()
  }

  /* Accumulation is stepped against this, not against the fall. Each
     step is a full rebuild of every static layer, so the number is a
     straight trade: finer steps mean a smoother whitening and more
     rebuilds. An eighth is under the threshold where a step reads as a
     jump, and eight rebuilds spread over SETTLE_MS is nothing. */
  const SNOW_STEP = 1 / 8

  function stepTransition(dt) {
    if (target !== weather) {
      // thin out what is already falling before swapping the world
      if (wx > 0) {
        wx = Math.max(0, wx - dt / RAMP_DOWN_MS)
        // melting: the blanket recedes with the fall
        if (weather === 'snow') {
          snowDepth = Math.min(snowDepth, wx)
          if (snowLevel - snowDepth >= SNOW_STEP || (!snowDepth && snowLevel)) {
            snowLevel = snowDepth
            stageRebuild()
          }
        }
        return
      }
      swapWorld()
      return
    }
    const want = weather === 'none' ? 0 : 1
    if (wx < want) wx = Math.min(want, wx + dt / RAMP_UP_MS)
    else if (wx > want) wx = Math.max(want, wx - dt / RAMP_DOWN_MS)

    if (weather !== 'snow') return

    /* ---- settling ----

       The fall and the accumulation are two different clocks, and
       running them off one is what made the snow arrive all at once.
       `wx` is how hard it is coming down: that fills the air in five
       and a half seconds, which is right, because a snowfall does
       start quickly. `snowDepth` is how much is LYING there, and it
       chases the fall at its own much slower rate — so the air fills,
       and then, over the better part of a minute, the ledges and the
       crowns and the roof go white underneath it while you watch.

       That order is the whole effect. Snow reads from surfaces, and a
       surface that is already white when the first flake lands has
       told you it was never snowing at all. */
    snowDepth = Math.min(wx, snowDepth + dt / SETTLE_MS)
    if (snowDepth - snowLevel >= SNOW_STEP || (snowDepth >= 1 && snowLevel < 1)) {
      snowLevel = snowDepth
      stageRebuild()
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

    ctx.drawImage(sky.c, 0, 0, W, H)

    /* The flash goes in over the sky and under everything else, so the
       skyline stays a silhouette against it rather than being washed
       out with it. */
    const strike = strikeStep()
    const flash = strike >= 0 ? BOLT_ENV[strike] : 0
    if (flash) for (let y = 0; y < SKYLINE; y++) washRow(ctx, y, W, T.lightning, flash)

    if (T.stars && (weather === 'none' || snowLevel < 0.5)) drawStars()
    blit(clouds, -Math.floor(frame / 7))
    if (flash > 0.5) drawBolt(strikeSeed)
    /* ---- the events ----
       Everything with a beginning and an end goes quiet in reading
       mode: the airship and its banner, the saucer, the meteors, the
       train, the drone, the paper plane. Those are what actually pull
       an eye off a paragraph — not movement as such, but a thing
       arriving and leaving.

       The CITY keeps running underneath, at a third speed: windows
       flicker, the cat breathes, the fire burns. That is texture
       rather than event, and a frozen city behind a page stops being
       a place and becomes a screenshot. */
    const quiet = focus > 0.5

    if (!quiet) {
      drawCraft()
      drawCameo()
    }
    if (!T.stars) drawBirds()

    /* The camera catches up in steps, never smoothly: this scene has
       no easing anywhere else and would not survive it here. */
    if (panX !== panTo) {
      const d = panTo - panX
      const step = Math.sign(d) * Math.max(6, Math.round(Math.abs(d) / 5))
      panX = Math.abs(d) <= Math.abs(step) ? panTo : panX + step
    }

    /* Parallax: furthest layer slowest. The ridge barely moves at all.
       Each layer is blitted at its own lifted ground line and then has
       its mass painted in underneath, before the next one nearer
       covers the top of it. */
    /* Order matters: the mass goes down FIRST and the layer is blitted
       on top of it, so the buildings stand ON their ground line. Drawn
       the other way round the band's top edge cuts every tower in the
       layer at the same height and reads as a rule ruled across the
       city, which is the one thing it must not look like. */
    if (ridge) {
      ground(ridge.fill, LIFT[0])
      blit(ridge.buf, drift(0) - Math.round(panX * 0.10), LIFT[0])
    }
    const o0 = drift(1) - Math.round(panX * 0.22)
    const o1 = drift(2) - Math.round(panX * 0.42)
    const o2 = drift(3) - Math.round(panX * 0.68)

    ground(city[0].fill, LIFT[1])
    blit(city[0].buf, o0, LIFT[1])
    flicker(city[0], o0, LIFT[1])
    ground(city[1].fill, LIFT[2])
    blit(city[1].buf, o1, LIFT[2])
    flicker(city[1], o1, LIFT[2])
    blit(city[2].buf, o2, LIFT[3])
    flicker(city[2], o2, LIFT[3])
    if (T.stars) drawLightBeams(o2) // a lighthouse beam by day is a smudge

    // In front of the skyline, behind the elevated line — it is flying
    // over the city, not through it.
    // The airship is gone: it carried a lit banner with words on it,
    // and words in the backdrop compete with words on the page.

    /* The elevated line sits in front of the city and behind the roof.
       It does NOT drift: it is thirty feet away and bolted down, and
       the camera is a fixed shot from one rooftop. Only the train on
       it moves. */
    blit(viaduct, drift(4))
    if (!quiet) drawTrain()

    drawShells()

    // everything behind the near plane now falls away into it
    separateCity()

    // The rooftop is deliberately static — the cat and the brazier stand
    // on it, so it cannot scroll underneath them.
    blit(roof, 0)
    recedeDeck()

    /* ---- a clean roof ----
       The washing line, the string lights, the tree, the moths, the
       steam vent, the rat, the pigeon, the paper plane and the drone
       all used to run here. Individually every one of them was a nice
       detail; together they were nine separate small movements in the
       bottom fifth of the frame, directly under a column of text.

       A rooftop with one fire on it is a place. A rooftop with nine
       things happening on it is a screensaver, and a screensaver is
       the wrong thing to put behind something you want read. */

    /* Anything that has *landed* belongs on this canvas, behind the
       panel. Only what is still falling goes on the overlay. */
    if (weather === 'snow') drawParapetSnow()
    if (weather === 'rain') {
      drawSplashes(ctx, false)
      drawRipples()
    }

    if (T.fire) {
      drawFire()
      drawIgnition()
    }

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

    // the brazier reads the same panel rect the weather does
    stepFire(dt, p)

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
    stageRebuild()
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

    /* ---- reading mode ----
       Called by the router when it leaves home. The city dims and
       stops; coming back brings it up again. Both over half a second,
       because a scene that snaps to a halt reads as a crash and one
       that snaps back reads as a jump-cut. */
    /* Send one up. `frac` is a position across the sky from 0 to 1 and
       `power` scales the burst, so the page can fire one without
       knowing anything about scene coordinates. */
    launch(frac, power, col) {
      firework(60 + (W - 120) * frac, 74 + Math.random() * 86, col, power)
      render()
    },

    setFocus(on) {
      focusTo = on ? 1 : 0
      if (!animating) focus = focusTo
    },
  }

  /* ==================================================================
     TICK — fixed 12fps, so every motion is inherently stepped
     ================================================================== */
  let lastRaf = 0

  function loop(t) {
    requestAnimationFrame(loop)
    const dt = Math.min(120, lastRaf ? t - lastRaf : 1000 / 60)
    lastRaf = t

    // ease toward the current focus state, then let it scale motion
    if (focus !== focusTo) {
      const step = dt / FOCUS_MS
      focus = focusTo > focus ? Math.min(focusTo, focus + step) : Math.max(focusTo, focus - step)
    }
    /* Everything stops. The frame counter included — the fire, the
       cat and the window flicker are all counted in frames, so
       holding it is what actually makes the picture still rather
       than making eleven separate things individually still. */
    const live = focus > 0.5 ? 0 : 1


    /* One slice of any pending rebuild, before anything else this
       frame. The dissolve snapshot is covering the screen while this
       drains, so a layer being swapped underneath is never seen. */
    drainRebuild()

    overlay(dt * live)

    /* ONE reason to repaint: the 12fps content tick.

       There used to be a second — a parallax layer having crossed a
       whole pixel — which meant renders happened at two unrelated
       cadences that drifted against each other. The city moved on one
       clock and everything in it on another, and the interference
       between them is what read as jitter. One clock now, and the
       parallax is a division of it. */
    /* `live` gates the content tick outright. At zero the frame
       counter holds, nothing re-renders, and present() goes on
       showing the last painted frame — which is exactly the still
       picture reading mode wants, and costs nothing to hold. */
    if (live > 0) {
      if (t - last >= 1000 / FPS) {
        last = t
        frame++
        render()
      }
    } else {
      // keep the clock from banking time while stopped, so coming back
      // does not fire a burst of catch-up frames
      last = t
    }

    // present the offscreen scene, then the cross-fade over it
    present(sceneCv)
    drawDissolve()

    /* ---- lights out ----
       Over the FINISHED frame, so it takes the cat and the fire down
       with the city. An L2 page is for reading, and a fire is the
       most animated thing on this roof — leaving it burning at full
       strength in front of a dark city made it the brightest object
       on a page it was not supposed to be part of. Everything goes
       behind the glass together. */
    if (focus > 0.002) {
      screenCtx.save()
      screenCtx.globalAlpha = focus * LIGHTS_OUT
      screenCtx.fillStyle = T.edge
      screenCtx.fillRect(0, 0, W, H)
      screenCtx.restore()
    }
  }

  if (animating) requestAnimationFrame(loop)
})()
