import { useEffect, useRef, useState } from 'react'

const HOLD_TO_CLEAR_MS = 500

function App() {
  const MAX_LENGTH = 10

  const [answer, setAnswer] = useState('')
  const [message, setMessage] = useState('')

  const [status, setStatus] = useState<"correct" | "wrong" | "">("")
  const [theme, setTheme] = useState<"light" | "dark">("light")

  const holdTimer = useRef<number | undefined>(undefined)

  const correctAnswer = 17 * 34

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    return () => window.clearTimeout(holdTimer.current)
  }, [])

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
    if (answer.length == MAX_LENGTH) {
      setMessage("")
    }
    if (Number(answer) === correctAnswer) {
      setStatus("correct")
    }
    else {
      setStatus("wrong")
    }
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


  return (
    <main className="app">
      {status !== "" && (
        <div
          className={`screen ${status}`}
          onAnimationEnd={() => setStatus("")}
          aria-hidden="true"
        ></div>
      )}

      <button
        type="button"
        className="theme-toggle"
        onClick={() => setTheme(theme === "light" ? "dark" : "light")}
      >
        {theme === "light" ? "Dark" : "Light"}
      </button>

      <div className="question">17 × 34</div>

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
