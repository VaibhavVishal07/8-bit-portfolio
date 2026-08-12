# Portfolio — Vaibhav Vishal

A product-design portfolio with a hand-drawn 8-bit city behind it. No build
step, no framework, no dependencies, no image files.

Open `index.html` in a browser, or serve the folder:

```bash
npx serve -l 4173 .
```

```
index.html   The home page and the about page
styles.css   Everything. Tokens at the top, the current page at the bottom
scene.js     The background — a 960x540 pixel canvas, drawn in code
work.js      The four case studies: content, diagrams, and the renderer
script.js    Boot, city controls, the router, the transition between pages
posters.js   Generated cover art for the shelf preview
flowers.js   The flower drift along the foot of the page
```

## Two grounds

The page is one scroll with a seam in it.

**Above the seam** is the city, at full strength, carrying the name and one
sentence about what I do. Nothing sits in a panel and nothing has a border: the
type is held by a dithered clearing burned into the middle of the picture, so
the skyline is never cropped by a box.

**Below the seam** a solid, still surface rises over the city and carries
everything that has to be *read* — the work, the point of view, the about, the
way to get in touch. The join between them is three rows of 8px cells at a
quarter, a half and three-quarter density: an ordered dither, which is the same
idea every gradient in the scene is built from.

The reason for the split is the whole argument of the site. The city is the
memorable part and the work is the hireable part, and each one makes the other
worse if they share a surface. So the shell is playful and the work is not, and
the scroll is where you cross from one to the other.

Crossing into a case study takes it further: the scene stops behind a scrim, the
pixel face steps off everything except the eyebrow, and the page becomes a
document set in one reading face. A retro costume on top of a systems diagram
makes the diagram look like a joke.

## The case studies

All four live in `work.js` as data, rendered by a small block vocabulary.

The point of doing it that way is not that it saves code — it is that each study
gets to be a **different shape**. A portfolio where every project runs Overview /
Problem / Solution / Outcome tells the reader that the designer has one move. So
each one picks the blocks its story actually needs:

| | |
| --- | --- |
| `section` | a heading and prose |
| `decision` | the options that were on the table, which one was taken, and why |
| `tradeoff` | two columns: what it gave up, what it bought |
| `principles` | numbered rules the work was held to |
| `seams` | a list of specific failures, each named |
| `diag` | a full-bleed schematic |
| `split` | two schematics side by side, usually before and after |
| `outcome` | what changed |

Adding a fifth project is one entry in the `WORK` array. The card on the home
page and the case study behind it are generated from the same object, so they
cannot drift apart.

### The figures

The work is under NDA, so there are no screenshots — and rather than fill the
gap with stock photography or an apology, every figure is an **inline SVG
schematic** drawn to one grid: hairline strokes, square corners, mono labels,
two accents.

That turns out to be the better answer regardless. You cannot show the pixels,
but you can show the *structure*, and the structure is the part a design
director is reading for. The prose that explains each figure lives in its
`<figcaption>` rather than inside the SVG, so it is selectable, readable by a
screen reader, and does not shrink to five pixels on a phone — the diagram
itself scrolls inside its own box instead.

## The concept

A HUD panel floating over a city rooftop, looking out across the skyline. A cat
sits on the parapet watching it.

Night is neon cyberpunk. **Day is the same city at noon under smog** — not the
cyberpunk switched off. The sky ramps from a hard teal at the zenith through
mauve into a band of amber pollution sitting on the skyline, and the signage
still burns through it. Both modes run the same wordmark, the same magenta and
teal accents, the same everything. Only the values flip.

## Sixty-four levels, not sixteen

The dither kernel is **8x8 Bayer**. It used to be 4x4, which gives sixteen steps
between any two colours — that is an 8-bit number of steps and it looked like
one: every gradient had visible bands in it and every glow had a hard shoulder
where it ran out of levels.

8x8 gives **sixty-four**. Four times the tonal resolution through the exact same
two-colour palette — no new colours anywhere, the hardware just got better at
pretending. Skies ramp, glows fall off smoothly, the aerial haze stops stepping,
and the separation band behind the parapet becomes a gradient instead of a shelf.
It is the single biggest difference between how a 1988 machine and a 1995 one
render the same picture, and it costs one array.

