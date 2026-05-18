import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Play, X, Plus, Trash2, Bot, Search, Database, FileBarChart2,
  CheckCircle2, Loader2, AlertTriangle, ChevronDown,
} from 'lucide-react'
import { triggerScan, triggerReason } from '../api/agent'

// ── Agent pipeline steps ───────────────────────────────────────────────────────
const STEPS = [
  { id: 'orchestrator', label: 'Orchestrator',      sublabel: 'Coordinates the scan workflow',               Icon: Bot            },
  { id: 'scanner',      label: 'Security Scanner',  sublabel: 'Checks packages for known vulnerabilities',   Icon: Search         },
  { id: 'analyst',      label: 'AI Analyst',        sublabel: 'Analyses risk and recommends actions',        Icon: Bot            },
  { id: 'keeper',       label: 'Data Keeper',       sublabel: 'Saves findings to the security store',        Icon: Database       },
  { id: 'report',       label: 'Report',            sublabel: 'Results ready to review',                     Icon: FileBarChart2  },
]

const RING = {
  idle:     'ring-gray-700',
  active:   'ring-blue-500',
  complete: 'ring-emerald-500',
  error:    'ring-red-500',
}

const BADGE = {
  idle:     'bg-gray-700 text-gray-400',
  active:   'bg-blue-600/20 text-blue-400',
  complete: 'bg-emerald-600/20 text-emerald-400',
  error:    'bg-red-600/20 text-red-400',
}

