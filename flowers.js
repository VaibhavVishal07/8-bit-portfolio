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

    const cover = (x, y) => {
      const base = 1 - (H - y) / geo.baseDepth
      const ds = Math.min(x, W - 1 - x)
      const ty = clamp01((y - (H - geo.armRise)) / geo.armRise)
      const arm = (1 - ds / geo.armDepth) * Math.pow(ty, 1.7)
      return clamp01(Math.max(base, arm))
    }

    /* Which way is "out of the garland" from here — down at the
       bottom, sideways up the arms. Stems grow in along it and leaves
       lie across it. */
    const outward = (x, y) => {
      const base = 1 - (H - y) / geo.baseDepth
      const ds = Math.min(x, W - 1 - x)
      const ty = clamp01((y - (H - geo.armRise)) / geo.armRise)
      const arm = (1 - ds / geo.armDepth) * Math.pow(ty, 1.7)
      if (arm > base) return x < W / 2 ? Math.PI : 0
      return Math.PI / 2
    }

    /* Blooms are allowed to start outside the rectangle and be cut off
       by it. That is what makes the garland touch the edges of the
       column rather than stop politely a few pixels short of them. */
    const spots = []
    const tries = W * 15
    for (let i = 0; i < tries && spots.length < 190; i++) {
      const x = -5 + rnd() * (W + 10)
      const y = H + 3 - rnd() * (geo.armRise + 6)
      const c = cover(x, y)
      if (c <= 0.02) continue
      if (rnd() > Math.pow(c, 0.68)) continue
      const R = (def.size[0] + rnd() * (def.size[1] - def.size[0])) * (0.72 + 0.44 * c)
      // overlapping is the point; landing on the same pixel is a smudge
      let ok = true
      for (let j = 0; j < spots.length; j++) {
        const s = spots[j]
        const gx = s.x - x
        const gy = s.y - y
        const gap = (s.R + R) * 0.78
        if (gx * gx + gy * gy < gap * gap) { ok = false; break }
      }
      if (!ok) continue
      spots.push({ x: x, y: y, R: R, c: c })
    }

    /* ---- the bed ----
       Leaves first, all of them, in a ramp two stops short of the full
       one so the foliage sits behind the blooms rather than competing
       with them. */
    for (let i = 0; i < 2500; i++) {
      const x = -5 + rnd() * (W + 10)
      const y = H + 3 - rnd() * (geo.armRise + 6)
      const c = cover(x, y)
      if (c <= 0.02 || rnd() > Math.pow(c, 0.75)) continue
      const a = outward(x, y) + Math.PI + (rnd() - 0.5) * 2.2
      const len = def.size[1] * (0.9 + rnd() * 1.1)
      leaf(bed, x, y, a, len, len * 0.30, Lback, {
        base: -0.10 + c * 0.10,
        veins: 5,
        serr: def.leafSerr,
      })
    }

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
      // because the sprite has to be cut to fit it
      const reach = s.R * (1.9 + rnd() * 1.8)
      const bend = (rnd() - 0.5) * 2.4
      const count = 1 + (rnd() < 0.5 ? 1 : 0)
      const leaves = []
      for (let k = 0; k < count; k++) {
        leaves.push({
          t: 0.35 + rnd() * 0.45,
          side: k % 2 ? 1 : -1,
          len: s.R * (0.9 + rnd() * 0.8),
          lean: 0.7 + rnd() * 0.5,
        })
      }

      const footX = s.x + cos * reach
      const footY = s.y + sin * reach
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
        buf: sub, ox: ox, oy: oy,
        // the bloom's own centre, which is what a cursor is measured to
        cx: s.x, cy: s.y, R: s.R,
        dx: 0, dy: 0,
      })
    }

    /* ---- buds and fallen petals ----
       The small stuff that fills the gaps between blooms. A garland
       that is all open flowers reads as a pattern; the half-open ones,
       and the few petals lying on the bottom edge, are what make it
       read as a heap. These stay in the bed: they are the litter the
       flowers stand in, and litter does not flinch. */
    for (let i = 0; i < 900; i++) {
      const x = -4 + rnd() * (W + 8)
      const y = H + 2 - rnd() * (geo.armRise + 4)
      const c = cover(x, y)
      if (c <= 0.06 || rnd() > Math.pow(c, 1.5) * 0.13) continue
      bud(bed, x, y, def.size[0] * (0.34 + rnd() * 0.26), P, S, rnd, -0.06,
        outward(x, y) + Math.PI + (rnd() - 0.5) * 1.4)
    }

    for (let i = 0; i < 260; i++) {
      const x = -4 + rnd() * (W + 8)
      const y = H + 2 - rnd() * (geo.baseDepth * 0.55)
      if (cover(x, y) < 0.5 || rnd() > 0.22) continue
      const len = def.size[0] * (0.42 + rnd() * 0.34)
      petal(bed, x, y, rnd() * TAU, len, len * 0.60, P, {
        prof: PROFILE.round, notch: def.form === 'blossom', tipBias: 0.8, base: -0.04,
      })
    }

    return { bed: bed, plants: plants }
  }

  /* ==================================================================
     WIRING
     ================================================================== */
  const canvas = document.createElement('canvas')
  canvas.className = 'col__flowers'
  canvas.setAttribute('aria-hidden', 'true')
  col.appendChild(canvas)

  const src = document.createElement('canvas')
  const srcCtx = src.getContext('2d')

  /* One canvas per sprite, cut once. Compositing is then two hundred
     drawImage calls of a few dozen pixels each, which is cheap enough
     to do on every step of the parting. */
  function toCanvas(b) {
    const c = document.createElement('canvas')
    c.width = b.w
    c.height = b.h
    c.getContext('2d').putImageData(new ImageData(b.data, b.w, b.h), 0, 0)
    return c
  }

  let bedCanvas = null
  let plants = []
  let artW = 0
  let artH = 0

  function paint() {
    if (!bedCanvas) return
    srcCtx.clearRect(0, 0, artW, artH)
    srcCtx.drawImage(bedCanvas, 0, 0)
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i]
      srcCtx.drawImage(p.canvas, p.ox + p.dx, p.oy + p.dy)
    }
    const g = canvas.getContext('2d')
    g.imageSmoothingEnabled = false
    g.clearRect(0, 0, canvas.width, canvas.height)
    g.drawImage(src, 0, 0, canvas.width, canvas.height)
  }

  /* ==================================================================
     THE PARTING

     Bring a cursor up to the garland and the flowers near it lean
     away, then stand back up when it leaves. It is the one piece of
     this page that answers to the mouse directly, so it has to behave
     like everything else here: it steps at twelve frames a second, it
     moves in whole art pixels, and it does not ease.

     Only the flowering stems move. The bed they stand in — the
     leaves, the buds, the petals on the floor — is one baked layer and
     stays put, which is also what keeps the effect cheap.
     ================================================================== */
  const STILL = window.matchMedia('(prefers-reduced-motion: reduce)')

  // how near the cursor has to be before a bloom notices, and how far
  // it will go to get out of the way — both in art pixels
  const REACH = 66
  const SHOVE = 13
  // a bloom leans sideways more readily than it lifts, because a stem
  // bends and does not jump
  const RISE = 0.62
  // how far a bloom trembles once the cursor is on it
  const SHIVER = 2.2
  const FPS = 12
  const STEP = 3

  let pointerX = null
  let pointerY = null
  let running = false
  let lastStep = 0
  let beat = 0

  function targets() {
    if (pointerX === null || !plants.length) return false
    const r = canvas.getBoundingClientRect()
    if (!r.width || !r.height) return false
    // client space to art space
    const ax = ((pointerX - r.left) / r.width) * artW
    const ay = ((pointerY - r.top) / r.height) * artH
    // a cursor nowhere near the strip is the common case, so leave early
    const near = pointerX >= r.left - 80 && pointerX <= r.right + 80 &&
                 pointerY >= r.top - 80 && pointerY <= r.bottom + 80
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i]
      p.tx = 0
      p.ty = 0
      if (!near) continue
      const gx = p.cx - ax
      const gy = p.cy - ay
      const d = Math.sqrt(gx * gx + gy * gy)
      if (d >= REACH) continue
      const f = 1 - d / REACH
      const push = SHOVE * f * f
      // dead centre gives no direction to run in, so pick one
      const ux = d < 0.001 ? 0.7 : gx / d
      const uy = d < 0.001 ? -0.7 : gy / d
      const shake = SHIVER * f
      p.tx = Math.round(ux * push + Math.sin(beat * 1.7 + p.ph) * shake)
      p.ty = Math.round(uy * push * RISE + Math.cos(beat * 2.3 + p.ph * 1.7) * shake * 0.7)
    }
    return true
  }

  function step() {
    let moved = false
    for (let i = 0; i < plants.length; i++) {
      const p = plants[i]
      const wx = p.tx || 0
      const wy = p.ty || 0
      if (p.dx !== wx) {
        const d = wx - p.dx
        p.dx += Math.sign(d) * Math.min(STEP, Math.abs(d))
        moved = true
      }
      if (p.dy !== wy) {
        const d = wy - p.dy
        p.dy += Math.sign(d) * Math.min(STEP, Math.abs(d))
        moved = true
      }
    }
    return moved
  }

  function tick(t) {
    if (t - lastStep >= 1000 / FPS) {
      lastStep = t
      beat++
      targets()
      /* Nothing moved this step, so the garland is wherever it was asked
         to be and there is no work left. Stop — a pointer resting near a
         flower is a settled state, not an animation. The next move, or
         the next scroll, wakes it. */
      if (step()) paint()
      else { running = false; return }
    }
    requestAnimationFrame(tick)
  }

  function wake() {
    if (running || STILL.matches) return
    running = true
    lastStep = 0
    requestAnimationFrame(tick)
  }

  if (!STILL.matches) {
    window.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'touch') return
      pointerX = e.clientX
      pointerY = e.clientY
      wake()
    }, { passive: true })

    /* Pointer gone from the window: everything stands back up, and the
       loop is allowed to stop once it has. */
    document.addEventListener('pointerleave', () => { pointerX = null; pointerY = null; wake() })

    /* Scrolling moves the strip out from under a stationary cursor, so
       the garland has to be asked again where the cursor now is. */
    const scroller = col.closest('.page')
    if (scroller) scroller.addEventListener('scroll', wake, { passive: true })
    window.addEventListener('blur', () => { pointerX = null; pointerY = null; wake() })
  }

  function build() {
    const root = document.documentElement
    /* Day has no city theming anywhere in the stylesheet — no panel
       colour, no neon frame — so it gets no garland either. New York
       has no flower at all. Either way: nothing to draw. */
    const def = root.dataset.mode === 'day' ? null : FLOWERS[root.dataset.city]
    /* The column reserves a deep bottom padding for the garland to grow
       into. With no garland that is just a hole under the copyright, so
       the column is told to close up. */
    col.classList.toggle('col--bare', !def)
    if (!def) {
      canvas.style.display = 'none'
      bedCanvas = null
      plants = []
      return
    }
    canvas.style.display = 'block'

    /* The band reaches exactly as far in as the column's own padding
       allows: the arms live in the side padding, the base in the
       bottom padding. Read rather than restated, so moving the padding
       in the stylesheet moves the flowers with it and they never land
       on a line of text. */
    const cs = getComputedStyle(col)
    const cssW = col.clientWidth
    if (cssW < 80) return
    const W = Math.ceil(cssW / SCALE)

    /* GAP is clear air, held between the top of the drift and whatever
       is above it. Without it the garland grows to fill whatever room
       the padding gives it and ends up touching the copyright again —
       the padding says how much room there is, this says how much of
       that room stays empty. */
    const GAP = 14
    /* The drift grows up from the bottom edge, and a bloom sitting at
       the top of it sticks out by its own radius — so the band stops one
       bloom short of the padding rather than filling it, which is what
       keeps a clear gap under the copyright line. */
    const baseDepth = Math.max(14, Math.round(parseFloat(cs.paddingBottom) / SCALE - def.size[1] - GAP))
    /* Same allowance sideways, at half strength: a bloom on the inner
       lip of an arm should mostly sit in the padding, but a few breaking
       the line is what stops the arms reading as two ruled stripes. On a
       phone the side padding is 16px and this collapses to just about
       exactly that. */
    const armDepth = clamp(
      Math.round(parseFloat(cs.paddingLeft) / SCALE - def.size[1] * 0.5 - GAP * 0.4), 8, 34)
    const armRise = Math.round(Math.min(cssW * 0.46, 400) / SCALE)
    const H = Math.max(baseDepth, armRise) + 2

    artW = W
    artH = H
    const built = garland(W, H, def, { baseDepth: baseDepth, armDepth: armDepth, armRise: armRise })
    bedCanvas = toCanvas(built.bed)
    plants = built.plants.map((p, i) => ({
      canvas: toCanvas(p.buf),
      ox: p.ox, oy: p.oy, cx: p.cx, cy: p.cy,
      dx: 0, dy: 0, tx: 0, ty: 0,
      // golden angle, so no two neighbours shake together
      ph: (i * 2.39996) % 6.28318,
    }))

    src.width = W
    src.height = H
    srcCtx.imageSmoothingEnabled = false

    const up = Math.max(1, Math.round(SCALE * Math.min(2, window.devicePixelRatio || 1)))
    canvas.width = W * up
    canvas.height = H * up
    canvas.style.height = (H * SCALE) + 'px'
    paint()
    wake()
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

  /* Only the column's WIDTH changes the garland. Its height changes
     every time a font settles or a section opens, and re-laying out a
     few hundred blooms for that would be work nobody can see. */
  let lastW = -1
  new ResizeObserver(() => {
    const w = col.clientWidth
    if (w === lastW) return
    lastW = w
    schedule()
  }).observe(col)

  build()
})()
