"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Database, Server, Radio, LogOut, Shield, ChevronLeft } from 'lucide-react';

const ADMIN_LINKS = [
  { href: '/admin', label: 'Dashboard', icon: LayoutDashboard },
  { href: '/admin/library', label: 'Library', icon: Database },
  { href: '/admin/providers', label: 'Providers', icon: Server },
  { href: '/admin/discovery', label: 'Discovery', icon: Radio },
];

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [authenticated, setAuthenticated] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  // Check if already authenticated
  useEffect(() => {
    const stored = localStorage.getItem('atmos_admin_auth');
    if (stored === 'true') {
      setAuthenticated(true);
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsVerifying(true);
    setError('');
    try {
      const res = await fetch('/api/admin/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (data.valid) {
        setAuthenticated(true);
        localStorage.setItem('atmos_admin_auth', 'true');
      } else {
        setError('Invalid password');
      }
    } catch {
      setError('Verification failed');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLogout = () => {
    setAuthenticated(false);
    localStorage.removeItem('atmos_admin_auth');
  };

  // Login Gate
  if (!authenticated) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center px-4">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-gradient-to-br from-violet-500/30 to-cyan-500/30 flex items-center justify-center border border-white/10 mb-4">
              <Shield size={28} className="text-violet-400" />
            </div>
            <h1 className="text-2xl font-bold text-white">ATMOS Admin</h1>
            <p className="text-white/40 text-sm mt-1">Enter password to continue</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Admin password"
              autoFocus
              className="w-full px-4 py-3 rounded-xl bg-white/5 border border-white/10 text-white placeholder:text-white/30 text-sm focus:outline-none focus:border-violet-500/30 transition-all"
            />
            {error && (
              <p className="text-red-400 text-xs text-center">{error}</p>
            )}
            <button
              type="submit"
              disabled={isVerifying}
              className="w-full py-3 rounded-xl bg-violet-600 hover:bg-violet-500 disabled:opacity-50 disabled:cursor-not-allowed text-white font-medium text-sm transition-all"
            >
              {isVerifying ? 'Verifying…' : 'Sign In'}
            </button>
          </form>

          <div className="text-center mt-6">
            <Link href="/" className="text-white/30 hover:text-white/50 text-xs transition-colors">
              ← Back to ATMOS
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black flex">
      {/* Sidebar */}
      <aside className="w-56 flex-shrink-0 bg-zinc-950/50 border-r border-white/5 p-4 flex flex-col fixed h-full">
        {/* Logo */}
        <div className="flex items-center gap-2 mb-8 px-2">
          <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 opacity-80" />
          <span className="text-white font-bold tracking-widest text-sm">ATMOS</span>
          <span className="text-violet-400 text-[10px] font-semibold ml-1 px-1.5 py-0.5 rounded bg-violet-500/10 border border-violet-500/20">ADMIN</span>
        </div>

        {/* Nav Links */}
        <nav className="space-y-1 flex-1">
          {ADMIN_LINKS.map(link => {
            const isActive = pathname === link.href;
            return (
              <Link
                key={link.href}
                href={link.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-violet-600/15 text-violet-300 border border-violet-500/15'
                    : 'text-white/50 hover:text-white hover:bg-white/5 border border-transparent'
                }`}
              >
                <link.icon size={16} />
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* Bottom Actions */}
        <div className="space-y-2 mt-auto pt-4 border-t border-white/5">
          <Link
            href="/"
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-white/30 hover:text-white hover:bg-white/5 text-xs transition-all"
          >
            <ChevronLeft size={14} /> Back to Site
          </Link>
          <button
            onClick={handleLogout}
            className="flex items-center gap-2 px-3 py-2 rounded-xl text-red-400/50 hover:text-red-400 hover:bg-red-500/5 text-xs transition-all w-full"
          >
            <LogOut size={14} /> Sign Out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 ml-56 p-6 sm:p-8">
        {children}
      </main>
    </div>
  );
}
