/* ==================================================================
   UI behaviour: the day/night toggle, and arcade keyboard menu.
   ================================================================== */

(function () {
  'use strict'

  /* ==================================================================
     BOOT

     A POST sequence. The page is dressed as a machine, and this is what
     a machine does first — but it is also the fastest way to tell
     somebody what is in here before they have seen any of it: there is
     weather, there is a city, there is a cat.

     Two seconds, and every part of it steps. The lines appear one at a
     time and the bar fills in whole cells, because a smoothly
     interpolating progress bar would be the only thing on the page
     that tweens. */
  const boot = document.getElementById('boot')
  if (boot) {
    const lines = boot.querySelectorAll('.boot__lines li')
    const bootBar = document.getElementById('bootBar')
    /* Skip the whole POST on a phone. A loading screen is a thing you sit
       through, and on a handset the landing shot IS the experience — it
       should be there the instant the page is. Reduced-motion skips it
       for the same reason it always did; the two mobile tests catch a
       phone in portrait and one turned sideways (wider than the phone
       breakpoint but still a phone). */
    const skip =
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      window.matchMedia('(max-width: 760px)').matches ||
      window.matchMedia('(hover: none) and (pointer: coarse)').matches

    const cat = document.getElementById('bootCat')
    const mouse = document.getElementById('bootMouse')
    const pct = document.getElementById('bootPct')
    const tipEl = document.getElementById('bootTip')
    const statusEl = document.getElementById('bootStatus')

    /* The now-loading line. None of these are true, which is the whole
       genre — a loading screen has always been where a game admits it
       is having fun. Stepped through in order, one every third of a
       second. */
    const STATUSES = [
      'WARMING UP THE NEON',
      'ORDERING RAIN (LARGE)',
      'COUNTING WINDOWS... 14,203',
      'DELAYING THE TRAIN',
      'TEACHING CAT TO SIT',
      'POLISHING THE MOON',
      'UNTANGLING STRING LIGHTS',
      'FEEDING THE CAT',
      'HIDING EASTER EGGS',
      'LOSING THE RUBBER DUCK',
    ]

    /* Build the attract screen: a starfield, and a skyline that the
       loader raises one tower at a time. Heights come from a fixed
       sequence rather than Math.random so the same city boots twice —
       which is the whole convention the scene itself already follows. */
    const stars = document.getElementById('bootStars')
    const city = document.getElementById('bootCity')
    let towers = []

    if (stars) {
      let seed = 20260809
      const rnd = () => {
        seed = (Math.imul(seed, 1103515245) + 12345) >>> 0
        return seed / 4294967296
      }
      for (let i = 0; i < 90; i++) {
        const s = document.createElement('span')
        s.style.left = (rnd() * 100).toFixed(2) + '%'
        s.style.top = (rnd() * 58).toFixed(2) + '%'
        s.style.animationDelay = (rnd() * 1.4).toFixed(2) + 's'
        stars.appendChild(s)
      }
    }

    if (city) {
      // a skyline profile, hand-set: tall clusters and low gaps
      const H = [
        38, 62, 30, 74, 46, 88, 34, 56, 96, 42, 28, 68, 80, 36,
        52, 92, 44, 26, 70, 58, 84, 32, 64, 48, 76, 40, 60, 30,
      ]
      for (const h of H) {
        const b = document.createElement('span')
        b.style.height = h + '%'
        city.appendChild(b)
      }
      towers = [...city.children]

      // a nearer, darker row in front — even the loader has parallax
      const near = document.getElementById('bootCityNear')
      if (near) {
        for (let i = 0; i < H.length; i++) {
          const b = document.createElement('span')
          b.style.height = H[(i + 9) % H.length] + '%'
          near.appendChild(b)
        }
        towers = towers.concat([...near.children])
      }

      // the rain, waiting for its cue
      const rainBox = document.getElementById('bootRain')
      if (rainBox) {
        let rs = 977
        const rr = () => {
          rs = (Math.imul(rs, 1103515245) + 12345) >>> 0
          return rs / 4294967296
        }
        for (let i = 0; i < 42; i++) {
          const d = document.createElement('span')
          d.style.left = (rr() * 100).toFixed(2) + '%'
          d.style.animationDelay = (rr() * 0.9).toFixed(2) + 's'
          d.style.animationDuration = (0.7 + rr() * 0.5).toFixed(2) + 's'
          rainBox.appendChild(d)
        }
      }
    }

    /* The tips are not filler. Half of what is in this page is only
       findable if somebody tells you it is there, and two seconds of
       loading is exactly when somebody is willing to read. */
    const TIPS = [
      'THE CAT ON THE ROOF CAN BE CLICKED.',
      'ONE BUILDING SPELLS SOMETHING. KEEP LOOKING.',
      'IT SNOWS IF YOU ASK IT TO.',
      'UP UP DOWN DOWN LEFT RIGHT LEFT RIGHT B A.',
      'THE AIRSHIP FLIES A DIFFERENT BANNER EVERY TIME.',
      'THERE IS A RUBBER DUCK. NO, IT IS NOT EXPLAINED.',
      'WATCH THE PARAPET. SOMETHING RUNS ALONG IT.',
      'THE CHESS GAME HAS NOT MOVED IN WEEKS.',
      'THE CITY IN THE CORNER CHANGES. FIVE OF THEM.',
      'IT IS ALWAYS APRIL IN TOKYO.',
    ]
    const tip = TIPS[Math.floor(Math.random() * TIPS.length)]

    if (skip) {
      boot.hidden = true
    } else {
      const TOTAL = 2400
      const STEPS = 30
      let i = 0
      let lastP = -1

      const tick = () => {
        i++
        const t = i / STEPS

        /* The bar does not run smoothly to 100. It stalls twice, the
           way everything did on the machine this is imitating, which
           is the difference between a progress bar and a progress
           bar you believe. */
        const eased = t < 0.4 ? t * 0.55 : t < 0.62 ? 0.22 : t < 0.85 ? t * 0.95 : t
        const p = Math.min(100, Math.round(eased * 100))

        if (bootBar) bootBar.style.width = p + '%'
        if (cat) {
          cat.style.left = 'calc(' + p + '% - ' + (p / 100) * 22 + 'px)'
          // the bar stalls on purpose; a cat that has stopped chasing
          // sits still, which is what makes the stall read as a joke
          // instead of a bug
          cat.classList.toggle('is-idle', p === lastP)
        }
        if (mouse) {
          // the mouse leads by a body-length and escapes off the end
          const mp = Math.min(103, p + 11)
          mouse.style.left = 'calc(' + mp + '% - ' + (mp / 100) * 14 + 'px)'
          mouse.classList.toggle('is-idle', p === lastP)
        }
        lastP = p
        if (pct) pct.textContent = p
        const beat = Math.min(STATUSES.length - 1, Math.floor(i / 3))
        if (statusEl) statusEl.textContent = STATUSES[beat]

        /* The loader performs its own status lines. Once a cue fires
           it stays fired — rain does not stop because the subject
           changed. */
        boot.classList.toggle('boot--neon', beat >= 1)
        boot.classList.toggle('boot--rain', beat >= 2)
        if (beat === 3) boot.classList.add('boot--train')
        if (beat === 4 && cat) cat.classList.add('is-idle') // sit. good cat.
        if (beat === 5) boot.classList.add('boot--glint')
        if (beat === 9) boot.classList.add('boot--duck')

        lines.forEach((li, n) => li.classList.toggle('is-on', n < Math.floor(t * lines.length * 1.6)))

        // the city goes up with the bar, tower by tower
        const up = Math.floor(t * towers.length * 1.15)
        towers.forEach((b, n) => b.classList.toggle('is-up', n < up))

        // the tip types itself in
        if (tipEl) tipEl.textContent = tip.slice(0, Math.round(t * 1.5 * tip.length))

        if (i < STEPS) {
          setTimeout(tick, TOTAL / STEPS)
          return
        }
        setTimeout(() => {
          boot.hidden = true
        }, 260)
      }
      tick()

      // any key or click gets you past it
      const bail = () => {
        boot.hidden = true
      }
      boot.addEventListener('click', bail)
      window.addEventListener('keydown', bail, { once: true })
    }
  }

  /* ==================================================================
     DESKTOP ICONS

     These were four 16x16 sprites hand-written as SVG rects, one
     element per run of pixels, in the defs block at the foot of the
     markup. That is a fine way to ship a sprite and a terrible way to
     AUTHOR one: adding detail meant adding a hundred more <rect>s and
     counting coordinates by hand, so in practice they never got any.
     Four flat objects that mostly read as "a coloured blob with a
     label under it".

     They are written as strings now — one character per pixel, '.' is
     a hole — and painted onto a canvas at load. Same output, except
     the art is legible in the source and can be edited by typing, so
     each one got the room to actually say what it opens.

     All four share a vocabulary, which is the part that makes them
     read as a set rather than as four unrelated pictures: a one-pixel
     ink outline round the silhouette, a lit plane along the top-left,
     a shaded one along the bottom-right, and exactly one accent colour
     from the page palette each.
     ================================================================== */
  const ICON_PAL = {
    k: '#05070f', // ink
    w: '#eaf0ff', // paper / lit face
    s: '#9aa6c8', // paper shade
    d: '#3b3350', // deep shade
    y: '#f8c838', // cartridge yellow
    o: '#c99a20', // cartridge shade
    c: '#3ef0ff', // cyan accent
    m: '#ff3ea5', // magenta accent
    g: '#2fe39a', // green accent
    f: '#f2c39a', // skin
    h: '#8a1fb8', // hair / violet
    r: '#e8484f', // red seal
    b: '#2a1a5c', // screen dark
  }

  const ICONS = {
    /* A cartridge, three-quarter on: shell, paper label with a strip
       of unreadable title type, and the ridged grip along the foot. */
    work: [
      '........................',
      '......kkkkkkkkkkkk......',
      '.....kyyyyyyyyyyyyk.....',
      '....kkyyyyyyyyyyyykk....',
      '....kyyyyyyyyyyyyyyk....',
      '....kyykkkkkkkkkkyyk....',
      '....kyykwwwwwwwwdkyk....',
      '....kyykwbbbbbbwdkyk....',
      '....kyykwbccccbwdkyk....',
      '....kyykwbcmmcbwdkyk....',
      '....kyykwbccccbwdkyk....',
      '....kyykwbbbbbbwdkyk....',
      '....kyykwwwwwwwwdkyk....',
      '....kyykwsswsswsdkyk....',
      '....kyykddddddddddkyk...',
      '....kyykkkkkkkkkkkyyk...',
      '....kyyyyyyyyyyyyyyyk...',
      '....kooooooooooooooook..',
      '....kokokokokokokokook..',
      '....kokokokokokokokook..',
      '....kokokokokokokokook..',
      '....kooooooooooooooook..',
      '.....kkkkkkkkkkkkkkkk...',
      '........................',
    ],
    /* Player one. A bust on a card — hair, face, a headset band,
       shoulders in a jacket with a cyan collar. */
    about: [
      '........................',
      '..kkkkkkkkkkkkkkkkkkkk..',
      '..kwwwwwwwwwwwwwwwwwwk..',
      '..kwssssssssssssssssdk..',
      '..kws....hhhhhhhh...sdk.',
      '..kws...hhhhhhhhhh..sdk.',
      '..kws..hhffffffffh..sdk.',
      '..kws.chhffffffffhc.sdk.',
      '..kws.chfffffffffhc.sdk.',
      '..kws.chffkffffkffhc.dk.',
      '..kws.chfffffffffhc.sdk.',
      '..kws.chffkkkkkkffhc.dk.',
      '..kws.chhffffffffhc.sdk.',
      '..kws..hffffffffh...sdk.',
      '..kws....ffffff.....sdk.',
      '..kws...cccccccc....sdk.',
      '..kws..cccccccccc...sdk.',
      '..kws.cchhhhhhhhcc..sdk.',
      '..kws.chhhhhhhhhhc..sdk.',
      '..kwshhhhhhhhhhhhhhssdk.',
      '..kddddddddddddddddddk..',
      '..kkkkkkkkkkkkkkkkkkkk..',
      '........................',
      '........................',
    ],
    /* A sealed envelope, flap down, with a wax seal on it. The flap
       edges are stepped rather than ruled, because a diagonal is the
       one thing this project will not antialias. */
    contact: [
      '........................',
      '........................',
      '..kkkkkkkkkkkkkkkkkkkk..',
      '..kwwwwwwwwwwwwwwwwwwk..',
      '..kwkwwwwwwwwwwwwwwkwk..',
      '..kwwkwwwwwwwwwwwwkwwk..',
      '..kwwwkwwwwwwwwwwkwwwk..',
      '..kwwwwkwwwwwwwwkwwwwk..',
      '..kwwwwwkwwwwwwkwwwwwk..',
      '..kwwwwwwkwwwwkwwwwwwk..',
      '..kwwwwwwwkwwkwwwwwwwk..',
      '..kwwwwwwwwkkwwwwwwwwk..',
      '..kwsswwwwwrrwwwwwwsswk.',
      '..kwsssswwrrrrwwwsssswk.',
      '..kwssssssrrrrssssssswk.',
      '..kwsssssssrrsssssssswk.',
      '..kwssssssssssssssssswk.',
      '..kwssssssssssssssssswk.',
      '..kdddddddddddddddddddk.',
      '..kkkkkkkkkkkkkkkkkkkk..',
      '........................',
      '........................',
      '........................',
      '........................',
    ],
    /* A one-page CV: folded top corner, a photo block, ruled lines of
       type, and a download arrow sitting under it. */
    resume: [
      '........................',
      '....kkkkkkkkkkkkkk......',
      '....kwwwwwwwwwwkdk......',
      '....kwwwwwwwwwwkddk.....',
      '....kwwwwwwwwwwkdddk....',
      '....kwwwwwwwwwwwwwwk....',
      '....kwbbbbwsssssssswk...',
      '....kwbbbbwssssssssswk..',
      '....kwbbbbwwwwwwwwwwwk..',
      '....kwbbbbwssssssssswk..',
      '....kwwwwwwwwwwwwwwwwk..',
      '....kwssssssssssssswwk..',
      '....kwsssssssssssswwwk..',
      '....kwwwwwwwwwwwwwwwwk..',
      '....kwsssssssssssswwwk..',
      '....kwssssssssswwwwwwk..',
      '....kwwwwwwwwwwwwwwwwk..',
      '....kddddddddddddddddk..',
      '.....kkkkkkkkkkkkkkkk...',
      '..........kggk..........',
      '..........kggk..........',
      '.......kkggggggkk.......',
      '........kggggggk........',
      '.........kkggkk.........',
    ],

    /* ---- the contact row ----
       Four marks, all on the same 24x24 grid with the same one-pixel
       ink outline, so they read as a set rather than as four logos
       borrowed from four places. Deliberately generic silhouettes: an
       envelope, a cat-in-a-circle, a card with a bar, a sheet with an
       arrow. Nobody needs to be told an envelope is email. */
    mail: [
      '........................',
      '........................',
      '..kkkkkkkkkkkkkkkkkkkk..',
      '..kwwwwwwwwwwwwwwwwwwk..',
      '..kwkwwwwwwwwwwwwwwkwk..',
      '..kwwkwwwwwwwwwwwwkwwk..',
      '..kwwwkwwwwwwwwwwkwwwk..',
      '..kwwwwkwwwwwwwwkwwwwk..',
      '..kwwwwwkwwwwwwkwwwwwk..',
      '..kwwwwwwkwwwwkwwwwwwk..',
      '..kwwwwwwwkwwkwwwwwwwk..',
      '..kwwwwwwwwkkwwwwwwwwk..',
      '..kwsswwwwwwwwwwwwsswk..',
      '..kwsssswwwwwwwwsssswk..',
      '..kwssssssssssssssssswk.',
      '..kwssssssssssssssssswk.',
      '..kdddddddddddddddddddk.',
      '..kkkkkkkkkkkkkkkkkkkk..',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
    ],
    github: [
      '........................',
      '.......kkkkkkkkkk.......',
      '.....kkwwwwwwwwwwkk.....',
      '....kwwwwwwwwwwwwwwk....',
      '...kwwwwwwwwwwwwwwwwk...',
      '..kwwwkkwwwwwwwwkkwwwk..',
      '..kwwkddkwwwwwwkddkwwk..',
      '..kwwkddkwwwwwwkddkwwk..',
      '..kwwwkkwwwwwwwwkkwwwk..',
      '..kwwwwwwwwwwwwwwwwwwk..',
      '..kwwwwwwwkkkkwwwwwwwk..',
      '..kwwwwwwwkwwkwwwwwwwk..',
      '...kwwwwwwwwwwwwwwwwk...',
      '...kwwwwwwwwwwwwwwwwk...',
      '....kwwwwwwwwwwwwwwk....',
      '.....kwwwkwwwwkwwwk.....',
      '......kwwkwwwwkwwk......',
      '.......kkkwwwwkkk.......',
      '.........kwwwwk.........',
      '.........kwwwwk.........',
      '..........kkkk..........',
      '........................',
      '........................',
      '........................',
    ],
    linkedin: [
      '........................',
      '..kkkkkkkkkkkkkkkkkkkk..',
      '..kcccccccccccccccccck..',
      '..kcccccccccccccccccck..',
      '..kccwwccccccccccccccck.',
      '..kccwwccccccccccccccck.',
      '..kcccccccccccccccccck..',
      '..kccwwccccwwwwcccccck..',
      '..kccwwcccwwwwwwccccck..',
      '..kccwwcccwwccwwccccck..',
      '..kccwwcccwwccwwccccck..',
      '..kccwwcccwwccwwccccck..',
      '..kccwwcccwwccwwccccck..',
      '..kccwwcccwwccwwccccck..',
      '..kccwwcccwwccwwccccck..',
      '..kcccccccccccccccccck..',
      '..kcccccccccccccccccck..',
      '..kdddddddddddddddddddk.',
      '..kkkkkkkkkkkkkkkkkkkk..',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
    ],
  }

  document.querySelectorAll('canvas[data-icon]').forEach((cv) => {
    const art = ICONS[cv.dataset.icon]
    if (!art) return
    const N = 24
    cv.width = N
    cv.height = N
    const g = cv.getContext('2d')
    g.imageSmoothingEnabled = false
    for (let y = 0; y < art.length; y++) {
      const row = art[y]
      for (let x = 0; x < row.length; x++) {
        const col = ICON_PAL[row[x]]
        if (!col) continue
        g.fillStyle = col
        g.fillRect(x, y, 1, 1)
      }
    }
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

    /* Showing a page is three things: put the others away, reset the
       scroll, and reset the view to its deck — landing on a stage you
       opened ten minutes ago is disorienting in a way that landing on
       the rack never is. */
    function show(id) {
      pages.forEach((el, key) => {
        const on = key === id
        el.hidden = !on
        el.classList.toggle('is-on', on)
        if (on) {
          showDeck(el)
          el.scrollTop = 0
        }
      })
      document.documentElement.dataset.page = id
      current = id
      // the weather reads this to know what it is landing on
      const live = pages.get(id)
      pages.forEach((el) => el.removeAttribute('data-active'))
      if (live) live.setAttribute('data-active', '')

      /* Away from home the city does NOT stop — it keeps crossing, at
         half light, behind the open page. The stage wash turns the neon
         down without freezing the frame, which is what was asked for:
         things still move, the lights just come down. */
      if (window.__scene && window.__scene.setStage) {
        window.__scene.setStage(id !== 'home')
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
      /* Longer, so the wipe reads as a deliberate movement — closing,
         holding black, opening — instead of a flash. Still well under a
         second door to door. */
      const COVER = 300, HOLD = 90, REVEAL = 300
      const cols = Math.ceil(W / CELL), rows = Math.ceil(H / CELL)
      let t0 = null, swapped = false, released = false

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
        else {
          iris.classList.remove('is-on')
          if (window.__scene && window.__scene.pause) window.__scene.pause(false)
          irisBusy = false
          return
        }

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
        requestAnimationFrame(draw)
      }
      requestAnimationFrame(draw)
    }

    function go(id, instant) {
      if (id === current) return
      if (instant || !stepped || irisBusy) { show(id); return }
      irisRun(id)
    }

    window.addEventListener('hashchange', () => go(routeOf()))
    show(routeOf())

    /* ---------------- deck <-> level ----------------

       WORK and ABOUT are select screens, not documents. The page holds
       two views — the rack of cards and one .level per card — and
       choosing a card swaps them. Nothing navigates, nothing opens:
       it is the same page changing what it is showing, which is how a
       game does it and the only place a route would be overkill. */
    let lastCard = null

    function showDeck(scope) {
      const root = scope || document
      root.querySelectorAll('.level').forEach((l) => (l.hidden = true))
      root.querySelectorAll('.deck').forEach((d) => (d.hidden = false))
    }

    function showLevel(id) {
      const lvl = document.getElementById(id)
      if (!lvl) return
      const page = lvl.closest('.page')
      page.querySelectorAll('.deck').forEach((d) => (d.hidden = true))
      page.querySelectorAll('.level').forEach((l) => (l.hidden = l.id !== id))
      // posters inside a hidden pane could not size themselves; now
      // that it is visible, let the generator have another go
      if (window.Posters) window.Posters.paintAll(lvl)
      page.scrollTop = 0
      const back = lvl.querySelector('[data-back]')
      if (back) back.focus()
    }

    document.addEventListener('click', (e) => {
      const go2 = e.target.closest('[data-goto]')
      if (go2) {
        e.preventDefault()
        if (go2.classList.contains('card')) lastCard = go2
        showLevel(go2.dataset.goto)
        return
      }
      const back = e.target.closest('[data-back]')
      if (back) {
        e.preventDefault()
        const page = back.closest('.page')
        showDeck(page)
        page.scrollTop = 0
        // hand focus back to the card they came from, so keyboard users
        // are not dumped at the top of the list
        if (lastCard && page.contains(lastCard)) lastCard.focus()
      }
    })

    /* Escape goes up one level at a time: out of a stage to the rack
       first, and only home if you are already there. Escape that skips
       a level feels like a trapdoor. */
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      const openLevel = document.querySelector('.page.is-on .level:not([hidden])')
      if (openLevel) {
        const page = openLevel.closest('.page')
        showDeck(page)
        if (lastCard && page.contains(lastCard)) lastCard.focus()
        return
      }
      if (current !== 'home') location.hash = '#home'
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

    const role = document.querySelector('.role')
    if (role) role.textContent = 'PLAYER 1 READY'
  })

  /* ---------------- keyboard menu ----------------
     Arrow keys move the cursor, 1-3 jump straight to a row, Enter
     follows it. The cursor is shown by :hover / :focus-visible in CSS,
     so this only has to move focus. */
  const items = Array.from(document.querySelectorAll('.menu a'))
  if (!items.length) return

  let index = -1

  const focusItem = (next) => {
    index = (next + items.length) % items.length
    items[index].focus()
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      focusItem(index + 1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      focusItem(index - 1)
    } else if (e.key >= '1' && e.key <= String(items.length)) {
      focusItem(Number(e.key) - 1)
    }
  })

  items.forEach((item, i) => {
    item.addEventListener('focus', () => {
      index = i
    })
  })
})()
