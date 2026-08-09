/* posters.js — procedural 8-bit cover art.

   Every card on the L2 screens carries a poster. Waiting on real
   artwork would have meant grey rectangles, and grey rectangles are
   what made the old pages feel dead — so the posters DRAW THEMSELVES:
   a seeded generator paints a different piece of pixel art for each
   card, in the same palette family as the rooftop scene.

   They are placeholders that happen to be worth looking at. Drop an
   <img> into a .card__art and it takes over; the canvas steps aside.

   Same rules as scene.js: fixed low-resolution buffers, nearest
   neighbour upscale, ordered dithering, no anti-aliasing anywhere. */

;(function () {
  'use strict'

  /* Deterministic noise. Same seed, same poster, every reload — a
     poster that reshuffled on refresh would read as a glitch. */
  function mulberry32(a) {
    return function () {
      a |= 0
      a = (a + 0x6d2b79f5) | 0
      let t = Math.imul(a ^ (a >>> 15), 1 | a)
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
  }

  // 4x4 Bayer — enough for poster-scale gradients, cheap to apply
  const BAYER = [
    [0, 8, 2, 10],
    [12, 4, 14, 6],
    [3, 11, 1, 9],
    [15, 7, 13, 5],
  ]

  function dot(g, x, y, t, col) {
    if (t <= 0) return
    if (t < 1 && BAYER[y & 3][x & 3] / 16 >= t) return
    g.fillStyle = col
    g.fillRect(x, y, 1, 1)
  }

  /* A vertical dithered wash — the workhorse behind every sky. */
  function wash(g, x, y, w, h, top, bottom, colA, colB) {
    for (let j = 0; j < h; j++) {
      const t = top + (bottom - top) * (j / (h - 1 || 1))
      for (let i = 0; i < w; i++) {
        g.fillStyle = colA
        g.fillRect(x + i, y + j, 1, 1)
        dot(g, x + i, y + j, t, colB)
      }
    }
  }

  /* Sprites written as strings: one character per pixel, '.' is a
     hole. Legible in the source, which is the whole point of pixel
     art living in a text file. */
  function sprite(g, rows, ox, oy, map) {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y]
      for (let x = 0; x < row.length; x++) {
        const c = row[x]
        if (c === '.' || !map[c]) continue
        g.fillStyle = map[c]
        g.fillRect(ox + x, oy + y, 1, 1)
      }
    }
  }

  /* ---- palettes ----
     Each kind gets its own family so a shelf of posters reads as a
     shelf of different things, not four prints of one thing. */
  const PAL = {
    work: [
      { sky: ['#1a0c3a', '#4a2a8c'], ink: '#0a0420', hi: '#ff3ea0', lo: '#7b4fd8', band: '#12082c' },
      { sky: ['#0d2340', '#2a7ab0'], ink: '#04101f', hi: '#19d7e8', lo: '#3f9fd0', band: '#07182c' },
      { sky: ['#3a1030', '#a03858'], ink: '#1a0616', hi: '#ffd21f', lo: '#e0662a', band: '#240a1e' },
      { sky: ['#0f2c22', '#2f9c6a'], ink: '#041a12', hi: '#2fe39a', lo: '#1d7a52', band: '#08211a' },
    ],
    book: [
      { bg: '#b8452f', ink: '#2a0f0a', hi: '#f0d8a8', lo: '#e0662a' },
      { bg: '#2f5fa8', ink: '#0c1c38', hi: '#e8f0ff', lo: '#7fb0e8' },
      { bg: '#3f8f6a', ink: '#0e2a1e', hi: '#f0f8d8', lo: '#a8d88f' },
    ],
    game: [
      { bg: '#160a30', ink: '#050214', hi: '#2fe39a', lo: '#a44dff' },
      { bg: '#2a0a20', ink: '#12020c', hi: '#ffd21f', lo: '#ff3ea0' },
    ],
    film: [
      { bg: '#101828', ink: '#04070f', hi: '#ffd8a0', lo: '#5a6f9c' },
      { bg: '#241028', ink: '#0c0410', hi: '#ff9ec0', lo: '#7c5090' },
    ],
    portrait: [
      { bg: '#241247', ink: '#0a0420', hi: '#19d7e8', lo: '#7b4fd8', skin: '#e8b08a' },
      { bg: '#1a2f4a', ink: '#050f1c', hi: '#ff3ea0', lo: '#3f6fa0', skin: '#c98f6a' },
    ],
    music: [
      { bg: '#1c1030', ink: '#080418', hi: '#19d7e8', lo: '#a44dff' },
      { bg: '#301818', ink: '#140808', hi: '#ffd21f', lo: '#e0662a' },
    ],
  }

  /* ================= the kinds ================= */

  /* A city poster: skyline, moon, one hot neon accent. The work cards
     wear the same city the visitor is standing in. */
  function drawWork(g, W, H, rnd, p) {
    wash(g, 0, 0, W, H, 0.05, 0.95, p.sky[0], p.sky[1])

    // moon or sun, high and small
    const mx = 14 + Math.floor(rnd() * (W - 28))
    const my = 12 + Math.floor(rnd() * 14)
    const mr = 5 + Math.floor(rnd() * 4)
    for (let y = -mr; y <= mr; y++) {
      for (let x = -mr; x <= mr; x++) {
        if (x * x + y * y > mr * mr) continue
        g.fillStyle = '#f4ecd8'
        g.fillRect(mx + x, my + y, 1, 1)
      }
    }

    // stars, only in the upper half
    for (let i = 0; i < 26; i++) {
      dot(g, Math.floor(rnd() * W), Math.floor(rnd() * (H * 0.5)), 0.8, '#cfc2ee')
    }

    // a far ridge, then a near skyline: two planes is all a poster needs
    const base = H - 14
    let x = 0
    while (x < W) {
      const bw = 5 + Math.floor(rnd() * 9)
      const bh = 16 + Math.floor(rnd() * 30)
      g.fillStyle = p.lo
      g.fillRect(x, base - bh, bw, bh)
      x += bw + 1
    }
    x = 0
    while (x < W) {
      const bw = 7 + Math.floor(rnd() * 12)
      const bh = 24 + Math.floor(rnd() * 40)
      g.fillStyle = p.ink
      g.fillRect(x, base - bh + 8, bw, bh)
      // lit windows
      for (let wy = base - bh + 11; wy < base + 6; wy += 4) {
        for (let wx = x + 2; wx < x + bw - 1; wx += 3) {
          if (rnd() < 0.42) {
            g.fillStyle = rnd() < 0.22 ? p.hi : '#f4d98a'
            g.fillRect(wx, wy, 1, 1)
          }
        }
      }
      x += bw + 2
    }

    // haze pooling at street level: the towers have to sit IN light,
    // not on top of a flat field
    for (let y = base - 18; y < base + 8; y++) {
      const t = 1 - Math.abs(y - (base - 4)) / 14
      for (let x = 0; x < W; x++) dot(g, x, y, t * 0.30, p.hi)
    }
    // one neon sign, because one is a focal point and three is noise
    const sx = 6 + Math.floor(rnd() * (W - 20))
    const sy = base - 14 - Math.floor(rnd() * 10)
    g.fillStyle = p.hi
    g.fillRect(sx, sy, 9, 2)
    dot(g, sx - 1, sy, 0.5, p.hi)
    dot(g, sx + 9, sy + 1, 0.5, p.hi)

    // ground band
    g.fillStyle = p.band
    g.fillRect(0, base + 6, W, H - base - 6)
  }

  /* A book cover: flat colour, one icon, a spine down the left. */
  function drawBook(g, W, H, rnd, p) {
    g.fillStyle = p.bg
    g.fillRect(0, 0, W, H)

    // spine
    g.fillStyle = p.ink
    g.fillRect(0, 0, 5, H)
    g.fillStyle = p.lo
    g.fillRect(5, 0, 1, H)

    // a border rule, the way old paperbacks do it
    g.fillStyle = p.hi
    g.fillRect(10, 8, W - 16, 1)
    g.fillRect(10, H - 12, W - 16, 1)

    // one of three simple cover devices
    const pick = Math.floor(rnd() * 3)
    const cx = 10 + Math.floor((W - 16) / 2)
    const cy = Math.floor(H / 2) - 4

    if (pick === 0) {
      // mountains and a sun
      g.fillStyle = p.hi
      for (let y = 0; y < 9; y++) {
        for (let x = -9; x <= 9; x++) {
          if (x * x + (y - 4) * (y - 4) <= 20) g.fillRect(cx + x, cy - 10 + y, 1, 1)
        }
      }
      g.fillStyle = p.ink
      for (let i = 0; i < 16; i++) {
        g.fillRect(cx - 16 + i, cy + 8 - i, 1, i + 1)
        g.fillRect(cx + 16 - i, cy + 8 - i, 1, i + 1)
      }
    } else if (pick === 1) {
      // a wave
      g.fillStyle = p.ink
      for (let x = 10; x < W - 6; x++) {
        const y = cy + Math.round(Math.sin(x / 5) * 5)
        g.fillRect(x, y, 1, H - 12 - y)
      }
      g.fillStyle = p.hi
      for (let x = 10; x < W - 6; x++) {
        g.fillRect(x, cy + Math.round(Math.sin(x / 5) * 5), 1, 1)
      }
    } else {
      // a key, for the kind of book that has one
      sprite(
        g,
        ['..hh..', '.h..h.', '.h..h.', '..hh..', '...h..', '...h..', '...hh.', '...h..', '...hh.'],
        cx - 3,
        cy - 8,
        { h: p.hi }
      )
    }

    // title bars: unreadable on purpose, they are a promise of type
    g.fillStyle = p.ink
    g.fillRect(12, H - 26, Math.floor((W - 20) * (0.5 + rnd() * 0.4)), 3)
    g.fillRect(12, H - 20, Math.floor((W - 20) * (0.3 + rnd() * 0.3)), 2)
  }

  /* An arcade marquee: stripes, a starfield, and a little enemy. */
  function drawGame(g, W, H, rnd, p) {
    g.fillStyle = p.bg
    g.fillRect(0, 0, W, H)

    // starfield
    for (let i = 0; i < 40; i++) {
      dot(g, Math.floor(rnd() * W), Math.floor(rnd() * H), 0.7, '#cfc2ee')
    }

    // diagonal marquee stripes across the top third
    for (let i = -H; i < W; i += 8) {
      g.fillStyle = i % 16 === 0 ? p.hi : p.lo
      for (let y = 0; y < 22; y++) {
        g.fillRect(i + y, y, 4, 1)
      }
    }

    // the invader
    const s = [
      '..h.....h..',
      '...h...h...',
      '..hhhhhhh..',
      '.hh.hhh.hh.',
      'hhhhhhhhhhh',
      'h.hhhhhhh.h',
      'h.h.....h.h',
      '...hh.hh...',
    ]
    sprite(g, s, Math.floor(W / 2) - 5, Math.floor(H / 2) - 6, { h: p.hi })

    // a ship below it, outgunned
    sprite(g, ['..l..', '.lll.', 'lllll'], Math.floor(W / 2) - 2, H - 26, { l: '#f4ecd8' })

    // score line
    g.fillStyle = p.hi
    for (let x = 8; x < W - 8; x += 3) g.fillRect(x, H - 14, 2, 1)
  }

  /* A film still: letterboxed, one silhouette, one light source. */
  function drawFilm(g, W, H, rnd, p) {
    g.fillStyle = p.ink
    g.fillRect(0, 0, W, H)
    const top = 18
    const h = H - 36
    wash(g, 0, top, W, h, 0.1, 0.9, p.bg, p.lo)

    // sun low on the horizon
    const cx = 12 + Math.floor(rnd() * (W - 24))
    const hy = top + h - 14
    for (let y = -7; y <= 7; y++) {
      for (let x = -7; x <= 7; x++) {
        if (x * x + y * y > 49) continue
        g.fillStyle = p.hi
        g.fillRect(cx + x, hy + y - 4, 1, 1)
      }
    }

    // horizon and a lone figure
    g.fillStyle = p.ink
    g.fillRect(0, hy + 4, W, top + h - hy - 4)
    const fx = 10 + Math.floor(rnd() * (W - 20))
    sprite(g, ['.hh.', '.hh.', 'hhhh', '.hh.', '.hh.', '.h.h', 'h..h'], fx, hy - 3, { h: p.ink })

    // letterbox bars go last so nothing bleeds into them
    g.fillStyle = '#000'
    g.fillRect(0, 0, W, top)
    g.fillRect(0, H - 18, W, 18)
  }

  /* A record sleeve: concentric grooves, a label, a highlight. */
  function drawMusic(g, W, H, rnd, p) {
    g.fillStyle = p.bg
    g.fillRect(0, 0, W, H)
    const cx = Math.floor(W / 2)
    const cy = Math.floor(H / 2) - 2
    const R = Math.min(cx, cy) - 6

    for (let y = -R; y <= R; y++) {
      for (let x = -R; x <= R; x++) {
        const d = Math.sqrt(x * x + y * y)
        if (d > R) continue
        if (d < 5) g.fillStyle = p.hi
        else if (d < 6.5) g.fillStyle = p.ink
        else g.fillStyle = Math.floor(d) % 3 === 0 ? p.lo : p.ink
        g.fillRect(cx + x, cy + y, 1, 1)
      }
    }
    // the shine across the disc
    for (let i = 0; i < R * 2; i++) {
      dot(g, cx - R + i, cy - R + Math.floor(i * 0.6), 0.35, '#f4ecd8')
    }
    g.fillStyle = p.ink
    g.fillRect(cx - 1, cy - 1, 2, 2)
  }

  /* A bust, in silhouette. Not a likeness - a stand-in with enough
     character that the sheet is not built around an empty rectangle.
     Swap in a real photo and this steps aside. */
  function drawPortrait(g, W, H, rnd, p) {
    wash(g, 0, 0, W, H, 0.15, 0.85, p.bg, p.lo)

    // a window of city behind the shoulder, because that is where
    // this whole site is standing
    for (let i = 0; i < 7; i++) {
      const bw = 6 + Math.floor(rnd() * 10)
      const bh = 14 + Math.floor(rnd() * 26)
      g.fillStyle = p.ink
      g.fillRect(i * 15, H - 40 - bh, bw, bh + 40)
      for (let wy = H - 38 - bh; wy < H - 30; wy += 4) {
        for (let wx = i * 15 + 2; wx < i * 15 + bw - 1; wx += 3) {
          if (rnd() < 0.35) {
            g.fillStyle = '#f4d98a'
            g.fillRect(wx, wy, 1, 1)
          }
        }
      }
    }

    const cx = Math.floor(W / 2)
    const top = Math.floor(H * 0.30)

    // shoulders
    g.fillStyle = p.ink
    for (let y = 0; y < H - top - 34; y++) {
      const half = 20 + y
      g.fillRect(Math.max(0, cx - half), top + 34 + y, Math.min(W, half * 2), 1)
    }

    // neck and head
    g.fillStyle = p.skin
    g.fillRect(cx - 4, top + 26, 8, 10)
    g.fillRect(cx - 10, top + 4, 20, 26)
    // hair
    g.fillStyle = p.ink
    g.fillRect(cx - 11, top, 22, 8)
    g.fillRect(cx - 11, top, 3, 16)
    g.fillRect(cx + 8, top, 3, 16)
    // eyes, and nothing else - a face at this size is two pixels
    g.fillStyle = p.ink
    g.fillRect(cx - 6, top + 15, 2, 2)
    g.fillRect(cx + 4, top + 15, 2, 2)
    // one accent: a headphone band, because it is that kind of portrait
    g.fillStyle = p.hi
    g.fillRect(cx - 13, top + 12, 3, 8)
    g.fillRect(cx + 10, top + 12, 3, 8)
    g.fillRect(cx - 12, top - 2, 24, 2)
  }

  const KIND = {
    work: drawWork,
    book: drawBook,
    game: drawGame,
    film: drawFilm,
    music: drawMusic,
    portrait: drawPortrait,
  }

  /* Paint one canvas. The element carries its own instructions:
     data-poster="game" data-seed="7". */
  function paint(cv) {
    const kind = cv.dataset.poster || 'work'
    const seed = parseInt(cv.dataset.seed || '1', 10)
    const draw = KIND[kind] || drawWork

    // Internal resolution is fixed and small; CSS stretches it with
    // image-rendering: pixelated, so the art scales without softening.
    const W = kind === 'work' ? 176 : 96
    const H = kind === 'work' ? 99 : 132
    cv.width = W
    cv.height = H

    const g = cv.getContext('2d')
    g.imageSmoothingEnabled = false

    const rnd = mulberry32(seed * 2654435761)
    const fam = PAL[kind] || PAL.work
    const p = fam[Math.floor(rnd() * fam.length)]

    draw(g, W, H, rnd, p)

    /* A hard inner frame, the way a printed poster has a trim edge. */
    g.fillStyle = 'rgba(0,0,0,0.55)'
    g.fillRect(0, 0, W, 1)
    g.fillRect(0, H - 1, W, 1)
    g.fillRect(0, 0, 1, H)
    g.fillRect(W - 1, 0, 1, H)
  }

  function paintAll(root) {
    ;(root || document).querySelectorAll('canvas[data-poster]').forEach((cv) => {
      if (cv.dataset.painted) return
      paint(cv)
      cv.dataset.painted = '1'
    })
  }

  window.Posters = { paint, paintAll }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => paintAll())
  } else {
    paintAll()
  }
})()
