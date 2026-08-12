/* ==================================================================
   UI behaviour: the boot card, the city controls, the router and
   the transitions between pages.
   ================================================================== */

(function () {
  'use strict'

  /* ==================================================================
     BOOT

     A bar, with the name over it.

     It was a POST sequence, and a long one: an attract screen painted
     at 2880x1620 — sky ramp, stars, Fuji, the far bank, a town, two
     pagodas, a torii, water, a sakura branch — with rain, petals, a
     train and a duck cued to fire off its own status lines, seven
     check rows switching on in sequence, a cat chasing a mouse along
     the bar, and a tip typing itself in underneath. Two and a half
     seconds of it.

     All of that was performance in front of the thing it was
     introducing, and the landing shot is better than any trailer for
     the landing shot. So: the name, a bar, and out of the way in under
     a second.

     It still steps rather than tweens — whole cells, because a
     smoothly interpolating bar would be the only thing on this page
     that slides.
     ================================================================== */
  const boot = document.getElementById('boot')
  if (boot) {
    const bootBar = document.getElementById('bootBar')

    /* Skip it outright on a phone and under reduced motion. A loading
       screen is a thing you sit through, and on a handset the landing
       shot IS the experience — it should be there the instant the page
       is. The two mobile tests catch a phone in portrait and one turned
       sideways (wider than the phone breakpoint, still a phone).
       And skipped outright on a DEEP LINK. Somebody arriving at a case
       study from a shared URL asked for that page, not for the title card
       in front of somebody else's home page — making them sit through a
       loading screen for a document they linked to directly is the same
       mistake as a splash screen on a settings deep link. */
    const deepLink = location.hash && location.hash !== '#home' && location.hash !== '#'
    const skip =
      deepLink ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      window.matchMedia('(max-width: 760px)').matches ||
      window.matchMedia('(hover: none) and (pointer: coarse)').matches

    if (skip) {
      boot.hidden = true
    } else {
      /* Sakura drifting down past the name. A handful of petals, each
         given its own column, size, delay and fall time off a fixed
         seed so the drift is the same every boot — the deterministic
         rule the rest of the scene follows. */
      const petals = document.getElementById('bootPetals')
      if (petals) {
        let seed = 0x9e3779b9
        const rnd = () => {
          seed = (Math.imul(seed ^ (seed >>> 15), 1 | seed) + 0x6d2b79f5) >>> 0
          return seed / 4294967296
        }
        for (let n = 0; n < 16; n++) {
          const p = document.createElement('span')
          p.className = 'boot__petal'
          const s = 4 + Math.round(rnd() * 4)
          p.style.left = (rnd() * 100).toFixed(1) + '%'
          p.style.width = s + 'px'
          p.style.height = s - 1 + 'px'
          p.style.opacity = (0.6 + rnd() * 0.4).toFixed(2)
          p.style.animationDuration = (1.6 + rnd() * 1.8).toFixed(2) + 's'
          p.style.animationDelay = (rnd() * 1.4).toFixed(2) + 's'
          petals.appendChild(p)
        }
      }

      /* Driven off elapsed time through requestAnimationFrame, not off a
         chain of setTimeouts. A background tab throttles timers to one a
         second, so the old chain turned a half-second card into an eight-
         second one — and a link opened in a background tab would still be
         showing the loading screen when you switched to it. rAF does not
         run in the background at all, so the first frame after the tab
         comes forward already has the full duration behind it and the card
         is gone before anything is painted. */
      const TOTAL = 520
      const STEPS = 8
      // anchored at load, not at the first frame, so time spent in a
      // background tab counts against the card rather than restarting it
      const t0 = performance.now()

      const tick = (now) => {
        const p = Math.min(1, (now - t0) / TOTAL)
        // whole cells, because a smoothly interpolating bar would be the
        // only thing on this page that slides
        const step = Math.round(p * STEPS) / STEPS
        if (bootBar) bootBar.style.width = Math.round(step * 100) + '%'
        if (p < 1) { requestAnimationFrame(tick); return }
        bail()
      }
      requestAnimationFrame(tick)

      // any key or click gets you past it
      let gone = false
      function bail() {
        if (gone) return
        gone = true
        boot.hidden = true
      }
      boot.addEventListener('click', bail)
      window.addEventListener('keydown', bail, { once: true })
    }
  }

  /* ==================================================================
     THE CONTACT ICONS, AT FULL RESOLUTION

     The desktop icons above are 24x24 because they are furniture on a
     machine that only has 24x24 to give. These four are not: they are
     the last thing on the page and the only four things on it a
     visitor is meant to click, so they are drawn at 4x the size they
     display at, with curves, gradients and soft shadows.

     Nothing here is on a grid. That is the point — the pixel face and
     the pixel city carry the retro; the one row of controls that has
     to be unmistakable at a glance does not have to pay for it.
     ================================================================== */
  const ICON_HI = 192 // backing resolution; displayed at 48

  function roundRect(g, x, y, w, h, r) {
    g.beginPath()
    g.moveTo(x + r, y)
    g.arcTo(x + w, y, x + w, y + h, r)
    g.arcTo(x + w, y + h, x, y + h, r)
    g.arcTo(x, y + h, x, y, r)
    g.arcTo(x, y, x + w, y, r)
    g.closePath()
  }

  const grad = (g, x0, y0, x1, y1, a, b) => {
    const gr = g.createLinearGradient(x0, y0, x1, y1)
    gr.addColorStop(0, a)
    gr.addColorStop(1, b)
    return gr
  }

  /* Everything is drawn on a 192 grid with an 18px margin, so the four
     of them share a silhouette weight even though the shapes differ. */
  const HI = {
    /* ---- envelope ----
       Body, then the inside of the throat, then the flap folded down
       over it, so the flap reads as being in front of the paper. */
    mail(g) {
      const x = 18, y = 34, w = 156, h = 124
      g.save()
      g.shadowColor = 'rgba(4,6,15,0.55)'
      g.shadowBlur = 0
      g.shadowOffsetX = 7
      g.shadowOffsetY = 7
      roundRect(g, x, y, w, h, 12)
      g.fillStyle = grad(g, x, y, x, y + h, '#f6f9ff', '#c3cde6')
      g.fill()
      g.restore()

      // the throat: what you can see of the inside behind the flap
      g.beginPath()
      g.moveTo(x + 6, y + 8)
      g.lineTo(x + w / 2, y + 74)
      g.lineTo(x + w - 6, y + 8)
      g.closePath()
      g.fillStyle = '#8f9bbb'
      g.fill()

      // the flap
      g.beginPath()
      g.moveTo(x, y + 4)
      g.lineTo(x + w / 2, y + 66)
      g.lineTo(x + w, y + 4)
      g.lineTo(x + w, y - 2)
      g.quadraticCurveTo(x + w, y - 12, x + w - 12, y - 12)
      g.lineTo(x + 12, y - 12)
      g.quadraticCurveTo(x, y - 12, x, y - 2)
      g.closePath()
      g.fillStyle = grad(g, x, y - 12, x, y + 66, '#ffffff', '#aab6d4')
      g.fill()
      g.strokeStyle = 'rgba(5,7,15,0.85)'
      g.lineWidth = 5
      g.lineJoin = 'round'
      g.stroke()

      // a stamp, franked
      g.fillStyle = '#ff3ea5'
      roundRect(g, x + 104, y + 78, 38, 30, 4)
      g.fill()
      g.strokeStyle = 'rgba(255,255,255,0.85)'
      g.lineWidth = 3
      g.stroke()
      g.strokeStyle = 'rgba(5,7,15,0.55)'
      g.lineWidth = 4
      g.lineCap = 'round'
      for (let i = 0; i < 3; i++) {
        g.beginPath()
        g.moveTo(x + 22, y + 84 + i * 11)
        g.lineTo(x + 84 - i * 12, y + 84 + i * 11)
        g.stroke()
      }

      // the outline last, over everything
      g.strokeStyle = '#05070f'
      g.lineWidth = 6
      g.lineJoin = 'round'
      roundRect(g, x, y, w, h, 12)
      g.stroke()
    },

    /* ---- the card ---- */
    linkedin(g) {
      const x = 20, y = 20, w = 152, h = 152
      g.save()
      g.shadowColor = 'rgba(4,6,15,0.55)'
      g.shadowOffsetX = 7
      g.shadowOffsetY = 7
      roundRect(g, x, y, w, h, 26)
      g.fillStyle = grad(g, x, y, x + w, y + h, '#5df6ff', '#1aa8d8')
      g.fill()
      g.restore()

      // a soft sheen across the top left
      g.save()
      roundRect(g, x, y, w, h, 26)
      g.clip()
      g.fillStyle = 'rgba(255,255,255,0.22)'
      g.beginPath()
      g.moveTo(x, y)
      g.lineTo(x + w, y)
      g.lineTo(x, y + h)
      g.closePath()
      g.fill()
      g.restore()

      g.fillStyle = '#ffffff'
      // the i: a dot and a stem
      g.beginPath()
      g.arc(x + 34, y + 44, 12, 0, Math.PI * 2)
      g.fill()
      roundRect(g, x + 22, y + 64, 24, 66, 5)
      g.fill()
      /* the n: its stem starts at the x-height, NOT at the i's
         ascender — carried up there it reads as an h. */
      roundRect(g, x + 60, y + 78, 24, 52, 5)
      g.fill()
      g.beginPath()
      g.moveTo(x + 84, y + 130)
      g.lineTo(x + 84, y + 96)
      g.quadraticCurveTo(x + 84, y + 78, x + 102, y + 78)
      g.quadraticCurveTo(x + 120, y + 78, x + 120, y + 96)
      g.lineTo(x + 120, y + 130)
      g.lineTo(x + 96, y + 130)
      g.lineTo(x + 96, y + 100)
      g.quadraticCurveTo(x + 96, y + 94, x + 90, y + 94)
      g.quadraticCurveTo(x + 84, y + 94, x + 84, y + 100)
      g.closePath()
      g.fill()

      g.strokeStyle = '#05070f'
      g.lineWidth = 6
      roundRect(g, x, y, w, h, 26)
      g.stroke()
    },

    /* ---- one page, PDF ---- */
    resume(g) {
      const x = 38, y = 20, w = 116, h = 152, fold = 34
      g.save()
      g.shadowColor = 'rgba(4,6,15,0.55)'
      g.shadowOffsetX = 7
      g.shadowOffsetY = 7
      g.beginPath()
      g.moveTo(x + 8, y)
      g.lineTo(x + w - fold, y)
      g.lineTo(x + w, y + fold)
      g.lineTo(x + w, y + h - 8)
      g.quadraticCurveTo(x + w, y + h, x + w - 8, y + h)
      g.lineTo(x + 8, y + h)
      g.quadraticCurveTo(x, y + h, x, y + h - 8)
      g.lineTo(x, y + 8)
      g.quadraticCurveTo(x, y, x + 8, y)
      g.closePath()
      g.fillStyle = grad(g, x, y, x, y + h, '#ffffff', '#ccd5ea')
      g.fill()
      g.restore()

      // the dog ear, lit on its fold
      g.beginPath()
      g.moveTo(x + w - fold, y)
      g.lineTo(x + w, y + fold)
      g.lineTo(x + w - fold, y + fold)
      g.closePath()
      g.fillStyle = '#93a0c0'
      g.fill()

      // heading, then three runs of copy
      g.fillStyle = '#ff3ea5'
      roundRect(g, x + 16, y + 30, 52, 12, 4)
      g.fill()
      g.fillStyle = '#9aa6c8'
      const runs = [76, 92, 62, 84, 70]
      for (let i = 0; i < runs.length; i++) {
        roundRect(g, x + 16, y + 58 + i * 18, runs[i], 8, 4)
        g.fill()
      }

      // a wax seal
      g.beginPath()
      g.arc(x + 88, y + 124, 18, 0, Math.PI * 2)
      g.fillStyle = grad(g, x + 74, y + 110, x + 102, y + 140, '#ff6a70', '#c2262d')
      g.fill()
      g.strokeStyle = 'rgba(5,7,15,0.7)'
      g.lineWidth = 4
      g.stroke()

      g.strokeStyle = '#05070f'
      g.lineWidth = 6
      g.lineJoin = 'round'
      g.beginPath()
      g.moveTo(x + 8, y)
      g.lineTo(x + w - fold, y)
      g.lineTo(x + w, y + fold)
      g.lineTo(x + w, y + h - 8)
      g.quadraticCurveTo(x + w, y + h, x + w - 8, y + h)
      g.lineTo(x + 8, y + h)
      g.quadraticCurveTo(x, y + h, x, y + h - 8)
      g.lineTo(x, y + 8)
      g.quadraticCurveTo(x, y, x + 8, y)
      g.closePath()
      g.stroke()
    },

    /* ---- the ball ----
       Three arcs, each a wide stroke clipped to the ball, which is the
       only way they stay true curves rather than the staircases the
       24-pixel version had to settle for. */
    dribbble(g) {
      const cx = 96, cy = 96, r = 76
      g.save()
      g.shadowColor = 'rgba(4,6,15,0.55)'
      g.shadowOffsetX = 7
      g.shadowOffsetY = 7
      g.beginPath()
      g.arc(cx, cy, r, 0, Math.PI * 2)
      g.fillStyle = grad(g, cx - r, cy - r, cx + r, cy + r, '#ff64bd', '#e01f77')
      g.fill()
      g.restore()

      g.save()
      g.beginPath()
      g.arc(cx, cy, r - 3, 0, Math.PI * 2)
      g.clip()
      g.strokeStyle = '#ffffff'
      g.lineWidth = 13
      g.lineCap = 'round'
      // the long sweep across the belly
      g.beginPath()
      g.arc(cx - 96, cy + 118, 168, -1.05, -0.16)
      g.stroke()
      // the one that comes over the shoulder
      g.beginPath()
      g.arc(cx + 122, cy - 42, 128, 2.05, 3.25)
      g.stroke()
      // and the short one across the top
      g.beginPath()
      g.arc(cx + 6, cy - 150, 168, 0.62, 1.42)
      g.stroke()
      // a highlight, so it reads as a sphere and not a disc
      g.fillStyle = 'rgba(255,255,255,0.18)'
      g.beginPath()
      g.ellipse(cx - 26, cy - 34, 40, 26, -0.6, 0, Math.PI * 2)
      g.fill()
      g.restore()

      g.strokeStyle = '#05070f'
      g.lineWidth = 6
      g.beginPath()
      g.arc(cx, cy, r, 0, Math.PI * 2)
      g.stroke()
    },
  }

  document.querySelectorAll('canvas.links__art[data-icon]').forEach((cv) => {
    const draw = HI[cv.dataset.icon]
    if (!draw) return
    cv.width = ICON_HI
    cv.height = ICON_HI
    const g = cv.getContext('2d')
    g.clearRect(0, 0, ICON_HI, ICON_HI)
    draw(g)
    cv.dataset.hires = '1'
  })

  /* ==================================================================
     THE CURSOR

     The one piece of chrome the browser draws that this page had no
     say over — a smooth, antialiased, system arrow floating over a
     picture where every other edge lands on a pixel.

     It is drawn here instead: a 12x12 sprite painted into a canvas
     and handed to CSS as a data URI. Same rules as the rest of the
     file — whole pixels, palette colours, no image file on disk — and
     the hotspot is set to the tip so it still points at what it is
     pointing at.

     Two of them. The arrow everywhere, and a HAND over anything you
     can press, because the moment you replace the arrow you inherit
     the job of saying what is clickable.
     ================================================================== */
  const CURSORS = {
    /* No sparkle. A three-pixel glint beside the arrow read as a
       plus sign following the pointer around, which is a cursor with
       a bug rather than a cursor with personality. The personality is
       in the SIZE and the steps now: big enough that you can see it is
       drawn out of blocks, which is the whole joke. */
    arrow: [
      'k.............',
      'kk............',
      'kwk...........',
      'kwwk..........',
      'kwwwk.........',
      'kwwwwk........',
      'kwwwwwk.......',
      'kwwwwwwk......',
      'kwwwwwwwk.....',
      'kwwwwwwwwk....',
      'kwwwkkkkkkk...',
      'kwkck.........',
      'kkck..........',
      '.kkc..........',
    ],
    hand: [
      '.....kk.......',
      '....kwwk......',
      '....kwwk......',
      '....kwwk......',
      '....kwwkkk....',
      '....kwwkwwkk..',
      '.kk.kwwkwwkwk.',
      'kwwkkwwwwwwwk.',
      'kwwwkwwwwwwwk.',
      '.kwwwwwwwwwwk.',
      '..kwwwwwwwwwk.',
      '..kwwwwwwwwwk.',
      '..kwwwwwwwwwk.',
      '..kkkkkkkkkkk.',
    ],
  }

  const CURSOR_PAL = { k: '#05070f', w: '#eaf0ff', c: '#3ef0ff', m: '#ff3ea5' }

  function makeCursor(art, scale) {
    const c = document.createElement('canvas')
    c.width = 14 * scale
    c.height = 14 * scale
    const g = c.getContext('2d')
    g.imageSmoothingEnabled = false
    for (let y = 0; y < art.length; y++) {
      for (let x = 0; x < art[y].length; x++) {
        const col = CURSOR_PAL[art[y][x]]
        if (!col) continue
        g.fillStyle = col
        g.fillRect(x * scale, y * scale, scale, scale)
      }
    }
    return c.toDataURL('image/png')
  }

  try {
    /* Doubled, because a 12px cursor on a high-density display is a
       speck. Browsers cap the size around 128px, so 2x is safe. */
    const S = 3
    const arrow = makeCursor(CURSORS.arrow, S)
    const hand = makeCursor(CURSORS.hand, S)
    const css = document.createElement('style')
    css.textContent =
      'html, body { cursor: url(' + arrow + ') 0 0, auto; }\n' +
      'a, button, .tile, summary, [role="button"] { cursor: url(' + hand + ') ' +
      4 * S + ' 0, pointer; }'
    document.head.appendChild(css)
  } catch (e) {
    // a tainted canvas or a blocked data URI just means the system
    // arrow stays, which is a fine place to end up
  }

  /* ---------------- weather ----------------
     Rain is the only weather with a control on it now. The day palette
     and the snow are still in the scene and still reachable through
     __scene.setTheme / setSnow; what has gone is the row of buttons
     inviting somebody to leave the shot the page was composed for.

     The theme still has to be published to the document, because the
     CSS keys its day overrides off `data-mode` and would otherwise be
     left on whatever the markup happened to say. */
  if (window.__scene) {
    document.documentElement.dataset.mode = window.__scene.current()
  }

  /* ---------------- the skyline picker ----------------

     Five cities, built from the scene's own list. The markup ships an
     empty <ul> on purpose: the skylines are declared once, in
     scene.js, and this reads them rather than keeping a second copy
     that can drift out of step with the first. */
  const cityBtn = document.getElementById('cityToggle')
  const cityMenu = document.getElementById('cityMenu')

  if (cityBtn && cityMenu && window.__scene && window.__scene.cities) {
    const cityLabel = cityBtn.querySelector('.btn__label')
    const cities = window.__scene.cities()

    const closeCities = () => {
      cityMenu.hidden = true
      cityBtn.setAttribute('aria-expanded', 'false')
    }

    const openCities = () => {
      cityMenu.hidden = false
      cityBtn.setAttribute('aria-expanded', 'true')
    }

    const paintCity = () => {
      const cur = window.__scene.city()
      const hit = cities.find((c) => c.key === cur)
      if (cityLabel && hit) cityLabel.textContent = hit.label
      for (const b of cityMenu.querySelectorAll('.picker__item')) {
        b.setAttribute('aria-checked', b.dataset.city === cur ? 'true' : 'false')
      }
    }

    for (const c of cities) {
      const li = document.createElement('li')
      const b = document.createElement('button')
      b.type = 'button'
      b.className = 'picker__item'
      b.dataset.city = c.key
      b.setAttribute('role', 'menuitemradio')
      b.setAttribute('aria-checked', 'false')
      b.textContent = c.label
      b.addEventListener('click', () => {
        window.__scene.setCity(c.key)
        paintCity()
        closeCities()
        cityBtn.focus()
      })
      li.appendChild(b)
      cityMenu.appendChild(li)
    }

    paintCity()

    cityBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      if (cityMenu.hidden) openCities()
      else closeCities()
    })

    /* Anywhere else on the page shuts it, which is what every menu
       ever built has done and what a visitor will try first. */
    document.addEventListener('click', (e) => {
      if (!cityMenu.hidden && !cityMenu.contains(e.target)) closeCities()
    })

    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape' || cityMenu.hidden) return
      closeCities()
      cityBtn.focus()
    })
  }

  /* ---- scroll from anywhere ----
     The column is the only thing on the page that takes pointer events;
     everything either side of it is the scene, deliberately, so a click
     out there lands on the city. But a WHEEL out there used to fall
     through and scroll nothing, which reads as the page being stuck.

     Forward the wheel to whichever page is open — but only when the
     pointer is outside that page. Inside it the browser is already
     scrolling the column, and handling it again here would move it
     twice as far per notch. deltaMode is honoured so a mouse that
     reports lines or pages rather than pixels still travels right. */
  window.addEventListener(
    'wheel',
    (e) => {
      const page = document.querySelector('.page.is-on')
      if (!page || page.scrollHeight <= page.clientHeight) return
      if (page.contains(e.target)) return
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? page.clientHeight : 1
      page.scrollTop += e.deltaY * unit
      e.preventDefault()
    },
    { passive: false }
  )

  const rainBtn = document.getElementById('rainToggle')

  if (rainBtn && window.__scene) {
    const label = rainBtn.querySelector('.btn__label')

    const paint = () => {
      const on = window.__scene.raining()
      rainBtn.setAttribute('aria-pressed', on ? 'true' : 'false')
      if (label) label.textContent = `RAIN ${on ? 'ON' : 'OFF'}`
    }

    paint()

    rainBtn.addEventListener('click', () => {
      window.__scene.setRain(!window.__scene.raining())
      paint()
    })
  }

  /* ==================================================================
     THE ROUTER

     This was a window manager: three window states, a taskbar to
     minimise to, drag-by-the-title-bar, double-click to maximise, and
     a zoom rectangle that flew between a window and its button. Around
     four hundred lines of it, and all of it in service of a metaphor
     that made every section arrive as a modal stacked on top of the
     city. The first thing a visitor had to do was work out the window
     manager rather than read anything.

     Pages now. One is up at a time, filling the frame, and the route
     lives in the hash — so the back button works, a link can be
     shared, and a reload lands where you were. Static hosting needs no
     rewrite rules for a hash, which is the other reason it is a hash.

     Between two pages sits the wipe: it closes over the frame, the
     swap happens behind it, it opens again. A navigation is one
     movement instead of a cut, and nothing is ever seen half-changed —
     which is the same reason the scene holds its snapshot while a
     rebuild drains.
     ================================================================== */
  const pages = new Map()
  document.querySelectorAll('.page').forEach((el) => pages.set(el.dataset.page, el))

  if (pages.size) {
    const wipe = document.querySelector('.wipe')
    const stepped = !window.matchMedia('(prefers-reduced-motion: reduce)').matches

    // half the wipe: closed by this point, swapped, then opening
    const WIPE_MS = 260

    const routeOf = () => {
      const h = (location.hash || '#home').slice(1)
      return pages.has(h) ? h : 'home'
    }

    let current = null

    /* Showing a page is two things: put the others away, and reset the
       scroll — landing halfway down a case study you read ten minutes ago
       is disorienting in a way that landing at its title never is. */
    function show(id) {
      pages.forEach((el, key) => {
        const on = key === id
        el.hidden = !on
        el.classList.toggle('is-on', on)
        if (on) el.scrollTop = 0
      })
      document.documentElement.dataset.page = id
      current = id
      const live = pages.get(id)
      // the weather reads this to know what it is landing on
      pages.forEach((el) => el.removeAttribute('data-active'))
      if (live) live.setAttribute('data-active', '')

      /* Two grounds, three treatments:
           home — the living city at full strength; it IS the shot.
           case — a case study: a calm, opaque reading card over a dark
                  scrim, because the work is the subject and a skyline
                  moving behind a systems diagram is a distraction.
           read — the about page, same ground, editorial type. */
      const kind = id === 'home' ? 'home' : (live && live.dataset.kind) || 'read'
      document.documentElement.dataset.l2 = kind === 'home' ? '' : kind
      if (window.__scene) {
        if (window.__scene.setFocus) window.__scene.setFocus(false)
        if (window.__scene.setStage) window.__scene.setStage(kind !== 'home')
      }

      /* The tab, and anything that reads it — history, bookmarks, the
         preview on a pasted link. A hash route changes the view without a
         document load, so nothing updates this unless we do. */
      const NAME = 'Vaibhav Vishal'
      const t = live && live.querySelector('.cs__title, .read__title')
      document.title = id === 'home'
        ? NAME + ' — Product Designer'
        : (t ? t.textContent.trim() + ' — ' + NAME : NAME)

      /* Announce the change. A hash route swaps the whole view without a
         document load, so a screen reader is given nothing unless we say
         something; and focus has to be moved off whatever link was just
         followed or the next Tab resumes on the page that has gone. */
      if (live) {
        const h = live.querySelector('h1, h2')
        if (h) {
          h.setAttribute('tabindex', '-1')
          h.focus({ preventScroll: true })
        }
      }
    }

    /* ---- the iris ----
       Moving between home and a page is a scene change, so it gets one.
       A near-black circle rushes out from wherever you tapped; its edge
       is a field of dither dots rather than a clean arc. At full black
       the page swaps underneath, then the new page is uncovered by the
       same circle opening back up. Chunky, pixelated and quick — under
       half a second — so it reads as stepping into a world, not loading
       a page. The Close button fires the same thing in reverse, so home
       and a project feel like one place entered and left. */
    const iris = document.createElement('canvas')
    iris.className = 'iris'
    iris.setAttribute('aria-hidden', 'true')
    document.body.appendChild(iris)
    const ictx = iris.getContext('2d')

    let pointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    window.addEventListener('pointerdown', (e) => { pointer = { x: e.clientX, y: e.clientY } }, true)

    // 8x8 ordered dither — the same kind of matrix the scene dithers
    // with, so the edge of the wipe is made of the same dots as the city
    const BAYER = [
      0, 48, 12, 60, 3, 51, 15, 63,
      32, 16, 44, 28, 35, 19, 47, 31,
      8, 56, 4, 52, 11, 59, 7, 55,
      40, 24, 36, 20, 43, 27, 39, 23,
      2, 50, 14, 62, 1, 49, 13, 61,
      34, 18, 46, 30, 33, 17, 45, 29,
      10, 58, 6, 54, 9, 57, 5, 53,
      42, 26, 38, 22, 41, 25, 37, 21,
    ]
    const CELL = 10
    let irisBusy = false

    /* rAF does not run in a background tab. Without a guard, a navigation
       fired while the tab is hidden — a restored session, a link opened in
       the background, a phone locked mid-tap — starts the cover, never gets
       another frame, and the visitor comes back to an opaque black page with
       no way out. Three belts: do not start one while hidden, finish it if
       the tab goes away mid-run, and a wall-clock backstop under everything.
       A transition is decoration; it must never be able to trap the page. */
    function finishIris(id) {
      iris.classList.remove('is-on')
      if (window.__scene && window.__scene.pause) window.__scene.pause(false)
      irisBusy = false
      if (id != null && current !== id) show(id)
    }

    function irisRun(id) {
      irisBusy = true
      /* Freeze the city for the duration. The wipe covers it completely
         at the midpoint, so a frozen scene is never seen — and with the
         scene's heavy render off the main thread, the wipe animates at a
         full frame rate instead of fighting it for the thread. That
         contention was the whole reason it did not read as smooth. */
      if (window.__scene && window.__scene.pause) window.__scene.pause(true)
      const W = window.innerWidth, H = window.innerHeight
      iris.width = W
      iris.height = H
      iris.classList.add('is-on')
      const ox = pointer.x, oy = pointer.y
      const maxR = Math.hypot(Math.max(ox, W - ox), Math.max(oy, H - oy)) + CELL * 3
      /* A wider dithered edge, so the pixel character of the wipe is
         actually visible as it crosses rather than being a hard arc that
         is over before the eye catches it. */
      const band = maxR * 0.24
      /* Long enough to read as one movement — close, hold, open — and
         short enough that nobody waits on it. Under half a second, door
         to door. */
      const COVER = 200, HOLD = 60, REVEAL = 220
      const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL)
      let t0 = null, swapped = false, released = false
      let done = false

      const bail = () => {
        if (done) return
        done = true
        document.removeEventListener('visibilitychange', onHide)
        clearTimeout(guard)
        finishIris(id)
      }
      const onHide = () => { if (document.hidden) bail() }
      document.addEventListener('visibilitychange', onHide)
      const guard = setTimeout(bail, COVER + HOLD + REVEAL + 600)

      function draw(now) {
        if (t0 == null) t0 = now
        const e = now - t0
        // ease the cover/reveal so the edge accelerates in and out rather
        // than crossing at one flat speed — that is what reads as smooth
        const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2)
        let coverR, holeR
        if (e < COVER) { coverR = ease(e / COVER) * (maxR + band); holeR = 0 }
        else if (e < COVER + HOLD) { coverR = maxR + band; holeR = 0 }
        else if (e < COVER + HOLD + REVEAL) { coverR = maxR + band; holeR = ease((e - COVER - HOLD) / REVEAL) * (maxR + band) }
        else { bail(); return }

        // swap the page while the frame is fully black
        if (!swapped && e >= COVER) { swapped = true; show(id) }
        // let the city move again the instant the hole starts opening, so
        // by the time it is uncovered it is already live under the reveal
        if (!released && e >= COVER + HOLD && window.__scene && window.__scene.pause) {
          released = true
          window.__scene.pause(false)
        }

        ictx.clearRect(0, 0, W, H)
        ictx.fillStyle = '#04030a'
        for (let gy = 0; gy < rows; gy++) {
          const by = (gy & 7) * 8
          for (let gx = 0; gx < cols; gx++) {
            const x = gx * CELL + CELL / 2, y = gy * CELL + CELL / 2
            const d = Math.hypot(x - ox, y - oy)
            const th = (BAYER[by + (gx & 7)] + 0.5) / 64 * band
            if (d < coverR - th && !(d < holeR - th)) ictx.fillRect(gx * CELL, gy * CELL, CELL, CELL)
          }
        }
        if (!done) requestAnimationFrame(draw)
      }
      requestAnimationFrame(draw)
    }

    function go(id, instant) {
      if (id === current) return
      if (instant || !stepped || irisBusy || document.hidden) { show(id); return }
      irisRun(id)
    }

    /* ---- in-page anchors ----
       #work and the skip link point at a section, not at a route. The page
       is a fixed, overflow-scrolling container rather than the document, so
       the browser will not always scroll it for us — and letting these
       write to location.hash would put a non-route in the history and make
       the back button lie. Handle them here: scroll the container, move
       focus so a keyboard user actually lands there, leave the URL alone. */
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]')
      if (!a) return
      const id = a.getAttribute('href').slice(1)
      if (!id || pages.has(id)) return
      const target = document.getElementById(id)
      if (!target) return
      e.preventDefault()
      /* Scroll the page container rather than calling scrollIntoView: the
         scroller is the .page, not the document, and a smooth scroll does
         not run in a background tab — so the behaviour is only smooth when
         there is somebody there to see it. */
      const scroller = target.closest('.page') || document.scrollingElement
      const top = scroller.scrollTop + target.getBoundingClientRect().top - 24
      const smooth = stepped && !document.hidden
      scroller.scrollTo({ top, behavior: smooth ? 'smooth' : 'auto' })
      const h = target.querySelector('h1, h2, h3') || target
      h.setAttribute('tabindex', '-1')
      h.focus({ preventScroll: true })
    })

    window.addEventListener('hashchange', () => go(routeOf()))
    show(routeOf())

    /* Escape goes home. There is one level of depth now — home, and a
       page — so there is nothing to step back through. */
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && current !== 'home') location.hash = '#home'
    })
  }

  /* ==================================================================
     THE COVER, ON THE CURSOR

     Point at a row on the shelf and its cover comes up next to the
     pointer. A shelf is a list of things you like, and a list of
     titles asks the reader to already know what they are; the cover
     is the thing that actually communicates, and it does it in the
     half second the pointer is passing over.

     Two sources, in that order:

       data-cover-src   a real image. Drop the actual sleeve, jacket
                        or poster in and it is used verbatim.
       data-cover       a KIND — book, game, film, music — which
                        posters.js generates a piece of cover art for
                        from the row's seed.

     So it works with nothing filled in, and it gets better the moment
     something real is dropped in. Painted once per row and cached on
     the element, because generating a poster on every mouseenter is
     work done repeatedly for a result that never changes.
     ================================================================== */
  const peek = document.querySelector('.peek')

  if (peek) {
    const peekCv = peek.querySelector('canvas')
    const peekImg = peek.querySelector('img')
    const rows = document.querySelectorAll('[data-cover]')
    let raf = 0
    let px = 0
    let py = 0

    const place = () => {
      raf = 0
      /* Offset down-right of the tip, and flipped to the other side
         when it would run off the edge — a preview that leaves the
         viewport is a preview you cannot see. */
      const w = peek.offsetWidth
      const h = peek.offsetHeight
      const x = px + 28 + w > innerWidth ? px - w - 20 : px + 28
      const y = Math.min(py + 20, innerHeight - h - 12)
      peek.style.transform = 'translate(' + Math.round(x) + 'px,' + Math.round(y) + 'px)'
    }

    rows.forEach((row) => {
      row.addEventListener('mouseenter', () => {
        const src = row.dataset.coverSrc
        if (src) {
          peekImg.src = src
          peekImg.hidden = false
          peekCv.hidden = true
        } else if (window.Posters) {
          if (!row.dataset.painted) {
            peekCv.dataset.poster = row.dataset.cover
            peekCv.dataset.seed = row.dataset.seed || '1'
            window.Posters.paint(peekCv)
            // the canvas is shared, so repaint per row rather than cache
          } else {
            peekCv.dataset.poster = row.dataset.cover
            peekCv.dataset.seed = row.dataset.seed || '1'
            window.Posters.paint(peekCv)
          }
          peekImg.hidden = true
          peekCv.hidden = false
        }
        peek.hidden = false
      })

      row.addEventListener('mouseleave', () => {
        peek.hidden = true
      })
    })

    /* One listener on the document rather than four on the rows: the
       pointer is moving constantly and this only has to know where it
       is, not what it is over. */
    document.addEventListener('mousemove', (e) => {
      if (peek.hidden) return
      px = e.clientX
      py = e.clientY
      if (!raf) raf = requestAnimationFrame(place)
    })
  }

  /* ==================================================================
     THE CONTROLS BELONG TO THE SCENE

     Which skyline you are standing over, and whether it is raining on it,
     are controls for the first fold. Once the reading ground has covered
     the city they are two buttons floating over a work index, pointing at
     something nobody can see — game chrome sitting on top of the part of
     the page that has to be taken seriously.

     So they leave with the city. An observer on the hero rather than a
     scroll listener, because this needs to be true and not approximately
     true, and it costs nothing per frame.
     ================================================================== */
  const heroEl = document.querySelector('.hero')
  const controlsEl = document.querySelector('.controls')
  if (heroEl && controlsEl && 'IntersectionObserver' in window) {
    const io = new IntersectionObserver(
      (entries) => {
        const e = entries[0]
        controlsEl.toggleAttribute('data-away', e.intersectionRatio < 0.35)
      },
      { threshold: [0, 0.35, 1] }
    )
    io.observe(heroEl)
  }

  /* ---------------- the Konami code ----------------
     Up up down down left right left right B A. It belongs on a title
     screen more than it belongs anywhere else, and the check is a
     single index walked forward on a match and reset to zero on a miss
     — no buffer, no slicing. */
  const KONAMI = [
    'ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown',
    'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a',
  ]
  let konamiAt = 0

  document.addEventListener('keydown', (e) => {
    const want = KONAMI[konamiAt]
    const got = e.key.length === 1 ? e.key.toLowerCase() : e.key
    konamiAt = got === want ? konamiAt + 1 : got === KONAMI[0] ? 1 : 0
    if (konamiAt < KONAMI.length) return

    konamiAt = 0
    document.documentElement.dataset.secret = 'on'
    if (window.__scene && window.__scene.setSecret) window.__scene.setSecret(true)

    // one span, so the flex row and its separators still hold
    const role = document.querySelector('.role')
    if (role) role.innerHTML = '<span>PLAYER 1 READY</span>'
  })

})()
