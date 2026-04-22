"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Database, Server, Radio, LogOut, Shield,
  ChevronLeft, FolderOpen, ListTodo, Activity, Settings,
  Calendar, Terminal, Menu, X, Cpu, Zap
} from 'lucide-react';
import { login, isAuthenticated, clearToken, getToken } from '@/lib/adminApi';

const ADMIN_LINKS = [
  { href: '/admin',           label: 'Dashboard',  icon: LayoutDashboard, color: 'violet' },
  { href: '/admin/library',   label: 'Library',    icon: Database,        color: 'cyan' },
  { href: '/admin/drive',     label: 'Drive',      icon: FolderOpen,      color: 'blue' },
  { href: '/admin/queue',     label: 'Queue',      icon: ListTodo,        color: 'amber' },
  { href: '/admin/discovery', label: 'Discovery',  icon: Radio,           color: 'emerald' },
  { href: '/admin/system',    label: 'System',     icon: Cpu,             color: 'rose' },
  { href: '/admin/logs',      label: 'Logs',       icon: Terminal,        color: 'orange' },
  { href: '/admin/schedules', label: 'Schedules',  icon: Calendar,        color: 'purple' },
  { href: '/admin/providers', label: 'Providers',  icon: Server,          color: 'teal' },
  { href: '/admin/settings',  label: 'Settings',   icon: Settings,        color: 'zinc' },
];

const colorMap: Record<string, string> = {
  violet:  'text-violet-400',
  cyan:    'text-cyan-400',
  blue:    'text-blue-400',
  amber:   'text-amber-400',
  emerald: 'text-emerald-400',
  rose:    'text-rose-400',
  orange:  'text-orange-400',
  purple:  'text-purple-400',
  teal:    'text-teal-400',
  zinc:    'text-zinc-400',
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    if (isAuthenticated()) {
      setAuthenticated(true);
    }
    setChecking(false);
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);
    setError('');
    const ok = await login(password);
    if (ok) {
      setAuthenticated(true);
    } else {
      setError('Invalid password');
    }
    setIsVerifying(false);
  };

  const handleLogout = () => {
    clearToken();
    setAuthenticated(false);
  };

  // Loading state
  if (checking) {
    return (
      <div className="min-h-screen bg-[#060609] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-violet-500/30 border-t-violet-500 rounded-full animate-spin" />
      </div>
    );
  }

  // Login Gate
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-[#060609] flex items-center justify-center px-4">
        {/* Gradient orbs */}
        <div className="fixed top-0 left-1/2 -translate-x-1/2 w-[600px] h-[400px] bg-violet-600/8 rounded-full blur-[120px] pointer-events-none" />
        <div className="fixed bottom-0 right-0 w-[400px] h-[300px] bg-cyan-600/5 rounded-full blur-[100px] pointer-events-none" />

        <div className="w-full max-w-sm relative z-10">
          <div className="text-center mb-8">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-gradient-to-br from-violet-600/20 to-cyan-600/20 flex items-center justify-center border border-white/[0.08] mb-5 backdrop-blur-sm">
              <Shield size={30} className="text-violet-400" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">ATMOS Control</h1>
            <p className="text-white/30 text-sm mt-1.5">Administrative access required</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div className="relative">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter admin password"
                autoFocus
                className="w-full px-4 py-3.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-white placeholder:text-white/25 text-sm focus:outline-none focus:border-violet-500/40 focus:bg-white/[0.06] transition-all"
              />
            </div>
            {error && (
              <div className="flex items-center gap-2 text-red-400 text-xs bg-red-500/10 border border-red-500/15 rounded-lg px-3 py-2">
                <X size={14} /> {error}
              </div>
            )}
            <button
              type="submit"
              disabled={isVerifying || !password}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-violet-600 to-violet-500 hover:from-violet-500 hover:to-violet-400 disabled:opacity-40 disabled:cursor-not-allowed text-white font-semibold text-sm transition-all shadow-lg shadow-violet-500/20"
            >
              {isVerifying ? (
                <span className="flex items-center justify-center gap-2">
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Authenticating…
                </span>
              ) : 'Sign In →'}
            </button>
          </form>

          <div className="text-center mt-6">
            <Link href="/" className="text-white/25 hover:text-white/40 text-xs transition-colors">
              ← Back to ATMOS
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const activeLink = ADMIN_LINKS.find(l => pathname === l.href) || ADMIN_LINKS.find(l => pathname.startsWith(l.href) && l.href !== '/admin');

  return (
    <div className="min-h-screen bg-[#060609] flex">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div className="fixed inset-0 bg-black/60 z-40 lg:hidden backdrop-blur-sm" onClick={() => setSidebarOpen(false)} />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed lg:static inset-y-0 left-0 z-50 w-60 flex-shrink-0 
        bg-[#0a0a0f]/95 backdrop-blur-xl border-r border-white/[0.04]
        flex flex-col transition-transform duration-300
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}
      `}>
        {/* Logo */}
        <div className="flex items-center justify-between p-5 border-b border-white/[0.04]">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 opacity-80 shadow-lg shadow-violet-500/20" />
            <span className="text-white font-bold tracking-wider text-sm">ATMOS</span>
            <span className="text-[10px] font-bold ml-0.5 px-1.5 py-0.5 rounded-md bg-violet-500/15 text-violet-400 border border-violet-500/20">
              CTRL
            </span>
          </div>
          <button onClick={() => setSidebarOpen(false)} className="lg:hidden text-white/30 hover:text-white p-1">
            <X size={18} />
          </button>
        </div>

        {/* Nav Links */}
        <nav className="flex-1 p-3 space-y-0.5 overflow-y-auto scrollbar-thin">
          {ADMIN_LINKS.map(link => {
            const isActive = pathname === link.href || (link.href !== '/admin' && pathname.startsWith(link.href));
            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setSidebarOpen(false)}
                className={`group flex items-center gap-3 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-all ${
                  isActive
                    ? 'bg-white/[0.06] text-white border border-white/[0.06]'
                    : 'text-white/40 hover:text-white/70 hover:bg-white/[0.03] border border-transparent'
                }`}
              >
                <link.icon size={16} className={isActive ? colorMap[link.color] : 'text-white/30 group-hover:text-white/50'} />
                {link.label}
                {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-current opacity-60" />}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="p-3 border-t border-white/[0.04] space-y-1">
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-white/25 hover:text-white/50 hover:bg-white/[0.03] text-xs transition-all"
          >
            <ChevronLeft size={14} /> Back to Site
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-red-400/40 hover:text-red-400 hover:bg-red-500/5 text-xs transition-all w-full"
          >
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0">
        {/* Top bar */}
        <header className="sticky top-0 z-30 bg-[#060609]/80 backdrop-blur-xl border-b border-white/[0.04] px-4 sm:px-6 py-3 flex items-center gap-3">
          <button onClick={() => setSidebarOpen(true)} className="lg:hidden text-white/40 hover:text-white p-1.5 rounded-lg hover:bg-white/5">
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2">
            {activeLink && <activeLink.icon size={16} className={colorMap[activeLink.color]} />}
            <span className="text-white/70 text-sm font-medium">{activeLink?.label || 'Dashboard'}</span>
          </div>
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/15">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-emerald-400 text-[11px] font-medium">Live</span>
            </div>
            <div className="text-white/20 text-[11px] font-mono hidden sm:block">
              v4.0
            </div>
          </div>
        </header>

        {/* Page Content */}
        <div className="p-4 sm:p-6 lg:p-8 max-w-7xl">
          {children}
        </div>
      </main>
    </div>
  );
}
