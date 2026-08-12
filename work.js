/* ==================================================================
   THE WORK

   Four case studies, declared as data and rendered here.

   The point of doing it this way is not DRY-ness — it is that each
   study gets to be a DIFFERENT SHAPE. A portfolio where every project
   runs Overview / Problem / Solution / Outcome tells a reader that the
   designer has one move. These four are built from a shared vocabulary
   of blocks, and each one picks the blocks its story actually needs:

     w1  a merchandising SYSTEM       — anatomy, rules, a trade-off
     w2  an INTERACTION               — one object across three states
     w3  a tangle of ENTITLEMENTS     — a map, then a spine
     w4  a DECISION                   — a funnel reframed as a question

   Nothing here is photographed and nothing is stock. Every figure is
   an inline SVG schematic drawn to the same grid, which is also how
   the NDA problem gets solved honestly: you cannot show the pixels,
   but you can show the STRUCTURE, and the structure is the part a
   design director is actually reading for.
   ================================================================== */
(function () {
  'use strict'

  /* ---------------- diagram kit ----------------
     One vocabulary for every figure: hairline strokes, square corners,
     mono labels, and exactly two accents out of the page palette. It
     has to read as "drawn by the same hand as the rest of the site"
     without turning into pixel art — a schematic is a serious object
     and should look like one. */

  const SVG = (vb, body, cls) =>
    '<svg class="dg ' + (cls || '') + '" viewBox="' + vb + '" role="presentation" ' +
    'preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">' + body + '</svg>'

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

  // a labelled box
  const box = (x, y, w, h, text, o) => {
    o = o || {}
    const cls = 'dg__box' + (o.accent ? ' is-' + o.accent : '') + (o.ghost ? ' is-ghost' : '')
    let s = '<rect class="' + cls + '" x="' + x + '" y="' + y + '" width="' + w + '" height="' + h + '"/>'
    if (text) {
      const lines = Array.isArray(text) ? text : [text]
      const start = y + h / 2 - (lines.length - 1) * 8
      lines.forEach(function (ln, i) {
        s += '<text class="dg__t' + (o.accent ? ' is-' + o.accent : '') + '" x="' + (x + w / 2) +
          '" y="' + (start + i * 16 + 4) + '" text-anchor="middle">' + esc(ln) + '</text>'
      })
    }
    if (o.tag) {
      s += '<text class="dg__tag" x="' + (x + 8) + '" y="' + (y + 15) + '">' + esc(o.tag) + '</text>'
    }
    return s
  }

  const cap = (x, y, t, anchor) =>
    '<text class="dg__cap" x="' + x + '" y="' + y + '" text-anchor="' + (anchor || 'start') + '">' +
    esc(t) + '</text>'

  // an arrow between two points; only ever orthogonal, because a
  // diagonal in a schematic is a decision nobody made
  const arrow = (x1, y1, x2, y2, o) => {
    o = o || {}
    const cls = 'dg__ln' + (o.accent ? ' is-' + o.accent : '') + (o.dash ? ' is-dash' : '')
    let s = '<line class="' + cls + '" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>'
    if (o.head !== false) {
      const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1)
      const p = dx
        ? (x2 - dx * 7) + ',' + (y2 - 5) + ' ' + x2 + ',' + y2 + ' ' + (x2 - dx * 7) + ',' + (y2 + 5)
        : (x2 - 5) + ',' + (y2 - dy * 7) + ' ' + x2 + ',' + y2 + ' ' + (x2 + 5) + ',' + (y2 - dy * 7)
      s += '<polyline class="' + cls + ' dg__head" points="' + p + '"/>'
    }
    return s
  }

  const rule = (x1, y, x2) =>
    '<line class="dg__rule" x1="' + x1 + '" y1="' + y + '" x2="' + x2 + '" y2="' + y + '"/>'

  /* ---------------- the figures ---------------- */

  // W1 — what a banner is made of, once it stops being a picture
  const FIG_BANNER_ANATOMY = SVG('0 0 760 240',
    cap(0, 14, 'ONE COMMISSIONED PICTURE') +
    box(0, 26, 300, 178, null, { ghost: true }) +
    box(14, 40, 272, 104, 'ART + TYPE, BAKED TOGETHER') +
    box(14, 156, 272, 34, 'ONE CROP. ONE LENGTH. ONE AUDIENCE.', { ghost: true }) +

    arrow(316, 114, 372, 114) +

    cap(392, 14, 'FOUR INDEPENDENT SLOTS') +
    box(392, 26, 368, 178, null, { ghost: true }) +
    box(406, 40, 168, 62, 'ART') +
    box(586, 40, 160, 62, '6 CROPS', { accent: 'teal' }) +
    box(406, 112, 168, 34, 'HEADLINE') +
    box(586, 112, 160, 34, '4 LENGTHS', { accent: 'teal' }) +
    box(406, 156, 168, 34, 'TAG + CTA') +
    box(586, 156, 160, 34, 'BY STATE', { accent: 'teal' }) +

    cap(0, 232, "ART · HEADLINE · TAG · CTA — RECOMBINED, NOT REDRAWN")
  )

  // W1 — the guardrail: what the rules refuse to let happen
  const FIG_BANNER_RULES = SVG('0 0 760 142',
    cap(0, 14, 'THE RULE ENGINE SITS BETWEEN THE TWO') +
    box(0, 30, 210, 80, ['ANY COMBINATION A', 'MERCHANDISER PICKS']) +
    arrow(222, 70, 262, 70) +
    box(274, 30, 212, 80, ['CONTRAST. CROP.', 'LENGTH. SAFE AREA.'], { accent: 'mag' }) +
    arrow(498, 70, 538, 70) +
    box(550, 30, 210, 80, ['SHIPS — OR IS REFUSED', 'WITH A REASON']) +
    cap(0, 134, "THE ENGINE ANSWERS IN THE MERCHANDISER’S LANGUAGE, NOT IN ERRORS")
  )

  // W2 — one object, three states
  const FIG_PLAYER_STATES = SVG('0 0 760 272',
    cap(0, 14, 'THREE VIEWS OF ONE OBJECT — NEVER THREE OBJECTS') +

    box(0, 30, 200, 200, null, { ghost: true }) +
    box(24, 54, 152, 92, 'ART') +
    box(24, 158, 152, 14, null, { ghost: true }) +
    box(24, 182, 152, 28, 'PLAY', { accent: 'mag' }) +
    cap(0, 252, 'FULL') +

    box(280, 30, 200, 200, null, { ghost: true }) +
    box(292, 172, 46, 44, 'ART') +
    box(346, 178, 84, 12, null, { ghost: true }) +
    box(346, 196, 44, 20, 'PLAY', { accent: 'mag' }) +
    cap(280, 252, 'MINI') +

    box(560, 30, 200, 200, null, { ghost: true }) +
    box(560, 30, 200, 118, 'ART') +
    box(584, 166, 152, 12, null, { ghost: true }) +
    box(584, 188, 152, 28, 'PLAY', { accent: 'mag' }) +
    cap(560, 252, 'LOCK') +

    arrow(206, 130, 272, 130, { dash: true }) +
    arrow(486, 130, 552, 130, { dash: true }) +
    cap(212, 118, 'ART TRAVELS') +
    cap(492, 118, 'ART TRAVELS') +

    rule(0, 268, 760)
  )

  // W2 — what got cut, and where it went
  const FIG_PLAYER_BUDGET = SVG('0 0 760 200',
    cap(0, 14, 'BEFORE — ELEVEN CONTROLS, ONE WEIGHT') +
    (function () {
      let s = ''
      for (let i = 0; i < 11; i++) s += box(i * 69, 26, 58, 44, null)
      return s
    })() +
    cap(0, 102, 'AFTER — ONE PRIMARY, THREE SECONDARY, THE REST ON A SWIPE') +
    box(0, 114, 140, 58, 'PLAY', { accent: 'mag' }) +
    box(152, 114, 96, 58, 'SKIP') +
    box(260, 114, 96, 58, 'QUEUE') +
    box(368, 114, 96, 58, 'CAST') +
    box(476, 114, 284, 58, 'SWIPE UP — THE OTHER SEVEN', { ghost: true }) +
    rule(0, 196, 760)
  )

  // W3 — the tangle, and the one answer
  const FIG_ENTITLEMENT_BEFORE = SVG('0 0 360 306',
    cap(0, 14, 'BEFORE') +
    box(0, 28, 150, 46, 'ACCOUNT') +
    box(210, 28, 150, 46, 'BILLING') +
    box(0, 116, 150, 46, 'PLAN A', { ghost: true }) +
    box(210, 116, 150, 46, 'PLAN B', { ghost: true }) +
    box(0, 204, 150, 46, 'CATALOGUE') +
    box(210, 204, 150, 46, 'PLAYBACK') +
    arrow(75, 78, 75, 112, { head: false }) +
    arrow(285, 78, 285, 112, { head: false }) +
    arrow(75, 166, 75, 200, { head: false }) +
    arrow(285, 166, 285, 200, { head: false }) +
    arrow(154, 51, 206, 51, { head: false }) +
    arrow(154, 139, 206, 139, { head: false, dash: true }) +
    arrow(154, 227, 206, 227, { head: false, dash: true }) +
    arrow(40, 78, 240, 200, { head: false, dash: true }) +
    arrow(320, 78, 120, 200, { head: false, dash: true }) +
    box(72, 268, 216, 32, 'CAN OPEN — CANNOT PLAY', { accent: 'mag' })
  )

  const FIG_ENTITLEMENT_AFTER = SVG('0 0 360 306',
    cap(0, 14, 'AFTER') +
    box(0, 28, 360, 46, 'ONE ENTITLEMENT ANSWER', { accent: 'teal' }) +
    arrow(180, 78, 180, 112) +
    box(0, 116, 360, 46, ['WHAT CAN THIS PERSON PLAY, RIGHT', 'NOW, AND AT WHAT PRICE']) +
    arrow(180, 166, 180, 200) +
    box(0, 204, 112, 46, 'CATALOGUE') +
    box(124, 204, 112, 46, 'PLAYBACK') +
    box(248, 204, 112, 46, 'UPGRADE') +
    box(72, 268, 216, 32, 'ONE TRUTH, ASKED ONCE', { accent: 'teal' })
  )

  // W3 — the spine
  const FIG_SPINE = SVG('0 0 760 168',
    cap(0, 14, 'THE ONLY JOURNEY THAT MATTERED') +
    box(0, 30, 140, 66, ['I WANT TO', 'WATCH THIS']) +
    arrow(152, 63, 186, 63) +
    box(198, 30, 140, 66, ['CAN I?', 'ASKED ONCE'], { accent: 'teal' }) +
    arrow(350, 63, 384, 63) +
    box(396, 30, 140, 66, ['UPGRADE,', 'IN PLACE'], { accent: 'mag' }) +
    arrow(548, 63, 582, 63) +
    box(594, 30, 166, 66, ['I AM', 'WATCHING IT']) +
    box(396, 112, 140, 32, 'NEVER A NEW APP', { ghost: true }) +
    arrow(466, 110, 466, 100, { head: false, dash: true }) +
    rule(0, 164, 760)
  )

  // W4 — choice as a catalogue vs choice as a question
  const FIG_DECIDE = SVG('0 0 760 266',
    cap(0, 14, 'BEFORE — THE CATALOGUE') +
    box(0, 26, 88, 150, 'PLAN', { ghost: true }) +
    box(98, 26, 88, 150, 'PLAN', { ghost: true }) +
    box(196, 26, 88, 150, 'PLAN', { ghost: true }) +
    box(294, 26, 88, 150, 'PLAN', { ghost: true }) +
    cap(0, 198, 'EQUAL WEIGHT. EVERY ROW. THE READER DOES THE WORK.') +

    cap(430, 14, 'AFTER — THE QUESTION') +
    box(430, 26, 330, 42, 'HOW MANY PEOPLE WATCH?', { accent: 'teal' }) +
    box(430, 78, 330, 42, 'DO YOU WANT IT ON THE TV?', { accent: 'teal' }) +
    arrow(595, 128, 595, 152) +
    box(430, 164, 330, 58, ['THIS ONE — AND HERE IS WHY.', 'THE OTHERS ARE ONE TAP AWAY.'], { accent: 'mag' }) +
    cap(430, 244, 'TWO ANSWERS. ONE RECOMMENDATION. NO GRID.') +

    rule(0, 262, 760)
  )

  /* ==================================================================
     THE STUDIES
     ================================================================== */

  const NDA =
    'Client work, under NDA. Nothing below is a screenshot — the figures are ' +
    'schematics I drew for this write-up, showing the structure of the work rather ' +
    'than its surface. The reasoning, the decisions and the trade-offs are the real ' +
    'ones. Happy to walk through the actual screens in a call.'

  const WORK = [
    {
      id: 'w1', n: '01',
      title: 'Lights, Camera, Banners',
      subject: 'Turning the home-screen banner from a commission into a system',
      lede: 'The most valuable slot in a streaming app was also the slowest thing in it to change. Making it fast meant handing merchandisers a system instead of a template — and then deciding what that system was allowed to refuse.',
      tags: ['Merchandising', 'Design systems', 'Personalisation'],
      kicker: 'MERCHANDISING SYSTEMS',
      year: '2025',
      meta: [
        ['Role', 'Lead Product Designer'],
        ['Timeline', '2025 · 4 months'],
        ['Team', '2 designers · 4 engineers'],
        ['Surface', 'Web · iOS'],
      ],
      blocks: [
        { t: 'section', h: 'The lever nobody could pull', p: [
          'The promotional banners on the home screen were the single biggest lever on what people watched and clicked, and the slowest thing in the app to change. Merchandising ran on a handful of hand-built templates, so every campaign looked the same to everyone and took days to ship.',
          'That combination is worth sitting with. The team had a lever with real reach on it, and pulling the lever cost enough that they pulled it carefully — which in practice meant safely, generically, and late.',
        ] },
        { t: 'diag', fig: FIG_BANNER_ANATOMY, cap: "The banner, cut along the lines a merchandiser already thinks in.", note: "Nothing new was drawn. The picture, the promise, the label, the next step — a campaign became four small choices instead of one big commission." },
        { t: 'section', h: 'Where the time actually went', p: [
          'The obvious read was that banners were slow because engineering was the bottleneck. Watching a campaign go out said something more specific: almost none of the elapsed time was code. It was the back-and-forth about whether <em>this</em> headline cleared <em>this</em> piece of art at <em>this</em> width — a legibility argument re-litigated from scratch every campaign, because nothing carried the answer forward.',
          'That reframing is what made a system the right answer rather than more templates. Templates would have shipped the next campaign faster. Only a system stops the argument recurring.',
        ] },
        { t: 'decision', q: 'So what is the unit of work?',
          opts: [
            { label: 'More templates', why: 'Fastest to build, and the failure mode the team already knew. Every new campaign shape needs a new template, so the backlog never shortens — it just moves to a different queue.', chosen: false },
            { label: 'A free canvas', why: 'Maximum expressiveness. Also maximum surface for a campaign to ship illegible at 320px, which is precisely the outcome merchandising was already steering around by staying generic.', chosen: false },
            { label: 'Four independent slots, plus a rule engine', why: 'Art, headline, tag and call-to-action become separate layers a merchandiser recombines. The legibility rules travel with the system instead of living in a reviewer’s head.', chosen: true },
          ],
          call: 'The third, because it is the only option where shipping the tenth campaign is cheaper than shipping the first.' },
        { t: 'diag', fig: FIG_BANNER_RULES, cap: "The rules that keep any combination on-brand and legible at every size.", note: "Refusing was the design decision. An engine that silently shrinks a headline until it fits produces a banner nobody is happy with and teaches nobody anything. One that names the crop which will clear the type turns the constraint into the fastest feedback in the workflow." },
        { t: 'section', h: 'Making the guardrail useful', p: [
          'I wrote the rules that keep any combination on-brand and legible at every size, and then made a decision about their manner: the system refuses out loud, with a reason. A rule engine that quietly shrinks a headline until it fits produces a banner nobody is happy with and teaches nobody anything. One that names the crop which <em>will</em> clear the type turns the constraint into the fastest piece of feedback in the workflow.',
        ] },
        { t: 'tradeoff',
          a: { h: 'What the system gives up', p: 'The bespoke, art-directed, one-off banner. A composed banner is reliably good and almost never surprising — and there are launches a year where surprising is the entire brief.' },
          b: { h: 'What it buys', p: 'A campaign becomes four small choices instead of one commission. Personalisation becomes a property of the slot rather than a project. Going live becomes a config change instead of a build.' },
          note: 'The escape hatch is the honest answer: the system carries a bespoke slot type for the two or three launches that earn one. Systems which admit their own exceptions get used; systems which pretend to cover everything get worked around, and then you have two systems.' },
        { t: 'section', h: 'Personalisation, carefully', p: [
          'I prototyped the motion and the personalisation together, so a banner could react to what someone had already watched. The restraint that mattered: personalisation varies <em>which</em> of the four slots change, not whether the campaign is recognisably the same campaign. A merchandiser has to be able to look at the slot and know what is running in it, or nobody will trust it enough to put a launch through it.',
        ] },
        { t: 'outcome', h: 'What changed',
          items: [
            'Campaigns that took days now ship in an afternoon.',
            'Going live became a config change rather than a build.',
            'Tap-through on the hero slot climbed through the first two launches.',
            'Merchandising went from filing tickets to running their own experiments — the outcome I actually cared about, because it moves the ceiling rather than the number.',
          ],
          note: 'Exact figures are under NDA.' },
      ],
    },

    {
      id: 'w2', n: '02',
      title: 'The Sound of Style',
      subject: 'Rebuilding a music player around the one gesture people actually reach for',
      lede: 'Eleven controls of equal weight, standing in front of a catalogue people loved. The work was almost entirely subtraction — and then a great deal of care about where the subtracted things went.',
      tags: ['Interaction design', 'Motion', 'Mobile'],
      kicker: 'INTERACTION DESIGN',
      year: '2024',
      meta: [
        ['Role', 'Design Systems Lead'],
        ['Timeline', '2024 · 6 months'],
        ['Team', 'Design + Platform'],
        ['Surface', 'Mobile · Web'],
      ],
      blocks: [
        { t: 'section', h: 'A wall of equal-weight controls', p: [
          'A music app with a deep catalogue and a player that got in the way of it. The now-playing screen was a wall of equal-weight controls, and the moments that mattered — starting something, handing off to the car, finding your way back to a queue — were buried under the ones that did not. People used a fraction of what was there and felt the rest as clutter.',
        ] },
        { t: 'principles', h: 'Three rules I held the redesign to',
          items: [
            ['Rank by moment, not by frequency', 'A control earns the first screen if it is reached for at a specific moment, not because the logs say it gets used. “Used sometimes, by everyone, at no particular time” is an argument for a swipe, not for a button.'],
            ['One object, folding', 'Full-screen, mini and lock-screen are three views of one thing. If the artwork ever cuts between them, the illusion breaks and the user is somewhere new rather than somewhere smaller.'],
            ['Designed for a glance', 'This is a screen people look at for under a second, at arm’s length, one-handed, usually while doing something else. Type and touch targets were tuned for that, not for reading.'],
          ] },
        { t: 'diag', fig: FIG_PLAYER_STATES, cap: "The artwork is the anchor. It never cuts — it moves, scales and re-crops.", note: "That is the whole trick: because one element survives every transition intact, the three states read as one thing folding rather than three screens replacing each other." },
        { t: 'section', h: 'The hierarchy of intent', p: [
          'I rebuilt the player around a clear hierarchy of intent: the art and the one gesture you reach for most, front and centre; everything else a swipe away rather than a tap in your face. Then I designed the transitions between full-screen, mini and lock-screen so the player felt like one object moving instead of three screens replacing each other.',
          'That transition is where most of the six months went, and it is the part that is hardest to argue for on a slide. It is also the part people feel.',
        ] },
        { t: 'diag', fig: FIG_PLAYER_BUDGET, cap: "Nothing was deleted. Everything demoted kept a route.", note: "The argument for a control is almost never “somebody uses it”. It is “somebody uses it at exactly this moment” — and that is a claim you can test, which is why it is the one I asked for." },
        { t: 'tradeoff',
          a: { h: 'The objection', p: 'Every control on that screen had somebody who wanted it there, and a swipe is discoverable to fewer people than a button. Moving seven controls behind a gesture is a real cost, paid by real users.' },
          b: { h: 'Why I took it', p: 'The cost lands on people who already know the product well enough to go looking. The benefit lands on everyone, every session, at the moment they are least able to give the screen any attention at all.' },
          note: 'The handoff to the car settled it. A control you need while driving cannot be one of eleven equal boxes, and no amount of re-ordering eleven equal boxes fixes that.' },
        { t: 'outcome', h: 'What changed',
          items: [
            'Sessions ran further without a tap.',
            'The support notes about “where did my queue go” dried up.',
            'The pattern became the template the rest of the app was rebuilt against — the player stopped being a screen and became the system’s worked example.',
          ],
          note: 'Exact figures are under NDA.' },
      ],
    },

    {
      id: 'w3', n: '03',
      title: 'Everything, All At Once',
      subject: 'One spine through subscriptions, entitlements and playback',
      lede: 'Subscription and viewing had grown up as separate products, bolted together. You could open a show you were not allowed to play. Three months, solo, almost all of it spent making a single question answerable.',
      tags: ['Product systems', 'Subscriptions', 'Consumer scale'],
      kicker: 'PRODUCT SYSTEMS',
      year: '2023',
      meta: [
        ['Role', 'Product Designer'],
        ['Timeline', '2023 · 3 months'],
        ['Team', 'Solo design'],
        ['Surface', 'iOS · Android'],
      ],
      blocks: [
        { t: 'section', h: 'One account, several subscriptions, no single truth', p: [
          'People were paying for tiers they had forgotten, watching across apps that did not talk to each other, and hitting a paywall with no idea which plan they were even on. Subscription and viewing had grown up as separate products bolted together, and the seams showed everywhere.',
        ] },
        { t: 'seams', h: 'Where trust leaked',
          items: [
            ['A show you could open but not play', 'The catalogue and the entitlement disagreed, and the viewer found out only after committing their attention to it.'],
            ['An upgrade that took you out of the app', 'The moment of highest intent in the entire product was answered with a context switch.'],
            ['A bill that never matched what you thought you had', 'Nothing in the product told you what you were currently paying for, in the words the bill used.'],
          ] },
        { t: 'split', h: 'Mapping the tangle', a: FIG_ENTITLEMENT_BEFORE, b: FIG_ENTITLEMENT_AFTER,
          cap: 'The map that made the argument.',
          note: 'Every plan, entitlement and dead end on the left; on the right, the one answer all four surfaces needed to agree on. Drawing it was the moment the project stopped being a redesign and became a re-plumbing.' },
        { t: 'section', h: 'The change that mattered', p: [
          'I mapped the whole tangle — every plan, entitlement and dead end — and the map made an argument I had not expected to make. The problem was not that the flows were badly designed. It was that four surfaces were each computing their own answer to the same question, and they disagreed.',
          'So the design work became: make that question answerable in one place, then let every surface ask it. <em>What can this person play, right now, and at what price.</em>',
        ] },
        { t: 'diag', fig: FIG_SPINE, cap: "From “I want to watch this” to “I am watching it”, without ever leaving the story.", note: "Every screen that could not justify a place on this line got moved off it. Settings did not get better; it got smaller." },
        { t: 'section', h: 'The spine', p: [
          'From there the interface got simpler on its own. Upgrades happen inline, in context, with the price and the plan stated plainly. The home screen finally knows what you can actually play, so it stops offering you things it will then refuse you. Settings did not get better — it got smaller, because most of what lived there was the product apologising for not knowing something.',
        ] },
        { t: 'tradeoff',
          a: { h: 'The hard call', p: 'A single entitlement answer means one place can now be wrong for everybody at once. Four disagreeing surfaces at least fail independently, and the organisation had built a lot of habits around that.' },
          b: { h: 'Why it was still right', p: 'Independent failure is not resilience when the user is the integration point. They experience all four surfaces as one product, so four partial truths do not read as four small bugs — they read as one product that lies.' },
          note: 'I pressure-tested it against the messiest real accounts rather than the tidy demo one: the lapsed upgrade, the family plan inherited from a promo, the region change. Designing against the demo account is how a tangle like this gets built in the first place.' },
        { t: 'outcome', h: 'What changed',
          items: [
            'The paywall stopped being a wall — upgrades moved into the moment of wanting something, rather than a settings screen nobody visited.',
            'Fewer people bounced at the point of purchase.',
            '“What am I even paying for” stopped being the top support question.',
          ],
          note: 'Exact figures are under NDA.' },
      ],
    },

    {
      id: 'w4', n: '04',
      title: 'How to Decide?',
      subject: 'Reframing a plan-selection funnel around the decision, not the catalogue',
      lede: 'The offer was good and people still stalled. The comparison page asked you to hold a spreadsheet in your head at the exact moment you were trying to say yes.',
      tags: ['Growth', 'Conversion', 'Content design'],
      kicker: 'GROWTH & CONVERSION',
      year: '2022',
      meta: [
        ['Role', 'Designer'],
        ['Timeline', '2022 · 2 months'],
        ['Team', 'With the founders'],
        ['Surface', 'Web'],
      ],
      blocks: [
        { t: 'section', h: 'Choice was being treated as a feature', p: [
          'A service people wanted but stalled on buying. Too many plans, too many caveats, and every option, edge case and add-on laid out at equal weight — so the person most ready to buy was the one made to work hardest. A lot of them left to “think about it”, which usually means never.',
        ] },
        { t: 'section', h: 'The two questions', p: [
          'Reading the plans against each other, most of the differences did not change anyone’s answer. Two or three did. Everything else was detail that mattered after the decision, not during it.',
          'So the flow got reframed around the decision rather than the catalogue: ask the small number of things that actually move the recommendation, then recommend one plan and say why, with the others one tap away for the people who want them.',
        ] },
        { t: 'diag', fig: FIG_DECIDE, cap: "A grid is the right tool for auditing a decision and the wrong one for making it.", note: "So the comparison table was not deleted, it was demoted — one tap away, for the people who are auditing rather than deciding." },
        { t: 'decision', q: 'How honest should a recommendation be?',
          opts: [
            { label: 'Always recommend the middle plan', why: 'Reliable revenue, trivial to build, and exactly the pattern people have learned to distrust. It also stops being true the moment the plans change, and nobody updates it.', chosen: false },
            { label: 'Recommend from the answers, and show the reasoning', why: 'Slower to build, and it occasionally recommends the cheapest plan. It also means the recommendation survives being questioned, which is the only version worth putting on the page.', chosen: true },
            { label: 'No recommendation, better comparison', why: 'Safest. It is also the status quo with nicer typography, and the status quo was the problem.', chosen: false },
          ],
          call: 'The second — including the part where it sometimes talks somebody into paying less. A recommendation that cannot do that is an advert wearing a recommendation’s clothes, and people can tell.' },
        { t: 'section', h: 'The comparison, demoted', p: [
          'I designed the comparison so it read as a set of trade-offs rather than a grid, and wrote the microcopy to remove doubt at each step instead of adding disclaimers. Most caveats in a pricing flow exist to protect the company from a conversation; the useful ones answer a question the reader is already asking. I kept the second kind and moved the first to where it belongs.',
        ] },
        { t: 'outcome', h: 'What changed',
          items: [
            'More people reached a plan, and fewer abandoned at the compare step.',
            '“Which one is right for me” stopped being a support thread.',
            'Recommend-one-then-explain carried over to the rest of the funnel.',
          ],
          note: 'Exact figures are under NDA.' },
      ],
    },
  ]

  /* ==================================================================
     RENDER
     ================================================================== */

  const P = (arr) => arr.map((t) => '<p>' + t + '</p>').join('')

  const BLOCK = {
    section: (b) =>
      '<section class="cs__sec"><h3 class="cs__h">' + b.h + '</h3>' +
      '<div class="prose">' + P(b.p) + '</div></section>',

    diag: (b) =>
      '<figure class="cs__fig"><div class="cs__fig__scroll">' + b.fig + '</div>' +
      '<figcaption><b>' + b.cap + '</b>' + (b.note ? ' ' + b.note : '') + '</figcaption></figure>',

    split: (b) =>
      '<h3 class="cs__h cs__h--fig">' + b.h + '</h3>' +
      '<figure class="cs__fig cs__fig--split"><div class="cs__fig__scroll">' +
      '<div class="cs__split">' + b.a + b.b + '</div></div>' +
      '<figcaption><b>' + b.cap + '</b>' + (b.note ? ' ' + b.note : '') + '</figcaption></figure>',

    decision: (b) =>
      '<section class="cs__sec cs__dec">' +
      '<h3 class="cs__h cs__h--q">' + b.q + '</h3>' +
      '<ol class="dec">' + b.opts.map((o) =>
        '<li class="dec__o' + (o.chosen ? ' is-taken' : '') + '">' +
        '<span class="dec__mark" aria-hidden="true"></span>' +
        '<div class="dec__body"><h4 class="dec__l">' + o.label +
        (o.chosen ? ' <span class="dec__badge">TAKEN</span>' : '') + '</h4>' +
        '<p>' + o.why + '</p></div></li>').join('') +
      '</ol>' +
      '<p class="dec__call"><span class="dec__call__k">THE CALL</span>' + b.call + '</p>' +
      '</section>',

    tradeoff: (b) =>
      '<section class="cs__sec cs__to">' +
      '<div class="to"><div class="to__side"><h4>' + b.a.h + '</h4><p>' + b.a.p + '</p></div>' +
      '<div class="to__vs" aria-hidden="true"></div>' +
      '<div class="to__side to__side--b"><h4>' + b.b.h + '</h4><p>' + b.b.p + '</p></div></div>' +
      (b.note ? '<p class="to__note">' + b.note + '</p>' : '') +
      '</section>',

    principles: (b) =>
      '<section class="cs__sec"><h3 class="cs__h">' + b.h + '</h3>' +
      '<ol class="prin">' + b.items.map((it, i) =>
        '<li><span class="prin__n" aria-hidden="true">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<div><h4>' + it[0] + '</h4><p>' + it[1] + '</p></div></li>').join('') +
      '</ol></section>',

    seams: (b) =>
      '<section class="cs__sec"><h3 class="cs__h">' + b.h + '</h3>' +
      '<ul class="seams">' + b.items.map((it) =>
        '<li><h4>' + it[0] + '</h4><p>' + it[1] + '</p></li>').join('') +
      '</ul></section>',

    outcome: (b) =>
      '<section class="cs__sec cs__out"><h3 class="cs__h">' + b.h + '</h3>' +
      '<ul class="out">' + b.items.map((t) => '<li>' + t + '</li>').join('') + '</ul>' +
      (b.note ? '<p class="out__note">' + b.note + '</p>' : '') +
      '</section>',
  }

  function studyPage(w, next) {
    const metaHTML = w.meta.map((m) =>
      '<div><dt>' + m[0] + '</dt><dd>' + m[1] + '</dd></div>').join('')

    const html =
      '<article class="col col--doc cs">' +
      '<nav class="l2nav"><a class="cta cta--ghost" href="#home">' +
        '<span aria-hidden="true">&#8592;</span> Home</a></nav>' +

      '<header class="cs__head">' +
      '<p class="cs__eyebrow"><span class="cs__n">' + w.n + '</span>' +
        '<span>' + w.kicker + '</span>' +
        '<span class="cs__sep" aria-hidden="true"></span>' +
        '<span>' + w.year + '</span></p>' +
      '<h1 class="cs__title">' + w.title + '</h1>' +
      '<p class="cs__subject">' + w.subject + '</p>' +
      '<p class="cs__lede">' + w.lede + '</p>' +
      '<dl class="cs__meta">' + metaHTML + '</dl>' +
      '<p class="cs__note"><span class="cs__note__ico" aria-hidden="true"></span>' + NDA + '</p>' +
      '</header>' +

      w.blocks.map((b) => (BLOCK[b.t] ? BLOCK[b.t](b) : '')).join('') +

      '<footer class="cs__foot">' +
      '<p class="cs__cta"><a class="cta cta--primary" href="mailto:vaibhavvishalece@gmail.com?subject=' +
        encodeURIComponent(w.title + ' — walkthrough') + '">Ask me to walk through this one ' +
        '<span aria-hidden="true">&rarr;</span></a></p>' +
      (next
        ? '<a class="cs__next" href="#' + next.id + '">' +
          '<span class="cs__next__k">NEXT PROJECT ' + next.n + '</span>' +
          '<span class="cs__next__t">' + next.title + '</span>' +
          '<span class="cs__next__s">' + next.subject + '</span></a>'
        : '<a class="cs__next" href="#home">' +
          '<span class="cs__next__k">BACK TO</span>' +
          '<span class="cs__next__t">Home</span>' +
          '<span class="cs__next__s">The rest of the work, and how to reach me</span></a>') +
      '</footer>' +
      '</article>'

    const s = document.createElement('section')
    s.className = 'page'
    s.dataset.page = w.id
    s.dataset.kind = 'case'
    s.hidden = true
    s.innerHTML = html
    return s
  }

  /* ---- the four cards on the home page ----
     A 2x2 rack of covers. The index that was here carried the subject and
     three domain tags per row, which is the whole case study restated on
     the way to it — read the four and you have read the section twice.

     A card is a number, a plate and a title. The plate is a placeholder:
     a fine dither with the project number sitting in it, so an empty slot
     reads as a slot rather than a hole. Give an entry a `cover` and the
     image takes the plate verbatim — that is the only change needed once
     the real cover art exists.

     What the card drops, the link keeps: the subject rides on aria-label,
     so it is still announced and still indexed. */
  function cardsHTML() {
    return WORK.map((w) =>
      '<li class="wk"><a class="wk__a" href="#' + w.id + '" ' +
      'aria-label="' + esc(w.title + ' — ' + w.subject) + '">' +
      '<span class="wk__plate">' +
      (w.cover
        ? '<img class="wk__img" src="' + w.cover + '" alt="" loading="lazy">'
        : '<span class="wk__no" aria-hidden="true">' + w.n + '</span>') +
      '</span>' +
      '<span class="wk__foot">' +
      '<span class="wk__n" aria-hidden="true">' + w.n + '</span>' +
      '<span class="wk__title">' + w.title + '</span>' +
      '</span></a></li>').join('')
  }

  // ---- wire it up ----
  const main = document.querySelector('main.app')
  if (main) {
    const frag = document.createDocumentFragment()
    WORK.forEach((w, i) => frag.appendChild(studyPage(w, WORK[i + 1])))
    main.appendChild(frag)
  }

  const host = document.getElementById('workList')
  if (host) host.innerHTML = cardsHTML()

  window.__work = WORK
})()
