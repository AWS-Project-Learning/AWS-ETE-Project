import { useState, useEffect, useRef } from 'react'
import { Database, Zap, Wrench, Sparkles, FileText, Trash2, ChevronRight, ChevronDown, Loader2 } from 'lucide-react'

// Pick an icon from the (generic) tool name — names are human-readable now.
function iconFor(tool = '', type = '') {
  const t = tool.toLowerCase()
  if (type === 'ai' || t.includes('assess') || t.includes('draft') || t.includes('report')) return Sparkles
  if (t.includes('deploy') || t.includes('patch') || t.includes('save') || type === 'write') return Zap
  if (t.includes('read') || t.includes('get') || t.includes('check') || t.includes('scan') || t.includes('list') || t.includes('score') || t.includes('summar')) return Database
  if (t.includes('report')) return FileText
  return Wrench
}

const TYPE_STYLE = {
  read:     { color: '#818cf8', bg: 'rgba(129,140,248,0.12)', label: 'read' },
  write:    { color: '#fb923c', bg: 'rgba(251,146,60,0.12)',  label: 'write' },
  ai:       { color: '#c084fc', bg: 'rgba(192,132,252,0.14)', label: 'ai' },
  proposed: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  label: 'proposed' },
}

const STATUS = {
  ok:       { color: '#22c55e', glyph: 'ok' },
  error:    { color: '#f87171', glyph: 'err' },
  proposed: { color: '#fbbf24', glyph: 'proposed' },
}

