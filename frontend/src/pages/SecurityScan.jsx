import { useState, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Play, X, Bot, Search, Database, ShieldCheck,
  CheckCircle2, Loader2, AlertTriangle, ShieldAlert,
} from 'lucide-react'
import { triggerScan } from '../api/client'
import AgentConsole from '../components/AgentConsole'
import AgentToolTerminal from '../components/AgentToolTerminal'

// ── 4-agent pipeline matching the mockup ──────────────────────────────────────
const AGENTS = [
  {
    id:    'orchestrator',
    label: 'Orchestrator',
    desc:  'Initiated scan workflow',
    Icon:  Bot,
    color: '#009c99',   // brand teal
    glow:  'rgba(0,156,153,0.28)',
  },
  {
    id:    'scanner',
    label: 'CVE Detective',
    desc:  'Checks packages for known vulnerabilities',
    Icon:  Search,
    color: '#22bfe1',   // accent cyan
    glow:  'rgba(34,191,225,0.28)',
  },
  {
    id:    'keeper',
    label: 'Data Keeper',
    desc:  'Ready to store findings',
    Icon:  Database,
    color: '#fd6034',   // accent orange
    glow:  'rgba(253,96,52,0.25)',
  },
  {
    id:    'report',
    label: 'Report',
    desc:  'Awaiting scan completion',
    Icon:  ShieldCheck,
    color: '#475569',   // slate (pending)
    glow:  'rgba(148,163,184,0.2)',
  },
]

const SERVICES = ['All Services (3)', 'order-service', 'invoice-service', 'bff']


const freshStates = () => Object.fromEntries(AGENTS.map(a => [a.id, 'idle']))
const freshDescs  = () => Object.fromEntries(AGENTS.map(a => [a.id, a.desc]))
const freshPct    = () => Object.fromEntries(AGENTS.map(a => [a.id, 0]))

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }

// Tick up progress % for the active agent while it's working
function useFakeProgress(pcts, setPcts, activeId, running) {
  const ref = useRef(null)
  const start = (id) => {
    if (ref.current) clearInterval(ref.current)
    ref.current = setInterval(() => {
      setPcts(prev => {
        const cur = prev[id] ?? 0
        if (cur >= 90) { clearInterval(ref.current); return prev }
        return { ...prev, [id]: cur + Math.floor(Math.random() * 8 + 3) }
      })
    }, 350)
  }
  const finish = (id) => {
    if (ref.current) clearInterval(ref.current)
    setPcts(prev => ({ ...prev, [id]: 100 }))
  }
  const reset = () => {
    if (ref.current) clearInterval(ref.current)
    setPcts(freshPct())
  }
  return { start, finish, reset }
}

