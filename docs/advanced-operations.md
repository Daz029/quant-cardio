# Advanced operations: percentages, roots, logs

## Problem

The drill only does integer arithmetic. The curriculum's magnitude and approximation work —
fraction/percentage conversion, roots, logs — has no home, and none of it fits the existing
grader, which demands an exact integer match.

## Approach

Five more operations behind a collapsed **Advanced** disclosure on the home screen, all off by
default, each with the same share the basic four have plus a **leniency**: an **absolute** slack on
the reference answer, in the units of the answer itself. The generator computes the mathematically
correct answer and the grader accepts anything within the leniency of it, which is what makes an
approximation drill gradeable at all.

Absolute, not proportional. A proportional tolerance scales its own band with the answer, so a
large answer silently accepts entries nowhere near it: `e^3.91` is `49.9`, and a `0.5` read as a
proportion accepted everything from `25` to `75`. Absolute slack keeps the band the same width
wherever the answer lands, which is also how a runner thinks about being close.

Rejected: a second grading mode selected per problem type (one-significant-digit, order of
magnitude, probability range). A single absolute slack covers every one of these five and is one
number the runner can turn. The richer modes belong to the categories that actually need them —
probability ballparking, Fermi estimates — which are not in this round.

## Implementation

### 1. Operations

| Operation | Prompt | Answer | Ranges |
| --- | --- | --- | --- |
| `fraction` | `7/16` stacked, `as %` beside it | `43.75` | numerator, denominator |
| `percent` | `43.75% of 16` | `7` | reversed — reads fraction's ranges |
| `root` | `√361`, `³√729`, under a vinculum | `19`, `9` | degree n, radicand x |
| `ln` | `ln 50` | `3.912…` | x |
| `exp` | `e` with a raised `3.91` | `49.899…` | reversed — reads ln's range |

- **The numerator is drawn strictly under the denominator**, so a conversion is always a proper
  fraction and a percentage never reaches 100. The denominator goes first, floored one above the
  numerator's minimum where its own range reaches that far; where it doesn't (a numerator range
  sitting entirely above the denominator range) the denominator's range wins and the numerator
  drops to whatever still fits beneath it. A denominator range pinned to `1` leaves nothing under
  it at all, so the numerator bottoms out at `0` — a `0%` problem, which is answerable, rather
  than an improper one.
- `percent` is the reverse of `fraction` the way division is the reverse of multiplication. A
  percentage on its own has no number to type back, so the denominator is shown with it and the
  numerator is what comes out. The percentage is displayed to one decimal, or two below 10% where
  one would round away more than a tight leniency allows; the answer graded against is the
  numerator it was built from.
- `exp` draws its exponent as `ln x` for an `x` from ln's range, rounded to two decimals. The
  reference answer is recomputed from the *rounded* exponent, so it answers the question on screen
  rather than the `x` behind it.
- `root` renders the degree as a superscript, and omits it for square roots.
- Every advanced operation carries its own share and its own leniency. Shares are normalised over
  the enabled set exactly as before, so the new operations join the same draw.

### 2. Grading

- `Problem` gains `tolerance`, an absolute slack carried on the problem itself: `0` means exact
  (every basic operation), `0.2` accepts anything within `0.2` of the answer. The grader never has
  to know which operation produced what it is marking.
- `Problem` may also carry an **`alternate`** — a second way of writing the same answer, accepted
  alongside the first, with its own tolerance. Only `fraction` uses it: `8/18` can be answered
  `44.4` or `0.444`, because a runner who thinks in proportions shouldn't have to convert. The
  slack scales with the units, so the proportion's band is a hundredth of the percentage's: the
  leniency is read in percentage points, and `0.1` of one of those is `0.001` of a proportion. The
  two bands are a factor of a hundred apart and cannot overlap, so neither form can be credited
  against the other.
- Each form divides once rather than deriving one from the other: `100 * (n / d)` rounds twice and
  drifts in the last bits against `(100 * n) / d`.
- An empty or half-typed entry (`''`, `'.'`) is wrong rather than `0`, so a bare submit cannot be
  credited against an answer that happens to be zero.
- Leniency has **no ceiling** — a slack of `5` is a legitimate setting for an answer measured in
  tens — and only a negative one is malformed. It is the operation, not the grader, that knows
  whether a given number is tight or loose.

### 3. Entry

- A decimal key appears on the keypad whenever the config has any advanced operation enabled —
  decided from the config, not from the problem on screen, so the geometry holds for the whole run.
- It takes the check key's corner; the check key widens onto a full-width row of its own. The
  digits, `0` and backspace do not move. A basic-only run keeps the original twelve-key pad.