The cached wash patterns go from sixteen tiles per colour to sixty-four, which is
still nothing: a full 64-level ramp of 8x8 tiles is about 4KB.

*(What it is not: a resolution increase. The canvas is still 960x540 and every
coordinate in the scene is authored against it. Doubling that is a real job —
worth doing, but a separate one.)*

## The background

`scene.js` draws to a **960x540 canvas** which is then upscaled
nearest-neighbour to fill the viewport. That is how pixel art actually works: a
fixed low-resolution grid, blown up whole-number style, never drawn at display
resolution. Nothing in the scene is an image file — it is all generated.

Techniques, all period-correct:

- **8x8 ordered (Bayer) dithering** on every gradient and glow — the sky ramp,
  the moon's halo, the neon bleed off each sign, the wet sheen on the roof.
- **Three depths of skyline**, each generated building by building with a lit
  left edge and a shadowed right one, a **stepped crown** so the roof line is not
  a row of flat-topped boxes, vertical mullions and floor ledges for structure, a
  dead mechanical floor where no windows are let, masts with guy wires, and a
  window grid with whole unlet stacks in it.
- **Aerial perspective** — every depth is washed toward the horizon colour,
  further back meaning stronger, so distance is carried by falling contrast
  rather than by size alone. The wash is composited `source-atop` so it stays off
  the transparent sky.
- **A nine-band sky** with smog strata lying across it, high cirrus wisps
  tapering to nothing at both ends, and a galactic band of star dust running
  across at an angle — the one thing that stops a starfield reading as a flat
  scatter, because real stars lie along something.
- **A 22-degree halo**, wide and faint — but only around the **sun**. A narrow
  strong ring reads as something somebody drew; a soft one reads as the air.
  The moon is drawn bare, disc and maria and nothing coming off it: at night the
  glow was the brightest thing in the top third of the frame and it pulled the
  eye off the city, which is what you are meant to be looking at. A hard-edged
  disc on a dithered sky is more of a piece with everything else here anyway.
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
with out-of-phase nav lights and an engine wash behind them, a stairwell hutch
with a neon over its door and a tag on its flank, a water tank on legs with a
ladder, air handlers with fan grills and louvers, ducting on brackets, crates,
a satellite dish with a feed arm, **string lights** sagging in catenaries between
four poles with a bulb every few pixels guttering on its own cycle, and a steam vent
whose plume widens as it rises, thirty puffs of it, each one drawn a little
wider and a little fainter than the last.

**Detail is drawn as form, not as speckle.** Every gravel stone is a lit pixel
with a dark one directly under it — a chip with its own shadow — and there are
far fewer of them than a scatter would use, because at this scale the eye reads
density, not count. The tar seams are straight runs with one deliberate step in
each rather than random walks: a seam is laid by a person, so a wobbling line
reads as a mistake.

**The rooftop layer does not scroll.** The cat stands on it, so if it moved it
would appear to slide across the ground.

**The parapet is drawn with a hard, near-black rim along the top of its
coping.** That single line is what makes it read as foreground; without it the
railing shares values with the lit city behind and the two collapse into one
flat plane. The rest of its depth comes from the same idea applied smaller — a
lit top face, a shadowed front face, a dark undercut, and balusters lit on one
side and shadowed on the other.

## Where the colour comes from

The scene used to be a violet monochrome with neon accents. Read as a palette
that is correct — one hue, one contrast, the signage carrying all the saturation
— and read as a picture it was flat, because three of the four things filling
the frame were the same colour. Four changes, no new machinery:

**The sky ramp rotates as it descends.** Nine stops that used to walk straight up
the violet axis now start blue-black at the zenith, where there is no city light
left to reach, pass through indigo, and land on magenta-violet at the skyline
where there is nothing else. That rotation is what light pollution actually
looks like, and it costs the same nine entries it always did.

**High pools.** The top third of the frame had the ramp in it and nothing else —
the smog strata sit lower, the city glow pools at the skyline, and there is no
signage within two hundred pixels. It now carries the same dithered pools the
city glow uses, moved up and cooled off: cold teal, deep indigo, one thin rose,
all very sparse. Note what they are not — the galactic band that used to run
across here was cut because a broad soft diagonal is a shape this scene has no
vocabulary for. A dithered pool is a shape it already speaks.

