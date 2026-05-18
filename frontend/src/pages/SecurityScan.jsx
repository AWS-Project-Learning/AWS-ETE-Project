import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Play, X, ChevronDown, Bot, Search, Database, FileBarChart2,
  CheckCircle2, Loader2, AlertTriangle,
} from 'lucide-react'
import { triggerScan, triggerReason } from '../api/client'

// NOTE: These calls go to /security/* — CloudFront → ALB → Lambda directly.
// The BFF is not involved at all.

const STEPS = [
  { id: 'orchestrator', label: 'Orchestrator',     sublabel: 'Coordinates the scan workflow',              Icon: Bot           },
  { id: 'scanner',      label: 'Security Scanner', sublabel: 'Checks packages for known vulnerabilities',  Icon: Search        },
  { id: 'analyst',      label: 'AI Analyst',       sublabel: 'Analyses risk and recommends actions',       Icon: Bot           },
  { id: 'keeper',       label: 'Data Keeper',      sublabel: 'Saves findings to the security store',       Icon: Database      },
  { id: 'report',       label: 'Report',           sublabel: 'Results ready to review',                    Icon: FileBarChart2 },
]

const STATUS_STYLE = {
  idle:     { ring: 'ring-gray-700',    badge: 'bg-gray-700 text-gray-400',          icon: 'text-gray-500'    },
  active:   { ring: 'ring-blue-500',   badge: 'bg-blue-600/20 text-blue-400',        icon: 'text-blue-400'    },
  complete: { ring: 'ring-emerald-500', badge: 'bg-emerald-600/20 text-emerald-400', icon: 'text-emerald-400' },
  error:    { ring: 'ring-red-500',    badge: 'bg-red-600/20 text-red-400',          icon: 'text-red-400'     },
}

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

  async function handleStartScan() {
    setRunning(true); setError(null); setLogs([])
    setStepStates(idleStates()); setStepSubs(idleSubs())

    try {
      // Step 1 — Orchestrator
      setStep('orchestrator', 'active', 'Initialising scan workflow...')
      addLog(`Orchestrator — scope: ${scope}`)
      await delay(500)
      setStep('orchestrator', 'complete', 'Scan workflow initiated')

      // Step 2 — Security Scanner
      setStep('scanner', 'active', 'Fetching package manifests from GitHub...')
      addLog('Security Scanner — fetching requirements files from GitHub')
      await delay(300)
      addLog('Security Scanner — querying OSV.dev vulnerability database')
      setStep('scanner', 'active', 'Querying OSV.dev for known CVEs...')

      const apiScope   = scope === 'All Services' ? {} : { services: { [scope]: `backend-services/${scope}/requirements.txt` } }
      const scanResult = await triggerScan(apiScope)
      const sid    = scanResult.result?.scan_id
      const total  = scanResult.result?.total_found ?? 0
      const bySvc  = scanResult.result?.by_service ?? {}

      setStep('scanner', 'complete', `${total} vulnerabilities found`)
      addLog(`Security Scanner complete — ${total} vulnerabilities found`, total > 0 ? 'warn' : 'success')
      Object.entries(bySvc).forEach(([svc, cnt]) => addLog(`  ${svc}: ${cnt} finding(s)`))

      // Step 3 — AI Analyst
      setStep('analyst', 'active', 'Running Bedrock Claude reasoning...')
      addLog('AI Analyst — analysing risk with Bedrock Claude')
      const reasonResult = await triggerReason(sid)
      const { auto_patch = 0, escalate = 0, ignore = 0 } = reasonResult.result ?? {}
      setStep('analyst', 'complete', `${auto_patch} auto-patch · ${escalate} escalate · ${ignore} ignore`)
      addLog(`AI Analyst — ${auto_patch} AUTO_PATCH, ${escalate} ESCALATE, ${ignore} IGNORE`, 'success')

      // Step 4 — Data Keeper
      setStep('keeper', 'active', 'Persisting to DynamoDB...')
      addLog('Data Keeper — writing results to security store')
      await delay(400)
      setStep('keeper', 'complete', `${total} records saved`)
      addLog(`Data Keeper — saved ${total} records`, 'success')

      // Step 5 — Report
      setStep('report', 'complete', 'Security report ready to view')
      addLog('Done — navigating to Security Dashboard...', 'success')
      await delay(1200)
      navigate('/security/dashboard')

    } catch (err) {
      setError(err.message || 'Scan failed')
      addLog(`Error: ${err.message}`, 'error')
      setStepStates(prev => {
        const u = { ...prev }
        for (const k of Object.keys(u)) { if (u[k] === 'active') u[k] = 'error' }
        return u
      })
    } finally {
      setRunning(false)
    }
  }

  const overallStatus = running ? 'In Progress' : error ? 'Failed' : logs.length > 0 ? 'Complete' : 'Ready'

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Security Scan</h1>
        <p className="text-sm text-gray-500 mt-1">
          AI agent scanning your services for known vulnerabilities
        </p>
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 mb-5 flex-wrap">
        <div className="relative">
          <button
            onClick={() => setDropOpen(o => !o)}
            disabled={running}
            className="flex items-center gap-2 bg-white border border-gray-200 rounded-xl px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 shadow-sm min-w-[180px]"
          >
            <span className="flex-1 text-left">{scope}</span>
            <ChevronDown size={14} className={`transition-transform text-gray-400 ${dropOpen ? 'rotate-180' : ''}`} />
          </button>
          {dropOpen && (
            <div className="absolute z-20 mt-1 w-full bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
              {SERVICES.map(s => (
                <button key={s} onClick={() => { setScope(s); setDropOpen(false) }}
                  className={`w-full text-left px-4 py-2.5 text-sm hover:bg-gray-50 transition
                    ${scope === s ? 'text-indigo-600 font-medium' : 'text-gray-700'}`}>
                  {s}
                </button>
              ))}
            </div>
          )}
        </div>

        {!running
          ? <button onClick={handleStartScan}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold transition shadow">
              <Play size={14} fill="white" /> Start Scan
            </button>
          : <div className="flex items-center gap-2 text-indigo-600 text-sm font-medium">
              <Loader2 size={16} className="animate-spin" /> Scanning...
            </div>
        }

        <span className={`ml-auto px-3 py-1.5 rounded-full text-xs font-semibold
          ${overallStatus === 'In Progress' ? 'bg-blue-100 text-blue-700 animate-pulse' :
            overallStatus === 'Complete'    ? 'bg-green-100 text-green-700' :
            overallStatus === 'Failed'      ? 'bg-red-100 text-red-700' :
                                              'bg-gray-100 text-gray-500'}`}>
          {overallStatus}
        </span>
      </div>

      {/* Agent Pipeline */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-4">
        <h2 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-5">Agent Pipeline</h2>
        <div className="flex items-stretch gap-2 overflow-x-auto pb-2">
          {STEPS.map((step, idx) => {
            const state  = stepStates[step.id]
            const styles = STATUS_STYLE[state]
            const Icon   = step.Icon
            return (
              <div key={step.id} className="flex items-center gap-2 flex-1 min-w-[130px]">
                <div className={`flex-1 rounded-2xl border-2 p-4 transition-all duration-500 bg-gray-50 ${styles.ring} ring-2`}>
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center mb-3 mx-auto
                    ${state === 'active'   ? 'bg-blue-50'    :
                      state === 'complete' ? 'bg-green-50'   :
                      state === 'error'    ? 'bg-red-50'     : 'bg-gray-100'}`}>
                    {state === 'active'   ? <Loader2       size={22} className="text-blue-500 animate-spin" /> :
                     state === 'complete' ? <CheckCircle2  size={22} className="text-green-500" /> :
                     state === 'error'    ? <AlertTriangle size={22} className="text-red-500" /> :
                                           <Icon          size={22} className={styles.icon} />}
                  </div>
                  <p className="text-center text-sm font-semibold text-gray-800 mb-1">{step.label}</p>
                  <div className={`text-center text-xs px-2 py-0.5 rounded-full mx-auto inline-block mb-2 ${styles.badge}`}>
                    {state === 'idle' ? 'Waiting' : state === 'active' ? 'Running...' : state === 'complete' ? 'Complete ✓' : 'Error'}
                  </div>
                  <p className="text-center text-xs text-gray-400 leading-snug">{stepSubs[step.id]}</p>
                </div>
                {idx < STEPS.length - 1 && (
                  <svg width="18" height="18" viewBox="0 0 20 20" fill="none" className="text-gray-300 shrink-0">
                    <path d="M4 10h12M12 6l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Live log */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center gap-2 mb-3">
          <span className={`w-2 h-2 rounded-full ${running ? 'bg-green-400 animate-pulse' : 'bg-gray-300'}`} />
          <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">
            {running ? 'Live Log' : 'Log'}
          </span>
        </div>
        <div className="font-mono text-xs space-y-1 max-h-48 overflow-y-auto">
          {logs.length === 0 && <p className="text-gray-400 italic">Waiting for scan to start...</p>}
          {logs.map((entry, i) => (
            <div key={i} className="flex gap-3">
              <span className="text-gray-400 shrink-0">[{entry.ts}]</span>
              <span className={
                entry.type === 'error'   ? 'text-red-600'   :
                entry.type === 'warn'    ? 'text-amber-600' :
                entry.type === 'success' ? 'text-green-600' : 'text-gray-600'
              }>{entry.msg}</span>
            </div>
          ))}
          <div ref={logEndRef} />
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertTriangle size={15} className="text-red-500 shrink-0" />
          <p className="text-sm text-red-600">{error}</p>
          <button onClick={() => { setError(null); setLogs([]); setStepStates(idleStates()) }}
            className="ml-auto text-xs text-red-400 hover:text-red-600 flex items-center gap-1">
            <X size={12} /> Reset
          </button>
        </div>
      )}
    </div>
  )
}

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }
