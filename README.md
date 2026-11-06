# Marshall Solver

A static website that solves the Rubik's Cube with [Philip Marshall's method](https://www.helm.lu/cube/MarshallPhilipp/)
and animates the solution with [cubing.js](https://js.cubing.net/cubing/).

## The method

Everything is built from two series:

| Series | Moves | Effect |
|---|---|---|
| Edge Piece Series | `F R' F' R` | cycles 3 edges (corners are collateral) |
| Corner Piece Series | `U R U' L' U R' U' L` | cycles 3 corners, edges untouched |

Steps: 1. cross, 2. center-section edges, 3. top edges, 4. five corners, 5. end game.

`src/engine/solver.js` builds a table of every distinct "preliminary turn + setup + series + undo setup"
(all 24 cube orientations, both directions, setups up to 2 turns). Each step repeatedly applies the
cheapest table entry that places more pieces without disturbing finished ones; if none exists it
finishes with a two-entry meet-in-the-middle lookup. The cross search also tracks quarter-turn parity,
since the series are even permutations. The cross is always built on the top (white) face. Each step ends in its target state (white cross; cross + 3 middle-layer edges; all edges; all edges + at least 5 corners; solved), and turns are only ever cancelled within a step, so playing a step shows exactly that state. A few equally short crosses are tried and the shortest overall solution is kept. `npm test` replays every solution step by step and checks each target.

**Partial F2L option:** cross + 3 corner-edge pairs in steps 1-2, then the remaining 5 edges with series that leave those corners alone. The pairs come from the standard F2L insertion algorithms ([rubiksplace.com](https://www.rubiksplace.com/speedcubing/F2L-algorithms/), `src/engine/f2l.js`: every algorithm in all four slots, mirrored, with pre-alignment turns and short extraction moves), or from Marshall's own edge + corner series, whichever is shorter.

## Performance

`node scripts/profile.mjs [count] [f2l]` times each phase over random scrambles. Main costs and what was done:

- Every table entry carries a bitmask of the pieces it leaves untouched, so "keeps finished pieces?" is one bit test instead of composing a state.
- Gains and two-step lookaheads are evaluated by index lookups on only the relevant pieces.
- The meet-in-the-middle finish uses integer hashes of the piece part instead of string keys.
- The cross table is a flat integer BFS; table construction hashes states numerically.
- Typical solve: ~0.25-0.35 s (was ~1.4-2.7 s). The tables (~1.7 s) are built once in the web worker at page load.

This is an independent implementation (average about 57-60 moves), not a transcription of the original write-up.

## Develop

```sh
npm install
npm run dev     # local dev server
npm test        # solves random scrambles, verifies the result
npm run build   # static site in dist/
```

Pushing to `main` deploys `dist/` to GitHub Pages via `.github/workflows/deploy.yml`
(set Settings -> Pages -> Source to "GitHub Actions").

## Rotations and the Twizzle link

Each series is always written in its canonical form (`F R' F' R`, `U R U' L' U R' U' L`, or the inverse),
wrapped in cube rotations that bring the target pieces to the front and back again. Edge series only use `y` rotations, so white stays on top and yellow at the bottom; the corner series may use any rotation, so the three corners it cycles sit on top.
Rotations are not counted as moves, and because the series are fixed text, no turns cancel into them
(solutions are longer than before). The result panel links to the Twizzle editor with a `//` comment on every group of moves.

After step 1 the cube is turned over (`x2`) so yellow is on top; steps 2-5 are solved in that orientation and the last step turns the cube back.

## Clickable solution

The solution is shown as nested borders: the outer border plays the full solution, a step's border plays that step,
a block (series, setup, rotation) plays just that part, and a single move jumps to the cube state right after it
(the full solution stays loaded, so you can keep stepping from there).

## Choosing the best solution per step

Every step (and the cross) produces a few candidate solutions - different first moves, different equally short crosses,
F2L algorithms vs. series - and the one with the lowest [movecount coefficient](https://github.com/trangium/trangium.github.io/tree/master/MovecountCoefficient)
(MCC, by Trangium, MIT; vendored in `src/engine/mcc.js`) is kept. If a later step cannot be finished from a candidate, the next best one is used.
A `y` rotation also commutes with `U`/`D` turns, so `y2 U y2` collapses to `U`.

Step 4 ends with at least 5 corners home and the remaining 2 or 3 on one side (a common face), so the end game
starts from a position one corner series can finish; the tests check this.

The player's alg carries `//` comments for every group of moves (step names, setup, rotation, series), so its built-in
Twizzle button opens the solution with explanations. The highlighted move follows the animation, and the layout adapts
from phones to a two-column desktop view.

## cubing.js

Besides the player, the page uses [`cubing/alg`](https://js.cubing.net/cubing/alg/) to read the scramble field
(comments, groupings like `(R U)3`, commutators `[R, U]`, curly quotes) and [`cubing/scramble`](https://js.cubing.net/cubing/scramble/)
for the Random scramble button (a proper random-state 3x3x3 scramble).

## Playback

The player always holds the full solution; cubing's own controls are hidden in favour of our own: a progress bar,
previous/next step, previous/next series, play/pause, a loop slider (off, 1, 2, 3 moves, algo, step, all), and a
Twizzle link that opens the solution with `//` comments explaining every move. Clicking a series plays just that series,
clicking a step loops that step, clicking the outer border plays everything, and a second click on a move plays from it.
After every jump (and before every loop) the animation holds for one rotation. The borders of the solution, step and
series that are playing are highlighted (hovering uses a lighter shade).

The two series go by their usual names: the Edge Series `F R' F' R` is the *Hedgeslammer* (its inverse `R' F R F'` is the
*Sledgehammer*), the Corner Series `U R U' L' U R' U' L` is *Niklas*.


## Sexy moves and natural turns

The edge series are all turned and mirrored forms of the Hedgeslammer (`F R' F' R`) and Sledgehammer, e.g. the sexy move
`R U R' U'` and `U R U' R'`, `L' U L U'`, `U L' U' L`, written without turning the cube. When several spellings do the same
thing the one with the best movecount coefficient wins - which does prefer natural turns (R U L D) to F and B, and punishes
cube rotations (3.5 each). The cheap table costs weight F/B and rotations the same way so the solver leans that direction while searching.

## Automatic solving and options

There is no Solve button: the scramble is solved as you type (after a short pause), on load, on *Random scramble* and
whenever an option changes. Calculations run in two web workers; a solve that is still running when a new request
arrives is aborted by terminating its worker, and the spare (already warmed up) takes over.

Options: *Yellow on top from the start* (the solution begins with `x2` and builds the white cross on the bottom), *Beginner white cross*
(a BFS finds the daisy - the four white edges around the yellow centre, white facing up - and then each petal is turned above its
centre and dropped into the cross with a half turn; implies yellow on top) and *Partial F2L*.

## Smart cube (Bluetooth)

One *Connect smart cube* button for every brand: [`smartcube-web-bluetooth`](https://github.com/poliva/smartcube-web-bluetooth) (MIT; a multi-brand successor of gan-web-bluetooth) recognises the cube - GAN Gen1-Gen4, MoYu, Giiker/Mi, GoCube, QiYi, XMD Tornado - and reports the same events for all of them.
Facelets snapshots *from the cube* are trusted; states the driver merely added up from moves are ignored. The newer GAN protocols need the cube's MAC address; the browser reads it from the advertisement if it can, otherwise you are asked for it. Facelets from the cube are converted to a cubing.js pattern in `src/facelets.js`.

Web Bluetooth needs Chrome or Edge. Once connected there are two cubes: *Your cube* mirrors the real cube, and the solution cube loops what is left of the
current algorithm (one series with its setup, not the whole step). *use current scramble* turns the cube's state into a scramble (via cubing's solver) and solves it;
the next algorithm follows a second after the real cube shows the state the algorithm leads to ("done" in between). Solution rotations (`x2`, `y`, ...) are not moves for a smart cube
(its centres never move), so the solution is translated into the cube's own frame before it is compared.

### Orientation sync and reliability

The *Your cube* player is turned like the algorithm on the right: it gets the same `x2`/`y` rotations at the same points and the real
cube's turns are shown on the face that has in that orientation (a smart cube reports turns of its own faces, not of the viewer's).
When the real cube shows an algorithm's end state, both cubes show the same pieces and orientation (checked with a simulated cube).

Reliability: the cube's periodic state report is compared with the tracked state - when they differ (a move was lost) the cube's state is adopted;
a lost connection is reported instead of silently ignoring moves; *Re-read cube* asks for the state again and, for GAN Gen2-4 cubes,
*Cube is solved: reset* does what Reset in the GAN app does (only press it when the physical cube is solved). A cube whose internal state
differs from the physical cube (turned while it was off or its battery was swapped) can only be fixed by that reset.

Dragging or touching one of the two cubes turns the other one the same way (their cameras are linked). GAN Gen2-4 cubes need their MAC address:
once a cube has been read successfully with an address, it is kept in `localStorage` (by the cube's name) and used next time without asking; a saved
address that does not work is forgotten.

## One panel, one or two cubes

The player panel shows the solution cube alone, or - with a smart cube connected - next to *Your cube* (the second cube is only there while connected).
Behind the cubes the panel names the current step, says in a short subtitle what its algorithm is (Hedgeslammer, Niklas, ...) and shows the algorithm below.
With a smart cube connected the solution cube loops only what is *left* of the current algorithm: the cube's state is compared with the state after every move of the
algorithm, moves already made are not shown (nor in the text), and the animation starts from the cube's current state. A cube that is off the algorithm's path
is reported. Clicking in the solution list goes back to the full solution until the next turn on the real cube.

## Trimmed sexy moves in step 2

Step 2 does not care about the top layer, so an edge series that ends with a top-layer turn (`R U R' U'`, `U R U' R'`, ...) may leave that last turn out
(`R U' R'`). That flips the edge parity; step 3 ends with the aligning `U`/`U'` turn that sets it right again (it is only there when needed).

## The end game

Every series is written as *rotate, setup turns (as seen after the rotation), series, repair, rotate back*. The end game is looked up, not searched:
a table of everything one Niklas can do after a rotation and 1-3 setup turns (about 1000 distinct corner changes, built once in the background) says whether
**one** Niklas finishes the cube - that is the case when one of the last corners can be turned into its place and orientation. Otherwise the cheapest
**two** (found by meeting in the middle through the same table) always do. Step 4 prefers results that leave a one-Niklas end game.
In 20 random solves 18 end games were a single Niklas, 2 needed two; average solution length fell from about 87 to about 77 moves.

## Step 0 and the algorithm window

With a smart cube connected the algorithm window starts with **0. Scramble**: the moves that take the cube from where it is to the scramble
(cubing's solver finds them from the cube's state; moves already made drop out of the list). When the cube is neither on that path nor on the solution,
the moves it was given are listed under the target moves ("You did: ...") and **use current scramble** appears in the top right corner - it takes the cube's present state
as the scramble. When an algorithm is finished the line reads **done** and the next algorithm follows a second later by itself (only **new scramble** after the last one is a button). Without a smart cube the move that is
being played is highlighted in the algorithm line as well.

## Step 3 is split

Step 3 ("Top Edge Pieces") stops at Marshall's key position: one middle-layer edge and two last-layer edges are wrong and one series
(ideally a bare Hedgeslammer / Sledgehammer / sexy move) finishes them - that series is step 4, "Last Three Edge Pieces". The optional aligning `U`
turn ends step 3. In a random sample 23 of 30 solves reached the key position; otherwise step 3 simply solves all the edges and step 4 is empty. Step 2 is named
"3 Center Section Edge Pieces" or, with partial F2L, "3 F2L Pairs".

## Credits

[cubing.js](https://js.cubing.net/cubing/) (player, alg parser, scrambler, Bluetooth for first-generation smart cubes), [gan-web-bluetooth](https://github.com/afedotov/gan-web-bluetooth)
(GAN Gen2-4 protocol), Trangium's [movecount coefficient](https://github.com/trangium/trangium.github.io/tree/master/MovecountCoefficient), rubiksplace.com's F2L algorithms, and
ideas from Pau Oliva's [smartcube-web-bluetooth](https://github.com/poliva/smartcube-web-bluetooth) (a multi-brand successor of gan-web-bluetooth) and
[Cubedex](https://github.com/poliva/cubedex) (an algorithm trainer built on them).

### Wrong turns

When the smart cube is turned away from the algorithm, the turn list starts with the moves that take it back (shown in red, in the shown orientation), then continues
with the rest of the algorithm. Before that the page checks whether the state is just another way to a state on the path - then nothing is added (`L L` for `L2`, `U U'`, ...) - and
whether one or two turns lead to a state further along the path, which is shorter than taking everything back (`L` after a first `L` instead of `L' L2`).
The same applies on the way to the scramble in step 0.

### Round and round

A solved cube is the start of a new round, not the end of one: connected solved, the window shows step 0 - the path from the solved cube to the scramble. Once the cube is solved again the
window says "Solved" with a clickable **new scramble**, which generates a scramble, solves it and goes back to step 0 (scrambling), then solving, then scrambling again.

With *Yellow on top from the start* the solution begins with `x2`; step 0 is shown in that orientation too, on both cubes (the scramble moves are written for yellow on top), so
the cubes agree from the moment they connect and no rotation is given twice when step 1 starts.

## Loop slider

*Loop* is a slider: `off`, `1`, `2`, `3` (that many moves, counted from the current one - meant for a cube without Bluetooth), `algo` (the current series), `step` and `all`.
The line above the cubes highlights the move being played, also for step 0 and for the lists a smart cube shows; the solution list lights up only while the solution itself plays.

The line above the cubes is grouped and coloured like the solution list - one chip per part (setup, rotation, series, repair; Hedgeslammer in blue, Niklas in orange, ...);
turns to take back after a wrong move are a red chip in front.

The loop slider works the same with and without a smart cube (the remaining algorithm or the step 0 list is what it loops over) and starts at `3`.
Clicking a series sets it to `algo`, a step to `step`, the outer border to `all`.

A half turn done as two quarter turns is not a mistake, in either direction: the cube sitting at the first quarter (`L` or `L'` for an expected `L2`) is shown as still on the path.
Only another move after that quarter turn counts as one (and then the quarter turn is part of what is taken back).

The *speed* slider (¼× to 4×, remembered in the browser) sets the playback tempo; the one-rotation pauses around jumps and loops scale with it.
Moving the loop slider restarts the animation at the start of the new loop.

With partial F2L the text above the cubes names the pair an algorithm works on by its two colours: "F2L algorithm · inserts the green-red pair" (or "frees the ... pair" for the turns
that get a pair out of its slot first). Colours assume the usual scheme (white top, green front, red right).
