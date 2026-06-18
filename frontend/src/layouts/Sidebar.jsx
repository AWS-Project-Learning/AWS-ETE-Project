import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard, ShoppingCart, FileText, Package,
  ChevronRight, ShieldAlert, ScanSearch, BarChart3,
} from 'lucide-react'

const nav = [
  { to: '/',         label: 'Dashboard', icon: LayoutDashboard },
  { to: '/orders',   label: 'Orders',    icon: ShoppingCart },
  { to: '/invoices', label: 'Invoices',  icon: FileText },
]

const securitySubNav = [
  { to: '/security',           label: 'Run Scan',    icon: ScanSearch  },
  { to: '/security/dashboard', label: 'Scan Results', icon: BarChart3   },
]

export default function Sidebar() {
  const { pathname } = useLocation()
  const securityActive = pathname.startsWith('/security')

  return (
    <aside className="w-64 min-h-screen bg-white border-r border-gray-200 flex flex-col">
      {/* Logo */}
      <div className="flex items-center gap-3 px-6 py-5 border-b border-gray-100">
        <div className="bg-brand-500 p-2 rounded-xl shadow-sm shadow-brand-500/30">
          <Package size={20} className="text-white" />
        </div>
        <div>
          <p className="text-gray-900 font-bold text-sm leading-tight">OrderFlow</p>
          <p className="text-gray-400 text-xs">Management System</p>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1">
        <p className="text-gray-400 text-xs font-semibold uppercase tracking-wider px-3 mb-2">Menu</p>

        {/* Regular nav items */}
        {nav.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all group
              ${isActive
                ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30'
                : 'text-gray-500 hover:bg-brand-50 hover:text-brand-700'}`
            }
          >
            {({ isActive }) => (
              <>
                <Icon size={18} />
                <span className="flex-1">{label}</span>
                <ChevronRight size={14} className={`transition-transform ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`} />
              </>
            )}
          </NavLink>
        ))}

        {/* Security — parent item with always-visible sub-links */}
        <div>
          {/* Parent row (not a link itself, just a label) */}
          <div className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium
            ${securityActive ? 'text-brand-700' : 'text-gray-500'}`}>
            <ShieldAlert size={18} />
            <span className="flex-1">Security</span>
            <ChevronRight size={14} className={`transition-transform ${securityActive ? 'rotate-90 opacity-100' : 'opacity-30'}`} />
          </div>

          {/* Sub-links — indented, always visible */}
          <div className="ml-4 pl-3 border-l border-gray-200 space-y-0.5 mt-0.5">
            {securitySubNav.map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end
                className={({ isActive }) =>
                  `flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all
                  ${isActive
                    ? 'bg-brand-600 text-white shadow-sm shadow-brand-600/30'
                    : 'text-gray-500 hover:bg-brand-50 hover:text-brand-700'}`
                }
              >
                {({ isActive }) => (
                  <>
                    <Icon size={14} />
                    <span className="flex-1">{label}</span>
                    {isActive && <ChevronRight size={12} />}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-gray-100">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-brand-500 flex items-center justify-center text-white text-xs font-bold">R</div>
          <div>
            <p className="text-gray-900 text-xs font-medium">Rajesh</p>
            <p className="text-gray-400 text-xs">Admin</p>
          </div>
        </div>
      </div>
    </aside>
  )
}
