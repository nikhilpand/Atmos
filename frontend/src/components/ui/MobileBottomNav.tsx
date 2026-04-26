"use client";

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Film, Tv, Search, Download } from 'lucide-react';
import { motion } from 'framer-motion';

const TABS = [
  { href: '/', label: 'Home', icon: Home },
  { href: '/genre/28?type=movie', label: 'Movies', icon: Film },
  { href: '/genre/18?type=tv', label: 'TV', icon: Tv },
  { href: '/downloader', label: 'Download', icon: Download },
];

export default function MobileBottomNav() {
  const pathname = usePathname();

  // Hide on player page and admin pages
  if (pathname.startsWith('/watch/') || pathname.startsWith('/admin')) return null;

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-[80] md:hidden">
      {/* Blur backdrop */}
      <div className="absolute inset-0 bg-black/80 backdrop-blur-2xl border-t border-white/5" />
      
      {/* Safe area padding for notch phones */}
      <div className="relative flex items-stretch justify-around" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
        {TABS.map(tab => {
          const isActive = pathname === tab.href || 
            (tab.href !== '/' && pathname.startsWith(tab.href.split('?')[0]));
          
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className="flex flex-col items-center justify-center py-2 px-4 min-h-[56px] relative"
            >
              {isActive && (
                <motion.div
                  layoutId="mobile-nav-indicator"
                  className="absolute top-0 left-1/2 -translate-x-1/2 w-6 h-0.5 rounded-full bg-violet-500"
                  transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                />
              )}
              <tab.icon
                size={20}
                className={`transition-colors ${isActive ? 'text-white' : 'text-white/30'}`}
                strokeWidth={isActive ? 2.5 : 1.5}
              />
              <span className={`text-[10px] mt-1 font-medium transition-colors ${isActive ? 'text-white' : 'text-white/30'}`}>
                {tab.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
