# Zetamac-style arithmetic speed drill

## Problem

There's no working drill yet — the repo is still the Vite starter. The first attempt at a
weighted category/difficulty-bin generator collapsed under its own design (an unfillable `hard`
bin, a `medium` bin spanning `4 × 30` to `483 × 67`), because it tried to build an adaptive
ladder before a single drill existed.

## Approach

Copy Zetamac's model: difficulty *is* the numeric range, chosen explicitly by the player. No
categories, no difficulty bins, no adaptation. Config screen → timed game → results screen.

Rejected: the weighted-category generator with easy/med/hard proportions and a seed. Shelved
entirely, not deferred into this design. When difficulty bins come back, they get bespoke
samplers per quiz that shuffle into the problem stream — not a general-purpose weighted
generator.

## Implementation

### 1. Config screen

- Four operations, each independently toggleable: addition, subtraction, multiplication,
  division.
- Addition takes two operand ranges. Default `(2..100) + (2..100)`.
- Multiplication takes two operand ranges. Default `(2..12) × (2..100)`.
- Subtraction and division take **no ranges of their own** — they derive from addition and
  multiplication respectively.
- Each operation carries a share, default `0.25`. Shares are relative weights, not a partition —
  they are normalised across the enabled operations at draw time, so disabling one redistributes
  its share rather than leaving a gap.
- Submission options: an auto-submit toggle, default off. When on, a method dropdown appears —
  `on correct answer` (default) or `at full digits`.
- Duration in seconds. Default `120`.

### 2. Problem generation

- Addition: draw `a`, `b` from their ranges, present `a + b`.
- Subtraction: draw an addition problem `a + b`, present the reverse. Answer is always
  non-negative and always inside the addition range.
- Multiplication: draw `a`, `b` from their ranges, present `a × b`.
- Division: draw a multiplication problem `a × b`, present the reverse. Quotient is always a
  clean integer.
- Operand range bounds floor at `1`, enforced at config entry. Generation can assume every operand
  is a positive integer, so the division reverse is never a divide-by-zero.
- Interface: given the config, produce one problem plus its answer. Per-problem, not a
  pre-generated batch.

### 3. Game screen

- One problem at a time. Answer entry is a **bar** — free-width, not fixed place-value slots, so
  the answer's digit count is never revealed.
- **Submit-based by default.** Wrong answers are possible and are recorded. Auto-submit is opt-in
  and changes this:
  - `on correct answer` — advances the instant the entry matches, Zetamac-style. Nothing advances
    on a wrong entry, including the check key, which would otherwise be a skip button. Every
    problem therefore ends correct, so the results screen's percentage is always 100 in this mode
    and only the count and the pace carry information.
  - `at full digits` — advances as soon as the entry is as long as the answer, right or wrong.
    Contradicts acceptance criterion 7: advancing at the right length tells the player how many
    digits the answer has. Chosen deliberately.
- Wrong submit → **advance to a new problem**, counted in total, not counted correct. No re-arm,
  so every problem contributes exactly 1 to total.
- Two counters: total answered, total correct.
- Visible countdown timer.

### 4. Results screen

Percent correct, total correct, total answered, answered-per-minute.

## Sequencing

Generation (2) is independently testable and lands first. Config (1) and game (3) can land
together with hardcoded config if that's faster. Results (4) last.

## Out of scope

- Adaptive difficulty of any kind, between-run or within-run.
- Category weighting and difficulty proportions.
- Seeded generation. (It was only ever a nice-to-have for tests, and it belongs to the shelved
  design.)
- Every curriculum category except integer arithmetic — no probability, magnitude,
  microstructure, complexity.
- Audio mode.

## Risks accepted

- **Wide difficulty spread inside a single config is the player's problem, by design.** `2 × 3`
  and `12 × 97` both come out of the default multiplication range. That's Zetamac's bargain and
  it's fine here precisely because nothing downstream is reading completion speed to infer skill.
- **No verification of the output distribution.** Called not worth it. Consequence on record:
  nothing checks that operands actually cover their ranges, so an off-by-one at a range boundary
  or a systematically skewed draw would ship silently.

## Decided during implementation

- **Op selection when several are enabled.** Weighted by each operation's share, normalised over
  the enabled set, drawn per problem. A share of `0` means the operation never appears; all
  enabled shares at `0` falls back to an even mix rather than failing to draw.
- **Which operand becomes the divisor / subtrahend.** Both reverses remove the *left* operand, so
  the answer is always the right one. With multiplication defaults that means dividing by the
  small `(2..12)` factor: `1176 ÷ 12 = 98`. The opposite choice would make division an estimation
  drill rather than a long-division one.
- **When the clock starts** — on first render of the first problem. The deadline is fixed at that
  moment and remaining time is recomputed from it, so a slow tick or a backgrounded tab can't
  stretch the round.
- **Pace is reported as seconds per problem, to one decimal**, not answered-per-minute. Supersedes
  the per-minute half of acceptance criterion 6.
- **Config survives a reload via URL params**, Zetamac-style — read once at mount, rewritten with
  `replaceState` whenever settings change. Shape:
  `?ops=add,sub,mul,div&w=0.25,0.25,0.25,0.25&addL=2-100&addR=2-100&mulL=2-12&mulR=2-100`
  `&auto=0&mode=correct&sec=60`.
  `w` is positional in add/sub/mul/div order and reverts as a whole set if any entry is
  malformed — a half-parsed mix of URL and default weights would be worse than either. Every other
  field falls back
  to its default independently when missing or malformed, so a hand-edited URL degrades rather
  than breaking. `sec` must be one of the offered durations; ranges must satisfy the same `min ≥ 1`
  floor the config screen enforces; an empty `ops` reverts to all four.

## Acceptance criteria

- [ ] With only subtraction enabled, no presented problem has a negative answer.
- [ ] With only division enabled, every presented problem has an integer answer.
- [ ] Disabling an operation means it never appears.
- [ ] A wrong answer advances to a different problem and increments total but not correct.
- [ ] The problem on screen when the timer expires appears in neither counter.
- [ ] Results screen totals are internally consistent: correct ≤ total, percent = correct/total,
      per-minute = total ÷ (duration/60).
- [ ] The answer bar does not indicate how many digits the answer has.
