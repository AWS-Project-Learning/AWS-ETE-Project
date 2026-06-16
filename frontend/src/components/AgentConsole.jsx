import { useState, useRef, useEffect } from 'react'
import {
  Search, Activity, ShieldCheck, Wrench, FileText, Send,
  Sparkles, Copy, Check, X, Loader2, Bot,
} from 'lucide-react'
import { triggerAgentAction, triggerChat } from '../api/client'

const KNOWN_SERVICES = ['bff', 'order-service', 'invoice-service']

const ACTIONS = [
  { key: 'scan',      label: 'Scan',           Icon: Search,      allowAll: true },
  { key: 'health',    label: 'Health Check',   Icon: Activity },
  { key: 'status',    label: 'Service Status', Icon: ShieldCheck },
  { key: 'remediate', label: 'Remediate',      Icon: Wrench },
  { key: 'draft',     label: 'Draft Report',   Icon: FileText },
]

const delay = (ms) => new Promise(r => setTimeout(r, ms))
const uid   = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`

function detectService(text, allowAll) {
  const low = (text || '').toLowerCase()
  if (allowAll && /\b(all|every|everything)\b/.test(low)) return 'all'
  return KNOWN_SERVICES.find(s => low.includes(s)) || null
}

function summarizeAction(action, r) {
  const res = r.result || {}
  switch (action) {
    case 'scan':
      return `Scan complete — ${res.total_found ?? 0} finding(s) across ${(res.services || []).join(', ') || 'all services'}.` +
             (res.scan_id ? ` (scan_id …${String(res.scan_id).slice(-8)})` : '')
    case 'health':
      return `${res.service || 'service'} is ${res.overall || 'UNKNOWN'} — containers + endpoint checked live.`
    case 'status':
      return `${res.service}: ${res.open_findings ?? 0} open finding(s) · risk ${res.risk || 'LOW'}.`
    case 'remediate':
      return `Assessed ${res.assessed ?? 0} finding(s): ${res.auto_patch ?? 0} auto-patch, ${res.escalate ?? 0} escalate. ` +
             `Patch + deploy steps are proposed — review them in agent.tools.`
    case 'draft':
      return `Drafted a notification for ${res.service}'s code owners — ready to send (below).`
    default:
      return 'Done.'
  }
}