**Every building is made of something.** A layer used to be three colours, so it
read as one shape with a texture on it rather than as three hundred buildings
standing near each other. Each tower now takes one of six small shifts along a
warm/cool axis — brick, glass, pale concrete, in shadow, sodium-stained — applied
to its body values. How far the shift travels scales with how bright the layer
is, because the same delta that separates two mid-grey towers turns two
near-black ones into different colours entirely.

**A city at night is not one colour of lit window.** It is mostly the building's
own cold glass, with sodium, fluorescent, a screen and the odd late kitchen
scattered through it, and that scatter is where nearly all the apparent detail
in a skyline comes from. Each depth now has an eight-entry glass palette
weighted so the cold base still wins most draws and the saturated ones stay rare
enough that the neon is still the loudest thing at that distance. Nearer layers
get more of them, because that is where you could actually see in.

Two smaller ones: clouds are lit from **below**, in magenta, because there is no
moon doing that work — the city is. And stars run four temperatures instead of
three, the new blue-white tier cut out of a brightness value every star already
carried, so it costs no extra random draw.

Both themes keep the same number of random draws per building whether or not the
result is used, which is the rule the signage geometry already followed: the
city must never rearrange itself when you toggle day and night.

## Weather

Two toggles top-right. They are **mutually exclusive** — it is one sky — so
pressing either releases the other, and both buttons repaint.

**Weather is not an overlay.** Rain and snow are read by the *static* builders,
so a wet roof is a different roof — different deck, different coping, different
gravel — and a snowed roof is different again. The layers are rebuilt on a
weather change exactly as they are on a theme change, in about 40ms.

Falling drops and flakes draw on **their own canvas above the panel**, which is
what lets them pass in *front* of the window. Anything that has **landed** draws
on the scene canvas instead, so a splash or a bank settles *behind* the panel
rather than on top of it. The panel's position is mapped from its
`getBoundingClientRect()` back into canvas pixels by undoing the
`object-fit: cover` scale-and-centre, so both track it at any viewport size.

### Transitions

Weather used to arrive all at once: press the button and two hundred drops
appear in mid-air with an already-wet roof under them. It read as a jump-cut,
because it was one.

There are now two states. **`weather`** is what has been *built* — which roof,
which sky, which skyline. **`target`** is what has been asked for. Between them
sits **`wx`**, an intensity from 0 to 1 that the particle count is scaled by, and
the order of operations is what makes it feel like weather:

| | |
| --- | --- |
| **Turning on** | the world swaps, then the fall builds from nothing over five and a half seconds |
| **Turning off** | the fall thins out *first*, over four seconds — and only once the last drop has gone does the roof dry |

Switching straight from rain to snow runs both halves in order, so the rain stops
before the snow starts, which is what it does.

Everything downstream is scaled by the same number: the drops, the flakes, the
beads on the glass, and the depth of the bank on the parapet and the window lip,
so snow settles in as it falls and melts back as it stops. Only live particles
land — otherwise the roof goes on being hit by rain that is no longer falling.
The button getters report the **target** rather than what is on screen, so the
controls answer the moment they are pressed even though the sky takes a few
seconds to agree.

**The dissolve.** A rebuild still swaps the static layers in one frame however
gently the particles ramp, so the old frame is snapshotted first and then
dithered away over the next second — which is exactly how eight-bit hardware did
a transition, and the only kind of fade this scene is allowed to use. There is no
opacity anywhere in it: at each step a few more of the old pixels simply stop
being drawn, punched out with the same Bayer kernel as everything else.

It is deliberately kept to fourteen frames. The snapshot is a still, so anything
moving underneath it ghosts, and a long dissolve turns that ghost into a
stutter — which is the exact thing it is there to remove.

Under `prefers-reduced-motion` there is no ramp and no dissolve; the new world
just appears.

### Toggling does not restart the scene

Everything is generated from fixed seeds, so the same city has to come back when
the weather clears. Three things had to be fixed for that to hold:

- Snow on a building ledge draws from **its own generator**. Sharing the building
  stream meant the snow consuming random numbers the dry city never consumed, so
  every building after the first ledge came out somewhere else — toggling snow
  rebuilt a *different skyline*.
- The **same 46 clouds** always exist in the same places; a clear sky simply does
  not draw the last twenty. Every random draw is made before that decision.
