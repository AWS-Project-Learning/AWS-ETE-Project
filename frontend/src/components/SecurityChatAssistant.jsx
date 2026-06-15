import { useState } from 'react'
import {
  MessageCircle, ChevronDown, ChevronRight, Activity,
  Check, X, ArrowRight, Database, Wrench, Zap,
} from 'lucide-react'
import { triggerChat } from '../api/client'

const KNOWN_SERVICES = ['bff', 'order-service', 'invoice-service']

// The bounded toolset the agent can use — drives the legend + highlighting.
const TOOL_META = {
  get_security_data:   { label: 'Security data',  type: 'read',  icon: Database },
  get_finding_details: { label: 'Finding detail', type: 'read',  icon: Database },
  run_security_action: { label: 'Run action',     type: 'write', icon: Zap },
}
const TOOL_ORDER = ['get_security_data', 'get_finding_details', 'run_security_action']

function getStarterChips({ page = 'dashboard', service = 'bff', scanId } = {}) {
  const svc = KNOWN_SERVICES.includes(service) ? service : 'bff'
  const hasScan = Boolean(scanId)

  if (page === 'scan') {
    const chips = [
      hasScan ? 'Summarize the latest scan results' : 'What did this scan find?',
      `Is ${svc} healthy right now?`,
      `Scan ${svc} for vulnerabilities`,
      'How many scans ran this week?',
    ]
    return chips.slice(0, 5)
  }

  const chips = [
    'Is bff healthy right now?',
    'Scan bff for vulnerabilities',
    'What are the open findings?',
    'How many scans ran this week?',
    'How many services do we have?',
  ]
  if (hasScan) chips.unshift('Summarize the latest scan results')
  return chips.slice(0, 6)
}

function ChipRow({ chips, onSelect, disabled }) {
  if (!chips?.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
      {chips.map(chip => (
        <button
          key={chip}
          type="button"
          disabled={disabled}
          onClick={() => onSelect(chip)}
          style={{
            fontSize: 10, fontWeight: 500, padding: '5px 9px', borderRadius: 999,
            border: '1px solid rgba(99,102,241,0.35)', background: 'rgba(99,102,241,0.12)',
            color: '#c7d2fe', cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1, lineHeight: 1.35, textAlign: 'left',
          }}
        >
          {chip}
        </button>
      ))}
    </div>
  )
}

function JsonBlock({ value }) {
  let text
  try {
    text = JSON.stringify(value, null, 2)
  } catch {
    text = String(value)
  }
  if (text && text.length > 1400) text = text.slice(0, 1400) + '\n… (truncated)'
  return (
    <pre style={{
      margin: '4px 0 0', padding: '6px 8px', borderRadius: 6,
      background: '#01060d', border: '1px solid rgba(255,255,255,0.06)',
      color: '#93c5fd', fontSize: 9.5, lineHeight: 1.45,
      whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 160, overflow: 'auto',
    }}>
      {text}
    </pre>
  )
}

const STATUS_COLOR = {
  ok: '#34d399',
  error: '#f87171',
  awaiting_confirmation: '#fbbf24',
}