- A leading `.` is written as `0.`, and a second `.` is ignored.
- `.` and `,` on a hardware keyboard both type the decimal point.
- **Auto-submit at full digits fires at the place the leniency is written to.** A leniency of
  `0.05` reaches the hundredths, so an entry submits itself the moment it has two decimals —
  `3.91`. There is no digit count to wait for otherwise: `ln 50` is `3.912023005428146`. A leniency
  of `1` names no decimal place at all and falls back to the digit count of the answer rounded to
  whole numbers.
- On a problem with an `alternate`, a leading `0.` is read as the proportion being typed rather
  than the percentage, and the place rule switches to that form's tolerance — two places further
  out. Only ambiguous when the percentage is itself below `1`, which takes a denominator above
  `100` to arrange; the grader still accepts both forms there, so only the auto-submit timing is
  affected.

### 4. Feedback

Answering an approximated problem leaves `exact 3.912` **below the keypad, under the check key**,
until the first key of the next problem. It belongs after the answer, not between the answer bar
and the keys, which is where the eye is while typing. Without it a tolerance-graded drill teaches
nothing about where the runner actually landed.

### 5. Prompt typography

Prompts are no longer strings — the generator emits a shape (`plain`, `fraction`, `root`, `power`)
and the question renders it:

- a fraction is set **flat**, with a leaning solidus between the two halves rather than stacked or
  offset. Both earlier attempts put the numerator above the denominator — a full stack, then an
  overlapping diagonal — and both made the fraction taller than every other prompt for no reading
  benefit. Flat, it is exactly one line, reads left to right at a glance, and its rows in the
  review list match the others' height. The tight `0.78` line-height puts the digit boxes at about
  cap height, so centring them against the stroke is an optical centring rather than a line-box
  one, and the stroke stands slightly above and below the digits the way a solidus should;
- a root **draws its own hook** as an inline SVG rather than setting the font's `√`. A glyph ends
  wherever its designer put it, which left the vinculum floating unattached above and to the right
  of the arm. The path finishes in a horizontal stub, flush with the SVG's right edge and exactly
  as thick as the radicand's rule, and `align-items: flex-start` puts the SVG's `y=0` and the
  radicand's border on one line — so the two meet seamlessly in any font. The viewBox is 60×100 in
  a 0.6em×1em box, so a user unit is 0.01em in both axes and the hook holds its shape at every type
  size. The degree tucks into the crook. The radicand's tight line-height pulls the digits up under
  the rule, which an inline box's full-ascent height would otherwise leave a gap below;
- a power raises its exponent, and the solidus, the vinculum and the radical's arm are all drawn at
  the same `0.055em`, so every rule in the notation came from one pen.

The type scale is capped at **60px**, down from 84px. Size is still `150cqw / character` for long
prompts, but short ones like `ln 49` were being set half again as large as `1176 ÷ 12`, and type
that jumps size between problems is type you have to refocus on. Each shape reports its own
character width.

**The question box is a fixed height and its content sits on the floor of it.** A prompt taller
than one line grows *upward* into empty space instead of pushing the answer bar down — the earlier
layout split the difference between two `auto` margins, so a fraction moved the bar down by half
its extra height and moved it back on the next problem. That meant the box's height could not be
allowed to depend on the prompt, so the size lives in two places now: `.question` holds a fixed
`clamp(44px, 14vw, 60px)` and a `1.5em` height, and `.question-fit` inside it carries the
per-prompt `min(1em, 150cqw / character)` shrink. Measured across all four prompt kinds with the
keypad held constant, the answer bar and keypad sit at the same pixel every time.

### 6. Question review

The run records every answered problem — prompt, what was typed, the reference answer, and the
verdict — and the results screen puts them behind a **See questions** disclosure, collapsed, with
the count beside the label.

- **Misses first, then the ones you got** — they are the reason to open the list at all. Sorted at
  render rather than on the way in, so the history itself stays in the order the run happened, and
  `sort`'s stability keeps each group chronological within itself.
- The entry is coloured: `--correct` when it was accepted, `--wrong` when it wasn't, with the
  reference answer beside it in muted text on the misses only. Colour alone carries the verdict —
  a rule struck through a single digit at that size is indistinguishable from a dash.
- The prompt is stored whole, not flattened to a string, so the list draws the same stacked
  fraction, vinculum and raised exponent the question did. Every measurement in those shapes is in
  `em`, so `PromptBody` serves the question at 60px and the review row at 17px unchanged.
- The list scrolls inside a `42dvh` box rather than growing the page, so **Play again** stays in
  thumb reach after a long run.
- A run with nothing answered doesn't render the control at all.
- The entry is passed into `advance` rather than read from state: auto-submit calls it with the
  digit just pressed, which the answer state does not hold until the next render.