- The **same gravel** is laid in both states, wet just draws fewer of the stones.

The frame counter is never reset either, so the parallax carries on from
exactly where it was. Toggling rain or snow on and off now returns the
scene pixel-for-pixel.

### Rain

The **whole deck and the whole railing** go wet, not a patch of them. Sparse
reflection streaks bleed down from the tar seams — water runs from somewhere —
and puddles sit on top as harder mirrors with two banded reflections and a dark
lip along the far edge, because a bright rim all the way round makes a pool
float instead of seating it in the deck.

On the coping: **one** specular line and nothing else. A scatter of bright pixels
along a highlight does not read as water, it reads as damage. The line breaks
only where the coping joints already are, and the drips hang from those same
joints, because that is where water collects.

Landings are spread three ways — most along the parapet, where a line of spray
reads best, the rest out across the deck, and a share marked to fall past
everything so the curtain stays full height. On impact a drop hands off to a
splash, which plays three drawn frames and dies — sprite animation, not a fade.

Night rain is pale against a dark sky; day rain is the reverse, darker streaks
against a bright one.

### Water on the glass

The panel is the one surface in the scene facing the viewer, so rain hitting it
does not splash and vanish — it sticks. Beads sit on the pane, and every so often
one gets heavy enough to run, sweeping up the beads it passes and leaving a track
behind it. That track is the whole effect: a streak nobody has wiped.

Two rules govern it.

**Where.** Only the outer sixth of the pane, each side. Water tracking across a
line of type makes the type harder to read and starts looking like dirt on the
screen rather than weather on a window, so the middle is left alone entirely —
runners are clamped back into their own side if they wander.

**How.** A drop on glass does not slide, it *creeps*. Surface tension pins it; it
builds until it tears loose, runs a little way, picks up whatever it touches,
gets heavier and faster for it, and pins again. So a runner carries a **mass**,
accelerates from nothing, **stalls** at intervals, and only reaches its top speed
once it has swept up a few beads on the way down — about ten seconds to cross,
where the first attempt took two. Drops moving at a constant speed were the whole
reason that first attempt read as rain drawn on top of a window instead of water
sitting on one.

The track dries from the top down, faintest where it is oldest and wettest just
behind the head. A track at one strength the whole way up is a ruled line, not a
trail.

It is all held in normalised panel space, 0 to 1 across and down, so the water
stays on the window when the viewport changes shape instead of sliding off it.

**Lightning** strikes on a timer — every eight to twenty-eight seconds. It plays a short envelope of discrete steps rather than a
fade: a hard flash, a gap of almost nothing, then a weaker second one. That is
what a strike does, and what a fade never reads as. Each step is one whole frame
at 12fps, so it comes out stepped for free.

At the peak **the sky is washed to the lightning colour itself** — for that
frame the storm is the only light source and everything else should lose to it.
The bolt's halo is drawn in that same colour, so on the peak frame the halo
disappears into the flashed sky and what is left is a clean white channel; on
the weaker frames the halo comes back.

The flash stays **in the sky**. An earlier pass also washed the city and the
roof, which is what lightning physically does, and it made the whole screen jump
— too distracting to read a menu against. Keeping it above the skyline means the
buildings stay a silhouette against the strike rather than being bleached with
it, which reads better anyway.

### Snow

The whole scene turns over. The sky flattens toward a pale grey-violet that kills
the contrast the stars need; the clouds thicken and lose the sun off their
crowns; every building ledge, every duct, every pole and the viaduct deck take a
cap; and the roof carries a **blanket** with six wide, shallow drifts on it, each
drawn as a form — a lit crown and a shadow under its foot — rather than as a
cloud of dither.

Accumulation is deepest **on the railing**, which is where a chest-height ledge
should catch it, and on the **window lip**, where the bank laps *over* the edge
and hangs down onto the panel's dark face with icicles off the deeper parts.

A flake settles into the *lowest* of the three columns under it, which gives the
bank an angle of repose so it grows into drifts rather than into a comb, and it
is worth **four** pixels rather than one — at 12fps a one-for-one bank takes
several minutes to read as covered, which is several minutes of the scene looking
like it has only just started. What is drawn is smoothed against its neighbours,
because a spike one pixel wide is not snow.

