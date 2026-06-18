import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { MessageCircle, ChevronDown, Check, X } from 'lucide-react'
import { triggerChat } from '../api/client'

const KNOWN_SERVICES = ['bff', 'order-service', 'invoice-service']

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
            border: '1px solid rgba(0,156,153,0.35)', background: 'rgba(0,156,153,0.1)',
            color: '#008c8a', cursor: disabled ? 'default' : 'pointer',
            opacity: disabled ? 0.5 : 1, lineHeight: 1.35, textAlign: 'left',
          }}
        >
          {chip}
        </button>
      ))}
    </div>
  )
}

function ConfirmCard({ pending, onConfirm, onCancel, disabled }) {
  const verb = pending.action === 'remediate' ? 'Remediate (auto-patch)' : 'Run scan on'
  return (
    <div style={{
      marginTop: 6, padding: '8px 10px', borderRadius: 8,
      border: '1px solid rgba(217,119,6,0.4)', background: 'rgba(217,119,6,0.08)',
    }}>
      <p style={{ margin: 0, fontSize: 10, color: '#b45309', fontWeight: 600 }}>
        Confirm action — this makes changes
      </p>
      <p style={{ margin: '3px 0 7px', fontSize: 10, color: '#334155' }}>
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
            border: '1px solid #cbd5e1', background: 'transparent', color: '#334155',
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
  onActivity,          // (event) => void — stream tool traces to the page terminal
  redirectTo,          // if set, the Ask AI button navigates here instead of opening inline
}) {
  const navigate = useNavigate()
  const location = useLocation()

  const [open, setOpen]         = useState(false)
  const [messages, setMessages] = useState([])
  const [followUpChips, setFollowUpChips] = useState([])
  const [input, setInput]       = useState('')
  const [loading, setLoading]   = useState(false)

  // Auto-open when arriving from another page that requested the assistant.
  useEffect(() => {
    if (!redirectTo && location.state?.askAi) setOpen(true)
  }, [location.state, redirectTo])

  const starterChips = getStarterChips({ page, service, scanId })
  const showStarters = messages.length === 0 && !loading

  const ts = () => new Date().toLocaleTimeString('en-AU', { hour12: false })

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
        pendingAction: r.pending_action || null,
      }])
      if (Array.isArray(r.chips) && r.chips.length) setFollowUpChips(r.chips)
      // Stream the tool trace to the page-level terminal.
      if (onActivity) {
        onActivity({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          ts: ts(),
          query: msg || (extra.confirm_action ? `confirm: ${extra.confirm_action}` : ''),
          reply: r.reply || '',
          steps: Array.isArray(r.trace) ? r.trace : [],
          usage: r.usage || null,
        })
      }
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
    setMessages(prev => [...prev, { role: 'assistant', text: 'Cancelled — no changes were made.' }])
  }

  const handleLauncher = () => {
    if (redirectTo) navigate(redirectTo, { state: { askAi: true } })
    else setOpen(true)
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={handleLauncher}
        style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 50,
          display: 'flex', alignItems: 'center', gap: 10,
          background: 'linear-gradient(135deg, #009c99, #008c8a)',
          border: '1px solid rgba(0,156,153,0.45)', color: '#fff',
          padding: '11px 18px', borderRadius: 14,
          fontSize: 13, fontWeight: 600, cursor: 'pointer',
          boxShadow: '0 8px 28px rgba(0,156,153,0.4)',
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
      background: '#ffffff',
      border: '1px solid #e0e5eb', borderRadius: 16,
      boxShadow: '0 16px 48px rgba(16,24,40,0.18)',
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px', borderBottom: '1px solid #eef2f5',
        background: 'linear-gradient(135deg, rgba(0,156,153,0.12), rgba(0,156,153,0.03))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10, background: 'rgba(0,156,153,0.16)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MessageCircle size={16} color="#009c99" />
          </div>
          <div>
            <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Ask AI</p>
            <p style={{ margin: 0, fontSize: 9, color: '#334155' }}>
              {onActivity ? 'Tool activity shown in agent.tools →' : 'Scans · health · findings · patches'}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Minimize chat"
          style={{
            background: '#f1f5f9', border: 'none', borderRadius: 8,
            padding: 6, cursor: 'pointer', color: '#334155',
            display: 'flex', alignItems: 'center',
          }}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <div style={{
        height: 300, overflowY: 'auto', margin: '12px 12px 8px',
        background: '#f8fafc', border: '1px solid #e0e5eb',
        borderRadius: 10, padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {showStarters && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <p style={{ margin: 0, fontSize: 11, color: '#475569', lineHeight: 1.45 }}>
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
              ? 'rgba(0,156,153,0.1)'
              : m.outOfScope ? 'rgba(217,119,6,0.08)' : '#ffffff',
            border: `1px solid ${m.role === 'user' ? 'rgba(0,156,153,0.3)' : m.outOfScope ? 'rgba(217,119,6,0.25)' : '#e0e5eb'}`,
            borderRadius: 10, padding: '7px 10px',
          }}>
            <p style={{
              fontSize: 11, color: m.role === 'user' ? '#0f766e' : m.error ? '#b91c1c' : '#334155',
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
          </div>
        ))}
        {!showStarters && followUpChips.length > 0 && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 2 }}>
            <span style={{ fontSize: 9, color: '#475569' }}>Suggested next:</span>
            <ChipRow chips={followUpChips} onSelect={sendMessage} disabled={loading} />
          </div>
        )}
        {loading && (
          <span style={{ fontSize: 10, color: '#334155', fontStyle: 'italic' }}>Thinking…</span>
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
              border: '1px solid #e0e5eb', background: '#ffffff', color: '#0f172a',
              outline: 'none',
            }}
          />
          <button type="submit" disabled={loading || !input.trim()}
            style={{
              fontSize: 11, fontWeight: 600, padding: '9px 14px', borderRadius: 8,
              border: 'none', background: '#009c99', color: '#fff',
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
