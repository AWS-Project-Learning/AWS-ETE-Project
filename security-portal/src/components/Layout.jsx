import { Outlet, NavLink } from 'react-router-dom'
import { ShieldAlert, LayoutDashboard, Bot, ChevronRight } from 'lucide-react'

const nav = [
  { to: '/',          label: 'Scan',      icon: Bot,             end: true },
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, end: false },
]

export default function Layout() {
  return (
    <div className="flex min-h-screen bg-gray-950">
      {/* Sidebar */}
      <aside className="w-60 bg-gray-900 border-r border-gray-800 flex flex-col">
        {/* Logo */}
        <div className="flex items-center gap-3 px-5 py-5 border-b border-gray-800">
          <div className="bg-indigo-600 p-2 rounded-xl">
            <ShieldAlert size={18} className="text-white" />
          </div>
          <div>
            <p className="text-white font-bold text-sm leading-tight">Security Portal</p>
            <p className="text-gray-500 text-xs">AI Vulnerability Agent</p>
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {nav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition group
                ${isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-gray-400 hover:bg-gray-800 hover:text-white'}`
              }
            >
              {({ isActive }) => (
                <>
                  <Icon size={17} />
                  <span className="flex-1">{label}</span>
                  <ChevronRight
                    size={13}
                    className={`transition-opacity ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-50'}`}
                  />
                </>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-gray-800">
          <p className="text-gray-600 text-xs">
            Scans any GitHub repo via OSV.dev + Bedrock Claude
          </p>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  )
}
