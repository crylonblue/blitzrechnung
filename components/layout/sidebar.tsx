'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LayoutDashboard, FileEdit, FileText, Users, Settings, Plus, Building2 } from 'lucide-react'
import { useDraftDrawer } from '@/contexts/draft-drawer-context'

interface SidebarProps {
  companyName: string
  userEmail: string
  userName?: string | null
}

interface NavItem {
  name: string
  href: string
  icon: React.ComponentType<{ className?: string }>
}

interface NavSection {
  title?: string
  items: NavItem[]
}

const navigation: NavSection[] = [
  {
    items: [
      { name: 'Übersicht', href: '/', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Rechnungen',
    items: [
      { name: 'Entwürfe', href: '/drafts', icon: FileEdit },
      { name: 'Rechnungen', href: '/invoices', icon: FileText },
    ],
  },
  {
    title: 'Kontakte',
    items: [
      { name: 'Kontakte', href: '/contacts', icon: Users },
    ],
  },
  {
    title: 'Einstellungen',
    items: [
      { name: 'Einstellungen', href: '/settings', icon: Settings },
    ],
  },
]

export default function Sidebar({ companyName, userEmail, userName }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const supabase = createClient()
  const { openDrawer } = useDraftDrawer()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    router.push('/login')
    router.refresh()
  }

  const handleNewInvoice = () => {
    openDrawer(null) // null = create new draft
  }

  const isActive = (href: string) => {
    if (href === '/') {
      return pathname === '/'
    }
    return pathname === href || pathname?.startsWith(href + '/')
  }

  return (
    <aside className="fixed left-0 top-0 h-full w-80 border-r border-zinc-200 dark:border-zinc-700 bg-zinc-100 dark:bg-zinc-900">
      <div className="flex h-full flex-col">
        {/* Top Section: Company Name */}
        <div className="border-b px-8 py-6" style={{ borderColor: 'var(--border-default)' }}>
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-white border" style={{ borderColor: 'var(--border-default)' }}>
              <Building2 className="h-5 w-5" style={{ color: 'var(--text-secondary)' }} />
            </div>
            <h2 className="text-base font-medium" style={{ color: 'var(--text-primary)' }}>
              {companyName}
            </h2>
          </div>
        </div>

        {/* Middle Section: New Invoice Button & Navigation */}
        <div className="flex-1 overflow-y-auto px-8 py-6">
          <button
            onClick={handleNewInvoice}
            className="mb-8 flex w-full items-center justify-center gap-2 rounded-md px-4 py-2.5 text-sm font-medium transition-all duration-200 hover:opacity-90"
            style={{
              background: 'var(--text-primary)',
              color: 'white',
              transition: 'background-color 0.2s ease, color 0.2s ease, opacity 0.2s ease',
            }}
          >
            <Plus className="h-4 w-4 transition-colors duration-200" />
            Neue Rechnung
          </button>

          <nav className="space-y-6">
            {navigation.map((section, sectionIdx) => (
              <div key={sectionIdx}>
                {section.title && (
                  <h3 className="mb-2 px-3 text-xs font-medium uppercase tracking-wider" style={{ color: 'var(--text-meta)' }}>
                    {section.title}
                  </h3>
                )}
                <div className="space-y-0.5">
                  {section.items.map((item) => {
                    const active = isActive(item.href)
                    const Icon = item.icon
                    return (
                      <Link
                        key={item.href}
                        href={item.href}
                        className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-200"
                        style={{
                          textDecoration: 'none',
                          background: active ? 'rgba(45, 45, 45, 0.08)' : 'transparent',
                          color: active ? 'var(--text-primary)' : 'var(--text-secondary)',
                          transition: 'background-color 0.2s ease, color 0.2s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (!active) {
                            e.currentTarget.style.background = 'rgba(45, 45, 45, 0.04)'
                            e.currentTarget.style.color = 'var(--text-primary)'
                            const icon = e.currentTarget.querySelector('svg')
                            if (icon) {
                              icon.style.color = 'var(--text-primary)'
                            }
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!active) {
                            e.currentTarget.style.background = 'transparent'
                            e.currentTarget.style.color = 'var(--text-secondary)'
                            const icon = e.currentTarget.querySelector('svg')
                            if (icon) {
                              icon.style.color = 'var(--text-secondary)'
                            }
                          }
                        }}
                      >
                        <Icon 
                          className={`h-4 w-4 flex-shrink-0 transition-colors duration-200 ${active ? 'text-zinc-900' : 'text-zinc-500'}`}
                        />
                        <span className="transition-colors duration-200">{item.name}</span>
                      </Link>
                    )
                  })}
                </div>
              </div>
            ))}
          </nav>
        </div>

        {/* Bottom Section: User Info & Logout */}
        <div className="border-t px-8 py-6" style={{ borderColor: 'var(--border-default)' }}>
          <div className="mb-4">
            <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              {userName || userEmail}
            </p>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-meta)' }}>
              {userEmail}
            </p>
          </div>
          <button
            onClick={handleLogout}
            className="w-full rounded-md border px-3 py-2 text-sm font-medium transition-all duration-200 hover:bg-[rgba(45,45,45,0.04)] hover:text-[var(--text-primary)]"
            style={{
              borderColor: 'var(--border-default)',
              color: 'var(--text-secondary)',
              transition: 'background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease',
            }}
          >
            Abmelden
          </button>
        </div>
      </div>
    </aside>
  )
}

