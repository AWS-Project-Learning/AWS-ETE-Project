import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ShieldAlert, ShieldCheck, AlertTriangle, Clock,
  Play, RefreshCw, ChevronUp, ChevronDown, Minus,
} from 'lucide-react'
import { getSecurityResults } from '../api/client'

// NOTE: calls /security/results — CloudFront → ALB → Lambda directly, no BFF.

const SEV_STYLE = {
  CRITICAL: 'bg-red-100 text-red-700 border-red-200',
  HIGH:     'bg-orange-100 text-orange-700 border-orange-200',
  MEDIUM:   'bg-yellow-100 text-yellow-700 border-yellow-200',
  LOW:      'bg-green-100 text-green-700 border-green-200',
  UNKNOWN:  'bg-gray-100 text-gray-500 border-gray-200',
}
const DEC_STYLE = {
  AUTO_PATCH: 'bg-green-100 text-green-700',
  ESCALATE:   'bg-orange-100 text-orange-700',
  IGNORE:     'bg-gray-100 text-gray-500',
  PENDING:    'bg-blue-100 text-blue-700',
  REASONED:   'bg-violet-100 text-violet-700',
}
const SEV_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1, UNKNOWN: 0 }

function StatCard({ label, value, icon: Icon, color, sub }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5 flex items-start gap-4">
      <div className={`p-3 rounded-xl ${color}`}><Icon size={20} className="text-white" /></div>
      <div>
        <p className="text-sm text-gray-500">{label}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
      </div>
    </div>
  )
}

