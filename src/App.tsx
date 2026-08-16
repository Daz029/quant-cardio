import React, { useEffect, useRef, useState } from 'react'

const HOLD_TO_CLEAR_MS = 500
const MAX_LENGTH = 10

type Theme = 'light' | 'dark'

type Operation =
  | 'addition'
  | 'subtraction'
  | 'multiplication'
  | 'division'
  | 'fraction'
  | 'percent'
  | 'root'
  | 'ln'
  | 'exp'
type Bound = 'min' | 'max'

/* Only these carry a pair of ranges; the reversed operations read their
   partner's, and ln takes a single range. Narrowing here is what lets
   settings[operation] typecheck inside the nested update, rather than needing
   a cast. */
type PairedOperation = Extract<
  Operation,
  'addition' | 'multiplication' | 'fraction' | 'root'
>

/* The advanced set, and also exactly the set graded against a tolerance rather
   than an exact match — every one of them has an answer a runner is meant to
   approximate, so the two ideas stay one list. */
type AdvancedOperation = Extract<
  Operation,
  'fraction' | 'percent' | 'root' | 'ln' | 'exp'
>

type Range = { min: number; max: number }
type OperandRanges = { left: Range; right: Range }

/* 'correct' advances only once the entry matches, so a problem can't be left
   behind; 'digits' advances as soon as the entry is as long as the answer,
   right or wrong. */
type SubmitMode = 'correct' | 'digits'

type Settings = {
  operations: Record<Operation, boolean>
  /* Relative shares, not required to sum to 1 — they are normalised across
     whatever is enabled at draw time. Equal values mean an even mix, so the
     0.25 default reads as a quarter each while still tolerating any edit. */
  weights: Record<Operation, number>
  /* Relative tolerance on the reference answer: 0.05 accepts anything within
     5% of it. Per-operation, because the mental precision a root deserves is
     not the one a percentage deserves. */
  leniency: Record<AdvancedOperation, number>
  addition: OperandRanges
  multiplication: OperandRanges
  /* left is the numerator, right the denominator. */
  fraction: OperandRanges
  /* left is the degree n, right the radicand x. */
  root: OperandRanges
  /* ln takes one range — the x it is asked about. */
  ln: Range
  autoSubmit: boolean
  submitMode: SubmitMode
  durationSeconds: number
}

const DEFAULT_SETTINGS: Settings = {
  operations: {
    addition: true,
    subtraction: true,
    multiplication: true,
    division: true,
    fraction: false,
    percent: false,
    root: false,
    ln: false,
    exp: false,
  },
  weights: {
    addition: 0.25,
    subtraction: 0.25,
    multiplication: 0.25,
    division: 0.25,
    fraction: 0.25,
    percent: 0.25,
    root: 0.25,
    ln: 0.25,
    exp: 0.25,
  },
  leniency: {
    fraction: 0.05,
    percent: 0.05,
    root: 0.05,
    ln: 0.05,
    exp: 0.05,
  },
  addition: {
    left: { min: 2, max: 100 },
    right: { min: 2, max: 100 },
  },
  multiplication: {
    left: { min: 2, max: 12 },
    right: { min: 2, max: 100 },
  },
  fraction: {
    left: { min: 1, max: 12 },
    right: { min: 2, max: 20 },
  },
  root: {
    left: { min: 2, max: 3 },
    right: { min: 4, max: 400 },
  },
  ln: { min: 2, max: 100 },
  autoSubmit: false,
  submitMode: 'correct',
  durationSeconds: 60,
}

const BASIC_OPERATIONS: Operation[] = [
  'addition',
  'subtraction',
  'multiplication',
  'division',
]

const ADVANCED_OPERATIONS: AdvancedOperation[] = [
  'fraction',
  'percent',
  'root',
  'ln',
  'exp',
]

/* Appended rather than interleaved, so the positional weight list in an older
   URL still lines up with the four it was written for. */
const OPERATIONS: Operation[] = [...BASIC_OPERATIONS, ...ADVANCED_OPERATIONS]

const DURATIONS = [30, 60, 120, 300]

/* Config lives in the query string, Zetamac-style, so a run is shareable and
   survives a reload. Anything missing or malformed falls back to its default
   rather than failing — a hand-edited URL should degrade, not break. */
const OPERATION_PARAMS: Record<Operation, string> = {
  addition: 'add',
  subtraction: 'sub',
  multiplication: 'mul',
  division: 'div',
  fraction: 'frac',
  percent: 'pct',
  root: 'root',
  ln: 'ln',
  exp: 'exp',
}

function parseRange(raw: string | null, fallback: Range): Range {
  const match = raw === null ? null : /^(\d+)-(\d+)$/.exec(raw)
  if (match === null) {
    return fallback
  }
  const min = Number(match[1])
  const max = Number(match[2])
  /* Same floor the config screen enforces, so a URL can't smuggle in a zero
     operand and turn the division reverse into a divide-by-zero. */
  if (min < 1 || max < min) {
    return fallback
  }
  return { min, max }
}

function parseOperations(raw: string | null): Record<Operation, boolean> {
  if (raw === null) {
    return DEFAULT_SETTINGS.operations
  }
  const listed = raw.split(',')
  const operations = { ...DEFAULT_SETTINGS.operations }
  for (const operation of OPERATIONS) {
    operations[operation] = listed.includes(OPERATION_PARAMS[operation])
  }
  /* An empty set is a dead config — Start would never enable. */
  return OPERATIONS.some((operation) => operations[operation]) ?
    operations :
    DEFAULT_SETTINGS.operations
}

/* Positional, in `keys` order, so it reads against the ops list beside it. Any
   malformed entry drops the whole set back to defaults rather than leaving a
   half-parsed mix. A short list is the one exception: it is what a URL written
   before an operation existed looks like, so its missing tail defaults
   individually instead of discarding the values that are there. */
function parseShares<Key extends string>(
  raw: string | null,
  keys: Key[],
  fallback: Record<Key, number>,
  ceiling: number,
): Record<Key, number> {
  const listed = raw === null ? [] : raw.split(',')
  if (listed.length === 0 || listed.length > keys.length) {
    return fallback
  }

  const shares = { ...fallback }
  for (const [index, key] of keys.entries()) {
    if (index >= listed.length) {
      break
    }
    const parsed = Number(listed[index])
    if (
      listed[index].trim() === '' ||
      !Number.isFinite(parsed) ||
      parsed < 0 ||
      parsed > ceiling
    ) {
      return fallback
    }
    shares[key] = parsed
  }
  return shares
}

function parseSubmitMode(raw: string | null): SubmitMode {
  if (raw === 'correct' || raw === 'digits') {
    return raw
  }
  return DEFAULT_SETTINGS.submitMode
}

function readSettings(search: string): Settings {
  const params = new URLSearchParams(search)
  const seconds = Number(params.get('sec'))
  const auto = params.get('auto')

  return {
    operations: parseOperations(params.get('ops')),
    weights: parseShares(
      params.get('w'),
      OPERATIONS,
      DEFAULT_SETTINGS.weights,
      Number.POSITIVE_INFINITY,
    ),
    /* A relative tolerance above 1 would accept every entry of the right sign,
       so it is treated as malformed rather than clamped. */
    leniency: parseShares(
      params.get('tol'),
      ADVANCED_OPERATIONS,
      DEFAULT_SETTINGS.leniency,
      1,
    ),
    addition: {
      left: parseRange(params.get('addL'), DEFAULT_SETTINGS.addition.left),
      right: parseRange(params.get('addR'), DEFAULT_SETTINGS.addition.right),
    },
    multiplication: {
      left: parseRange(params.get('mulL'), DEFAULT_SETTINGS.multiplication.left),
      right: parseRange(params.get('mulR'), DEFAULT_SETTINGS.multiplication.right),
    },
    fraction: {
      left: parseRange(params.get('fracN'), DEFAULT_SETTINGS.fraction.left),
      right: parseRange(params.get('fracD'), DEFAULT_SETTINGS.fraction.right),
    },
    root: {
      left: parseRange(params.get('rootN'), DEFAULT_SETTINGS.root.left),
      right: parseRange(params.get('rootX'), DEFAULT_SETTINGS.root.right),
    },
    ln: parseRange(params.get('lnX'), DEFAULT_SETTINGS.ln),
    autoSubmit: auto === null ? DEFAULT_SETTINGS.autoSubmit : auto === '1',
    submitMode: parseSubmitMode(params.get('mode')),
    durationSeconds: DURATIONS.includes(seconds) ?
      seconds :
      DEFAULT_SETTINGS.durationSeconds,
  }
}

function writeSettings(settings: Settings): string {
  const enabled = OPERATIONS
    .filter((operation) => settings.operations[operation])
    .map((operation) => OPERATION_PARAMS[operation])

  const range = ({ min, max }: Range) => `${min}-${max}`

  /* Built by hand rather than through URLSearchParams, which percent-encodes
     the commas in ops. Every value here is digits, dots, dashes and commas. */
  return '?' + [
    `ops=${enabled.join(',')}`,
    `w=${OPERATIONS.map((operation) => settings.weights[operation]).join(',')}`,
    `tol=${ADVANCED_OPERATIONS
      .map((operation) => settings.leniency[operation])
      .join(',')}`,
    `addL=${range(settings.addition.left)}`,
    `addR=${range(settings.addition.right)}`,
    `mulL=${range(settings.multiplication.left)}`,
    `mulR=${range(settings.multiplication.right)}`,
    `fracN=${range(settings.fraction.left)}`,
    `fracD=${range(settings.fraction.right)}`,
    `rootN=${range(settings.root.left)}`,
    `rootX=${range(settings.root.right)}`,
    `lnX=${range(settings.ln)}`,
    `auto=${settings.autoSubmit ? 1 : 0}`,
    `mode=${settings.submitMode}`,
    `sec=${settings.durationSeconds}`,
  ].join('&')
}

/* tolerance is relative: 0 means the entry must equal the answer exactly, and
   0.05 accepts anything within 5% of it. It travels with the problem rather
   than being looked up at grading time, so the grader never has to know which
   operation produced what it is marking. */
type Problem = { prompt: string; answer: number; tolerance: number }

