# Advanced operations: percentages, roots, logs

## Problem

The drill only does integer arithmetic. The curriculum's magnitude and approximation work —
fraction/percentage conversion, roots, logs — has no home, and none of it fits the existing
grader, which demands an exact integer match.

## Approach

Five more operations behind a collapsed **Advanced** disclosure on the home screen, all off by
default, each with the same share the basic four have plus a **leniency**: a relative tolerance on
the reference answer, default `0.05`. The generator computes the mathematically correct answer and
the grader accepts anything within the leniency of it, which is what makes an approximation drill
gradeable at all.

Rejected: a second grading mode selected per problem type (one-significant-digit, order of
magnitude, probability range). A single relative tolerance covers every one of these five and is
one number the runner can turn. The richer modes belong to the categories that actually need them
— probability ballparking, Fermi estimates — which are not in this round.

## Implementation

### 1. Operations

| Operation | Prompt | Answer | Ranges |
| --- | --- | --- | --- |
| `fraction` | `7/16 as %` | `43.75` | numerator, denominator |
| `percent` | `43.75% of 16` | `7` | reversed — reads fraction's ranges |
| `root` | `√361`, `³√729` | `19`, `9` | degree n, radicand x |
| `ln` | `ln 50` | `3.912…` | x |
| `exp` | `e^3.91` | `49.899…` | reversed — reads ln's range |

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

- `Problem` gains `tolerance`, a relative tolerance carried on the problem itself: `0` means exact
  (every basic operation), `0.05` accepts anything within 5% of the answer. The grader never has
  to know which operation produced what it is marking.
- An empty or half-typed entry (`''`, `'.'`) is wrong rather than `0`, so a bare submit cannot be
  credited against an answer that happens to be zero.
- Leniency is capped at `1` on entry and in the URL: a relative tolerance of 1 already accepts
  everything from zero to double the answer.

### 3. Entry

- A decimal key appears on the keypad whenever the config has any advanced operation enabled —
  decided from the config, not from the problem on screen, so the geometry holds for the whole run.
- It takes the check key's corner; the check key widens onto a full-width row of its own. The
  digits, `0` and backspace do not move.
- A leading `.` is written as `0.`, and a second `.` is ignored.
- `.` and `,` on a hardware keyboard both type the decimal point.

### 4. Feedback

Answering an approximated problem leaves `exact 3.912` under the answer bar until the first key of
the next problem. Without it a tolerance-graded drill teaches nothing about where the runner
actually landed.

### 5. Config screen

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
- Grading modes other than relative tolerance (one-significant-digit, order of magnitude,
  probability range, multiple choice).
- Negative answers, and therefore a sign key. Every range floors at 1, so no advanced operation
  can produce one.
- Per-problem tolerance display on the config screen (what `0.05` means for `ln 50` in absolute
  terms).

## Risks accepted

- **Auto-submit at full digits does not apply to advanced problems.** The digit count of
  `3.912023005428146` is not a cue for anything, so those problems wait for the check key even in
  that mode. The config screen says so when the combination is selected.
- **Auto-submit on correct answer can fire early on an approximated answer.** Typing `2` on the way
  to `2.05` matches a 5% tolerance around `2` and advances. It is a correct answer by the rule the
  drill is graded on, so it is allowed to count.
- **`percent` is a reverse of the fraction conversion, not a percent→fraction conversion.** Typing
  a fraction back is not something the keypad can express.
- **A relative tolerance near zero is unfair rather than hard.** `ln 50` graded at `0.001` wants
  `3.912`. Nothing stops that config; the floor is only that leniency cannot be negative.

## Acceptance criteria

- [x] With only advanced operations enabled, every prompt comes from one of the five and every
      answer is inside the configured ranges.
- [x] The basic four are still graded exactly and still produce integer answers.
- [x] An answer within the leniency is correct; one outside it is wrong.
- [x] The displayed percentage in a `percent` problem, applied to the displayed denominator, is
      always inside the leniency of the graded answer.
- [x] An `exp` problem's answer is exactly `e` to the exponent shown, not the `x` it was drawn
      from.
- [x] A URL written before this change keeps its four weights, its ranges and its duration, and
      leaves every advanced operation off.
- [x] Settings survive a write/read round trip through the URL unchanged.
- [ ] The decimal key is absent from a basic-only run and present in an advanced one. *(visual)*
- [ ] The Advanced list is collapsed on a first visit and open when the URL enables any of it.
      *(visual)*