export default function ScanPage() {
  const navigate  = useNavigate()
  const logEndRef = useRef(null)

  // ── Scan target config — fully dynamic ─────────────────────────────────────
  const [repoOwner,  setRepoOwner]  = useState('AWS-Project-Learning')
  const [repoName,   setRepoName]   = useState('AWS-ETE-Project')
  const [repoBranch, setRepoBranch] = useState('main')
  // Custom services — each row is { name, path }
  const [customServices, setCustomServices] = useState([])
  const [useCustomSvcs,  setUseCustomSvcs]  = useState(false)

  // ── Pipeline state ─────────────────────────────────────────────────────────
  const [running,    setRunning]    = useState(false)
  const [stepStates, setStepStates] = useState(idleSteps)
  const [stepSubs,   setStepSubs]   = useState(defaultSubs)
  const [logs,       setLogs]       = useState([])
  const [error,      setError]      = useState(null)

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs])

  function addLog(msg, type = 'info') {
    const ts = new Date().toLocaleTimeString('en-AU', { hour12: false })
    setLogs(prev => [...prev, { ts, msg, type }])
  }

  function setStep(id, state, sub) {
    setStepStates(prev => ({ ...prev, [id]: state }))
    if (sub) setStepSubs(prev => ({ ...prev, [id]: sub }))
  }

  function addServiceRow() {
    setCustomServices(prev => [...prev, { name: '', path: '' }])
  }

  function removeServiceRow(i) {
    setCustomServices(prev => prev.filter((_, idx) => idx !== i))
  }

  function updateServiceRow(i, field, value) {
    setCustomServices(prev => prev.map((row, idx) => idx === i ? { ...row, [field]: value } : row))
  }

  async function handleStartScan() {
    setRunning(true)
    setError(null)
    setLogs([])
    setStepStates(idleSteps)
    setStepSubs(defaultSubs)

    // Build the scan config — only include fields that differ from Lambda defaults
    const config = {}
    if (repoOwner)  config.repo_owner  = repoOwner
    if (repoName)   config.repo_name   = repoName
    if (repoBranch) config.repo_branch = repoBranch
    if (useCustomSvcs && customServices.length > 0) {
      config.services = Object.fromEntries(
        customServices.filter(s => s.name && s.path).map(s => [s.name, s.path])
      )
    }

    try {
      // Step 1: Orchestrator
      setStep('orchestrator', 'active', 'Initialising scan pipeline...')
      addLog(`Orchestrator — scanning ${repoOwner}/${repoName}@${repoBranch}`)
      await delay(500)
      setStep('orchestrator', 'complete', 'Scan pipeline initiated')

      // Step 2: Security Scanner
      setStep('scanner', 'active', 'Fetching package manifests from GitHub...')
      addLog('Security Scanner — fetching requirements files from GitHub')
      await delay(300)
      addLog('Security Scanner — querying OSV.dev vulnerability database')
      setStep('scanner', 'active', 'Querying OSV.dev for known CVEs...')

      const scanResult = await triggerScan(config)
      const sid    = scanResult.result?.scan_id
      const total  = scanResult.result?.total_found ?? 0
      const bySvc  = scanResult.result?.by_service ?? {}

      setStep('scanner', 'complete', `${total} vulnerabilities found`)
      addLog(`Security Scanner complete — ${total} vulnerabilities found`, total > 0 ? 'warn' : 'success')
      Object.entries(bySvc).forEach(([svc, cnt]) =>
        addLog(`  ${svc}: ${cnt} finding(s)`)
      )

      // Step 3: AI Analyst
      setStep('analyst', 'active', 'Running Bedrock Claude reasoning...')
      addLog('AI Analyst — analysing risk with Bedrock Claude')
      const reasonResult = await triggerReason(sid)
      const { auto_patch = 0, escalate = 0, ignore = 0 } = reasonResult.result ?? {}
      setStep('analyst', 'complete', `${auto_patch} auto-patch · ${escalate} escalate · ${ignore} ignore`)
      addLog(`AI Analyst — ${auto_patch} AUTO_PATCH, ${escalate} ESCALATE, ${ignore} IGNORE`, 'success')

      // Step 4: Data Keeper
      setStep('keeper', 'active', 'Persisting to DynamoDB...')
      addLog('Data Keeper — writing results to security store')
      await delay(400)
      setStep('keeper', 'complete', `${total} records saved · scan_id: ${sid}`)
      addLog(`Data Keeper — saved ${total} records`, 'success')

      // Step 5: Report
      setStep('report', 'complete', 'Security report ready')
      addLog('All done — navigating to Dashboard...', 'success')
      await delay(1000)
      navigate('/dashboard')

    } catch (err) {
      setError(err.message || 'Scan failed')
      addLog(`Error: ${err.message}`, 'error')
      setStepStates(prev => {
        const updated = { ...prev }
        for (const k of Object.keys(updated)) {
          if (updated[k] === 'active') updated[k] = 'error'
        }
        return updated
      })
    } finally {
      setRunning(false)
    }
  }

  function handleReset() {
    setRunning(false)
    setStepStates(idleSteps)
    setStepSubs(defaultSubs)
    setLogs([])
    setError(null)
  }

  return (
    <div className="min-h-screen p-6 bg-gray-950 text-gray-100">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-white">Security Scan</h1>
        <p className="text-sm text-gray-400 mt-1">
          AI agent — scan any GitHub repository for known vulnerabilities
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        {/* ── Scan config panel ─────────────────────────────── */}
        <div className="lg:col-span-1 bg-gray-900 rounded-2xl border border-gray-800 p-5">
          <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider mb-4">
            Scan Target
          </h2>

          <div className="space-y-3">
            <Field label="GitHub Owner / Org">
              <input
                value={repoOwner}
                onChange={e => setRepoOwner(e.target.value)}
                disabled={running}
                placeholder="e.g. AWS-Project-Learning"
                className={inputCls}
              />
            </Field>
            <Field label="Repository Name">
              <input
                value={repoName}
                onChange={e => setRepoName(e.target.value)}
                disabled={running}
                placeholder="e.g. AWS-ETE-Project"
                className={inputCls}
              />
            </Field>
            <Field label="Branch">
              <input
                value={repoBranch}
                onChange={e => setRepoBranch(e.target.value)}
                disabled={running}
                placeholder="main"
                className={inputCls}
              />
            </Field>

            {/* Custom services toggle */}
            <div className="pt-1">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={useCustomSvcs}
                  onChange={e => setUseCustomSvcs(e.target.checked)}
                  disabled={running}
                  className="accent-indigo-500"
                />
                <span className="text-sm text-gray-300">Custom service paths</span>
              </label>
              <p className="text-xs text-gray-600 mt-1 ml-5">
                Leave off to use the Lambda's default service list
              </p>
            </div>

            {useCustomSvcs && (
              <div className="space-y-2 pt-1">
                {customServices.map((row, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      value={row.name}
                      onChange={e => updateServiceRow(i, 'name', e.target.value)}
                      placeholder="service-name"
                      className={`${inputCls} w-1/3`}
                    />
                    <input
                      value={row.path}
                      onChange={e => updateServiceRow(i, 'path', e.target.value)}
                      placeholder="path/to/requirements.txt"
                      className={`${inputCls} flex-1`}
                    />
                    <button
                      onClick={() => removeServiceRow(i)}
                      className="text-gray-600 hover:text-red-400 transition"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  onClick={addServiceRow}
                  className="flex items-center gap-1.5 text-xs text-indigo-400 hover:text-indigo-300 transition"
                >
                  <Plus size={13} />
                  Add service
                </button>
              </div>
            )}
          </div>

          {/* Start button */}
          <div className="mt-5 flex gap-2">
            {!running ? (
              <button
                onClick={handleStartScan}
                className="flex-1 flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white py-2.5 rounded-xl text-sm font-semibold transition"
              >
                <Play size={14} fill="white" />
                Start Scan
              </button>
            ) : (
              <>
                <div className="flex-1 flex items-center justify-center gap-2 text-blue-400 text-sm font-medium py-2.5 bg-blue-600/10 rounded-xl">
                  <Loader2 size={14} className="animate-spin" />
                  Scanning...
                </div>
                <button
                  onClick={handleReset}
                  className="px-3 py-2.5 rounded-xl bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-red-400 transition"
                >
                  <X size={14} />
                </button>
              </>
            )}
          </div>
        </div>

        {/* ── Pipeline + log ────────────────────────────────── */}
        <div className="lg:col-span-2 flex flex-col gap-4">
          {/* Agent pipeline */}
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-5">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-semibold text-gray-400 uppercase tracking-wider">
                Agent Pipeline
              </h2>
              <span className={`text-xs px-3 py-1 rounded-full font-semibold
                ${running ? 'bg-blue-600/20 text-blue-400 animate-pulse' :
                  error   ? 'bg-red-600/20 text-red-400' :
                  logs.length > 0 ? 'bg-emerald-600/20 text-emerald-400' :
                                    'bg-gray-700 text-gray-400'}`}>
                {running ? 'In Progress' : error ? 'Failed' : logs.length > 0 ? 'Complete' : 'Ready'}
              </span>
            </div>

            <div className="flex items-stretch gap-2 overflow-x-auto pb-1">
              {STEPS.map((step, idx) => {
                const state = stepStates[step.id]
                const Icon  = step.Icon
                return (
                  <div key={step.id} className="flex items-center gap-2 flex-1 min-w-[120px]">
                    <div className={`flex-1 rounded-xl border-2 p-3 transition-all duration-500 bg-gray-800/60 ${RING[state]} ring-2`}>
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-2 mx-auto
                        ${state === 'active'   ? 'bg-blue-600/20'    :
                          state === 'complete' ? 'bg-emerald-600/20' :
                          state === 'error'    ? 'bg-red-600/20'     : 'bg-gray-700/50'}`}>
                        {state === 'active'   ? <Loader2 size={20} className="text-blue-400 animate-spin" /> :
                         state === 'complete' ? <CheckCircle2 size={20} className="text-emerald-400" /> :
                         state === 'error'    ? <AlertTriangle size={20} className="text-red-400" /> :
                                               <Icon size={20} className="text-gray-500" />}
                      </div>
                      <p className="text-center text-xs font-semibold text-white mb-1">{step.label}</p>
                      <span className={`block text-center text-xs px-1.5 py-0.5 rounded-full mx-auto mb-1.5 ${BADGE[state]}`}>
                        {state === 'idle' ? 'Waiting' : state === 'active' ? 'Running...' : state === 'complete' ? 'Done ✓' : 'Error'}
                      </span>
                      <p className="text-center text-xs text-gray-600 leading-tight">{stepSubs[step.id]}</p>
                    </div>
                    {idx < STEPS.length - 1 && (
                      <div className="text-gray-700 shrink-0">
                        <svg width="16" height="16" viewBox="0 0 20 20" fill="none">
                          <path d="M4 10h12M12 6l4 4-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Live log */}
          <div className="bg-gray-900 rounded-2xl border border-gray-800 p-4">
            <div className="flex items-center gap-2 mb-2">
              <span className={`w-1.5 h-1.5 rounded-full ${running ? 'bg-green-400 animate-pulse' : 'bg-gray-600'}`} />
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
                {running ? 'Live Log' : 'Log'}
              </span>
            </div>
            <div className="font-mono text-xs space-y-1 max-h-44 overflow-y-auto">
              {logs.length === 0 && <p className="text-gray-700 italic">Waiting for scan to start...</p>}
              {logs.map((entry, i) => (
                <div key={i} className="flex gap-3">
                  <span className="text-gray-700 shrink-0">[{entry.ts}]</span>
                  <span className={
                    entry.type === 'error'   ? 'text-red-400'     :
                    entry.type === 'warn'    ? 'text-yellow-400'  :
                    entry.type === 'success' ? 'text-emerald-400' : 'text-gray-400'
                  }>{entry.msg}</span>
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-3 bg-red-900/30 border border-red-700 rounded-xl px-4 py-3">
          <AlertTriangle size={15} className="text-red-400 shrink-0" />
          <p className="text-sm text-red-300">{error}</p>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────
const inputCls = 'w-full bg-gray-800 border border-gray-700 rounded-xl px-3 py-2 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50'

function Field({ label, children }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      {children}
    </div>
  )
}

const idleSteps    = Object.fromEntries(STEPS.map(s => [s.id, 'idle']))
const defaultSubs  = Object.fromEntries(STEPS.map(s => [s.id, s.sublabel]))

function delay(ms) { return new Promise(r => setTimeout(r, ms)) }