### What the weather does to everyone

Rain and snow used to change only the *surfaces* — a wet deck, a white one —
while the roof carried on behaving identically underneath. A rooftop where the
washing is still out in a downpour, and the pigeon is picking about in a
blizzard, is a rooftop nobody actually lives on.

So the life on it reads the weather too. Almost none of this costs anything; it
is mostly deciding not to draw something.

| | Clear | Rain | Snow |
| --- | --- | --- | --- |
| Washing | out, swaying | **taken in** | out, **frozen stiff** — no sway |
| Pigeon | visits and pecks | **stays away** | visits, **hunched into a ball** with a cap of snow |
| Drone | crosses | crosses | **grounded** |
| Paper plane | glides in | — | — |
| Moths | round the lights | — | — |
| Rat | runs the parapet | runs the parapet | — |
| Steam vent | thirty puffs | **sixteen** | **fifty-two** |

## Day / night

The toggle switches between two full palettes. Switching rebuilds the static
layers and nothing else; the choice persists in `localStorage`.

|  | Night | Day |
| --- | --- | --- |
| Sky | Violet-black up to a purple haze | Teal zenith down into an amber smog band |
| Orb | Moon, bare — maria and lit western rims, no glow | Sun, with corona and halo |
| City | Hot neon over a dark base | Cool desaturated towers, neon still burning |
| Extras | Stars, satellites, craft | Birds, craft, steam |
| Panel | Neon on deep violet | Magenta and teal on pale lilac |

The night base is deliberately kept very dark — violet-black rather than a rich
purple — because the neon needs somewhere dark to burn against. Lift the base
and the signage stops reading as light.

The window follows the scene — a bright city framing a black screen looks
broken. In day mode the screen goes light, the type goes dark and the scanlines
invert to lighten rather than darken.

Nothing else in the UI reverts to a neutral light theme: day is a **palette swap
on the same custom properties**, not a second set of rules. `--gold` becomes
magenta, `--leaf` becomes teal, and the whole `--wm-*` stack is redefined, so
every rule written for night follows along without knowing day exists.

In day the buildings are deliberately kept cool and desaturated, because daylight
neon only reads if nothing else at that depth is competing for the colour. The
neon halo also pulls in — daylight eats the bleed.

## Landmarks

A generated skyline has one problem that no amount of extra rendering fixes:
every building is the same building. There is nothing to point at, so the eye
slides off it.

What fixes it is not more detail — it is a few shapes you can **name**. Roku
City is the reference here, and the thing Roku City actually gets right is that
you can say *there's the ferris wheel* and *there's the clock*. So there is now:

| | Layer |
| --- | --- |
| A **stadium** — a bowl widest at its rim, four floodlight masts | far |
| A **suspension bridge** — towers, a real catenary, hangers to the deck | far |
| A **radio telescope**, a pan with a smaller one cut out of its face | far |
| A **ferris wheel** — A-frame legs, a parametric rim, fourteen lit cabins | mid |
| A **drive-in cinema**, something playing on the screen, a marquee under it | mid |
| A **clock tower** with a belfry, a spire and a lit face | mid |
| A **construction crane** — lattice mast, jib, counter-jib, a load on the hook | mid |
| A **rocket** on its service gantry | mid |
| A **lighthouse**, hooped, its beams sweeping | near |
| A **pagoda**, five tiers, each roof a slab with its ends turned up | near |
| A **dinosaur** outside the natural history museum, presumably | near |
| A **domed observatory** with its shutter open and the instrument showing | near |
| An **airship** flying a different banner every time it comes round | in front of all of them |

Each one is deliberately plain. A landmark has to read as itself in a single
glance at a hundred pixels tall, and anything fussy at that size just turns back
into skyline.

Two rules make them work:

- They are drawn into the parallax buffers **with** the buildings and **before**
  the aerial wash, so they sit at their layer's depth and come round with
  everything else rather than floating on top of it.
- Their outlines use `o.window` — the brightest structural colour the layer has.
  A landmark drawn in the same values as the buildings around it is not a
  landmark, it is more skyline. It has to sit a step above the noise or there was
  no point placing it by hand.

The wheel's cabins are handed to the same flicker list the windows use, with a
travelling band instead of a random one — which is what reads as the lights
chasing round it.

