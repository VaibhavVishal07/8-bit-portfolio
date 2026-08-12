/* ==================================================================
   UI behaviour: the day/night toggle, and arcade keyboard menu.
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
       sideways (wider than the phone breakpoint, still a phone). */
    const skip =
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

      const TOTAL = 780
      const STEPS = 12
      let i = 0

      const tick = () => {
        i++
        if (bootBar) bootBar.style.width = Math.round((i / STEPS) * 100) + '%'
        if (i < STEPS) {
          setTimeout(tick, TOTAL / STEPS)
          return
        }
        setTimeout(() => {
          boot.hidden = true
        }, 140)
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
      '........................',
      '.....kkkkkkkkkkkkkk.....',
      '.....kwwwwwwwwwwkkk.....',
      '.....kwwwwwwwwwwswk.....',
      '.....kwwwwwwwwwwwwk.....',
      '.....kwmmmmmmwwwwwk.....',
      '.....kwmmmmmmwwwwwk.....',
      '.....kwwwwwwwwwwwwk.....',
      '.....kwssssssssswwk.....',
      '.....kwsssssssssssk.....',
      '.....kwwwwwwwwwwwwk.....',
      '.....kwssssssssswwk.....',
      '.....kwsssssssssssk.....',
      '.....kwwwwwwwwwwwwk.....',
      '.....kwsssssswwwwwk.....',
      '.....kwwwwwwwwwwwwk.....',
      '.....kwwwwwwwrrrwwk.....',
      '.....kwwwwwwwrrrwwk.....',
      '.....kddddddddddddk.....',
      '.....kkkkkkkkkkkkkk.....',
      '........................',
      '........................',
      '........................',
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
      '..kwkkwwwwwwwwwwwwkkwk..',
      '..kwwkkwwwwwwwwwwkkwwk..',
      '..kwwwkkwwwwwwwwkkwwwk..',
      '..kwwwwkkwwwwwwkkwwwwk..',
      '..kwwwwwkkwwwwkkwwwwwk..',
      '..kwwwwwwkkwwkkwwwwwwk..',
      '..kwwwwwwwkkkkwwwwwwwk..',
      '..kwwwwwwwwwwwwwwwwwwk..',
      '..kwkkkkkwwwwwwwwwwwwk..',
      '..kwkmmmkwwwwwwwwwwwwk..',
      '..kwkmmmkwwsssssssssdk..',
      '..kwkkkkkwsssssssssssk..',
      '..kwsssssssssssssssssk..',
      '..kwsssssssssssssssssk..',
      '..kddddddddddddddddddk..',
      '..kkkkkkkkkkkkkkkkkkkk..',
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
      '..kwwwwwwwwwwwwwwwwwwk..',
      '..kwcccccccccccccccccd..',
      '..kwccwwccccccccccccdd..',
      '..kwccwwccccccccccccdd..',
      '..kwcccccccccccccccccd..',
      '..kwccwwccccwwwwcccccd..',
      '..kwccwwcccwwwwwwccccd..',
      '..kwccwwcccwwccwwccccd..',
      '..kwccwwcccwwccwwccccd..',
      '..kwccwwcccwwccwwccccd..',
      '..kwccwwcccwwccwwccccd..',
      '..kwccwwcccwwccwwccccd..',
      '..kwccwwcccwwccwwccccd..',
      '..kwcccccccccccccccccd..',
      '..kwccccccccccccccccdd..',
      '..kddddddddddddddddddd..',
      '..kkkkkkkkkkkkkkkkkkkk..',
      '........................',
      '........................',
      '........................',
      '........................',
      '........................',
    ],

    dribbble: [
      '........................',
      '........................',
      '...........kk...........',
      '........kkkkkkkk........',
      '......kkmwwmmmwwkk......',
      '.....kkwwwwmwwwrrkk.....',
      '....kkmmwwwwwwrrrrkk....',
      '....kwwwwwwwmrrrrrrk....',
      '...kwwwwwwwmrrrrrrrrk...',
      '...kmmmmmwwwrrrrrrrrk...',
      '...kmmmmmwwwwrrrrrrrk...',
      '..kkmmmmmrwwwrrrrrrrkk..',
      '..kkmmmmrrwwwrrrrrrrkk..',
      '...kmmmrrrwwwwrrrrrrk...',
      '...kmmrrrrrwwwrrrrrrk...',
      '...kmrrrrrrwwwrrrrrrk...',
      '....krrrrrrrwwwrrrrk....',
      '....kkrrrrrrwwwrrrkk....',
      '.....kkrrrrrrwwrrkk.....',
      '......kkrrrrrwwwkk......',
      '........kkkkkkkk........',
      '...........kk...........',
      '........................',
      '........................',
    ],

    dribbble: [
      '........................',
      '........................',
      '...........kk...........',
      '........kkkkkkkk........',
      '......kkwwmmmmmmkk......',
      '.....kkwwwwmmmmmwkk.....',
      '....kkwwwwwmmwwwwwkk....',
      '....kwwwwwwwwwwwwmmk....',
      '...kwwwwwwwwwwmmmmrrk...',
      '...kwwwwwwwwmmmmmrrrk...',
      '...kmmmmmwwwwmmmrrrrk...',
      '..kkmmmmmmwwwmmrrrrrkk..',
      '..kkmmmmmmwwwwrrrrrrkk..',
      '...kmmmmmmmwwwwrrrrrk...',
      '...kmmmmmmmmwwwrrrrrk...',
      '...kmmmmmmmrwwwwrrrrk...',
      '....kmmmmmrrwwwwwrrk....',
      '....kkmmmrrrrwwwwwkk....',
      '.....kkmrrrrrwwwwkk.....',
      '......kkrrrrrwwwkk......',
      '........kkkkkkkk........',
      '...........kk...........',
      '........................',
      '........................',
    ],

    dribbble: [
      '........................',
      '........................',
      '...........kk...........',
      '........kkkkkkkk........',
      '......kkmwwmmmwwkk......',
      '.....kkwwwwmwwwrrkk.....',
      '....kkmmwwwwwwrrrrkk....',
      '....kwwwwwwwmrrrrrrk....',
      '...kwwwwwwwmrrrrrrrrk...',
      '...kmmmmmwwwrrrrrrrrk...',
      '...kmmmmmwwwwrrrrrrrk...',
      '..kkmmmmmrwwwrrrrrrrkk..',
      '..kkmmmmrrwwwrrrrrrrkk..',
      '...kmmmrrrwwwwrrrrrrk...',
      '...kmmrrrrrwwwrrrrrrk...',
      '...kmrrrrrrwwwrrrrrrk...',
      '....krrrrrrrwwwrrrrk....',
      '....kkrrrrrrwwwrrrkk....',
      '.....kkrrrrrrwwrrkk.....',
      '......kkrrrrrwwwkk......',
      '........kkkkkkkk........',
      '...........kk...........',
      '........................',
      '........................',
    ],
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

  document.querySelectorAll('canvas[data-icon]').forEach((cv) => {
    if (cv.dataset.hires) return
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

      /* Two treatments now, not three:
           home  — the living city, full strength; it IS the shot.
           L2    — every article, index, about AND case study opens as a
                   modal over the SAME backdrop: the city crosses at half
                   light behind a dark scrim, dimmed and pushed back but
                   still there. One simple thing instead of a frameless
                   reading page and a framed case study. `kind` (read vs
                   stage) still drives the type/label styling; the scene
                   treatment is shared. */
      const kind = id === 'home' ? 'home'
        : (live && live.dataset.kind === 'read') ? 'read' : 'stage'
      document.documentElement.dataset.l2 = kind === 'home' ? '' : kind
      if (window.__scene) {
        // never the full lights-out — we want the city visible, just dim
        if (window.__scene.setFocus) window.__scene.setFocus(false)
        if (window.__scene.setStage) window.__scene.setStage(kind !== 'home')
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