export default function SecurityDashboard() {
  const navigate = useNavigate()
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [search,  setSearch]  = useState('')
  const [filter,  setFilter]  = useState({ severity: 'ALL', decision: 'ALL' })
  const [sort,    setSort]    = useState({ col: 'severity', dir: 'desc' })

  useEffect(() => { fetchData() }, [])

  async function fetchData() {
    setLoading(true); setError(null)
    try { setData(await getSecurityResults()) }
    catch (err) { setError(err.message) }
    finally { setLoading(false) }
  }

  function toggleSort(col) {
    setSort(prev => prev.col === col
      ? { col, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { col, dir: 'desc' })
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex items-center gap-3 text-gray-400">
        <RefreshCw size={18} className="animate-spin" /> Loading dashboard...
      </div>
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="bg-red-50 border border-red-200 rounded-2xl px-6 py-5 max-w-md text-center">
        <ShieldAlert size={28} className="text-red-500 mx-auto mb-2" />
        <p className="text-red-600 font-medium">{error}</p>
        <button onClick={fetchData} className="mt-3 text-sm text-gray-400 hover:text-gray-700 underline">Retry</button>
      </div>
    </div>
  )

  const metrics = data?.metrics ?? {}
  const vulns   = data?.active  ?? []
  const autoPatch = vulns.filter(v => v.decision === 'AUTO_PATCH').length
  const escalate  = vulns.filter(v => v.decision === 'ESCALATE').length

  const filtered = vulns
    .filter(v =>
      (filter.severity === 'ALL' || v.severity === filter.severity) &&
      (filter.decision === 'ALL' || (v.decision ?? 'PENDING') === filter.decision) &&
      (!search || [v.package, v.cve_id, v.service].some(f => f?.toLowerCase().includes(search.toLowerCase())))
    )
    .sort((a, b) => {
      const dir = sort.dir === 'asc' ? 1 : -1
      if (sort.col === 'severity') return ((SEV_ORDER[b.severity] ?? 0) - (SEV_ORDER[a.severity] ?? 0)) * dir
      const va = (a[sort.col] ?? '').toString().toLowerCase()
      const vb = (b[sort.col] ?? '').toString().toLowerCase()
      return (va < vb ? -1 : va > vb ? 1 : 0) * dir
    })

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Security Dashboard</h1>
          <p className="text-sm text-gray-500 mt-1">AI-analysed vulnerability findings</p>
        </div>
        <div className="flex gap-2">
          <button onClick={fetchData}
            className="flex items-center gap-2 bg-white border border-gray-200 text-gray-600 px-4 py-2 rounded-xl text-sm shadow-sm hover:bg-gray-50 transition">
            <RefreshCw size={13} /> Refresh
          </button>
          <button onClick={() => navigate('/security')}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-xl text-sm font-semibold transition shadow">
            <Play size={13} fill="white" /> New Scan
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        <StatCard label="Total Vulnerabilities" value={vulns.length}  icon={ShieldAlert}   color="bg-red-500"     sub="across all services"      />
        <StatCard label="Auto-Patchable"         value={autoPatch}    icon={ShieldCheck}   color="bg-emerald-500" sub="safe to apply automatically" />
        <StatCard label="Needs Review"           value={escalate}     icon={AlertTriangle} color="bg-orange-500"  sub="human review required"      />
        <StatCard
          label="Avg Time to Patch"
          value={metrics.mean_time_to_patch ? `${metrics.mean_time_to_patch}m` : '—'}
          icon={Clock} color="bg-indigo-500" sub="mean time to remediate"
        />
      </div>

      {/* Severity breakdown */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'UNKNOWN'].map(sev => {
          const count = vulns.filter(v => v.severity === sev).length
          return (
            <button key={sev}
              onClick={() => setFilter(f => ({ ...f, severity: f.severity === sev ? 'ALL' : sev }))}
              className={`rounded-xl border p-3 text-center transition hover:scale-105 bg-white shadow-sm
                ${filter.severity === sev ? SEV_STYLE[sev] : 'border-gray-100 text-gray-500'}`}>
              <p className="text-2xl font-bold text-gray-900">{count}</p>
              <p className="text-xs mt-0.5">{sev}</p>
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-4 items-center">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search package, CVE, service..."
          className="bg-white border border-gray-200 rounded-xl px-4 py-2 text-sm text-gray-800 placeholder-gray-400 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 w-64"
        />
        <select value={filter.decision} onChange={e => setFilter(f => ({ ...f, decision: e.target.value }))}
          className="bg-white border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-700 shadow-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
          {['ALL', 'ESCALATE', 'AUTO_PATCH', 'PENDING', 'IGNORE'].map(d => (
            <option key={d} value={d}>{d === 'ALL' ? 'All Decisions' : d}</option>
          ))}
        </select>
        <span className="text-xs text-gray-400 ml-auto">{filtered.length} result{filtered.length !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100">
              {[
                { col: 'severity', label: 'Severity' },
                { col: 'service',  label: 'Service'  },
                { col: 'package',  label: 'Package'  },
                { col: 'cve_id',   label: 'CVE'      },
                { col: null,       label: 'Upgrade'  },
                { col: 'decision', label: 'Decision' },
                { col: null,       label: 'Reasoning'},
              ].map(({ col, label }) => (
                <th key={label} onClick={col ? () => toggleSort(col) : undefined}
                  className={`text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider
                    ${col ? 'cursor-pointer hover:text-gray-600 select-none' : ''}`}>
                  <span className="flex items-center gap-1">
                    {label}
                    {col && (sort.col === col
                      ? sort.dir === 'asc'
                        ? <ChevronUp size={11} className="text-indigo-500" />
                        : <ChevronDown size={11} className="text-indigo-500" />
                      : <Minus size={11} className="text-gray-300" />)}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-sm">
                No vulnerabilities match the current filters.
              </td></tr>
            )}
            {filtered.map((v, i) => (
              <tr key={i} className="hover:bg-gray-50 transition">
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${SEV_STYLE[v.severity] ?? SEV_STYLE.UNKNOWN}`}>
                    {v.severity}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-500 font-mono text-xs">{v.service}</td>
                <td className="px-4 py-3 text-gray-900 font-medium">{v.package}</td>
                <td className="px-4 py-3 text-indigo-600 font-mono text-xs">{v.cve_id}</td>
                <td className="px-4 py-3 text-xs">
                  <span className="text-red-500">{v.current_version}</span>
                  <span className="text-gray-300 mx-1">→</span>
                  <span className="text-green-600">{v.safe_version || '?'}</span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${DEC_STYLE[v.decision] ?? DEC_STYLE.PENDING}`}>
                    {v.decision ?? 'PENDING'}
                  </span>
                </td>
                <td className="px-4 py-3 text-xs text-gray-400 max-w-xs truncate">{v.reasoning || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
