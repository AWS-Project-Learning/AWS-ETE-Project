import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { getSecurityResults, approveProdPatch } from '../api/client'

// ── Helpers ───────────────────────────────────────────────────────────────────
const SEV_COLOR = {
  CRITICAL: { bg: '#fef2f2', text: '#dc2626', border: '#fca5a5', dark: '#ef4444' },
  HIGH:     { bg: '#fff7ed', text: '#ea580c', border: '#fdba74', dark: '#f97316' },
  MEDIUM:   { bg: '#fefce8', text: '#ca8a04', border: '#fde047', dark: '#eab308' },
  LOW:      { bg: '#f0fdf4', text: '#16a34a', border: '#86efac', dark: '#22c55e' },
  UNKNOWN:  { bg: '#f8fafc', text: '#64748b', border: '#cbd5e1', dark: '#94a3b8' },
}
const DEC_COLOR = {
  AUTO_PATCH: { bg: 'rgba(34,197,94,0.15)',  text: '#22c55e' },
  ESCALATE:   { bg: 'rgba(239,68,68,0.15)',  text: '#f87171' },
  IGNORE:     { bg: 'rgba(148,163,184,0.15)',text: '#94a3b8' },
  PENDING:    { bg: 'rgba(59,130,246,0.15)', text: '#3b82f6' },
}
const SEV_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 }

function timeAgo(iso) {
  if (!iso) return 'unknown'
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1)  return 'just now'
  if (m < 60) return `${m} min ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h} hour${h > 1 ? 's' : ''} ago`
  return `${Math.floor(h / 24)} day(s) ago`
}

// ── Sub-components ────────────────────────────────────────────────────────────
function KpiCard({ label, value, sub, icon, color }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
      borderRadius: 16, padding: '20px 22px',
      display: 'flex', alignItems: 'center', gap: 18,
    }}>
      <div style={{
        width: 56, height: 56, borderRadius: '50%', flexShrink: 0,
        background: `${color}22`, border: `2px solid ${color}55`,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        boxShadow: `0 0 18px ${color}33`,
        fontSize: 22,
      }}>{icon}</div>
      <div>
        <p style={{ fontSize: 12, color: '#64748b', margin: 0 }}>{label}</p>
        <p style={{ fontSize: 28, fontWeight: 800, color, margin: '2px 0', lineHeight: 1 }}>{value}</p>
        {sub && <p style={{ fontSize: 11, color: '#475569', margin: 0 }}>{sub}</p>}
      </div>
    </div>
  )
}

function SeverityBadge({ severity }) {
  const c = SEV_COLOR[severity] ?? SEV_COLOR.UNKNOWN
  return (
    <span style={{
      background: c.dark + '22', color: c.dark, border: `1px solid ${c.dark}44`,
      fontSize: 11, fontWeight: 700, padding: '3px 10px', borderRadius: 99,
    }}>{severity}</span>
  )
}

// Status → which pipeline stage is active
const STATUS_STAGE = {
  DETECTED:               0,
  REASONED:               0,
  DEV_DEPLOYING:          1,
  DEV_HEALTHY:            2,
  DEV_FAILED:             1,  // failed at deploy stage
  PR_CREATED:             2,
  AWAITING_PROD_APPROVAL: 3,
  PROD_DEPLOYED:          4,
  ESCALATED:              -1,
}

function StatusPipeline({ decision, status }) {
  if (decision === 'ESCALATE' || status === 'ESCALATED') return (
    <span style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#fbbf24' }}>
      ⚠ Escalated — Human Review
    </span>
  )
  if (decision === 'IGNORE') return (
    <span style={{ fontSize: 12, color: '#64748b' }}>Ignored</span>
  )
  if (decision === 'AUTO_PATCH' || status === 'DEV_DEPLOYING' || status === 'PR_CREATED' || status === 'DEV_HEALTHY') {
    const STAGES = [
      { label: 'Detected',    key: 0 },
      { label: 'Dev Deploy',  key: 1 },
      { label: 'Dev Healthy', key: 2 },
      { label: 'Prod Approve',key: 3 },
      { label: 'Done',        key: 4 },
    ]
    const active = STATUS_STAGE[status] ?? 0
    const failed = status === 'DEV_FAILED'

    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
        {STAGES.map((s, i) => {
          const done    = i <= active && !failed
          const isFail  = failed && i === 1
          const color   = isFail ? '#ef4444' : done ? '#22c55e' : '#334155'
          const glow    = isFail ? '0 0 6px rgba(239,68,68,0.6)' : done ? '0 0 6px rgba(34,197,94,0.5)' : 'none'
          return (
            <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: 3 }} title={s.label}>
              <div style={{
                width: 7, height: 7, borderRadius: '50%',
                background: color, boxShadow: glow,
                border: `1px solid ${color}88`,
              }} />
              {i < STAGES.length - 1 && (
                <div style={{ width: 10, height: 1, background: done && !failed ? '#22c55e44' : '#1e293b' }} />
              )}
            </div>
          )
        })}
        <span style={{ fontSize: 10, color: failed ? '#ef4444' : '#475569', marginLeft: 4, whiteSpace: 'nowrap' }}>
          {failed ? 'Deploy failed' : status === 'PR_CREATED' ? 'PR ready' : status === 'AWAITING_PROD_APPROVAL' ? 'Awaiting prod' : status === 'PROD_DEPLOYED' ? 'Prod live' : status === 'DEV_DEPLOYING' ? 'Deploying…' : status === 'DEV_HEALTHY' ? 'Dev healthy' : 'Detected'}
        </span>
      </div>
    )
  }
  return <span style={{ fontSize: 12, color: '#3b82f6' }}>Pending</span>
}

