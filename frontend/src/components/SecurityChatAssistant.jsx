import { useState } from 'react'
import { MessageCircle, ChevronDown } from 'lucide-react'
import { triggerChat } from '../api/client'

export default function SecurityChatAssistant({ scanId }) {
  const [open, setOpen]       = useState(false)
  const [messages, setMessages] = useState([])
  const [input, setInput]       = useState('')
  const [loading, setLoading] = useState(false)

  const sendMessage = async (text) => {
    const msg = (text || input).trim()
    if (!msg || loading) return
    setInput('')
    setMessages(prev => [...prev, { role: 'user', text: msg }])
    setLoading(true)
    try {
      const res = await triggerChat({
        message: msg,
        scan_id: scanId || undefined,
      })
      const r = res.result || {}
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: r.reply || 'No response.',
        outOfScope: !!r.out_of_scope,
      }])
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        text: `Sorry, something went wrong: ${err.message}`,
        error: true,
      }])
    } finally {
      setLoading(false)
    }
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
          border: '1px solid rgba(129,140,248,0.45)',
          color: '#fff',
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
      width: 360, maxWidth: 'calc(100vw - 48px)',
      background: 'rgba(15,23,42,0.97)',
      border: '1px solid rgba(99,102,241,0.35)',
      borderRadius: 16,
      boxShadow: '0 16px 48px rgba(0,0,0,0.55), 0 0 0 1px rgba(255,255,255,0.04)',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      backdropFilter: 'blur(12px)',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '12px 14px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'linear-gradient(135deg, rgba(79,70,229,0.25), rgba(99,102,241,0.1))',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10,
            background: 'rgba(99,102,241,0.25)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <MessageCircle size={16} color="#a5b4fc" />
          </div>
          <p style={{ margin: 0, fontSize: 13, fontWeight: 700, color: '#f1f5f9' }}>Ask AI</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-label="Minimize chat"
          style={{
            background: 'rgba(255,255,255,0.06)', border: 'none',
            borderRadius: 8, padding: 6, cursor: 'pointer', color: '#94a3b8',
            display: 'flex', alignItems: 'center',
          }}
        >
          <ChevronDown size={16} />
        </button>
      </div>

      <div style={{
        height: 220, overflowY: 'auto', margin: '12px 12px 10px',
        background: '#020810', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 10, padding: '10px 12px',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}>
        {messages.length === 0 && !loading && (
          <span style={{ fontSize: 11, color: '#475569', fontStyle: 'italic' }}>
            Ask anything about scans, health, or findings.
          </span>
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
          </div>
        ))}
        {loading && (
          <span style={{ fontSize: 10, color: '#64748b', fontStyle: 'italic' }}>Thinking…</span>
        )}
      </div>

      <form
        onSubmit={e => { e.preventDefault(); sendMessage() }}
        style={{ display: 'flex', gap: 8, padding: '0 12px 12px' }}
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Type your question…"
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
      </form>
    </div>
  )
}
