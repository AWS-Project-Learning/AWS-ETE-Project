import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Play, X, ChevronDown, Bot, Search, Database, FileBarChart2,
  CheckCircle2, Loader2, AlertTriangle, ShieldAlert,
} from 'lucide-react'
import { triggerScan, triggerReason } from '../api/client'

// ── Agent step definitions — each has its own colour identity ─────────────────
const STEPS = [
  {
    id:      'orchestrator',
    label:   'Orchestrator',
    sublabel:'Coordinates the scan workflow',
    Icon:    Bot,
    color:   { bg: 'bg-indigo-50',  icon: 'text-indigo-600', ring: 'ring-indigo-200',  badge: 'bg-indigo-600',  progress: 'bg-indigo-500'  },
  },
  {
    id:      'scanner',
    label:   'Security Scanner',
    sublabel:'Checks packages for known vulnerabilities',
    Icon:    Search,
    color:   { bg: 'bg-blue-50',    icon: 'text-blue-600',   ring: 'ring-blue-200',    badge: 'bg-blue-600',    progress: 'bg-blue-500'    },
  },
  {
    id:      'analyst',
    label:   'AI Analyst',
    sublabel:'Analyses risk and recommends actions',
    Icon:    Bot,
    color:   { bg: 'bg-violet-50',  icon: 'text-violet-600', ring: 'ring-violet-200',  badge: 'bg-violet-600',  progress: 'bg-violet-500'  },
  },
  {
    id:      'keeper',
    label:   'Data Keeper',
    sublabel:'Saves findings to the security store',
    Icon:    Database,
    color:   { bg: 'bg-teal-50',    icon: 'text-teal-600',   ring: 'ring-teal-200',    badge: 'bg-teal-600',    progress: 'bg-teal-500'    },
  },
  {
    id:      'report',
    label:   'Report',
    sublabel:'Results ready to review',
    Icon:    FileBarChart2,
    color:   { bg: 'bg-emerald-50', icon: 'text-emerald-600',ring: 'ring-emerald-200', badge: 'bg-emerald-600', progress: 'bg-emerald-500' },
  },
]

const SERVICES = ['All Services', 'order-service', 'invoice-service', 'bff']

const idleStates = () => Object.fromEntries(STEPS.map(s => [s.id, 'idle']))
const idleSubs   = () => Object.fromEntries(STEPS.map(s => [s.id, s.sublabel]))

