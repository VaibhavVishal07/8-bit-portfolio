# basic-portfolio

An 8-bit game title screen, as a personal portfolio landing page. One screen,
no build step, no dependencies.

Open `index.html` in a browser, or serve the folder:

```bash
npx serve -l 4173 .
```

```
index.html    Markup + the heart sprite definition
styles.css    HUD panel, title-screen type, day/night overrides
scene.js      The background — a 960x540 pixel canvas, drawn in code
script.js     Day/night + rain toggles, arcade keyboard menu
```

## The concept

A HUD panel floating over a city rooftop, looking out across the skyline. A cat
sits on the parapet watching it. Night is neon cyberpunk; day is the same city
in flat daylight.

## The background

`scene.js` draws to a **960x540 canvas** which is then upscaled
nearest-neighbour to fill the viewport. That is how pixel art actually works: a
fixed low-resolution grid, blown up whole-number style, never drawn at display
resolution. Nothing in the scene is an image file — it is all generated.

Techniques, all period-correct:

- **4x4 ordered (Bayer) dithering** on every gradient and glow — the sky ramp,
  the moon's halo, the neon bleed off each sign, the wet sheen on the roof.
- **Three depths of skyline**, each generated building by building with its own
  height, lit edge, roof furniture, antenna and window grid.
- **Neon signage** — vertical strips, horizontal bands and billboards, each with
  a dithered halo bleeding onto the wall, which is what sells it as light rather
  than as paint.
- **Window flicker** done by repainting individual lit cells back to the
  building colour, the way a tile engine would, rather than regenerating the
  layer. Antenna beacons invert — they blink *on*.
- **Parallax** across the three skylines, furthest slowest, with an elevated
  railway in front of them drifting faster still.
- **A fixed 12fps tick**, so every motion is inherently stepped — no smooth
  interpolation anywhere.

Also in there: drifting cloud slabs, twinkling stars, craft crossing the skyline
with out-of-phase nav lights, a lit sign box, ducting, crates, a satellite dish,
and a brazier whose flame is generated per frame rather than being a fixed
sprite — each row tapers toward the tip, is displaced by two out-of-phase sines,
and is filled in four bands from a dark red rim to a near-white core.

**The rooftop layer does not scroll.** The cat and the brazier stand on it, so
if it moved they would appear to slide across the ground.

**The parapet is drawn with a hard, near-black rim along the top of its
coping.** That single line is what makes it read as foreground; without it the
railing shares values with the lit city behind and the two collapse into one
flat plane. The rest of its depth comes from the same idea applied smaller — a
lit top face, a shadowed front face, a dark undercut, and balusters lit on one
side and shadowed on the other.

**The train is an event, not a loop.** It crosses the viaduct, then the line is
empty for about half a minute. It is drawn in screen space rather than into the
viaduct buffer, so it runs along the deck at its own speed instead of being
carried by the parallax.

**The canvas is cleared every frame.** The layers do not cover every pixel, and
without a clear those rows keep the previous frame — which on a theme switch
means the old palette bleeding through.

## Weather

Two toggles top-right. They are **mutually exclusive** — it is one sky — so
pressing either releases the other, and both buttons repaint.

Weather draws on **its own canvas above the panel**, not on the scene canvas.
That is what lets rain and snow pass in *front* of the window and land on it.
The panel's position is mapped from its `getBoundingClientRect()` back into
canvas pixels by undoing the `object-fit: cover` scale-and-centre, so the
surface tracks the panel at any viewport size.

**Rain.** Splashes land along the **parapet** — the roof's leading edge — and on
the **panel's top lip**, rather than scattered across the deck. A third of the
drops are marked to fall *past* the parapet without splashing, which keeps the
curtain full height instead of stopping dead at the edge. On impact a drop hands
off to a splash, which plays three drawn frames and dies — sprite animation, not
a fade.

Night rain is pale against a dark sky; day rain is the reverse, darker streaks
against a bright one.

**Snow.** Slower than rain and drifting sideways on a sine. Instead of splashing
it *settles*: each flake that lands adds a pixel to a per-column depth array —
one for the parapet, one for the panel — capped and drawn back as a ragged line
of lying snow. Turning snow off clears both.

Both settings persist in `localStorage`.

## Day / night

The toggle switches between two full palettes. Switching rebuilds the static
layers and nothing else; the choice persists in `localStorage`.

|  | Night | Day |
| --- | --- | --- |
| Sky | Violet-black up to a purple haze | Bright blue |
| Orb | Moon with craters | Sun |
| City | Hot neon signage over a dark base | Flat daylight, dark glass |
| Extras | Brazier, stars, craft | Birds, craft |
| Panel | Neon on deep violet | Dark on pale blue |

The night base is deliberately kept very dark — violet-black rather than a rich
purple — because the neon needs somewhere dark to burn against. Lift the base
and the signage stops reading as light.

The window follows the scene — a bright city framing a black screen looks
broken. In day mode the screen goes light, the type goes dark, the scanlines
invert to lighten rather than darken, and the wordmark's pale top rim becomes a
dark one so it still reads as an outline.

## The window

A terminal HUD panel, not desktop chrome — beveled grey fought the neon city
behind it. A thin cyan frame, a magenta offset shadow standing in for depth,
magenta corner brackets, and neon indicator blocks in the title bar. Still hard
edges only: no radius, no blur.

## The wordmark

Neon cyan on Press Start 2P, built entirely from a `text-shadow` stack — no
image, no second font:

- a **chromatic fringe** either side, magenta right and violet left — the
  misregistered colour channels that read as a bad signal, and the whole reason
  it looks cyberpunk rather than merely bright
- six stepped shadows receding down-and-left in violet, darkening as they go

The logotype **holds still** — only its colour snaps, between cyan and white. An
idle hop and a glitch jolt both read as the title shaking, which a title should
not do.

**Day drops the cyberpunk treatment entirely**: no chromatic fringe, no colour
snap, no motion. Just a solid dark face over a cool grey-blue extrusion — the
same block construction, read straight.

Every offset is in `em`, so the construction scales with `font-size`.

## The UI rules

Same two rules as the scene, applied to the DOM:

1. **Pixel grid only** — no `border-radius`, no blur, every shadow a hard offset
   block.
2. **Every animation is stepped** — `transition: none !important` is set
   globally, and every `@keyframes` runs on `steps()`.

| Animation | Timing | What it does |
| --- | --- | --- |
| `blink` | `steps(1)` | Heart cursor and "PRESS ANY KEY" |
| `title-flash` | `steps(1)` | Wordmark snaps between cyan and white (night only) |
| `scanroll` | `steps(8)` | Scanlines roll one line at a time |

## Fonts

Both free, from Google Fonts: **Press Start 2P** for the wordmark, menu and
labels; **Pixelify Sans** for body text.

## Editing

Scene palettes are the `THEMES` object at the top of `scene.js` — change a hex
there and both the static layers and the animation follow. UI colours are
custom properties at the top of `styles.css`. Copy is plain text in
`index.html`: `YOUR NAME`, `YOUR ROLE`, and the three menu rows.

The menu is keyboard-driven: arrow keys move the cursor, `1`–`3` jump straight
to a row, Enter follows it.

Both the scene and the UI honour `prefers-reduced-motion` — the canvas holds its
first frame and the CSS animations hold theirs.
