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
previous/next step, previous/next algorithm, play/pause, a loop slider (off, 1, 2, 3 moves, alg, step, all), and a
Twizzle link that opens the solution with `//` comments explaining every move. Clicking a series plays just that series,
clicking a step loops that step, clicking the outer border plays everything, and a second click on a move plays from it.
After every jump (and before every loop) the animation holds for one rotation. The borders of the solution and step that are
playing are highlighted, and the series being played gets a yellow fill (the edge series chips are already accent blue); hovering uses a lighter shade.

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
current algorithm (one series with its setup, not the whole step). *Use current scramble* turns the cube's state into a scramble (via cubing's solver) and solves it;
the next algorithm follows a second after the real cube shows the state the algorithm leads to ("done" in between). Solution rotations (`x2`, `y`, ...) are not moves for a smart cube
(its centres never move), so the solution is translated into the cube's own frame before it is compared (`src/cubeframe.js`).

Wide and slice moves (Roux's `r` and `M`, wide moves in algorithm sets) reach a smart cube as turns of its outer faces, measured against its core:
`r` is reported as `L`, `M'` as `R'` and `L`, and the whole cube turns with them (`r` = `L x`, `M'` = `R' L x`; checked against cubing.js for every wide
and slice move, centers included). The solution is translated that way, the turn that comes with such a move applies to everything after it, and having
done one of the two outer turns of a slice move is not a mistake (like the first quarter of a half turn). `npm test` checks that, after every move of
every preset's solutions, the state the page expects is the one a smart cube reports (`node scripts/test.mjs 0 smartcube`).

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
the moves it was given are listed under the target moves ("You did: ...") and **Use current scramble** appears in the top right corner - it takes the cube's present state
as the scramble. When an algorithm is finished the line reads **Done** and the next algorithm follows a second later by itself (only **New scramble** after the last one is a button). Without a smart cube the move that is
being played is highlighted in the algorithm line as well.

## Step 3 is split

Step 3 ("Top edge pieces") stops at Marshall's key position: one middle-layer edge and two last-layer edges are wrong and one series
(ideally a bare Hedgeslammer / Sledgehammer / sexy move) finishes them - that series is step 4, "Last three edge pieces". The optional aligning `U`
turn ends step 3. In a random sample 23 of 30 solves reached the key position; otherwise step 3 simply solves all the edges and step 4 is empty. Step 2 is named
"3 center section edges" or, with partial F2L, "3 F2L pairs".

## Credits and licenses

This project's code is MIT licensed (`LICENSE`). Everything it builds on keeps its own license; `THIRD_PARTY_NOTICES.md` (also served as `licenses.txt`, generated by `scripts/make-notices.mjs`) lists every package in the build with its license text.

- [Philip Marshall's solution](https://www.helm.lu/cube/MarshallPhilipp/) - the method; the docs site [philip-marshall-ultimate-solution](https://github.com/tyllmoritz/philip-marshall-ultimate-solution) by tyllmoritz showed how cubing.js is used.
- [cubing.js](https://github.com/cubing/cubing.js) (Lucas Garron and contributors; MPL-2.0 or GPL-3.0-or-later, used unmodified) - player, alg parser, scrambler and the 3x3x3 solver used for smart cube states (min2phase by Shuang Chen).
- [smartcube-web-bluetooth](https://github.com/poliva/smartcube-web-bluetooth) (Pau Oliva Fora, MIT; a fork of [gan-web-bluetooth](https://github.com/afedotov/gan-web-bluetooth) by Andy Fedotov) - Bluetooth for GAN, MoYu, Giiker, GoCube, QiYi cubes.
- [Movecount Coefficient](https://github.com/trangium/trangium.github.io/tree/master/MovecountCoefficient) by Trangium (MIT) - `src/engine/mcc.js`.
- [Cubedex](https://github.com/poliva/cubedex) by Pau Oliva Fora (MIT) - algorithm collections and ideas (installable offline app, smart cube handling).
- [zz-method-docs](https://github.com/crystalcuber/zz-method-docs/tree/cubingmethods) by crystalcuber (MIT) - the ZZ last layer sets (OCLL, CP, EPLL, PLL).
- *Tao Yu's Alg Trainer* - the algorithm sets (F2L, OLL, PLL, ZBLL, COLL, ELL, CMLL) bundled in `public/algsets`; Tao Yu and the many people named in his spreadsheets (Justin Taylor, Jabari Nuruddin, Micki Kanaiya Harning, Feliks Zemdegs, Chad Batten, Jayden McNeill, ...).
- [rubiksplace.com](https://www.rubiksplace.com/speedcubing/F2L-algorithms/) - the built-in list of F2L insertion algorithms.
- npm packages in the build: rxjs, aes-js, three, comlink, fflate, lz-string, tslib, random-uint-below, meshoptimizer, tween.js and type packages (see `THIRD_PARTY_NOTICES.md`); [Vite](https://vitejs.dev) to build.

## Loop slider

*Loop* is a slider: `off`, `1`, `2`, `3` (that many moves, counted from the current one - meant for a cube without Bluetooth), `alg` (the current algorithm), `step` and `all`.
The line above the cubes highlights the move being played, also for step 0 and for the lists a smart cube shows; the solution list lights up only while the solution itself plays.

The line above the cubes is grouped and coloured like the solution list - one chip per part (setup, rotation, series, repair; Hedgeslammer in blue, Niklas in orange, ...);
turns to take back after a wrong move are a red chip in front.

The loop slider works the same with and without a smart cube (the remaining algorithm or the step 0 list is what it loops over). It starts at `off`, so a new
solution plays once; connecting a smart cube switches it to `3` (unless another loop was chosen).
Clicking an algorithm sets it to `alg`, a step to `step`, the outer border to `all`.

A half turn done as two quarter turns is not a mistake, in either direction: the cube sitting at the first quarter (`L` or `L'` for an expected `L2`) is shown as still on the path.
Only another move after that quarter turn counts as one (and then the quarter turn is part of what is taken back).

The cube never stops halfway through a turn. Pause goes back to the start of the move being played or on to its end, whichever is
nearer, and that move stays highlighted (Play then repeats it or continues with the next one); the progress bar moves in whole moves too.
At the end of a loop the animation holds on the loop's last move and then on its first, so the highlight never strays into the next
algorithm or step. Loops of 1-3 moves and previous/next algorithm or step count from the highlighted move.

The *speed* slider (¼× to 10×, remembered in the browser) sets the playback tempo; the one-rotation pauses around jumps and loops scale with it.
Moving the loop slider restarts the animation at the start of the new loop.

With partial F2L the text above the cubes names the pair an algorithm works on by its two colours: "F2L algorithm · inserts the green-red pair" (or "frees the ... pair" for the turns
that get a pair out of its slot first). Colours assume the usual scheme (white top, green front, red right).

## Optional U turns of the edge series

A top-layer turn at either end of an edge series (the `U'` of `U' L U L'`, the `U'` of `R U R' U'`) only turns the layer the series is not about, so it is optional: it cancels against a neighbouring
`U` turn (an aligning turn before it or after it, or the end of the previous series) instead of being done twice - `U2 | U' L U L' | U2` becomes `U | L U L' | U2`. What is left of the series is then a three-move
chip (`L U L'`). The cost of this is checked by the movecount coefficient like everything else.

## Two more options

- **Edge swaps at the open slot**: steps 3 and 4 use only edge series that are set up with turns of the top layer (`U`, `U'`, `U2`) - nothing else is turned, so the pairs/edges already placed
  stay in place and the series work at the open slot's location. (It costs a few moves; the tests check that no other face is turned there.)
- **Last 3 corners on the last layer**: step 4 ends only when all unsolved corners are in the top layer, instead of on any one side of the cube.

Both are remembered in the browser and re-solve on change.

## Rotations at the ends

Rotations before the first move of the solution (the `x2` of "Yellow on top from the start") are part of the setup - how the cube is held to begin with - and the player's setup alg and the Twizzle link include them.
Rotations after the last move are dropped: a solved cube can be put down any way up (the result still carries the rotation that would undo them, which the tests use).

## Install and offline (PWA)

The page has a web app manifest and icons, so browsers offer *Install as an app* (there is a link under the title when the browser allows it), and a service worker
(`sw.js`, written by `vite.config.js` at build time) that precaches every file of the build. After the first visit everything works without a network: the solver, the cubes,
the scrambler, every method and every bundled algorithm set (Bluetooth needs none). Icons: `public/icons/icon.svg` (source) and PNGs rendered from it.

Updates: the cache name is a hash of the contents of all files, so any change makes a new one. The page itself is loaded from the server whenever there is a
network (scripts, icons and algorithm sets come from the cache), so it always matches the scripts on the server; the install fetches past the browser's HTTP
cache, since GitHub Pages lets browsers keep files for 10 minutes and an old `index.html` stored next to new scripts would be a page whose scripts are gone.
When a new version takes over an open page, the page reloads at once if it was opened in the last 10 seconds and otherwise shows *New version: reload*.
As a last resort, a small script in `index.html` clears the offline cache and reloads once if the app has not started 15 seconds after loading (only online).

## Reading algorithm sets (Tao Yu's Alg Trainer)

`node scripts/import-algsets.mjs "<folder with the .xlsx files>" [output folder, default data/]` turns the spreadsheets - one technique per file (OLL, PLL, F2L, CLS,
COLL, ZBLL, CMLL, ...) - into JSON: `{ name, source, sheets: [{ sheet, cases: [{ index, name?, algs: [...] }] }] }` plus an `index.json`. It needs no dependencies
(an .xlsx is a zip of XML; the script reads it with `node:zlib`). The 53 files of the trainer give about 5000 cases and 8700 algorithms; every one parses with cubing.js.
The generated `data/` is not committed (it is someone else's collection).

## Methods, steps and presets

A *method* is a list of steps (the first is always a cross) plus options. The step library (`src/engine/presets.js`):

- **Cross**: shortest, or the beginner daisy + half turns.
- **Layer by layer** (beginner): first layer corners (`R U R' U'` repeated), second layer edges (`U R U' R' U' F' U F` and its mirror), yellow cross (`F R U R' U' F'`),
  yellow edges (Sune / anti-Sune), yellow corners: position (Niklas) and twist (`R' D' R D` repeated). Each is a small table of macros - turn the top layer into place, turn the cube
  if needed, the algorithm repeated n times - searched greedily like the series, and each step only protects what the steps before it finished.
- **Marshall**: the five steps of the Marshall method (3 center section edges / F2L pairs, top edges, last three edges, five corners, the end game).
- **CFOP**: F2L (all four pairs, by F2L algorithms; where they get stuck the beginner steps finish the two layers), OLL and PLL from the algorithm sets below (every algorithm of every case, with the top layer turned into place before it - after it too for PLL).
- **ZZ**: EOLine (a breadth-first table over edge orientation and the two line edges), the left and right 2x2x3 blocks (iterative deepening with pattern databases, only R, U and L turned so the edges stay oriented), then ZBLL - or COLL and ELL - from the algorithm sets.
- **Roux**: first block (1x2x3, any moves), second block (R, r, U, M), CMLL from the algorithm set, and the last six edges with M and U by a breadth-first table that also tracks how far the middle slice has been turned.
- **Anything left**: all remaining edges with the edge series, all remaining corners with Niklas - to finish a custom method.

Ready-made presets: CFOP, ZZ (ZBLL), ZZ (COLL + ELL), Roux, Marshall, Marshall with F2L pairs, Marshall with the beginner cross, Beginner (layer by layer), Layer by layer with the shortest cross, and Two layers then Marshall.
The *Method* box on the page selects one, shows its steps (reorder, remove, add) and lets you press **Save as…** to keep your own in the browser (`localStorage`, key `marshall-presets`; the method
you are working on is `marshall-method`). If a custom method's steps do not leave the cube solved the page says so. `npm test` runs the beginner presets too (every step must keep what the steps before it finished).

### Steps are data: a goal and an engine

Every step in `STEP_LIBRARY` is a **goal** (the state it reaches, `src/engine/goals.js`) and an **engine** that gets there. A goal lists pieces that
must be home, positions that must be oriented or hold their own corner, and stickers that must show their center's color, optionally "at least *n*
of these"; Marshall's step 4 and key position are named rules. Goals are in the solver's frame (white cross on D, yellow on U). The engines:

- **algorithms**: algorithms from a set or a list, with the top layer turned before and/or after them, optionally with the cube turned (`y`) and
  repeated, applied until the goal is reached (OLL, PLL, ZBLL, COLL, ELL, OCLL, CP, EPLL, CMLL and the beginner steps).
- **series**: Marshall's corner series with setup turns (yellow corners: position, all remaining corners).
- **block**: iterative deepening with a move set (ZZ's blocks with R U L, Roux's blocks).
- built-in engines for the steps that are searches or lookups of their own: the crosses, EOLine, LSE, the corner twist, CFOP's F2L and Marshall's steps.

What a step keeps is not written per step any more: it is whatever the steps before it reached (their pieces that are home, and the orientation,
placement and sticker conditions that held when the step started). The test checks every step's goal from its definition.

A method's step is an id, or `{ id, set }` when an algorithm set was picked for it: every step that uses algorithms has its own set drop-down in the
step list (a kind's last choice is the default for new steps), and the page sends each step's algorithms with the solve request. Each step in the
list shows its goal on a small cube net.

**Your own steps**: *Add a step… → New step…* opens the step editor: a name, the goal painted on a cube net (with shortcuts: white cross, first two
layers, yellow top face, whole cube), the algorithms (a set, or your own list, one per line) and what may surround each algorithm (top layer turned
before / after, cube turned, repeated up to n times). Steps are kept in the browser (`marshall-steps`), can be edited (✎) and deleted, and work in any
method like the built-in ones. `npm test` solves with two of them (`node scripts/test.mjs 10 custom`): one from a list ("yellow edges up") and one
from a set ("my PLL", goal: the whole cube).

## Methods & algorithms box and algorithm sets

All method and algorithm settings sit in the collapsed *Methods & algorithms* box under the scramble: the method (preset, steps, save/delete), the options and the algorithm sets.
The **OLL** and **PLL** steps use a set each. Bundled: `public/algsets/oll.json` and `pll.json`, made from *Tao Yu's Alg Trainer* with `scripts/import-algsets.mjs`
(F2L 41 cases, OLL 57 / 227 algorithms, PLL 21 / 58, ZBLL 472, COLL 40, ELL 25, CMLL 42; credit to Tao Yu and the people named in his files). *Import a set…* adds more as `.json` files from the same script
(kept in the browser; any set can then be picked for any step that uses algorithms). The effect of each algorithm on the pieces is computed by cubing.js, so wide moves (`r`), slices (`M`) and
rotations that cancel (`x' ... x`) work; algorithms that would leave the cube turned are skipped. The importer treats a single letter like `E` as a name when its row holds other names.

### The page follows the method

*How it works* lists the steps of the method in use, one sentence each (`explain` in `STEP_LIBRARY`). Options that only change some steps
(F2L pairs, edge swaps at the open slot, last 3 corners on the last layer; `OPTION_STEPS`) are shown only when the method has one of those steps, and
only the steps that use algorithms have a set drop-down. The legend above the solution lists the kinds of moves the solution contains.

If a method cannot solve a scramble, the message names the step that got stuck and what that step needs first (`needs` in
`STEP_LIBRARY`), for example "Step 2 (Last six edges) could not be finished … It needs both blocks and the top corners (CMLL) first."
Two other messages cover a method whose steps stop before the cube is solved and a step without an algorithm set.
`npm test` checks all three (`node scripts/test.mjs 0 errors`).

### F2L from the algorithm set

The F2L step (CFOP's four pairs, and Marshall's three with the F2L option) now uses the bundled F2L set first: every algorithm of every case, for every slot (the cube is turned with `y`
before it), with the top layer turned into place first. It replaced the built-in insertion list as the first choice: in 60 random scrambles the set alone always finished the four pairs, in about
30 moves on average, where the built-in list got stuck on the last pair in about a third of the cases and the beginner steps that took over needed about 49 moves.

### More algorithm sets (Cubedex, zz-method-docs)

`node scripts/import-extra-algs.mjs <cubedex folder> <zz-method-docs algs folder>` converts two more collections into the same JSON (and adds them to `public/algsets/index.json`):
**Cubedex** (Pau Oliva Fora, MIT; `src/data/defaultAlgs.json`) - PLL (21 cases), 2-look PLL, OLL (57), 2-look OLL, F2L (164 slot-specific cases), COLL, CMLL, ZBLL (472) - and
**zz-method-docs** (crystalcuber, MIT; cubingmethods branch) - OCLL (7), CP (2), EPLL (4) and PLL (21). Every step has a drop-down in *Methods & algorithms* listing the sets of its kind,
so e.g. the CFOP preset can use Cubedex's OLL and PLL instead of Tao Yu's. New steps and presets use the ZZ sets: **OCLL**, **Corner permutation** and **EPLL** (ZZ with OCLL, CP, EPLL: 13 algorithms,
about 61 moves) and ZZ with OCLL followed by a PLL (about 50 moves). A few algorithms of a set may be skipped when they would leave the cube turned (4 of Cubedex's 21 PLL cases have only such
algorithms; the others cover the rest).

## Wording

A solution has steps, a step has algorithms and an algorithm has moves. Marshall's Edge Series and Corner Series keep their
names, since they are the algorithms of his method. Labels and buttons use sentence case, and solution steps carry the names from the
step library (`STEP_LIBRARY` labels). Spelling is American ("center", "color"). Page text uses no dashes as punctuation: a colon,
a full stop, a comma or brackets instead.
