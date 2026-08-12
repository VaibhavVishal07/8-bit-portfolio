/* ==================================================================
   WRITING — data-driven articles

   Every piece of writing is one entry in ARTICLES below. From that one
   list this file builds four things, so adding a twentieth article is a
   twentieth entry and nothing else:

     - the article's own L2 page (eyebrow, title, standfirst, body),
     - its foot navigation (back to the index, and prev / next),
     - the Writing INDEX page that lists them all, grouped by year,
     - the short preview on the home column.

   Order in the array is reading order: the first entry is the newest and
   the top of the index, and prev/next step along it. Body is a list of
   blocks; the block types are rendered by `blockHTML` at the foot.

   This runs before script.js, so the router picks the generated pages up
   with all the hand-written ones.
   ================================================================== */
(function () {
  'use strict'

  const AUTHOR = 'Vaibhav Vishal'

  const ARTICLES = [
    {
      id: 'r1', kind: 'ESSAY', year: 2026, date: 'March 2026', read: '6 min',
      title: 'Designing for the first five seconds',
      standfirst: 'Most of what a product will ever say to a new user, it says before they have read a single word. Here is how to spend that budget.',
      body: [
        { t: 'lead', html: 'This is where the piece opens: one idea, stated plainly, before the reader has decided whether to stay. The measure is deliberately narrow, the type is set for reading rather than for looking, and nothing in the margin is competing for the eye.' },
        { t: 'p', html: 'Placeholder copy sits in for the real argument. It runs long enough to show how a paragraph breaks across this measure, how the leading feels underneath a line or two, and where the reader’s attention lands when there is nothing on the page but the words.' },
        { t: 'fig', cap: 'Placeholder art, drawn in code, in the shape the real figure will take. A caption earns its place by saying the thing the picture cannot say for itself.' },
        { t: 'h', html: 'The part that carries the weight' },
        { t: 'p', html: 'A subhead marks the turn in the argument. Below it the paragraphs get more specific: an example, a number, a concession to the obvious objection. This is the section a skim-reader stops on, so it earns the most care.' },
        { t: 'quote', html: 'A pull quote lifts the one sentence you would want a reader to remember if they remembered nothing else.' },
        { t: 'p', html: 'After the quote the piece widens back out. A short list often does the work here, because a list reads as a set of decisions rather than as prose asking to be believed:' },
        { t: 'ul', items: ['State the claim before defending it.', 'Show the smallest example that still proves the point.', 'Name the trade-off you are choosing to accept.'] },
        { t: 'p', html: 'The closing paragraph does not summarise. It hands the idea back to the reader with one thing to do differently, and then it stops.' },
      ],
    },
    {
      id: 'r2', kind: 'NOTE', year: 2026, date: 'January 2026', read: '4 min',
      title: 'Stepped motion, and when to break it',
      standfirst: 'Twelve frames a second is a choice, not a limitation. A short note on when to hold the step and when to let a thing move.',
      body: [
        { t: 'lead', html: 'A note is shorter than an essay and knows it. It opens on the point instead of walking up to it, and it trusts the reader to already care.' },
        { t: 'p', html: 'Placeholder copy stands in for the observation. It is long enough to feel like a thought and short enough to read in one sitting, which is the whole reason the form exists.' },
        { t: 'h', html: 'One rule, then the exception' },
        { t: 'p', html: 'State the rule the piece lives by, then spend the rest of it on the single case where the rule should be broken. That exception is the reason anyone is still reading.' },
        { t: 'quote', html: 'The step is the identity; the exception is the craft.' },
        { t: 'p', html: 'End on the exception, not the rule. A note that closes by restating its own premise has wasted the reader’s last ten seconds.' },
      ],
    },
    {
      id: 'r3', kind: 'ESSAY', year: 2025, date: 'November 2025', read: '8 min',
      title: 'The case against the hamburger menu',
      standfirst: 'Hiding the navigation saves a row of pixels and costs you the one thing an interface is for. A longer argument, with the counter-argument taken seriously.',
      body: [
        { t: 'lead', html: 'The longest piece in the set earns its length by taking the other side seriously before it disagrees. It opens by granting what the pattern gets right.' },
        { t: 'p', html: 'Placeholder copy fills the body. It runs across several paragraphs so the measure, the leading and the rhythm of a real long-read are all visible here, ready for the actual words to replace it line for line.' },
        { t: 'h', html: 'Where it goes wrong' },
        { t: 'p', html: 'The middle section is the argument proper: the claim, the evidence, and the example that would be hard to explain away. This is the part worth writing carefully, because it is the part a fair reader came to test.' },
        { t: 'quote', html: 'An interface that hides its map is asking the visitor to already know the building.' },
        { t: 'h', html: 'The honest objection' },
        { t: 'p', html: 'Name the strongest case for the other side and answer it directly. A list keeps the answer from turning into special pleading:' },
        { t: 'ul', items: ['On small screens, room is genuinely scarce.', 'Some products really are single-purpose.', 'Familiarity has a value of its own.'] },
        { t: 'p', html: 'The close concedes the narrow case and holds the general one, then stops before it starts repeating itself.' },
      ],
    },
    {
      id: 'r4', kind: 'ESSAY', year: 2025, date: 'June 2025', read: '7 min',
      title: 'What a design system owes its users',
      standfirst: 'A design system’s real users are the people building with it, not the people looking at the result. That changes what it should optimise for.',
      body: [
        { t: 'lead', html: 'This piece reframes a familiar thing by asking who it is actually for, and lets the rest of the argument fall out of the answer.' },
        { t: 'p', html: 'Placeholder copy stands in for the reframing. It gives the layout a few paragraphs to breathe so the shape of the finished essay is legible before a word of it is real.' },
        { t: 'h', html: 'Optimise for the second reader' },
        { t: 'p', html: 'The core idea gets its own section: the system serves the engineer opening it at midnight far more than the executive reviewing a mock. Design for that person and the surface takes care of itself.' },
        { t: 'quote', html: 'A component nobody can find is a component nobody built.' },
        { t: 'p', html: 'Supporting points work best as a short set of commitments a system makes to the people using it:' },
        { t: 'ul', items: ['One obvious way to do the common thing.', 'An escape hatch for the uncommon one.', 'Names that survive being said out loud.'] },
        { t: 'p', html: 'It ends on the commitment, not the caveat, and leaves the reader with something to hold the next system to.' },
      ],
    },
    {
      id: 'r5', kind: 'NOTE', year: 2024, date: 'October 2024', read: '5 min',
      title: 'Shipping is a design decision',
      standfirst: 'The choice of when to ship shapes the work more than most of the choices we call design. A short note on treating it that way.',
      body: [
        { t: 'lead', html: 'A closing note, short by design. It states the idea and gets out of the way, which is also the argument it is making.' },
        { t: 'p', html: 'Placeholder copy sits here in place of the real thought, long enough to read as a note and no longer than it needs to be.' },
        { t: 'h', html: 'The deadline is a material' },
        { t: 'p', html: 'Treat the date the way you treat the grid or the palette: as a constraint that does part of the designing for you, if you let it.' },
        { t: 'quote', html: 'A draft you keep is a decision you are avoiding.' },
        { t: 'p', html: 'It ends on the thing you can do today, and then, like a good ship date, it arrives.' },
      ],
    },
  ]

  // ---- small helpers ----
  const el = (tag, cls, html) => {
    const n = document.createElement(tag)
    if (cls) n.className = cls
    if (html != null) n.innerHTML = html
    return n
  }
  const meta = (a) => a.kind + ' · ' + a.read

  /* Every hero and figure is a real photograph. They are served from Lorem
     Picsum (the Unsplash photo library, addressed by a stable seed) so each
     slot gets its own picture and it stays the same on every reload — swap
     any `src` for a specific photo when you have one, or set hero.src on the
     article to override its hero. */
  const IMG = (seed, w, h) =>
    'https://picsum.photos/seed/' + encodeURIComponent(seed) + '/' + w + '/' + h

  let figCount = 0
  let artId = 'r'

  function heroHTML(a) {
    if (a.hero === false) return ''
    const src = (a.hero && a.hero.src) ? a.hero.src : IMG('hero-' + a.id, 1200, 675)
    const alt = (a.hero && a.hero.alt) ? a.hero.alt : ''
    const cap = (a.hero && a.hero.cap)
      ? '<figcaption class="read__figcap">' + a.hero.cap + '</figcaption>'
      : ''
    return '<figure class="read__hero">' +
      '<img class="card__art card__art--wide" src="' + src + '" alt="' + alt + '" loading="eager">' +
      cap + '</figure>'
  }

  function blockHTML(b) {
    switch (b.t) {
      case 'lead': return '<p class="read__lead">' + b.html + '</p>'
      case 'p': return '<p>' + b.html + '</p>'
      case 'h': return '<h3>' + b.html + '</h3>'
      case 'quote': return '<blockquote>' + b.html + '</blockquote>'
      case 'ul': return '<ul>' + b.items.map((i) => '<li>' + i + '</li>').join('') + '</ul>'
      case 'fig': {
        const n = String(++figCount).padStart(2, '0')
        const src = IMG('fig-' + artId + '-' + figCount, 1200, 675)
        return '<figure class="read__fig">' +
          '<img class="card__art card__art--wide" src="' + src + '" alt="" loading="lazy">' +
          '<figcaption class="read__figcap"><b>Fig. ' + n + '</b> ' + b.cap + '</figcaption></figure>'
      }
      default: return ''
    }
  }

  // ---- build one article page ----
  function articlePage(a, prev, next) {
    figCount = 0
    // the article's id keys its images, so its pictures are its own
    artId = a.id
    const eyebrow = a.kind + ' <span class="read__sep">·</span> ' + a.date +
      ' <span class="read__sep">·</span> ' + a.read.toUpperCase() + ' READ'

    let nav = '<nav class="read__nav">' +
      '<a class="read__nav__back" href="#writing">← All writing</a>' +
      '<div class="read__nav__seq">'
    if (prev) nav += '<a class="read__nav__link read__nav__prev" href="#' + prev.id + '">' +
      '<span class="read__nav__dir">← Previous</span><span class="read__nav__ttl">' + prev.title + '</span></a>'
    if (next) nav += '<a class="read__nav__link read__nav__next" href="#' + next.id + '">' +
      '<span class="read__nav__dir">Next →</span><span class="read__nav__ttl">' + next.title + '</span></a>'
    nav += '</div></nav>'

    const html =
      '<article class="col col--doc read">' +
      '<nav class="l2nav"><a class="cta cta--ghost" href="#writing">' +
        '<span aria-hidden="true">←</span> All writing</a></nav>' +
      '<p class="read__eyebrow">' + eyebrow + '</p>' +
      '<h2 class="read__title">' + a.title + '</h2>' +
      '<p class="read__standfirst">' + a.standfirst + '</p>' +
      '<div class="read__byline"><span class="read__by">' + AUTHOR + '</span>' +
      '<span class="read__dot" aria-hidden="true"></span><span>' + a.date + '</span></div>' +
      '<div class="read__rule" aria-hidden="true"></div>' +
      heroHTML(a) +
      '<div class="prose read__body">' + a.body.map(blockHTML).join('') + '</div>' +
      '<p class="read__end" aria-hidden="true">◆</p>' +
      nav +
      '</article>'

    const section = el('section', 'page')
    section.dataset.page = a.id
    section.dataset.kind = 'read'
    section.hidden = true
    section.innerHTML = html
    return section
  }

  // ---- build the index page ----
  function indexPage() {
    const section = el('section', 'page')
    section.dataset.page = 'writing'
    section.dataset.kind = 'read'
    section.hidden = true

    let years = ''
    let lastYear = null
    ARTICLES.forEach((a) => {
      if (a.year !== lastYear) {
        if (lastYear !== null) years += '</ul></div>'
        years += '<div class="windex__year"><h3 class="windex__yh">' + a.year + '</h3><ul class="windex__list">'
        lastYear = a.year
      }
      years += '<li><a href="#' + a.id + '">' +
        '<span class="windex__title">' + a.title + '</span>' +
        '<span class="windex__meta">' + meta(a) + '</span></a></li>'
    })
    if (lastYear !== null) years += '</ul></div>'

    section.innerHTML =
      '<div class="col col--doc windex">' +
      '<nav class="l2nav"><a class="cta cta--ghost" href="#home">' +
        '<span aria-hidden="true">←</span> Home</a></nav>' +
      '<p class="read__eyebrow">WRITING <span class="read__sep">·</span> ' + ARTICLES.length + ' PIECES</p>' +
      '<h2 class="read__title">Writing</h2>' +
      '<p class="read__standfirst">Notes and essays on design, motion, and the craft of building products.</p>' +
      '<div class="read__rule" aria-hidden="true"></div>' +
      years +
      '</div>'
    return section
  }

  // ---- the home preview: a few recent, then a link to them all ----
  function homePreview(host, n) {
    const recent = ARTICLES.slice(0, n)
    let rows = '<ul class="reads">'
    recent.forEach((a) => {
      rows += '<li><a href="#' + a.id + '">' +
        '<span class="reads__title">' + a.title + '</span>' +
        '<span class="reads__meta">' + a.year + ' · ' + a.read + '</span></a></li>'
    })
    rows += '</ul>'
    rows += '<p class="home-cta"><a class="cta cta--primary" href="#writing">' +
      'All writing (' + ARTICLES.length + ') <span aria-hidden="true">→</span></a></p>'
    host.innerHTML = rows
  }

  // ---- wire it all up ----
  const main = document.querySelector('main.app') || document.querySelector('main')
  if (main) {
    const frag = document.createDocumentFragment()
    frag.appendChild(indexPage())
    ARTICLES.forEach((a, i) => {
      frag.appendChild(articlePage(a, ARTICLES[i - 1], ARTICLES[i + 1]))
    })
    main.appendChild(frag)
  }

  const host = document.getElementById('writingHome')
  if (host) homePreview(host, 3)
})()
