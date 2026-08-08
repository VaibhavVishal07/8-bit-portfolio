/* ==================================================================
   UI behaviour: the day/night toggle, and arcade keyboard menu.
   ================================================================== */

(function () {
  'use strict'

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