function drawOperand({ min, max }: Range): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

/* Trailing zeros dropped, so a root that lands on 20 shows as 20 rather than
   20.000 and doesn't read as more precision than the drill asked for. */
function formatNumber(value: number, decimals: number): string {
  return String(Number(value.toFixed(decimals)))
}

const SUPERSCRIPTS = ['⁰', '¹', '²', '³', '⁴', '⁵', '⁶', '⁷', '⁸', '⁹']

function superscript(value: number): string {
  return String(value)
    .split('')
    .map((digit) => SUPERSCRIPTS[Number(digit)])
    .join('')
}

/* Subtraction and division are the addition and multiplication draws read
   backwards: both remove the left operand, so the answer is always the right
   one, non-negative for subtraction and a clean integer for division.
   Callers guarantee at least one operation is enabled — Start is disabled
   otherwise, so the enabled list is never empty here. */
/* Shares are relative and normalised over the enabled set, so disabling an
   operation redistributes its share across the rest rather than leaving a gap.
   Callers guarantee the enabled list is non-empty — Start is disabled when it
   would be. */
function pickOperation(settings: Settings): Operation {
  const enabled = OPERATIONS.filter((operation) => settings.operations[operation])
  const totalWeight = enabled
    .reduce((running, operation) => running + settings.weights[operation], 0)

  /* Every enabled share at zero leaves nothing to draw against, so the mix
     falls back to even rather than never returning. */
  if (totalWeight <= 0) {
    return enabled[Math.floor(Math.random() * enabled.length)]
  }

  let remaining = Math.random() * totalWeight
  for (const operation of enabled) {
    remaining -= settings.weights[operation]
    if (remaining < 0) {
      return operation
    }
  }
  /* Only reachable if floating-point error leaves remaining at exactly 0 after
     the last subtraction. */
  return enabled[enabled.length - 1]
}

function generateProblem(settings: Settings): Problem {
  const operation = pickOperation(settings)

  switch (operation) {
    case 'addition': {
      const left = drawOperand(settings.addition.left)
      const right = drawOperand(settings.addition.right)
      return { prompt: `${left} + ${right}`, answer: left + right, tolerance: 0 }
    }
    case 'subtraction': {
      const left = drawOperand(settings.addition.left)
      const right = drawOperand(settings.addition.right)
      return { prompt: `${left + right} − ${left}`, answer: right, tolerance: 0 }
    }
    case 'multiplication': {
      const left = drawOperand(settings.multiplication.left)
      const right = drawOperand(settings.multiplication.right)
      return { prompt: `${left} × ${right}`, answer: left * right, tolerance: 0 }
    }
    case 'division': {
      const left = drawOperand(settings.multiplication.left)
      const right = drawOperand(settings.multiplication.right)
      return { prompt: `${left * right} ÷ ${left}`, answer: right, tolerance: 0 }
    }
    case 'fraction': {
      const numerator = drawOperand(settings.fraction.left)
      const denominator = drawOperand(settings.fraction.right)
      return {
        prompt: `${numerator}/${denominator} as %`,
        answer: (100 * numerator) / denominator,
        tolerance: settings.leniency.fraction,
      }
    }
    /* The reverse of the conversion above: the percentage is given and the part
       has to come back out. A percentage on its own has no numeric answer to
       type, so the denominator comes with it. Shown to two decimals below 10%,
       where one would round away more than the leniency allows, and graded
       against the numerator it was built from. */
    case 'percent': {
      const numerator = drawOperand(settings.fraction.left)
      const denominator = drawOperand(settings.fraction.right)
      const percentage = (100 * numerator) / denominator
      return {
        prompt: `${formatNumber(percentage, percentage < 10 ? 2 : 1)}% of ${denominator}`,
        answer: numerator,
        tolerance: settings.leniency.percent,
      }
    }
    case 'root': {
      const degree = drawOperand(settings.root.left)
      const radicand = drawOperand(settings.root.right)
      return {
        prompt: `${degree === 2 ? '' : superscript(degree)}√${radicand}`,
        answer: Math.pow(radicand, 1 / degree),
        tolerance: settings.leniency.root,
      }
    }
    case 'ln': {
      const x = drawOperand(settings.ln)
      return {
        prompt: `ln ${x}`,
        answer: Math.log(x),
        tolerance: settings.leniency.ln,
      }
    }
    /* ln read backwards, the way division reads multiplication backwards: the
       exponent is a log drawn from the same x range, rounded to what a runner
       could plausibly be shown. The reference answer is recomputed from the
       rounded exponent, so it answers the question on screen exactly rather
       than the x it came from. */
    case 'exp': {
      const exponent = Number(Math.log(drawOperand(settings.ln)).toFixed(2))
      return {
        prompt: `e^${exponent}`,
        answer: Math.exp(exponent),
        tolerance: settings.leniency.exp,
      }
    }
  }
}

/* The single grader for every problem. An empty or half-typed entry ('.', '')
   is wrong rather than 0, so a bare submit can't be credited against an answer
   that happens to be zero. */
