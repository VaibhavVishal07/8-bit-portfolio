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
  const LOOP_W = W * 2

  /* ---- how tall a layer buffer has to be ----
     Nothing in a skyline buffer exists below SKYLINE, and the tallest
     thing in one is the Skytree at y=90. Allocating those buffers full
     height was 23% of the largest allocations in the file spent on
     transparent rows, which is what pays for the fifth plane. Same for
     the viaduct, whose piers stop at ROOF_TOP.

     Generous margins on both: a landmark that grows past its buffer is
     silently cropped, which is a horrible thing to debug. */
  const CITY_H = 452

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
    /* Render the city at up to SIX times the authored pixels — four times
       the density it used to carry — wherever the display and the device
       can take it. This is where the detail lives: not more buildings, but
       every gradient, glow and dithered edge resolving to smooth tone
       instead of stepping, so the artwork reads sharp and clean.

       The buffers grow with S^2 (the two looping city planes alone are
       11520x3240 at S=6, ~300MB), so memory sets the ceiling: an 8GB-class
       machine gets the full six, mid devices four, and a low-memory phone
       is held at three — and a viewport too small to show the extra pixels
       does not pay for them. */
    const mem = navigator.deviceMemory || 8
    const cap = mem <= 4 ? 3 : mem <= 6 ? 4 : 6
    const want = up >= 1.3 ? 6 : up >= 0.9 ? 4 : 2
    return Math.min(want, cap)
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

  /* The canvas is `object-fit: cover` inside a box the stylesheet owns —
     full width, a fifth taller than the viewport, anchored at the top so
     the dark rooftop foreground is cropped off the bottom. Anything that
     maps between page coordinates and canvas coordinates has to undo
     exactly that.

     It used to be undone from two constants copied out of the CSS, which
     is a fact stated in two places and therefore a fact that goes wrong:
     the portrait rule already moved the horizontal anchor to 72% and this
     was still saying 50%, so every firework on a phone landed off to one
     side. It reads the element instead — its real box, and its real
     computed object-position — so the stylesheet stays the only place any
     of this is decided.

     Cached, because a `getComputedStyle` per frame is a style recalc per
     frame, and the answer only changes when the viewport does. */
  let fitCache = null

  function fit() {
    if (fitCache) return fitCache
    const r = cv.getBoundingClientRect()
    const op = getComputedStyle(cv).objectPosition.split(/\s+/)
    // authored as percentages; a browser that hands back pixels is read
    // against the box it was resolved in, which comes to the same place
    const frac = (v, box, img) => {
      if (v.endsWith('%')) return parseFloat(v) / 100
      const px = parseFloat(v) || 0
      return box === img ? 0 : px / (box - img)
    }
    fitCache = { r, op, frac }
    return fitCache
  }

  window.addEventListener('resize', () => { fitCache = null })

  function viewMap() {
    const { r, op, frac } = fit()
    const scale = Math.max(r.width / W, r.height / H)
    const iw = W * scale
    const ih = H * scale
    return {
      scale,
      ox: r.left + (r.width - iw) * frac(op[0], r.width, iw),
      oy: r.top + (r.height - ih) * frac(op[1] || op[0], r.height, ih),
    }
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
  /* The 8x8 Bayer matrix that used to live here, and the pattern cache
     built from it, are gone — see the note on washRow. Everything that
     was thresholded against it is a real alpha now. */

  /* Every layer buffer is supersampled and pre-transformed, so callers
     keep passing authored 960x540-space sizes and coordinates. */
  function makeBuffer(w, h) {
    const c = document.createElement('canvas')
    c.width = dev(w)
    c.height = dev(h)
    const x = c.getContext('2d')
    x.imageSmoothingEnabled = false
    x.setTransform(S, 0, 0, S, 0, 0)
    return { c, x, w, h }
  }

  const px = (x, y, c) => {
    ctx.fillStyle = c
    ctx.fillRect(x, y, 1, 1)
  }

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

  /* ---- bloom ----

     Every light in this city was drawn at its own size and stopped
     there. A window is one lit pixel; a hundred lit windows are a
     hundred lit pixels, and the air between them stays perfectly
     clear. That is the single biggest thing separating this from the
     reference art: not the buildings, the AIR. In a real night city
     the light does not stay where it was emitted — it scatters off
     haze, dust and damp all the way to the eye, so a bright thing is
     always sitting in a soft pool of its own colour and a dense field
     of small bright things reads as a glow with structure in it.

     Doing that per source is hopeless here: there are several thousand
     lit cells per layer and glow() spends a gradient on each one.

     So it is done once, on the whole plane, the way a compositor does
     it. Take the finished layer, throw it down to an eighth scale —
     which IS a box blur, done by the sampler for free — square it so
     the darks fall away and only genuine light survives, then add it
     back over the top at full size with smoothing on. One downscale
     and one upscale per layer, and every window, sign, tube and
     beacon in it is suddenly sitting in air.

     Squaring is what keeps this from being a haze filter. Multiplying
     the small copy by itself sends a mid-grey wall to a quarter of its
     value and a near-black one to nothing, while a saturated neon at
     full brightness comes through almost untouched — so the bloom is
     carried by the lights and not by the buildings they are bolted to. */
  function bloom(buf, amt, div) {
    if (!(amt > 0)) return
    const d = div || 8
    const dw = Math.max(1, Math.round(buf.c.width / d))
    const dh = Math.max(1, Math.round(buf.c.height / d))

    const small = document.createElement('canvas')
    small.width = dw
    small.height = dh
    const sx = small.getContext('2d')
    sx.imageSmoothingEnabled = true
    sx.drawImage(buf.c, 0, 0, dw, dh)

    /* Crush the darks. Two multiplies is x^3 — enough that the body of
       a building contributes nothing and a lit window contributes
       nearly all of itself. */
    sx.globalCompositeOperation = 'multiply'
    sx.drawImage(small, 0, 0)
    sx.drawImage(small, 0, 0)
    sx.globalCompositeOperation = 'source-over'

    const g = buf.x
    g.save()
    /* The buffer context is pixel-snapped and carries the S transform.
       The bloom is the one thing in it that must be resampled smoothly
       — a nearest-neighbour upscale of an eighth-scale image is a grid
       of squares, which is the lattice problem all over again. */
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.imageSmoothingEnabled = true
    g.globalCompositeOperation = 'lighter'
    g.globalAlpha = amt
    g.drawImage(small, 0, 0, buf.c.width, buf.c.height)
    g.restore()
    g.imageSmoothingEnabled = false
    g.setTransform(S, 0, 0, S, 0, 0)
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

  /* ---- one pixel of falloff, at a real opacity ----

     This used to threshold against the Bayer matrix: the pixel was
     either fully the colour or nothing at all, and the apparent
     brightness came from what fraction of neighbouring pixels crossed
     their threshold. That is how the hardware this is dressed as
     actually worked, and on a static frame it is lovely.

     It does not survive MOTION. A dither is a fixed pattern in the
     grid it is drawn into, so when the thing under it moves a pixel,
     every cell re-thresholds and the whole texture reshuffles — glows,
     haze and the sky all crawl and boil against the layers sliding
     underneath them. Five parallax planes made that unmissable, and it
     is exactly the shimmer that reads as the interface being unstable.

     A real alpha costs nothing here and holds still. */
  function dot(g, x, y, t, col) {
    if (t <= 0) return
    g.fillStyle = rgba(col, Math.min(1, t))
    g.fillRect(x, y, 1, 1)
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

  /* ==================================================================
     WHAT THE CITY SELLS

     This was one list for every skyline, and it was an Indian one —
     chai, dosa, tiffin, paan. Written when there was one city, where
     a single coherent set of businesses was exactly right.

     With five cities it is exactly wrong, and it is the loudest kind
     of wrong: the signage is the only thing in the frame that uses
     WORDS, so it is doing more to say where you are than the palette
     and the monuments put together. A Tokyo skyline advertising
     tiffin is not a Tokyo skyline.

     So each city brings its own trade. Rules, all of them practical:

       ASCII CAPS ONLY. The 3x5 font is A-Z, 0-9 and a handful of
       punctuation — no accents, so it is CAFE and not café, and
       nothing that needs a character the font has not got.

       SHORT. A billboard is forty pixels across and the code picks
       from whatever fits the wall it is bolted to, so a list with
       nothing under seven characters leaves the narrow towers blank.

       THE TALL LIST IS SHORTER STILL. Vertical signage stacks one
       letter per seven-pixel cell down a thin box; past six letters
       it runs off the bottom of the building.

       REAL TRADES, NO REAL BRANDS. What is actually open at midnight
       on a street like this one.
     ================================================================== */
  const SIGN_SETS = {
    newyork: {
      wide: [
        'DELI', 'PIZZA', 'BODEGA', 'LAUNDRY', 'JAZZ', 'DINER', 'BAGELS',
        'HOT DOGS', 'NEWSSTAND', 'OPEN 24HR', 'CIGARS', 'PAWN', 'AUTOMAT',
        'SHOESHINE', 'WALK-UP', 'CHOP HOUSE', 'OYSTERS', 'BOOKS',
      ],
      tall: ['HOTEL', 'BAR', 'DELI', 'JAZZ', 'LOFTS', 'PIZZA', 'ROOMS', 'CAFE'],
    },
    tokyo: {
      wide: [
        'RAMEN', 'IZAKAYA', 'KARAOKE', 'SUSHI', 'YAKITORI', 'GYOZA',
        'PACHINKO', 'UDON', 'MATCHA', 'KISSATEN', 'CURRY', 'HANAMI',
        'OKONOMI', 'DENKI', 'SENTO', 'OPEN LATE', 'GAME CENTER',
      ],
      tall: ['SAKE', 'BAR', 'RAMEN', 'SUSHI', 'UDON', 'HOTEL', 'SENTO', 'KOBAN'],
    },
    delhi: {
      wide: [
        'CHAI', 'DHABA', 'MITHAI', 'SAMOSA', 'BIRYANI', 'CHAAT',
        'TIFFIN', 'DOSA', 'KIRANA', 'PAKORA', 'LASSI', 'TANDOOR',
        'SWEETS', 'MEDICAL', 'SAREES', 'JALEBI', 'STUDIO',
      ],
      tall: ['CHAI', 'PAAN', 'HOTEL', 'DHABA', 'CAFE', 'SWEETS', 'STUDIO', 'RADIO'],
    },
    paris: {
      wide: [
        'BRASSERIE', 'CAFE', 'TABAC', 'METRO', 'CINEMA', 'BISTRO',
        'FROMAGE', 'CREPES', 'THEATRE', 'PARFUM', 'HUITRES', 'LIBRAIRIE',
        'PATISSERIE', 'ANTIQUITES', 'VELO', 'PAIN', 'VIN',
      ],
      tall: ['HOTEL', 'TABAC', 'CAFE', 'CINE', 'BAR', 'MODE', 'METRO', 'VIN'],
    },
    dubai: {
      wide: [
        'SOUK', 'GOLD SOUK', 'SPICES', 'DATES', 'SHAWARMA', 'KARAK',
        'PEARL', 'MAJLIS', 'FALCON', 'SAFFRON', 'PERFUME', 'TEXTILES',
        'ABRA', 'DHOW', 'OUD', 'CARGO', 'DUTY FREE',
      ],
      tall: ['SOUK', 'GOLD', 'OUD', 'KARAK', 'HOTEL', 'PEARL', 'SPICE', 'ABRA'],
    },
  }

  const signSet = () => SIGN_SETS[cityKey] || SIGN_SETS.newyork

  /* The airship and its banner are gone, and so is the plane that
     towed one. Both put WORDS in the backdrop, and a page whose job
     is to be read cannot afford a second thing in the frame asking to
     be read — least of all one that moves. */

  /* ==================================================================
     THE WASH

     One row of a large flat gradient — the sky ramp, the aerial haze
     over each skyline, the weather wash, the snow blanket, the mass
     under each parallax plane. Every one of those is a wide, gentle,
     low-contrast field, and it used to be an ordered dither.

     It is a flat alpha now, and the dither is gone from the background
     entirely. That is a real trade and it is worth stating plainly:
     the dither was the period-correct answer, it is what a machine
     with a fixed palette actually did, and on a still frame it looked
     right.

     Three things made it wrong HERE.

     ONE — it is a screen-space pattern over a moving picture. Five
     parallax planes slide past each other continuously; the dither
     does not slide with them, so every plane crawls with a texture
     that belongs to the glass rather than to the city. That is the
     shimmer.

     TWO — the resolution went up. At S=3 the tile is at device-pixel
     pitch, so it stopped reading as a texture with a size and started
     reading as noise with none.

     THREE — the whole scene is composited, not palettised. Nothing
     here is limited to a fixed set of colours, so the dither was
     buying an authenticity the rest of the file never claimed and
     paying for it in stability.

     Alpha is one fillRect a row, so it is also cheaper. */
  function washRow(g, y, w, col, t) {
    const a = Math.max(0, Math.min(1, t))
    if (a <= 0.002) return
    g.fillStyle = rgba(col, a)
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
        '#050509', '#08080f', '#0c0c17', '#111020', '#161428',
        '#1d172e', '#251a33', '#2f1d37', '#3c213a',
      ],
      haze: '#7d4a6d',
      smog: '#48325a',
      fog: '#443563',
      fogAmt: [0.26, 0.11, 0.0],
      rainSky: '#100c19',
      snowSky: '#2c283c',
      snowWash: [0.06, 0.16], blanket: [0.85, 0.15], fogSnowBoost: 0.09,
      lightning: '#c9b6ff', boltCore: '#ffffff',

      orb: '#ecd8ff', orbShade: '#b58ce0', orbGlow: '#674582',
      craters: true, orbShine: false,
      /* Cloud is lit from BELOW here. There is no moon doing this work
         — the city is, and a city throws magenta up at its own weather.
         The underside was the same violet as the body, which made every
         cloud a flat cut-out. */
      cloud: '#322544', cloudLit: '#63457b', cloudDark: '#1c1429',
      // cold teal, deep indigo, one thin violet — see the high pools
      high: ['#283c52', '#37325a', '#53396d'],
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
        fill: '#1c1736', lit: '#382e66', dark: '#0e0b1e', window: '#6e7cc4', warm: '#9a76c8',
        glass: ['#7c8ad4', '#7c8ad4', '#7c8ad4', '#8a7ccc', '#6e7cc4', '#a47cc8', '#7e94dc', '#7c8ad4'],
      },
      city: [
        {
          fill: '#160f2e', lit: '#352663', dark: '#08051a', window: '#6ad8ff', warm: '#ff8ad0',
          glass: ['#6ad8ff', '#6ad8ff', '#8ae8ff', '#ffd88a', '#ff6ad0', '#b06aff', '#5a9ad8', '#e8f4ff'],
        },
        {
          fill: '#0d0824', lit: '#281853', dark: '#050313', window: '#6ae4ff', warm: '#ffc46b',
          glass: ['#6ae4ff', '#6ae4ff', '#9af0ff', '#ffc46b', '#ff5cc8', '#c26aff', '#4a86d8', '#fff0c0'],
        },
        {
          fill: '#070419', lit: '#1d1145', dark: '#020109', window: '#7aeaff', warm: '#ffd88a',
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
        '#103b62', '#18476f', '#215178', '#346084', '#4a6786',
        '#656b87', '#7d7386', '#94797e', '#ac8767',
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
  let sky, clouds, roof
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
  /* ---- Ridge, city 0..3, viaduct ----

     Six entries, because there are five skyline planes now, and every
     one of them slower than it was.

     Five planes drifting at five different rates means SOMETHING in
     the frame steps on almost every tick, and a background that never
     holds still for a whole second is the thing that reads as the
     interface being unstable — even though each individual layer is
     moving perfectly evenly. The fix is not smoother motion, it is
     less of it: the near layer halves from twelve pixels a second to
     six and everything behind it comes down with it, so the frame
     settles between steps instead of always being mid-step.

     1.5 pixels a second at the back, six at the front. The ratio —
     which is what actually carries the depth — is unchanged. */
  const DIV = [8, 6, 4, 3, 2, 0]

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

  /* The stage wash: half strength, and it never stops the clock. The
     city keeps crossing behind an open L2 page, just at half the
     brightness so it reads as a backdrop rather than the subject. */
  /* Raised from a half. At half strength the city behind an open page
     was still the brightest thing in the frame — a moving skyline in
     full colour either side of a column of body text is a competition
     the text loses. It still moves, it is still the same city, it is
     just clearly behind the glass now. */
  const STAGE_DIM = 0.78
  let stage = 0
  let stageTo = 0

  /* ---- smooth parallax ----

     The layers used to advance only on the 12fps content tick, in whole
     logical pixels: `drift = -floor(frame / DIV)`. That is at most twelve
     scroll positions a second, and for the slow layers a single-pixel
     jump every half second — which is what read as choppy, however clean
     each individual step was.

     Motion is on its own clock now. `scrollT` is seconds of city motion
     elapsed (it advances in loop(), stops in reading mode, and banks
     across a wipe), and each layer's offset comes off that continuously.
     The old per-frame speeds are preserved exactly — a layer that moved
     one pixel every DIV frames at 12fps moves 12/DIV pixels a second — so
     nothing travels faster or slower than before; it just updates far
     more often.

     The offset is still SNAPPED to the device-pixel grid (`* S` then
     round, then back), because a fractional source rect with smoothing
     off would shimmer. So the finest step is one device pixel — three
     times finer than a logical pixel at S=3 — and the compositor repaints
     the instant that step changes rather than waiting for the tick. The
     content on the layers (window flicker, signage, the fire, the cat)
     still steps at 12fps off `frame`: smooth scroll, stepped sprites. */
  const SPEED = DIV.map((d) => (d ? 12 / d : 0)) // logical px/sec, = old 12/DIV
  let scrollT = 0
  const drift = (i) => (SPEED[i] ? -Math.round(scrollT * SPEED[i] * S) / S : 0)
  // signature of every layer's device offset — changes the moment any
  // layer crosses a whole device pixel, which is exactly when a repaint
  // is worth doing
  const driftSig = () => {
    let s = 0
    for (let i = 0; i < SPEED.length; i++) s = (s * 131 + Math.round(scrollT * SPEED[i] * S)) | 0
    return s
  }
  let lastDriftSig = 0

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
    /* No moon. The night sky is drawn without one: on a backdrop the
       disc was the single brightest object in the frame and the only
       hard circle in a picture made of rectangles, so the eye went to
       it and stayed there. The sky keeps its stars, its haze and its
       high pools, all of which read as night without a light source
       having to be named.

       The sun is untouched — at noon there genuinely is one, corona
       and all, and `orbShine` is what tells the two apart. */
    if (!T.orbShine) return

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
    // Was 46, then 20. Fewer again: a dark sky wants to read as depth,
    // and every slab in it is something the stars have to come through.
    for (let k = 0; k < 8; k++) {
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
  /* ---- the stock a city is built from ----

     The base mix is American and deliberately so: the setback tower is
     more than a third of everything built. Each city nudges these with
     its own `shape` deltas — Paris flattens the ziggurats and raises
     the slabs, Dubai raises the needles — and the result is normalised,
     so a city only has to say what it wants MORE of. */
  /* MANSARD and ZAKKYO sit at zero in the base mix and are switched on
     by the cities that own them. They are not "extra variety" — they
     are the two silhouettes that carry a whole city on their own:

       MANSARD  a low block under a steep truncated roof with dormers
                in it. Six storeys, one roofline, repeated the length
                of the street. Paris IS this shape; without it a Paris
                built from setback towers is Chicago with gold light.
       ZAKKYO   a narrow tower whose entire street face is a vertical
                stack of lit sign boxes, one tenant per floor. The
                Shinjuku building, and the reason a Tokyo block reads
                as advertising with a building behind it. */
  /* Four more silhouettes, in the general mix rather than owned by one
     city, because the complaint that a skyline "all looks the same" is
     never about the buildings you can name — it is about the ninety
     you cannot, and nine shapes was not enough of them:

       CHAMFER  the top corner sliced off on a long diagonal. One cut,
                and it is the most distinctive roofline a plain tower
                can have.
       TWIN     two shafts off one podium with a sky bridge between
                them. The only archetype with a HOLE in it, which is
                why it reads from any distance.
       NOTCH    a wide slab with a slot cut down through the top third,
                so the roofline is two blocks and a gap.
       TAPER    a continuous batter from base to crown — no setbacks,
                no steps, just walls that lean in the whole way up. */
  const BASE_SHAPE = [
    ['ziggurat', 0.28], ['banded', 0.11], ['needle', 0.09],
    ['slab', 0.07], ['dome', 0.06], ['drum', 0.06], ['grid', 0.12],
    ['chamfer', 0.08], ['twin', 0.06], ['notch', 0.07], ['taper', 0.06],
    ['mansard', 0], ['zakkyo', 0],
  ]

  function shapeTable() {
    const d = (cityDef() && cityDef().shape) || {}
    let total = 0
    const w = BASE_SHAPE.map(([k, v]) => {
      // zero is allowed, and is how a city says "not here"
      const n = Math.max(0, v + (d[k] || 0))
      total += n
      return [k, n]
    })
    let acc = 0
    return w.map(([k, n]) => {
      acc += n / total
      return [k, acc]
    })
  }

  function buildCity(seed, o) {
    const buf = makeBuffer(LOOP_W, CITY_H)
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
    /* The archetype mix and the trade list for whichever city is
       standing here. Both are read once per layer rather than per
       building — neither can change halfway through a skyline. */
    const shapes = shapeTable()
    const signs = signSet()

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
      /* Exactly one draw off the stream, whatever the weights are. A
         city that consumed a different number of random numbers here
         would rebuild a different skyline every time the mix was
         touched, and the weather and theme toggles both depend on the
         stream being stable. */
      const roll = rnd()
      let type = 'grid'
      for (let s = 0; s < shapes.length; s++) {
        if (roll < shapes[s][1]) { type = shapes[s][0]; break }
      }

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
      } else if (type === 'mansard') {
        /* Wide and LOW, and the low is the point. Haussmann capped the
           street at six storeys and the whole character of the city
           comes out of that cap: an even cornice line running the
           length of the block with nothing sticking through it. */
        w = Math.floor(w * 1.45)
        h = Math.max(26, Math.floor(h * 0.34))
      } else if (type === 'zakkyo') {
        w = Math.max(9, Math.floor(w * 0.78))
        h = Math.floor(h * 0.88)
      } else if (type === 'chamfer') {
        w = Math.max(9, Math.floor(w * 0.95))
        h = Math.floor(h * 1.05)
      } else if (type === 'twin') {
        // it has to be wide enough to hold two shafts and a gap
        w = Math.max(19, Math.floor(w * 1.5))
        h = Math.floor(h * 1.1)
      } else if (type === 'notch') {
        w = Math.max(16, Math.floor(w * 1.3))
        h = Math.floor(h * 0.9)
      } else if (type === 'taper') {
        w = Math.max(11, Math.floor(w * 1.2))
        h = Math.floor(h * 1.15)
      }
      const top = SKYLINE - h

      /* ---- what this building is NOT made of ----

         Four of the archetypes are defined by a void: the wedge off a
         chamfer, the slot between twin shafts, the notch through a
         crown, the air either side of a taper. A void has to be cut
         AFTER everything that fills the body — the window grid, the
         mullions, the fire escape, the signage all draw straight
         across it otherwise, and a slot full of lit windows is not a
         slot.

         So the shape code records them here and they are applied at
         the very end of the building, `voids` first and then `edges`
         over the top — the lit and shadowed faces that make a cut read
         as a cut rather than as a piece missing. */
      const voids = []
      const edges = []

      // the roofline sits above `top` for anything with a cap on it,
      // and the crown/plant/mast code further down has to know
      let capH = 0
      if (type === 'dome') capH = Math.floor(w * 0.42)
      else if (type === 'pitched') capH = Math.floor(w * 0.3)
      else if (type === 'barrel') capH = Math.floor(w * 0.26)
      else if (type === 'drum') capH = 3
      else if (type === 'mansard') capH = Math.max(6, Math.floor(w * 0.28))

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
      } else if (type === 'chamfer') {
        /* One long diagonal off the top corner, cut back into the body
           rather than added on top of it — so the tower loses a wedge
           instead of wearing a hat. Which way it leans is a coin
           flip, and two chamfers leaning opposite ways beside each
           other is the most useful thing this shape does. */
        const cut = Math.max(6, Math.round(Math.min(w * 0.8, h * 0.34)))
        const left = rnd() < 0.5
        for (let k = 0; k < cut; k++) {
          const back = Math.round((1 - k / cut) * Math.min(w - 2, cut))
          if (back < 1) continue
          voids.push([left ? x : x + w - back, top + k, back, 1])
          edges.push([left ? x + back : x + w - back - 1, top + k, 1, 1, o.lit])
        }
      } else if (type === 'twin') {
        /* Two shafts off one podium, with a bridge between them near
           the top. The gap is cut out of the body — the only archetype
           here you can see the sky through. */
        const gapw = Math.max(3, Math.round(w * 0.2))
        const gx0 = x + Math.round((w - gapw) / 2)
        const podium = Math.round(h * 0.28)
        const by0 = top + Math.round(h * 0.18)
        voids.push([gx0, top, gapw, h - podium])
        edges.push([gx0 - 1, top, 1, h - podium, o.dark])
        edges.push([gx0 + gapw, top, 1, h - podium, o.lit])
        // the sky bridge, put back across the slot
        edges.push([gx0, by0, gapw, 4, o.fill])
        edges.push([gx0, by0, gapw, 1, o.lit])
        edges.push([gx0, by0 + 2, gapw, 1, o.glass[Math.floor(rnd() * o.glass.length)]])
        // a crown on each shaft
        const sw3 = gx0 - x - 2
        if (sw3 >= 3) {
          for (const sx3 of [x + 1, gx0 + gapw + 1]) {
            g.fillStyle = o.fill
            g.fillRect(sx3, top - 5, sw3, 5)
            g.fillStyle = o.lit
            g.fillRect(sx3, top - 5, sw3, 1)
          }
        }
      } else if (type === 'notch') {
        /* A slot down through the top third. Two blocks and a gap, and
           the gap is what the eye keeps. */
        const nw = Math.max(3, Math.round(w * 0.24))
        const nx = x + Math.round((w - nw) / 2)
        const nh = Math.round(h * 0.34)
        voids.push([nx, top, nw, nh])
        edges.push([nx - 1, top, 1, nh, o.dark])
        edges.push([nx + nw, top, 1, nh, o.lit])
        edges.push([nx, top + nh, nw, 1, o.lit])
        if (rnd() < 0.5) {
          edges.push([nx, top + nh - 1, nw, 1, o.neon[Math.floor(rnd() * o.neon.length)]])
        }
      } else if (type === 'taper') {
        /* Walls that lean in the whole way up. Cut back a pixel at a
           time rather than stepped, so the profile is a slope instead
           of a stair — which at this scale is the difference between
           an obelisk and a wedding cake. */
        const pull = Math.max(2, Math.round(w * 0.3))
        for (let k = 0; k < h; k++) {
          const back = Math.round((1 - k / h) * pull)
          if (back < 1) continue
          voids.push([x, top + k, back, 1])
          voids.push([x + w - back, top + k, back, 1])
          edges.push([x + back, top + k, 1, 1, o.lit])
          edges.push([x + w - back - 1, top + k, 1, 1, o.dark])
        }
        edges.push([x + pull, top, w - pull * 2, 1, o.lit])
        g.fillStyle = o.window
        g.fillRect(x + ((w / 2) | 0), top - 7, 1, 7)
      } else if (type === 'mansard') {
        /* ---- the mansard ----

           Not a pitched roof. A pitched roof meets in a ridge; a
           mansard has TWO slopes, and what you see from across the
           city is only the lower one — steep, nearly vertical, cut off
           flat at the top. That flat cut is the whole silhouette, and
           it is why a Paris block reads as a solid horizontal band
           rather than as a row of triangles.

           Three things go on it and all three are load-bearing:
           dormers punched through the slope, a cornice at the eaves,
           and chimney pots along the ridge. Take away the pots and it
           is a shed. */
        const rake = Math.max(2, Math.round(capH * 0.55))
        // the cornice the roof sits on — heavier than the eaves line
        g.fillStyle = o.lit
        g.fillRect(x - 1, top - 1, w + 2, 2)
        g.fillStyle = o.dark
        g.fillRect(x - 1, top + 1, w + 2, 1)

        for (let k = 0; k < capH; k++) {
          const inset = Math.round((k / capH) * rake)
          const rw = w - inset * 2
          if (rw < 2) break
          g.fillStyle = o.dark
          g.fillRect(x + inset, top - 2 - k, rw, 1)
          g.fillStyle = k < 2 ? o.fill : o.dark
          g.fillRect(x + inset, top - 2 - k, 1, 1)
        }
        // the flat deck the two slopes meet at
        g.fillStyle = o.fill
        g.fillRect(x + rake, top - 2 - capH, w - rake * 2, 1)

        // dormers: a lit box punched through the slope, every few bays
        const dorm = Math.max(7, Math.floor(w / 4))
        for (let dx = x + 3; dx < x + w - 5; dx += dorm) {
          const dy = top - 3 - Math.round(capH * 0.45)
          g.fillStyle = o.dark
          g.fillRect(dx, dy, 4, 5)
          g.fillStyle = rnd() < 0.5 ? o.glass[Math.floor(rnd() * o.glass.length)] : o.dark
          g.fillRect(dx + 1, dy + 1, 2, 3)
          g.fillStyle = o.lit
          g.fillRect(dx, dy - 1, 4, 1)
        }

        // chimney pots, in a row along the top
        for (let cxp = x + 2; cxp < x + w - 2; cxp += 5 + Math.floor(rnd() * 5)) {
          const ch = 3 + Math.floor(rnd() * 4)
          g.fillStyle = o.dark
          g.fillRect(cxp, top - 2 - capH - ch, 2, ch)
          g.fillStyle = o.lit
          g.fillRect(cxp, top - 2 - capH - ch, 2, 1)
        }
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
      /* Anything that has already said what its top is does not get a
         crown stacked on it — a box through the middle of a chamfer,
         a notch or a pair of twin shafts destroys the one shape that
         made them recognisable. */
      const CROWNED = { dome: 1, pitched: 1, barrel: 1, ziggurat: 1, mansard: 1,
                        chamfer: 1, twin: 1, notch: 1, taper: 1 }
      const flatTop = !CROWNED[type]
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
      if (rnd() < 0.3 && flatTop && cw > 8) {
        const aw = 3 + Math.floor(rnd() * 7)
        const ah = 2 + Math.floor(rnd() * 4)
        const ax = cx + 2 + Math.floor(rnd() * Math.max(1, cw - aw - 3))
        g.fillStyle = o.fill
        g.fillRect(ax, cy - ah, aw, ah)
        g.fillStyle = o.lit
        g.fillRect(ax, cy - ah, aw, 1)
        cap(ax, cy - ah + 1, aw, 2)
      }

      /* ---- what the city keeps on its roofs ----

         Every city puts something different up there and it is one of
         the few pieces of vernacular that is legible at eight pixels.
         New York has timber water tanks on legs, on a third of the
         island. Tokyo has a billboard on everything. Paris has ranks
         of chimney pots. Delhi has black plastic water tanks on frames,
         a dish on every parapet. Dubai has satellite dishes and
         chillers.

         Cheap, small, and repeated — which is exactly how vernacular
         works. `roofKit` picks which. */
      const kit = cityDef().roofKit
      if (kit && flatTop && cw > 7 && rnd() < 0.42) {
        const rx = cx + 2 + Math.floor(rnd() * Math.max(1, cw - 8))
        if (kit === 'tank') {
          // a barrel on four legs, with a conical lid
          const tw = 5 + Math.floor(rnd() * 3)
          const th = 5 + Math.floor(rnd() * 4)
          g.fillStyle = o.dark
          for (let k = 0; k < 4; k++) g.fillRect(rx + k * 2, cy - 3, 1, 3)
          g.fillStyle = o.fill
          g.fillRect(rx, cy - 3 - th, tw, th)
          g.fillStyle = o.lit
          g.fillRect(rx, cy - 3 - th, 1, th)
          g.fillRect(rx, cy - 3 - th, tw, 1)
          g.fillStyle = o.dark
          g.fillRect(rx + tw - 1, cy - 3 - th, 1, th)
          // the lid, one pixel proud each side
          g.fillStyle = o.lit
          g.fillRect(rx - 1, cy - 4 - th, tw + 2, 1)
          g.fillRect(rx + ((tw / 2) | 0), cy - 6 - th, 1, 2)
        } else if (kit === 'billboard') {
          // a hoarding on a gantry, facing the street
          const bw2 = Math.min(cw - 2, 8 + Math.floor(rnd() * 10))
          const bh2 = 6 + Math.floor(rnd() * 6)
          const col = o.neon[Math.floor(rnd() * o.neon.length)]
          g.fillStyle = o.dark
          g.fillRect(rx + 1, cy - 4, 1, 4)
          g.fillRect(rx + bw2 - 2, cy - 4, 1, 4)
          if (o.halo) glow(g, rx, cy - 4 - bh2, bw2, bh2, 12, col, o.halo * 1.4)
          g.fillStyle = o.dark
          g.fillRect(rx, cy - 4 - bh2, bw2, bh2)
          g.fillStyle = col
          g.fillRect(rx, cy - 4 - bh2, bw2, 1)
          g.fillRect(rx, cy - 5, bw2, 1)
          for (let k = 2; k < bh2 - 2; k += 2) {
            g.fillRect(rx + 1 + Math.floor(rnd() * 2), cy - 4 - bh2 + k, bw2 - 3, 1)
          }
          windows.push({ x: rx, y: cy - 4 - bh2, w: bw2, h: 1, sign: true, col: col, off: o.dark })
        } else if (kit === 'pots') {
          // chimney pots, in a rank
          for (let k = 0; k < 2 + Math.floor(rnd() * 4); k++) {
            const ph2 = 3 + Math.floor(rnd() * 4)
            g.fillStyle = o.dark
            g.fillRect(rx + k * 3, cy - ph2, 2, ph2)
            g.fillStyle = o.lit
            g.fillRect(rx + k * 3, cy - ph2, 2, 1)
          }
        } else if (kit === 'cistern') {
          // a plastic tank on an angle frame
          const tw = 4 + Math.floor(rnd() * 4)
          g.fillStyle = o.dark
          g.fillRect(rx, cy - 3, tw, 1)
          g.fillRect(rx, cy - 3, 1, 3)
          g.fillRect(rx + tw - 1, cy - 3, 1, 3)
          g.fillStyle = o.warm
          g.fillRect(rx, cy - 3 - 4, tw, 4)
          g.fillStyle = o.lit
          g.fillRect(rx, cy - 7, tw, 1)
        } else if (kit === 'dish') {
          // a satellite dish and a chiller box
          const dr = 2 + Math.floor(rnd() * 2)
          g.fillStyle = o.dark
          g.fillRect(rx + dr, cy - dr, 1, dr)
          g.fillStyle = o.lit
          for (let dy2 = -dr; dy2 <= 0; dy2++) {
            const span = Math.floor(Math.sqrt(Math.max(0, dr * dr - dy2 * dy2)))
            g.fillRect(rx + dr - span, cy - dr * 2 + dy2 + dr, span * 2 + 1, 1)
          }
          g.fillStyle = o.fill
          g.fillRect(rx + dr * 2 + 2, cy - 4, 5, 4)
          g.fillStyle = o.lit
          g.fillRect(rx + dr * 2 + 2, cy - 4, 5, 1)
        }
      }

      /* ---- fire escapes ----

         A zigzag of landings and ladders bolted across the front of
         the building. Only on the near layers, where there are enough
         pixels for the diagonal to read, and only on the older stock —
         a fire escape on a glass tower is wrong in a way people notice
         without being able to say why.

         It is the single highest-value piece of detail in this file
         per pixel spent: it breaks up a flat face with a HORIZONTAL
         rhythm at a different pitch from the windows, which is what
         stops a wall of window grid reading as graph paper. */
      if (o.escapes && (type === 'grid' || type === 'slab' || type === 'zakkyo') && w > 11 && rnd() < 0.34) {
        const ex = x + 2 + Math.floor(rnd() * Math.max(1, w - 10))
        const ew = 7
        let leg = rnd() < 0.5 ? 0 : 1
        for (let ey = top + 10; ey < SKYLINE - 6; ey += o.step * 2 + 2) {
          g.fillStyle = o.dark
          g.fillRect(ex, ey, ew, 1)          // the landing
          g.fillStyle = o.lit
          g.fillRect(ex, ey - 2, 1, 2)        // and its rail, at both ends
          g.fillRect(ex + ew - 1, ey - 2, 1, 2)
          // the ladder down to the next one, alternating sides
          const lx = leg ? ex + ew - 2 : ex + 1
          for (let k = 1; k < o.step * 2 + 2; k += 2) g.fillRect(lx, ey + k, 1, 1)
          leg ^= 1
        }
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
            if (rnd() < 0.14) windows.push({ x: x + 2, y: ly, w: w - 4, h: Math.min(2, o.wh), wall: o.fill })
          }
        }
      }

      /* ---- the zakkyo stack ----

         A tenant a floor, and every one of them with a lit box out
         over the pavement. It runs the full height of the building
         down the street face, alternating sides so the stack reads as
         signs BOLTED ON rather than as a stripe painted down the
         wall — and every box is registered as a tube, so the whole
         column flickers independently, which is what a street of these
         actually does.

         This replaces the window grid on the face it covers rather
         than sitting over it: nobody can see into a floor with a sign
         across it, and drawing both is what made the first attempt
         read as a lit tower with confetti on it. */
      if (type === 'zakkyo') {
        const side = rnd() < 0.5 ? 0 : 1
        const bw = Math.max(4, Math.min(9, Math.floor(w * 0.42)))
        const bx = side ? x + w - bw - 1 : x + 1
        let sy = top + 4
        while (sy < SKYLINE - 12) {
          const bh = 5 + Math.floor(rnd() * 5)
          const col = o.neon[Math.floor(rnd() * o.neon.length)]
          const lit = rnd() < 0.82
          if (lit && o.halo) glow(g, bx, sy, bw, bh, 10, col, o.halo * 1.5)
          g.fillStyle = o.dark
          g.fillRect(bx - 1, sy - 1, bw + 2, bh + 2)
          g.fillStyle = lit ? col : o.dark
          g.fillRect(bx, sy, bw, bh)
          // a couple of dark bars across it stand in for the lettering
          if (lit) {
            g.fillStyle = o.dark
            for (let k = 1; k < bh - 1; k += 2) {
              g.fillRect(bx + 1 + Math.floor(rnd() * 2), sy + k, bw - 2 - Math.floor(rnd() * 2), 1)
            }
            if (rnd() < 0.3) windows.push({ x: bx, y: sy, w: bw, h: bh, sign: true, col: col, off: o.dark })
          }
          sy += bh + 2 + Math.floor(rnd() * 2)
        }
        // the narrow strip of real windows left beside the stack
        const fw = w - bw - 3
        if (fw > 3) {
          const fx0 = side ? x + 1 : x + bw + 2
          for (let fy = top + 5; fy < SKYLINE - 3; fy += o.step + 1) {
            g.fillStyle = rnd() < o.litChance ? o.glass[Math.floor(rnd() * o.glass.length)] : o.dark
            g.fillRect(fx0, fy, Math.min(fw, o.ww + 1), o.wh)
          }
        }
      }

      // window grid
      const cols = type === 'banded' || type === 'zakkyo' ? 0 : Math.floor((w - 3) / o.step)
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
          if (rnd() < 0.10) windows.push({ x: wx, y: wy, w: o.ww, h: hh, wall: o.fill })
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
          const word = signs.wide.filter((s) => s.length <= room)
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
          const s = signs.tall[Math.floor(rnd() * signs.tall.length)]
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

      // the voids, last of all, and then the faces they expose
      for (let k = 0; k < voids.length; k++) {
        g.clearRect(voids[k][0], voids[k][1], voids[k][2], voids[k][3])
      }
      for (let k = 0; k < edges.length; k++) {
        const e = edges[k]
        g.fillStyle = e[4]
        g.fillRect(e[0], e[1], e[2], e[3])
      }

      /* ---- how tight the street is ----

         Both draws are taken whatever the numbers are, so a city that
         changes its spacing does not walk a different random stream
         and rearrange every building behind it.

         This is a bigger lever on character than it looks. Manhattan
         and Shinjuku are wall-to-wall, so the gap barely opens; Dubai
         is towers standing alone in space, so it opens wide and often,
         and that space is most of why the two skylines cannot be
         mistaken for each other even in silhouette. */
      const opens = rnd() < (o.gapChance == null ? 0.35 : o.gapChance)
      const span = rnd()
      x += w + (opens ? 1 + Math.floor(span * (o.gap || 3)) : 0)
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
    /* ---- the street you cannot see ----

       In the reference art the single brightest band in the whole
       picture is the one at the bottom of the buildings, and none of
       the light in it has a visible source: it is shopfronts, signage
       and headlights, all of it below the sightline, throwing light UP
       into the air between the towers. That upward wash is most of
       what makes a drawn city look inhabited rather than modelled,
       because it is the only cue that says there are people down
       there.

       There is no street in this frame — the camera is on a roof and
       the near plane cuts the city off at its feet. So the street is
       drawn as the only part of itself that would actually be visible
       from up here, which is its glow on the air.

       'lighter' and source-atop in two passes: the wash goes into the
       air between the towers AND onto the towers' own lower storeys,
       because light bouncing off a street lands on both. Warm, always,
       whatever the layer's neon is doing — sodium and headlights are
       warm, and a warm base under a cool sky is the oldest depth cue
       in night painting. */
    if (o.street > 0) {
      /* Kept SHORT and kept weak. The first pass ran this to nearly
         half the frame height at three times this strength, and it did
         exactly what a full-width warm wash always does: it turned a
         purple night into a brown evening, pulled every tower to the
         same tan value, and left the neon with nothing to be brighter
         than. Street light does not fill a city — it pools at the
         bottom of it and is gone within a few storeys. */
      const rise = Math.round(SKYLINE * 0.15)
      g.save()
      g.globalCompositeOperation = 'lighter'
      const grd = g.createLinearGradient(0, SKYLINE - rise, 0, SKYLINE + 6)
      grd.addColorStop(0, rgba(o.streetCol || '#ff9a4a', 0))
      grd.addColorStop(0.6, rgba(o.streetCol || '#ff9a4a', 0.022 * o.street))
      grd.addColorStop(1, rgba(o.streetCol || '#ff9a4a', 0.11 * o.street))
      g.fillStyle = grd
      g.fillRect(0, SKYLINE - rise, LOOP_W, rise + 6)
      g.restore()
    }

    /* Bloom BEFORE the wash, so the haze sits over the light rather
       than under it. A distant plane's glow should read as already
       having travelled through the air between here and there, which
       means the fog has to be the last thing that touches it. */
    bloom(buf, o.bloom === undefined ? 0.5 : o.bloom)

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
    g.fillStyle = o.dark
    for (let k = 0; k < 8; k++) {
      g.fillRect(x - Math.round(k * 0.9), cy - 17 + k, 1, 1)
      g.fillRect(x + Math.round(k * 0.9), cy - 17 + k, 1, 1)
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
     MONUMENTS

     The landmarks above are archetypes: a ferris wheel, a clock tower,
     a crane. They give the eye something to catch on, but they belong
     to no particular city — which is exactly right for an invented one
     and exactly wrong the moment the scene claims to be somewhere.

     These are the other kind. Each one is a building a person could
     name, drawn at the smallest size its silhouette survives, because
     that is the whole test: if you have to be told which city you are
     looking at, the monument has failed and no amount of detail on it
     will help.

     Rules they all follow:

       SILHOUETTE FIRST. Every one of these is recognised by its
       outline before any surface detail arrives, so the outline is
       drawn first and the detail is only ever allowed to sit inside
       it. A Chrysler crown with the wrong number of arches still
       reads; a Chrysler crown with the right arches and a soft edge
       does not.

       ONE STEP ABOVE THE NOISE. They outline in `o.window`, the
       brightest structural colour the layer has, for the same reason
       the archetypes do — a monument drawn in the values of the
       towers beside it is just more skyline.

       LOCAL COLOUR IS EARNED. Most of them take the layer's palette.
       The few that do not — verdigris on Liberty, vermilion on a
       torii, the red-and-white banding on Tokyo Tower — are the cases
       where the colour IS the recognition, and those are only ever
       placed in the near layers, where the aerial wash is weak enough
       to leave them alone.
     ================================================================== */

  /* The block every one of these is made of: lit top and left,
     shadowed right. It is the rule the entire city is drawn to, and
     writing it once is what keeps seventeen monuments looking like
     they were built by the same hand as the towers around them. */
  function mBox(g, o, x, y, w, h) {
    if (w < 1 || h < 1) return
    g.fillStyle = o.fill
    g.fillRect(x, y, w, h)
    g.fillStyle = o.lit
    g.fillRect(x, y, w, 1)
    g.fillRect(x, y, 1, h)
    g.fillStyle = o.dark
    g.fillRect(x + w - 1, y, 1, h)
  }

  /* Vertical piers with recesses between them — the fluting that makes
     a deco tower read as a bundle of verticals rather than a stack of
     boxes. Same code the ziggurat archetype uses, lifted out so the
     named towers can wear it too. */
  function mFlute(g, o, x, y, w, h, gap) {
    const step = gap || 3
    for (let fx = x + 2; fx < x + w - 2; fx += step) {
      g.fillStyle = o.dark
      g.fillRect(fx, y, 1, h)
      g.fillStyle = o.lit
      g.fillRect(fx + 1, y, 1, h)
    }
  }

  /* ---- lattice steelwork ----

     Eiffel, Tokyo Tower and the Skytree are all the same object: two
     legs whose separation is a function of height, with cross-bracing
     between them. Give it the half-width curve and it draws any of
     them.

     The bracing is drawn bay by bay rather than as a continuous
     diagonal, because a diagonal on a pixel grid is a staircase and a
     staircase that restarts every bay is what real lattice looks like
     from a mile away. */
  function mTower(g, o, x, top, height, halfAt, rail, brace, bay) {
    const BAY = bay || 10
    for (let by = 0; by < height; by += BAY) {
      const h0 = Math.round(halfAt(by / height))
      const h1 = Math.round(halfAt(Math.min(1, (by + BAY) / height)))
      for (let k = 0; k < BAY && by + k <= height; k++) {
        const f = k / BAY
        const hw = Math.round(h0 + (h1 - h0) * f)
        const y = top + by + k
        g.fillStyle = rail
        g.fillRect(x - hw, y, 2, 1)
        g.fillRect(x + hw - 1, y, 2, 1)
        if (hw > 3) {
          // the X: one diagonal each way across the bay
          const s = Math.round(-hw + 2 * hw * f)
          g.fillStyle = brace
          g.fillRect(x + s, y, 1, 1)
          g.fillRect(x - s, y, 1, 1)
        }
      }
      // the girder closing each bay
      if (h1 > 3) {
        g.fillStyle = rail
        g.fillRect(x - h1, top + Math.min(height, by + BAY), h1 * 2, 1)
      }
    }
  }

  /* A half-round cap — dome, vault, sail head. Lit on the upper left
     quarter, shadowed past the shoulder, exactly like the archetype
     domes so the two never separate. */
  function mDome(g, o, x, y, w, h, skin) {
    const r = w / 2
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5 - r) / r
      const rise = Math.round(Math.sqrt(Math.max(0, 1 - u * u)) * h)
      if (rise < 1) continue
      g.fillStyle = skin || o.fill
      g.fillRect(x + i, y - rise, 1, rise)
      g.fillStyle = u < -0.15 ? o.lit : u > 0.45 ? o.dark : (skin || o.fill)
      g.fillRect(x + i, y - rise, 1, 1)
    }
  }

  /* ---- floodlit stone ----

     The near layer is authored nearly black, because it is the closest
     thing to the viewer and its job is to be unlit bulk in front of
     the glow. That is right for the towers and wrong for a monument
     standing among them: an Arc de Triomphe in the near layer's own
     values is a black rectangle with a black hole in it.

     Real ones are floodlit, which is the excuse and also the reason.
     Every body colour is pulled a third of the way toward the layer's
     brightest structural value, so the monument sits a clear step
     above the towers either side of it and its silhouette survives —
     without leaving the palette, which is what a hardcoded stone
     colour would do. */
  function mStone(o, amt) {
    const t = amt == null ? 0.34 : amt
    return {
      ...o,
      fill: mix(o.fill, o.window, t, 24),
      lit: mix(o.lit, o.window, Math.min(1, t + 0.18), 24),
      dark: mix(o.dark, o.window, t * 0.45, 24),
    }
  }

  /* An arch cut THROUGH something — the void, not the structure. Every
     triumphal arch, viaduct leg and cathedral door in here is this
     called with a different size. */
  function mArch(g, x, y, w, h, col) {
    const r = w / 2
    g.fillStyle = col
    for (let i = 0; i < w; i++) {
      const u = (i + 0.5 - r) / r
      const round = Math.round(Math.sqrt(Math.max(0, 1 - u * u)) * r)
      const topY = y + (r - round)
      g.fillRect(x + i, topY, 1, y + h - topY)
    }
  }

  /* ==================================================================
     NEW YORK
     ================================================================== */

  /* ---- the Empire State ----
     Two setbacks, a long shaft, and the mast. The mast is the whole
     recognition: without it this is a competent deco tower and with it
     there is only one building it can be. */
  function empireState(g, o, x, windows) {
    const b = SKYLINE
    // the five-storey base, filling the block
    mBox(g, o, x - 46, b - 54, 92, 54)
    mFlute(g, o, x - 46, b - 50, 92, 50, 4)
    // first setback
    mBox(g, o, x - 33, b - 92, 66, 40)
    mFlute(g, o, x - 33, b - 88, 66, 40, 4)
    // the shaft — the long run that makes it tall
    mBox(g, o, x - 19, b - 232, 38, 142)
    mFlute(g, o, x - 19, b - 228, 38, 140, 3)
    // upper setbacks, stepping to the observation floor
    mBox(g, o, x - 14, b - 258, 28, 28)
    mFlute(g, o, x - 14, b - 254, 28, 26, 3)
    mBox(g, o, x - 9, b - 274, 18, 18)

    // the observation deck's floodlit crown
    g.fillStyle = o.warm
    g.fillRect(x - 9, b - 274, 18, 1)
    g.fillRect(x - 14, b - 258, 28, 1)

    /* The mooring mast. Nothing was ever moored to it and it is the
       most famous hundred feet of steel in America. */
    mBox(g, o, x - 5, b - 296, 10, 24)
    g.fillStyle = o.lit
    for (let k = 0; k < 4; k++) g.fillRect(x - 6, b - 292 + k * 6, 12, 1)
    g.fillStyle = o.window
    g.fillRect(x - 1, b - 320, 2, 26)
    g.fillStyle = o.warm
    g.fillRect(x - 3, b - 302, 6, 2)
    if (windows) windows.push({ x: x - 1, y: b - 322, w: 2, h: 2, beacon: true })
  }

  /* ---- the Chrysler ----
     Seven stacked arches with triangular windows punched through them,
     and a needle. Nobody has ever built anything else that looks like
     this, which makes it the cheapest recognition in the file. */
  function chrysler(g, o, x, windows) {
    const b = SKYLINE
    const steel = '#cdd8e4'

    mBox(g, o, x - 30, b - 84, 60, 84)
    mFlute(g, o, x - 30, b - 80, 60, 80, 4)
    mBox(g, o, x - 21, b - 196, 42, 114)
    mFlute(g, o, x - 21, b - 192, 42, 112, 3)

    /* The crown. Each tier is a half-round of steel, narrowing as it
       rises, with a fan of triangular lights cut into it. Drawn from
       the bottom up so the tier above always overlaps the one below,
       which is what gives the scalloped edge. */
    let cw = 40
    let cy = b - 196
    for (let t = 0; t < 7; t++) {
      const hw = Math.round(cw / 2)
      const rise = Math.round(hw * 0.72)
      for (let i = 0; i < cw; i++) {
        const u = (i + 0.5 - hw) / hw
        const up = Math.round(Math.sqrt(Math.max(0, 1 - u * u)) * rise)
        if (up < 1) continue
        g.fillStyle = steel
        g.fillRect(x - hw + i, cy - up, 1, up + 1)
      }
      // the triangular windows, a fan of them per tier
      g.fillStyle = o.warm
      for (let k = -2; k <= 2; k++) {
        const wx = x + k * Math.max(3, Math.round(cw / 7))
        const u = (k * Math.max(3, cw / 7)) / hw
        const up = Math.round(Math.sqrt(Math.max(0, 1 - u * u)) * rise)
        for (let j = 1; j < Math.min(up - 1, 6); j++) {
          const half = Math.max(0, Math.floor((6 - j) / 2))
          g.fillRect(wx - half, cy - j, half * 2 + 1, 1)
        }
      }
      cy -= Math.round(rise * 0.62)
      cw -= 5
      if (cw < 9) break
    }

    // the needle
    g.fillStyle = steel
    g.fillRect(x - 1, cy - 44, 3, 46)
    g.fillRect(x - 2, cy - 20, 5, 2)
    if (windows) windows.push({ x: x, y: cy - 46, w: 2, h: 2, beacon: true })
  }

  /* ---- Liberty ----
     Small, out on the water, and the one thing in the frame that is a
     PERSON. The verdigris is not decoration: a green figure against a
     magenta city is the only colour note in the scene that cannot be
     mistaken for a neon sign. */
  function liberty(g, o, x) {
    const b = SKYLINE
    o = mStone(o, 0.28)
    const cu = '#5fae95'
    const cuLit = '#8fd8bd'
    const cuDark = '#2f6f5d'
    const stone = o.fill

    /* ---- the pedestal is doing a job ----

       She stands at SKYLINE like everything else in this layer, and
       the elevated line crosses fifty pixels above that — so at the
       real proportion (a short statue in front of tall towers) the
       whole figure sat behind a girder and only her arm cleared it.

       The plinth goes up instead of the statue getting bigger. That
       is the honest fix and it is also what the thing actually is:
       Bartholdi's statue is 46 metres and Hunt's pedestal under it is
       another 47. Doubling the pedestal puts her head at the top of
       the frame's near band, where a landmark belongs, without
       inflating a figure whose proportions are the recognition. */
    g.fillStyle = stone
    g.fillRect(x - 30, b - 16, 60, 16)
    g.fillStyle = o.lit
    g.fillRect(x - 30, b - 16, 60, 1)
    g.fillStyle = stone
    g.fillRect(x - 17, b - 86, 34, 70)
    g.fillStyle = o.lit
    g.fillRect(x - 17, b - 86, 34, 1)
    g.fillRect(x - 17, b - 86, 1, 70)
    g.fillStyle = o.dark
    g.fillRect(x + 16, b - 86, 1, 70)
    // the recessed bays down its faces
    for (let k = 0; k < 4; k++) {
      g.fillStyle = o.dark
      g.fillRect(x - 12 + k * 8, b - 74, 3, 20)
    }
    g.fillStyle = o.lit
    g.fillRect(x - 19, b - 50, 38, 2)
    g.fillStyle = o.warm
    for (let k = 0; k < 5; k++) g.fillRect(x - 16 + k * 8, b - 20, 2, 2)

    const f = b - 86 // the figure stands here
    // robe — wider at the hem, gathered at the waist
    g.fillStyle = cu
    g.fillRect(x - 8, f - 12, 16, 12)
    g.fillRect(x - 6, f - 26, 12, 14)
    g.fillStyle = cuDark
    g.fillRect(x + 5, f - 26, 2, 26)
    g.fillRect(x - 2, f - 24, 1, 22) // a fold
    g.fillStyle = cuLit
    g.fillRect(x - 8, f - 12, 1, 12)
    g.fillRect(x - 6, f - 26, 1, 14)

    // head, and the seven-point crown
    g.fillStyle = cu
    g.fillRect(x - 2, f - 32, 5, 6)
    g.fillStyle = cuLit
    for (let k = 0; k < 7; k++) {
      const a = (k / 6 - 0.5) * 2.2
      g.fillRect(Math.round(x + Math.sin(a) * 7), Math.round(f - 34 - Math.cos(a) * 4), 1, 3)
    }

    // the tablet, held low on the left
    g.fillStyle = cuDark
    g.fillRect(x - 12, f - 20, 6, 9)
    g.fillStyle = cuLit
    g.fillRect(x - 12, f - 20, 6, 1)

    // and the arm, raised, with the torch alight on the end of it
    g.fillStyle = cu
    g.fillRect(x + 5, f - 40, 3, 16)
    g.fillStyle = cuLit
    g.fillRect(x + 5, f - 40, 1, 16)
    g.fillStyle = cuDark
    g.fillRect(x + 4, f - 44, 5, 4)
    g.fillStyle = '#ffd27a'
    g.fillRect(x + 5, f - 50, 3, 6)
    g.fillStyle = '#fff3c0'
    g.fillRect(x + 6, f - 52, 1, 4)
    glow(g, x + 4, f - 52, 5, 8, 16, '#ffd27a', 1.4)
  }

  /* ==================================================================
     TOKYO — and it is April, at night
     ================================================================== */

  /* ---- Tokyo Tower ----
     Eiffel's shape in Eiffel's proportions, painted international
     orange and white because aviation law said so, which is the
     detail that separates the two towers at a glance. */
  function tokyoTower(g, o, x, windows) {
    const HGT = 250
    const top = SKYLINE - HGT
    const red = '#e2543a'
    const redDark = '#96311f'
    const white = '#efe6de'

    // banding: the legs alternate every bay, which is the paint scheme
    let band = 0
    const halfAt = (t) => 4 + Math.pow(t, 2.2) * 44
    for (let by = 0; by < HGT; by += 12) {
      const col = band % 2 ? white : red
      mTower(
        g, o, x, top + by, Math.min(12, HGT - by),
        (u) => halfAt((by + u * 12) / HGT),
        col, band % 2 ? red : redDark, 12,
      )
      band++
    }

    // the main observatory — a square deck two thirds of the way down
    const dy = top + Math.round(HGT * 0.62)
    g.fillStyle = redDark
    g.fillRect(x - 26, dy, 52, 16)
    g.fillStyle = white
    g.fillRect(x - 26, dy, 52, 1)
    g.fillRect(x - 26, dy + 4, 52, 2)
    g.fillStyle = '#ffd88a'
    for (let k = 0; k < 12; k++) g.fillRect(x - 23 + k * 4, dy + 8, 2, 4)

    // the special observatory, smaller, higher
    const sy = top + Math.round(HGT * 0.3)
    g.fillStyle = redDark
    g.fillRect(x - 13, sy, 26, 10)
    g.fillStyle = white
    g.fillRect(x - 13, sy, 26, 1)
    g.fillStyle = '#ffd88a'
    for (let k = 0; k < 6; k++) g.fillRect(x - 10 + k * 4, sy + 4, 2, 3)

    // the antenna
    g.fillStyle = red
    g.fillRect(x - 1, top - 34, 3, 36)
    g.fillStyle = white
    g.fillRect(x - 2, top - 20, 5, 2)
    if (windows) windows.push({ x: x, y: top - 36, w: 2, h: 2, beacon: true })
  }

  /* ---- the Skytree ----
     Twice the tower's height and a completely different object: a
     tapering shaft that starts as a triangle and finishes as a
     cylinder, with two glass discs threaded onto it. Lit lilac, which
     is what it actually does at night. */
  function skytree(g, o, x, windows) {
    /* 300, not the 330 it wants to be. The canvas is cropped from the
       TOP on a wide viewport — object-position sits it at 72% — and
       the tallest thing in the file is the one that finds that edge.
       A Skytree with its mast cut off is not a taller Skytree, it is a
       mistake, so it stops where the crop starts. */
    const HGT = 300
    const top = SKYLINE - HGT
    const lit = '#c8b4ff'
    const steel = '#8a86b0'

    // the shaft: wide splayed feet pulling in fast, then near-parallel
    mTower(
      g, o, x, top + 40, HGT - 40,
      (t) => 4 + Math.pow(t, 3.4) * 30,
      steel, lit, 12,
    )

    // the two observation decks
    const deck = (dy, dw, dh) => {
      g.fillStyle = steel
      g.fillRect(x - dw, dy, dw * 2, dh)
      g.fillStyle = lit
      g.fillRect(x - dw, dy, dw * 2, 1)
      g.fillRect(x - dw, dy + dh - 1, dw * 2, 1)
      g.fillStyle = '#e8ddff'
      /* dw is the deck's HALF width, and the mullions step three
         pixels at a time — so looping dw times ran the last one out to
         x + 2*dw, about a deck's width past the right hand edge and
         into open sky. Two decks, two lines coming out of the tower.
         Count the slots the deck actually has room for. */
      const slots = Math.floor((dw * 2 - 4) / 3)
      for (let k = 0; k < slots; k++) g.fillRect(x - dw + 2 + k * 3, dy + 2, 1, dh - 4)
    }
    deck(top + 96, 19, 14)
    deck(top + 40, 12, 10)

    // the gain tower — a long thin needle, the top third of the thing
    g.fillStyle = steel
    g.fillRect(x - 2, top, 4, 44)
    g.fillStyle = lit
    g.fillRect(x - 2, top, 1, 44)
    g.fillStyle = '#ffffff'
    g.fillRect(x - 1, top - 18, 2, 20)
    if (windows) windows.push({ x: x - 1, y: top - 20, w: 2, h: 2, beacon: true })
    glow(g, x - 3, top, 6, 120, 18, lit, 0.9)
  }

  /* ---- a torii ----
     Two posts and two beams. The top beam curves up at the ends and
     overshoots the posts, the second one does not, and that difference
     is the entire gate. */
  function torii(g, o, x, y, scale) {
    const s = scale || 1
    const ph = Math.round(46 * s)
    const pw = Math.max(2, Math.round(5 * s))
    const span = Math.round(30 * s)
    const red = '#d8402f'
    const redLit = '#f07a5c'
    const redDark = '#8c2418'

    g.fillStyle = red
    g.fillRect(x - span, y - ph, pw, ph)
    g.fillRect(x + span - pw, y - ph, pw, ph)
    g.fillStyle = redLit
    g.fillRect(x - span, y - ph, 1, ph)
    g.fillRect(x + span - pw, y - ph, 1, ph)

    // the nuki — the lower, plain beam
    g.fillStyle = redDark
    g.fillRect(x - span - 2, y - ph + Math.round(12 * s), span * 2 + 4, Math.max(2, Math.round(3 * s)))

    // the kasagi — upper beam, swept up at both ends
    const bh = Math.max(2, Math.round(4 * s))
    const ov = Math.round(9 * s)
    g.fillStyle = red
    g.fillRect(x - span - ov, y - ph - bh, span * 2 + ov * 2, bh)
    g.fillStyle = redLit
    g.fillRect(x - span - ov, y - ph - bh, span * 2 + ov * 2, 1)
    // the sweep: the ends lift a pixel or two
    g.fillStyle = red
    g.fillRect(x - span - ov, y - ph - bh - 2, Math.round(8 * s), 2)
    g.fillRect(x + span + ov - Math.round(8 * s), y - ph - bh - 2, Math.round(8 * s), 2)
    // and the shimaki tucked under it
    g.fillStyle = redDark
    g.fillRect(x - span - Math.round(4 * s), y - ph, span * 2 + Math.round(8 * s), 2)
  }

  /* ---- a cherry tree in flower ----

     The hard part of blossom at this size is that it is neither a
     shape nor a texture — a solid pink blob is a lollipop and scattered
     pink pixels are noise. What works is clumps: three or four dense
     clusters with dark gaps between them, each one lit on its upper
     left, so the canopy reads as mass with light coming through it. */
  /* ---- the cherry tree ----
     It was five filled circles round a fork: a blob, and at this size
     a blob of pink is a bush, a cloud or a smudge depending on what
     you were expecting.

     A tree reads as a tree because of its BRANCHING — a trunk that
     divides, divides again, and thins as it goes — and blossom reads
     as blossom because it is made of separate flowers with gaps of
     sky between them, not a continuous field of pink.

     So this draws the structure first: a tapering trunk, then limbs
     recursed three deep with a deterministic wobble on each, and the
     tips collected as it goes. Then every tip gets a handful of
     florets, and a floret is an actual five-petal flower — four petals
     round a hot centre — rather than a pixel of pink. A few leaves go
     in among them, because a cherry in full flower still has some.

     Nothing here rolls a die: the wobble and the scatter are both
     functions of position, so the same tree comes back every build. */
  function sakuraTree(g, o, x, y, scale) {
    const s = scale || 1
    const bark = '#43293f'
    const barkLit = '#63415c'
    const barkDark = '#251529'
    const pink = '#f2a8c8'
    const pinkLit = '#ffe0ee'
    const pinkDark = '#bf6690'
    const heart = '#ff6fa6'
    const leaf = '#5f8a55'
    const leafDark = '#3c5c38'

    const tips = []

    /* One limb, walked a pixel at a time so it can taper and bend.
       The bend is a hash of how far along it is, which keeps it
       deterministic and stops every branch being a straight ruled
       line. */
    function limb(bx, by, ang, len, th, depth) {
      let cx = bx
      let cy = by
      let a = ang
      for (let k = 0; k < len; k++) {
        const t = k / len
        const w = Math.max(1, Math.round(th * (1 - t * 0.75)))
        a += ((((k * 13 + depth * 29 + Math.round(bx)) % 7) - 3) * 0.016)
        cx += Math.cos(a)
        cy += Math.sin(a)
        const px = Math.round(cx)
        const py = Math.round(cy)
        g.fillStyle = bark
        g.fillRect(px, py, w, 1)
        g.fillStyle = w > 1 ? barkLit : bark
        g.fillRect(px, py, 1, 1)
        if (w > 2) {
          g.fillStyle = barkDark
          g.fillRect(px + w - 1, py, 1, 1)
        }
      }
      if (depth > 0) {
        limb(cx, cy, a - 0.42 - depth * 0.06, len * 0.66, th * 0.62, depth - 1)
        limb(cx, cy, a + 0.38 + depth * 0.07, len * 0.62, th * 0.62, depth - 1)
        // a third, shorter shoot on the bigger forks, so it is not a Y
        if (depth > 1) limb(cx, cy, a - 0.05, len * 0.5, th * 0.5, depth - 1)
      } else {
        tips.push([cx, cy])
      }
    }

    /* A single flower: four petals round a lit centre. At s=1 that is
       three pixels across, which is the smallest thing that still
       reads as a flower rather than as a dot. */
    function floret(px, py, tone, big) {
      g.fillStyle = tone
      g.fillRect(px, py - 1, 1, 1)
      g.fillRect(px - 1, py, 1, 1)
      g.fillRect(px + 1, py, 1, 1)
      g.fillRect(px, py + 1, 1, 1)
      if (big) {
        g.fillRect(px - 1, py - 1, 1, 1)
        g.fillRect(px + 1, py + 1, 1, 1)
      }
      g.fillStyle = heart
      g.fillRect(px, py, 1, 1)
    }

    // the trunk, tapering, with a lit side
    const th = Math.round(30 * s)
    const tw = Math.max(2, Math.round(5 * s))
    for (let k = 0; k < th; k++) {
      const w = Math.max(2, Math.round(tw * (1 - (k / th) * 0.45)))
      const px = x - Math.round(w / 2) + Math.round(Math.sin(k * 0.12) * s)
      g.fillStyle = bark
      g.fillRect(px, y - k, w, 1)
      g.fillStyle = barkLit
      g.fillRect(px, y - k, 1, 1)
      g.fillStyle = barkDark
      g.fillRect(px + w - 1, y - k, 1, 1)
    }
    // roots flaring into the ground
    g.fillStyle = barkDark
    g.fillRect(x - Math.round(5 * s), y - 1, Math.round(10 * s), 1)

    // three main limbs out of the fork, recursed
    const fy = y - th
    limb(x, fy, -Math.PI / 2 - 0.55, 13 * s, 3.2 * s, 2)
    limb(x, fy, -Math.PI / 2 + 0.5, 12 * s, 3.2 * s, 2)
    limb(x, fy, -Math.PI / 2 - 0.02, 15 * s, 3.4 * s, 2)

    /* Blossom on the tips. Each tip carries a small cloud of florets
       scattered around it — offset by a hash of the tip's own position
       so the clusters differ from each other — and the tone steps with
       height, lit at the crown and deeper underneath. */
    for (let i = 0; i < tips.length; i++) {
      const [tx, ty] = tips[i]
      const n = 7 + (i % 3) * 2
      for (let k = 0; k < n; k++) {
        const h = (i * 37 + k * 61) % 100
        const h2 = (i * 53 + k * 29) % 100
        const dx = Math.round(((h / 100) * 2 - 1) * 5.5 * s)
        const dy = Math.round(((h2 / 100) * 2 - 1) * 5 * s)
        const px = Math.round(tx) + dx
        const py = Math.round(ty) + dy
        // a few leaves in among the flowers
        if (h % 11 === 0) {
          g.fillStyle = h2 % 2 ? leaf : leafDark
          g.fillRect(px, py, 2, 1)
          g.fillRect(px + 1, py - 1, 1, 1)
          continue
        }
        const tone = dy < -2 ? pinkLit : dy > 2 ? pinkDark : pink
        floret(px, py, tone, s >= 1 && h % 3 === 0)
      }
    }

    /* A couple of petals already off the tree, falling. The blossom
       only reads as blossom if it is visibly losing. */
    g.fillStyle = pinkLit
    g.fillRect(x + Math.round(9 * s), y - Math.round(12 * s), 1, 1)
    g.fillRect(x - Math.round(12 * s), y - Math.round(7 * s), 1, 1)
    g.fillStyle = pink
    g.fillRect(x + Math.round(4 * s), y - Math.round(4 * s), 1, 1)
  }

  /* ---- the precinct ----

     The blossom was on the ground, at SKYLINE, which is where blossom
     is. It was also entirely behind the elevated line, which crosses
     at VIA_Y and is fifty pixels higher — so the whole thing read as a
     few pink specks under a girder.

     Temples in Tokyo are on platforms, so the platform is the fix and
     it is not a cheat: a stone terrace at rooftop height, a torii on
     the steps up to it, trees along it and a string of lanterns
     between them. It sits among the near layer's roofs, clears the
     viaduct, and puts the one thing this city is FOR at a height where
     you can see it. */
  function precinct(g, o, x, w) {
    const y = SKYLINE - 76
    const hw = Math.round(w / 2)
    const s = mStone(o, 0.30)

    // the terrace, on a run of stone piers
    g.fillStyle = s.dark
    for (let px = x - hw + 4; px < x + hw - 4; px += 13) {
      g.fillRect(px, y + 6, 5, SKYLINE - y - 6)
    }
    g.fillStyle = s.fill
    g.fillRect(x - hw, y, w, 7)
    g.fillStyle = s.lit
    g.fillRect(x - hw, y, w, 1)
    g.fillStyle = s.dark
    g.fillRect(x - hw, y + 6, w, 1)

    // a low balustrade along the front
    g.fillStyle = s.lit
    g.fillRect(x - hw, y - 5, w, 1)
    g.fillStyle = s.dark
    for (let px = x - hw + 2; px < x + hw - 1; px += 5) g.fillRect(px, y - 4, 1, 4)

    // and what stands on it
    torii(g, o, x - Math.round(hw * 0.52), y - 5, 0.66)
    sakuraTree(g, o, x + Math.round(hw * 0.12), y - 5, 0.92)
    sakuraTree(g, o, x + Math.round(hw * 0.62), y - 5, 0.74)
    lanterns(g, o, x - hw + 6, y - 62, Math.max(3, Math.floor(w / 22)), 6)
  }

  /* A string of paper lanterns, which is what a Japanese street under
     blossom is actually lit by. */
  function lanterns(g, o, x, y, n, drop) {
    const warm = '#ffcf7a'
    const warmDark = '#c07030'
    g.fillStyle = o.dark
    for (let k = 0; k < n * 14; k++) {
      g.fillRect(x + k, y + Math.round(Math.sin((k / (n * 14)) * Math.PI) * (drop || 6)), 1, 1)
    }
    for (let k = 0; k < n; k++) {
      const lx = x + 6 + k * 14
      const ly = y + Math.round(Math.sin(((k * 14 + 6) / (n * 14)) * Math.PI) * (drop || 6)) + 2
      g.fillStyle = warmDark
      g.fillRect(lx - 3, ly, 7, 9)
      g.fillStyle = warm
      g.fillRect(lx - 2, ly + 1, 5, 7)
      g.fillStyle = '#fff0c8'
      g.fillRect(lx - 1, ly + 2, 2, 5)
      glow(g, lx - 3, ly, 7, 9, 10, warm, 0.8)
    }
  }

  /* ==================================================================
     NEW DELHI
     ================================================================== */

  /* ---- India Gate ----
     One great archway of sandstone, taller than it is wide, with a heavy
     cornice and a shallow saucer where the never-built cupola would have
     gone. The flame beneath the arch is the Amar Jawan Jyoti. */

  /* ==================================================================
     TOKYO, UP CLOSE

     The monuments were never the problem. Tokyo Tower and the Skytree
     were already standing in layer 2, and you could still fail to name
     the city, because a landmark is one building and the other four
     hundred were the same generic mat every other city here is made
     of.

     What actually makes a Tokyo street read as Tokyo is the clutter on
     it: the overhead cable, strung pole to pole because almost nothing
     is buried; the steel water tank up on legs on every mid-rise roof;
     the external stair bolted to the outside of the building because
     the plot was too narrow to put one inside. None of those are
     landmarks. All of them are unmistakable.

     So this section is furniture, and it is drawn ACROSS the layers
     rather than at one spot — which is the point. A landmark you look
     at; furniture you read the city through.
     ================================================================== */

  /* ---- the water tank ----
     A steel box up on four legs with a ladder bolted up one side. It
     is the single most common object on a Japanese roofline and the
     cheapest way to say which country a rooftop is in. */
  function waterTank(g, o, x, y, s) {
    const w = Math.round(16 * s)
    const h = Math.round(11 * s)
    const leg = Math.round(7 * s)
    const hw = Math.round(w / 2)

    // the legs, and the shadow between them
    g.fillStyle = o.dark
    g.fillRect(x - hw + 1, y - leg, 2, leg)
    g.fillRect(x + hw - 3, y - leg, 2, leg)
    g.fillRect(x - 1, y - leg, 2, leg)

    // the tank
    const top = y - leg - h
    g.fillStyle = o.fill
    g.fillRect(x - hw, top, w, h)
    g.fillStyle = o.lit
    g.fillRect(x - hw, top, w, 1)
    g.fillRect(x - hw, top, 1, h)
    g.fillStyle = o.dark
    g.fillRect(x + hw - 1, top, 1, h)
    g.fillRect(x - hw, top + h - 1, w, 1)
    // the seam round its middle, and the hatch on top
    g.fillStyle = o.dark
    g.fillRect(x - hw, top + Math.round(h / 2), w, 1)
    g.fillRect(x - 2, top - 2, 5, 2)

    // the ladder
    g.fillStyle = o.dark
    for (let k = 1; k < h + leg; k += 3) g.fillRect(x + hw, y - k, 3, 1)
    g.fillRect(x + hw + 2, top, 1, h + leg)
  }



  /* ---- the stair on the outside ----
     Put the stair outside and the whole floorplate is rentable. Half
     the mid-rise in this city is built that way, and the zigzag it
     leaves on the flank is as good as a label. */
  function stairRun(g, o, x, base, h, dir) {
    const runH = 9
    let y = base
    let flip = 0
    while (y > base - h + runH) {
      const x0 = dir > 0 ? x : x - 12
      // the flight, stepped
      g.fillStyle = o.dark
      for (let k = 0; k < 6; k++) {
        const sx = flip ? x0 + 10 - k * 2 : x0 + k * 2
        g.fillRect(sx, y - k * 1.5 | 0, 3, 1)
      }
      // the landing
      g.fillStyle = o.dark
      g.fillRect(x0, y - runH, 13, 2)
      g.fillStyle = o.lit
      g.fillRect(x0, y - runH, 13, 1)
      // the rail
      g.fillStyle = o.dark
      g.fillRect(dir > 0 ? x0 + 12 : x0, y - runH - 5, 1, 5)
      y -= runH
      flip ^= 1
    }
  }

  /* ---- the vending machine ----
     Lit, always on, and standing on its own in the dark at the mouth
     of an alley. There are five and a half million of them out there;
     one of them may as well be in shot. */
  function vending(g, o, x, base) {
    const w = 9
    const h = 15
    g.fillStyle = o.dark
    g.fillRect(x - 1, base - h - 1, w + 2, h + 1)
    // the lit face
    g.fillStyle = o.window
    g.fillRect(x, base - h, w, h - 4)
    // rows of cans, read as dark notches in the light
    g.fillStyle = o.dark
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) {
        g.fillRect(x + 1 + c * 3, base - h + 2 + r * 4, 2, 2)
      }
    }
    // the tray at the foot, and the light it throws on the pavement
    g.fillStyle = o.dark
    g.fillRect(x, base - 4, w, 3)
    glow(g, x - 4, base - h - 2, w + 8, h + 6, 14, o.window, 0.5)
  }

  /* ---- the twin towers at Shinjuku ----
     The Metropolitan Government Building. A broad plinth that splits
     into two square towers with a lattice of window banding right up
     both of them — and the split is the whole recognition. Nothing
     else on this skyline forks. */
  function metroGov(g, o, x, windows) {
    const H = 232
    const base = SKYLINE
    const plinthH = 96
    const pw = 76

    // the plinth
    g.fillStyle = o.fill
    g.fillRect(x - pw / 2, base - plinthH, pw, plinthH)
    g.fillStyle = o.lit
    g.fillRect(x - pw / 2, base - plinthH, 2, plinthH)
    g.fillStyle = o.dark
    g.fillRect(x + pw / 2 - 2, base - plinthH, 2, plinthH)

    // the two shafts
    const tw = 30
    const gap = 12
    for (const side of [-1, 1]) {
      const tx = x + side * (gap / 2 + tw / 2) - tw / 2
      const top = base - H
      g.fillStyle = o.fill
      g.fillRect(tx, top, tw, H - plinthH + 4)
      g.fillStyle = o.lit
      g.fillRect(tx, top, 2, H - plinthH + 4)
      g.fillStyle = o.dark
      g.fillRect(tx + tw - 2, top, 2, H - plinthH + 4)
      // the lattice: paired vertical piers with lit slots between them
      for (let cx = tx + 4; cx < tx + tw - 4; cx += 7) {
        g.fillStyle = o.dark
        g.fillRect(cx, top + 4, 2, H - plinthH - 6)
      }
      for (let cy = top + 8; cy < base - plinthH; cy += 6) {
        g.fillStyle = o.dark
        g.fillRect(tx + 3, cy, tw - 6, 1)
        if (windows && ((cy + tx) % 17) < 6) {
          g.fillStyle = o.window
          g.fillRect(tx + 4, cy + 2, 4, 3)
        }
      }
      // the aerial masts
      g.fillStyle = o.dark
      g.fillRect(tx + tw / 2 - 1, top - 12, 2, 12)
      g.fillStyle = o.warm
      g.fillRect(tx + tw / 2 - 1, top - 13, 2, 2)
    }
  }

  /* ---- the cocoon ----
     Mode Gakuen at Nishi-Shinjuku: an egg standing on end, wrapped in
     a diagonal lattice with three vertical cuts let into it. Drawn as
     a true ellipse rather than a tapered box, because the taper IS the
     building. */
  function cocoon(g, o, x, windows) {
    const H = 168
    const RW = 21
    const base = SKYLINE
    const top = base - H
    for (let y = 0; y < H; y++) {
      const t = y / H
      // fat in the middle, drawn in at both ends, flat where it meets
      // the ground
      const w = Math.round(RW * Math.sin(Math.PI * Math.pow(t, 0.86)) + 5)
      const yy = top + y
      g.fillStyle = o.fill
      g.fillRect(x - w, yy, w * 2, 1)
      g.fillStyle = o.lit
      g.fillRect(x - w, yy, 2, 1)
      g.fillStyle = o.dark
      g.fillRect(x + w - 2, yy, 2, 1)
      // the diagonal lattice, both ways
      if ((yy + x) % 5 === 0) {
        g.fillStyle = o.dark
        for (let k = -w; k < w; k += 5) g.fillRect(x + k, yy, 2, 1)
      }
      // and the three vertical cuts
      if (windows && y > 10 && y < H - 14 && yy % 3 === 0) {
        g.fillStyle = o.window
        g.fillRect(x - 1, yy, 2, 1)
        if (w > 12) {
          g.fillRect(x - w + 5, yy, 2, 1)
          g.fillRect(x + w - 7, yy, 2, 1)
        }
      }
    }
  }

  /* ---- the one in the bay ----
     A shape rising out of the water between two far towers, lit from
     below by the city it is looking at. Never explained, never
     animated, and gone the moment you change city. */
  function kaiju(g, o, x, base) {
    const H = 54
    const top = base - H
    g.fillStyle = o.dark
    // tail into the water, then the back
    g.fillRect(x - 34, base - 6, 22, 3)
    g.fillRect(x - 20, base - 10, 16, 5)
    g.fillRect(x - 10, base - 26, 18, 20)
    // the neck and head
    g.fillRect(x + 2, top + 8, 9, 20)
    g.fillRect(x + 4, top, 14, 10)
    g.fillRect(x + 16, top + 3, 4, 4)
    // dorsal plates
    for (let k = 0; k < 5; k++) {
      g.fillRect(x - 10 + k * 4, base - 30 - k, 3, 5)
    }
    // the eye, and the light coming up off the water
    g.fillStyle = o.warm
    g.fillRect(x + 13, top + 4, 2, 2)
    glow(g, x - 30, base - 12, 60, 10, 16, o.neon || o.warm, 0.30)
  }

  function indiaGate(g, o, x) {
    const b = SKYLINE
    o = mStone(o)
    const w = 62
    const h = 94
    // the pylon
    mBox(g, o, x - w / 2, b - h, w, h)
    // the one great arch, tall and narrow
    mArch(g, x - 16, b - 76, 32, 76, o.dark)
    // string courses across the piers
    g.fillStyle = o.lit
    g.fillRect(x - w / 2, b - 76, w, 1)
    g.fillStyle = o.dark
    g.fillRect(x - w / 2, b - 40, w, 1)
    // the deep cornice
    g.fillStyle = o.fill
    g.fillRect(x - w / 2 - 4, b - h - 9, w + 8, 9)
    g.fillStyle = o.lit
    g.fillRect(x - w / 2 - 4, b - h - 9, w + 8, 1)
    g.fillStyle = o.dark
    for (let k = 0; k < 9; k++) g.fillRect(x - 27 + k * 7, b - h - 6, 3, 5)
    // the shallow saucer where the cupola never went
    mDome(g, o, x - 12, b - h - 9, 24, 8, o.lit)
    // the eternal flame under the arch
    g.fillStyle = '#ffb03c'
    g.fillRect(x - 1, b - 6, 3, 5)
    g.fillStyle = '#ffd27a'
    g.fillRect(x - 1, b - 9, 2, 3)
    glow(g, x - 4, b - 12, 8, 10, 14, '#ffb03c', 1.2)
  }

  /* ---- the Qutub Minar ----
     The tallest brick minaret in the world: five storeys that taper as
     they climb, each ending in a corbelled balcony that throws a ring of
     shadow, the lower shafts fluted. A small cupola sits on the summit. */
  function qutubMinar(g, o, x, windows) {
    const b = SKYLINE
    o = mStone(o, 0.42)
    const heights = [56, 46, 38, 30, 24]
    const total = heights.reduce((a, c) => a + c, 0)
    const baseHW = 17
    const topHW = 5
    const hwAt = (yUp) => baseHW - (baseHW - topHW) * (yUp / total)
    let cy = b
    for (let s = 0; s < heights.length; s++) {
      const hs = heights[s]
      // the tapering shaft of this storey
      for (let k = 0; k < hs; k++) {
        const hw = Math.round(hwAt(b - cy + k))
        const yr = cy - k
        g.fillStyle = o.fill
        g.fillRect(x - hw, yr, hw * 2, 1)
        g.fillStyle = o.lit
        g.fillRect(x - hw, yr, 1, 1)
        g.fillStyle = o.dark
        g.fillRect(x + hw - 1, yr, 1, 1)
      }
      // fluting on the lower three storeys
      if (s < 3) {
        const hwBot = Math.round(hwAt(b - cy))
        g.fillStyle = o.dark
        for (let fx = -hwBot + 3; fx < hwBot - 3; fx += 3) g.fillRect(x + fx, cy - hs, 1, hs)
      }
      // the corbelled balcony ring at the top of the storey
      const hwBal = Math.round(hwAt(b - cy + hs)) + 3
      g.fillStyle = o.dark
      for (let k = 0; k < hwBal * 2; k += 2) g.fillRect(x - hwBal + k, cy - hs - 1, 1, 1)
      g.fillStyle = o.lit
      g.fillRect(x - hwBal, cy - hs, hwBal * 2, 2)
      g.fillStyle = o.dark
      g.fillRect(x - hwBal, cy - hs + 2, hwBal * 2, 1)
      cy -= hs
    }
    // the cupola on the summit
    mDome(g, o, x - 5, cy, 10, 6, o.lit)
    g.fillStyle = o.window
    g.fillRect(x - 1, cy - 12, 2, 6)
    if (windows) windows.push({ x: x - 1, y: cy - 13, w: 2, h: 2, beacon: true })
  }

  /* ---- Humayun's Tomb ----
     The first of the great Mughal garden-tombs and the rehearsal for the
     Taj: an arcaded red-sandstone plinth, a cubic tomb with one tall
     central iwan, and a bulbous white-marble dome on a drum under a
     gilded finial, with a pair of chhatris on the roof. */
  function mughalTomb(g, o, x, windows) {
    const b = SKYLINE
    o = mStone(o, 0.36)
    const marble = '#e8e2d4'
    const mo = { fill: marble, lit: '#fbf6ea', dark: '#b6ab98', warm: o.warm }

    // the arcaded plinth
    const pw = 128
    const ph = 20
    mBox(g, o, x - pw / 2, b - ph, pw, ph)
    for (let k = -2; k <= 2; k++) mArch(g, x + k * 25 - 7, b - ph + 4, 14, ph - 4, o.dark)

    // the tomb cube, with the great central iwan
    const cw = 84
    const chh = 52
    mBox(g, o, x - cw / 2, b - ph - chh, cw, chh)
    mArch(g, x - 15, b - ph - chh + 10, 30, chh - 10, o.dark)
    // a pointed tip breaking up over the iwan
    g.fillStyle = o.dark
    for (let k = 0; k < 7; k++) {
      g.fillRect(x - 7 + k, b - ph - chh + 10 - (7 - k), 1, 7 - k)
      g.fillRect(x + 7 - k, b - ph - chh + 10 - (7 - k), 1, 7 - k)
    }
    // recessed arches either side
    mArch(g, x - cw / 2 + 6, b - ph - 24, 12, 22, o.dark)
    mArch(g, x + cw / 2 - 18, b - ph - 24, 12, 22, o.dark)
    // a marble cornice on the cube
    g.fillStyle = marble
    g.fillRect(x - cw / 2, b - ph - chh, cw, 2)

    // the drum
    const drumTop = b - ph - chh - 14
    g.fillStyle = marble
    g.fillRect(x - 28, drumTop, 56, 14)
    g.fillStyle = mo.lit
    g.fillRect(x - 28, drumTop, 56, 1)
    g.fillStyle = mo.dark
    for (let k = 0; k < 7; k++) g.fillRect(x - 24 + k * 7, drumTop + 3, 2, 9)

    // the bulbous dome and its pinched collar
    const domeW = 60
    mDome(g, mo, x - domeW / 2, drumTop, domeW, 44, marble)
    g.fillStyle = mo.dark
    g.fillRect(x - domeW / 2 + 3, drumTop - 2, domeW - 6, 2)

    // the gilded finial
    const dtop = drumTop - 44
    g.fillStyle = marble
    g.fillRect(x - 3, dtop - 5, 6, 5)
    g.fillStyle = '#ffd27a'
    g.fillRect(x - 1, dtop - 16, 2, 11)
    g.fillRect(x - 3, dtop - 13, 6, 1)
    glow(g, x - 4, dtop - 18, 8, 9, 12, '#ffd27a', 0.9)

    // the two roof chhatris
    for (const dx of [-38, 38]) {
      g.fillStyle = marble
      g.fillRect(x + dx - 6, b - ph - chh - 11, 2, 11)
      g.fillRect(x + dx + 4, b - ph - chh - 11, 2, 11)
      g.fillStyle = mo.dark
      g.fillRect(x + dx - 7, b - ph - chh - 12, 14, 1)
      mDome(g, mo, x + dx - 7, b - ph - chh - 11, 14, 9, marble)
      g.fillStyle = '#ffd27a'
      g.fillRect(x + dx - 1, b - ph - chh - 23, 2, 4)
    }
    if (windows) windows.push({ x: x - 1, y: dtop - 17, w: 2, h: 2, beacon: true })
  }

  /* ---- the Lotus Temple ----
     The Bahai House of Worship: twenty-seven marble petals in three
     tiers, which at this size is a fan of white points opening off a
     low podium. Floodlit, so it carries its own cool halo. */
  function lotusTemple(g, o, x) {
    const b = SKYLINE
    const marble = '#e6e6de'
    const marbleLit = '#fbfbf4'
    const marbleDark = '#aeaea4'
    // the podium
    o = mStone(o, 0.3)
    mBox(g, o, x - 46, b - 12, 92, 12)
    g.fillStyle = o.lit
    g.fillRect(x - 46, b - 12, 92, 1)
    // a petal: a pointed marble shard that tapers to a point and leans
    const petal = (px, ph, lean, wmax) => {
      for (let k = 0; k < ph; k++) {
        const f = k / ph
        const hw = Math.max(0, Math.round(wmax * (1 - f) * (1 - f * 0.35)))
        const cx = px + Math.round(lean * f)
        const yy = b - 10 - k
        g.fillStyle = marble
        g.fillRect(cx - hw, yy, hw * 2 + 1, 1)
        g.fillStyle = marbleLit
        g.fillRect(cx - hw, yy, 1, 1)
        g.fillStyle = marbleDark
        g.fillRect(cx + hw, yy, 1, 1)
      }
    }
    // back to front: the outer, leaning petals first
    petal(x - 30, 30, -16, 9)
    petal(x + 30, 30, 16, 9)
    petal(x - 17, 42, -11, 9)
    petal(x + 17, 42, 11, 9)
    petal(x - 8, 52, -5, 8)
    petal(x + 8, 52, 5, 8)
    petal(x, 60, 0, 8)
    glow(g, x - 34, b - 70, 68, 62, 26, '#dfeaff', 0.5)
  }

  /* Marigold torans — the strung garlands of marigold flowers and mango
     leaf that go up over every door and balcony for a festival. Same
     draped-string idea as the papel picado they replace. */
  function marigoldString(g, o, x, y, n) {
    const span = n * 13
    g.fillStyle = o.dark
    for (let k = 0; k < span; k++) g.fillRect(x + k, y + Math.round(Math.sin((k / span) * Math.PI) * 8), 1, 1)
    const orange = '#ff9a2a'
    const orangeLit = '#ffc75a'
    const leaf = '#3f9a4a'
    for (let k = 0; k < n; k++) {
      const fx = x + 2 + k * 13
      const fy = y + Math.round(Math.sin(((k * 13 + 6) / span) * Math.PI) * 8) + 2
      // a mango leaf tucked between the blooms
      g.fillStyle = leaf
      g.fillRect(fx + 5, fy, 2, 6)
      // the marigold bloom — a small stacked puff
      g.fillStyle = orange
      g.fillRect(fx + 1, fy + 5, 8, 6)
      g.fillRect(fx + 2, fy + 4, 6, 8)
      g.fillStyle = orangeLit
      g.fillRect(fx + 3, fy + 6, 2, 2)
      g.fillStyle = o.dark
      g.fillRect(fx + 4, fy + 8, 1, 1)
    }
  }

  /* ==================================================================
     PARIS
     ================================================================== */

  /* ---- the Eiffel Tower ----
     Four legs, two platforms and an arch, and the curve between them
     has to be right or it is a pylon. The skirt is a power of 2.4 —
     flatter than a cone at the top, flaring hard at the feet. */
  function eiffel(g, o, x, windows) {
    const HGT = 300
    const top = SKYLINE - HGT
    const iron = '#b08a5e'
    const ironLit = '#e0bd8a'
    const ironDark = '#6d5236'

    mTower(g, o, x, top + 34, HGT - 34, (t) => 3 + Math.pow(t, 2.4) * 54, iron, ironDark, 10)

    // the first platform, wide, with the restaurant lights under it
    const p1 = SKYLINE - 78
    g.fillStyle = ironLit
    g.fillRect(x - 50, p1, 100, 3)
    g.fillStyle = ironDark
    g.fillRect(x - 50, p1 + 3, 100, 5)
    g.fillStyle = '#ffd88a'
    for (let k = 0; k < 22; k++) g.fillRect(x - 46 + k * 4, p1 + 4, 2, 3)

    // the arch under it — the thing the whole design is about
    for (let i = -46; i <= 46; i++) {
      const u = i / 46
      const rise = Math.round(Math.sqrt(Math.max(0, 1 - u * u)) * 30)
      if (rise < 2) continue
      g.fillStyle = iron
      g.fillRect(x + i, p1 - rise, 1, 2)
    }

    // the second platform
    const p2 = SKYLINE - 168
    g.fillStyle = ironLit
    g.fillRect(x - 24, p2, 48, 2)
    g.fillStyle = ironDark
    g.fillRect(x - 24, p2 + 2, 48, 4)
    g.fillStyle = '#ffd88a'
    for (let k = 0; k < 11; k++) g.fillRect(x - 21 + k * 4, p2 + 3, 2, 2)

    // the top: the lantern, the little apartment, and the mast
    g.fillStyle = iron
    g.fillRect(x - 6, top + 20, 12, 16)
    g.fillStyle = '#ffe8a8'
    g.fillRect(x - 4, top + 24, 8, 5)
    g.fillStyle = ironLit
    g.fillRect(x - 4, top + 8, 8, 12)
    g.fillStyle = iron
    g.fillRect(x - 1, top - 22, 3, 30)
    g.fillStyle = '#fff6d0'
    g.fillRect(x - 1, top - 26, 3, 5)
    glow(g, x - 2, top - 26, 5, 6, 20, '#ffe8a8', 1.6)
    if (windows) windows.push({ x: x - 1, y: top - 26, w: 3, h: 3, beacon: true })
  }

  /* ---- the Arc de Triomphe ----
     One enormous void with a small amount of stone around it. Getting
     the proportion of the arch to the block right is the entire job;
     everything else is a moulding. */
  function arcDeTriomphe(g, o, x) {
    const b = SKYLINE
    o = mStone(o)
    const w = 76
    const h = 62
    mBox(g, o, x - w / 2, b - h, w, h)

    // the great arch, and the two small transverse ones
    mArch(g, x - 15, b - 52, 30, 52, o.dark)
    mArch(g, x - w / 2 + 4, b - 26, 12, 26, o.dark)
    mArch(g, x + w / 2 - 16, b - 26, 12, 26, o.dark)

    // the attic storey, and the shallow relief panels on it
    g.fillStyle = o.fill
    g.fillRect(x - w / 2 - 2, b - h - 8, w + 4, 8)
    g.fillStyle = o.lit
    g.fillRect(x - w / 2 - 2, b - h - 8, w + 4, 1)
    g.fillStyle = o.dark
    for (let k = 0; k < 8; k++) g.fillRect(x - 30 + k * 8, b - h - 6, 4, 5)

    // the sculptural groups either side of the arch
    g.fillStyle = o.lit
    g.fillRect(x - 26, b - 46, 8, 18)
    g.fillRect(x + 18, b - 46, 8, 18)
    g.fillStyle = o.dark
    g.fillRect(x - 24, b - 42, 2, 12)
    g.fillRect(x + 21, b - 42, 2, 12)

    // the eternal flame, under the arch
    g.fillStyle = '#ffb03c'
    g.fillRect(x - 1, b - 5, 3, 4)
    glow(g, x - 2, b - 7, 5, 6, 12, '#ffb03c', 1.1)
  }

  /* ---- Sacré-Cœur ----
     White, domed, and on a hill — so it is drawn ABOVE the skyline,
     sitting on its own ground, which is the only building in the file
     that gets to do that. */
  function sacreCoeur(g, o, x) {
    const b = SKYLINE - 26
    const white = '#e6e0d6'
    const shade = { fill: white, lit: '#fdf8ee', dark: '#a89f92', warm: o.warm }

    // the butte it stands on
    g.fillStyle = o.fill
    for (let i = -70; i <= 70; i++) {
      const rise = Math.round(Math.cos((i / 70) * 1.5) * 26)
      g.fillRect(x + i, b + 26 - rise, 1, rise + 4)
    }
    g.fillStyle = o.lit
    for (let i = -70; i <= 0; i++) {
      const rise = Math.round(Math.cos((i / 70) * 1.5) * 26)
      g.fillRect(x + i, b + 26 - rise, 1, 1)
    }

    // the body, with its arcade
    mBox(g, shade, x - 34, b - 26, 68, 26)
    g.fillStyle = shade.dark
    for (let k = 0; k < 5; k++) mArch(g, x - 30 + k * 13, b - 18, 9, 18, shade.dark)

    // the two small domes and the great one
    mDome(g, shade, x - 32, b - 26, 18, 14, white)
    mDome(g, shade, x + 14, b - 26, 18, 14, white)
    g.fillStyle = white
    g.fillRect(x - 14, b - 44, 28, 18)
    g.fillStyle = shade.lit
    g.fillRect(x - 14, b - 44, 28, 1)
    g.fillStyle = shade.dark
    for (let k = 0; k < 4; k++) g.fillRect(x - 10 + k * 7, b - 40, 3, 10)
    mDome(g, shade, x - 16, b - 44, 32, 26, white)
    g.fillStyle = shade.lit
    g.fillRect(x - 1, b - 76, 3, 6)

    // the campanile behind the right shoulder
    g.fillStyle = white
    g.fillRect(x + 32, b - 54, 12, 28)
    g.fillStyle = shade.dark
    g.fillRect(x + 35, b - 48, 6, 10)
    mDome(g, shade, x + 32, b - 54, 12, 9, white)
    glow(g, x - 36, b - 78, 82, 80, 20, '#fff2d8', 0.55)
  }

  /* ==================================================================
     DUBAI
     ================================================================== */

  /* ---- the Burj Khalifa ----
     A spiralling stack of setbacks that never stops narrowing, and
     then a spire that is a third of the building. The trick at this
     scale is that the setbacks must alternate sides — a symmetrical
     taper is just an obelisk. */
  function burjKhalifa(g, o, x, windows) {
    const b = SKYLINE
    const glassCol = '#7fd8e8'
    let w = 54
    let y = b
    let side = 0
    let cx = x
    for (let t = 0; t < 11; t++) {
      const h = 26 - t * 1.4
      const hh = Math.max(9, Math.round(h))
      mBox(g, o, cx - Math.round(w / 2), y - hh, w, hh)
      // vertical glazing — this tower is all fins
      g.fillStyle = glassCol
      for (let k = 2; k < w - 2; k += 3) {
        g.fillRect(cx - Math.round(w / 2) + k, y - hh + 2, 1, hh - 3)
      }
      g.fillStyle = o.lit
      g.fillRect(cx - Math.round(w / 2), y - hh, w, 1)
      y -= hh
      // step in, and shuffle the centre so the stack spirals
      w -= 4
      cx += side % 2 ? 2 : -1
      side++
      if (w < 8) break
    }
    // the spire
    g.fillStyle = o.window
    g.fillRect(cx - 2, y - 62, 4, 62)
    g.fillStyle = o.lit
    g.fillRect(cx - 2, y - 62, 1, 62)
    g.fillStyle = glassCol
    g.fillRect(cx - 1, y - 96, 2, 36)
    glow(g, cx - 3, y - 96, 6, 96, 16, glassCol, 0.8)
    if (windows) windows.push({ x: cx - 1, y: y - 98, w: 2, h: 2, beacon: true })
  }

  /* ---- the Burj Al Arab ----
     A mast, a spar and a sail. It is a hotel shaped like a boat and
     nothing else in any skyline resembles it. */
  function burjAlArab(g, o, x) {
    const b = SKYLINE
    const HGT = 150
    const top = b - HGT
    const sail = '#e8eef4'
    const sailDark = '#9aa8bc'

    // the spine — the leading edge, dead vertical
    g.fillStyle = o.fill
    g.fillRect(x - 16, top, 12, HGT)
    g.fillStyle = o.lit
    g.fillRect(x - 16, top, 1, HGT)
    g.fillStyle = o.window
    for (let y = top + 6; y < b - 4; y += 5) g.fillRect(x - 14, y, 8, 2)

    /* The sail: a single curve from the masthead down to the foot,
       filled toward the spine. Two arcs, actually — the trailing edge
       bellies out and the leading edge is straight. */
    for (let k = 0; k < HGT; k++) {
      const t = k / HGT
      const belly = Math.round(Math.sin(t * Math.PI * 0.92) * 40 + t * 8)
      g.fillStyle = sail
      g.fillRect(x - 4, top + k, belly, 1)
      g.fillStyle = sailDark
      g.fillRect(x - 4 + belly - 1, top + k, 1, 1)
      // the fabric panels
      if (k % 11 === 0) {
        g.fillStyle = sailDark
        g.fillRect(x - 4, top + k, belly, 1)
      }
    }
    // and the light behind it — the sail is backlit at night, always
    glow(g, x - 4, top, 42, HGT, 22, '#4ac8e0', 0.7)

    // the helipad off the top and the restaurant off the side
    g.fillStyle = o.lit
    g.fillRect(x - 30, top + 16, 16, 3)
    g.fillStyle = o.warm
    g.fillRect(x - 28, top + 14, 12, 2)
    g.fillStyle = o.fill
    g.fillRect(x + 34, top + 62, 16, 8)
    g.fillStyle = o.warm
    g.fillRect(x + 36, top + 64, 12, 4)

    // the causeway out to it
    g.fillStyle = o.dark
    g.fillRect(x - 70, b - 6, 56, 4)
  }

  /* ---- the Dubai Frame ----
     Two towers and a bridge, gilded, framing the city through the
     middle of itself. */
  function dubaiFrame(g, o, x) {
    const b = SKYLINE
    const HGT = 132
    const top = b - HGT
    const gold = '#d8a63c'
    const goldLit = '#ffdc8a'
    const goldDark = '#8a6420'

    const leg = (lx) => {
      g.fillStyle = gold
      g.fillRect(lx, top, 13, HGT)
      g.fillStyle = goldLit
      g.fillRect(lx, top, 1, HGT)
      g.fillStyle = goldDark
      g.fillRect(lx + 12, top, 1, HGT)
      // the lattice pattern on the face — interlocking rings, squared
      g.fillStyle = goldDark
      for (let y = top + 4; y < b - 2; y += 8) {
        g.fillRect(lx + 2, y, 9, 1)
        g.fillRect(lx + 2, y, 1, 6)
        g.fillRect(lx + 10, y, 1, 6)
      }
    }
    leg(x - 44)
    leg(x + 31)

    // the bridge across the top
    g.fillStyle = gold
    g.fillRect(x - 44, top - 12, 88, 12)
    g.fillStyle = goldLit
    g.fillRect(x - 44, top - 12, 88, 1)
    g.fillStyle = goldDark
    for (let k = 0; k < 10; k++) g.fillRect(x - 40 + k * 9, top - 9, 5, 1)
    // the glass floor panel, lit
    g.fillStyle = '#8fe0f0'
    g.fillRect(x - 12, top - 3, 24, 2)
    glow(g, x - 12, top - 4, 24, 4, 14, '#8fe0f0', 0.9)
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

  /* Extrapolate `col` away from `anchor` by factor `f`. f = 1 returns
     `col` unchanged; f > 1 pushes it further in the direction it already
     leans, clamped per channel. This is how a colour is made "more
     itself" without inventing a new hue. */
  const spreadCache = new Map()
  function spread(anchor, col, f) {
    const key = anchor + '|' + col + '|' + f
    let out = spreadCache.get(key)
    if (out) return out
    const na = parseInt(anchor.slice(1), 16)
    const nc = parseInt(col.slice(1), 16)
    const ch = (sh) => {
      const a = (na >> sh) & 255
      return clamp255(a + Math.round((((nc >> sh) & 255) - a) * f))
    }
    const r = ch(16), g = ch(8), b = ch(0)
    out = '#' + (((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1))
    spreadCache.set(key, out)
    return out
  }

  /* ---- depth contrast ----
     Every building draws its body in `fill`, its lit top-left edge in
     `lit` and its shadowed right edge in `dark`, and the window grid
     shades between the three. When those three sit close together the
     tower has no internal relief and, worse, its lit edge cannot
     separate from the shadowed edge of the tower it abuts — so a row of
     same-material towers reads as one dark wall rather than as buildings.

     `depthen` widens the fill→lit and fill→dark intervals along their
     own hue, so the silhouette edges and the window shading both gain
     definition. It runs BEFORE the aerial wash, and its strength scales
     with depth: the near planes are near-black and mush hardest, so they
     get the most; the far planes stay soft because that softness is the
     distance cue. */
  function depthen(pal, k) {
    if (!(k > 0) || !pal.fill) return pal
    const out = { ...pal }
    if (out.lit) out.lit = spread(out.fill, out.lit, 1 + 0.75 * k)
    if (out.dark) out.dark = spread(out.fill, out.dark, 1 + 1.05 * k)
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
    () => buildLayer(0),
    () => buildLayer(1),
    () => buildLayer(2),
    () => buildLayer(3),
  ]

  function buildSkyline() {
    for (const step of skylineSteps()) step()
  }

  /* ==================================================================
     CITIES

     Five of them, and swapping between them rebuilds the skyline the
     same way a weather change does — same staged queue, same dissolve.

     What actually differs is smaller than it looks, and deliberately
     so. The archetypes, the window grids, the neon, the parallax and
     the whole rooftop in front are shared, because they are what makes
     this read as ONE scene rather than five wallpapers. A city is
     three things on top of that:

       ITS MONUMENTS, which is nearly all of the recognition. Five or
       six named buildings per city, spread far enough round the 1920px
       loop that one or two are in frame at a time.

       ITS LIGHT. Manhattan is magenta and cyan; Tokyo in April is
       rose; New Delhi is sodium through smog; Paris is gold; Dubai
       is gold over a hot teal. Each city overrides a handful of
       palette entries — the sky ramp, the haze, the neon set — and
       inherits everything else from the theme.

       ITS STOCK. A hint, through the archetype mix: Manhattan steps,
       Dubai spikes, Paris is low and even. Handled by `shape`, which
       nudges the roll in buildCity rather than replacing it.

     Everything is keyed off `cityKey`. Nothing else in the file needs
     to know which city it is drawing.
     ================================================================== */
  const CITIES = {
    newyork: {
      label: 'NEW YORK',
      /* No palette override. Manhattan at night IS the authored
         palette — every colour in THEMES.night was picked against it,
         and the other four are departures from here. */
      /* ---- Manhattan ----
         Wall to wall, and vertical. The setback tower is nearly half
         of everything built, nothing is low, and the street never
         opens: the gap chance is the lowest of the five, because the
         thing that makes this skyline is that there is no sky between
         the buildings until you are above the fortieth floor. */
      shape: { ziggurat: 0.14, needle: 0.03, slab: -0.04 },
      roofKit: 'tank',
      stock: [
        { gapChance: 0.67, gap: 10, minH: 58, maxH: 128 },
        { gapChance: 0.67, gap: 10, minH: 76, maxH: 160 },
        { gapChance: 0.64, gap: 12, minH: 88, maxH: 188 },
        { gapChance: 0.70, gap: 14, minH: 54, maxH: 122 },
      ],
      layer0: (g, o) => {
        stadium(g, o, 420)
        bridge(g, o, 1020)
        radioDish(g, o, 1640)
      },
      layer1: (g, o, windows) => {
        clockTower(g, o, 430)
        rooftopPool(g, o, 950, SKYLINE - 126)
      },
      layer2: (g, o, windows) => {
        empireState(g, o, 260, windows)
        chrysler(g, o, 1130, windows)
        rooftopPool(g, o, 500, SKYLINE - 152)
      },
      layer3: (g, o, windows, beams) => {
        liberty(g, o, 200)
        observatory(g, o, 1520)
        lighthouse(g, o, 1780, beams)
      },
    },

    tokyo: {
      label: 'TOKYO',
      /* ---- April, after dark ----

         Sakura at night is not a pink scene. It is a DARK one with
         pink in it — the blossom only reads as blossom because
         everything behind it is deep indigo, and a sky washed rose
         from the zenith down would swallow every petal in the frame.

         So the ramp keeps night's near-black top and rotates only the
         bottom third onto the rose axis: the city's own glow coming up
         off Shinjuku through the blossom. The haze is warm pink, the
         neon loses its greens and yellows for reds, pinks and white,
         and the moon goes slightly warm because a moon over blossom
         always looks like it has. */
      palette: {
        night: {
          sky: [
            '#06050a', '#08070e', '#0c0913', '#120d1a', '#191021',
            '#221528', '#2d1a2d', '#3c2337', '#4e2f3e',
          ],
          haze: '#a87b8f',
          smog: '#56344a',
          fog: '#4a2c47',
          rainSky: '#18121e',
          orb: '#ffeaf4', orbShade: '#e0aecc', orbGlow: '#8f5976',
          cloud: '#312034', cloudLit: '#714864', cloudDark: '#1a101c',
          high: ['#342d4b', '#442e50', '#61385a'],
          starDim: '#f0a8d0',
          neon: ['#ff3d7a', '#ff8ac0', '#ffffff', '#ff2b2b', '#ffd0e4', '#c04aff', '#ff7a3a'],
          sep: '#a83a86', sepDark: '#2a0e22',
          bounce: ['#ff3d7a', '#ffd0e4', '#c04aff'],
          wet: ['#ff3d7a', '#ffd0e4', '#c04aff'],
          /* The Yamanote line: stainless-steel car with the lime-green
             band running its length. */
          train: '#c2c8d0', trainLit: '#e8edf2', trainDark: '#6a7079',
          trainWin: '#eaf6ff', trainHead: '#fff8d8', trainStripe: '#9acd32',
        },
      },
      glow: ['#ff9ac8', 0.22],
      /* ---- Tokyo ----
         Not a skyline of towers. A very dense, fairly EVEN mid-rise
         mat with a few tall things standing out of it — which is the
         opposite of Manhattan's profile and the reason the two read
         differently even before the colour arrives. The zakkyo
         building is a third of everything, so the mat is made of
         advertising, and every roof carries a hoarding on top of
         that.

         The plots used to be narrow with almost no gaps, which is
         honest to Shinjuku and wrong for a backdrop: shoulder to
         shoulder, the mat read as one serrated mass and none of the
         structure on any single building — the mullions, the ledges,
         the roof hoardings — had an edge to be seen against. The gaps
         are roughly doubled and taken almost to certainty, so each
         building is a building again with sky either side of it. */
      shape: { zakkyo: 0.30, ziggurat: -0.26, banded: 0.04, needle: 0.02, slab: 0.03 },
      roofKit: 'billboard',
      stock: [
        { gapChance: 0.94, gap: 30, minW: 17, maxW: 31, minH: 46, maxH: 88 },
        { gapChance: 0.94, gap: 34, minW: 20, maxW: 37, minH: 56, maxH: 108 },
        { gapChance: 0.94, gap: 38, minW: 24, maxW: 44, minH: 66, maxH: 132 },
        { gapChance: 0.94, gap: 44, minW: 28, maxW: 54, minH: 46, maxH: 98 },
      ],
      layer0: (g, o) => {
        stadium(g, o, 380)
        bridge(g, o, 1060)
        radioDish(g, o, 1660)
        // something in the bay, a long way out
        kaiju(g, o, 1420, SKYLINE)
      },
      layer1: (g, o, windows) => {
        pagoda(g, o, 470)
        lanterns(g, o, 880, SKYLINE - 118, 5, 6)
        observatory(g, o, 1480)
        // Shinjuku's two, standing well back
        metroGov(g, o, 1180, windows)
        cocoon(g, o, 1300, windows)
      },
      layer2: (g, o, windows) => {
        tokyoTower(g, o, 300, windows)
        skytree(g, o, 920, windows)
        /* Tanks on the roofline. Spread across the plane rather than
           clustered, because the point of them is that they are
           everywhere. */
        for (const [tx, ty, ts] of [
          [180, 96, 1], [420, 74, 0.8], [620, 110, 1], [760, 88, 0.9],
          [1080, 102, 1], [1240, 80, 0.85], [1520, 94, 1], [1720, 86, 0.9],
        ]) waterTank(g, o, tx, SKYLINE - ty, ts)
      },
      layer3: (g, o, windows) => {
        pagoda(g, o, 240)
        precinct(g, o, 600, 132)
        precinct(g, o, 1420, 104)
        sakuraTree(g, o, 860, SKYLINE, 1)
        sakuraTree(g, o, 1180, SKYLINE, 0.85)

        /* ---- the street, and what is strung over it ----
           Poles first, then the cable between each pair, then the
           stairs and the machines that stand under it all. Drawn in
           the near plane so the clutter is the thing closest to the
           viewer, which is exactly where it is when you stand in it. */
/* The cable is gone. Strung pole to pole at roof height it was
           four slack lines crossing the full width of open sky, and a
           skyline read through four horizontals is a skyline cut into
           strips — every tower behind it arrived pre-sliced. It was
           the most Tokyo thing in the frame and the least restful, and
           when those two fight in a backdrop the backdrop loses.

           The poles stay, shorter, standing among the low-rise rather
           than over it: they still read as poles, they just no longer
           rule lines across the picture. */
        /* The poles are gone. One stood at 300 and so does Tokyo
           Tower, so its crossarms ran straight across both observatory
           decks and read as lines coming out of the tower. Moving it
           would have fixed that one collision and left the rest of the
           clutter; the brief was calm, so they all go. */
        for (const [sx, sh, sd] of [[400, 46, 1], [960, 38, -1], [1620, 42, 1]]) {
          stairRun(g, o, sx, SKYLINE, sh, sd)
        }
        vending(g, o, 640, SKYLINE)
        vending(g, o, 1340, SKYLINE)
      },
    },

    delhi: {
      label: 'NEW DELHI',
      /* Sodium through smog. Delhi's winter air is the whole palette —
         the horizon never goes black, it holds a warm amber the colour
         of a million street lamps seen through haze, and the sky above
         it stays a dusty violet rather than a clean blue. */
      palette: {
        night: {
          sky: [
            '#0e0f19', '#141623', '#1d1f33', '#272b41', '#35354f',
            '#42384e', '#5d4751', '#7f6253', '#9e7d58',
          ],
          haze: '#cdaa7c',
          smog: '#6e5642',
          fog: '#634c3d',
          rainSky: '#16131b',
          orb: '#ffe9c2', orbShade: '#dcc090', orbGlow: '#8d7553',
          cloud: '#32292e', cloudLit: '#766054', cloudDark: '#191316',
          high: ['#2b3b4e', '#3e374e', '#684c52'],
          starDim: '#f0cc96',
          /* Saffron, India-green and white lead — the flag colours are
             the loudest neon on the street — with gold, rose and a
             cool signboard cyan behind them. */
          neon: ['#ff8a1e', '#2fae52', '#ffd24a', '#ff3d7a', '#ffffff', '#4ad2e0', '#ff2d3a'],
          sep: '#c27a3a', sepDark: '#241408',
          bounce: ['#ffd24a', '#ff8a1e', '#2fae52'],
          wet: ['#ffd24a', '#ff8a1e', '#4ad2e0'],
          /* Delhi Metro: stainless-steel silver body, cool LED-white
             windows against the warm city, and the Red Line stripe. */
          train: '#aab2c0', trainLit: '#d8e0ea', trainDark: '#5a626e',
          trainWin: '#eef4ff', trainHead: '#fff3c0', trainStripe: '#e23b2e',
        },
      },
      glow: ['#ffbe5c', 0.24],
      /* ---- New Delhi ----
         Low, flat and packed. This is NOT a tower city: old Delhi and
         the residential colonies are masonry blocks of two to eight
         storeys with flat parapeted roofs, water tanks and dishes on
         top, and it is the Mughal domes rising out of that mat that the
         eye catches. So the build is grid and slab ONLY — flat-topped
         blocks, wide and low — with domes for the tombs and mosques.
         Every tall archetype the other cities lean on (the deco
         setback, the glazed office slab, the spire, the chamfered and
         notched crowns, the round hotel drum) is switched off, and the
         heights come right down: nothing generic here is a skyscraper,
         so the Qutub and the tombs stand clear above the roofline. */
      shape: {
        grid: 0.30, slab: 0.22, dome: 0.10,
        ziggurat: -0.28, banded: -0.11, needle: -0.09,
        chamfer: -0.08, notch: -0.07, twin: -0.06, taper: -0.06, drum: -0.06,
      },
      roofKit: 'cistern',
      stock: [
        { gapChance: 0.72, gap: 12, minW: 26, maxW: 52, minH: 36, maxH: 68 },
        { gapChance: 0.72, gap: 12, minW: 31, maxW: 61, minH: 42, maxH: 82 },
        { gapChance: 0.75, gap: 14, minW: 35, maxW: 73, minH: 48, maxH: 96 },
        { gapChance: 0.78, gap: 15, minW: 45, maxW: 92, minH: 40, maxH: 84 },
      ],
      layer0: (g, o) => {
        stadium(g, o, 400)
        bridge(g, o, 1100)
        radioDish(g, o, 1620)
      },
      layer1: (g, o, windows) => {
        clockTower(g, o, 450)
        marigoldString(g, o, 910, SKYLINE - 124, 6)
        observatory(g, o, 1490)
      },
      layer2: (g, o, windows) => {
        qutubMinar(g, o, 320, windows)
        mughalTomb(g, o, 860, windows)
        rooftopPool(g, o, 1180, SKYLINE - 152)
      },
      layer3: (g, o, windows) => {
        indiaGate(g, o, 300)
        lotusTemple(g, o, 760)
        marigoldString(g, o, 1080, SKYLINE - 104, 6)
        marigoldString(g, o, 1440, SKYLINE - 88, 5)
      },
    },

    paris: {
      label: 'PARIS',
      /* Gold, and low. Paris has no towers to speak of, so the whole
         skyline sits down and the sky gets to be most of the frame —
         which is why the ramp here is the gentlest of the five and why
         the only bright thing on the horizon is limestone under
         floodlight. */
      palette: {
        night: {
          sky: [
            '#0a0b13', '#10121e', '#181b2b', '#23263b', '#30334d',
            '#3f3d5b', '#504564', '#634d66', '#8a6c71',
          ],
          haze: '#dfc9aa',
          smog: '#68534c',
          fog: '#5c4946',
          rainSky: '#14111b',
          orb: '#fff6e0', orbShade: '#d8c49c', orbGlow: '#756651',
          cloud: '#2c2735', cloudLit: '#716365', cloudDark: '#17141c',
          high: ['#253345', '#3a3650', '#514054'],
          starDim: '#e8d0a8',
          neon: ['#ffd88a', '#fff0c8', '#e8a04a', '#7fc4d8', '#ff8ab0', '#ffffff', '#c04a3a'],
          sep: '#c29a5a', sepDark: '#241a14',
          bounce: ['#ffd88a', '#fff0c8', '#7fc4d8'],
          wet: ['#ffd88a', '#fff0c8', '#7fc4d8'],
          /* The Paris Metro: a cream car with the RATP wagon-green band,
             warm interior light. */
          train: '#d6d0c2', trainLit: '#f0ebde', trainDark: '#78705f',
          trainWin: '#fff0d0', trainHead: '#fff6d0', trainStripe: '#2f9e5c',
        },
      },
      glow: ['#ffd88a', 0.26],
      /* ---- Paris ----
         The most distinctive profile of the five and the easiest to
         get wrong, because it is defined by what is NOT there. No
         towers, no setbacks, no spires — one uniform cornice line
         running the whole width of the frame with mansard roofs on
         top of it and the odd dome breaking through.

         So mansard is nearly half of everything built, the ziggurat is
         switched off entirely, and the height range is both LOW and
         NARROW: the evenness is the character. Chimney pots on every
         roof, and the widest plots of the five. */
      shape: {
        mansard: 0.42, ziggurat: -0.38, needle: -0.09,
        banded: -0.10, dome: 0.05, slab: 0.04, drum: -0.03,
      },
      roofKit: 'pots',
      stock: [
        { gapChance: 0.64, gap: 10, minW: 25, maxW: 50, minH: 48, maxH: 86 },
        { gapChance: 0.64, gap: 10, minW: 28, maxW: 57, minH: 56, maxH: 102 },
        { gapChance: 0.67, gap: 12, minW: 32, maxW: 66, minH: 66, maxH: 128 },
        { gapChance: 0.70, gap: 14, minW: 42, maxW: 85, minH: 52, maxH: 110 },
      ],
      layer0: (g, o) => {
        stadium(g, o, 430)
        bridge(g, o, 1080)
        radioDish(g, o, 1650)
      },
      layer1: (g, o, windows) => {
        rooftopPool(g, o, 980, SKYLINE - 122)
        radioDish(g, o, 1500)
      },
      layer2: (g, o, windows) => {
        eiffel(g, o, 320, windows)
        sacreCoeur(g, o, 880)
        clockTower(g, o, 1260)
        rooftopPool(g, o, 640, SKYLINE - 148)
      },
      layer3: (g, o, windows, beams) => {
        arcDeTriomphe(g, o, 260)
        observatory(g, o, 1120)
        lighthouse(g, o, 1760, beams)
      },
    },

    dubai: {
      label: 'DUBAI',
      /* Desert night: no haze to speak of high up, and a band of gold
         sitting right on the horizon where the heat and the sodium
         are. Everything between is a very clean teal, because dry air
         is the one thing this scene has not shown yet. */
      palette: {
        night: {
          sky: [
            '#06070b', '#0a0d15', '#0f1521', '#151f2f', '#1d2f3e',
            '#25404b', '#3d5959', '#767d69', '#b29c72',
          ],
          haze: '#d6c193',
          smog: '#706246',
          fog: '#584d3a',
          rainSky: '#10151a',
          orb: '#fff4d0', orbShade: '#dcc898', orbGlow: '#837655',
          cloud: '#242c34', cloudLit: '#6b7264', cloudDark: '#11161b',
          high: ['#223c48', '#2f5057', '#627060'],
          starDim: '#c8e0d0',
          neon: ['#ffd24a', '#4adce8', '#ffffff', '#8affd0', '#ff9a3c', '#c8a8ff', '#ff5c7a'],
          sep: '#c2a04a', sepDark: '#141a14',
          bounce: ['#ffd24a', '#4adce8', '#ffffff'],
          wet: ['#ffd24a', '#4adce8', '#ffffff'],
          /* Dubai Metro: driverless silver car with the Gold Class
             band along it. */
          train: '#b4bcc6', trainLit: '#dee6ef', trainDark: '#5c626e',
          trainWin: '#eef6ff', trainHead: '#fff3c8', trainStripe: '#e0b24a',
        },
      },
      glow: ['#ffe4aa', 0.20],
      /* ---- Dubai ----
         Towers standing apart in space. Everything here is a needle or
         a drum, everything is TALL, and — the part that actually
         carries it — the gaps between them are the widest of the five
         and open twice as often. A skyline with sky in it is the one
         silhouette none of the other four can produce. */
      shape: { needle: 0.26, drum: 0.10, ziggurat: -0.22, slab: -0.05, banded: 0.04 },
      roofKit: 'dish',
      stock: [
        { gapChance: 0.80, gap: 26, minW: 13, maxW: 27, minH: 60, maxH: 146 },
        { gapChance: 0.80, gap: 27, minW: 15, maxW: 33, minH: 78, maxH: 178 },
        { gapChance: 0.80, gap: 31, minW: 19, maxW: 40, minH: 92, maxH: 210 },
        { gapChance: 0.80, gap: 29, minW: 25, maxW: 53, minH: 52, maxH: 132 },
      ],
      layer0: (g, o) => {
        stadium(g, o, 400)
        bridge(g, o, 1060)
        radioDish(g, o, 1640)
      },
      layer1: (g, o, windows) => {
        radioDish(g, o, 440)
        stadium(g, o, 1000)
        clockTower(g, o, 1500)
      },
      layer2: (g, o, windows) => {
        burjKhalifa(g, o, 340, windows)
        dubaiFrame(g, o, 900)
        rooftopPool(g, o, 1120, SKYLINE - 158)
      },
      layer3: (g, o, windows) => {
        burjAlArab(g, o, 320)
        observatory(g, o, 1200)
      },
    },
  }

  /* ---- the colour a city's windows burn ----

     The sky ramp and the neon set carry most of the identity, but they
     are both things you look AT. What you actually see for most of the
     frame is a hundred thousand lit windows, and leaving those on the
     Manhattan cyan meant every city read as Manhattan under a
     different sunset.

     One hex and one amount per city, blended into every glass value on
     every layer before a building is drawn — so the far towers of
     Paris are gold all the way down rather than cyan with gold fog in
     front of them. New York has none, because it is the authored
     case. */
  function localGlass(pal) {
    const t = cityDef().glow
    if (!t) return pal
    const to = (hex) => mix(hex, t[0], t[1], 24)
    const out = { ...pal }
    if (out.window) out.window = to(out.window)
    if (out.warm) out.warm = to(out.warm)
    if (Array.isArray(out.glass)) out.glass = out.glass.map(to)
    return out
  }

  const CITY_ORDER = ['newyork', 'tokyo', 'delhi', 'paris', 'dubai']

  /* Tokyo is the shot the page opens on — a sakura night, and the
     interface themes to it (see the per-city blocks in the CSS). New
     York remains the authored palette that the others are departures
     from; it is one pick away in the skyline menu. */
  let cityKey = 'tokyo'
  const cityDef = () => CITIES[cityKey] || CITIES.newyork

  /* A landmark callback that survives a city not defining that layer. */
  const marks = (which) => (g, o, windows, beams) => {
    const fn = cityDef()[which]
    if (fn) fn(g, o, windows, beams)
  }

  /* ==================================================================
     DENSITY

     Down four times, and the reduction is all in `step`.

     Total windows across a layer works out as (building height) over
     (step squared) — the building WIDTH cancels, because a narrower
     tower has fewer windows on it and there are proportionally more
     towers. So the only lever that actually moves the pixel count in a
     skyline is the window pitch, and it moves it as the SQUARE. Double
     the pitch and you get a quarter of the windows, a quarter of the
     mullions and a quarter of the floor ledges on every face in the
     frame. Every layer's step doubles here: 3 to 6 across the ridge and
     the first three planes, 4 to 8 on the near one.

     Widths are untouched. Reducing detail is not the same as reducing
     buildings, and the silhouette — the crowns, the setbacks, the
     staggered heights — is the part of a skyline worth keeping. What
     opens it up instead is air BETWEEN the towers: every layer's gap
     grows by about half and its gapChance goes up eight points, so
     there is more sky visible through the city than city.

     The window CELLS stay small. A 1px window on a 6px pitch is a lit
     room seen from a long way off, which is the correct reading; the
     old 3px pitch had them close enough to merge into a lit wall. */
  function buildRidge() {
    /* The far ridge: low, wide, nearly featureless towers one step off
       the haze colour. No neon, almost no windows, no flicker — at that
       distance a city is a shape, not an event. It drifts slowest of
       all, which is what tells the eye it is furthest away. */
    ridge = buildCity(7777, {
      minW: 35, maxW: 80, minH: 16, maxH: 54, gapChance: 0.80, gap: 22,
      step: 6, ww: 1, wh: 1, litChance: 0.028, bloom: 0.22,
      neon: T.neon, neonChance: 0.0000, halo: 0, fog: 0.21, street: 0.32,
      ...localGlass(recede(depthen(T.cityFar, 0.2), 0.5)),
    })
  }

  /* ==================================================================
     THE DEPTH RAMP

     Four built skylines behind the ridge, not three.

     Three planes plus a ridge gave four distances, and four was one
     short in exactly the place it shows: there was a visible JUMP
     between the far layer sitting in the haze and the mid layer
     standing clear of it. Depth in a flat picture is carried by the
     number of steps between the nearest thing and the furthest, and
     any step big enough to notice is a step that reads as a cut-out
     pasted in front of a backdrop.

     Five planes now — ridge, far, mid-far, mid, near — and every one
     of them is a genuine step on four axes at once, which is what
     makes it read as distance rather than as four heights:

       RECEDE   how far the palette is blended toward the horizon
                before a single brick is drawn. 0.5 at the ridge to
                nothing at all on the near layer.
       FOG      the dithered wash laid over the finished layer, on top
                of that.
       DRIFT    how fast it crosses. 2px/s at the back, 12 at the front.
       STOCK    smaller and denser with distance.

     The buildings themselves get the pitch down another step wherever
     there is room for it, which is the rest of the detail: every layer
     from the ridge forward now carries a 3px window grid rather than
     4, 5 or 7, so a tower has roughly twice the cells on its face that
     it had and the whole skyline stops reading as texture at any
     distance you look at it. */
  const LAYERS = [
    { key: 'layer0', seed: 4411, recede: 0.40, fog: 0.165, pan: 0.16,
      minW: 15, maxW: 32, minH: 54, maxH: 134, gapChance: 0.69, gap: 15,
      step: 6, ww: 1, wh: 1, litChance: 0.033, neonChance: 0.0050, bloom: 0.34, street: 0.55 },

    { key: 'layer1', seed: 5273, recede: 0.25, fog: 0.115, pan: 0.26,
      minW: 19, maxW: 39, minH: 74, maxH: 172, gapChance: 0.69, gap: 16,
      step: 6, ww: 1, wh: 2, litChance: 0.037, neonChance: 0.0075, bloom: 0.42, street: 0.75 },

    { key: 'layer2', seed: 881, recede: 0.11, fog: 0.058, pan: 0.42,
      minW: 22, maxW: 47, minH: 90, maxH: 205, gapChance: 0.72, gap: 19,
      step: 6, ww: 1, wh: 2, litChance: 0.045, neonChance: 0.0125, escapes: true, bloom: 0.52, street: 0.95 },

    { key: 'layer3', seed: 2266, recede: 0, fog: 0, pan: 0.68,
      minW: 31, maxW: 64, minH: 50, maxH: 130, gapChance: 0.75, gap: 22,
      step: 8, ww: 2, wh: 2, litChance: 0.043, neonChance: 0.0125, escapes: true, bloom: 0.64, street: 1 },
  ]

  /* Four planes off a three-stop authored ramp. The stops are the
     values the palette was designed around and they are not moving, so
     the new plane is interpolated between the two it sits between
     rather than given colours of its own — which also means a city
     that overrides `city` gets a consistent four-plane ramp for free. */
  function cityPal(i) {
    const stops = T.city
    const t = (i / (LAYERS.length - 1)) * (stops.length - 1)
    const a = Math.min(stops.length - 1, Math.floor(t))
    const b = Math.min(stops.length - 1, a + 1)
    const f = t - a
    if (f < 0.001) return stops[a]
    const A = stops[a]
    const B = stops[b]
    const to = (p, q) => mix(p, q, f, 24)
    return {
      fill: to(A.fill, B.fill),
      lit: to(A.lit, B.lit),
      dark: to(A.dark, B.dark),
      window: to(A.window, B.window),
      warm: to(A.warm, B.warm),
      glass: A.glass.map((c, k) => to(c, B.glass[k] || c)),
    }
  }

  function buildLayer(i) {
    const L = LAYERS[i]
    /* What this city builds at this distance. A city says only what it
       wants different; everything it does not name comes off the ramp
       above. */
    const st = (cityDef().stock && cityDef().stock[i]) || {}
    city[i] = buildCity(L.seed, {
      ...L,
      ...st,
      neon: T.neon,
      halo: T.halo,
      ...localGlass(recede(depthen(cityPal(i), 0.45 + 0.3 * i), L.recede)),
      /* Spread across the loop so that at any moment one or two are
         in frame and the rest are on their way round. */
      landmarks: marks(L.key),
    })
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
  /* Held while a full-screen wipe is covering the city. The wipe runs its
     own rAF, and the scene's render is the heaviest thing on the main
     thread — letting it keep painting behind an opaque cover just steals
     frames from the wipe and makes it stutter. The city moves at most a
     few pixels a second, so freezing it for the ~half-second of a
     transition is invisible and hands the whole thread to the wipe. */
  let paused = false

  function blit(buf, offset, lift) {
    const o = ((offset % W) + W) % W
    /* Buffers that carry nothing below a known line are allocated
       short — see CITY_H. The copy has to read the height the buffer
       actually has, or drawImage clips the source rect and rescales
       the destination to match, which shears the whole layer. */
    const bh = buf.h || H
    // source rect is in device pixels, destination in authored ones —
    // the context transform scales the latter back up, so the copy is
    // 1:1 and nothing is resampled
    ctx.drawImage(buf.c, dev(o), 0, dev(W), dev(bh), 0, -(lift || 0), W, bh)
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

  /* ---- the mass under a layer ----

     Each plane paints a band of its own fill colour along its ground
     line before its buildings go on top, so the towers stand ON
     something instead of floating over whatever is behind them.

     The top of that band used to be a hard cut, which was invisible
     while the city was wall-to-wall and became the most obvious thing
     in the frame the moment it was not: Dubai's towers stand apart, so
     you see straight through to the band behind them, and four bands
     at four heights read as four rules ruled across the sky.

     Three dithered rows at the top of each. The band still arrives —
     it has to, it is what gives the layer weight — but it arrives the
     way distance does, over a few pixels, instead of starting. */
  function ground(colour, lift) {
    if (!lift) return
    const top = SKYLINE - lift
    const fade = Math.min(3, lift)
    ctx.fillStyle = colour
    ctx.fillRect(0, top + fade, W, lift + 2 - fade)
    for (let k = 0; k < fade; k++) {
      washRow(ctx, top + k, W, colour, 0.28 + k * 0.26)
    }
  }

  /* Ridge, city 0..3 — in authored pixels. Each plane's ground line
     sits a few pixels above the one in front of it, which is the other
     half of the depth cue: further away is also HIGHER in the frame,
     because you are looking slightly down at all of it. */
  const LIFT = [24, 18, 12, 6, 0]

  function drawStars() {
    for (const s of stars) {
      if ((frame + s.phase) % s.rate <= s.rate * 0.08) continue
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
         every so often, at a period unique to each sign so no two ever
         gutter together.

         Four times longer than it was. One sign stuttering is a detail;
         forty signs stuttering on twelve-second cycles is a city that
         will not sit still, and it was the loudest moving thing in the
         frame. */
      if (wnd.sign) {
        const period = 600 + ((i * 37) % 520)
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
        : ((frame + i * 7) % (beacon ? 32 : 384)) < (beacon ? 3 : 4)
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

  /* ---- the fuse ----

     This was 26 frames of rise at 12fps — two and a quarter seconds
     between the tap and the burst — and the shell climbed all the way
     from SKYLINE, so a tap high in the frame waited longest of all.
     As physics that is correct and as an interaction it is broken: a
     direct manipulation that takes two seconds to answer does not read
     as a slow firework, it reads as a page that did not hear you.

     Three frames now, and the shell starts a fixed short distance
     BELOW the burst point rather than at the horizon, so the wait is
     the same wherever you tap and it is about a quarter second. There
     is still one frame of tail going up — enough to read as a launch —
     but the burst now lands almost on the tap rather than after a
     noticeable fuse: a direct manipulation should feel immediate.

     The burst itself is untouched apart from a shorter tail.
     The burst is the part you wanted; the fuse was never the point. */
  const SHELL_RISE = 3
  const SHELL_LIVE = 38
  const SHELL_DROP = 28 // how far below the burst the shell starts

  /* Seven at once, and it used to DROP the eighth tap on the floor.
     A control that ignores you when you use it quickly is the same
     bug as one that answers slowly, so the oldest shell makes way for
     the newest instead: every tap is always answered. */
  const SHELL_MAX = 10

  function firework(sx, sy, col, power) {
    // reading mode holds the frame counter, so a shell queued there
    // would sit frozen and then all of them would go off at once on
    // the way back
    if (focusTo > 0.5) return
    if (shells.length >= SHELL_MAX) shells.shift()
    shells.push({
      x: Math.max(20, Math.min(W - 20, sx)),
      y: Math.max(30, Math.min(SKYLINE - 30, sy)),
      /* Birth time, not a counter.

         `s.t++` per draw was fine while render() was called exactly
         once per content tick. It is not fine now that a tap paints a
         frame of its own: every tap would have aged every shell
         already in the air by an extra frame, so tapping quickly made
         the earlier bursts run fast and cut short. Deriving the age
         from a clock makes drawShells idempotent — paint it as often
         as you like, the shell is exactly as old as it is. */
      born: performance.now(),
      col: col || T.neon[Math.floor(Math.random() * T.neon.length)],
      pow: power || 1,
      spin: Math.random() * Math.PI,
    })
  }

  function drawShells() {
    const now = performance.now()
    for (let i = shells.length - 1; i >= 0; i--) {
      const s = shells[i]
      /* Still quantised to the 12fps grid — the burst steps with
         everything else in the scene, it just no longer counts paints
         to know where it is. */
      s.t = Math.floor((now - s.born) / (1000 / FPS))
      if (s.t > SHELL_LIVE) {
        shells.splice(i, 1)
        continue
      }

      if (s.t < SHELL_RISE) {
        // the shell going up, with a short tail behind it
        const k = s.t / SHELL_RISE
        const y = s.y + SHELL_DROP * (1 - k)
        ctx.fillStyle = T.lamp
        ctx.fillRect(s.x, Math.round(y), 1, 3)
        for (let n = 1; n < 6; n++) {
          dot(ctx, s.x, Math.round(y + n * 2), (1 - n / 6) * 0.6, T.lamp)
        }
        /* >=, not ==. The age comes off a clock now, so if the loop
           ever skips a tick there is no guarantee any single exact
           frame number is ever seen — and a cue that only fires on
           one is a cue that silently stops firing. Inside this branch
           it can only be the last rise frame anyway. */
        if (s.t >= SHELL_RISE - 1) glow(ctx, s.x - 2, s.y - 2, 4, 4, 14, s.col, 1.4)
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

    /* ---- answer on the same frame as the tap ----

       The scene paints its content at twelve frames a second, which is
       the project's whole identity and is right for a city. It is
       wrong for a response to a touch: a shell pushed onto the list
       sat there until the next content tick, so the first pixel of the
       tail arrived up to 83ms after the finger went down — on top of
       the fuse, and on the wrong side of the threshold where an
       interface stops feeling connected to your hand.

       Painting here costs one extra composite of a frame this loop was
       about to draw anyway, and it takes that 83ms to nothing. The
       CITY still steps at twelve; only the acknowledgement is
       immediate, which is the correct division — the background is a
       backdrop and the tap is a conversation. */
    render()
    present(sceneCv)
  })


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

  /* ==================================================================
     BLOSSOM

     Tokyo only, and only in April, which here means only in Tokyo.

     Petals are not snow and must not be drawn like it. Snow falls
     straight and accumulates; blossom does neither. It comes down
     slowly, swings a long way sideways on the way, arrives in gusts
     rather than evenly, and lands on nothing — the wind takes it off
     the roof before it ever settles. So there is no pile here and no
     splash: a petal simply leaves the bottom of the frame and another
     one enters the top.

     Every position is a function of `frame` rather than an
     accumulated velocity. That is what keeps them stepping at twelve
     with everything else, and it means a rebuild, a theme change or a
     direct render() call cannot double-advance them.

     Two pixels, sometimes three, because a petal seen from across a
     rooftop is exactly that big and any more turns the air pink. */
  const PETALS = 64
  let petals = []

  function seedPetals() {
    if (cityKey !== 'tokyo') {
      petals = []
      return
    }
    const rnd = mulberry32(8213)
    petals = []
    for (let i = 0; i < PETALS; i++) {
      petals.push({
        x0: rnd() * (W + 80) - 40,
        y0: rnd() * (H + 40),
        fall: 0.5 + rnd() * 0.85,   // pixels per frame
        drift: 0.10 + rnd() * 0.22, // and how hard the wind pushes
        sway: 8 + rnd() * 26,
        rate: 0.055 + rnd() * 0.075,
        phase: rnd() * 6.283,
        pale: rnd() < 0.34,
        big: rnd() < 0.32,
      })
    }
  }

  function drawPetals() {
    /* Nothing this small survives weather, and a petal falling through
       snow is two Aprils at once. */
    if (!petals.length || weather !== 'none') return
    const span = H + 40
    for (let i = 0; i < petals.length; i++) {
      const p = petals[i]
      const y = ((p.y0 + frame * p.fall) % span) - 20
      if (y < -2 || y > H) continue
      /* The sway is a sine and the drift is linear, so a petal crosses
         the frame while swinging rather than swinging in place — which
         is the difference between blossom and confetti. */
      const x =
        (((p.x0 + frame * p.drift + Math.sin(frame * p.rate + p.phase) * p.sway) % (W + 80)) +
          W + 80) % (W + 80) - 40
      const px = Math.round(x)
      const py = Math.round(y)
      ctx.fillStyle = p.pale ? '#ffe0ee' : '#f0a0c4'
      ctx.fillRect(px, py, p.big ? 2 : 1, 1)
      // the second pixel trails the swing, which reads as a tumble
      if (p.big) {
        ctx.fillStyle = p.pale ? '#f0a0c4' : '#c87098'
        ctx.fillRect(px + (Math.cos(frame * p.rate + p.phase) > 0 ? 2 : -1), py + 1, 1, 1)
      }
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
    blit(clouds, -Math.round(scrollT * (12 / 7) * S) / S)
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

    /* The camera easing used to live here. It moved to the content
       tick in loop(), because render() is no longer called only from
       there — a tap paints a frame immediately so the firework answers
       on the same frame as the finger, and anything that ADVANCES
       state inside render would have been stepped twice on that tick.
       render() draws; the tick decides when time passes. */

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
    /* Five planes, drawn back to front. Each one lays its own mass
       down first and is blitted on top of it, so the buildings stand
       ON their ground line — see the note above. */
    let nearOff = 0
    for (let i = 0; i < LAYERS.length; i++) {
      const L = city[i]
      if (!L) continue
      const off = drift(i + 1) - Math.round(panX * LAYERS[i].pan)
      ground(L.fill, LIFT[i + 1])
      blit(L.buf, off, LIFT[i + 1])
      flicker(L, off, LIFT[i + 1])
      nearOff = off
    }
    /* The rotating beams are off. Two lines sweeping out of the
       skyline and back, once a second, is motion the eye is obliged
       to track — and this is a backdrop behind a page somebody is
       trying to read. Kept in the file, not called. */
    // if (T.stars) drawLightBeams(nearOff)

    // In front of the skyline, behind the elevated line — it is flying
    // over the city, not through it.
    // The airship is gone: it carried a lit banner with words on it,
    // and words in the backdrop compete with words on the page.


    drawShells()

    // everything behind the near plane now falls away into it
    separateCity()

    // The rooftop is deliberately static — the cat and the brazier stand
    // on it, so it cannot scroll underneath them.
    blit(roof, 0)
    recedeDeck()

    /* Blossom comes down in FRONT of the roof, because it is the only
       thing in the frame that is between the viewer and the parapet.
       Behind it, it reads as a texture on the city; in front, the air
       has something in it. */
    drawPetals()

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
  /* The theme is the time of day; the city is the place. They compose
     — the city's overrides are laid over whichever theme is current,
     and anything a city does not name it inherits. That is why New
     York needs no palette block at all: it IS the theme. */
  let themeName = 'night'

  function applyPalette() {
    const base = THEMES[themeName] || THEMES.night
    const over = cityDef().palette && cityDef().palette[themeName]
    T = over ? { ...base, ...over } : base
  }

  function setTheme(name) {
    themeName = THEMES[name] ? name : 'night'
    applyPalette()
    stageRebuild()
    render()
  }

  /* Changing city is exactly a weather change with a different cause:
     the static layers are wrong now, so they are queued for rebuild
     one slice per frame and the dissolve is held over the top while
     they drain. Nothing here is a special case. */
  function setCity(key) {
    if (!CITIES[key] || key === cityKey) return
    cityKey = key
    /* The interface re-themes with the skyline: the wordmark, the panel
       and its neon border all read their colours from CSS variables
       that a `[data-city]` block overrides. */
    document.documentElement.dataset.city = key
    applyPalette()
    seedPetals()
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

  seedPetals()
  setTheme('night')
  document.documentElement.dataset.city = cityKey

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
    current: () => themeName,

    /* ---- the skyline picker ----
       `cities` is the whole menu in display order, so the control in
       the corner is built from the scene's own list rather than from a
       second copy of it in the markup. */
    cities: () => CITY_ORDER.map((k) => ({ key: k, label: CITIES[k].label })),
    city: () => cityKey,
    setCity(key) {
      setCity(key)
    },

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

    /* Freeze the scene while a full-screen wipe covers it, so the wipe's
       animation gets the main thread to itself. Off restores motion. */
    pause(on) {
      paused = !!on
    },

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

    /* The stage. Unlike focus, which takes the city DARK and STILL for
       reading, the stage keeps it moving and only turns the lights
       down: a half-strength wash so the L2 content in front stays
       legible while the city carries on behind it. Used when a page
       opens beside the navigation rather than over the whole frame. */
    setStage(on) {
      stageTo = on ? 1 : 0
      if (!animating) stage = stageTo
    },
  }

  /* ==================================================================
     TICK — fixed 12fps, so every motion is inherently stepped
     ================================================================== */
  let lastRaf = 0

  function loop(t) {
    requestAnimationFrame(loop)
    /* Held behind an opaque wipe: keep the last painted frame on screen
       and do nothing else, so the wipe's own animation has the thread to
       itself. `last` is banked so the content clock does not fire a burst
       of catch-up ticks when the hold lifts. */
    if (paused) { last = t; lastRaf = t; return }
    const dt = Math.min(120, lastRaf ? t - lastRaf : 1000 / 60)
    lastRaf = t

    // ease toward the current focus state, then let it scale motion
    if (focus !== focusTo) {
      const step = dt / FOCUS_MS
      focus = focusTo > focus ? Math.min(focusTo, focus + step) : Math.max(focusTo, focus - step)
    }
    // the stage wash eases the same way, but never touches `live`
    if (stage !== stageTo) {
      const step = dt / FOCUS_MS
      stage = stageTo > stage ? Math.min(stageTo, stage + step) : Math.max(stageTo, stage - step)
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

    /* Two reasons to repaint, and keeping them straight is what stops
       the interference that once read as jitter.

       The CONTENT tick is a fixed 12fps: the frame counter and everything
       counted off it — window flicker, signage, the fire, the cat — step
       on that and nothing else. That fixed, EVEN cadence is the fix for
       the old jitter, which came from stepping content off elapsed time
       so the steps landed at uneven intervals.

       The SCROLL is continuous and snapped to the device-pixel grid, and
       the frame is recomposited the moment the scroll crosses a whole
       device pixel. Both clocks are even, so they do not beat against
       each other; the buildings slide smoothly while their lit windows
       still step — smooth background, stepped sprites, which is what the
       hardware this imitates actually did. */
    /* `live` gates motion outright. At zero the frame counter holds, the
       scroll clock holds, nothing re-renders, and present() goes on
       showing the last painted frame — the still picture reading mode
       wants, held for free.

       When live, two clocks run. The CONTENT tick is still a fixed 12fps:
       the frame counter, and everything counted in frames (flicker, fire,
       cat, signage), step on it and only on it. The SCROLL is continuous
       — scrollT accrues real time — and the frame is recomposited
       whenever the scroll has crossed a whole device pixel, so the
       parallax slides smoothly between content ticks instead of jumping
       once per tick. An active event (a firework, a passing craft) also
       forces the repaint, since those move on their own clock too. */
    if (live > 0) {
      let doRender = false
      scrollT += (dt / 1000) * live
      if (t - last >= 1000 / FPS) {
        last = t
        frame++
        /* The camera catches up in steps, never smoothly: this scene
           has no easing anywhere else and would not survive it here.
           On the tick, so an extra paint never advances it. */
        if (panX !== panTo) {
          const d = panTo - panX
          const step = Math.sign(d) * Math.max(6, Math.round(Math.abs(d) / 5))
          panX = Math.abs(d) <= Math.abs(step) ? panTo : panX + step
        }
        doRender = true
      }
      const sig = driftSig()
      if (sig !== lastDriftSig) { lastDriftSig = sig; doRender = true }
      // events that animate off wall-clock, not the frame counter
      if (shells.length || craft.length) doRender = true
      if (doRender) render()
    } else {
      // keep both clocks from banking time while stopped, so coming back
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

    /* The stage wash. Same dark glass, half the strength, and it does
       not gate `live` — so the city keeps moving behind it. */
    if (stage > 0.002) {
      screenCtx.save()
      screenCtx.globalAlpha = stage * STAGE_DIM
      screenCtx.fillStyle = T.edge
      screenCtx.fillRect(0, 0, W, H)
      screenCtx.restore()
    }
  }

  if (animating) requestAnimationFrame(loop)
})()