The **airship** and the **lighthouse beams** are the two that cannot be baked.
The airship because the whole point of it is that it goes past — about a minute
to cross, then two minutes of empty sky, flying a different banner each time. The
beams because they sweep: the lantern's buffer position is recorded at build time
and the beam drawn per frame at buffer-x minus that layer's parallax offset, so
it stays on its tower. It fades out as it turns edge-on, which is what reads as
rotation rather than as a light going on and off.

## Cameos

The whole point of a screensaver city is that you glance up and something is
happening that was not happening last time.

So the sky runs an **event queue**: one cameo at a time, a long quiet gap after
it, and the next picked at random from the pool — never the same one twice
running, so you cannot predict what is coming. Each is a short scene with a
beginning and an end rather than a loop, which is what keeps them worth catching.

- A **UFO** comes in fast, stops dead, thinks about it, puts a tractor beam down
  for a few seconds, then leaves considerably faster
- **Fireworks** — three shells, each rising and bursting, sparks falling off
- A **police helicopter** working a searchlight across the rooftops
- A **little plane towing a banner**, and the banner is the joke
- A **meteor shower**, seven at once and out of phase
- A **flock** crossing in a V

The sky is otherwise left empty between cameos, on purpose. Something crossing it
at all times is wallpaper; something crossing it now and then is an event.

## The signage

Every billboard, vertical sign, rooftop signboard and airship banner is drawn
from the 3x5 font with a word picked to fit the space. The copy is deliberately
kind: `GOOD SOUP`, `WARM BREAD`, `CATS ONLY`, `NAPS 24H`, `FREE HUGS`,
`TEA HOUSE` - and the airship carries small kindnesses (`YOU LOOKED UP. NICE.`,
`HOME BY DINNER`) plus one motto: `SIC PARVIS MAGNA`. A skyline of portentous slogans is set dressing; a
skyline of businesses cheerfully overselling themselves is a city with people in
it. Nothing on it is a real brand, including the ones that sound like they
might be.

## Somebody's roof

The deck is the biggest-pixel real estate in the scene — nothing on it is more
than a metre or two away — so it is where detail actually pays. The reference
here is the *Silicon Valley* title sequence: density where every object is a
discrete thing you can name, so there is something to find on the fourth look.

Placed by hand, none of it overlapping anything else: a **water tank** on legs
with a ladder and a **weathervane**, a **stairwell hutch** with a neon over the
door, a **tag** on its flank and an **antenna array** on its roof, a **washing
line** with four garments, a **bike** leaning where somebody left it,
**crates**, a **telescope** on a tripod pointed up and to the left
— at the moon, which is up and to the left — a striped **deck chair**, a
**planter run** with five tomato plants on canes, a **skateboard**, a
**boombox** with a mug of coffee going cold on it, a **chess game** on a crate
that nobody has moved in a while, **paint cans** and a **ladder** lying flat,
two **traffic cones**, a stack of **tyres**, the cat's **food bowl** directly
under where the cat sits, **air handlers** with fan grills, **ducting** on
brackets, a **satellite dish**, a **steam vent**, **string lights** sagging
between four poles — and a **rubber duck**, which there is no explaining.

### Keeping the roof off the skyline

These two planes kept collapsing into one. The roof and the city behind it can
land on the same value — badly in day, and worst of all under snow, where the
deck goes pale *and* the snow light washes the city pale, so the two meet with
nothing between them and the cat's parapet stops reading as a foreground at all.

Three things fix it, and it needs all three:

1. **A separation band**, in the two dozen rows immediately above the parapet.
   **Which way it goes depends on what the foreground is doing, and getting that
   backwards is worse than not having it at all.** Dry, the roof is the darker
   plane, so the city is *lifted* behind it and the silhouette bites. Under snow
   both planes go pale — the deck from the blanket, the city from the snow
   light — and lifting the background then walks the two values together, which
   is precisely the bug the first version shipped. Under snow the buildings'
   bottoms are **darkened** instead, and the pale roof reads against them.
   The daylight roof palette was also pulled down a stop: it is the nearest plane
   in the scene and it should be the heaviest thing in it.