export default function SecurityScan() {
  const navigate  = useNavigate()
  const logEndRef = useRef(null)

  const [scope,      setScope]      = useState('All Services')
  const [dropOpen,   setDropOpen]   = useState(false)
  const [running,    setRunning]    = useState(false)
  const [stepStates, setStepStates] = useState(idleStates)
  const [stepSubs,   setStepSubs]   = useState(idleSubs)
  const [logs,       setLogs]       = useState([])
  const [error,      setError]      = useState(null)

  useEffect(() => { logEndRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [logs])

  const addLog = (msg, type = 'info') => {
    const ts = new Date().toLocaleTimeString('en-AU', { hour12: false })
    setLogs(prev => [...prev, { ts, msg, type }])
  }

  const setStep = (id, state, sub) => {
    setStepStates(prev => ({ ...prev, [id]: state }))
    if (sub) setStepSubs(prev => ({ ...prev, [id]: sub }))
  }

  const completedCount = Object.values(stepStates).filter(s => s === 'complete').length
  const progressPct    = running ? Math.round((completedCount / STEPS.length) * 100) : completedCount === STEPS.length ? 100 : 0

  async function handleStartScan() {
    setRunning(true); setError(null); setLogs([])
    setStepStates(idleStates()); setStepSubs(idleSubs())

    try {
      // Step 1 — Orchestrator
      setStep('orchestrator', 'active', 'Initialising scan workflow...')
      addLog(`Orchestrator started — scope: ${scope}`)
      await delay(600)
      setStep('orchestrator', 'complete', 'Scan workflow initiated')

      // Step 2 — Security Scanner
      setStep('scanner', 'active', 'Fetching package manifests from GitHub...')
      addLog('Security Scanner — fetching requirements files from GitHub')
      await delay(400)
      addLog('Security Scanner — querying OSV.dev vulnerability database')
      setStep('scanner', 'active', 'Querying OSV.dev for known CVEs...')

      const apiScope   = scope === 'All Services' ? {} : { services: { [scope]: `backend-services/${scope}/requirements.txt` } }
      const scanResult = await triggerScan(apiScope)
      const sid   = scanResult.result?.scan_id
      const total = scanResult.result?.total_found ?? 0
      const bySvc = scanResult.result?.by_service ?? {}

      setStep('scanner', 'complete', `${total} vulnerabilities found`)
      addLog(`Security Scanner complete — ${total} vulnerabilities found`, total > 0 ? 'warn' : 'success')
      Object.entries(bySvc).forEach(([svc, cnt]) => addLog(`  └─ ${svc}: ${cnt} finding(s)`))

      // Step 3 — AI Analyst
      setStep('analyst', 'active', 'Running Bedrock Claude reasoning...')
      addLog('AI Analyst — sending findings to Bedrock Claude')
      const reasonResult = await triggerReason(sid)
      const { auto_patch = 0, escalate = 0, ignore = 0 } = reasonResult.result ?? {}
      setStep('analyst', 'complete', `${auto_patch} auto-patch · ${escalate} escalate · ${ignore} ignore`)
      addLog(`AI Analyst — ${auto_patch} AUTO_PATCH  ${escalate} ESCALATE  ${ignore} IGNORE`, 'success')

      // Step 4 — Data Keeper
      setStep('keeper', 'active', 'Persisting findings to DynamoDB...')
      addLog('Data Keeper — writing results to security store')
      await delay(500)
      setStep('keeper', 'complete', `${total} records saved · scan_id: ${sid?.slice(-8)}`)
      addLog(`Data Keeper — ${total} records saved`, 'success')

      // Step 5 — Report
      setStep('report', 'complete', 'Security report ready to view')
      addLog('All done — navigating to Security Dashboard...', 'success')
      await delay(1200)
      navigate('/security/dashboard')

    } catch (err) {
      setError(err.message || 'Scan failed')
      addLog(`✗ Error: ${err.message}`, 'error')
      setStepStates(prev => {
        const u = { ...prev }
        for (const k of Object.keys(u)) { if (u[k] === 'active') u[k] = 'error' }
        return u
      })
    } finally {
      setRunning(false)
    }
  }

  const allDone = Object.values(stepStates).every(s => s === 'complete')

  return (
    <div className="min-h-screen bg-gray-50 p-8">

      {/* ── Page header ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between mb-8">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-200">
            <ShieldAlert size={24} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Security Scan</h1>
            <p className="text-sm text-gray-500 mt-0.5">
              AI agent scanning your services for known vulnerabilities
            </p>
          </div>
        </div>

        {/* Status pill */}
        <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-semibold border
          ${running   ? 'bg-blue-50 text-blue-700 border-blue-200' :
            error     ? 'bg-red-50 text-red-700 border-red-200' :
            allDone   ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                        'bg-gray-100 text-gray-500 border-gray-200'}`}>
          {running && <Loader2 size={14} className="animate-spin" />}
          {allDone && !running && <CheckCircle2 size={14} />}
          {error && <AlertTriangle size={14} />}
          <span>
            {running ? 'Scan in progress' : error ? 'Scan failed' : allDone ? 'Complete' : 'Ready'}
          </span>
        </div>
      </div>

      {/* ── Controls ────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6">
        {/* Scope dropdown */}
        <div className="relative">
          <button
            onClick={() => setDropOpen(o => !o)}
            disabled={running}
            className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 shadow-sm transition min-w-[180px]"
          >
            <span className="flex-1 text-left">{scope}</span>
            <ChevronDown size={14} className={`text-gray-400 transition-transform ${dropOpen ? 'rotate-180' : ''}`} />
          </button>
          {dropOpen && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-100 rounded-xl shadow-xl overflow-hidden">
              {SERVICES.map(s => (
                <button key={s} onClick={() => { setScope(s); setDropOpen(false) }}
                  className={`w-full text-left px-4 py-2.5 text-sm transition hover:bg-gray-50
                    ${scope === s ? 'text-indigo-600 font-semibold bg-indigo-50' : 'text-gray-700'}`}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {!running
          ? <button onClick={handleStartScan}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-6 py-2.5 rounded-xl text-sm font-semibold transition shadow-md shadow-indigo-200 active:scale-95">
              <Play size={14} fill="white" />
              Start Scan
            </button>
          : <button onClick={() => { setRunning(false); setError('Cancelled'); setStepStates(idleStates()) }}
              className="flex items-center gap-2 bg-white border border-gray-200 text-gray-500 hover:text-red-500 hover:border-red-200 px-4 py-2.5 rounded-xl text-sm font-medium transition shadow-sm">
              <X size={14} />
              Cancel
            </button>
        }
      </div>

      {/* ── Overall progress bar ────────────────────────────────── */}
      {(running || allDone) && (
        <div className="mb-6">
          <div className="flex justify-between text-xs text-gray-400 mb-1.5">
            <span>Pipeline progress</span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-700"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>
      )}

      {/* ── Agent pipeline cards ────────────────────────────────── */}
      <div className="grid grid-cols-5 gap-4 mb-5">
        {STEPS.map((step, idx) => {
          const state = stepStates[step.id]
          const c     = step.color
          const Icon  = step.Icon
          const isActive   = state === 'active'
          const isComplete = state === 'complete'
          const isError    = state === 'error'

          return (
            <div key={step.id} className="relative">
              {/* Connector line */}
              {idx < STEPS.length - 1 && (
                <div className="absolute top-10 left-full w-4 h-px bg-gray-200 z-10 hidden xl:block" />
              )}

              <div className={`bg-white rounded-2xl border-2 p-5 flex flex-col items-center text-center transition-all duration-500 shadow-sm
                ${isActive   ? `border-current ${c.ring} ring-2 shadow-md` :
                  isComplete ? 'border-emerald-200 shadow-sm' :
                  isError    ? 'border-red-200' :
                               'border-gray-100'}`}>

                {/* Icon circle */}
                <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-4 transition-all duration-300
                  ${isActive   ? `${c.bg} ring-4 ${c.ring}` :
                    isComplete ? 'bg-emerald-50 ring-4 ring-emerald-100' :
                    isError    ? 'bg-red-50' :
                                 'bg-gray-50'}`}>
                  {isActive
                    ? <Loader2 size={28} className={`${c.icon} animate-spin`} />
                    : isComplete
                    ? <CheckCircle2 size={28} className="text-emerald-500" />
                    : isError
                    ? <AlertTriangle size={28} className="text-red-500" />
                    : <Icon size={28} className={state === 'idle' ? 'text-gray-300' : c.icon} />
                  }
                </div>

                {/* Step number */}
                <div className={`w-5 h-5 rounded-full text-xs font-bold flex items-center justify-center mb-2
                  ${isComplete ? `${c.badge} text-white` :
                    isActive   ? `${c.badge} text-white` :
                                 'bg-gray-100 text-gray-400'}`}>
                  {idx + 1}
                </div>

                {/* Label */}
                <p className={`font-semibold text-sm mb-1 leading-tight
                  ${isActive ? 'text-gray-900' : isComplete ? 'text-gray-800' : 'text-gray-400'}`}>
                  {step.label}
                </p>

                {/* Status badge */}
                <span className={`inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-medium mb-2
                  ${isActive   ? `${c.bg} ${c.icon}` :
                    isComplete ? 'bg-emerald-50 text-emerald-600' :
                    isError    ? 'bg-red-50 text-red-600' :
                                 'bg-gray-50 text-gray-400'}`}>
                  {isActive && <span className="w-1.5 h-1.5 rounded-full bg-current animate-pulse" />}
                  {isActive ? 'Running' : isComplete ? '✓ Done' : isError ? 'Error' : 'Waiting'}
                </span>

                {/* Sublabel */}
                <p className="text-xs text-gray-400 leading-snug">{stepSubs[step.id]}</p>
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Live log terminal ───────────────────────────────────── */}
      <div className="bg-gray-900 rounded-2xl overflow-hidden shadow-lg">
        {/* Terminal header */}
        <div className="flex items-center gap-2 px-5 py-3 border-b border-gray-800">
          <div className="flex gap-1.5">
            <span className="w-3 h-3 rounded-full bg-red-500" />
            <span className="w-3 h-3 rounded-full bg-yellow-500" />
            <span className="w-3 h-3 rounded-full bg-green-500" />
          </div>
          <div className="flex items-center gap-2 ml-3">
            <span className={`w-2 h-2 rounded-full ${running ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
            <span className="text-gray-400 text-xs font-mono">
              {running ? 'agent.log — live' : 'agent.log'}
            </span>
          </div>
        </div>

        {/* Log content */}
        <div className="px-5 py-4 font-mono text-xs min-h-[140px] max-h-48 overflow-y-auto space-y-1.5">
          {logs.length === 0 && (
            <p className="text-gray-600 italic">$ waiting for scan to start...</p>
          )}
          {logs.map((entry, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-gray-600 shrink-0 select-none">{entry.ts}</span>
              <span className={
                entry.type === 'error'   ? 'text-red-400'     :
                entry.type === 'warn'    ? 'text-yellow-400'  :
                entry.type === 'success' ? 'text-emerald-400' : 'text-gray-300'
              }>{entry.msg}</span>
            </div>
          ))}
          {running && (
            <div className="flex gap-3">
              <span className="text-gray-600 select-none">{new Date().toLocaleTimeString('en-AU', { hour12: false })}</span>
              <span className="text-gray-500 animate-pulse">▌</span>
            </div>
          )}
          <div ref={logEndRef} />
        </div>
      </div>

      {/* ── Error banner ─────────────────────────────────────────── */}
      {error && (
        <div className="mt-4 flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle size={15} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600 flex-1">{error}</p>
          <button
            onClick={() => { setError(null); setLogs([]); setStepStates(idleStates()); setStepSubs(idleSubs()) }}
            className="text-xs text-red-400 hover:text-red-600 underline"
          >
            Reset
          </button>
        </div>
      )}
    </div>
  )
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }
