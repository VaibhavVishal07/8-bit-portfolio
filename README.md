# 8-bit portfolio

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
four poles with a bulb every few pixels guttering on its own cycle, a steam vent
whose plume widens as it rises, and a campfire whose flame is generated per frame
rather than being a fixed sprite — each row tapers toward the tip, is displaced
by two out-of-phase sines, and is filled in four bands from a dark red rim to a
near-white core.

**Detail is drawn as form, not as speckle.** Every gravel stone is a lit pixel
with a dark one directly under it — a chip with its own shadow — and there are
far fewer of them than a scatter would use, because at this scale the eye reads
density, not count. The tar seams are straight runs with one deliberate step in
each rather than random walks: a seam is laid by a person, so a wobbling line
reads as a mistake.

**The rooftop layer does not scroll.** The cat and the campfire stand on it, so
if it moved they would appear to slide across the ground.

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

## The train

**An event, not a loop.** It crosses, then the line is empty for about
seventeen seconds. It is drawn in screen space rather than into the viaduct
buffer, so it runs along the deck at its own speed instead of being carried by
the parallax.

Eleven cars at 76px is **longer than the canvas is wide**, and at twenty pixels
a frame it clears the frame in about four seconds — so it reads as an express
rather than as a shuttle. What sells the speed is not the number: it is the
**smear of window light left behind along the whole train**, drawn before the
cars so they sit on top of it.

The viaduct was rebuilt to carry it. A lattice girder with alternating diagonals
under the deck, sleepers and two running rails on top, and a **catenary** strung
above on cantilever masts. Every fifth car raises a **pantograph** to that wire,
and the shoe throws an arc every seventh frame. Without the wire a fast train
reads as a sticker sliding along a shelf; with it, it is being pulled by
something.

**The canvas is cleared every frame.** The layers do not cover every pixel, and
without a clear those rows keep the previous frame — which on a theme switch
means the old palette bleeding through.

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

The frame counter is never reset either, so the parallax and the train carry on
from exactly where they were. Toggling rain or snow on and off now returns the
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

**Lightning** strikes on a timer, the same way the train runs — every eight to
twenty-eight seconds. It plays a short envelope of discrete steps rather than a
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
| Campfire | normal | **guttering**, short reach | **banked right up**, twice the light |
| Steam vent | thirty puffs | **sixteen** | **fifty-two** |

The campfire reads it hardest, because a fire is the one object on the roof whose
whole purpose changes with the weather. Same forty-four rows of flame; three
numbers different.

### The campfire needs the window

The window sits directly over the fire, and the rain already treats the window
as a surface — a drop in that column lands on its lip instead of the roof. Which
meant the fire had survived every storm this scene has ever run, as the one
object on the roof still drawn as though none of that mattered.

It depends on the window now. **Take the panel out of the column above the fire
while it is raining or snowing — drag it aside, minimise it, close it — and the
flame drops, guts, and is out in about two and a half seconds.** The hot bands
go first: it loses its white heart, then its yellow, and the last thing burning
is the dull red that was always at the rim, because a dying fire does not shrink
evenly. What is left is a charred stack over coals and a thread of smoke coming
off it — smoke is thickest just *after* a fire is out, which is when a real one
smokes hardest, the fuel still hot and no flame left to burn the smoke off.

Put cover back and it catches again over about four seconds. Slower than it
died, because nothing relights as fast as it goes out.

### Why it stopped being an oil drum

It used to be a brazier: twenty-six pixels across, eighteen tall, a flame you
could cover with a thumb. Fine while it was scenery, wrong the moment it became
something that can go out — **an event you cannot see is not an event.**

So it is a campfire. Four logs over a bed of embers inside a ring of stones,
with a flame half again as tall over twice the footprint, which is enough that
losing it registers from across the frame. Three things make it read:

- **Draw order is back to front** — back log, embers, flame, the two leaners,
  front log, stones. The leaners started out behind the flame and were
  completely invisible, because a dark log inside a bright flame is nothing. In
  front they are silhouettes crossing the light, which is the single strongest
  read a campfire has.
- **The flame is a teepee, not a cone.** It narrows on a power curve rather than
  linearly and pinches back in at the very bottom, because a flame is thinnest
  where it meets the fuel — the old straight taper made the base wider than the
  logs it was supposed to be sitting in.