function ActionButton({ decision, status, prUrl, vuln, onApprove, onExpand }) {
  if (status === 'DEV_FAILED') return (
    <button onClick={onExpand} style={{
      background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)',
      color: '#f87171', fontSize: 11, fontWeight: 600,
      padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
    }}>⚠ Failed</button>
  )
  if (status === 'PR_CREATED' || status === 'DEV_HEALTHY') return (
    <div style={{ display: 'flex', gap: 6 }}>
      {prUrl && (
        <a href={prUrl} target="_blank" rel="noopener noreferrer" style={{
          background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)',
          color: '#818cf8', fontSize: 11, fontWeight: 600,
          padding: '5px 10px', borderRadius: 8, cursor: 'pointer',
          textDecoration: 'none', whiteSpace: 'nowrap',
        }}>View PR ↗</a>
      )}
      <button onClick={onApprove} style={{
        background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.35)',
        color: '#22c55e', fontSize: 11, fontWeight: 600,
        padding: '5px 12px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
      }}>Approve for Prod</button>
    </div>
  )
  if (status === 'AWAITING_PROD_APPROVAL') return (
    <span style={{ fontSize: 11, color: '#f59e0b' }}>⏳ Awaiting prod</span>
  )
  if (status === 'PROD_DEPLOYED') return (
    <span style={{ fontSize: 11, color: '#22c55e' }}>✓ Live in prod</span>
  )
  if (status === 'DEV_DEPLOYING') return (
    <span style={{ fontSize: 11, color: '#3b82f6', animation: 'pulse 1.5s ease-in-out infinite' }}>↻ Deploying…</span>
  )
  if (decision === 'ESCALATE') return (
    <button onClick={onExpand} style={{
      background: 'rgba(239,68,68,0.15)', border: '1px solid rgba(239,68,68,0.35)',
      color: '#f87171', fontSize: 11, fontWeight: 600,
      padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
    }}>Review</button>
  )
  if (decision === 'AUTO_PATCH') return (
    <button onClick={onExpand} style={{
      background: 'rgba(59,130,246,0.15)', border: '1px solid rgba(59,130,246,0.35)',
      color: '#60a5fa', fontSize: 11, fontWeight: 600,
      padding: '5px 12px', borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
    }}>Details</button>
  )
  return (
    <button onClick={onExpand} style={{
      background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.2)',
      color: '#94a3b8', fontSize: 11, fontWeight: 600,
      padding: '5px 12px', borderRadius: 8, cursor: 'pointer',
    }}>View</button>
  )
}