### 7. Config screen

- The five rows live behind an **Advanced** disclosure, collapsed by default. It opens on load if a
  URL arrives with any of them enabled, and shows a `n on` count when collapsed — enabled config
  that is out of sight is the one thing this must not hide.
- New URL params: `fracN`, `fracD`, `rootN`, `rootX`, `lnX` for the ranges, `tol` for the five
  leniencies positionally, and `frac`, `pct`, `root`, `ln`, `exp` in `ops`. `w` is now nine long.
- A positional list *shorter* than its key list now fills the missing tail from defaults instead of
  reverting as a whole — that shape is exactly what a URL written before these operations existed
  looks like, and discarding four good weights over four absent ones would be worse. Malformed
  entries still revert the whole set.

## Sequencing

Landed together. Generation and grading are the load-bearing half and were exercised against a
throwaway node harness (4,000 draws per operation, range/prompt/answer invariants, grader edges,
URL round trip, old-URL migration); the keypad and disclosure are visual.

## Out of scope

- Every other curriculum category — probability, microstructure, complexity, statistical
  identities.
- Grading modes other than absolute slack (one-significant-digit, order of magnitude,
  probability range, multiple choice).
- Negative answers, and therefore a sign key. Every range floors at 1, so no advanced operation
  can produce one.
- Per-problem tolerance display on the config screen (what `0.05` means for `ln 50` in absolute
  terms).

## Risks accepted

- **Auto-submit at full digits asks for trailing zeros on a round answer.** `√400` at a leniency of
  `0.05` fires at `20.00`, not at `20` — the rule counts decimal places, not value. The check key
  is always there for the shorter path.
- **Auto-submit on correct answer can fire early on an approximated answer.** Typing `2` on the way
  to `2.05` is already inside a `0.2` band around `2` and advances. It is a correct answer by the
  rule the drill is graded on, so it is allowed to count.
- **An absolute slack has to be set per operation to mean anything.** `0.2` is a sensible band on a
  log and a strict one on a percentage that runs to 100; `5` is loose on a numerator drawn from
  `1..12`. Nothing warns about a badly-scaled setting — the leniency box is the only place the
  scale is decided.
- **`percent` is a reverse of the fraction conversion, not a percent→fraction conversion.** Typing
  a fraction back is not something the keypad can express.
- **A slack near zero is unfair rather than hard.** `ln 50` graded at `0.001` wants `3.912`.
  Nothing stops that config; the floor is only that leniency cannot be negative.

## Acceptance criteria

- [x] With only advanced operations enabled, every prompt comes from one of the five and every
      answer is inside the configured ranges.
- [x] The basic four are still graded exactly and still produce integer answers.
- [x] An answer within the leniency is correct; one outside it is wrong.
- [x] A fraction conversion accepts both `44.4` and `0.444`, each within its own band, and rejects
      a miss in either form. No other operation carries a second form.
- [x] The band does not widen with the answer: `e^3.91` at a slack of `0.5` accepts `49.9` and
      `50.3`, and rejects `25`, `51` and `75`.
- [x] A leniency above `1` survives a URL round trip instead of reverting the whole set.
- [x] The displayed percentage in a `percent` problem, applied to the displayed denominator, is
      always inside the leniency of the graded answer.
- [x] An `exp` problem's answer is exactly `e` to the exponent shown, not the `x` it was drawn
      from.
- [x] No fraction conversion is improper: the numerator is strictly below the denominator in
      either direction of the conversion, including when the two configured ranges cannot overlap
      and when the denominator range is pinned to `1`.
- [x] A finished run lists every answered problem with its entry, and the entry is green when it
      was accepted and red when it wasn't. *(visual — 9 answered, 2 green, stats agree at 2 of 9)*
- [x] Every missed question precedes every correct one in the list. *(asserted against the rendered
      DOM: `wrong wrong wrong wrong wrong wrong wrong wrong right`)*
- [x] The leniency's decimal place is counted correctly for `0.05`, `0.1`, `0.25`, `0.005`, `1`
      and `1e-7`.
- [x] A URL written before this change keeps its four weights, its ranges and its duration, and
      leaves every advanced operation off.
- [x] Settings survive a write/read round trip through the URL unchanged.
- [x] The decimal key is absent from a basic-only run and present in an advanced one. *(visual)*
- [x] The vinculum meets the radical and sits on the radicand; the fraction's suffix centres on
      the stack; the exponent is raised. *(visual)*
- [x] The exact value appears below the keypad, under the check key. *(visual)*
- [ ] The Advanced list is collapsed on a first visit and open when the URL enables any of it.
      *(visual)*