2. **A dedicated silhouette colour.** `edge` is used for the rim along the top of
   the coping and the shadow under the parapet's foot, and for nothing else — so
   it can be pushed as dark as it needs to go without dragging any other surface
   down with it. The rim went from three pixels to four; three was not enough
   once the coping could be buried in snow.
3. **Two pixels of rim on the snow bank**, not one. The bank is the palest thing
   in the scene sitting against a sky the snow light has also gone pale, and a
   single pixel of rim disappears between them. It gets a shade line under its
   lit crown for the same reason.

### The forty-pixel problem

All of it lives between y 452 and 494. That is the strip between the foot of the
parapet and the lowest row that survives the crop, and it is the real constraint
on the whole scene: **the closest, most detailed part of it is also the
thinnest.**

The crop used to be taken out of the sky — `object-position: 50% 72%` — on the
argument that the roof is the only part you can read individual objects in. That
stopped being true once the roof was cleared: below the parapet is now a flat,
near-black deck with nothing on it, and on a full-bleed hero it read as a dead
shelf between the skyline and the reading ground.

So the canvas is **dropped** instead. `--scene-drop` in `styles.css` makes the
element a fifth taller than the viewport, anchored at the top, which pushes that
empty deck off the bottom edge and brings the skyline down to meet the ground —
and brings the whole scene up a fifth in the bargain, which on a pixel grid costs
nothing.

It is one number, and it lives only in the stylesheet. `viewMap()` reads the
canvas's own box and its computed `object-position` rather than restating any of
it, so the panel projection the weather uses and the tap that sets off a firework
both follow the CSS automatically. They did not before: the portrait rule had
moved the horizontal anchor to 72% and `viewMap` was still hard-coded to 50%, so
every tap on a phone landed off to one side.

## Things that live here

A city is not a texture, it is a place with people in it. Most of what follows
costs a handful of pixels and does more for the scene than any amount of extra
rendering would.

**A 3x5 pixel font.** Three pixels is the narrowest a letter can be and still be
a letter, and a sign on the mid skyline is about ten pixels tall — which is
exactly enough. So the billboards say `RAMEN`, `KARAOKE`, `PAWN`, `24H`; the
vertical signs stack a letter to a cell the way the genre never does without; and
the rooftop signboards read `RAMEN 24H`, `HELLO WORLD` and `STAY AWHILE`. The
word is picked to fit the wall rather than the wall being sized to the word, so a
narrow tower gets `BAR` and a wide one gets `KARAOKE`.

The words are deliberately mundane. A skyline of portentous slogans reads as set
dressing; a skyline of noodle bars reads as a city.

**A pigeon** flies in, pecks at the coping, has a look round and leaves — thirteen
seconds out of every fifty-two. A bird that is always there is scenery; a bird
that turns up is an event.

**A delivery drone** crosses with a parcel slung under it. Four rotor dashes that
swap phase every frame do more for the illusion than any amount of detail on the
body would.

**A washing line** between the hutch and the second light pole, four garments
swaying out of phase, the sway a whole pixel or nothing. Nothing else on this
roof says somebody lives up here, and one line of laundry says it instantly. The
cloth is deliberately desaturated: it sits two metres from the viewer in a
foreground otherwise lit entirely by neon, and at full saturation four shirts
out-shout the whole city behind them.

**The cat** has an inner life. Its far ear twitches for two frames every few
seconds — the smallest possible thing that can happen, and most of why it reads
as alive rather than as a decal.

**Satellites**, two of them, crossing very high and very slowly, one tumbling so
it winks out every couple of seconds. The sky needs something moving at almost no
speed at all to sit against the clouds. And **a shooting star**, six frames every
sixty-five seconds, which is the only thing that keeps it worth seeing.

## Easter eggs

Big ones first, then the ones you are not meant to find straight away.

- One tower on the mid skyline has its lit windows arranged to spell **HI**. It
  is drawn at two pixels to a letter-pixel, on the same grid pitch as every other
  window, so it reads as an ordinary office block until the moment it doesn't.
- A rooftop signboard says **HELLO WORLD**.

### On the roof

- A **spider** has taken the corner where the parapet meets the hutch, web and all
- A **mouse hole** in the hutch skirting, with a trail of crumbs leading away
- A **doormat** at the hutch door and the **key** nobody hides well, beside it
- The cat's **toy mouse**, nowhere near the cat
- **Pawprints** crossing the deck and stopping at the parapet, which is where the
  cat is