export default function SecurityScan() {
  const navigate  = useNavigate()
  const logEndRef = useRef(null)

  const [scope,      setScope]      = useState('All Services (3)')
  const [running,    setRunning]    = useState(false)
  const [stepStates, setStepStates] = useState(freshStates)
  const [stepDescs,  setStepDescs]  = useState(freshDescs)
  const [stepPcts,   setStepPcts]   = useState(freshPct)
  const [logs,       setLogs]       = useState([])
  const [error,      setError]      = useState(null)
  const [scanDone,   setScanDone]   = useState(null)   // { sid, total }
  const [toolEvents, setToolEvents] = useState([])     // agent tool-call traces (live)

  // Live tool-trace handlers — the console pushes steps as they stream in.
  // Each new run resets the panel so the toolbox + payloads reflect only the
  // current action/question (not a growing pile from earlier runs).
  const startEvent  = (ev) => setToolEvents([{ ...ev, steps: [], status: 'running' }])
  const addStep     = (id, step) => setToolEvents(prev => prev.map(e => e.id === id ? { ...e, steps: [...e.steps, step] } : e))
  const finishEvent = (id, meta) => setToolEvents(prev => prev.map(e => e.id === id ? { ...e, ...meta, status: meta.status || 'ok' } : e))
  const toolHandlers = { startEvent, addStep, finishEvent }

  const progress = useFakeProgress(stepPcts, setStepPcts, null, running)

  const addLog = (ts, label, msg, type = 'info') => {
    setLogs(prev => [...prev, { ts, label, msg, type }])
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 60)
  }

  const setAgent = (id, state, desc) => {
    setStepStates(prev => ({ ...prev, [id]: state }))
    if (desc) setStepDescs(prev => ({ ...prev, [id]: desc }))
  }

  const ts = () => new Date().toLocaleTimeString('en-AU', { hour12: false })

  const doneCount = Object.values(stepStates).filter(s => s === 'complete').length
  const allDone   = doneCount === AGENTS.length
  const activeIdx = AGENTS.findIndex(a => stepStates[a.id] === 'active')

  async function handleStartScan() {
    setRunning(true); setError(null); setLogs([]); setScanDone(null)
    setStepStates(freshStates()); setStepDescs(freshDescs()); progress.reset()

    try {
      // 1 — Orchestrator
      setAgent('orchestrator', 'active', 'Initialising scan workflow…')
      progress.start('orchestrator')
      addLog(ts(), 'Orchestrator', `started — scan_id: SCAN#${Date.now().toString(36).toUpperCase()}`)
      await delay(900)
      progress.finish('orchestrator')
      setAgent('orchestrator', 'complete', 'Initiated scan workflow')
      addLog(ts(), 'Orchestrator', 'workflow ready', 'success')

      // 2 — CVE Detective (scanner + reasoner)
      setAgent('scanner', 'active', 'Fetching package manifests…')
      progress.start('scanner')
      addLog(ts(), 'CVE Detective', 'fetching requirements files from GitHub')

      const svcKey   = scope.startsWith('All')
        ? { mode: 'full_remediation' }
        : { mode: 'full_remediation', services: { [scope]: `backend-services/${scope}/requirements.txt` } }
      const scanRes  = await triggerScan(svcKey)
      const sid      = scanRes.result?.scan_id
      const total    = scanRes.result?.total_found ?? 0
      const bySvc    = scanRes.result?.by_service  ?? {}

      Object.entries(bySvc).forEach(([svc, cnt]) =>
        addLog(ts(), 'CVE Detective', `fetched ${svc} — ${cnt} finding(s)`)
      )

      setAgent('scanner', 'active', `${total} packages checked — AI reasoning auto-queued…`)
      addLog(ts(), 'CVE Detective', `found ${total} vulnerabilities — backend will auto-run reasoning + patch`, total > 0 ? 'warn' : 'info')

      progress.finish('scanner')
      setAgent('scanner', 'complete', `${total} vulnerabilities found · reasoning queued`)

      // 3 — Data Keeper
      setAgent('keeper', 'active', 'Writing findings to DynamoDB…')
      progress.start('keeper')
      addLog(ts(), 'Data Keeper', `storing ${total} records`)
      await delay(600)
      progress.finish('keeper')
      setAgent('keeper', 'complete', `${total} records saved · scan: …${sid?.slice(-8)}`)
      addLog(ts(), 'Data Keeper', 'findings stored', 'success')

      // 4 — Report
      setAgent('report', 'active', 'Generating security report…')
      progress.start('report')
      await delay(400)
      progress.finish('report')
      setAgent('report', 'complete', 'Security report ready to view')

      if (total === 0) {
        addLog(ts(), 'Report', 'scan complete — no vulnerabilities found ✓', 'success')
      } else {
        addLog(ts(), 'Report', `${total} vulnerabilities found — watch Scan Results for reasoning/patch status`, 'success')
        setScanDone({ sid, total })
      }

    } catch (err) {
      setError(err.message || 'Scan failed')
      addLog(ts(), 'Error', err.message, 'error')
      setStepStates(prev => {
        const u = { ...prev }
        Object.keys(u).forEach(k => { if (u[k] === 'active') u[k] = 'error' })
        return u
      })
    } finally {
      setRunning(false)
    }
  }

  function handleCancel() {
    setRunning(false)
    setError('Cancelled by user')
    setStepStates(prev => {
      const u = { ...prev }
      Object.keys(u).forEach(k => { if (u[k] === 'active') u[k] = 'error' })
      return u
    })
  }

  function handleReset() {
    setError(null); setLogs([]); setScanDone(null)
    setStepStates(freshStates()); setStepDescs(freshDescs()); progress.reset()
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      height: '100vh',
      position: 'relative',
      display: 'flex', flexDirection: 'column',
      background: '#eaeef3',
      padding: '28px 32px',
      fontFamily: 'inherit',
      color: '#111827',
      boxSizing: 'border-box',
      overflow: 'hidden',
    }}>

      {/* ── Header row: title left | controls right ──────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexShrink: 0 }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12,
            background: 'linear-gradient(135deg, #009c99, #008c8a)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 6px 18px rgba(0,156,153,0.35)',
          }}>
            <ShieldAlert size={22} color="#fff" />
          </div>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#0f172a' }}>Security Scan</h1>
            <p style={{ fontSize: 13, color: '#334155', margin: '2px 0 0' }}>
              AI agent scanning your services for vulnerabilities
            </p>
          </div>
        </div>

        {/* Controls: scope dropdown + status badge + action button */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {/* Status badge */}
          {running && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(0,156,153,0.12)', border: '1px solid rgba(0,156,153,0.3)',
              color: '#008c8a', fontSize: 12, fontWeight: 600,
              padding: '6px 14px', borderRadius: 99,
            }}>
              <Loader2 size={11} style={{ animation: 'spin 1s linear infinite' }} />
              In Progress
            </div>
          )}
          {allDone && !running && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: 'rgba(22,163,74,0.12)', border: '1px solid rgba(22,163,74,0.3)',
              color: '#16a34a', fontSize: 12, fontWeight: 600,
              padding: '6px 14px', borderRadius: 99,
            }}>
              <CheckCircle2 size={11} /> Complete
            </div>
          )}

          {/* Scope dropdown */}
          <div style={{ position: 'relative' }}>
            <select
              value={scope}
              onChange={e => !running && setScope(e.target.value)}
              disabled={running}
              style={{
                background: '#ffffff',
                border: '1px solid #e0e5eb',
                borderRadius: 10, padding: '9px 36px 9px 14px',
                fontSize: 13, color: '#0f172a',
                cursor: running ? 'not-allowed' : 'pointer',
                appearance: 'none', outline: 'none',
                minWidth: 180,
              }}
            >
              {SERVICES.map(s => (
                <option key={s} value={s} style={{ background: '#ffffff', color: '#0f172a' }}>{s}</option>
              ))}
            </select>
            <svg style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }}
              width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#334155" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </div>

          {/* Action button */}
          <button
            onClick={running ? handleCancel : handleStartScan}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: running ? '#fff' : 'linear-gradient(135deg, #009c99, #008c8a)',
              border: running ? '1px solid rgba(239,68,68,0.4)' : 'none',
              color: running ? '#dc2626' : '#fff',
              padding: '9px 22px', borderRadius: 10,
              fontSize: 14, fontWeight: 600, cursor: 'pointer',
              boxShadow: running ? 'none' : '0 6px 18px rgba(0,156,153,0.35)',
              transition: 'all 0.3s', whiteSpace: 'nowrap',
            }}>
            {running ? <><X size={14} /> Cancel</> : <><Play size={14} fill="#fff" /> Start Scan</>}
          </button>
        </div>
      </div>

      {/* ── Main region: [pipeline + log + agent] left · agent.tools right ── */}
      <div style={{ flex: 1, minHeight: 0, marginBottom: 16, display: 'flex', gap: 16 }}>

      {/* LEFT column — pipeline on top, log + agent below ─────────── */}
      <div style={{ flex: 2.4, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* ── Agent pipeline (only as wide as the agent console edge) ─ */}
      <div style={{
        background: '#ffffff',
        border: '1px solid #e0e5eb',
        borderRadius: 16, padding: '14px 18px',
        flexShrink: 0,
        boxShadow: '0 1px 2px rgba(16,24,40,0.05), 0 10px 24px -12px rgba(16,24,40,0.20)',
      }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: '#475569', margin: '0 0 12px', letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          Agent Pipeline
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
          {AGENTS.map((agent, idx) => (
            <AgentCard
              key={agent.id}
              agent={agent}
              state={stepStates[agent.id]}
              desc={stepDescs[agent.id]}
              pct={stepPcts[agent.id]}
              isLast={idx === AGENTS.length - 1}
            />
          ))}
        </div>
      </div>

      {/* ── Lower row: agent.log | Security Agent ─────────────────── */}
      <div style={{
        flex: 1, minHeight: 0,
        display: 'flex', gap: 16,
      }}>
      {/* ── Live scan log (left) ─────────────────────────────────── */}
      <div style={{
        flex: 1,
        minWidth: 0,
        background: '#ffffff',
        border: '1px solid #e0e5eb',
        borderRadius: 16, overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        boxShadow: '0 1px 2px rgba(16,24,40,0.05), 0 10px 24px -12px rgba(16,24,40,0.20)',
      }}>
        {/* Titlebar */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
          padding: '10px 18px', borderBottom: '1px solid #e0e5eb', background: '#e6ebf1',
        }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
            <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
          </div>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#334155', marginLeft: 6 }}>agent.log</span>
          {running && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginLeft: 4 }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', background: '#16a34a', display: 'inline-block',
                animation: 'pulse 1.5s infinite',
              }} />
              <span style={{ fontSize: 11, color: '#16a34a', fontWeight: 600 }}>Live</span>
            </div>
          )}
        </div>

        {/* Log content — scrollable, fills rest of panel */}
        <div style={{
          flex: 1, overflowY: 'auto',
          padding: '14px 20px', fontFamily: 'monospace', fontSize: 12,
          display: 'flex', flexDirection: 'column', gap: 5,
        }}>
          {logs.length === 0 && (
            <span style={{ color: '#475569', fontStyle: 'italic' }}>
              $ waiting for scan to start…
            </span>
          )}
          {logs.map((entry, i) => (
            <div key={i} style={{ display: 'flex', gap: 0 }}>
              <span style={{ color: '#475569', marginRight: 8, flexShrink: 0 }}>[{entry.ts}]</span>
              <span style={{
                marginRight: 8, fontWeight: 700, flexShrink: 0,
                color: entry.type === 'error'   ? '#dc2626' :
                       entry.type === 'warn'    ? '#d97706' :
                       entry.type === 'success' ? '#16a34a' : '#008c8a',
              }}>{entry.label}</span>
              <span style={{ color: '#334155' }}>{entry.msg}</span>
            </div>
          ))}
          {running && <span style={{ color: '#cbd5e1' }}>▌</span>}
          <div ref={logEndRef} />
        </div>
      </div>

        {/* ── Security Agent console (center) ─────────────────────── */}
        <AgentConsole
          service={scope.startsWith('All') ? '' : scope}
          scanId={scanDone?.sid}
          tools={toolHandlers}
        />
      </div>{/* end lower row */}
      </div>{/* end LEFT column */}

      {/* ── agent.tools — full height (right) ──────────────────────── */}
      <AgentToolTerminal events={toolEvents} onClear={() => setToolEvents([])} />
      </div>{/* end main region */}

      {/* ── Scan complete banner ────────────────────────────────── */}
      {scanDone && !running && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'rgba(22,163,74,0.08)', border: '1px solid rgba(22,163,74,0.25)',
          borderRadius: 12, padding: '12px 20px', marginBottom: 12, flexShrink: 0,
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CheckCircle2 size={16} color="#16a34a" />
            <span style={{ fontSize: 13, color: '#0f172a' }}>
              Scan complete —{' '}
              <strong style={{ color: '#dc2626' }}>{scanDone.total} vulnerabilities</strong>
              {' '}found &nbsp;·&nbsp;{' '}
              <span style={{ color: '#16a34a' }}>AI reasoning + auto-patch started</span>
            </span>
          </div>
          <button
            onClick={() => navigate('/security/dashboard')}
            style={{
              background: 'linear-gradient(135deg, #009c99, #008c8a)',
              border: 'none', color: '#fff',
              padding: '8px 20px', borderRadius: 8,
              fontSize: 13, fontWeight: 600, cursor: 'pointer',
              boxShadow: '0 4px 14px rgba(0,156,153,0.35)',
              whiteSpace: 'nowrap',
            }}>
            View Results →
          </button>
        </div>
      )}

      {/* ── Bottom bar: error / step indicator ───────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          {error && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)',
              borderRadius: 10, padding: '8px 14px',
            }}>
              <AlertTriangle size={13} color="#dc2626" />
              <span style={{ fontSize: 13, color: '#dc2626' }}>{error}</span>
              <button onClick={handleReset} style={{
                marginLeft: 6, fontSize: 11, color: '#dc2626',
                background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline',
              }}>Reset</button>
            </div>
          )}
        </div>

        {/* Step indicator  1 — 2 — 3 — 4 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 0 }}>
          {AGENTS.map((agent, idx) => {
            const state    = stepStates[agent.id]
            const isDone   = state === 'complete'
            const isActive = state === 'active'
            const numColor = isDone ? '#16a34a' : isActive ? '#008c8a' : '#475569'
            const numBg    = isDone ? 'rgba(22,163,74,0.12)' : isActive ? 'rgba(0,156,153,0.12)' : '#ffffff'
            const numBorder= isDone ? '#16a34a' : isActive ? '#009c99' : '#d6dce3'
            return (
              <div key={agent.id} style={{ display: 'flex', alignItems: 'center' }}>
                <div style={{
                  width: 30, height: 30, borderRadius: '50%',
                  background: numBg, border: `2px solid ${numBorder}`,
                  color: numColor, fontSize: 12, fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.4s',
                  boxShadow: isActive ? `0 0 10px ${agent.color}44` : 'none',
                }}>{idx + 1}</div>
                {idx < AGENTS.length - 1 && (
                  <div style={{
                    width: 40, height: 2,
                    background: isDone ? '#16a34a55' : '#e0e5eb',
                    margin: '0 2px',
                    transition: 'background 0.4s',
                  }} />
                )}
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}

// ── AgentCard ─────────────────────────────────────────────────────────────────
function AgentCard({ agent, state, desc, pct }) {
  const { Icon, color, glow, label } = agent
  const isActive   = state === 'active'
  const isComplete = state === 'complete'
  const isError    = state === 'error'

  const activeColor = isComplete ? '#22c55e' : isError ? '#ef4444' : color
  const activeGlow  = isComplete ? 'rgba(34,197,94,0.4)'  : isError ? 'rgba(239,68,68,0.35)' : glow

  // Card: always show a subtle colour border + glow; stronger when active
  const cardBorder = isActive   ? `${activeColor}99` :
                     isComplete ? '#22c55e66'         :
                     isError    ? '#ef444466'         : `${color}66`

  const cardShadow = isActive
    ? `0 8px 28px ${activeGlow}, 0 2px 6px rgba(16,24,40,0.06)`
    : `0 1px 3px rgba(16,24,40,0.06), 0 6px 18px -8px ${glow}`   // subtle resting colour glow

  // Icon circle
  const iconBg     = isActive   ? `${activeColor}25` :
                     isComplete ? 'rgba(34,197,94,0.2)' :
                     isError    ? 'rgba(239,68,68,0.2)' : `${color}18`

  const iconBorder = isActive   ? `${activeColor}88` :
                     isComplete ? '#22c55e66'         :
                     isError    ? '#ef444466'         : `${color}44`

  const iconShadow = isActive
    ? `0 4px 18px ${activeGlow}`
    : 'none'

  const iconColor  = isComplete ? '#22c55e' : isError ? '#ef4444' : color

  // Badge
  const badgeBg    = isActive   ? `${color}30`            :
                     isComplete ? 'rgba(34,197,94,0.2)'   :
                     isError    ? 'rgba(239,68,68,0.2)'   : `${color}15`
  const badgeColor = isComplete ? '#22c55e' : isError ? '#f87171' : color
  const badgeLabel = isActive   ? 'Scanning…' :
                     isComplete ? 'Complete ✓' :
                     isError    ? 'Error'      : 'Waiting'

  return (
    <div style={{
      background: '#ffffff',
      border: `1.5px solid ${cardBorder}`,
      borderRadius: 16,
      padding: '20px 14px',
      display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center',
      boxShadow: cardShadow,
      transition: 'all 0.4s ease',
    }}>

      {/* Icon circle — always glowing */}
      <div style={{
        width: 74, height: 74, borderRadius: '50%',
        background: iconBg,
        border: `2px solid ${iconBorder}`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        marginBottom: 14,
        boxShadow: iconShadow,
        transition: 'all 0.4s ease',
      }}>
        {isActive
          ? <Loader2 size={32} color={color} style={{ animation: 'spin 1s linear infinite' }} />
          : isComplete
          ? <CheckCircle2 size={32} color="#22c55e" />
          : isError
          ? <AlertTriangle size={32} color="#ef4444" />
          : <Icon size={32} color={iconColor} />
        }
      </div>

      {/* Name */}
      <p style={{ fontWeight: 700, fontSize: 13, margin: '0 0 8px', color: '#0f172a' }}>
        {label}
      </p>

      {/* Status badge */}
      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 5,
        background: badgeBg, color: badgeColor,
        fontSize: 11, fontWeight: 600,
        padding: '4px 10px', borderRadius: 99, marginBottom: 10,
        border: `1px solid ${badgeColor}44`,
      }}>
        {isActive && (
          <span style={{
            width: 6, height: 6, borderRadius: '50%',
            background: color, display: 'inline-block',
            animation: 'pulse 1.2s infinite',
          }} />
        )}
        {badgeLabel}
      </div>

      {/* Progress bar — only when active */}
      {isActive && (
        <div style={{ width: '100%', marginBottom: 8 }}>
          <div style={{ height: 4, background: '#eef2f5', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99,
              background: `linear-gradient(90deg, ${color}, ${color}bb)`,
              width: `${pct}%`,
              transition: 'width 0.4s ease',
              boxShadow: `0 0 10px ${glow}`,
            }} />
          </div>
          <p style={{ fontSize: 10, color: '#334155', margin: '4px 0 0', textAlign: 'right' }}>{pct}%</p>
        </div>
      )}

      {/* Description */}
      <p style={{ fontSize: 11, color: '#334155', lineHeight: 1.5, margin: 0 }}>{desc}</p>
    </div>
  )
}