- **The colour bands are a fraction of the width, not a fixed inset.** At eight
  pixels across, insetting one and two pixels put the yellow and the white at
  three quarters of the flame and looked right. At twelve it made the whole
  thing a white column with a red edge.

The logs char from the middle outward and the ends stay wood-coloured — both
what a log in a fire looks like and the only reason four dark bars are still
legible against the light. The char does not clear when the fire dies; having it
lighten looked like the logs were healing.

The life value is ticked against real elapsed time on the 60fps side, so "a
couple of seconds" is a couple of seconds and not a count of 12fps frames that a
slow machine would stretch. In clear weather the fire is never in danger, and a
maximised window counts as cover — it is covering the whole roof.

Both settings persist in `localStorage`.

## Day / night

The toggle switches between two full palettes. Switching rebuilds the static
layers and nothing else; the choice persists in `localStorage`.

|  | Night | Day |
| --- | --- | --- |
| Sky | Violet-black up to a purple haze | Teal zenith down into an amber smog band |
| Orb | Moon, bare — maria and lit western rims, no glow | Sun, with corona and halo |
| City | Hot neon over a dark base | Cool desaturated towers, neon still burning |
| Extras | Campfire, stars, satellites, craft | Birds, craft, steam |
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
line** with four garments, a **bike** leaning where somebody left it, a
**campfire**, **crates**, a **telescope** on a tripod pointed up and to the left
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

The crop is why `object-position` is `50% 72%` rather than centred. `cover` on a
viewport wider than 16:9 has to cut top and bottom, and the two are not worth the
same — the sky is mostly gradient and repeats, while the roof is the only part
you can read individual objects in. So the crop comes out of the sky. Everything
that maps between page and canvas coordinates goes through one `viewMap()` that
undoes exactly that: the panel projection the weather uses, and the cat's hit
test.

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
  window retitles itself. The check is a single index walked forward on a match
  and reset on a miss; no buffer, no slicing.

## The game layer

The L2 pages stopped being documents, because a retro game never shows you a
document — it shows you a **place, objects in it, and something that talks**.

**The cat narrates every page.** Each .EXE carries a dialogue box pinned to the
bottom of the scrolling document — where a game HUD puts it — with the rooftop
cat sitting beside it. It types an intro when the window first opens, and any
element carrying `data-say` re-types the box when pointed at or focused. The
typing is character-by-character on a timer: the one animation in the project
that is stepped by its very nature. Writing voice lines is just editing
`data-say` attributes.

**ABOUT is a room, not a form.** A character sheet up top (name, CLASS, LV), then
**ON THE SHELF**: two boards carrying pixel objects built from blocks — a book,
a cartridge, a VHS tape, a record half out of its sleeve, a toolbox, and the
cat's yarn ball (point at it: *"That one is mine. Do not touch it."*). Objects
lift when pointed at, one per board fidgets on its own, and the cat describes
whatever you touch. Hobbies became **SIDE QUESTS** with statuses — ACTIVE,
DAILY, COMPLETE, a blinking NEW!.

**WORK is a world map.** The career runs left to right as WORLD 1 → 2 → 3 along
a dotted path, oldest first, with the current job as the furthest world reached
— flag flying. Case studies are **SELECT STAGE** cards that still expand in
place; their stills are numbered SCREEN 1/2/3 by CSS counters.

**CONTACT is the join screen.** PLAYER 2 WANTED, three channels, and a
CONTINUE? counter in the footer that counts 9 to 0 and rolls over forever,
because that is what an arcade board does when nobody puts a coin in.

**Adding images:** any dashed rectangle with an `IMG` corner tag is a slot —
drop an `<img>` inside it and the CSS crops, covers and pixel-renders it.

## Windows

The title bar has had minimise, maximise and close on it since the beginning and
they did nothing. Now they do, and there is a second window — **WORK.EXE** —
which opens from the menu.

Tapping `1 WORK` sends the title screen down to a taskbar and brings up a wider
window with the experience and the case studies in it. All of the copy in there
is placeholder, meant to be replaced.

