/* ==================================================================
   THE CITY FLOWERS

   A garland of the city's own flower gathered round the foot of the
   home column — a U, its two arms climbing the left and right edges
   and its base drifting along the bottom.

   This used to be one hand-placed SVG strip per city: 224px wide, a
   few hundred typed rectangles, tiled along the bottom edge. Two
   things were wrong with it. A U cannot tile — the arms have to know
   where the column's edges are and how far up to reach — and every
   pixel in those strips was placed by hand, which is why the blooms
   in them were five flat rectangles and a dot.

   So the flowers are drawn here instead, in code, like the city behind
   them. A couple of hundred blooms, each one shaded over a nine-tone
   ramp, with its own size, lean, openness and ruffle, on a stem, over
   leaves, overlapping its neighbours into a drift.

   Nothing here is random in the sense that it moves between loads:
   every number comes out of a seeded sequence, so Tokyo's garland is
   the same garland every time it opens — the same rule the boot
   skyline follows. Resizing re-lays it out; it does not re-roll it.
   ================================================================== */

(function () {
  'use strict'

  const col = document.querySelector('.page--home .col')
  if (!col) return

  const TAU = Math.PI * 2
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v)
  const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v)

  /* One art pixel is two CSS pixels. The old strips drew at 1:1, which
     is why they read as a fussy little border instead of as part of
     the same picture as the skyline — every other pixel on this page
     is chunky. */
  const SCALE = 2

  /* Light comes from over your left shoulder, the way it does
     everywhere else in the scene. Every petal is shaded against this
     one angle, which is most of what stops a heap of blooms reading as
     a heap of stickers. */
  const LIGHT = Math.atan2(-1, -1)
  const litOf = (a) => 0.5 + 0.5 * Math.cos(a - LIGHT)

  /* ==================================================================
     THE FLOWERS

     One entry per city, holding what to draw and what to draw it in.
     It sits here rather than in the stylesheet because a ramp is not a
     theme colour — it is drawing data, the same as a skyline's, and
     scene.js keeps a city's skyline next to its palette for the same
     reason.

     New York has no entry on purpose. It is the city with no override
     anywhere in here — the authored default — and a bare foot is part
     of that.
     ================================================================== */
  const FLOWERS = {
    tokyo: {
      seed: 8814,
      form: 'blossom',
      size: [7.0, 10.5],
      /* Sakura: rose at the base of the petal running to white at the
         notched tip, over the brown of a wet branch. */
      petal: ['#5e2340', '#7e2f4f', '#a84470', '#c76090', '#e87fae',
              '#ff9ec6', '#ffbcd6', '#ffd6e8', '#fff4fa'],
      core: ['#4a2410', '#7a3a12', '#b5651f', '#d6ab4b', '#ffdf6b', '#fff0b8'],
      leaf: ['#123a26', '#1d4a33', '#2b6b45', '#3d8d57', '#57a86e', '#7cc98d'],
      stem: ['#2a1c0e', '#3a2a18', '#534024', '#6b4a2a', '#8a6440'],
      leafSerr: 6,
    },

    delhi: {
      seed: 5271,
      form: 'pompom',
      size: [7.0, 10.0],
      /* Marigold: the whole point of a genda is that it is a ball of
         ruffle, so the ramp needs its dark crevices as much as its lit
         tips — nine stops from burnt umber to cream. */
      petal: ['#3d1503', '#5e2405', '#8a3a0b', '#a3480f', '#d9721a',
              '#f2911e', '#ffb42e', '#ffc63a', '#ffd863', '#fff0b8'],
      core: ['#2f1103', '#5e2405', '#8a3a0b', '#c26518', '#f2911e'],
      leaf: ['#0f3318', '#194a26', '#267037', '#2f8a44', '#4a9c5a', '#64ad73', '#8bc796'],
      stem: ['#14401e', '#1d5c2c', '#2f8a44', '#4f9e5e'],
      leafSerr: 9,
    },

    paris: {
      seed: 3902,
      form: 'rose',
      size: [7.5, 11.0],
      /* A rose is dark where it folds in on itself, so this ramp is
         weighted to its bottom end and the whorl rings are pushed
         further down it still. */
      petal: ['#2e0a1e', '#4a1230', '#6b1c42', '#7a244a', '#a33562',
              '#c44a76', '#d24b7a', '#e8709b', '#f291b4', '#ffc2d8'],
      core: ['#22071a', '#3d0f28', '#5e1838', '#7a244a', '#a33562'],
      leaf: ['#0d2c1a', '#173f28', '#225c35', '#2f8a44', '#469a57', '#64ad73'],
      stem: ['#1c3f22', '#2a5a30', '#3f7a42', '#5a9455'],
      leafSerr: 12,
    },

    dubai: {
      seed: 6640,
      form: 'star',
      size: [7.0, 10.5],
      /* Desert bloom: gold petals with a burnt throat and hard veins,
         over the grey-olive of anything that survives out there. */
      petal: ['#4d2208', '#7a3a10', '#a0521a', '#bd6721', '#d9772a',
              '#efa03a', '#ffc44a', '#ffd24a', '#ffe08a', '#fff3c8'],
      core: ['#33170a', '#5c2a0c', '#8a4212', '#bd6721', '#ffd24a'],
      leaf: ['#25300f', '#39471c', '#4a5a24', '#5e7030', '#6f823a', '#7a8a3a', '#98a85a'],
      stem: ['#39471c', '#4a5a24', '#5e7030', '#7a8a3a'],
      leafSerr: 4,
    },
  }

  /* ==================================================================
     PIXELS

     Blooms go down one art pixel at a time and there are a few hundred
     thousand of them, so they are written into a raw RGBA buffer
     rather than through that many fillRects. The buffer is at art
     scale; the canvas blows it up with smoothing off, which is the
     only thing keeping the pixels square.
     ================================================================== */
  const rgb = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
  const rampOf = (list) => list.map(rgb)

  function buffer(w, h) {
    const data = new Uint8ClampedArray(w * h * 4)
    return {
      w: w,
      h: h,
      data: data,
      px(x, y, c) {
        if (x < 0 || y < 0 || x >= w || y >= h) return
        const i = ((y * w) + x) << 2
        data[i] = c[0]
        data[i + 1] = c[1]
        data[i + 2] = c[2]
        data[i + 3] = 255
      },
    }
  }

  /* A hash rather than a sequence, because this one has to give the
     same value every time a given pixel asks — it is a dither fixed in
     space, not a roll. It is what keeps a big petal from banding into
     three flat stripes. */
  function nz(x, y) {
    let h = (Math.imul(x, 374761393) + Math.imul(y, 668265263)) | 0
    h = (h ^ (h >>> 13)) | 0
    h = Math.imul(h, 1274126177)
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296
  }

  /* mulberry32. Math.random would re-scatter the whole garland on
     every resize, which reads as the flowers flinching. */
  function rng(seed) {
    let a = seed >>> 0
    return function () {
      a = (a + 0x6d2b79f5) >>> 0
      let t = a
      t = Math.imul(t ^ (t >>> 15), t | 1)
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  /* ==================================================================
     PETALS

     The one shape everything here is built out of. Rather than walking
     the petal's axis and painting outwards — which leaves holes at
     some angles — every pixel in the petal's bounding box is pushed
     back into petal space and tested. It costs a few more arithmetic
     ops and it gives an exact edge, which matters: the edge is where
     the outline goes, and the outline is what separates one petal from
     the one behind it.

     u runs 0 at the base to 1 at the tip; q is the sideways distance
     from the spine.
     ================================================================== */
  const PROFILE = {
    // broad and flat-sided, narrow at the base — a cherry or marigold petal
    round: (u) => Math.pow(Math.max(0, 1 - Math.pow(2 * u - 1, 2)), 0.34) * Math.min(1, 0.22 + u * 2.6),
    // a teardrop, widest at the middle — a rose petal
    drop: (u) => Math.sqrt(Math.max(0, 1 - Math.pow(2 * u - 1, 2))) * Math.min(1, 0.18 + u * 2.2),
    // widest near the base, drawn out to a point — a desert petal
    blade: (u) => Math.pow(Math.max(0, 1 - Math.pow(u, 2.2)), 0.62) * Math.min(1, 0.30 + u * 3),
    // symmetric both ends — a leaf
    lens: (u) => Math.sqrt(Math.max(0, 1 - Math.pow(2 * u - 1, 2))),
  }

  /* Both curves that run along a petal — its half-width and how pale
     it goes toward the tip — are sampled once into a short table
     instead of being evaluated per pixel. At a few hundred blooms a
     Math.pow in the inner loop is the difference between a frame and a
     second, and the table is only as long as the petal, so a three
     pixel marigold petal does not pay for a sakura one.

     The box being walked is the exact one the rotated petal lives in,
     too. Squaring off (len + wid) in both directions instead tests
     five or six times as many pixels as the petal can possibly cover,
     which for a long thin petal is nearly all of them. */
  function petal(buf, cx, cy, ang, len, wid, ramp, o) {
    o = o || {}
    const prof = o.prof || PROFILE.round
    const cos = Math.cos(ang)
    const sin = Math.sin(ang)
    const n = ramp.length - 1
    const lit = o.lit === undefined ? litOf(ang) : o.lit
    const base = o.base || 0
    const tipBias = o.tipBias || 1
    const veins = o.veins || 0
    const phase = o.phase || 0
    const grain = o.grain === undefined ? 0.18 : o.grain
    /* How much of a petal's tone comes from running out to its tip,
       against how much comes from which way the whole petal faces. A
       cherry petal is a flat fan and wants the gradient; a marigold
       petal is three pixels long and one of forty on a ball, where the
       gradient is just noise and the facing is the entire shape. */
    const tipAmt = o.tipAmt === undefined ? 0.34 : o.tipAmt
    const ridgeAmt = 0.44 - grain
    const litAmt = 0.56 - tipAmt

    const N = Math.max(8, Math.ceil(len * 2))
    const hwLut = new Float32Array(N + 1)
    const tipLut = new Float32Array(N + 1)
    let maxHw = 0
    for (let i = 0; i <= N; i++) {
      const u = i / N
      let hw = wid * prof(u)
      if (o.ruffle) hw *= 1 + o.ruffle * Math.sin(u * 9.2 + phase)
      hwLut[i] = hw
      if (hw > maxHw) maxHw = hw
      tipLut[i] = tipAmt * Math.pow(u, tipBias)
    }
    if (maxHw < 0.5) return

    const ax = cos * len
    const ay = sin * len
    const hx = Math.abs(sin * maxHw)
    const hy = Math.abs(cos * maxHw)
    const x0 = Math.max(0, Math.floor(Math.min(cx, cx + ax) - hx))
    const x1 = Math.min(buf.w - 1, Math.ceil(Math.max(cx, cx + ax) + hx))
    const y0 = Math.max(0, Math.floor(Math.min(cy, cy + ay) - hy))
    const y1 = Math.min(buf.h - 1, Math.ceil(Math.max(cy, cy + ay) + hy))

    for (let Y = y0; Y <= y1; Y++) {
      const dy = Y - cy
      for (let X = x0; X <= x1; X++) {
        const dx = X - cx
        const t = dx * cos + dy * sin
        if (t < 0 || t > len) continue
        const q = -dx * sin + dy * cos
        const aq = q < 0 ? -q : q
        if (aq > maxHw) continue

        const u = t / len
        const hw = hwLut[(u * N) | 0]
        if (hw < 0.5 || aq > hw) continue

        /* The notch a cherry petal has cut out of its tip. It is the
           one detail that makes a five-petal blob read as sakura and
           not as a daisy. */
        if (o.notch && u > 0.82 && aq < hw * 0.62 * ((u - 0.82) / 0.18)) continue

        const qn = aq / hw
        let k = base +
          ridgeAmt * (1 - qn * qn * 0.85) +
          tipLut[(u * N) | 0] +
          litAmt * lit +
          grain * nz(X, Y)

        // veins, running the length of the petal
        if (veins && u > 0.14 && u < 0.94) {
          const v = qn * veins
          if (Math.abs(v - Math.round(v)) < 0.11) k -= 0.15
        }

        // the crease where the petal folds out of the flower's centre
        if (u < 0.22) k -= 0.12 * (1 - u / 0.22)

        // the silhouette, one pixel of the darkest tone
        if (hw - aq < 1 || len - t < 1) k = Math.min(k, 0.12)

        buf.px(X, Y, ramp[clamp(Math.round(k * n), 0, n)])
      }
    }
  }

  function leaf(buf, cx, cy, ang, len, wid, ramp, o) {
    o = o || {}
    const cos = Math.cos(ang)
    const sin = Math.sin(ang)
    const n = ramp.length - 1
    const lit = litOf(ang)
    const base = o.base || 0
    const veins = o.veins || 5

    const N = Math.max(8, Math.ceil(len * 2))
    const hwLut = new Float32Array(N + 1)
    let maxHw = 0
    for (let i = 0; i <= N; i++) {
      const u = i / N
      let hw = wid * PROFILE.lens(u)
      // the sawtooth edge — deep on a rose leaf, barely there on a sakura one
      if (o.serr) hw *= 1 - 0.17 * Math.abs((((u * o.serr) % 1) * 2) - 1)
      hwLut[i] = hw
      if (hw > maxHw) maxHw = hw
    }
    if (maxHw < 0.5) return

    const ax = cos * len
    const ay = sin * len
    const hx = Math.abs(sin * maxHw)
    const hy = Math.abs(cos * maxHw)
    const x0 = Math.max(0, Math.floor(Math.min(cx, cx + ax) - hx))
    const x1 = Math.min(buf.w - 1, Math.ceil(Math.max(cx, cx + ax) + hx))
    const y0 = Math.max(0, Math.floor(Math.min(cy, cy + ay) - hy))
    const y1 = Math.min(buf.h - 1, Math.ceil(Math.max(cy, cy + ay) + hy))

    for (let Y = y0; Y <= y1; Y++) {
      const dy = Y - cy
      for (let X = x0; X <= x1; X++) {
        const dx = X - cx
        const t = dx * cos + dy * sin
        if (t < 0 || t > len) continue
        const q = -dx * sin + dy * cos
        const aq = q < 0 ? -q : q
        if (aq > maxHw) continue

        const u = t / len
        const hw = hwLut[(u * N) | 0]
        if (hw < 0.5 || aq > hw) continue
        const qn = aq / hw

        let k = base +
          0.26 * (1 - qn * qn * 0.8) +
          0.24 * (1 - u) +
          0.30 * lit +
          0.20 * nz(X, Y)

        // side veins, slanting out from the midrib toward the tip
        const v = u * veins - qn * 0.5
        if (u > 0.1 && v - Math.floor(v) < 0.16) k -= 0.13
        // the midrib itself, which catches the light
        if (aq < 0.85 && u < 0.96) k += 0.30
        if (hw - aq < 1 || len - t < 1) k = Math.min(k, 0.10)

        buf.px(X, Y, ramp[clamp(Math.round(k * n), 0, n)])
      }
    }
  }

  /* A shaded disc: the flower's centre, and the body of a bud. */
  function disc(buf, cx, cy, r, ramp, o) {
    o = o || {}
    const n = ramp.length - 1
    const base = o.base || 0
    const grain = o.grain === undefined ? 0.26 : o.grain
    const x0 = Math.max(0, Math.floor(cx - r - 1))
    const x1 = Math.min(buf.w - 1, Math.ceil(cx + r + 1))
    const y0 = Math.max(0, Math.floor(cy - r - 1))
    const y1 = Math.min(buf.h - 1, Math.ceil(cy + r + 1))

    for (let Y = y0; Y <= y1; Y++) {
      for (let X = x0; X <= x1; X++) {
        const dx = X - cx
        const dy = Y - cy
        const d2 = dx * dx + dy * dy
        if (d2 > r * r) continue
        const d = Math.sqrt(d2)
        // lit from the top-left, falling away to the rim
        const l = clamp01(0.5 + (-dx - dy) / (r * 2.9))
        let k = base + 0.34 * (1 - d / r) + (0.66 - grain) * l + grain * nz(X, Y)
        if (r - d < 1) k = Math.min(k, 0.12)
        buf.px(X, Y, ramp[clamp(Math.round(k * n), 0, n)])
      }
    }
  }

  /* The filaments standing up out of the middle of an open flower,
     each with a lit anther on the end. Five pink rectangles and a dot
     is what these replaced. */
  function stamens(buf, cx, cy, count, len, ramp, rnd) {
    const stalk = ramp[Math.max(0, ramp.length - 3)]
    const anther = ramp[ramp.length - 2]
    const rot = rnd() * TAU
    for (let i = 0; i < count; i++) {
      const a = rot + (i / count) * TAU + (rnd() - 0.5) * 0.34
      const L = len * (0.55 + rnd() * 0.55)
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      for (let t = 1; t <= L; t += 0.5) {
        buf.px(Math.round(cx + cos * t), Math.round(cy + sin * t), stalk)
      }
      buf.px(Math.round(cx + cos * L), Math.round(cy + sin * L), anther)
      if (L > 3.2) buf.px(Math.round(cx + cos * (L + 1)), Math.round(cy + sin * (L + 1)), anther)
    }
  }

  /* A stem, bent — nothing in a garland grows straight. Two tones wide
     where there is room for two, so it has a lit side. */
  function stem(buf, x0, y0, x1, y1, bend, ramp, w) {
    const mx = (x0 + x1) / 2 + bend * (y1 - y0) * 0.22
    const my = (y0 + y1) / 2 - bend * (x1 - x0) * 0.22
    const dark = ramp[0]
    const mid = ramp[Math.min(2, ramp.length - 1)]
    const steps = Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2) + 4
    for (let i = 0; i <= steps; i++) {
      const t = i / steps
      const it = 1 - t
      const x = Math.round(it * it * x0 + 2 * it * t * mx + t * t * x1)
      const y = Math.round(it * it * y0 + 2 * it * t * my + t * t * y1)
      buf.px(x, y, mid)
      if (w > 1) buf.px(x + 1, y, dark)
      if (w > 2) buf.px(x - 1, y, dark)
    }
  }

  /* ==================================================================
     THE BLOOMS

     Four flowers, one per city that has one. Each is rings of petals
     drawn outermost first, so every petal lays its own outline over
     the one behind it and the flower stacks the way a real one does.
     ================================================================== */

  // Sakura — five broad notched petals and a spray of gold stamens.
  function blossom(buf, x, y, R, P, C, rnd, dim) {
    const rot = rnd() * TAU
    for (let i = 0; i < 5; i++) {
      const a = rot + (i / 5) * TAU + (rnd() - 0.5) * 0.18
      petal(buf, x, y, a, R * (0.92 + rnd() * 0.16), R * 0.62, P, {
        prof: PROFILE.round,
        notch: true,
        tipBias: 0.72,
        veins: 3,
        // the first two land at the back of the flower, a step down the ramp
        base: dim + (i < 2 ? -0.07 : 0),
        phase: rnd() * TAU,
      })
    }
    disc(buf, x, y, R * 0.26, C, { base: dim - 0.06, grain: 0.30 })
    stamens(buf, x, y, 8, R * 0.30, C, rnd)
  }

  // Marigold — five rings of short ruffled petals, each ring set in
  // the gaps of the one under it and a step darker toward the middle.
  function pompom(buf, x, y, R, P, C, rnd, dim) {
    const rings = [
      { r: 1.00, n: 11, w: 0.42, base: 0.06 },
      { r: 0.76, n: 9, w: 0.44, base: 0.00 },
      { r: 0.54, n: 8, w: 0.45, base: -0.07 },
      { r: 0.34, n: 6, w: 0.46, base: -0.14 },
    ]
    let rot = rnd() * TAU
    for (const ring of rings) {
      for (let i = 0; i < ring.n; i++) {
        const a = rot + (i / ring.n) * TAU
        petal(buf, x, y, a, R * ring.r * (0.88 + rnd() * 0.24), R * ring.w, P, {
          prof: PROFILE.round,
          notch: true,
          tipBias: 1.4,
          tipAmt: 0.17,
          ruffle: 0.10,
          grain: 0.09,
          base: dim + ring.base,
          phase: rnd() * TAU,
        })
      }
      rot += Math.PI / ring.n
    }
    disc(buf, x, y, R * 0.17, C, { base: dim - 0.10, grain: 0.30 })
  }

  // Rose — four whorls closing on a dark centre, each rotated off the
  // last so no two petals line up.
  function rose(buf, x, y, R, P, C, rnd, dim) {
    const rings = [
      { r: 1.00, n: 6, w: 0.54, base: 0.10 },
      { r: 0.78, n: 5, w: 0.52, base: 0.00 },
      { r: 0.57, n: 5, w: 0.50, base: -0.12 },
      { r: 0.38, n: 4, w: 0.50, base: -0.22 },
    ]
    let rot = rnd() * TAU
    for (const ring of rings) {
      for (let i = 0; i < ring.n; i++) {
        const a = rot + (i / ring.n) * TAU + (rnd() - 0.5) * 0.12
        petal(buf, x, y, a, R * ring.r * (0.9 + rnd() * 0.2), R * ring.w, P, {
          prof: PROFILE.drop,
          tipBias: 0.85,
          veins: 2,
          base: dim + ring.base,
          phase: rnd() * TAU,
        })
      }
      rot += Math.PI / ring.n + 0.4
    }
    // the whorl: three little petals curled round the hole in the middle
    disc(buf, x, y, R * 0.22, C, { base: dim - 0.14, grain: 0.22 })
    for (let i = 0; i < 3; i++) {
      const a = rot + (i / 3) * TAU
      petal(buf, x, y, a, R * 0.26, R * 0.34, P, {
        prof: PROFILE.drop, tipBias: 1.1, base: dim - 0.26,
      })
    }
  }

  // Desert bloom — six pointed petals, hard veins, a burnt throat and
  // a stamen column standing out of it.
  function star(buf, x, y, R, P, C, rnd, dim) {
    const rot = rnd() * TAU
    disc(buf, x, y, R * 0.42, C, { base: dim - 0.16, grain: 0.20 })
    for (let i = 0; i < 6; i++) {
      const a = rot + (i / 6) * TAU + (rnd() - 0.5) * 0.14
      petal(buf, x, y, a, R * (0.95 + rnd() * 0.14), R * 0.44, P, {
        prof: PROFILE.blade,
        tipBias: 0.9,
        veins: 4,
        base: dim + (i % 2 ? -0.05 : 0.02),
        phase: rnd() * TAU,
      })
    }
    disc(buf, x, y, R * 0.20, C, { base: dim - 0.20, grain: 0.30 })
    stamens(buf, x, y, 7, R * 0.26, C, rnd)
  }

  // A bud: a closed cup of three petals held in a sepal.
  function bud(buf, x, y, R, P, S, rnd, dim, ang) {
    stem(buf, x - Math.cos(ang) * R * 1.8, y - Math.sin(ang) * R * 1.8, x, y, 0.4, S, 2)
    for (let i = -1; i <= 1; i++) {
      petal(buf, x, y, ang + i * 0.42, R * (0.95 + rnd() * 0.2), R * 0.42, P, {
        prof: PROFILE.drop, tipBias: 1.0, base: dim - 0.04 + i * 0.03, veins: 2,
      })
    }
    // the green sepal wrapping its base
    for (let i = -1; i <= 1; i++) {
      leaf(buf, x, y, ang + Math.PI + i * 0.55, R * 0.62, R * 0.20, S, { base: -0.05, veins: 2 })
    }
  }

  const FORMS = { blossom: blossom, pompom: pompom, rose: rose, star: star }

  /* ==================================================================
     THE U

     `cover` is the whole layout: for any point in the buffer it gives
     back how deep in the garland that point is — 0 outside it, 1 in
     the thick of it. The base term measures up from the bottom edge;
     the arm term measures in from whichever side is nearer and fades
     as it climbs. Taking the larger of the two makes the two bottom
     corners — where both are high — the densest part of the drift,
     which is where a garland actually piles up.

     Everything else is sampled against it: blooms, leaves, buds and
     fallen petals are all thrown at the rectangle and kept in
     proportion to how well covered they land.

     What comes back is not one picture. The bed — leaves, buds, the
     petals lying on the floor — is baked into a single layer, and
     every flowering stem is drawn into a little sprite of its own that
     knows where its bloom sits. That is what lets the garland part
     around a cursor without re-drawing two hundred blooms a frame.
     ================================================================== */
  function garland(W, H, def, geo) {
    const rnd = rng(def.seed)
    const P = rampOf(def.petal)
    const C = rampOf(def.core)
    const L = rampOf(def.leaf)
    const S = rampOf(def.stem)
    const Lback = L.slice(0, Math.max(3, L.length - 2))
    const form = FORMS[def.form]
    const bed = buffer(W, H)
    const plants = []

    /* The arms up the sides are gone: the drift is a low bed along the
       bottom only now, and thinner than it was. So `cover` is just the
       base term — how far up from the bottom edge a point sits — and
       everything grows straight up out of the soil. */
    const cover = (x, y) => clamp01(1 - (H - y) / geo.baseDepth)

    /* Everything is planted in the floor, so "out of the garland" is
       always straight down. Stems grow up along it; leaves lie across. */
    const outward = () => Math.PI / 2

    /* Blooms are allowed to start outside the rectangle and be cut off
       by it. That is what makes the garland touch the edges of the
       column rather than stop politely a few pixels short of them. */
    /* Fewer blooms than the old garland, and spaced further apart: this
       is a sparse bed you fill in by watering, not a packed border. */
    const CAP = Math.max(8, Math.round(geo.count || 60))
    const RMAX = def.size[1]
    const spots = []
    const tries = W * 26
    for (let i = 0; i < tries && spots.length < CAP; i++) {
      const x = -6 + rnd() * (W + 12)
      /* Bloom centres sit ABOVE the ground by at least their own radius,
         so the flower head is never sliced by the bottom edge; the stem
         reaches down to the soil on its own. Weighted low, so the bed is
         densest along the floor and thins upward. */
      const lift = rnd() * rnd() * (geo.baseDepth * 0.55)
      const y = H - RMAX - 2 - lift
      const R = def.size[0] + rnd() * (def.size[1] - def.size[0])
      // pack them closer than the old garland — this is a full bed
      let ok = true
      for (let j = 0; j < spots.length; j++) {
        const s = spots[j]
        const gx = s.x - x
        const gy = s.y - y
        const gap = (s.R + R) * 0.6
        if (gx * gx + gy * gy < gap * gap) { ok = false; break }
      }
      if (!ok) continue
      spots.push({ x: x, y: y, R: R, c: 1 - lift / (geo.baseDepth + 1) })
    }

    /* ---- the bed ----
       No loose foliage lying in the soil any more: it read as clutter.
       The only leaves are the one or two on each flower's own stem, drawn
       with the plant below and grown in with it. Bare soil to start,
       flowers (and their leaves) on watering. */

    /* ---- the drift ----
       Sorted top to bottom and drawn in that order, so a bloom lower
       down the column covers the one behind it. Anything toward the
       top of the band is also pushed a step down the ramp: distance,
       done the way the skyline does it.

       Each stem goes into its own buffer rather than straight onto the
       bed. The buffer is sized off the plant it holds, so a sprite is
       a few dozen pixels square and two hundred of them cost less to
       composite than one of them costs to re-draw. */
    spots.sort((a, b) => a.y - b.y)
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i]
      const back = i / Math.max(1, spots.length - 1)
      const dim = -0.24 * (1 - back)
      const out = outward(s.x, s.y)
      const cos = Math.cos(out)
      const sin = Math.sin(out)

      // everything the plant is made of, decided before it is drawn,
      // because the sprite has to be cut to fit it.
      // The stem roots at the ground line (H) however tall the bloom
      // stands, so the flower head is always clear of the bottom edge.
      const footX = s.x + (rnd() - 0.5) * 4
      const footY = H + 4
      const reach = footY - s.y
      const bend = (rnd() - 0.5) * 2.0
      const count = 1 + (rnd() < 0.5 ? 1 : 0)
      const leaves = []
      for (let k = 0; k < count; k++) {
        leaves.push({
          t: 0.4 + rnd() * 0.4,
          side: k % 2 ? 1 : -1,
          len: s.R * (0.9 + rnd() * 0.8),
          lean: 0.7 + rnd() * 0.5,
        })
      }
      const pad = s.R * 2.2 + 8
      const ox = Math.floor(Math.min(s.x, footX) - pad)
      const oy = Math.floor(Math.min(s.y, footY) - pad)
      const sw = Math.ceil(Math.max(s.x, footX) + pad) - ox
      const sh = Math.ceil(Math.max(s.y, footY) + pad) - oy
      if (sw <= 0 || sh <= 0) continue
      const sub = buffer(sw, sh)

      // the stem it stands on, coming in from outside the band
      stem(sub, footX - ox, footY - oy, s.x - ox, s.y - oy, bend, S, s.R > 8 ? 2 : 1)

      // a leaf or two on that stem, in the full ramp this time
      for (const lf of leaves) {
        const lx = s.x + cos * reach * lf.t - ox
        const ly = s.y + sin * reach * lf.t - oy
        leaf(sub, lx, ly, out + Math.PI + lf.side * lf.lean, lf.len, lf.len * 0.32, L, {
          base: dim, veins: 5, serr: def.leafSerr,
        })
      }

      form(sub, s.x - ox, s.y - oy, s.R, P, C, rnd, dim)

      plants.push({
        buf: sub, ox: ox, oy: oy, w: sw, h: sh,
        // the bloom's own centre, which is what a cursor is measured to
        cx: s.x, cy: s.y, R: s.R,
        // the foot where the stem meets the soil — growth scales up from
        // here, so a half-grown plant is a small plant rooted in place
        fx: footX, fy: footY,
        dx: 0, dy: 0,
      })
    }

    /* No loose buds or fallen petals in the soil either — the bed starts
       bare and everything on it is a flower you grew. */

    return { bed: bed, plants: plants }
  }

  /* ==================================================================
     WIRING
     ================================================================== */
  const canvas = document.createElement('canvas')
  canvas.className = 'col__flowers'
  canvas.setAttribute('aria-hidden', 'true')
  col.appendChild(canvas)

  /* The band of clear air over the bed is a live surface: the cursor
     becomes a watering can over it, and a tap there waters the soil. It
     only covers the bottom padding, where there is no text, so it never
     stands between a reader and a link. */
  const waterer = document.createElement('div')
  waterer.className = 'col__waterer'
  waterer.setAttribute('aria-hidden', 'true')
  col.appendChild(waterer)

  const src = document.createElement('canvas')
  const srcCtx = src.getContext('2d')
  srcCtx.imageSmoothingEnabled = false

  /* One canvas per sprite, cut once, so growth is a scaled drawImage of a
     few dozen pixels rather than a redraw. */
  function toCanvas(b) {
    const c = document.createElement('canvas')
    c.width = b.w
    c.height = b.h
    c.getContext('2d').putImageData(new ImageData(b.data, b.w, b.h), 0, 0)
    return c
  }

  let bedCanvas = null
  let plants = []
  let drops = []
  let artW = 0
  let artH = 0
  let up = 1

  /* Each plant is drawn scaled by its own `grow`, anchored at the foot
     where the stem meets the soil — so a seedling is a small plant
     rooted in exactly the spot its full self will stand, and watering
     just lets it up. The bed (leaves, buds, fallen petals) is always at
     full size; it is the soil the flowers come up out of. */
  function paint() {
    if (!bedCanvas) return
    srcCtx.clearRect(0, 0, artW, artH)
    srcCtx.drawImage(bedCanvas, 0, 0)
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i]
      const g = p.grow
      if (g <= 0.02) continue
      if (g > 0.995 && g < 1.005) { srcCtx.drawImage(p.canvas, p.ox, p.oy); continue }
      const dw = Math.max(1, p.w * g)
      const dh = Math.max(1, p.h * g)
      const dx = p.fx + (p.ox - p.fx) * g
      const dy = p.fy + (p.oy - p.fy) * g
      srcCtx.drawImage(p.canvas, 0, 0, p.w, p.h, dx, dy, dw, dh)
    }
    const ctx = canvas.getContext('2d')
    ctx.imageSmoothingEnabled = false
    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height)
    // water in the air, drawn straight on the display canvas over the bed
    for (let i = 0; i < drops.length; i++) {
      const d = drops[i]
      ctx.fillStyle = d.c
      ctx.fillRect(Math.round(d.x * up), Math.round(d.y * up), up, up * 2)
    }
  }

  /* ==================================================================
     WATERING

     The bed comes up sparse and small — a scatter of seedlings in the
     soil. Bring the watering can over it and tap, and the seedlings
     within reach of the pour grow up into full blooms. It steps at
     twelve frames a second and moves in whole art pixels, like
     everything else on this page; it does not ease.
     ================================================================== */
  const STILL = window.matchMedia('(prefers-reduced-motion: reduce)')
  const FPS = 12
  const GROW_STEP = 0.09    // how much a growing plant climbs per frame
  const POUR = 44           // the core of the pour: a full, growing bloom
  const POUR_WIDE = 120     // and a wider reach that nudges the sides awake
  const GROW_MAX = 1.15     // repeated watering grows a bloom a little bigger
  const SPREAD = 30         // a grown bloom coaxes a neighbour this near

  let running = false
  let lastStep = 0
  let pressing = false

  function tick(t) {
    if (t - lastStep >= 1000 / FPS) {
      lastStep = t
      let alive = false
      for (let i = 0; i < plants.length; i++) {
        const p = plants[i]
        if (p.grow < p.growTo) {
          p.grow = Math.min(p.growTo, p.grow + GROW_STEP)
          alive = true
        }
      }
      /* Spreading. A bloom that has fully opened coaxes its nearest
         still-dormant neighbour up — once — so a watered patch does not
         stay a patch: it creeps outward, along the bottom and out to the
         sides, a flower at a time. */
      for (let i = 0; i < plants.length; i++) {
        const p = plants[i]
        if (p.grow < 0.9 || p.spread) continue
        p.spread = true
        let best = -1
        let bestD = SPREAD * SPREAD
        for (let j = 0; j < plants.length; j++) {
          const q = plants[j]
          if (q.growTo > 0.3) continue
          const dx = q.cx - p.cx
          const dy = q.cy - p.cy
          const d = dx * dx + dy * dy
          if (d < bestD) { bestD = d; best = j }
        }
        if (best >= 0) { plants[best].growTo = 1; alive = true }
      }
      if (drops.length) {
        for (let i = 0; i < drops.length; i++) {
          const d = drops[i]
          d.x += d.vx
          d.y += d.vy
          d.vy += 0.55
          d.life--
        }
        drops = drops.filter((d) => d.life > 0 && d.y < artH + 4)
        alive = alive || drops.length > 0
      }
      paint()
      if (!alive) { running = false; return }
    }
    requestAnimationFrame(tick)
  }

  function wake() {
    if (running || STILL.matches) return
    running = true
    lastStep = 0
    requestAnimationFrame(tick)
  }

  // pour at a client point: grow the seedlings under it, and let a
  // handful of drops fall from the spout to the soil
  function water(clientX, clientY) {
    if (!plants.length || !artW) return
    const r = canvas.getBoundingClientRect()
    if (!r.width) return
    const ax = ((clientX - r.left) / r.width) * artW
    const ay = clamp(((clientY - r.top) / r.height) * artH, 0, artH)
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i]
      const d = Math.abs(p.cx - ax)
      if (d <= POUR) {
        // right under the pour: bloom, and keep growing bigger each pour
        p.growTo = Math.min(GROW_MAX, Math.max(p.growTo, 0.55) + 0.4)
      } else if (d <= POUR_WIDE && p.growTo < 1) {
        // out toward the sides: nudge the seedlings awake a little
        p.growTo = Math.min(1, p.growTo + 0.18)
      }
    }
    for (let i = 0; i < 7; i++) {
      drops.push({
        x: ax + (rand() - 0.5) * 22,
        y: ay + (rand() - 0.5) * 6,
        vx: (rand() - 0.5) * 0.5,
        vy: 1.1 + rand() * 1.3,
        life: 9 + Math.round(rand() * 8),
        c: rand() < 0.5 ? '#cdeeff' : '#93d3f6',
      })
    }
    wake()
  }

  // ephemeral randomness only — nothing here decides layout, so it is
  // allowed to differ between taps
  function rand() { return Math.random() }

  if (!STILL.matches) {
    waterer.addEventListener('pointerdown', (e) => {
      pressing = true
      // capture only the mouse: capturing a touch would swallow the
      // page scroll that starts on this band at the foot of the page
      if (e.pointerType === 'mouse' && waterer.setPointerCapture) {
        waterer.setPointerCapture(e.pointerId)
      }
      water(e.clientX, e.clientY)
    })
    waterer.addEventListener('pointermove', (e) => {
      // drag-to-water is a mouse affordance; on touch a move is a scroll,
      // so leave it alone
      if (pressing && e.pointerType === 'mouse') water(e.clientX, e.clientY)
    }, { passive: true })
    const release = () => { pressing = false }
    waterer.addEventListener('pointerup', release)
    waterer.addEventListener('pointercancel', release)
    window.addEventListener('blur', release)
  }

  function build() {
    const root = document.documentElement
    /* Day has no city theming anywhere in the stylesheet, and New York
       has no flower at all — either way, nothing to plant. */
    const def = root.dataset.mode === 'day' ? null : FLOWERS[root.dataset.city]
    col.classList.toggle('col--bare', !def)
    if (!def) {
      canvas.style.display = 'none'
      waterer.style.display = 'none'
      bedCanvas = null
      plants = []
      return
    }
    canvas.style.display = 'block'
    waterer.style.display = 'block'

    const cs = getComputedStyle(col)
    const cssW = col.clientWidth
    if (cssW < 80) return
    const W = Math.ceil(cssW / SCALE)

    /* The bed grows up out of the bottom edge only, into the column's
       bottom padding, stopping a bloom short of it so a clear gap stays
       under the copyright. No arms up the sides any more. */
    const GAP = 12
    /* A LOW strip along the very bottom of the screen, not a tall band up
       the modal. Capped well under what the padding would allow, so the
       bed hugs the floor and the rest of the padding is just clear air
       under the copyright. */
    const room = Math.round(parseFloat(cs.paddingBottom) / SCALE - def.size[1] - GAP)
    const baseDepth = clamp(room, 14, 26)
    // headroom above the band for a bloom's head and a little growth
    const H = baseDepth + Math.ceil(def.size[1] * 1.9) + 6
    // a dense seed grid so a watered bed fills in fully, like a real bed,
    // and there is always somewhere to spread into — including the sides.
    // They start invisibly small, so the bed reads as bare until watered.
    const count = clamp(Math.round(cssW / 22), 18, 120)

    artW = W
    artH = H
    /* Smaller plants: shrink the whole flower — bloom, leaves, buds and
       stems — together, so a watered bed is a low, fine scatter rather
       than a row of big heads. The band keeps its size (off the original
       bloom), so the small flowers sit in a little more air. */
    const PLANT_SCALE = 0.62
    const sdef = { ...def, size: [def.size[0] * PLANT_SCALE, def.size[1] * PLANT_SCALE] }
    const built = garland(W, H, sdef, { baseDepth: baseDepth, count: count })
    bedCanvas = toCanvas(built.bed)
    plants = built.plants.map((p) => {
      // seedlings start small; reduced motion just shows them grown,
      // since there is no watering to do without the animation
      const g = STILL.matches ? 1 : 0.1 + rand() * 0.14
      return {
        canvas: toCanvas(p.buf),
        ox: p.ox, oy: p.oy, w: p.w, h: p.h,
        cx: p.cx, cy: p.cy, fx: p.fx, fy: p.fy,
        grow: g, growTo: g, spread: false,
      }
    })
    drops = []

    src.width = W
    src.height = H
    srcCtx.imageSmoothingEnabled = false

    up = Math.max(1, Math.round(SCALE * Math.min(2, window.devicePixelRatio || 1)))
    canvas.width = W * up
    canvas.height = H * up
    canvas.style.height = (H * SCALE) + 'px'
    // the watering surface covers exactly the bed's band
    waterer.style.height = (H * SCALE) + 'px'
    paint()
  }

  let queued = 0
  function schedule() {
    if (queued) cancelAnimationFrame(queued)
    queued = requestAnimationFrame(() => { queued = 0; build() })
  }

  // The city and the mode both live on <html>, set by the scene.
  new MutationObserver(schedule).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-city', 'data-mode'],
  })

  /* Only the column's WIDTH changes the bed. */
  let lastW = -1
  new ResizeObserver(() => {
    const w = col.clientWidth
    if (w === lastW) return
    lastW = w
    schedule()
  }).observe(col)

  build()
})()