function isCorrect(entry: string, problem: Problem): boolean {
  const value = Number(entry)
  if (entry === '' || !Number.isFinite(value)) {
    return false
  }
  if (problem.tolerance <= 0) {
    return value === problem.answer
  }
  const slack = problem.tolerance * Math.abs(problem.answer)
  return Math.abs(value - problem.answer) <= slack + 1e-9
}

function formatClock(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

function App() {
  const [gameStarted, setGameStarted] = useState(false)
  const [theme, setTheme] = useState<Theme>('light')

  const [settings, setSettings] = useState<Settings>(
    () => readSettings(window.location.search),
  )

  /* Play again bumps this, and the key remounts Game — one line instead of a
     reset function that has to remember every piece of run state. */
  const [runId, setRunId] = useState(0)

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  /* replaceState, not pushState — config edits shouldn't stack up entries the
     back button has to walk through. */
  useEffect(() => {
    window.history.replaceState(null, '', writeSettings(settings))
  }, [settings])

  return gameStarted ?
    <Game
      key={runId}
      theme={theme}
      setTheme={setTheme}
      settings={settings}
      onReplay={() => setRunId((previous) => previous + 1)}
      onExit={() => setGameStarted(false)}
    /> :
    <Home
      theme={theme}
      setTheme={setTheme}
      onStart={() => setGameStarted(true)}
      settings={settings}
      setSettings={setSettings}
    />
}

function ThemeToggle({
  theme,
  setTheme,
}: {
  theme: Theme
  setTheme: (theme: Theme) => void
}) {
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={() => setTheme(theme === 'light' ? 'dark' : 'light')}
    >
      {theme === 'light' ? 'Dark' : 'Light'}
    </button>
  )
}

/* One operation's row: the toggle and its caption, then whatever specimen and
   knobs the caller passes. Module-level rather than nested in Home, because a
   component redefined each render remounts its children and would wipe the
   half-typed text out of every uncontrolled box on the screen. */
function OpRow({
  caption,
  delay,
  enabled,
  onToggle,
  children,
}: {
  caption: string
  delay: string
  enabled: boolean
  onToggle: () => void
  children: React.ReactNode
}) {
  return (
    <li
      className={`op-row ${enabled ? '' : 'off'}`}
      style={{ '--delay': delay } as React.CSSProperties}
    >
      <label className="op-toggle">
        <input
          type="checkbox"
          className="op-input"
          defaultChecked={enabled}
          onChange={onToggle}
        />
        <span className="op-box" aria-hidden="true" />
        <span className="op-caption">{caption}</span>
      </label>
      {children}
    </li>
  )
}

/* A (min – max) pair. Uncontrolled: each box owns its own text while it is
   being edited, and settle is the only writer — it returns the string the box
   should show once focus leaves, so a rejected edit is visible rather than
   silent. */
function Bounds({
  label,
  range,
  settle,
}: {
  label: string
  range: Range
  settle: (bound: Bound, value: string) => string
}) {
  return (
    <span className="operand">
      <span className="paren">(</span>
      <input
        className="bound"
        type="text"
        inputMode="numeric"
        aria-label={`${label} minimum`}
        size={4}
        defaultValue={range.min}
        onBlur={(event) => {
          event.target.value = settle('min', event.target.value)
        }}
      />
      <span className="dash">–</span>
      <input
        className="bound"
        type="text"
        inputMode="numeric"
        aria-label={`${label} maximum`}
        size={4}
        defaultValue={range.max}
        onBlur={(event) => {
          event.target.value = settle('max', event.target.value)
        }}
      />
      <span className="paren">)</span>
    </span>
  )
}

/* A share or a leniency: same blur-commit contract as Bounds, one number. */
function Knob({
  caption,
  label,
  value,
  settle,
}: {
  caption: string
  label: string
  value: number
  settle: (value: string) => string
}) {
  return (
    <label className="op-knob">
      <span className="op-knob-label">{caption}</span>
      <input
        className="weight"
        type="text"
        inputMode="decimal"
        aria-label={label}
        defaultValue={value}
        onBlur={(event) => {
          event.target.value = settle(event.target.value)
        }}
      />
    </label>
  )
}