None of it is Windows 98 in *appearance*. Beveled grey fought the neon city,
which is the whole reason the panel became a terminal HUD in the first place. It
is Windows 98 in **behaviour**: one window at a time, minimise to a bar along the
bottom, click the task to bring it back.

Each window is in one of three states and no more:

| | |
| --- | --- |
| `up` | on screen, and the only one on screen |
| `min` | alive, but down on the taskbar |
| `closed` | gone, and not on the taskbar either |

Opening a window sends whatever was up to `min`. Closing one promotes the first
thing still minimised, so the screen is never left bare. `Esc` closes the top
window unless it is the title screen. Maximise makes the window a flex column so
the document actually fills it — otherwise the screen keeps its natural height
and most of a maximised window is empty.

**The taskbar only exists when there is more than one window in play.** On the
bare title screen it would be covering the rooftop, which is the most detailed
part of the scene. Open WORK and it appears; close WORK and it goes again.

### Elevation

The panel needed to sit *above* the backdrop rather than in it, and there is no
blur anywhere in this project — so height is expressed the way a tile engine
would express it. Reading outward: the raised edge catching light along the
top-left, the same edge falling away bottom-right, a keyline, then a cast shadow
stepping off the scene in two hard jumps rather than fading. Four flat colours
doing the job of one blur, and all of it swaps with the theme.

### Title-bar buttons

They were 16x14 with a flat coloured square inside — too small to hit, and no
indication of which was which. They are proper targets now and each draws its
actual glyph: a low bar for minimise, a hollow box with a heavy title bar for
maximise, and an X for close built from two stepped diagonals, two pixels at a
time. A rotated rule would have been one line of CSS and also the only
antialiased edge in the entire project.

### Desktop icons

**WORK**, **ABOUT**, **CONTACT** and **HOME**, top-left, one column, where they
have always gone — and out the whole time, not only when every window is down.
A desktop with nothing on it until you put every window away is not a desktop,
it is an easter egg. They sit *under* the windows, which is where desktop icons
have always sat, so nothing has to move out of anything's way; on a viewport
narrow enough for the window to reach them the window simply covers them, the
same as a maximised window covers the real thing.

Each is a **16x16 sprite** rather than a CSS slab with pseudo-element decoration
bolted on. The old set was a folder with a tab, a document with three lines, an
envelope with a stepped chevron and a bare rectangle — four silhouettes at four
sizes with nothing in common but a drop shadow, and only the envelope really
said what it opened. The new four are drawn on one grid with one ink outline and
one accent colour each, and every one of them says what is behind it: a
**cartridge** for WORK.EXE, which is a rack of them; **player one** for
ABOUT.EXE, which says PLAYER 1 / READY; a sealed **envelope**; and the **CRT**
running the title screen. They live in the `<defs>` block at the foot of
`index.html` next to the heart, and they are sized in whole multiples of
sixteen — 64, 80, 96 at the three breakpoints — because a pixel sprite on a
`clamp()` comes out with some pixels five wide and some six.

ABOUT.EXE and CONTACT.EXE exist as windows now too, with placeholder copy. The
title-screen menu, the desktop icons and the taskbar all go through the same
`launch()`, so all three routes behave identically.

### Dragging

By the title bar, as in the original. The stage centres a window until you touch
it; the first drag pins it exactly where it already was and moves it from there,
so it never jumps on the first pixel. Windows 98 dragged an *outline* and only
moved the window on release — this moves the window itself, because that is what
a hand expects now, but the position is rounded to whole pixels every frame so a
window in flight never lands between them.

The title bar is never allowed off screen. Lose that and the window is gone:
there is no way to grab it back. A resize re-clamps anything that was left near
an edge.

Double-clicking the bar maximises, as it always has. Maximising has to give up
any dragged position first, or the inline `left`/`top` beat the class's `inset`
and the window "maximises" to wherever you happened to leave it.

### The zoom rectangle

Minimise and restore do what Windows 98 did: an outline walks the gap between
the window and its taskbar button in eight jumps and is gone in about a sixth of
a second. It does not tween, it **steps** — same rule as everything else in the
project, and for the same reason: the machine this is pretending to be could not
tween. Long enough to say where the window went, short enough that it never
feels like it is being animated at you.

