/**
 * agent.js — Direct client for the Lambda Function URL.
 *
 * This portal is completely standalone — it calls the vulnerability agent
 * Lambda Function URL directly. No BFF, no ALB, no proxy involved.
 *
 * The Function URL is read from the VITE_AGENT_URL environment variable:
 *   - Local dev:  set in .env.local
 *   - CI/CD:      injected from SSM by the build pipeline
 *
 * The Lambda handler accepts:
 *   POST / { action: "scan",   repo_owner, repo_name, repo_branch, services }
 *   POST / { action: "reason", scan_id }
 *   GET  / with ?action=status
 *   GET  / with ?action=status  (results)
 */

const AGENT_URL = import.meta.env.VITE_AGENT_URL

if (!AGENT_URL) {
  console.warn(
    '[security-portal] VITE_AGENT_URL is not set. ' +
    'Create a .env.local file with VITE_AGENT_URL=<your Lambda Function URL>'
  )
}

async function call(body) {
  const res = await fetch(AGENT_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(err.message ?? `Agent error ${res.status}`)
  }
  return res.json()
}

async function get(action) {
  const res = await fetch(`${AGENT_URL}?action=${action}`)
  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }))
    throw new Error(err.message ?? `Agent error ${res.status}`)
  }
  return res.json()
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Trigger a vulnerability scan.
 * @param {object} config - { repo_owner, repo_name, repo_branch, services }
 *   All fields optional — Lambda uses its default env vars when not set.
 *   Pass custom fields to scan ANY GitHub repository.
 */
export function triggerScan(config = {}) {
  return call({ action: 'scan', ...config })
}

/**
 * Trigger AI reasoning on the latest scan results.
 * @param {string|null} scan_id - specific scan to reason on, or null for latest
 */
export function triggerReason(scan_id = null) {
  return call({ action: 'reason', ...(scan_id ? { scan_id } : {}) })
}

/** Get current metrics + active vulnerabilities for the dashboard */
export function getStatus() {
  return call({ action: 'status' })
}
