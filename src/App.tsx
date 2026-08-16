import React, { useEffect, useRef, useState } from 'react'

const HOLD_TO_CLEAR_MS = 500
const MAX_LENGTH = 10

type Theme = 'light' | 'dark'

type Operation = 'addition' | 'subtraction' | 'multiplication' | 'division'
type Bound = 'min' | 'max'
type Side = 'left' | 'right'

/* Only addition and multiplication carry ranges; subtraction and division read
   theirs. Narrowing here is what lets settings[operation] typecheck inside the
   nested update, rather than needing a cast. */
type RangedOperation = Extract<Operation, 'addition' | 'multiplication'>

type Range = { min: number; max: number }
type OperandRanges = { left: Range; right: Range }

type Settings = {
  operations: Record<Operation, boolean>
  /* Relative shares, not required to sum to 1 — they are normalised across
     whatever is enabled at draw time. Equal values mean an even mix, so the
     0.25 default reads as a quarter each while still tolerating any edit. */
  weights: Record<Operation, number>
  addition: OperandRanges
  multiplication: OperandRanges
  durationSeconds: number
}

const DEFAULT_SETTINGS: Settings = {
  operations: {
    addition: true,
    subtraction: true,
    multiplication: true,
    division: true,
  },
  weights: {
    addition: 0.25,
    subtraction: 0.25,
    multiplication: 0.25,
    division: 0.25,
  },
  addition: {
    left: { min: 2, max: 100 },
    right: { min: 2, max: 100 },
  },
  multiplication: {
    left: { min: 2, max: 12 },
    right: { min: 2, max: 100 },
  },
  durationSeconds: 60,
}

const OPERATIONS: Operation[] = [
  'addition',
  'subtraction',
  'multiplication',
  'division',
]

const DURATIONS = [30, 60, 120, 300]

/* Config lives in the query string, Zetamac-style, so a run is shareable and
   survives a reload. Anything missing or malformed falls back to its default
   rather than failing — a hand-edited URL should degrade, not break. */
const OPERATION_PARAMS: Record<Operation, string> = {
  addition: 'add',
  subtraction: 'sub',
  multiplication: 'mul',
  division: 'div',
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
  const operations = {
    addition: listed.includes(OPERATION_PARAMS.addition),
    subtraction: listed.includes(OPERATION_PARAMS.subtraction),
    multiplication: listed.includes(OPERATION_PARAMS.multiplication),
    division: listed.includes(OPERATION_PARAMS.division),
  }
  /* An empty set is a dead config — Start would never enable. */
  return OPERATIONS.some((operation) => operations[operation]) ?
    operations :
    DEFAULT_SETTINGS.operations
}

/* Positional, in OPERATIONS order, so it reads against the ops list beside it.
   Any malformed entry drops the whole set back to defaults rather than leaving
   a half-parsed mix. */
function parseWeights(raw: string | null): Record<Operation, number> {
  const listed = raw === null ? [] : raw.split(',')
  if (listed.length !== OPERATIONS.length) {
    return DEFAULT_SETTINGS.weights
  }

  const weights = { ...DEFAULT_SETTINGS.weights }
  for (const [index, operation] of OPERATIONS.entries()) {
    const parsed = Number(listed[index])
    if (listed[index].trim() === '' || !Number.isFinite(parsed) || parsed < 0) {
      return DEFAULT_SETTINGS.weights
    }
    weights[operation] = parsed
  }
  return weights
}

function readSettings(search: string): Settings {
  const params = new URLSearchParams(search)
  const seconds = Number(params.get('sec'))

  return {
    operations: parseOperations(params.get('ops')),
    weights: parseWeights(params.get('w')),
    addition: {
      left: parseRange(params.get('addL'), DEFAULT_SETTINGS.addition.left),
      right: parseRange(params.get('addR'), DEFAULT_SETTINGS.addition.right),
    },
    multiplication: {
      left: parseRange(params.get('mulL'), DEFAULT_SETTINGS.multiplication.left),
      right: parseRange(params.get('mulR'), DEFAULT_SETTINGS.multiplication.right),
    },
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
     the commas in ops. Every value here is digits, dashes and commas. */
  return '?' + [
    `ops=${enabled.join(',')}`,
    `w=${OPERATIONS.map((operation) => settings.weights[operation]).join(',')}`,
    `addL=${range(settings.addition.left)}`,
    `addR=${range(settings.addition.right)}`,
    `mulL=${range(settings.multiplication.left)}`,
    `mulR=${range(settings.multiplication.right)}`,
    `sec=${settings.durationSeconds}`,
  ].join('&')
}

type Problem = { prompt: string; answer: number }

function drawOperand({ min, max }: Range): number {
  return min + Math.floor(Math.random() * (max - min + 1))
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
      return { prompt: `${left} + ${right}`, answer: left + right }
    }
    case 'subtraction': {
      const left = drawOperand(settings.addition.left)
      const right = drawOperand(settings.addition.right)
      return { prompt: `${left + right} − ${left}`, answer: right }
    }
    case 'multiplication': {
      const left = drawOperand(settings.multiplication.left)
      const right = drawOperand(settings.multiplication.right)
      return { prompt: `${left} × ${right}`, answer: left * right }
    }
    case 'division': {
      const left = drawOperand(settings.multiplication.left)
      const right = drawOperand(settings.multiplication.right)
      return { prompt: `${left * right} ÷ ${left}`, answer: right }
    }
  }
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
  /* Ranges are uncontrolled: each box owns its own text while it is being
     edited, and nothing reaches settings until the field is left. settleBound
     is the only writer — it cleans one field's text, compares it against the
     sibling bound already in settings, and returns the string the box should
     show, so a clamp is visible rather than silent. */
  function settleBound(
    operation: RangedOperation,
    side: Side,
    bound: Bound,
    value: string,
  ): string {
    const current = settings[operation][side]
    const parsed = Number(value.trim())

    /* Operands floor at 1, so a zero can never reach the generator and make the
       division reverse a divide-by-zero. Blank, non-numeric and fractional text
       is rejected the same way — the box goes back to whatever is stored.
       Number.isInteger rejects NaN and Infinity too. */
    if (!Number.isInteger(parsed) || parsed < 1) {
      return String(current[bound])
    }
    if (bound === 'min' && parsed > current.max) {
      return String(current.min)
    }
    if (bound === 'max' && parsed < current.min) {
      return String(current.max)
    }

    setSettings(previous => ({...previous, [operation]: {...previous[operation], [side]: {...previous[operation][side], [bound]: parsed}}}))
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

  function setDuration(seconds: number) {
    setSettings(previous => ({...previous, durationSeconds: seconds}))
  }

  function toggleOperation(operation: Operation) {
    setSettings(previous => ({...previous, operations: 
      {...previous.operations, [operation]: 
        !previous.operations[operation],}}))
  }

  const anyOperation = Object.values(settings.operations).some(Boolean)

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
          <li
            className={`op-row ${settings.operations.addition ? '' : 'off'}`}
            style={{ '--delay': '0ms' } as React.CSSProperties}
          >
            <label className="op-toggle">
              <input
                type="checkbox"
                className="op-input"
                defaultChecked={settings.operations.addition}
                onChange={() => toggleOperation('addition')}
              />
              <span className="op-box" aria-hidden="true" />
              <span className="op-caption">addition</span>
            </label>
            <div className="op-spec">
              <span className="operand">
                <span className="paren">(</span>
                <input
                  className="bound"
                  type="text"
                  inputMode="numeric"
                  aria-label="Addition left operand minimum"
                  size={4}
                  defaultValue={settings.addition.left.min}
                  onBlur={(event) => {
                    event.target.value =
                      settleBound('addition', 'left', 'min', event.target.value)
                  }}
                />
                <span className="dash">–</span>
                <input
                  className="bound"
                  type="text"
                  inputMode="numeric"
                  aria-label="Addition left operand maximum"
                  size={4}
                  defaultValue={settings.addition.left.max}
                  onBlur={(event) => {
                    event.target.value =
                      settleBound('addition', 'left', 'max', event.target.value)
                  }}
                />
                <span className="paren">)</span>
              </span>
              <span className="op-glyph">+</span>
              <span className="operand">
                <span className="paren">(</span>
                <input
                  className="bound"
                  type="text"
                  inputMode="numeric"
                  aria-label="Addition right operand minimum"
                  size={4}
                  defaultValue={settings.addition.right.min}
                  onBlur={(event) => {
                    event.target.value =
                      settleBound('addition', 'right', 'min', event.target.value)
                  }}
                />
                <span className="dash">–</span>
                <input
                  className="bound"
                  type="text"
                  inputMode="numeric"
                  aria-label="Addition right operand maximum"
                  size={4}
                  defaultValue={settings.addition.right.max}
                  onBlur={(event) => {
                    event.target.value =
                      settleBound('addition', 'right', 'max', event.target.value)
                  }}
                />
                <span className="paren">)</span>
              </span>
            </div>
            <label className="op-weight">
              <span className="op-weight-label">share</span>
              <input
                className="weight"
                type="text"
                inputMode="decimal"
                aria-label="Addition share"
                defaultValue={settings.weights.addition}
                onBlur={(event) => {
                  event.target.value =
                    settleWeight('addition', event.target.value)
                }}
              />
            </label>
          </li>

          <li
            className={`op-row ${settings.operations.subtraction ? '' : 'off'}`}
            style={{ '--delay': '45ms' } as React.CSSProperties}
          >
            <label className="op-toggle">
              <input
                type="checkbox"
                className="op-input"
                defaultChecked={settings.operations.subtraction}
                onChange={() => toggleOperation('subtraction')}
              />
              <span className="op-box" aria-hidden="true" />
              <span className="op-caption">subtraction</span>
            </label>
            <p className="op-spec op-note">reversed addition problems</p>
            <label className="op-weight">
              <span className="op-weight-label">share</span>
              <input
                className="weight"
                type="text"
                inputMode="decimal"
                aria-label="Subtraction share"
                defaultValue={settings.weights.subtraction}
                onBlur={(event) => {
                  event.target.value =
                    settleWeight('subtraction', event.target.value)
                }}
              />
            </label>
          </li>

          <li
            className={`op-row ${settings.operations.multiplication ? '' : 'off'}`}
            style={{ '--delay': '90ms' } as React.CSSProperties}
          >
            <label className="op-toggle">
              <input
                type="checkbox"
                className="op-input"
                defaultChecked={settings.operations.multiplication}
                onChange={() => toggleOperation('multiplication')}
              />
              <span className="op-box" aria-hidden="true" />
              <span className="op-caption">multiplication</span>
            </label>
            <div className="op-spec">
              <span className="operand">
                <span className="paren">(</span>
                <input
                  className="bound"
                  type="text"
                  inputMode="numeric"
                  aria-label="Multiplication left operand minimum"
                  size={4}
                  defaultValue={settings.multiplication.left.min}
                  onBlur={(event) => {
                    event.target.value =
                      settleBound('multiplication', 'left', 'min', event.target.value)
                  }}
                />
                <span className="dash">–</span>
                <input
                  className="bound"
                  type="text"
                  inputMode="numeric"
                  aria-label="Multiplication left operand maximum"
                  size={4}
                  defaultValue={settings.multiplication.left.max}
                  onBlur={(event) => {
                    event.target.value =
                      settleBound('multiplication', 'left', 'max', event.target.value)
                  }}
                />
                <span className="paren">)</span>
              </span>
              <span className="op-glyph">×</span>
              <span className="operand">
                <span className="paren">(</span>
                <input
                  className="bound"
                  type="text"
                  inputMode="numeric"
                  aria-label="Multiplication right operand minimum"
                  size={4}
                  defaultValue={settings.multiplication.right.min}
                  onBlur={(event) => {
                    event.target.value =
                      settleBound('multiplication', 'right', 'min', event.target.value)
                  }}
                />
                <span className="dash">–</span>
                <input
                  className="bound"
                  type="text"
                  inputMode="numeric"
                  aria-label="Multiplication right operand maximum"
                  size={4}
                  defaultValue={settings.multiplication.right.max}
                  onBlur={(event) => {
                    event.target.value =
                      settleBound('multiplication', 'right', 'max', event.target.value)
                  }}
                />
                <span className="paren">)</span>
              </span>
            </div>
            <label className="op-weight">
              <span className="op-weight-label">share</span>
              <input
                className="weight"
                type="text"
                inputMode="decimal"
                aria-label="Multiplication share"
                defaultValue={settings.weights.multiplication}
                onBlur={(event) => {
                  event.target.value =
                    settleWeight('multiplication', event.target.value)
                }}
              />
            </label>
          </li>

          <li
            className={`op-row ${settings.operations.division ? '' : 'off'}`}
            style={{ '--delay': '135ms' } as React.CSSProperties}
          >
            <label className="op-toggle">
              <input
                type="checkbox"
                className="op-input"
                defaultChecked={settings.operations.division}
                onChange={() => toggleOperation('division')}
              />
              <span className="op-box" aria-hidden="true" />
              <span className="op-caption">division</span>
            </label>
            <p className="op-spec op-note">reversed multiplication problems</p>
            <label className="op-weight">
              <span className="op-weight-label">share</span>
              <input
                className="weight"
                type="text"
                inputMode="decimal"
                aria-label="Division share"
                defaultValue={settings.weights.division}
                onBlur={(event) => {
                  event.target.value =
                    settleWeight('division', event.target.value)
                }}
              />
            </label>
          </li>
        </ul>

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

  const [problem, setProblem] = useState<Problem>(() => generateProblem(settings))

  const [total, setTotal] = useState(0)
  const [correct, setCorrect] = useState(0)

  /* The clock runs off a fixed deadline rather than counting a state variable
     down, so a slow tick or a backgrounded tab can't stretch the round. The
     interval only decides how often the display catches up. */
  const [deadline] = useState(() => Date.now() + settings.durationSeconds * 1000)
  const [secondsLeft, setSecondsLeft] = useState(settings.durationSeconds)

  const holdTimer = useRef<number | undefined>(undefined)

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

  function pressDigit(digit: number) {
    if (answer.length >= MAX_LENGTH) {
      setMessage("LENGTH CAP")
    }
    else {
      setAnswer(answer + digit)
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
    const isCorrect = Number(answer) === problem.answer
    setStatus(isCorrect ? "correct" : "wrong")
    setTotal((previous) => previous + 1)
    if (isCorrect) {
      setCorrect((previous) => previous + 1)
    }
    setProblem(generateProblem(settings))
    setAnswer('')
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

  return (
    <main className="app">
      {status !== "" && (
        <div
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
          <button type="button" key={digit} onClick={() => pressDigit(digit)}>
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
        <button type="button" onClick={() => pressDigit(0)}>0</button>
        <button
          type="button"
          className="key-submit"
          onClick={submit}
          aria-label="Check answer"
        >
          ✓
        </button>
      </div>
    </main>
  )
}

export default App