The window it is travelling to hides while the outline is in flight, so the
rectangle *arrives* and the window appears, rather than the two being on screen
together. Opening WORK from the menu runs both halves at once — the title screen
dropping to the bar while the new window comes up off it. Closing stays instant,
because there is nothing to fly to and whatever gets promoted is simply revealed
underneath.

### Sizing

Three things were set for a narrow window and looked wrong on a wide display:

- **The taskbar** was nine pixels of Press Start 2P — smaller than anything else
  on screen, when telling at a glance which window is up is the only job it has.
  It now sizes off the same clamp as the window titles, and then some.
- **WORK.EXE** capped at 1180px, which on a wide display is about a third of the
  screen: a dialog box rather than the thing you came to read. The cap is now
  deliberately enormous so the `vw` term is what binds.
- **The case studies** were sized like list rows and read as an afterthought
  under the experience, when they are the thing you actually want clicked. They
  get a thumbnail, a number you can read across the room, and a border thick
  enough to make them objects rather than boxes. The thumbnail is a banner, not
  16:9 — at 16:9 on a card that wide it was taller than everything under it and
  pushed the title off the bottom. Its placeholder pattern runs in vertical bars
  because a diagonal hatch is the one thing on the page that would have to be
  antialiased.

Two things had to follow the windows around:

- **The weather.** `panelRect()` used to grab `.window` and there is more than
  one of those now, so the window manager marks whichever is up and the rain and
  snow land on that. When everything is minimised they land on nothing.
- **The scene controls.** They sit above the stage, so a maximised window cannot
  cover them — which would be fine except that its own close button ends up
  underneath them. They step down out of the way instead of the window being
  raised over them, because losing the weather toggles behind a full-screen
  window would be the worse trade.

Day mode also has to flip `--cream`, the default ink. It never mattered on the
title screen, where everything sets its own colour, but the work document leans
on it for headings — and near-white headings on a near-white screen is not a
subtle bug, it is an invisible one.

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

## Music

Synthesised in the page with the Web Audio API — square waves for the bass and
lead, a triangle counter-line, filtered noise bursts for the drums, over Am–F–C–G
at 108bpm. Not a file.

That is partly a licensing answer and mostly a design one. **A chiptune is a
program, not a recording**, and a title screen that ships an mp3 in order to
sound eight-bit has rather missed the point. It also keeps the project honest:
still no dependencies, still no build step, still nothing to download.

Nothing is constructed until the button is pressed — browsers will not start an
`AudioContext` without a gesture, and they are right not to. The scheduler is the
standard lookahead loop: a `setTimeout` every 25ms queueing any note that falls
in the next 100ms, so the timing comes from the audio clock rather than from
`setTimeout`, which is not accurate enough to hold a beat.

The **visualiser** hangs off an `AnalyserNode` on the master bus, so the bars are
the music rather than a loop running next to it. Heights snap to whole cells and
each bar is drawn as a stack of discrete segments — a meter that slides
continuously is a modern meter; one that lights whole segments is the meter this
machine would have had.

## Fonts

Both free, from Google Fonts: **Press Start 2P** for the wordmark, menu and
labels; **Pixelify Sans** for body text.

## Editing

Scene palettes are the `THEMES` object at the top of `scene.js` — change a hex
there and both the static layers and the animation follow. UI colours are custom
properties at the top of `styles.css`; day overrides the same names rather than
adding new ones, so anything you add for night follows into day for free.

Copy is plain text in `index.html`: the two `.wordmark__line` spans, `YOUR ROLE`,
and the three menu rows. If the name needs a third line, add a span and give it
its own `font-size` — the trapezoid is only a sequence of sizes.

The parapet's separation from the deck is deliberately re-asserted **after** the
weather is applied, in `buildRoof`. Whatever is drawn on the coping, the hard rim
along its top and the shadow under its foot are what keep it reading as a plane
in front of the city. Weather is allowed to change the shape of the parapet; it
is not allowed to dissolve its edge.

The menu is keyboard-driven: arrow keys move the cursor, `1`–`3` jump straight
to a row, Enter follows it.

Both the scene and the UI honour `prefers-reduced-motion` — the canvas holds its
first frame and the CSS animations hold theirs.
