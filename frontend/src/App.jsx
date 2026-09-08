import { useState } from 'react'
import './App.css'

const examples = [
  ['Person + org + phone', 'Hi, I am Kabir Malhotra, male, 29, calling from Star Union Bank, phone 98765-43210.'],
  ['Title + multi-word org', 'I was referred here by Dr. Ritu Bansal from Sunrise Medical College.'],
  ['Org with "of" + email', 'My account is with Bank of America, email kabir@example.com.'],
  ['Edge case: not real names', 'This is Cow calling about my dog, Jon.'],
]

const defaultText = examples[0][1]

function getMiddlewareHost() {
  const host = window.location.hostname
  return ['localhost', '127.0.0.1'].includes(host) ? '127.0.0.1' : host
}

function createLocalVault() {
  const values = new Map()
  const reverse = new Map()
  const patterns = [
    ['EMAIL', /[\w.+-]+@[\w-]+\.[\w.-]+/g],
    ['PHONE', /(?:\+?91[-\s]?)?[6-9]\d{4}[-\s]?\d{5}/g],
    ['GENDER', /\b(?:male|female|man|woman|transgender|non-binary)\b/gi],
    ['NAME', /\b[A-Z][a-z]+(?:\s+(?:of|and|&|for|the)\s+)?(?:\s+[A-Z][a-z]+)+/g],
  ]

  return {
    mask(text) {
      const spans = patterns.flatMap(([type, pattern]) => {
        pattern.lastIndex = 0
        return [...text.matchAll(pattern)].map((match) => ({ type, value: match[0], start: match.index, end: match.index + match[0].length }))
      }).sort((left, right) => left.start - right.start || right.end - left.end)
      const kept = []
      let end = -1
      for (const span of spans) {
        if (span.start >= end) { kept.push(span); end = span.end }
      }
      return kept.reverse().reduce((masked, span) => {
        let token = reverse.get(span.value)
        if (!token) {
          token = `[REDACTED_${Math.random().toString(16).slice(2, 8)}]`
          reverse.set(span.value, token)
          values.set(token, span.value)
        }
        return masked.slice(0, span.start) + token + masked.slice(span.end)
      }, text)
    },
    unmask(text) {
      return [...values.entries()].reduce((result, [token, value]) => result.split(token).join(value), text)
    },
  }
}

async function callMiddleware(path, body, baseUrl, apiKey) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const payload = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(`${response.status}: ${payload.detail || response.statusText}`)
    return payload
  } finally {
    clearTimeout(timeout)
  }
}

function highlightTokens(text) {
  return text.split(/(\[REDACTED_[0-9a-f]+\])/g).map((part, index) => part.startsWith('[REDACTED_')
    ? <span className="redaction-token" key={`${part}-${index}`} aria-label="redacted value">{part}</span>
    : part)
}

function PipelineStep({ number, title, tag, children }) {
  return (
    <article className="step">
      <div className="step-header"><span className="step-number">{number}</span><h2>{title}</h2><span className="step-tag">{tag}</span></div>
      <div className="step-content">{children}</div>
    </article>
  )
}