- One slice of last night's **pizza**, still in the box
- A **coin** on its edge in a crack in the deck
- One of the five tomato plants is **dead** — four thriving plants is a planter;
  three thriving and one brown stick is a person
- A **rat** runs the length of the parapet's foot, twelve seconds out of every
  ninety, and never stops
- **Moths** orbiting the string lights, one pixel each, at night only
- A **paper plane** comes over the parapet, glides down across the deck and lands.
  Somebody upstairs is bored

### Out in the city

- A **grand piano** hanging from the crane's hook. Oldest joke in the book, and
  worth it: a crane with a crate on it is a crane, a crane with a piano on it is
  a scene
- A **cat sitting in a lit window** — two of them, on different layers
- A **gargoyle** leaning off a corner, watching the street
- A **rooftop pool** with a diving board, forty floors up
- A **window-washers' cradle** halfway down a face, ropes going up out of frame,
  with a very small person in it mid-stroke

### In the sky

- A **constellation** in the shape of a sitting cat. The stars are the bright
  part; the lines between them are dithered down almost to nothing, so it reads
  as an ordinary patch of sky until you notice it doesn't
- **Click the cat.** It turns round and looks at you, and a heart floats up. Two
  eyes instead of one is the whole animation — the head does not need to move for
  the gaze to. The hit test undoes the same `object-fit: cover` mapping the panel
  uses, and listens on the window because the stage sits over the canvas.
- **The Konami code** — up up down down left right left right B A. Every bulb on
  the roof burns steady, the cat turns round and stays turned round, and the
  line under the name changes. The check is a single index walked forward on a match
  and reset on a miss; no buffer, no slicing.

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

**Day keeps all of it** and only swaps the palette: a magenta face, teal and
amber misregistration either side, and a plum extrusion darkening into
near-black.

### The perspective stack

Arcade title screens sat the name in a **trapezoid** — the top line small, each
line below it larger, so the block appears to lean away from the viewer. That is
done here with per-line `font-size`, not a transform: a `rotateX` would resample
the glyphs off the pixel grid and soften every edge, which is the one thing this
file will not do.

`--wm-step` is the ratio between the two lines and everything else follows from
it. The fringe and the extrusion are declared **on the lines**, in `em`, so the
lower line automatically gets the deeper extrusion — which is what sells the
recession. The narrower line also carries the wider tracking, so the two end
closer in width than their point sizes alone would put them, keeping the
silhouette a trapezoid rather than a wedge.

Each line's `text-indent` is half its tracking. Letter-spacing is added after the
last glyph too, so a centred line sits half a space left of true centre — and
with two different trackings the lines would sit off centre by *different*
amounts, which on a symmetrical trapezoid is the one error the eye catches
immediately.

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

Three, one job each. **Press Start 2P** is the interface — the wordmark, the
section markers, the city controls, anything that is furniture. **JetBrains
Mono** is the machine's speaking voice: labels, captions, the readout under the
name, every word inside a diagram. **Satoshi** carries the reading — the case
studies and the about page.

A pixel font is a costume, and nobody should have to read a costume.

## Editing

Scene palettes are the `THEMES` object at the top of `scene.js` — change a hex
there and both the static layers and the animation follow. UI colours are custom
properties at the top of `styles.css`; day overrides the same names rather than
adding new ones, so anything you add for night follows into day for free.

Home-page copy is plain text in `index.html`. Case-study copy is the `WORK`
array in `work.js`. If the name needs a third line, add a `.wordmark__line` span
and give it its own `font-size` — the trapezoid is only a sequence of sizes.

The parapet's separation from the deck is deliberately re-asserted **after** the
weather is applied, in `buildRoof`. Whatever is drawn on the coping, the hard rim
along its top and the shadow under its foot are what keep it reading as a plane
in front of the city. Weather is allowed to change the shape of the parapet; it
is not allowed to dissolve its edge.

Routes are hashes, so static hosting needs no rewrite rules, the back button
works and a link can be shared. Every route change moves focus to the new page's
`<h1>` and retitles the document, because a hash route swaps the whole view
without telling anybody otherwise.

Both the scene and the UI honour `prefers-reduced-motion` — the canvas holds its
first frame and the CSS animations hold theirs.