function ToolStep({ step }) {
  const [open, setOpen] = useState(false)
  const meta = TOOL_META[step.tool] || { label: step.tool, type: step.type }
  const Icon = meta.icon || Wrench
  const isWrite = (step.type || meta.type) === 'write'
  const statusColor = STATUS_COLOR[step.status] || '#94a3b8'

  return (
    <div style={{
      border: '1px solid rgba(255,255,255,0.07)', borderRadius: 8,
      background: 'rgba(2,8,16,0.6)', overflow: 'hidden',
    }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 7,
          padding: '6px 8px', background: 'transparent', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        {open ? <ChevronDown size={12} color="#64748b" /> : <ChevronRight size={12} color="#64748b" />}
        <Icon size={12} color={isWrite ? '#fbbf24' : '#818cf8'} />
        <span style={{ fontSize: 10.5, fontWeight: 600, color: '#e2e8f0' }}>{meta.label}</span>
        <span style={{
          fontSize: 8, fontWeight: 700, letterSpacing: 0.4, textTransform: 'uppercase',
          padding: '1px 5px', borderRadius: 4,
          background: isWrite ? 'rgba(251,191,36,0.15)' : 'rgba(129,140,248,0.15)',
          color: isWrite ? '#fbbf24' : '#a5b4fc',
        }}>
          {isWrite ? 'write' : 'read'}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          {typeof step.duration_ms === 'number' && step.duration_ms > 0 && (
            <span style={{ fontSize: 8.5, color: '#475569' }}>{step.duration_ms}ms</span>
          )}
          <span style={{
            width: 7, height: 7, borderRadius: 999, background: statusColor,
            boxShadow: `0 0 6px ${statusColor}`,
          }} />
        </span>
      </button>
      {open && (
        <div style={{ padding: '0 8px 8px 24px' }}>
          <div style={{ fontSize: 8.5, color: '#64748b', display: 'flex', alignItems: 'center', gap: 4 }}>
            <ArrowRight size={9} /> request
          </div>
          <JsonBlock value={step.input} />
          <div style={{ fontSize: 8.5, color: '#64748b', marginTop: 6, display: 'flex', alignItems: 'center', gap: 4 }}>
            <ArrowRight size={9} style={{ transform: 'rotate(180deg)' }} /> response
          </div>
          <JsonBlock value={step.output} />
        </div>
      )}
    </div>
  )
}

function ToolActivity({ trace, usage }) {
  const [open, setOpen] = useState(false)
  if (!trace?.length) return null
  const usedTools = new Set(trace.map(s => s.tool))

  return (
    <div style={{ marginTop: 6 }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, width: '100%',
          padding: '4px 2px', background: 'transparent', border: 'none',
          cursor: 'pointer', color: '#818cf8',
        }}
      >
        <Activity size={11} />
        <span style={{ fontSize: 9.5, fontWeight: 600 }}>
          Tool activity · {trace.length} step{trace.length > 1 ? 's' : ''}
        </span>
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
      </button>

      {open && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
          {/* Legend — highlights which tools were used for this answer */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
            {TOOL_ORDER.map(name => {
              const meta = TOOL_META[name]
              const used = usedTools.has(name)
              return (
                <span key={name} style={{
                  fontSize: 8.5, fontWeight: 600, padding: '2px 7px', borderRadius: 999,
                  border: `1px solid ${used ? 'rgba(129,140,248,0.5)' : 'rgba(255,255,255,0.08)'}`,
                  background: used ? 'rgba(99,102,241,0.18)' : 'transparent',
                  color: used ? '#c7d2fe' : '#475569',
                  display: 'flex', alignItems: 'center', gap: 4,
                }}>
                  {used && <Check size={9} />} {meta.label}
                </span>
              )
            })}
          </div>
          {trace.map((step, i) => <ToolStep key={i} step={step} />)}
          {usage?.input_tokens != null && (
            <span style={{ fontSize: 8.5, color: '#475569' }}>
              {usage.model ? `${usage.model} · ` : ''}
              {usage.llm_calls || 1} call{(usage.llm_calls || 1) > 1 ? 's' : ''} ·{' '}
              {(usage.input_tokens || 0) + (usage.output_tokens || 0)} tokens
            </span>
          )}
        </div>
      )}
    </div>
  )
}