function App() {
  const [text, setText] = useState(defaultText)
  const [baseUrl, setBaseUrl] = useState(`http://${getMiddlewareHost()}:8000`)
  const [apiKey, setApiKey] = useState('dev-only-key')
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [status, setStatus] = useState(null)
  const [error, setError] = useState('')
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)

  async function runPipeline() {
    const transcript = text.trim()
    if (!transcript) return setError('Enter a transcript before running the demo.')
    setRunning(true)
    setError('')
    setResult(null)
    const stt = { transcript, confidence: 0.95, language: 'en-IN', duration_seconds: Math.round((transcript.length / 15) * 10) / 10 }
    const localVault = createLocalVault()
    let maskedTranscript
    let live = true
    let sessionId
    const middlewareUrl = baseUrl.replace(/\/$/, '')

    try {
      const maskResult = await callMiddleware('/v1/mask', { payload: { transcript }, fields: ['transcript'] }, middlewareUrl, apiKey)
      maskedTranscript = maskResult.payload.transcript
      sessionId = maskResult.session_id
      setStatus({ type: 'live', message: `LIVE - connected to middleware at ${middlewareUrl}` })
    } catch (requestError) {
      if (requestError.message.startsWith('401') || requestError.message.startsWith('403')) {
        setError(`Middleware rejected the request: ${requestError.message}. Check the API key.`)
        setRunning(false)
        return
      }
      live = false
      maskedTranscript = localVault.mask(transcript)
      setStatus({ type: 'sim', message: `SIMULATED - middleware unavailable at ${middlewareUrl}` })
    }

    const llmReply = `Got it, thanks. Summary: ${maskedTranscript}`
    let restoredReply
    if (live) {
      try {
        const unmaskResult = await callMiddleware('/v1/unmask', { payload: { response: llmReply }, fields: ['response'], session_id: sessionId }, middlewareUrl, apiKey)
        restoredReply = unmaskResult.payload.response
      } catch (requestError) {
        setError(`Mask succeeded, but restore failed: ${requestError.message}`)
        setRunning(false)
        return
      }
    } else {
      restoredReply = localVault.unmask(llmReply)
    }
    setResult({ stt, maskedTranscript, llmReply, restoredReply, live })
    setRunning(false)
  }

  return (
    <main className="app-shell">
      <header className="topbar"><div className="brand-lockup"><div className="brand-mark">PS</div><div><strong>PHI SCRUB</strong><small>LOCAL PRIVACY MIDDLEWARE</small></div></div><div className="topbar-note">DEMO ENVIRONMENT<br /><b>REVERSIBLE MASKING / V1</b></div></header>
      <section className="hero"><div><div className="eyebrow">Secure transcript workspace</div><h1>Protected transcript demo</h1><p>Keep sensitive context private while your model does its work.</p></div></section>

      <section className="intake-grid">
        <div className="panel intake-panel"><label className="field-label" htmlFor="transcript">Subject transcript</label><textarea id="transcript" value={text} onChange={(event) => setText(event.target.value)} />
          <div className="examples">{examples.map(([label, value]) => <button type="button" className="chip" key={label} onClick={() => setText(value)}>{label}</button>)}</div>
          <div className="actions"><button type="button" className="run-button" disabled={running} onClick={runPipeline}>{running ? 'Running...' : 'Run pipeline'}</button><button type="button" className="settings-button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>Middleware settings</button></div>
          {settingsOpen && <div className="settings"><label>Middleware URL<input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} /></label><label>API key<input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} /></label></div>}
          {status && <div className={`status ${status.type}`} role="status"><span />{status.message}</div>}
          {error && <div className="error" role="alert">{error}</div>}
        </div>
        <aside className="panel boundary-panel"><div><div className="field-label">Privacy boundary</div><p>The model sees tokens. Your application keeps the real values.</p></div><footer>IN-MEMORY VAULT <span>SESSION TTL 30 MIN</span></footer></aside>
      </section>

      {!result && <div className="empty-state">Enter a transcript above and run the pipeline to see each privacy boundary in sequence.</div>}
      {result && <section className="pipeline" aria-live="polite">
        <PipelineStep number="01" title="Raw intake" tag="SPEECH-TO-TEXT / SIMULATED"><pre>{JSON.stringify(result.stt, null, 2)}</pre></PipelineStep>
        <PipelineStep number="02" title="Redacted" tag="SENT TO MODEL"><p className="data-text">{highlightTokens(result.maskedTranscript)}</p></PipelineStep>
        <PipelineStep number="03" title="Model response" tag="MOCKED LLM CALL"><p className="data-text">{highlightTokens(result.llmReply)}</p></PipelineStep>
        <PipelineStep number="04" title="Restored" tag="SHOWN TO USER"><p className="data-text restored">{result.restoredReply}</p><div className="meta">{result.live ? 'Real values restored by the live middleware.' : 'Real values restored by the local fallback vault.'}</div></PipelineStep>
      </section>}
    </main>
  )
}

export default App
