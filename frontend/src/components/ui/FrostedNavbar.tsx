"use client";

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import SearchBar from './SearchBar';
import { Settings, Menu, X, Home, Film, Tv, Sparkles, HardDrive, Download, User } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '@/store/useAuthStore';

const NAV_LINKS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/genre/28?type=movie', label: 'Movies', icon: Film },
  { href: '/genre/18?type=tv', label: 'TV Shows', icon: Tv },
  { href: '/genre/16?type=tv', label: 'Anime', icon: Sparkles },
  { href: '/library', label: 'Drive', icon: HardDrive },
  { href: '/downloader', label: 'Download', icon: Download },
];

export default function FrostedNavbar() {
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user, profile, openAuthModal, signOut } = useAuthStore();

  useEffect(() => {
    const handler = () => setScrolled(window.scrollY > 30);
    window.addEventListener('scroll', handler, { passive: true });
    return () => window.removeEventListener('scroll', handler);
  }, []);

  const router = useRouter();

  const handleSearchResult = (result: { media_type?: string; tmdb_id?: number; id?: number; title?: string; name?: string; }) => {
    const type = result.media_type || 'movie';
    const id = result.tmdb_id || result.id;
    const name = result.title || result.name || '';
    router.push(`/title/${id}?type=${type}&title=${encodeURIComponent(name)}`);
  };

  return (
    <>
      <nav className={`fixed top-0 left-0 right-0 z-[90] transition-all duration-500 ${
        scrolled
          ? 'bg-black/80 backdrop-blur-2xl border-b border-white/5 shadow-xl'
          : 'bg-gradient-to-b from-black/60 to-transparent'
      }`}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          {/* Left: Logo + Nav Links */}
          <div className="flex items-center gap-6">
            <Link href="/" className="flex items-center gap-2 flex-shrink-0">
              <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-violet-500 to-cyan-500 opacity-80" />
              <span className="text-white font-bold tracking-widest text-lg">ATMOS</span>
            </Link>

            {/* Desktop Nav */}
            <div className="hidden md:flex items-center gap-1">
              {NAV_LINKS.map(link => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="px-3 py-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/5 text-sm font-medium transition-all"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          </div>

          {/* Right: Search + Admin + Menu */}
          <div className="flex items-center gap-2">
            <SearchBar onResultClick={handleSearchResult} />

            {user ? (
              <div className="relative group/auth flex items-center">
                <button className="flex items-center justify-center w-8 h-8 rounded-full bg-violet-600/30 border border-violet-500/50 text-white font-bold text-xs uppercase transition-colors hover:bg-violet-600/50">
                  {profile?.username ? profile.username.charAt(0) : <User size={14} />}
                </button>
                <div className="absolute top-full right-0 mt-2 w-32 py-1 bg-[#111] border border-white/10 rounded-lg shadow-xl opacity-0 invisible group-hover/auth:opacity-100 group-hover/auth:visible transition-all">
                  <button
                    onClick={signOut}
                    className="w-full text-left px-4 py-2 text-xs text-white/70 hover:text-white hover:bg-white/5 transition-colors"
                  >
                    Sign Out
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={openAuthModal}
                className="hidden sm:flex items-center justify-center px-4 h-8 rounded-full bg-white text-black font-semibold text-xs hover:bg-white/90 transition-colors"
              >
                Sign In
              </button>
            )}

            <Link
              href="/admin"
              className="hidden sm:flex items-center justify-center w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
              title="Admin Dashboard"
            >
              <Settings size={14} className="text-white/50" />
            </Link>

            {/* Mobile Menu Toggle */}
            <button
              onClick={() => setMobileOpen(prev => !prev)}
              className="md:hidden flex items-center justify-center w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
            >
              {mobileOpen ? <X size={16} className="text-white/70" /> : <Menu size={16} className="text-white/70" />}
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile Slide-out Menu */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-[85] bg-black/60 backdrop-blur-sm md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            <motion.div
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 30, stiffness: 300 }}
              className="fixed top-0 right-0 bottom-0 z-[88] w-64 bg-zinc-950/95 backdrop-blur-2xl border-l border-white/5 md:hidden"
            >
              <div className="p-6 pt-20 space-y-1">
                {NAV_LINKS.map(link => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl text-white/60 hover:text-white hover:bg-white/5 transition-all"
                  >
                    <link.icon size={18} />
                    <span className="text-sm font-medium">{link.label}</span>
                  </Link>
                ))}
                <div className="h-px bg-white/5 my-3" />
                <Link
                  href="/admin"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-3 px-4 py-3 rounded-xl text-white/40 hover:text-white hover:bg-white/5 transition-all"
                >
                  <Settings size={18} />
                  <span className="text-sm font-medium">Admin</span>
                </Link>

                {!user && (
                  <button
                    onClick={() => { setMobileOpen(false); openAuthModal(); }}
                    className="w-full flex items-center justify-center mt-4 px-4 py-3 rounded-xl bg-white text-black font-bold text-sm"
                  >
                    Sign In
                  </button>
                )}
                {user && (
                  <button
                    onClick={() => { setMobileOpen(false); signOut(); }}
                    className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-red-400 hover:text-red-300 hover:bg-white/5 transition-all"
                  >
                    <span className="text-sm font-medium">Sign Out</span>
                  </button>
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