function Home({
  theme,
  setTheme,
  onStart,
  settings,
  setSettings,
}: {
  theme: Theme
  setTheme: (theme: Theme) => void
  onStart: () => void
  settings: Settings
  setSettings: React.Dispatch<React.SetStateAction<Settings>>
}) {
  /* Open from the start when a URL arrives with advanced work already switched
     on — config that is enabled but out of sight is worse than a long page. */
  const [advancedOpen, setAdvancedOpen] = useState(
    () => ADVANCED_OPERATIONS.some((operation) => settings.operations[operation]),
  )

  /* Ranges are uncontrolled: nothing reaches settings until the field is left.
     settleBound is the only writer — it cleans one field's text, compares it
     against the sibling bound already in settings, and returns the string the
     box should show, so a clamp is visible rather than silent. */
  function settleRange(current: Range, bound: Bound, value: string): number | null {
    const parsed = Number(value.trim())

    /* Operands floor at 1, so a zero can never reach the generator and make the
       division reverse a divide-by-zero. Blank, non-numeric and fractional text
       is rejected the same way — the box goes back to whatever is stored.
       Number.isInteger rejects NaN and Infinity too. */
    if (!Number.isInteger(parsed) || parsed < 1) {
      return null
    }
    if (bound === 'min' && parsed > current.max) {
      return null
    }
    if (bound === 'max' && parsed < current.min) {
      return null
    }
    return parsed
  }

  function settleBound(
    operation: PairedOperation,
    side: 'left' | 'right',
    bound: Bound,
    value: string,
  ): string {
    const current = settings[operation][side]
    const parsed = settleRange(current, bound, value)
    if (parsed === null) {
      return String(current[bound])
    }

    setSettings(previous => ({...previous, [operation]: {...previous[operation], [side]: {...previous[operation][side], [bound]: parsed}}}))
    return String(parsed)
  }

  /* ln is the one operation with a single range, so it has no side to select. */
  function settleLnBound(bound: Bound, value: string): string {
    const parsed = settleRange(settings.ln, bound, value)
    if (parsed === null) {
      return String(settings.ln[bound])
    }

    setSettings(previous => ({...previous, ln: {...previous.ln, [bound]: parsed}}))
    return String(parsed)
  }

  /* Same blur-commit contract as settleBound, but shares are relative rather
     than paired, so there is no sibling to check against — only the format. */
  function settleWeight(operation: Operation, value: string): string {
    const parsed = Number(value.trim())

    if (value.trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      return String(settings.weights[operation])
    }

    setSettings(previous => ({...previous, weights:
      {...previous.weights, [operation]: parsed}}))
    return String(parsed)
  }

  /* A relative tolerance, so 1 already accepts every entry between zero and
     double the answer — above that there is nothing left to loosen. */
  function settleLeniency(operation: AdvancedOperation, value: string): string {
    const parsed = Number(value.trim())

    if (
      value.trim() === '' ||
      !Number.isFinite(parsed) ||
      parsed < 0 ||
      parsed > 1
    ) {
      return String(settings.leniency[operation])
    }

    setSettings(previous => ({...previous, leniency:
      {...previous.leniency, [operation]: parsed}}))
    return String(parsed)
  }

  function toggleAutoSubmit() {
    setSettings(previous => ({...previous, autoSubmit: !previous.autoSubmit}))
  }

  function setSubmitMode(mode: SubmitMode) {
    setSettings(previous => ({...previous, submitMode: mode}))
  }

  function setDuration(seconds: number) {
    setSettings(previous => ({...previous, durationSeconds: seconds}))
  }

  function toggleOperation(operation: Operation) {
    setSettings(previous => ({...previous, operations:
      {...previous.operations, [operation]:
        !previous.operations[operation],}}))
  }

  const anyOperation = Object.values(settings.operations).some(Boolean)
  const advancedOn = ADVANCED_OPERATIONS
    .filter((operation) => settings.operations[operation]).length

  /* Every advanced row carries a share and a leniency, so the pair is built
     once here rather than spelled out five times below. */
  function knobs(operation: AdvancedOperation, name: string) {
    return (
      <div className="op-knobs op-knobs-pair">
        <Knob
          caption="share"
          label={`${name} share`}
          value={settings.weights[operation]}
          settle={(value) => settleWeight(operation, value)}
        />
        <Knob
          caption="tol"
          label={`${name} leniency`}
          value={settings.leniency[operation]}
          settle={(value) => settleLeniency(operation, value)}
        />
      </div>
    )
  }

  return (
    <main className="app start">
      <header className="start-head">
        <div>
          <h1 className="start-title">Quant Cardio</h1>
          <p className="start-tagline">Drill it on the move.</p>
        </div>
        <ThemeToggle theme={theme} setTheme={setTheme} />
      </header>

      <div className="start-body">
        <h2 className="start-label">Operations</h2>

        <ul className="op-list">
          <OpRow
            caption="addition"
            delay="0ms"
            enabled={settings.operations.addition}
            onToggle={() => toggleOperation('addition')}
          >
            <div className="op-spec">
              <Bounds
                label="Addition left operand"
                range={settings.addition.left}
                settle={(bound, value) =>
                  settleBound('addition', 'left', bound, value)}
              />
              <span className="op-glyph">+</span>
              <Bounds
                label="Addition right operand"
                range={settings.addition.right}
                settle={(bound, value) =>
                  settleBound('addition', 'right', bound, value)}
              />
            </div>
            <div className="op-knobs">
              <Knob
                caption="share"
                label="Addition share"
                value={settings.weights.addition}
                settle={(value) => settleWeight('addition', value)}
              />
            </div>
          </OpRow>

          <OpRow
            caption="subtraction"
            delay="45ms"
            enabled={settings.operations.subtraction}
            onToggle={() => toggleOperation('subtraction')}
          >
            <p className="op-spec op-note">reversed addition problems</p>
            <div className="op-knobs">
              <Knob
                caption="share"
                label="Subtraction share"
                value={settings.weights.subtraction}
                settle={(value) => settleWeight('subtraction', value)}
              />
            </div>
          </OpRow>

          <OpRow
            caption="multiplication"
            delay="90ms"
            enabled={settings.operations.multiplication}
            onToggle={() => toggleOperation('multiplication')}
          >
            <div className="op-spec">
              <Bounds
                label="Multiplication left operand"
                range={settings.multiplication.left}
                settle={(bound, value) =>
                  settleBound('multiplication', 'left', bound, value)}
              />
              <span className="op-glyph">×</span>
              <Bounds
                label="Multiplication right operand"
                range={settings.multiplication.right}
                settle={(bound, value) =>
                  settleBound('multiplication', 'right', bound, value)}
              />
            </div>
            <div className="op-knobs">
              <Knob
                caption="share"
                label="Multiplication share"
                value={settings.weights.multiplication}
                settle={(value) => settleWeight('multiplication', value)}
              />
            </div>
          </OpRow>

          <OpRow
            caption="division"
            delay="135ms"
            enabled={settings.operations.division}
            onToggle={() => toggleOperation('division')}
          >
            <p className="op-spec op-note">reversed multiplication problems</p>
            <div className="op-knobs">
              <Knob
                caption="share"
                label="Division share"
                value={settings.weights.division}
                settle={(value) => settleWeight('division', value)}
              />
            </div>
          </OpRow>
        </ul>

        <div className="start-advanced">
          <button
            type="button"
            className={`advanced-toggle ${advancedOpen ? 'open' : ''}`}
            aria-expanded={advancedOpen}
            onClick={() => setAdvancedOpen((previous) => !previous)}
          >
            <span className="start-label advanced-label">Advanced</span>
            {advancedOn > 0 && (
              <span className="advanced-count">{advancedOn} on</span>
            )}
            <span className="advanced-caret" aria-hidden="true">▾</span>
          </button>

          {advancedOpen && (
            <ul className="op-list">
              <OpRow
                caption="fraction → %"
                delay="0ms"
                enabled={settings.operations.fraction}
                onToggle={() => toggleOperation('fraction')}
              >
                <div className="op-spec">
                  <Bounds
                    label="Fraction numerator"
                    range={settings.fraction.left}
                    settle={(bound, value) =>
                      settleBound('fraction', 'left', bound, value)}
                  />
                  <span className="op-glyph">/</span>
                  <Bounds
                    label="Fraction denominator"
                    range={settings.fraction.right}
                    settle={(bound, value) =>
                      settleBound('fraction', 'right', bound, value)}
                  />
                </div>
                {knobs('fraction', 'Fraction')}
              </OpRow>

              <OpRow
                caption="% → fraction"
                delay="45ms"
                enabled={settings.operations.percent}
                onToggle={() => toggleOperation('percent')}
              >
                <p className="op-spec op-note">reversed fraction problems</p>
                {knobs('percent', 'Percent')}
              </OpRow>

              <OpRow
                caption="nth root"
                delay="90ms"
                enabled={settings.operations.root}
                onToggle={() => toggleOperation('root')}
              >
                <div className="op-spec">
                  <span className="op-glyph">ⁿ√x</span>
                  <span className="op-glyph">n</span>
                  <Bounds
                    label="Root degree"
                    range={settings.root.left}
                    settle={(bound, value) =>
                      settleBound('root', 'left', bound, value)}
                  />
                  <span className="op-glyph">x</span>
                  <Bounds
                    label="Root radicand"
                    range={settings.root.right}
                    settle={(bound, value) =>
                      settleBound('root', 'right', bound, value)}
                  />
                </div>
                {knobs('root', 'Root')}
              </OpRow>

              <OpRow
                caption="natural log"
                delay="135ms"
                enabled={settings.operations.ln}
                onToggle={() => toggleOperation('ln')}
              >
                <div className="op-spec">
                  <span className="op-glyph">ln x</span>
                  <Bounds
                    label="Natural log x"
                    range={settings.ln}
                    settle={settleLnBound}
                  />
                </div>
                {knobs('ln', 'Natural log')}
              </OpRow>

              <OpRow
                caption="exponential"
                delay="180ms"
                enabled={settings.operations.exp}
                onToggle={() => toggleOperation('exp')}
              >
                <p className="op-spec op-note">reversed natural log problems</p>
                {knobs('exp', 'Exponential')}
              </OpRow>
            </ul>
          )}
        </div>

        <div className="start-submit">
          <h2 className="start-label">Submission options</h2>

          <div className="op-row submit-row">
            <label className="op-toggle">
              <input
                type="checkbox"
                className="op-input"
                defaultChecked={settings.autoSubmit}
                onChange={toggleAutoSubmit}
              />
              <span className="op-box" aria-hidden="true" />
              <span className="op-caption">auto-submit</span>
            </label>

            {settings.autoSubmit && (
              <div className="select-shell submit-mode">
                <select
                  className="start-select"
                  aria-label="Auto-submit method"
                  defaultValue={settings.submitMode}
                  onChange={(event) => setSubmitMode(
                    event.target.value === 'digits' ? 'digits' : 'correct',
                  )}
                >
                  <option value="correct">on correct answer</option>
                  <option value="digits">at full digits</option>
                </select>
                <span className="select-caret" aria-hidden="true">
                  ▾
                </span>
              </div>
            )}
          </div>

          {settings.autoSubmit && settings.submitMode === 'digits' &&
            advancedOn > 0 && (
            <p className="start-note advanced-warning">
              Advanced answers wait for ✓ — their digit count is not a cue.
            </p>
          )}
        </div>

        <div className="start-duration">
          <label className="start-label" htmlFor="duration">
            Duration
          </label>
          <div className="select-shell">
            <select
              id="duration"
              className="start-select"
              defaultValue={settings.durationSeconds}
              onChange={(event) => setDuration(Number(event.target.value))}
            >
              {DURATIONS.map((seconds) => (
                <option key={seconds} value={seconds}>
                  {seconds} seconds
                </option>
              ))}
            </select>
            <span className="select-caret" aria-hidden="true">
              ▾
            </span>
          </div>
        </div>
      </div>

      <div className="start-foot">
        <p className="start-note" role="status" aria-live="polite">
          {anyOperation ? '' : 'Select at least one operation.'}
        </p>
        <button
          type="button"
          className="start-go"
          onClick={onStart}
          disabled={!anyOperation}
        >
          Start
        </button>
      </div>
    </main>
  )
}