function ReportCard({ text }) {
  const [copied, setCopied] = useState(false)
  const copy = () => navigator.clipboard?.writeText(text).then(() => {
    setCopied(true); setTimeout(() => setCopied(false), 1500)
  })
  return (
    <div style={{ marginTop: 8, borderRadius: 10, overflow: 'hidden', border: '1px solid rgba(34,197,94,0.3)', background: 'rgba(34,197,94,0.06)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', borderBottom: '1px solid rgba(34,197,94,0.2)' }}>
        <FileText size={12} color="#34d399" />
        <span style={{ fontSize: 10, fontWeight: 700, color: '#34d399' }}>Ready to send · email / Slack</span>
        <button onClick={copy} title="Copy"
          style={{ marginLeft: 'auto', background: 'none', border: 'none', cursor: 'pointer', color: '#34d399', display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
          {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <p style={{ margin: 0, padding: '8px 10px', fontSize: 11, color: '#d1fae5', whiteSpace: 'pre-wrap', lineHeight: 1.55 }}>{text}</p>
    </div>
  )
}

function Chip({ label, onClick, disabled }) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      style={{
        fontSize: 11, fontWeight: 600, padding: '6px 12px', borderRadius: 999,
        border: '1px solid rgba(99,102,241,0.4)', background: 'rgba(99,102,241,0.14)',
        color: '#c7d2fe', cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
      }}>
      {label}
    </button>
  )
}

export default function AgentConsole({ service = 'bff', tools, scanId, recordId }) {
  const defaultSvc = KNOWN_SERVICES.includes(service) ? service : 'bff'
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState(null)   // { action, label, allowAll } — awaiting a service pick
  const endRef = useRef(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, busy])

  const ts = () => new Date().toLocaleTimeString('en-AU', { hour12: false })
  const pushMsg = (m) => setMessages(prev => [...prev, m])

  const streamTrace = async (evId, trace) => {
    for (const step of (trace || [])) { await delay(420); tools?.addStep(evId, step) }
  }

  // Step 1 — an action button just asks which service (flows into the chat).
  const askForService = (action, label, allowAll) => {
    if (busy) return
    pushMsg({ role: 'user', text: label })
    const choices = [
      ...(allowAll ? [{ label: 'All services', value: 'all' }] : []),
      ...KNOWN_SERVICES.map(s => ({ label: s, value: s })),
    ]
    pushMsg({ role: 'assistant', text: `Which service should I ${label.toLowerCase()}?`, choices, action })
    setPending({ action, label, allowAll })
  }

  // Step 2 — service chosen → run the action against it.
  const chooseService = (action, value) => {
    setMessages(prev => prev.map(m => (m.choices ? { ...m, choices: null } : m)))
    setPending(null)
    pushMsg({ role: 'user', text: value === 'all' ? 'All services' : value })
    runAction(action, value)
  }

  const runAction = async (action, serviceValue) => {
    if (busy) return
    setBusy(true)
    const service = serviceValue === 'all' ? '' : serviceValue
    const target  = serviceValue === 'all' ? 'all services' : serviceValue
    const label   = ACTIONS.find(a => a.key === action)?.label || action
    const evId = uid()
    tools?.startEvent({ id: evId, ts: ts(), title: `${label} · ${target}` })
    try {
      const res = await triggerAgentAction({ action, service: service || undefined })
      const r = res.result || {}
      await streamTrace(evId, r.trace)
      tools?.finishEvent(evId, { tokens: r.tokens, model: r.model, status: r.status })
      pushMsg({ role: 'assistant', text: summarizeAction(action, r), report: r.response || null })
    } catch (err) {
      tools?.finishEvent(evId, { status: 'error' })
      pushMsg({ role: 'assistant', text: `Couldn't complete that action: ${err.message}`, error: true })
    } finally {
      setBusy(false)
    }
  }

  const sendMessage = async (text, extra = {}) => {
    const msg = (text ?? input).trim()
    if ((!msg && !extra.confirm_action) || busy) return
    setInput('')

    // If we're waiting for a service, treat the typed text as the answer.
    if (pending && msg && !extra.confirm_action) {
      const found = detectService(msg, pending.allowAll)
      if (found) { chooseService(pending.action, found); return }
      pushMsg({ role: 'user', text: msg })
      pushMsg({ role: 'assistant', text: `Please pick a service: ${pending.allowAll ? 'All services, ' : ''}${KNOWN_SERVICES.join(', ')}.` })
      return
    }

    if (msg) pushMsg({ role: 'user', text: msg })
    setBusy(true)
    const evId = uid()
    tools?.startEvent({ id: evId, ts: ts(), title: msg || `confirm: ${extra.confirm_action}` })
    try {
      const res = await triggerChat({
        message: msg || undefined, service: defaultSvc,
        scan_id: scanId || undefined, record_id: recordId || undefined, page: 'scan', ...extra,
      })
      const r = res.result || {}
      await streamTrace(evId, r.trace)
      tools?.finishEvent(evId, { tokens: (r.usage?.input_tokens || 0) + (r.usage?.output_tokens || 0), model: r.usage?.model, status: 'ok' })
      pushMsg({ role: 'assistant', text: r.reply || 'No response.', pending: r.pending_action || null })
    } catch (err) {
      tools?.finishEvent(evId, { status: 'error' })
      pushMsg({ role: 'assistant', text: `Something went wrong: ${err.message}`, error: true })
    } finally {
      setBusy(false)
    }
  }

  const confirmPending = (idx, p) => {
    setMessages(prev => prev.map((m, i) => (i === idx ? { ...m, pending: null } : m)))
    sendMessage('', { confirm_action: p.token })
  }
  const cancelPending = (idx) => {
    setMessages(prev => prev.map((m, i) => (i === idx ? { ...m, pending: null } : m)))
    pushMsg({ role: 'assistant', text: 'Cancelled — no changes were made.' })
  }

  return (
    <div style={{
      flex: 1.3, minWidth: 0,
      background: 'rgba(10,15,30,0.6)', border: '1px solid rgba(99,102,241,0.3)',
      borderRadius: 16, overflow: 'hidden', display: 'flex', flexDirection: 'column',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'linear-gradient(135deg, rgba(79,70,229,0.22), rgba(99,102,241,0.08))',
      }}>
        <div style={{ width: 30, height: 30, borderRadius: 9, background: 'rgba(99,102,241,0.25)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Bot size={16} color="#a5b4fc" />
        </div>
        <div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Security Agent</p>
          <p style={{ margin: 0, fontSize: 9.5, color: '#64748b' }}>pick an action — I'll ask which service · tools run in agent.tools →</p>
        </div>
        {busy && <Loader2 size={14} color="#818cf8" style={{ marginLeft: 'auto', animation: 'spin 1s linear infinite' }} />}
      </div>

      {/* Action buttons */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, padding: '10px 14px', borderBottom: '1px solid rgba(255,255,255,0.05)', flexShrink: 0 }}>
        {ACTIONS.map(({ key, label, Icon, allowAll }) => (
          <button key={key} type="button" disabled={busy}
            onClick={() => askForService(key, label, allowAll)}
            style={{
              display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, fontWeight: 600,
              padding: '7px 12px', borderRadius: 9, border: '1px solid rgba(99,102,241,0.4)',
              background: 'rgba(99,102,241,0.14)', color: '#c7d2fe',
              cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.5 : 1,
            }}>
            <Icon size={13} /> {label}
          </button>
        ))}
      </div>

      {/* Conversation */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '14px 14px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {messages.length === 0 && (
          <div style={{ color: '#475569', fontSize: 12, lineHeight: 1.6, margin: 'auto', textAlign: 'center', maxWidth: 290 }}>
            <Sparkles size={20} color="#475569" style={{ marginBottom: 8 }} />
            <p style={{ margin: 0 }}>Pick an action above — I'll ask which service, then run it.</p>
            <p style={{ margin: '6px 0 0', fontSize: 11 }}>Each tool the agent uses appears live in <span style={{ color: '#818cf8' }}>agent.tools</span> on the right.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '88%',
            background: m.role === 'user' ? 'rgba(59,130,246,0.15)' : m.error ? 'rgba(239,68,68,0.08)' : 'rgba(15,23,42,0.85)',
            border: `1px solid ${m.role === 'user' ? 'rgba(59,130,246,0.3)' : m.error ? 'rgba(239,68,68,0.25)' : 'rgba(255,255,255,0.07)'}`,
            borderRadius: 12, padding: '8px 11px',
          }}>
            <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap', color: m.role === 'user' ? '#bfdbfe' : '#cbd5e1' }}>{m.text}</p>
            {m.choices && (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
                {m.choices.map(c => (
                  <Chip key={c.value} label={c.label} disabled={busy} onClick={() => chooseService(m.action, c.value)} />
                ))}
              </div>
            )}
            {m.report && <ReportCard text={m.report} />}
            {m.pending && (
              <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
                <button onClick={() => confirmPending(i, m.pending)} disabled={busy}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '5px 11px', borderRadius: 7, border: 'none', background: '#f59e0b', color: '#1c1407', cursor: 'pointer' }}>
                  <Check size={12} /> Confirm
                </button>
                <button onClick={() => cancelPending(i)} disabled={busy}
                  style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, padding: '5px 11px', borderRadius: 7, border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#94a3b8', cursor: 'pointer' }}>
                  <X size={12} /> Cancel
                </button>
              </div>
            )}
          </div>
        ))}
        {busy && <span style={{ fontSize: 11, color: '#64748b', fontStyle: 'italic' }}>working…</span>}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <form onSubmit={e => { e.preventDefault(); sendMessage() }}
        style={{ display: 'flex', gap: 8, padding: '10px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', flexShrink: 0 }}>
        <input value={input} onChange={e => setInput(e.target.value)} disabled={busy}
          placeholder={pending ? `Which service? ${pending.allowAll ? 'all / ' : ''}${KNOWN_SERVICES.join(' / ')}` : 'Ask about scans, health, findings…'}
          style={{ flex: 1, fontSize: 12, padding: '9px 12px', borderRadius: 9, border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a', color: '#e2e8f0', outline: 'none' }} />
        <button type="submit" disabled={busy || !input.trim()}
          style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, padding: '9px 14px', borderRadius: 9, border: 'none', background: '#6366f1', color: '#fff', cursor: busy || !input.trim() ? 'default' : 'pointer', opacity: busy || !input.trim() ? 0.5 : 1 }}>
          <Send size={13} />
        </button>
      </form>
    </div>
  )
}