function ConfirmCard({ pending, onConfirm, onCancel, disabled }) {
  const verb = pending.action === 'remediate' ? 'Remediate (auto-patch)' : 'Run scan on'
  return (
    <div style={{
      marginTop: 6, padding: '8px 10px', borderRadius: 8,
      border: '1px solid rgba(251,191,36,0.4)', background: 'rgba(251,191,36,0.08)',
    }}>
      <p style={{ margin: 0, fontSize: 10, color: '#fcd34d', fontWeight: 600 }}>
        Confirm action — this makes changes
      </p>
      <p style={{ margin: '3px 0 7px', fontSize: 10, color: '#cbd5e1' }}>
        {verb} <strong>{pending.service}</strong>?
      </p>
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button" disabled={disabled} onClick={onConfirm}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600,
            padding: '5px 11px', borderRadius: 7, border: 'none',
            background: '#f59e0b', color: '#1c1407',
            cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
          }}
        >
          <Check size={12} /> Confirm
        </button>
        <button
          type="button" disabled={disabled} onClick={onCancel}
          style={{
            display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600,
            padding: '5px 11px', borderRadius: 7,
            border: '1px solid rgba(255,255,255,0.15)', background: 'transparent', color: '#94a3b8',
            cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.5 : 1,
          }}
        >
          <X size={12} /> Cancel
        </button>
      </div>
    </div>
  )
}