function Game({
  theme,
  setTheme,
  settings,
  onReplay,
  onExit,
}: {
  theme: Theme
  setTheme: (theme: Theme) => void
  settings: Settings
  onReplay: () => void
  onExit: () => void
}) {
  const [answer, setAnswer] = useState('')
  const [message, setMessage] = useState('')

  const [status, setStatus] = useState<"correct" | "wrong" | "">("")
  const [flashId, setFlashId] = useState(0)

  const [problem, setProblem] = useState<Problem>(() => generateProblem(settings))

  const [total, setTotal] = useState(0)
  const [correct, setCorrect] = useState(0)

  /* The clock runs off a fixed deadline rather than counting a state variable
     down, so a slow tick or a backgrounded tab can't stretch the round. The
     interval only decides how often the display catches up. */
  const [deadline] = useState(() => Date.now() + settings.durationSeconds * 1000)
  const [secondsLeft, setSecondsLeft] = useState(settings.durationSeconds)

  const holdTimer = useRef<number | undefined>(undefined)

  /* Decided from the config, not from the problem on screen, so the keypad
     keeps the same geometry for the whole run — a key that appears and
     disappears between problems is a key you can't reach without looking. */
  const decimals = ADVANCED_OPERATIONS
    .some((operation) => settings.operations[operation])

  useEffect(() => {
    return () => window.clearTimeout(holdTimer.current)
  }, [])

  useEffect(() => {
    const tick = window.setInterval(() => {
      const remaining = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSecondsLeft(remaining)
      if (remaining === 0) {
        window.clearInterval(tick)
      }
    }, 200)
    return () => window.clearInterval(tick)
  }, [deadline])

  /* Every flash gets its own id so the overlay remounts and replays. Two
     answers inside the 700ms animation would otherwise set the same status and
     leave the running animation alone — the second flash would be dropped,
     which auto-submit makes common. */
  function flash(kind: "correct" | "wrong") {
    setStatus(kind)
    setFlashId((previous) => previous + 1)
  }

  function advance(wasCorrect: boolean) {
    flash(wasCorrect ? "correct" : "wrong")
    setTotal((previous) => previous + 1)
    if (wasCorrect) {
      setCorrect((previous) => previous + 1)
    }
    /* An approximated answer is only feedback if the runner sees what it was
       approximating. It reads against the problem just answered — setProblem
       below hasn't landed yet — and clears on the first key of the next one. */
    setMessage(problem.tolerance > 0 ?
      `exact ${formatNumber(problem.answer, 3)}` :
      '')
    setProblem(generateProblem(settings))
    setAnswer('')
  }

  function pressKey(key: string) {
    if (answer === '') {
      setMessage('')
    }

    /* A leading dot is written out as 0. — the entry is read with Number, which
       would take '.5', but a bar reading '.5' at a glance is a 5. */
    if (key === '.') {
      if (!decimals || answer.includes('.')) {
        return
      }
      const next = answer === '' ? '0.' : answer + '.'
      if (next.length > MAX_LENGTH) {
        setMessage("LENGTH CAP")
        return
      }
      setAnswer(next)
      return
    }

    if (answer.length >= MAX_LENGTH) {
      setMessage("LENGTH CAP")
      return
    }

    const next = answer + key
    setAnswer(next)

    /* Decided here rather than in an effect on answer, so the check runs
       against the digit just pressed instead of the previous render's value. */
    if (!settings.autoSubmit || Date.now() >= deadline) {
      return
    }
    if (settings.submitMode === 'correct') {
      if (isCorrect(next, problem)) {
        advance(true)
      }
      return
    }
    /* Digit count is meaningless for an approximated answer — ln 50 is
       3.912023005428146 — so those problems wait for the check key even in
       full-digits mode. */
    if (problem.tolerance > 0) {
      return
    }
    if (next.length === String(problem.answer).length) {
      advance(isCorrect(next, problem))
    }
  }

  function backspace() {
    if (answer.length == MAX_LENGTH) {
      setMessage("")
    }
    setAnswer(answer.slice(0, -1))
  }

  function submit() {
    /* Checked against the deadline rather than secondsLeft, which only catches
       up every 200ms — the problem on screen at expiry counts for nothing. */
    if (Date.now() >= deadline) {
      return
    }
    if (answer.length == MAX_LENGTH) {
      setMessage("")
    }
    const wasCorrect = isCorrect(answer, problem)

    /* Nothing leaves a problem behind in correct-answer mode, so the check key
       can only confirm — advancing on a wrong entry would make it a skip. */
    if (settings.autoSubmit && settings.submitMode === 'correct' && !wasCorrect) {
      flash("wrong")
      setAnswer('')
      setMessage('')
      return
    }
    advance(wasCorrect)
  }

  function clearAns() {
    setAnswer("")
  }

  function startHold() {
    holdTimer.current = window.setTimeout(clearAns, HOLD_TO_CLEAR_MS)
  }

  function endHold() {
    window.clearTimeout(holdTimer.current)
  }

  /* No dependency array: the handler closes over answer, problem and settings,
     and re-subscribing each render keeps it reading the current ones without a
     dep list that goes stale the next time this component grows a field. */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      /* Results screen owns its own keyboard — its two buttons need Enter. */
      if (secondsLeft === 0) {
        return
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return
      }

      if (/^[0-9]$/.test(event.key)) {
        event.preventDefault()
        pressKey(event.key)
        return
      }
      /* Comma too: it is the decimal separator on a good share of keyboards,
         and nothing else on this screen wants it. */
      if (event.key === '.' || event.key === ',') {
        event.preventDefault()
        pressKey('.')
        return
      }
      if (event.key === 'Enter') {
        /* A focused keypad button already fires its onClick on Enter, so
           handling it here as well would submit the same answer twice. */
        if (event.target instanceof HTMLButtonElement) {
          return
        }
        event.preventDefault()
        submit()
        return
      }
      if (event.key === 'Backspace') {
        event.preventDefault()
        backspace()
        return
      }
      /* The keyboard equivalent of holding the touch backspace. */
      if (event.key === 'Escape') {
        event.preventDefault()
        clearAns()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  })

  if (secondsLeft === 0) {
    const accuracy = total === 0 ? 0 : Math.round((correct / total) * 100)

    return (
      <main className="app results">
        <div className="game-bar">
          <ThemeToggle theme={theme} setTheme={setTheme} />
        </div>

        <div className="results-body">
          <h1 className="results-title">Time</h1>

          <dl className="results-stats">
            <div className="results-stat">
              <dt>Answered</dt>
              <dd>{total}</dd>
            </div>
            <div className="results-stat">
              <dt>Correct</dt>
              <dd>
                {accuracy}%
                <span className="results-detail">{correct} of {total}</span>
              </dd>
            </div>
            <div className="results-stat">
              <dt>Seconds each</dt>
              <dd>
                {total === 0 ?
                  '—' :
                  (settings.durationSeconds / total).toFixed(1)}
              </dd>
            </div>
          </dl>
        </div>

        <div className="results-foot">
          <button type="button" className="results-exit" onClick={onExit}>
            Change settings
          </button>
          <button type="button" className="results-again" onClick={onReplay}>
            Play again
          </button>
        </div>
      </main>
    )
  }

  const submitKey = (
    <button
      type="button"
      className={`key-submit ${decimals ? 'key-wide' : ''}`}
      onClick={submit}
      aria-label="Check answer"
    >
      ✓
    </button>
  )

  return (
    <main className="app">
      {status !== "" && (
        <div
          key={flashId}
          className={`screen ${status}`}
          onAnimationEnd={() => setStatus("")}
          aria-hidden="true"
        ></div>
      )}

      <div className="game-bar">
        <ThemeToggle theme={theme} setTheme={setTheme} />
        <div
          className={`game-clock ${secondsLeft === 0 ? 'spent' : ''}`}
          role="timer"
          aria-live="off"
        >
          {formatClock(secondsLeft)}
        </div>
      </div>

      <div
        className="question"
        style={{ '--chars': problem.prompt.length } as React.CSSProperties}
      >
        {problem.prompt}
      </div>

      <div className="answer-bar">
        {answer}
      </div>

      <div className="message" role="status" aria-live="polite">{message}</div>

      <div className="keypad">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
          <button
            type="button"
            key={digit}
            onClick={() => pressKey(String(digit))}
          >
            {digit}
          </button>
        ))}

        <button
          type="button"
          className="key-back"
          onClick={backspace}
          onPointerDown={startHold}
          onPointerUp={endHold}
          onPointerLeave={endHold}
          onPointerCancel={endHold}
          onContextMenu={(event) => event.preventDefault()}
          aria-label="Delete last digit, hold to clear"
        >
          ←
        </button>
        <button type="button" onClick={() => pressKey('0')}>0</button>

        {/* The decimal point takes the check key's corner and the check key
            widens onto its own row, rather than shuffling the digits — the
            three keys a thumb finds without looking stay put. */}
        {decimals ?
          <button type="button" onClick={() => pressKey('.')}>.</button> :
          submitKey}
        {decimals && submitKey}
      </div>
    </main>
  )
}

export default App