function ExpandedPanel({ vuln, onApprove }) {
  const [tab, setTab] = useState('ai')   // 'ai' | 'evidence' | 'logs'
  const ev  = vuln.evidence || {}
  const hasEvidence = vuln.status === 'DEV_HEALTHY' || vuln.status === 'PR_CREATED' ||
                      vuln.status === 'AWAITING_PROD_APPROVAL' || vuln.status === 'PROD_DEPLOYED' ||
                      vuln.status === 'DEV_FAILED'

  const advisoryId  = vuln.advisory_id  || vuln.cve_id  || vuln.ghsa_id || '—'
  const advisoryUrl = vuln.advisory_url || (vuln.cve_id?.startsWith('CVE-') ? `https://nvd.nist.gov/vuln/detail/${vuln.cve_id}` : null)
  const nvdUrl      = vuln.nvd_url      || (vuln.cve_id?.startsWith('CVE-') ? `https://nvd.nist.gov/vuln/detail/${vuln.cve_id}` : null)
  const ghsaId      = vuln.ghsa_id
  const ghsaUrl     = ghsaId ? `https://github.com/advisories/${ghsaId}` : null

  // Build AI narrative — use stored one or synthesise
  const narrative = vuln.finding_narrative || (
    `I scanned \`${vuln.scanned_file || `backend-services/${vuln.service}/requirements.txt`}\` and found ` +
    `\`${vuln.package}==${vuln.current_version}\`. I cross-referenced this against the ` +
    `GitHub Advisory Database (GHSA) and the National Vulnerability Database (NVD) and identified a known security vulnerability.`
  )

  const decColor = DEC_COLOR[vuln.decision] ?? DEC_COLOR.PENDING

  return (
    <div style={{
      background: '#070d1a', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: 10, margin: '0 0 2px', overflow: 'hidden',
    }}>
      {/* Tab bar */}
      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.07)' }}>
        {[
          { key: 'ai',       label: '🤖 AI Findings & Reasoning', disabled: false },
          { key: 'evidence', label: '🔬 Deploy Evidence',          disabled: !hasEvidence },
          { key: 'logs',     label: '🖥 Health & Container Logs',  disabled: !hasEvidence },
        ].map(t => (
          <button key={t.key}
            onClick={() => !t.disabled && setTab(t.key)}
            style={{
              padding: '10px 18px', fontSize: 12, fontWeight: 600,
              background: tab === t.key ? 'rgba(99,102,241,0.12)' : 'transparent',
              border: 'none',
              borderBottom: tab === t.key ? '2px solid #6366f1' : '2px solid transparent',
              color: t.disabled ? '#334155' : tab === t.key ? '#818cf8' : '#475569',
              cursor: t.disabled ? 'default' : 'pointer', whiteSpace: 'nowrap',
            }}>
            {t.label}
            {t.disabled && (
              <span style={{ fontSize: 10, color: '#334155', marginLeft: 6 }}>— after patch</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Tab 1: AI Findings & Reasoning ── */}
      {tab === 'ai' && (
        <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 16 }}>

          {/* Section 1: What I found */}
          <div>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px' }}>
              🔍 What I found
            </p>
            <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, margin: '0 0 12px', fontStyle: 'italic' }}>
              {narrative}
            </p>

            {/* Advisory reference table */}
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 20px', fontSize: 12 }}>
              <span style={{ color: '#475569', fontWeight: 600 }}>Advisory</span>
              <span>
                {advisoryUrl
                  ? <a href={advisoryUrl} target="_blank" rel="noopener noreferrer"
                      style={{ color: '#60a5fa', textDecoration: 'none', fontFamily: 'monospace' }}>
                      {advisoryId} ↗
                    </a>
                  : <span style={{ color: '#60a5fa', fontFamily: 'monospace' }}>{advisoryId}</span>
                }
                {ghsaUrl && advisoryId !== ghsaId && (
                  <a href={ghsaUrl} target="_blank" rel="noopener noreferrer"
                    style={{ color: '#64748b', textDecoration: 'none', fontFamily: 'monospace', marginLeft: 10, fontSize: 11 }}>
                    {ghsaId} ↗
                  </a>
                )}
                {nvdUrl && !advisoryId.startsWith('CVE-') && (
                  <a href={nvdUrl} target="_blank" rel="noopener noreferrer"
                    style={{ color: '#64748b', textDecoration: 'none', marginLeft: 10, fontSize: 11 }}>
                    NVD ↗
                  </a>
                )}
              </span>

              <span style={{ color: '#475569', fontWeight: 600 }}>Scanned file</span>
              <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 11 }}>
                {vuln.scanned_file || `backend-services/${vuln.service}/requirements.txt`}
              </span>

              <span style={{ color: '#475569', fontWeight: 600 }}>Summary</span>
              <span style={{ color: '#94a3b8' }}>{vuln.cve_summary || '—'}</span>

              <span style={{ color: '#475569', fontWeight: 600 }}>Safe fix</span>
              <span style={{ color: '#22c55e', fontFamily: 'monospace' }}>
                {vuln.package}=={vuln.safe_version || 'unknown'}
              </span>
            </div>
          </div>

          {/* Section 2: My decision */}
          <div style={{
            borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14,
          }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px' }}>
              🤖 My decision
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
              <span style={{
                fontSize: 12, fontWeight: 700, padding: '3px 12px', borderRadius: 99,
                background: decColor.bg, color: decColor.text,
              }}>{vuln.decision ?? 'PENDING'}</span>
              {vuln.confidence != null && (
                <span style={{ fontSize: 11, color: '#64748b' }}>confidence: {vuln.confidence}%</span>
              )}
              {vuln.risk_score != null && (
                <span style={{ fontSize: 11, color: '#64748b' }}>risk score: {vuln.risk_score}/10</span>
              )}
            </div>
            <p style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6, margin: 0, fontStyle: 'italic' }}>
              "{vuln.reasoning || 'AI reasoning will appear here after Phase 2 is run.'}"
            </p>
          </div>
        </div>
      )}

      {/* ── Tab 2: Deploy Evidence ── */}
      {tab === 'evidence' && (
        <div style={{ padding: '16px 20px' }}>
          {vuln.status === 'DEV_FAILED' ? (
            <div style={{
              background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)',
              borderRadius: 10, padding: '14px 18px',
            }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: '#f87171', margin: '0 0 6px' }}>
                ❌ Dev deployment failed — no PR raised
              </p>
              <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 8px' }}>
                {ev.failure_reason || 'One or more health checks did not pass. Check the Health & Container Logs tab for details.'}
              </p>
              {ev.workflow_run && (
                <a href={ev.workflow_run} target="_blank" rel="noopener noreferrer"
                  style={{ fontSize: 11, color: '#60a5fa', textDecoration: 'none' }}>
                  View GitHub Actions run ↗
                </a>
              )}
            </div>
          ) : (
            <>
              {/* Evidence header */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: '#22c55e', margin: 0 }}>
                  ✅ Dev Deployment Verified
                </p>
                <span style={{ fontSize: 11, color: '#475569', fontFamily: 'monospace' }}>
                  {ev.verified_at || '—'}
                </span>
              </div>

              {/* Summary cards */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
                {[
                  { label: 'ECS Tasks',   value: `${ev.ecs_running ?? '?'} / ${ev.ecs_desired ?? '?'}`, ok: ev.ecs_running === ev.ecs_desired && ev.ecs_running > 0 },
                  { label: 'ALB Health',  value: ev.alb_state ?? 'unknown', ok: ['healthy', 'skipped'].includes(ev.alb_state) },
                  { label: 'Error Check', value: ev.error_log_ok ? 'Clean' : 'Errors found', ok: ev.error_log_ok },
                ].map(card => (
                  <div key={card.label} style={{
                    background: card.ok ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                    border: `1px solid ${card.ok ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                    borderRadius: 8, padding: '10px 14px', textAlign: 'center',
                  }}>
                    <div style={{ fontSize: 18, marginBottom: 4 }}>{card.ok ? '✅' : '❌'}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0', fontFamily: 'monospace' }}>{card.value}</div>
                    <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{card.label}</div>
                  </div>
                ))}
              </div>

              {/* Deployment metadata */}
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', fontSize: 12, marginBottom: 16 }}>
                {ev.image && <>
                  <span style={{ color: '#475569', fontWeight: 600, lineHeight: '1.8' }}>Image</span>
                  <span style={{ color: '#94a3b8', fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{ev.image}</span>
                </>}
                {ev.task_arn && <>
                  <span style={{ color: '#475569', fontWeight: 600, lineHeight: '1.8' }}>Task ARN</span>
                  <a href={`https://us-east-1.console.aws.amazon.com/ecs/v2/clusters/orderflow-dev/tasks`}
                    target="_blank" rel="noopener noreferrer"
                    style={{ color: '#60a5fa', fontFamily: 'monospace', fontSize: 11, textDecoration: 'none', wordBreak: 'break-all' }}>
                    {ev.task_arn.slice(-50)} ↗
                  </a>
                </>}
                {ev.workflow_run && <>
                  <span style={{ color: '#475569', fontWeight: 600, lineHeight: '1.8' }}>CI Run</span>
                  <a href={ev.workflow_run} target="_blank" rel="noopener noreferrer"
                    style={{ color: '#60a5fa', fontSize: 11, textDecoration: 'none' }}>
                    GitHub Actions ↗
                  </a>
                </>}
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', paddingTop: 12, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                {vuln.pr_url && (
                  <a href={vuln.pr_url} target="_blank" rel="noopener noreferrer" style={{
                    background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.35)',
                    color: '#818cf8', fontSize: 12, fontWeight: 600,
                    padding: '7px 14px', borderRadius: 8, cursor: 'pointer',
                    textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6,
                  }}>
                    View GitHub PR ↗
                  </a>
                )}
                {(vuln.status === 'PR_CREATED' || vuln.status === 'DEV_HEALTHY') && (
                  <button onClick={onApprove} style={{
                    background: 'linear-gradient(135deg, #22c55e, #16a34a)',
                    border: 'none', color: '#fff', fontSize: 12, fontWeight: 700,
                    padding: '7px 18px', borderRadius: 8, cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(34,197,94,0.35)',
                  }}>
                    ✓ Approve for Production
                  </button>
                )}
                {vuln.status === 'AWAITING_PROD_APPROVAL' && (
                  <span style={{ fontSize: 12, color: '#f59e0b' }}>⏳ Awaiting production deployment…</span>
                )}
                {vuln.status === 'PROD_DEPLOYED' && (
                  <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 700 }}>✓ Deployed to production</span>
                )}
                {ev.workflow_run && (
                  <a href={ev.workflow_run} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: '#475569', textDecoration: 'none', marginLeft: 'auto' }}>
                    CI run ↗
                  </a>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* ── Tab 3: Health & Container Logs ── */}
      {tab === 'logs' && (
        <div style={{ padding: '16px 20px' }}>

          {/* Health check results */}
          <p style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 10px' }}>
            Health Check Results
          </p>
          <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 20 }}>
            <thead>
              <tr>
                <th style={{ padding: '6px 12px', fontSize: 11, color: '#334155', textAlign: 'left', fontWeight: 600 }}>Check</th>
                <th style={{ padding: '6px 12px', fontSize: 11, color: '#334155', textAlign: 'left', fontWeight: 600 }}>Value</th>
                <th style={{ padding: '6px 12px', fontSize: 11, color: '#334155', textAlign: 'right', fontWeight: 600 }}>Result</th>
              </tr>
            </thead>
            <tbody>
              {[
                {
                  label: 'ECS Tasks Running',
                  value: `${ev.ecs_running ?? '?'} running / ${ev.ecs_desired ?? '?'} desired`,
                  ok: ev.ecs_running === ev.ecs_desired && ev.ecs_running > 0,
                },
                {
                  label: 'ALB Target Health',
                  value: ev.alb_state ?? 'unknown',
                  ok: ['healthy', 'skipped'].includes(ev.alb_state),
                  advisory: ev.alb_state === 'skipped',
                },
                {
                  label: 'Startup Log Signature',
                  value: ev.startup_log_ok ? '"Application startup complete" found' : 'Not found in CloudWatch',
                  ok: ev.startup_log_ok,
                  advisory: !ev.startup_log_ok,
                },
                {
                  label: 'Error / Exception Check',
                  value: ev.error_log_ok ? 'No ERROR / CRITICAL lines' : 'Error lines detected',
                  ok: ev.error_log_ok,
                },
              ].map(row => (
                <tr key={row.label} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: '#64748b', width: 200 }}>{row.label}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12, color: '#e2e8f0', fontFamily: 'monospace' }}>{row.value}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                    {row.ok
                      ? <span style={{ color: '#22c55e' }}>✅ Pass</span>
                      : row.advisory
                      ? <span style={{ color: '#f59e0b' }}>⚠️ Advisory</span>
                      : <span style={{ color: '#ef4444' }}>❌ Fail</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Container / CloudWatch log excerpt */}
          <p style={{ fontSize: 11, fontWeight: 700, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 8px', display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#22c55e', display: 'inline-block', boxShadow: '0 0 6px #22c55e' }} />
            CloudWatch Container Logs
          </p>
          <div style={{
            background: '#020810',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 10, padding: '12px 16px',
            fontFamily: '"Fira Code", "Cascadia Code", monospace',
            fontSize: 11, lineHeight: 1.7,
            maxHeight: 260, overflowY: 'auto',
          }}>
            {/* Terminal title bar */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b', display: 'inline-block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#22c55e', display: 'inline-block' }} />
              <span style={{ fontSize: 10, color: '#334155', marginLeft: 8 }}>
                /ecs/orderflow/dev/{vuln.service}
              </span>
            </div>
            {ev.log_excerpt ? (
              String(ev.log_excerpt).split('|').filter(Boolean).map((line, i) => {
                const isErr  = /ERROR|CRITICAL|Traceback|Exception/i.test(line)
                const isWarn = /WARNING|WARN/i.test(line)
                const isOk   = /startup complete|Application startup|Started server/i.test(line)
                return (
                  <div key={i} style={{
                    color: isErr ? '#f87171' : isWarn ? '#fbbf24' : isOk ? '#22c55e' : '#64748b',
                    padding: '1px 0',
                  }}>
                    {line.trim()}
                  </div>
                )
              })
            ) : (
              <span style={{ color: '#334155', fontStyle: 'italic' }}>
                No log excerpt available — check GitHub Actions for full output
              </span>
            )}
          </div>

          {ev.workflow_run && (
            <div style={{ marginTop: 12, textAlign: 'right' }}>
              <a href={ev.workflow_run} target="_blank" rel="noopener noreferrer"
                style={{ fontSize: 11, color: '#60a5fa', textDecoration: 'none' }}>
                View full logs in GitHub Actions ↗
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function PatchTimeline() {
  const stages = [
    { label: 'Detected',     color: '#ef4444', icon: '🔍' },
    { label: 'PR Created',   color: '#3b82f6', icon: '⎇'  },
    { label: 'Dev Deployed', color: '#22c55e', icon: '🚀'  },
    { label: 'Prod Approved',color: '#f59e0b', icon: '🛡'  },
    { label: 'Prod Deployed',color: '#22c55e', icon: '✓'   },
  ]
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 0' }}>
      {stages.map((s, i) => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', flex: i < stages.length - 1 ? 1 : 0 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              background: `${s.color}22`, border: `2px solid ${s.color}66`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, boxShadow: `0 0 12px ${s.color}33`,
            }}>{s.icon}</div>
            <span style={{ fontSize: 10, color: '#64748b', textAlign: 'center', whiteSpace: 'nowrap' }}>
              {s.label}
            </span>
          </div>
          {i < stages.length - 1 && (
            <div style={{ flex: 1, height: 1, background: 'rgba(255,255,255,0.08)', margin: '0 4px', marginBottom: 18 }} />
          )}
        </div>
      ))}
    </div>
  )
}