function summarizeInput(input) {
  if (!input || typeof input !== 'object') return ''
  const parts = Object.entries(input)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${k}: ${typeof v === 'object' ? (Array.isArray(v) ? `[${v.length}]` : '{…}') : v}`)
  return parts.length ? `{ ${parts.slice(0, 4).join(', ')}${parts.length > 4 ? ', …' : ''} }` : '{}'
}

function summarizeOutput(output) {
  if (output == null) return ''
  if (typeof output !== 'object') return String(output)
  if (output.error) return `error: ${output.error}`
  if (Array.isArray(output)) return `[${output.length} item(s)]`
  if (output.message) return String(output.message).slice(0, 60) + '…'
  if (output.overall) return `${output.service || ''} ${output.overall}`.trim()
  if (output.scan_id) return `scan_id: …${String(output.scan_id).slice(-8)}`
  if (output.decision) return `${output.package || ''} → ${output.decision}`.trim()
  if (output.count != null) return `${output.count} package(s)`
  if (output.status) return String(output.status)
  const keys = Object.keys(output)
  return keys.length ? `{ ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ', …' : ''} }` : '{}'
}

function Json({ value }) {
  let text
  try { text = JSON.stringify(value, null, 2) } catch { text = String(value) }
  if (text && text.length > 2400) text = text.slice(0, 2400) + '\n… (truncated)'
  return (
    <pre style={{
      margin: '3px 0 0 18px', padding: '6px 9px', borderRadius: 6,
      background: 'rgba(0,0,0,0.5)', border: '1px solid rgba(255,255,255,0.06)',
      color: '#7dd3fc', fontSize: 11, lineHeight: 1.5,
      whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 220, overflow: 'auto',
    }}>{text}</pre>
  )
}

function Step({ step, prev }) {
  const [open, setOpen] = useState(false)
  const Icon = iconFor(step.tool, step.type)
  const ty = TYPE_STYLE[step.type] || TYPE_STYLE.read
  const st = STATUS[step.status] || { color: '#94a3b8', glyph: step.status }

  return (
    <div>
      {/* the "→" connects this step's input to the previous step's output */}
      <div
        onClick={() => setOpen(o => !o)}
        style={{ display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', padding: '1px 0' }}
      >
        {open ? <ChevronDown size={12} color="#475569" /> : <ChevronRight size={12} color="#475569" />}
        <span style={{ color: ty.color, display: 'flex' }}><Icon size={12} /></span>
        <span style={{ color: '#e2e8f0', fontWeight: 600 }}>{step.tool}</span>
        <span style={{
          fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.4,
          color: ty.color, background: ty.bg, padding: '0 5px', borderRadius: 4,
        }}>{ty.label}</span>
        <span style={{ color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {summarizeInput(step.input)}
        </span>
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {step.tokens > 0 && <span style={{ color: '#c084fc' }}>{step.tokens} tok</span>}
          {step.duration_ms > 0 && <span style={{ color: '#475569' }}>{step.duration_ms}ms</span>}
          <span style={{ color: st.color, fontWeight: 700 }}>{st.glyph}</span>
        </span>
      </div>
      <div style={{ marginLeft: 19, color: '#64748b' }}>
        <span style={{ color: '#475569' }}>← </span>{summarizeOutput(step.output)}
      </div>
      {open && (
        <div style={{ marginBottom: 4 }}>
          <span style={{ marginLeft: 18, fontSize: 9.5, color: '#475569' }}>request</span>
          <Json value={step.input} />
          <span style={{ marginLeft: 18, fontSize: 9.5, color: '#475569' }}>response</span>
          <Json value={step.output} />
        </div>
      )}
    </div>
  )
}

export default function AgentToolTerminal({ events = [], onClear }) {
  const endRef = useRef(null)
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [events])

  const totalCalls = events.reduce((n, e) => n + (e.steps?.length || 0), 0)

  return (
    <div style={{
      flex: 1, minWidth: 0,
      background: 'rgba(0,0,0,0.45)',
      border: '1px solid rgba(99,102,241,0.18)',
      borderRadius: 16, overflow: 'hidden',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0,
        padding: '10px 18px', borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{ display: 'flex', gap: 6 }}>
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#ef4444' }} />
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#f59e0b' }} />
          <span style={{ width: 11, height: 11, borderRadius: '50%', background: '#22c55e' }} />
        </div>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#475569', marginLeft: 6 }}>agent.tools</span>
        <span style={{ fontSize: 10, color: '#334155' }}>live tool calls</span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {totalCalls > 0 && <span style={{ fontSize: 10, color: '#475569' }}>{totalCalls} call(s)</span>}
          {events.length > 0 && onClear && (
            <button onClick={onClear} title="Clear"
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#475569', display: 'flex', padding: 2 }}>
              <Trash2 size={13} />
            </button>
          )}
        </div>
      </div>

      <div style={{
        flex: 1, overflowY: 'auto',
        padding: '14px 18px', fontFamily: 'monospace', fontSize: 12,
        display: 'flex', flexDirection: 'column', gap: 12,
      }}>
        {events.length === 0 && (
          <span style={{ color: '#334155', fontStyle: 'italic' }}>
            $ pick an action or ask a question — every tool the agent calls streams here, with payloads…
          </span>
        )}
        {events.map(ev => (
          <div key={ev.id} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <span style={{ color: '#475569', flexShrink: 0 }}>[{ev.ts}]</span>
              <span style={{ color: '#34d399', flexShrink: 0 }}>$</span>
              <span style={{ color: '#cbd5e1' }}>{ev.title}</span>
              {ev.status === 'running' && <Loader2 size={11} color="#818cf8" style={{ animation: 'spin 1s linear infinite' }} />}
            </div>
            {ev.steps?.map((step, i) => <Step key={i} step={step} prev={ev.steps[i - 1]} />)}
            {ev.status === 'running' && ev.steps?.length === 0 && (
              <span style={{ marginLeft: 18, color: '#475569' }}>· orchestrating…</span>
            )}
            {ev.status !== 'running' && ev.steps?.length === 0 && (
              <span style={{ marginLeft: 18, color: '#475569' }}>· answered directly — no tools needed</span>
            )}
            {(ev.tokens > 0 || ev.model) && ev.status !== 'running' && (
              <div style={{ marginLeft: 18, color: '#334155', fontSize: 10.5 }}>
                {ev.model || ''}{ev.tokens > 0 ? ` · ${ev.tokens} tokens total` : ''}
              </div>
            )}
          </div>
        ))}
        <div ref={endRef} />
      </div>
    </div>
  )
}