export default function SecurityChatAssistant({
  scanId,
  recordId,
  service = 'bff',
  page = 'dashboard',
}) {
  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState([])
  const [followUpChips, setFollowUpChips] = useState([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)
  const [showTools, setShowTools] = useState(true)

  const starterChips = getStarterChips({ page, service, scanId })
  const showStarters = messages.length === 0 && !loading

  // One call to the backend; `extra` carries confirm_action for write approvals.
  const callChat = async (msg, extra = {}) => {
    setFollowUpChips([])
    setLoading(true)
    try {
      const res = await triggerChat({
        message: msg || undefined,
        scan_id: scanId || undefined,
        record_id: recordId || undefined,
        service: KNOWN_SERVICES.includes(service) ? service : undefined,
        page,
        ...extra,
      })
      const r = res.result || {}
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: r.reply || 'No response.',
        outOfScope: !!r.out_of_scope,
        trace: Array.isArray(r.trace) ? r.trace : [],
        usage: r.usage || null,
        pendingAction: r.pending_action || null,
      }])
      if (Array.isArray(r.chips) && r.chips.length) setFollowUpChips(r.chips)
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `Sorry, something went wrong: ${err.message}`,
        error: true,
      }])
      setFollowUpChips(getStarterChips({ page, service, scanId }).slice(0, 3))
    } finally {
      setLoading(false)
    }
  }

  const sendMessage = async (text) => {
    const msg = (text || input).trim()
    if (!msg || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: msg }])
    await callChat(msg)
  }

  // Resolve a pending write action (clears the card so it can't be re-clicked).
  const resolvePending = (msgIndex) =>
    setMessages(prev => prev.map((m, i) => (i === msgIndex ? { ...m, pendingAction: null } : m)))

  const confirmAction = async (msgIndex, pending) => {
    if (loading) return
    resolvePending(msgIndex)
    setMessages(prev => [...prev, { role: 'user', text: `Confirmed: ${pending.action} ${pending.service}` }])
    await callChat('', { confirm_action: pending.token })
  }

  const cancelAction = (msgIndex) => {
    resolvePending(msgIndex)
    setMessages(prev => [...prev, {
      role: 'assistant', text: 'Cancelled — no changes were made.', trace: [],
    }])
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 50,
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'linear-gradient(135deg, #4f46e5, #6366f1)',
          border: '1px solid rgba(129,140,248,0.45)', color: '#fff',
          padding: '11px 18px', borderRadius: 14,
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
          boxShadow: '0 8px 28px rgba(99,102,241,0.45)',
          transition: 'transform 0.2s, box-shadow 0.2s',
        }}
        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)' }}
        onMouseLeave={e => { e.currentTarget.style.transform = 'none' }}
      >
        <MessageCircle size={18} />
        <span>Ask AI</span>
      </button>
    )
  }

  return (
    <div style={{
      position: 'fixed', bottom: 24, right: 24, zIndex: 50,
      width: 380, maxWidth: 'calc(100vw - 48px)',
      background: 'rgba(15,23,42,0.97)',
      border: '1px solid rgba(99,102,241,0.35)', borderRadius: 16,
      boxShadow: '0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      backdropFilter: 'blur(12px)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'linear-gradient(135deg, rgba(79,70,229,0.25), rgba(99,102,241,0.1))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10, background: 'rgba(99,102,241,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MessageCircle size={16} color="#a5b4fc" />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Ask AI</p>
            <p style={{ margin: 0, fontSize: 9, color: '#64748b' }}>
              Scans · health · findings · patches
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <button
            type="button"
            onClick={() => setShowTools(s => !s)}
            aria-label="Toggle tool activity"
            title={showTools ? 'Hide tool activity' : 'Show tool activity'}
            style={{
              background: showTools ? 'rgba(99,102,241,0.25)' : 'rgba(255,255,255,0.06)',
              border: 'none', borderRadius: 8, padding: 6, cursor: 'pointer',
              color: showTools ? '#a5b4fc' : '#64748b', display: 'flex', alignItems: 'center',
            }}
          >
            <Activity size={15} />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Minimize chat"
            style={{
              background: 'rgba(255,255,255,0.06)', border: 'none', borderRadius: 8,
              padding: 6, cursor: 'pointer', color: '#94a3b8',
              display: 'flex', alignItems: 'center',
            }}
          >
            <ChevronDown size={16} />
          </button>
        </div>
      </div>

      <div style={{
        height: 300, overflowY: 'auto', margin: '12px 12px 8px',
        background: '#020810', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10, padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {showStarters && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 11, color: '#94a3b8', lineHeight: 1.45 }}>
              Ask about OrderFlow security — or pick a suggestion:
            </p>
            <ChipRow chips={starterChips} onSelect={sendMessage} disabled={loading} />
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{
            alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
            maxWidth: '94%',
            background: m.role === 'user'
              ? 'rgba(59,130,246,0.15)'
              : m.outOfScope ? 'rgba(245,158,11,0.08)' : 'rgba(15,23,42,0.85)',
            border: `1px solid ${m.role === 'user' ? 'rgba(59,130,246,0.3)' : m.outOfScope ? 'rgba(245,158,11,0.25)' : 'rgba(255,255,255,0.06)'}`,
            borderRadius: 10, padding: '7px 10px',
          }}>
            <p style={{
              fontSize: 11, color: m.role === 'user' ? '#bfdbfe' : '#cbd5e1',
              margin: 0, whiteSpace: 'pre-wrap', lineHeight: 1.5,
            }}>
              {m.text}
            </p>
            {m.role === 'assistant' && m.pendingAction && (
              <ConfirmCard
                pending={m.pendingAction}
                disabled={loading}
                onConfirm={() => confirmAction(i, m.pendingAction)}
                onCancel={() => cancelAction(i)}
              />
            )}
            {m.role === 'assistant' && showTools && <ToolActivity trace={m.trace} usage={m.usage} />}
          </div>
        ))}
        {!showStarters && followUpChips.length > 0 && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
            <span style={{ fontSize: 9, color: '#475569' }}>Suggested next:</span>
            <ChipRow chips={followUpChips} onSelect={sendMessage} disabled={loading} />
          </div>
        )}
        {loading && (
          <span style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>Thinking…</span>
        )}
      </div>

      <form
        onSubmit={e => { e.preventDefault(); sendMessage() }}
        style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 12px 10px' }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            placeholder="e.g. Scan bff · Health check order-service"
            disabled={loading}
            style={{
              flex: 1, fontSize: 11, padding: '9px 11px', borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.1)', background: '#0f172a', color: '#e2e8f0',
              outline: 'none',
            }}
          />
          <button type="submit" disabled={loading || !input.trim()}
            style={{
              fontSize: 11, fontWeight: 600, padding: '9px 14px', borderRadius: 8,
              border: 'none', background: '#6366f1', color: '#fff',
              cursor: loading || !input.trim() ? 'default' : 'pointer',
              opacity: loading || !input.trim() ? 0.5 : 1,
            }}>
            Send
          </button>
        </div>
        <p style={{ margin: 0, fontSize: 9, color: '#475569', textAlign: 'center' }}>
          Security assistant only — scans, health, remediation evidence
        </p>
      </form>
    </div>
  )
}
