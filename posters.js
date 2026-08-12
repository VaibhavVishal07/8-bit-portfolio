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
  function sprite(g, rows, ox, oy, map, s) {
    const k = s || 1
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y]
      for (let x = 0; x < row.length; x++) {
        const c = row[x]
        if (c === '.' || !map[c]) continue
        g.fillStyle = map[c]
        g.fillRect(ox + x * k, oy + y * k, k, k)
      }
    }
  }

  /* ---- palettes ----
     Each kind gets its own family so a shelf of posters reads as a
     shelf of different things, not four prints of one thing. */
  const PAL = {
    /* One hue per project, carried over from the covers these replace —
       the coral, the green, the blue and the pink. Four cards in four
       colours is how a set of four stays a set and still lets you say
       "the green one". */
    cover: [
      { bg: '#120a0a', grid: '#7a423a', cell: '#3a221e', ink: '#2e1714', hi: '#f5a08f', lo: '#a8564a' },
      { bg: '#0a140d', grid: '#44784c', cell: '#1f3a26', ink: '#132d1a', hi: '#a8e8a0', lo: '#4f8a58' },
      { bg: '#0a0d16', grid: '#4d6396', cell: '#232d46', ink: '#161e33', hi: '#aec2f5', lo: '#5c72ac' },
      { bg: '#150a12', grid: '#96507c', cell: '#42233a', ink: '#301628', hi: '#ffb0dc', lo: '#b85f92' },
    ],
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
    /* Four handhelds, not four copies of one. The shelf should read
       like somebody's actual collection: the grey brick, the berry
       and teal Colors, and the clear-plastic one everybody wanted. */
    /* Famicom shells. The plastic is the loud part and the label is
       where the game lives - which is the opposite of a modern box,
       and the reason a shelf of these reads so well. */
    cart: [
      { shell: '#d8cfb4', light: '#eee7d2', dark: '#a89f86', label: '#f2ecdc', ink: '#2a2620', accent: '#c0392b' },
      { shell: '#2f9aa8', light: '#4fbccb', dark: '#1d6f7a', label: '#f2ecdc', ink: '#10333a', accent: '#e8683c' },
      { shell: '#c0392b', light: '#d9584a', dark: '#8c2820', label: '#f2ecdc', ink: '#3a1410', accent: '#f0c040' },
      { shell: '#26242a', light: '#413e47', dark: '#131218', label: '#e8e2d2', ink: '#1a181e', accent: '#3ad0c8' },
      { shell: '#e8a13c', light: '#f5bd63', dark: '#b57424', label: '#f7f1e0', ink: '#3d2a0e', accent: '#2f7f86' },
      { shell: '#6b5ea8', light: '#8a7cc8', dark: '#4a3f7a', label: '#efe9f5', ink: '#241d40', accent: '#f0c040' },
    ],
    gb: [
      { body: '#c8c4b0', dark: '#8e8b7c', light: '#e2dfcd', trim: '#5a5750',
        screen: '#4a5a3c', pad: '#4a4458', btn: '#c02a5e', text: '#8e8b7c' },
      { body: '#8e3f6e', dark: '#5f2849', light: '#b2618f', trim: '#3a1a2c',
        screen: '#3c4a52', pad: '#2c1a24', btn: '#f0c040', text: '#5f2849' },
      { body: '#2f7f86', dark: '#1e565c', light: '#4aa3aa', trim: '#143b40',
        screen: '#40503a', pad: '#122c30', btn: '#e8683c', text: '#1e565c' },
      { body: '#7a6f9c', dark: '#544a6e', light: '#9a8fc0', trim: '#332c46',
        screen: '#44404f', pad: '#2a2338', btn: '#3ad0c8', text: '#544a6e' },
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

  /* ---- the handheld ----
     The project poster does not sit in a frame any more, it PLAYS on
     a console: body, recessed screen, d-pad, two buttons, speaker
     grille. The city art is drawn into the screen area by the same
     function that draws the big covers, just handed a smaller canvas
     - so the thing on the screen is a real generated game, not a
     picture of one. */
  function drawHandheld(g, W, H, rnd, p) {
    g.fillStyle = p.body
    g.fillRect(0, 0, W, H)

    // moulded edges: light along the top-left, shadow bottom-right
    g.fillStyle = p.light
    g.fillRect(0, 0, W, 2)
    g.fillRect(0, 0, 2, H)
    g.fillStyle = p.dark
    g.fillRect(0, H - 2, W, 2)
    g.fillRect(W - 2, 0, 2, H)

    /* the screen well, inset and darker than the shell */
    const sx = 8
    const sy = 9
    const sw = W - 16
    const sh = Math.round(H * 0.44)
    g.fillStyle = p.trim
    g.fillRect(sx - 4, sy - 4, sw + 8, sh + 10)
    g.fillStyle = p.dark
    g.fillRect(sx - 2, sy - 2, sw + 4, sh + 4)

    // the game running on it
    g.save()
    g.beginPath()
    g.rect(sx, sy, sw, sh)
    g.clip()
    g.translate(sx, sy)
    drawWork(g, sw, sh, rnd, PAL.work[Math.floor(rnd() * PAL.work.length)])
    g.restore()

    // the power lamp, always on
    g.fillStyle = '#e04a4a'
    g.fillRect(3, sy + 6, 2, 2)

    /* the wordmark, in the dot-matrix way the original set it */
    const ly = sy + sh + 8
    g.fillStyle = p.text
    for (let i = 0; i < 7; i++) g.fillRect(sx + 6 + i * 5, ly, 3, 4)

    /* controls. A d-pad is a plus sign and everybody knows it. */
    const px = 14
    const py = ly + 12
    g.fillStyle = p.pad
    g.fillRect(px - 4, py + 4, 20, 6)
    g.fillRect(px + 3, py - 3, 6, 20)
    g.fillStyle = p.trim
    g.fillRect(px + 5, py + 6, 2, 2)

    // A and B, offset on the diagonal the way they always were
    g.fillStyle = p.btn
    const bx = W - 26
    for (const [ox, oy] of [[10, 0], [0, 7]]) {
      for (let y = -3; y <= 3; y++) {
        for (let x = -3; x <= 3; x++) {
          if (x * x + y * y > 10) continue
          g.fillRect(bx + ox + x, py + oy + y, 1, 1)
        }
      }
    }

    // speaker grille, on the diagonal in the bottom right corner
    g.fillStyle = p.dark
    for (let i = 0; i < 5; i++) {
      for (let k = 0; k < 7; k++) {
        g.fillRect(W - 22 + i * 3 + k, H - 16 + k, 2, 1)
      }
    }
  }

  /* ---- what is ON the label ----
     Six different games, not six photographs of the same city. Each
     one is a single character sitting on a flat field with a couple of
     props - which is exactly how cover art worked when the label was
     four centimetres wide and the artist had eight colours. Cute is
     the brief, so everything here has a face. */
  let currentSeed = 0

  const LABEL_ART = [
    // 1. the cat, sitting, tail curled
    (g, w, h, p) => {
      g.fillStyle = '#2b6ea8'
      g.fillRect(0, 0, w, h)
      const s = [
        '..k...k..', '.kkkkkkk.', 'kkwkkkwkk', 'kkkkkkkkk',
        'kkkppkkkk', '.kkkkkkk.', '..kkkkk..', '..k...kt.',
      ]
      sprite(g, s, Math.floor(w / 2) - 4, Math.floor(h / 2) - 4,
        { k: '#2a2436', w: '#8fe8ff', p: '#ff8fc0', t: '#2a2436' })
      // whiskers
      g.fillStyle = '#f4ecd8'
      g.fillRect(Math.floor(w / 2) - 8, Math.floor(h / 2) - 1, 3, 1)
      g.fillRect(Math.floor(w / 2) + 6, Math.floor(h / 2) - 1, 3, 1)
    },
    // 2. a little ghost, pleased with itself
    (g, w, h, p) => {
      g.fillStyle = '#241d40'
      g.fillRect(0, 0, w, h)
      const s = [
        '..ggggg..', '.ggggggg.', 'gggggggpg', 'gbggggbgg',
        'gggggggpg', 'ggwwwwwgg', 'ggggggggg', 'g.g.g.g.g',
      ]
      sprite(g, s, Math.floor(w / 2) - 4, Math.floor(h / 2) - 4,
        { g: '#e8e2f5', b: '#241d40', w: '#241d40', p: '#ff9ec0' })
    },
    // 3. a rocket going up, with a flame
    (g, w, h, p) => {
      g.fillStyle = '#101a34'
      g.fillRect(0, 0, w, h)
      const s = [
        '...r...', '..rrr..', '.rrwrr.', '.rrwrr.',
        '.rrrrr.', 'ro.r.or', '..f.f..', '...y...',
      ]
      sprite(g, s, Math.floor(w / 2) - 3, Math.floor(h / 2) - 5,
        { r: '#e8e2d2', w: '#3ad0c8', o: '#c0392b', f: '#e8683c', y: '#f0c040' })
      // stars
      for (let i = 0; i < 10; i++) {
        g.fillStyle = '#8fa8d8'
        g.fillRect((i * 13 + 5) % (w - 2), (i * 7 + 3) % (h - 2), 1, 1)
      }
    },
    // 4. a mushroom, because of course
    (g, w, h, p) => {
      g.fillStyle = '#2f7f4a'
      g.fillRect(0, 0, w, h)
      const s = [
        '..mmmmm..', '.mwmmmwm.', 'mmmmmmmmm', 'mwmmmmmwm',
        '.sssssss.', '..sbsbs..', '..sssss..', '..sssss..',
      ]
      sprite(g, s, Math.floor(w / 2) - 4, Math.floor(h / 2) - 4,
        { m: '#e05a5a', w: '#f7f1e0', s: '#f7f1e0', b: '#3d2a0e' })
    },
    // 5. a robot, waving
    (g, w, h, p) => {
      g.fillStyle = '#3a3550'
      g.fillRect(0, 0, w, h)
      const s = [
        '...a.a...', '.bbbbbbb.', '.beebbeeb', '.bbbbbbb.',
        '.bbmmmbb.', 'cbbbbbbbc', '.bbbbbbb.', '..b...b..',
      ]
      sprite(g, s, Math.floor(w / 2) - 4, Math.floor(h / 2) - 4,
        { b: '#9aa8c8', e: '#3ad0c8', m: '#f0c040', a: '#e8683c', c: '#6b7590' })
    },
    // 6. a duck. It has been in this scene from the start.
    (g, w, h, p) => {
      g.fillStyle = '#3aa8c8'
      g.fillRect(0, 0, w, h)
      const s = [
        '..yyyy...', '.yyyyyy..', 'yybyyyyoo', 'yyyyyyyy.',
        '.yyyyyyy.', '..yyyyy..', '...yyy...',
      ]
      sprite(g, s, Math.floor(w / 2) - 4, Math.floor(h / 2) - 3,
        { y: '#f0c83c', b: '#2a2620', o: '#e8683c' })
      // water line
      g.fillStyle = '#2a8aa8'
      g.fillRect(0, Math.floor(h / 2) + 4, w, h)
      g.fillStyle = '#6bc8e0'
      for (let x = 0; x < w; x += 4) g.fillRect(x, Math.floor(h / 2) + 4, 2, 1)
    },
  ]

  /* ---- the cartridge ----
     Shell, paper label, ridged grip. The label carries the art and a
     title block, the shell carries nothing but colour and mouldings -
     which is exactly the split the real ones had, and why a shelf of
     them reads as a collection at a glance. */
  function drawCart(g, W, H, rnd, p) {
    // shell, with the shoulder stepped in at the top like the real one
    g.fillStyle = p.shell
    g.fillRect(0, 4, W, H - 4)
    g.fillRect(6, 0, W - 12, 6)

    // mouldings
    g.fillStyle = p.light
    g.fillRect(6, 0, W - 12, 2)
    g.fillRect(0, 4, 2, H - 4)
    g.fillStyle = p.dark
    g.fillRect(W - 2, 4, 2, H - 4)
    g.fillRect(0, H - 2, W, 2)

    /* the paper label: inset, lighter than the shell, and sitting
       proud of it by one pixel of shadow */
    const lx = 8
    const ly = 9
    const lw = W - 16
    const lh = H - 34
    g.fillStyle = p.dark
    g.fillRect(lx - 1, ly - 1, lw + 2, lh + 2)
    g.fillStyle = p.label
    g.fillRect(lx, ly, lw, lh)

    // the header strip every one of these had, in unreadable small type
    g.fillStyle = p.ink
    for (let i = 0; i < 9; i++) g.fillRect(lx + 3 + i * 4, ly + 3, 2, 2)
    g.fillStyle = p.accent
    g.fillRect(lx + lw - 12, ly + 3, 9, 2)

    /* the art window - a real generated city, drawn by the same
       function that draws the big covers */
    const ax = lx + 3
    const ay = ly + 8
    const aw = lw - 6
    const ah = lh - 22
    g.save()
    g.beginPath()
    g.rect(ax, ay, aw, ah)
    g.clip()
    g.translate(ax, ay)
    LABEL_ART[currentSeed % LABEL_ART.length](g, aw, ah, p)
    g.restore()
    g.fillStyle = p.ink
    g.fillRect(ax, ay, aw, 1)
    g.fillRect(ax, ay + ah - 1, aw, 1)

    // title block under the art: three weights of bar, like a logotype
    g.fillStyle = p.ink
    g.fillRect(ax, ay + ah + 3, Math.round(aw * 0.46), 4)
    g.fillStyle = p.accent
    g.fillRect(ax + Math.round(aw * 0.5), ay + ah + 3, Math.round(aw * 0.22), 4)
    g.fillStyle = p.ink
    for (let i = 0; i < 5; i++) g.fillRect(ax + i * 5, ay + ah + 9, 3, 1)

    /* the grip: ridges moulded across the bottom lip, which is the
       detail your thumb remembers */
    g.fillStyle = p.dark
    for (let x = 10; x < W - 10; x += 5) g.fillRect(x, H - 18, 3, 12)
    g.fillStyle = p.light
    for (let x = 10; x < W - 10; x += 5) g.fillRect(x, H - 18, 1, 12)
  }

  /* ==================================================================
     PROJECT COVERS

     Four covers, one per case study, drawn rather than photographed.
     Each carries the title and one picture of what the project was, and
     nothing else — no number, no frame, no chrome. The tile draws its
     own border in CSS; the drawing does the rest.
     ================================================================== */

  /* ---- the display face ----
     5x7, not 3x5. Three pixels of width has to spell M, N and W with
     the same two uprights, so at the size a tile actually renders,
     BANNERS and ONCE came out as guesswork. Seven rows costs a little
     more of the card and buys letters that are letters. */
  const FONT = {
    A: ['.###.', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    B: ['####.', '#...#', '#...#', '####.', '#...#', '#...#', '####.'],
    C: ['.####', '#....', '#....', '#....', '#....', '#....', '.####'],
    D: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '####.'],
    E: ['#####', '#....', '#....', '####.', '#....', '#....', '#####'],
    F: ['#####', '#....', '#....', '####.', '#....', '#....', '#....'],
    G: ['.####', '#....', '#....', '#..##', '#...#', '#...#', '.####'],
    H: ['#...#', '#...#', '#...#', '#####', '#...#', '#...#', '#...#'],
    I: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '#####'],
    J: ['..###', '....#', '....#', '....#', '....#', '#...#', '.###.'],
    K: ['#...#', '#..#.', '#.#..', '##...', '#.#..', '#..#.', '#...#'],
    L: ['#....', '#....', '#....', '#....', '#....', '#....', '#####'],
    M: ['#...#', '##.##', '#.#.#', '#...#', '#...#', '#...#', '#...#'],
    N: ['#...#', '##..#', '#.#.#', '#..##', '#...#', '#...#', '#...#'],
    O: ['.###.', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    P: ['####.', '#...#', '#...#', '####.', '#....', '#....', '#....'],
    Q: ['.###.', '#...#', '#...#', '#...#', '#.#.#', '#..#.', '.##.#'],
    R: ['####.', '#...#', '#...#', '####.', '#.#..', '#..#.', '#...#'],
    S: ['.####', '#....', '#....', '.###.', '....#', '....#', '####.'],
    T: ['#####', '..#..', '..#..', '..#..', '..#..', '..#..', '..#..'],
    U: ['#...#', '#...#', '#...#', '#...#', '#...#', '#...#', '.###.'],
    V: ['#...#', '#...#', '#...#', '#...#', '#...#', '.#.#.', '..#..'],
    W: ['#...#', '#...#', '#...#', '#...#', '#.#.#', '##.##', '#...#'],
    X: ['#...#', '#...#', '.#.#.', '..#..', '.#.#.', '#...#', '#...#'],
    Y: ['#...#', '#...#', '.#.#.', '..#..', '..#..', '..#..', '..#..'],
    Z: ['#####', '....#', '...#.', '..#..', '.#...', '#....', '#####'],
    '?': ['.###.', '#...#', '....#', '..##.', '..#..', '.....', '..#..'],
    ',': ['.....', '.....', '.....', '.....', '..##.', '..#..', '.#...'],
    ' ': ['.....', '.....', '.....', '.....', '.....', '.....', '.....'],
  }

  /* Space and comma get a narrow advance. Setting them at full width is
     what pushed the longest line off the edge of the card. */
  const NARROW = { ' ': 4, ',': 4 }

  function text(g, str, x, y, s, col) {
    g.fillStyle = col
    let cx = x
    for (const ch of str.toUpperCase()) {
      const gl = FONT[ch]
      if (gl) {
        for (let r = 0; r < 7; r++) {
          for (let c = 0; c < 5; c++) {
            if (gl[r][c] === '#') g.fillRect(cx + c * s, y + r * s, s, s)
          }
        }
      }
      cx += (NARROW[ch] || 6) * s
    }
  }

  /* ---- 01 ----
     A banner: a picture, two lines of copy and a button, with carousel
     dots underneath saying there are more of them.

     This was a strip of film with three frames, on the strength of the
     "lights, camera" in the title. That is a joke about the name rather
     than a picture of the work — anybody who has not read the title
     sees a film strip on a project about banner design. So: an actual
     banner. Look twice, and the creative in it is the rooftop cat. */
  function drawBanners(g, p, y0, h) {
    const x = 13
    const w = 150
    const bh = Math.min(28, h - 12)

    g.fillStyle = p.hi
    g.fillRect(x, y0, w, bh)

    // the picture well, and the cat who is the creative in this one
    g.fillStyle = p.ink
    g.fillRect(x + 4, y0 + 4, 26, bh - 8)
    sprite(
      g,
      [
        '.##......##.',
        '.###....###.',
        '.##########.',
        '############',
        '############',
        '############',
        '############',
        '.###########',
        '.###########',
        '.###########',
        '.####..#####',
      ],
      x + 11,
      y0 + Math.floor((bh - 11) / 2),
      { '#': p.hi }
    )

    // two lines of copy
    g.fillStyle = p.ink
    g.fillRect(x + 36, y0 + 8, 58, 5)
    g.fillRect(x + 36, y0 + 17, 40, 4)

    // and the button
    g.fillRect(x + 102, y0 + 8, 42, bh - 16)
    g.fillStyle = p.hi
    g.fillRect(x + 109, y0 + Math.floor(bh / 2) - 2, 28, 4)

    /* Three dots: this banner is one of a set, which is the subject of
       the project rather than a decoration on it. */
    const dy = y0 + bh + 6
    for (let d = 0; d < 3; d++) {
      g.fillStyle = d === 0 ? p.hi : p.lo
      g.fillRect(x + 62 + d * 12, dy, 6, 5)
    }
  }

  /* ---- 02 ----
     A play key and a level meter. A player is a shape everybody can
     already read, so the pixels go on the two marks that say it.
     Look twice: the meter is the Tokyo skyline standing behind this
     page, and the tall bar keeps its spire. */
  function drawPlayer(g, p, y0, h) {
    const x = 13
    const base = y0 + h - 4
    const key = Math.min(30, h - 12)

    g.fillStyle = p.lo
    g.fillRect(x, base - key, key, key)
    g.fillStyle = p.bg
    g.fillRect(x + 3, base - key + 3, key - 6, key - 6)
    g.fillStyle = p.hi
    const tri = Math.floor((key - 10) / 2)
    for (let i = 0; i < tri; i++) {
      const hh = tri * 2 - 1 - i * 2
      g.fillRect(x + 8 + i, base - Math.floor(key / 2) - Math.floor(hh / 2), 1, hh)
    }

    const SKY = [8, 12, 10, 18, 14, 24, 16, 12, 20, 40, 18, 14, 24, 12, 22, 16, 10, 14, 28, 12, 8, 18, 10, 16]
    const top = h - 10
    for (let i = 0; i < SKY.length; i++) {
      const bh = Math.max(2, Math.round((SKY[i] / 40) * top))
      g.fillStyle = i === 9 ? p.hi : p.lo
      g.fillRect(x + 36 + i * 5, base - bh, 3, bh)
    }
    // the tower keeps its spire
    g.fillStyle = p.hi
    g.fillRect(x + 82, base - top - 5, 1, 5)
  }

  /* ---- 03 ----
     Four services on the left, one screen on the right, and a play
     triangle on the screen.

     The screen used to show the moon over a skyline. That is a nice
     picture and it says nothing about subscriptions — a viewer reads
     "night scene, on a television". What the work did was put four
     services behind one thing you press play on, so that is what is
     drawn now. Look twice: the moon is still up there, top right of
     the screen, keeping out of the way. */
  function drawScreens(g, p, y0, h) {
    const t = Math.min(18, Math.floor((h - 3) / 2))
    const cells = [
      [13, y0],
      [16 + t, y0],
      [13, y0 + t + 3],
      [16 + t, y0 + t + 3],
    ]
    for (const [cx, cy] of cells) {
      g.fillStyle = p.lo
      g.fillRect(cx, cy, t, t)
      g.fillStyle = p.ink
      g.fillRect(cx + 2, cy + 2, t - 4, t - 4)
    }

    // into one — the point goes on the right, towards the screen
    const mid = y0 + t + 1
    g.fillStyle = p.hi
    for (let i = 0; i < 8; i++) {
      g.fillRect(56 + i, mid - (7 - i), 2, 2)
      g.fillRect(56 + i, mid + (7 - i), 2, 2)
    }

    // the screen
    const sx = 70
    const sw = 93
    const sh = h - 2
    g.fillStyle = p.lo
    g.fillRect(sx, y0, sw, sh)
    g.fillStyle = p.ink
    g.fillRect(sx + 3, y0 + 3, sw - 6, sh - 6)

    // one play triangle, which is what the four of them became
    g.fillStyle = p.hi
    const ph = Math.min(11, Math.floor((sh - 12) / 2))
    for (let i = 0; i < ph; i++) {
      const hh = ph * 2 - 1 - i * 2
      g.fillRect(
        sx + Math.floor(sw / 2) - Math.floor(ph / 2) + i,
        y0 + Math.floor(sh / 2) - Math.floor(hh / 2),
        1,
        hh
      )
    }

    // the moon, still up there
    g.fillStyle = '#f4ecd8'
    for (let yy = -3; yy <= 3; yy++) {
      for (let xx = -3; xx <= 3; xx++) {
        if (xx * xx + yy * yy <= 9) g.fillRect(sx + sw - 13 + xx, y0 + 12 + yy, 1, 1)
      }
    }
  }

  /* ---- 04 ----
     Two options and a decision: one card lit, one not, and a tick on
     the corner of the one that won.
     Look twice: the coin is still in the air on the right. It is the
     method the project was built to replace. */
  function drawChoice(g, p, y0, h) {
    const cw = 56
    const ch = h - 4

    for (let i = 0; i < 2; i++) {
      const cx = 13 + i * (cw + 6)
      const on = i === 1
      g.fillStyle = on ? p.hi : p.lo
      g.fillRect(cx, y0, cw, ch)
      g.fillStyle = p.ink
      g.fillRect(cx + 3, y0 + 3, cw - 6, ch - 6)
      g.fillStyle = on ? p.hi : p.lo
      g.fillRect(cx + 8, y0 + 10, 24, 6)
    }

    // the tick, on the corner of the one that won
    const bx = 13 + cw + 6 + cw - 4
    const by = y0 + 4
    for (let yy = -9; yy <= 9; yy++) {
      for (let xx = -9; xx <= 9; xx++) {
        const d = xx * xx + yy * yy
        if (d > 81) continue
        g.fillStyle = d > 60 ? p.bg : p.hi
        g.fillRect(bx + xx, by + yy, 1, 1)
      }
    }
    sprite(
      g,
      ['......#', '.....##', '#...##.', '##.##..', '.####..', '..##...'],
      bx - 7,
      by - 6,
      { '#': p.ink },
      2
    )

    // and the coin, still turning
    const cx = 152
    const cy = y0 + Math.floor(ch / 2) + 4
    for (let yy = -7; yy <= 7; yy++) {
      for (let xx = -7; xx <= 7; xx++) {
        const d = xx * xx + yy * yy
        if (d > 49) continue
        g.fillStyle = d > 30 ? p.hi : p.lo
        g.fillRect(cx + xx, cy + yy, 1, 1)
      }
    }
    text(g, '?', cx - 2, cy - 3, 1, p.hi)
    g.fillStyle = p.lo
    g.fillRect(cx - 10, cy - 4, 1, 4)
    g.fillRect(cx + 10, cy - 1, 1, 4)
  }

  const COVER_ART = [drawBanners, drawPlayer, drawScreens, drawChoice]

  /* Three lines for the first one. Its title is the longest of the four
     and will not go across the card at a size worth reading. */
  const COVER_TITLE = [
    ['LIGHTS,', 'CAMERA,', 'BANNERS'],
    ['THE SOUND', 'OF STYLE'],
    ['EVERYTHING,', 'ALL AT ONCE'],
    ['HOW TO', 'DECIDE?'],
  ]

  function drawCover(g, W, H) {
    const i = (((currentSeed - 1) % 4) + 4) % 4
    const p = PAL.cover[i]

    g.fillStyle = p.bg
    g.fillRect(0, 0, W, H)

    const L = 5
    const R = W - 6
    const B = H - 6

    /* The title sets first and everything else is measured off it, so a
       three-line title and a two-line one both sit correctly without
       either being given its own layout. */
    const lines = COVER_TITLE[i]
    const S = 2
    const LH = 7 * S
    const GAP = 2
    let ty = 8
    for (const line of lines) {
      text(g, line, L + 5, ty, S, p.hi)
      ty += LH + GAP
    }

    const rule = ty + 1
    g.fillStyle = p.grid
    g.fillRect(L, rule, R - L + 1, 1)

    const y0 = rule + 7
    COVER_ART[i](g, p, y0, B - y0)

    /* Scanlines over the picture only.

       They used to run over the whole card, and a row of shadow every
       third row across a fourteen-row letter takes four bites out of
       it — which is most of why the titles were hard to read. Below the
       rule they are texture; above it they were damage. */
    g.fillStyle = 'rgba(0, 0, 0, 0.12)'
    for (let y = rule + 2; y < B; y += 3) g.fillRect(L + 1, y, R - L - 1, 1)
  }

  const KIND = {
    work: drawWork,
    cover: drawCover,
    book: drawBook,
    game: drawGame,
    film: drawFilm,
    music: drawMusic,
    portrait: drawPortrait,
    gb: drawHandheld,
    cart: drawCart,
  }

  /* Paint one canvas. The element carries its own instructions:
     data-poster="game" data-seed="7". */
  function paint(cv) {
    const kind = cv.dataset.poster || 'work'
    const seed = parseInt(cv.dataset.seed || '1', 10)
    const draw = KIND[kind] || drawWork

    // Internal resolution is fixed and small; CSS stretches it with
    // image-rendering: pixelated, so the art scales without softening.
    const W = kind === 'work' || kind === 'cover' ? 176 : kind === 'gb' ? 104 : kind === 'cart' ? 152 : 96
    const H = kind === 'cover' ? 110 : kind === 'work' ? 99 : kind === 'gb' ? 150 : kind === 'cart' ? 112 : 132
    cv.width = W
    cv.height = H

    const g = cv.getContext('2d')
    g.imageSmoothingEnabled = false

    const rnd = mulberry32(seed * 2654435761)
    const fam = PAL[kind] || PAL.work
    /* Indexed by seed, not sampled: six carts drawn at random would
       repeat a shell or a label about half the time, and walking the
       list guarantees six out of six. */
    currentSeed = seed
    const p = fam[seed % fam.length]

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
