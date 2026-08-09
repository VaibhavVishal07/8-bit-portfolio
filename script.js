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
    const skip = window.matchMedia('(prefers-reduced-motion: reduce)').matches

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

  /* ---------------- day / night ---------------- */
  const modeBtn = document.getElementById('modeToggle')

  if (modeBtn && window.__scene) {
    const label = modeBtn.querySelector('.btn__label')

    const paint = (mode) => {
      modeBtn.dataset.mode = mode
      modeBtn.setAttribute('aria-pressed', mode === 'day' ? 'true' : 'false')
      if (label) label.textContent = mode === 'day' ? 'DAY' : 'NIGHT'
      document.documentElement.dataset.mode = mode
    }

    paint(window.__scene.current())

    modeBtn.addEventListener('click', () => {
      const next = window.__scene.current() === 'day' ? 'night' : 'day'
      window.__scene.setTheme(next)
      paint(next)
    })
  }

  /* ---------------- weather ----------------
     Rain and snow are mutually exclusive in the scene, so both buttons
     repaint after either is pressed. */
  const rainBtn = document.getElementById('rainToggle')
  const snowBtn = document.getElementById('snowToggle')

  if (rainBtn && snowBtn && window.__scene) {
    const set = (btn, on, word) => {
      btn.setAttribute('aria-pressed', on ? 'true' : 'false')
      const label = btn.querySelector('.btn__label')
      if (label) label.textContent = `${word} ${on ? 'ON' : 'OFF'}`
    }

    const paint = () => {
      set(rainBtn, window.__scene.raining(), 'RAIN')
      set(snowBtn, window.__scene.snowing(), 'SNOW')
    }

    paint()

    rainBtn.addEventListener('click', () => {
      window.__scene.setRain(!window.__scene.raining())
      paint()
    })

    snowBtn.addEventListener('click', () => {
      window.__scene.setSnow(!window.__scene.snowing())
      paint()
    })
  }

  /* ==================================================================
     WINDOWS

     The title bar has had minimise, maximise and close on it since the
     beginning and they did nothing. Now they do, and there is a second
     window for the work.

     One window is up at a time — opening WORK sends the title screen
     down to the taskbar, exactly as described. Each window is in one of
     three states and no more:

       up      on screen, and the only one on screen
       min     alive, but down on the taskbar
       closed  gone, and not on the taskbar either

     The taskbar itself only exists when there is more than one window
     in play. On the bare title screen it would just be covering the
     rooftop, which is the most detailed part of the scene.
     ================================================================== */
  const wins = new Map()
  document.querySelectorAll('.window').forEach((el) => wins.set(el.dataset.win, el))

  const bar = document.querySelector('.taskbar')
  const taskHost = document.querySelector('.taskbar__tasks')

  if (wins.size && bar && taskHost) {
    const LABEL = {
      portfolio: 'PORTFOLIO.EXE',
      work: 'WORK.EXE',
      about: 'ABOUT.EXE',
      contact: 'CONTACT.EXE',
    }
    const desk = document.querySelector('.desktop')
    const state = new Map()
    wins.forEach((el, id) => state.set(id, el.hasAttribute('hidden') ? 'closed' : 'up'))

    const stepped = !window.matchMedia('(prefers-reduced-motion: reduce)').matches

    /* ---- the zoom rectangle ----
       What Windows 98 did between a window and its taskbar button: an
       outline that walks the gap in a handful of jumps and is gone
       before you have finished registering it. Eight frames at 20ms is
       about a sixth of a second, which is roughly what the real one
       took — long enough to say where the window went, short enough
       that it never feels like it is being animated at you. */
    const ZOOM_STEPS = 8
    const ZOOM_MS = 20

    function zoom(from, to, done) {
      if (!stepped || !from || !to || !from.width || !to.width) {
        if (done) done()
        return
      }
      const box = document.createElement('div')
      box.className = 'zoombox'
      document.body.appendChild(box)

      let i = 0
      const step = () => {
        const t = i / ZOOM_STEPS
        box.style.left = Math.round(from.left + (to.left - from.left) * t) + 'px'
        box.style.top = Math.round(from.top + (to.top - from.top) * t) + 'px'
        box.style.width = Math.max(4, Math.round(from.width + (to.width - from.width) * t)) + 'px'
        box.style.height = Math.max(4, Math.round(from.height + (to.height - from.height) * t)) + 'px'
        if (i++ > ZOOM_STEPS) {
          box.remove()
          if (done) done()
          return
        }
        setTimeout(step, ZOOM_MS)
      }
      step()
    }

    const rectOf = (el) => (el ? el.getBoundingClientRect() : null)
    const taskRect = (id) => {
      const b = [...taskHost.children].find((c) => c.dataset.win === id)
      return b ? b.getBoundingClientRect() : null
    }

    /* Minimising: measure the window, put it away, then fly the outline
       down to the button that has just appeared for it. */
    function goDown(id) {
      const from = rectOf(wins.get(id))
      state.set(id, 'min')
      paint()
      zoom(from, taskRect(id))
    }

    /* Restoring: the reverse, and the window stays hidden while the
       outline is in flight so it arrives rather than being there
       already. */
    function goUp(id) {
      const from = taskRect(id)
      open(id)
      paint()
      const el = wins.get(id)
      el.classList.add('is-zooming')
      zoom(from, rectOf(el), () => el.classList.remove('is-zooming'))
    }

    const paint = () => {
      let live = 0
      let anyMin = false

      wins.forEach((el, id) => {
        const st = state.get(id)
        el.hidden = st !== 'up'
        // the weather reads this to know which window it is landing on
        if (st === 'up') el.setAttribute('data-active', '')
        else el.removeAttribute('data-active')
        if (st !== 'closed') live++
        if (st === 'min') anyMin = true
      })

      const maxed = [...wins.values()].some((el) => !el.hidden && el.classList.contains('is-max'))
      document.documentElement.dataset.max = maxed ? 'on' : 'off'

      const desktop = live > 1 || anyMin
      bar.hidden = !desktop
      document.documentElement.dataset.desktop = desktop ? 'on' : 'off'

      /* The icons come out only when every window is down. That is the
         one moment there is actually a desktop to look at, and it is
         also the one moment you have no other way back in. */
      const bare = ![...state.values()].includes('up')
      if (desk) desk.hidden = !bare

      taskHost.textContent = ''
      wins.forEach((el, id) => {
        if (state.get(id) === 'closed') return
        const b = document.createElement('button')
        b.type = 'button'
        b.className = 'taskbar__task'
        b.dataset.win = id
        b.textContent = LABEL[id] || id
        b.setAttribute('aria-pressed', state.get(id) === 'up' ? 'true' : 'false')
        b.addEventListener('click', () => {
          // clicking the window that is already up puts it away again
          if (state.get(id) === 'up') goDown(id)
          else goUp(id)
        })
        taskHost.appendChild(b)
      })
    }

    function open(id) {
      wins.forEach((el, other) => {
        if (other !== id && state.get(other) === 'up') state.set(other, 'min')
      })
      state.set(id, 'up')
      const el = wins.get(id)
      const inner = el && el.querySelector('.screen__inner--doc')
      if (inner) inner.scrollTop = 0
    }

    function close(id) {
      state.set(id, 'closed')
      wins.get(id).classList.remove('is-max')
      // fall back to whatever is still alive, so the screen is never bare
      if (![...state.values()].includes('up')) {
        for (const [other, st] of state) {
          if (st === 'min') {
            state.set(other, 'up')
            break
          }
        }
      }
    }

    /* Maximising has to give up any dragged position first, or the
       inline left/top beat the class's inset and the window "maximises"
       to wherever you happened to leave it. */
    function toggleMax(el) {
      if (!el.classList.contains('is-max')) {
        el.classList.remove('is-free')
        el.style.left = ''
        el.style.top = ''
        el.style.width = ''
      }
      el.classList.toggle('is-max')
      paint()
    }

    // minimise / maximise / close, on every window's title bar
    wins.forEach((el, id) => {
      el.querySelectorAll('.winbtn[data-act]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const act = btn.dataset.act
          if (act === 'min') {
            goDown(id)
            return
          }
          // Closing is instant, as it was: there is nothing to fly to,
          // and whatever gets promoted is simply revealed underneath.
          if (act === 'max') toggleMax(el)
          else {
            close(id)
            paint()
          }
        })
      })
    })

    /* ---- dragging ----
       By the title bar, as in the original. Windows 98 dragged an
       outline and only moved the window on release; this moves the
       window itself, because that is what a hand expects now — but the
       position is rounded to whole pixels every frame, so a window
       being dragged never lands between them. */
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v))
    let drag = null

    wins.forEach((el) => {
      const barEl = el.querySelector('.window__bar')
      if (!barEl) return

      barEl.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || e.target.closest('.winbtn')) return
        // on a phone the window is full-width; dragging it around only
        // fights the scroll gesture
        if (window.matchMedia('(max-width: 760px)').matches) return
        if (el.classList.contains('is-max')) return
        const r = el.getBoundingClientRect()
        el.classList.add('is-free')
        el.style.width = Math.round(r.width) + 'px'
        el.style.left = Math.round(r.left) + 'px'
        el.style.top = Math.round(r.top) + 'px'
        drag = { el, dx: e.clientX - r.left, dy: e.clientY - r.top, w: r.width }
        barEl.setPointerCapture(e.pointerId)
        e.preventDefault()
      })

      barEl.addEventListener('pointermove', (e) => {
        if (!drag || drag.el !== el) return
        const barH = bar.hidden ? 0 : bar.offsetHeight
        /* The title bar is never allowed off the screen. Lose that and
           the window is gone: there is no way to grab it back. */
        el.style.left =
          clamp(Math.round(e.clientX - drag.dx), 60 - drag.w, window.innerWidth - 60) + 'px'
        el.style.top =
          clamp(Math.round(e.clientY - drag.dy), 0, window.innerHeight - barH - 30) + 'px'
      })

      const end = () => {
        drag = null
      }
      barEl.addEventListener('pointerup', end)
      barEl.addEventListener('pointercancel', end)

      // double-click the bar to maximise, as it always has been
      barEl.addEventListener('dblclick', (e) => {
        if (e.target.closest('.winbtn')) return
        // maximise is hidden on mobile; a double-tap must not secretly
        // trigger what the UI no longer offers
        if (window.matchMedia('(max-width: 760px)').matches) return
        toggleMax(el)
      })
    })

    // a dragged window must not be left stranded off-screen by a resize
    window.addEventListener('resize', () => {
      wins.forEach((el) => {
        if (!el.classList.contains('is-free')) return
        const r = el.getBoundingClientRect()
        const barH = bar.hidden ? 0 : bar.offsetHeight
        el.style.left = clamp(Math.round(r.left), 60 - r.width, window.innerWidth - 60) + 'px'
        el.style.top = clamp(Math.round(r.top), 0, window.innerHeight - barH - 30) + 'px'
      })
    })

    /* Launching. Both halves run at once, which is what an OS does:
       whatever was up drops to the bar while the new window comes up
       off it. If nothing was up — you are looking at the desktop — only
       the second half plays. */
    function launch(id) {
      // a window always opens on its deck, whatever was open last time
      const deckWin = document.querySelector('.window[data-win="' + id + '"]')
      if (deckWin) showDeck(deckWin)
      if (!wins.has(id) || state.get(id) === 'up') return
      const prev = [...state.keys()].find((k) => state.get(k) === 'up')
      const fromPrev = prev ? rectOf(wins.get(prev)) : null
      open(id)
      paint()
      if (prev) zoom(fromPrev, taskRect(prev))
      const w = wins.get(id)
      w.classList.add('is-zooming')
      zoom(taskRect(id) || rectOf(w), rectOf(w), () => {
        w.classList.remove('is-zooming')
        const btn = w.querySelector('.winbtn--close')
        if (btn) btn.focus()
      })
    }

    // the title-screen menu
    document.querySelectorAll('.menu a[href]').forEach((a) => {
      const id = a.getAttribute('href').slice(1)
      if (!wins.has(id)) return
      a.addEventListener('click', (e) => {
        e.preventDefault()
        launch(id)
      })
    })

    /* Cross-page links inside documents: "see the work", "say hello".
       Same launch as the menu, so the windows swap properly. */
    document.querySelectorAll('a[data-open-win]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault()
        const id = a.dataset.openWin
        if (state.get(id) === 'min') goUp(id)
        else launch(id)
      })
    })

    // and the desktop icons
    document.querySelectorAll('.dicon[data-open]').forEach((b) => {
      b.addEventListener('click', () => {
        const id = b.dataset.open
        if (state.get(id) === 'min') goUp(id)
        else launch(id)
      })
    })

    /* ---------------- deck <-> level ----------------

       WORK and ABOUT are not documents; they are select screens. The
       window holds two views - the .deck of cards and one .level per
       card - and choosing a card swaps them. Nothing navigates away,
       nothing opens another window: it is the same screen changing
       what it is showing, which is how a game does it. */
    let lastCard = null

    function showDeck(win) {
      const scope = win || doc
      scope.querySelectorAll('.level').forEach((l) => (l.hidden = true))
      scope.querySelectorAll('.deck').forEach((d) => (d.hidden = false))
      const sc = scope.querySelector('.screen__inner')
      if (sc) sc.scrollTop = 0
    }

    function showLevel(id) {
      const lvl = document.getElementById(id)
      if (!lvl) return
      const win = lvl.closest('.window')
      win.querySelectorAll('.deck').forEach((d) => (d.hidden = true))
      win.querySelectorAll('.level').forEach((l) => (l.hidden = l.id !== id))
      // posters inside a hidden pane could not size themselves; now
      // that it is visible, let the generator have another go
      if (window.Posters) window.Posters.paintAll(lvl)
      const sc = win.querySelector('.screen__inner')
      if (sc) sc.scrollTop = 0
      const back = lvl.querySelector('[data-back]')
      if (back) back.focus()
    }

    document.addEventListener('click', (e) => {
      const go = e.target.closest('[data-goto]')
      if (go) {
        e.preventDefault()
        if (go.classList.contains('card')) lastCard = go
        showLevel(go.dataset.goto)
        return
      }
      const back = e.target.closest('[data-back]')
      if (back) {
        e.preventDefault()
        const win = back.closest('.window')
        showDeck(win)
        // hand focus back to the card they came from, so keyboard
        // users are not dumped at the top of the list
        if (lastCard && win.contains(lastCard)) lastCard.focus()
      }
    })
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return
      /* One step at a time: escape out of a stage back to the select
         screen first, and only close the window if you are already
         there. Escape that skips a level feels like a trapdoor. */
      const openLevel = document.querySelector('.window:not([hidden]) .level:not([hidden])')
      if (openLevel) {
        const lw = openLevel.closest('.window')
        showDeck(lw)
        if (lastCard && lw.contains(lastCard)) lastCard.focus()
        return
      }
      for (const [id, st] of state) {
        if (st === 'up' && id !== 'portfolio') {
          close(id)
          paint()
          return
        }
      }
    })

    paint()

    /* The tray clock. It only shows hours and minutes, so it is only
       worth repainting when the minute turns. */
    const clock = document.getElementById('clock')
    if (clock) {
      const tick = () => {
        const d = new Date()
        clock.textContent =
          String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
        setTimeout(tick, (60 - d.getSeconds()) * 1000)
      }
      tick()
    }
  }

  /* ---------------- expanding case studies ----------------
     The work page was a wall you could only read. Each case now opens
     in place, and its grid cell takes the full width while it is open
     so the detail has somewhere to go. One at a time: two open cases
     side by side is a page, not a study. */
  document.querySelectorAll('.case[aria-controls]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const panel = document.getElementById(btn.getAttribute('aria-controls'))
      const cell = btn.closest('.cell')
      const open = btn.getAttribute('aria-expanded') === 'true'

      document.querySelectorAll('.case[aria-expanded="true"]').forEach((other) => {
        other.setAttribute('aria-expanded', 'false')
        const p = document.getElementById(other.getAttribute('aria-controls'))
        if (p) p.hidden = true
        const c = other.closest('.cell')
        if (c) c.classList.remove('is-open')
      })

      if (open) return
      btn.setAttribute('aria-expanded', 'true')
      if (panel) panel.hidden = false
      if (cell) cell.classList.add('is-open')
    })
  })

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

    const press = document.querySelector('.press')
    if (press) press.textContent = 'PLAYER 1 READY'
    const title = document.querySelector('.window__title')
    if (title) title.textContent = 'SECRET.EXE'
  })

  /* ==================================================================
     THE CAT, TALKING

     Every L2 page carries a dialogue box with the rooftop cat beside
     it. It types an intro the first time its window opens, and any
     element carrying data-say re-types the box when pointed at. The
     typing is character-by-character on a timer — the one animation in
     the project that is stepped by its very nature.
     ================================================================== */
  const talkFast = window.matchMedia('(prefers-reduced-motion: reduce)').matches

  document.querySelectorAll('.screen__inner--doc').forEach((doc) => {
    const talk = document.querySelector('.talk')
    if (!talk) return
    const out = talk.querySelector('.talk__text')
    let timer = 0
    let current = ''

    const say = (line) => {
      if (line === current) return // don't restart mid-sentence on re-hover
      current = line
      clearTimeout(timer)
      if (talkFast) {
        out.textContent = line
        return
      }
      let i = 0
      out.textContent = ''
      const tick = () => {
        // three characters a tick: timers stretch under the canvas's
        // frame budget, and a line must never take longer to type than
        // it takes to read
        i = Math.min(line.length, i + 3)
        out.textContent = line.slice(0, i)
        if (i < line.length) timer = setTimeout(tick, 28)
      }
      tick()
    }

    // anything in this document that has something to say
    document.addEventListener('mouseover', (e) => {
      const t = e.target.closest('[data-say]')
      if (t) say(t.dataset.say)
    })
    document.addEventListener('focusin', (e) => {
      const t = e.target.closest('[data-say]')
      if (t) say(t.dataset.say)
    })
    /* Touch has no hover, so a tap asks the cat directly. This also
       fires alongside a click that does something else (opening a
       stage), which is right: the cat comments on what you just did. */
    document.addEventListener('click', (e) => {
      const t = e.target.closest('[data-say]')
      if (t) say(t.dataset.say)
    })

    // the intro fires when the window first becomes visible
    const win = talk.closest('.window')
    if (win) {
      let greeted = false
      new MutationObserver(() => {
        if (win.hidden || greeted) return
        greeted = true
        say(talk.dataset.intro || '')
      }).observe(win, { attributes: true, attributeFilter: ['hidden'] })
    }
  })

  /* The CONTINUE countdown on the contact page. It counts 9 to 0 and
     rolls over, forever, because that is what an arcade board does
     when nobody puts a coin in. */
  const continueN = document.getElementById('continueN')
  if (continueN && !talkFast) {
    let n = 9
    setInterval(() => {
      n = n === 0 ? 9 : n - 1
      continueN.textContent = n
    }, 1000)
  }

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