// ── Main dashboard ────────────────────────────────────────────────────────────
export default function SecurityDashboard() {
  const navigate   = useNavigate()
  const location   = useLocation()
  const routeState = location.state

  const [data,      setData]     = useState(null)
  const [loading,   setLoading]  = useState(true)
  const [error,     setError]    = useState(null)
  const [expanded,  setExpanded] = useState(null)
  const [search,    setSearch]   = useState('')
  const [sevFilter, setSevFilter]= useState('ALL')
  const [decFilter, setDecFilter]= useState('ALL')
  const [sort,      setSort]     = useState({ col: 'severity', dir: 'desc' })
  const [groupBy,   setGroupBy]  = useState(true)
  const [approving, setApproving]= useState(null)   // record_id being approved

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true); setError(null)
    try { setData(await getSecurityResults()) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  async function handleApprove(vuln) {
    setApproving(vuln.record_id)
    try {
      await approveProdPatch({
        scan_id:    vuln.scan_id,
        record_ids: [vuln.record_id],
        pr_url:     vuln.pr_url || '',
      })
      await fetchData()
    } catch (err) {
      alert(`Approval failed: ${err.message}`)
    } finally {
      setApproving(null)
    }
  }

  // ── States ─────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={darkPage}>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, color: '#64748b' }}>
        <div style={{ fontSize: 28, animation: 'spin 1s linear infinite' }}>↻</div>
        <p style={{ fontSize: 13 }}>Loading scan results…</p>
      </div>
    </div>
  )

  if (error) return (
    <div style={darkPage}>
      <div style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20, padding: '40px 48px', maxWidth: 460, width: '100%', textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>🛡</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#f1f5f9', margin: '0 0 8px' }}>
          {routeState?.scan_id ? 'Scan complete — results loading issue' : 'No scan results yet'}
        </h2>
        {routeState?.scan_id && (
          <div style={{
            background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.2)',
            borderRadius: 10, padding: '10px 14px', marginBottom: 14, textAlign: 'left',
          }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#818cf8', margin: '0 0 4px' }}>Last scan summary</p>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: '0 0 2px', fontFamily: 'monospace' }}>
              Scan ID: {routeState.scan_id}
            </p>
            <p style={{ fontSize: 12, color: '#94a3b8', margin: 0 }}>
              Found: <strong style={{ color: '#f1f5f9' }}>{routeState.total}</strong> vulnerabilities
            </p>
          </div>
        )}
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
          {routeState?.scan_id
            ? 'Data may still be indexing. Click Retry in a moment.'
            : 'Run a scan first to populate this dashboard.'}
        </p>
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button onClick={fetchData} style={btnPrimary}>↻ Retry</button>
          <button onClick={() => navigate('/security')} style={btnSecondary}>▶ New Scan</button>
        </div>
      </div>
    </div>
  )

  // ── Data ───────────────────────────────────────────────────────────────────
  const metrics  = data?.metrics ?? {}
  const vulns    = data?.active  ?? []
  const history  = data?.history ?? []

  if (!loading && !error && vulns.length === 0) return (
    <div style={darkPage}>
      <div style={{
        background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 20, padding: '40px 48px', maxWidth: 420, textAlign: 'center',
      }}>
        <div style={{ fontSize: 40, marginBottom: 12 }}>✓</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#22c55e', marginBottom: 8 }}>All Clear</h2>
        <p style={{ fontSize: 13, color: '#64748b', marginBottom: 24 }}>
          No active vulnerabilities found. Run a new scan to check again.
        </p>
        <button onClick={() => navigate('/security')} style={btnPrimary}>▶ Run a Scan</button>
      </div>
    </div>
  )

  const autoPatch = vulns.filter(v => v.decision === 'AUTO_PATCH').length
  const escalate  = vulns.filter(v => v.decision === 'ESCALATE').length
  const lastScan  = history[0]?.scanned_at ?? metrics?.last_scan_at ?? null

  // Chart data from history
  const chartData = history.slice().reverse().map((h, i) => ({
    name: h.scanned_at ? new Date(h.scanned_at).toLocaleDateString('en-AU', { month: 'short', day: 'numeric' }) : `Scan ${i + 1}`,
    scans: h.total_found ?? 0,
  }))
  if (chartData.length === 0) chartData.push({ name: 'Now', scans: vulns.length })

  const toggleSort = col => setSort(p => ({ col, dir: p.col === col && p.dir === 'desc' ? 'asc' : 'desc' }))

  // Base filter
  const baseFiltered = vulns.filter(v =>
    (sevFilter === 'ALL' || v.severity === sevFilter) &&
    (decFilter === 'ALL' || (v.decision ?? 'PENDING') === decFilter) &&
    (!search || [v.package, v.cve_id, v.service].some(f => f?.toLowerCase().includes(search.toLowerCase())))
  )

  // Group by package+CVE — merge services into one row
  const grouped = (() => {
    if (!groupBy) return baseFiltered.map(v => ({ ...v, _services: [v.service], _key: `${v.cve_id}#${v.package}#${v.service}` }))
    const map = new Map()
    for (const v of baseFiltered) {
      const key = `${v.cve_id}#${v.package}`
      if (!map.has(key)) map.set(key, { ...v, _services: [], _key: key })
      if (!map.get(key)._services.includes(v.service)) map.get(key)._services.push(v.service)
    }
    return Array.from(map.values())
  })()

  const filtered = grouped.sort((a, b) => {
    const dir = sort.dir === 'asc' ? 1 : -1
    if (sort.col === 'severity') return ((SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0)) * dir
    return ((a[sort.col] ?? '') < (b[sort.col] ?? '') ? -1 : 1) * dir
  })

  const allPending = vulns.length > 0 && vulns.every(v => !v.decision || v.decision === 'PENDING' || v.decision === 'ESCALATE')

  return (
    <div style={{
      minHeight: '100vh',
      background: 'linear-gradient(135deg, #0a0f1e 0%, #0f172a 60%, #0d1b2a 100%)',
      padding: '28px 32px', color: '#e2e8f0', fontFamily: 'inherit',
    }}>

      {/* ── Header ─────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <div>
          <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0, color: '#f1f5f9' }}>Security Dashboard</h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: '3px 0 0' }}>AI-analysed vulnerability findings</p>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button onClick={fetchData} style={btnSecondary}>↻ Refresh</button>
          <button onClick={() => navigate('/security')} style={btnPrimary}>▶ Run Scan Now</button>
        </div>
      </div>

      {/* ── Scan info bar ───────────────────────────────────────── */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
        borderRadius: 12, padding: '12px 20px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        marginBottom: 20,
      }}>
        <div>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
            Last scan: {timeAgo(lastScan)}
          </span>
          <span style={{ fontSize: 12, color: '#475569', marginLeft: 14 }}>
            Monitoring: order-service, invoice-service, bff
          </span>
        </div>
        <span style={{ fontSize: 11, color: '#334155', fontFamily: 'monospace' }}>
          {history[0]?.scan_id ?? '—'}
        </span>
      </div>

      {/* ── KPI cards ───────────────────────────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <KpiCard label="Vulnerabilities Found" value={vulns.length}
          sub="across all services" icon="🚨" color="#ef4444" />
        <KpiCard label="Auto-Patched" value={`${autoPatch} ✓`}
          sub="safe to apply automatically" icon="✅" color="#22c55e" />
        <KpiCard label="Awaiting Approval" value={escalate}
          sub="human review required" icon="⏳" color="#f59e0b" />
        <KpiCard label="Mean Time to Patch"
          value={metrics.mean_time_to_patch ? `${metrics.mean_time_to_patch}m` : '—'}
          sub="mean time to remediate" icon="⏱" color="#3b82f6" />
      </div>

      {/* ── Phase 2 banner ──────────────────────────────────────── */}
      {allPending && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 14,
          background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.25)',
          borderRadius: 12, padding: '12px 18px', marginBottom: 16,
        }}>
          <span style={{ fontSize: 20 }}>⚠️</span>
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: '#fbbf24', margin: '0 0 2px' }}>
              AI Reasoning not yet run (Phase 2)
            </p>
            <p style={{ fontSize: 12, color: '#92400e', margin: 0 }}>
              All findings show ESCALATE because the reasoner hasn't analysed them yet.
              Trigger Phase 2 from GitHub Actions → <code style={{ color: '#fbbf24' }}>vulnerability-agent</code> → Run workflow → action: <code style={{ color: '#fbbf24' }}>reason</code>
            </p>
          </div>
        </div>
      )}

      {/* ── Severity filter pills ───────────────────────────────── */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
        {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].map(s => {
          const count = s === 'ALL' ? vulns.length : vulns.filter(v => v.severity === s).length
          const c = SEV_COLOR[s] ?? SEV_COLOR.UNKNOWN
          const active = sevFilter === s
          // Hide severity pills that have 0 results (except ALL)
          if (s !== 'ALL' && count === 0) return null
          return (
            <button key={s} onClick={() => setSevFilter(s)} style={{
              background: active ? `${c.dark}22` : 'rgba(255,255,255,0.04)',
              border: `1px solid ${active ? c.dark + '66' : 'rgba(255,255,255,0.08)'}`,
              color: active ? c.dark : '#64748b',
              fontSize: 11, fontWeight: 600, padding: '5px 12px',
              borderRadius: 99, cursor: 'pointer', transition: 'all 0.2s',
            }}>{s} {s !== 'ALL' ? `(${count})` : `(${count})`}</button>
          )
        })}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* Group toggle */}
          <button onClick={() => setGroupBy(g => !g)} style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: groupBy ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)',
            border: `1px solid ${groupBy ? 'rgba(99,102,241,0.4)' : 'rgba(255,255,255,0.1)'}`,
            color: groupBy ? '#818cf8' : '#64748b',
            fontSize: 11, fontWeight: 600, padding: '6px 12px',
            borderRadius: 8, cursor: 'pointer', whiteSpace: 'nowrap',
          }}>
            {groupBy ? '⊟' : '⊞'} {groupBy ? 'Grouped' : 'Flat'}
          </button>

          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search package, CVE, service…"
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '6px 12px', fontSize: 12, color: '#e2e8f0',
              outline: 'none', width: 200,
            }} />
          <select value={decFilter} onChange={e => setDecFilter(e.target.value)}
            style={{
              background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '6px 10px', fontSize: 12, color: '#e2e8f0', outline: 'none',
            }}>
            {['ALL', 'AUTO_PATCH', 'ESCALATE', 'IGNORE', 'PENDING'].map(d => (
              <option key={d} value={d} style={{ background: '#0f172a' }}>
                {d === 'ALL' ? 'All Decisions' : d}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* ── Active Vulnerabilities table ─────────────────────────── */}
      <div style={{
        background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 16, overflow: 'hidden', marginBottom: 24,
      }}>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '14px 20px', borderBottom: '1px solid rgba(255,255,255,0.06)',
        }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', margin: 0 }}>Active Vulnerabilities</p>
          <span style={{ fontSize: 12, color: '#475569' }}>
            {filtered.length} unique finding{filtered.length !== 1 ? 's' : ''}
            {groupBy && vulns.length !== filtered.length
              ? <span style={{ color: '#334155', marginLeft: 6 }}>({vulns.length} total across services)</span>
              : ''}
          </span>
        </div>

        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              {[
                { col: null,       label: ''                },
                { col: 'service',  label: 'Service'         },
                { col: 'package',  label: 'Package'         },
                { col: null,       label: 'Version'         },
                { col: 'severity', label: 'Severity ↕'     },
                { col: null,       label: 'Status'          },
                { col: 'decision', label: 'Decision'        },
                { col: null,       label: 'Action'          },
              ].map(({ col, label }) => (
                <th key={label} onClick={col ? () => toggleSort(col) : undefined}
                  style={{
                    padding: '10px 14px', textAlign: 'left',
                    fontSize: 11, fontWeight: 600, color: '#475569',
                    textTransform: 'uppercase', letterSpacing: '0.05em',
                    cursor: col ? 'pointer' : 'default',
                    userSelect: 'none',
                  }}>
                  {label}{col && sort.col === col ? (sort.dir === 'asc' ? ' ↑' : ' ↓') : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr><td colSpan={8} style={{ padding: '32px', textAlign: 'center', color: '#334155', fontSize: 13 }}>
                No vulnerabilities match the current filters.
              </td></tr>
            )}
            {filtered.map((v, i) => {
              const isOpen = expanded === i
              const dec    = v.decision ?? 'PENDING'
              const status = v.status   ?? 'DETECTED'
              const toggleExpand = () => setExpanded(isOpen ? null : i)

              return [
                <tr key={`row-${i}`}
                  onClick={toggleExpand}
                  style={{
                    borderBottom: isOpen ? 'none' : '1px solid rgba(255,255,255,0.04)',
                    background: isOpen ? 'rgba(255,255,255,0.04)' : 'transparent',
                    transition: 'background 0.2s', cursor: 'pointer',
                  }}>
                  {/* Expand toggle */}
                  <td style={{ padding: '12px 8px 12px 16px', width: 24 }} onClick={e => e.stopPropagation()}>
                    <button onClick={toggleExpand} style={{
                      background: 'none', border: 'none', color: '#475569',
                      cursor: 'pointer', fontSize: 14, padding: 2,
                    }}>{isOpen ? '∨' : '›'}</button>
                  </td>

                  {/* Service badges */}
                  <td style={{ padding: '12px 14px' }} onClick={e => e.stopPropagation()}>
                    {v._services && v._services.length > 1
                      ? <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                          {v._services.map(s => (
                            <span key={s} style={{
                              fontSize: 10, fontFamily: 'monospace', fontWeight: 600,
                              background: 'rgba(99,102,241,0.12)', color: '#818cf8',
                              border: '1px solid rgba(99,102,241,0.25)',
                              padding: '2px 7px', borderRadius: 99,
                            }}>{s}</span>
                          ))}
                        </div>
                      : <span style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>
                          {v._services?.[0] ?? v.service}
                        </span>
                    }
                  </td>

                  {/* Package */}
                  <td style={{ padding: '12px 14px', fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                    <div>{v.package}</div>
                    <div style={{ fontSize: 10, color: '#475569', fontFamily: 'monospace', marginTop: 2 }}>
                      {(v.advisory_id || v.cve_id || v.ghsa_id || '').slice(0, 24)}
                      {(v.advisory_id || v.cve_id || '').length > 24 ? '…' : ''}
                    </div>
                  </td>

                  {/* Version */}
                  <td style={{ padding: '12px 14px', fontSize: 12, color: '#ef4444', fontFamily: 'monospace' }}>
                    {v.current_version}
                    {v.safe_version && v.safe_version !== 'unknown' && (
                      <div style={{ fontSize: 10, color: '#22c55e', marginTop: 2 }}>→ {v.safe_version}</div>
                    )}
                  </td>

                  {/* Severity */}
                  <td style={{ padding: '12px 14px' }}><SeverityBadge severity={v.severity} /></td>

                  {/* Status pipeline */}
                  <td style={{ padding: '12px 14px' }}><StatusPipeline decision={dec} status={status} /></td>

                  {/* Decision badge */}
                  <td style={{ padding: '12px 14px' }}>
                    <span style={{
                      fontSize: 11, fontWeight: 600, padding: '3px 10px', borderRadius: 99,
                      ...(DEC_COLOR[dec] ?? DEC_COLOR.PENDING),
                    }}>{dec}</span>
                  </td>

                  {/* Action button */}
                  <td style={{ padding: '12px 14px' }} onClick={e => e.stopPropagation()}>
                    <ActionButton
                      decision={dec}
                      status={status}
                      prUrl={v.pr_url}
                      vuln={v}
                      onApprove={() => handleApprove(v)}
                      onExpand={toggleExpand}
                    />
                  </td>
                </tr>,

                // Expanded two-tab panel
                isOpen && (
                  <tr key={`panel-${i}`} style={{ borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                    <td colSpan={8} style={{ padding: '0 16px 12px' }}>
                      <ExpandedPanel
                        vuln={v}
                        onApprove={() => handleApprove(v)}
                      />
                    </td>
                  </tr>
                ),
              ]
            })}
          </tbody>
        </table>
      </div>

      {/* ── Bottom: chart + patch timeline ──────────────────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

        {/* Scan history chart */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 16, padding: '20px 24px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
            <p style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', margin: 0 }}>Scan History</p>
            <select style={{
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 8, padding: '4px 10px', fontSize: 11, color: '#94a3b8', outline: 'none',
            }}>
              <option style={{ background: '#0f172a' }}>Last 7 Days</option>
              <option style={{ background: '#0f172a' }}>Last 30 Days</option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
              <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 10, fill: '#475569' }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{ background: '#0f172a', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: '#94a3b8' }} itemStyle={{ color: '#3b82f6' }}
              />
              <Line type="monotone" dataKey="scans" stroke="#3b82f6" strokeWidth={2.5}
                dot={{ fill: '#3b82f6', r: 4 }} activeDot={{ r: 6, boxShadow: '0 0 10px #3b82f6' }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Patch timeline */}
        <div style={{
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
          borderRadius: 16, padding: '20px 24px',
        }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: '#e2e8f0', margin: '0 0 20px' }}>Patch Timeline</p>
          <PatchTimeline />
          <div style={{ marginTop: 20, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 14 }}>
            {[
              { label: 'Detected',     time: history[0]?.scanned_at ? new Date(history[0].scanned_at).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false }) : '—' },
              { label: 'PR Created',   time: autoPatch > 0 ? '(auto)' : '—' },
              { label: 'Dev Deployed', time: autoPatch > 0 ? '(auto)' : '—' },
              { label: 'Prod Approved',time: '—' },
              { label: 'Prod Deployed',time: '—' },
            ].map(s => (
              <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                <span style={{ fontSize: 11, color: '#475569' }}>{s.label}</span>
                <span style={{ fontSize: 11, color: '#64748b', fontFamily: 'monospace' }}>{s.time}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  )
}

// ── Shared styles ─────────────────────────────────────────────────────────────
const darkPage = {
  minHeight: '100vh',
  background: 'linear-gradient(135deg, #0a0f1e 0%, #0f172a 60%, #0d1b2a 100%)',
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  padding: 32,
}

const btnPrimary = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
  border: 'none', color: '#fff',
  padding: '9px 20px', borderRadius: 10,
  fontSize: 13, fontWeight: 600, cursor: 'pointer',
  boxShadow: '0 4px 16px rgba(59,130,246,0.35)',
}

const btnSecondary = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'rgba(255,255,255,0.06)',
  border: '1px solid rgba(255,255,255,0.1)', color: '#94a3b8',
  padding: '9px 16px', borderRadius: 10,
  fontSize: 13, fontWeight: 500, cursor: 'pointer',
}
