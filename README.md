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
