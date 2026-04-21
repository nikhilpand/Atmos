"use client";

import React, { useState, useEffect } from 'react';
import { Server, Film, HardDrive, Activity, RefreshCw, TrendingUp } from 'lucide-react';
import { CONTROL_URL } from '@/lib/constants';

interface StatCard {
  label: string;
  value: string | number;
  icon: React.ElementType;
  color: string;
}

export default function AdminDashboard() {
  const [stats, setStats] = useState({
    totalFiles: 0,
    totalProviders: 10,
    driveConnected: false,
  });
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        // Fetch Drive files count
        const driveRes = await fetch(`${CONTROL_URL}/api/videos`);
        if (driveRes.ok) {
          const data = await driveRes.json();
          setStats(prev => ({
            ...prev,
            totalFiles: (data.videos || data.files || []).length,
            driveConnected: true,
          }));
        }

        // Fetch provider count
        const provRes = await fetch('/api/providers');
        if (provRes.ok) {
          const data = await provRes.json();
          setStats(prev => ({
            ...prev,
            totalProviders: data.providers?.length || 10,
          }));
        }
      } catch {
        // silent
      } finally {
        setIsLoading(false);
      }
    };
    fetchStats();
  }, []);

  const cards: StatCard[] = [
    { label: 'Drive Files', value: stats.totalFiles, icon: HardDrive, color: 'from-blue-500/20 to-cyan-500/20 border-blue-500/15' },
    { label: 'Providers', value: stats.totalProviders, icon: Server, color: 'from-violet-500/20 to-purple-500/20 border-violet-500/15' },
    { label: 'Drive Status', value: stats.driveConnected ? 'Connected' : 'Offline', icon: Activity, color: stats.driveConnected ? 'from-emerald-500/20 to-green-500/20 border-emerald-500/15' : 'from-red-500/20 to-orange-500/20 border-red-500/15' },
    { label: 'Version', value: 'V4.0', icon: TrendingUp, color: 'from-amber-500/20 to-orange-500/20 border-amber-500/15' },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-white">Dashboard</h1>
        <p className="text-white/40 text-sm mt-1">System overview and quick actions</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map(card => (
          <div
            key={card.label}
            className={`rounded-2xl bg-gradient-to-br ${card.color} border p-5 transition-all hover:scale-[1.02]`}
          >
            <div className="flex items-center justify-between mb-3">
              <card.icon size={20} className="text-white/50" />
            </div>
            <p className="text-2xl font-bold text-white">
              {isLoading ? '—' : card.value}
            </p>
            <p className="text-white/40 text-xs mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      {/* Quick Actions */}
      <div>
        <h2 className="text-lg font-semibold text-white mb-4">Quick Actions</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <button
            onClick={() => window.location.reload()}
            className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 transition-all text-left"
          >
            <RefreshCw size={18} className="text-violet-400" />
            <div>
              <p className="text-white text-sm font-medium">Refresh Cache</p>
              <p className="text-white/30 text-xs">Clear all API caches</p>
            </div>
          </button>

          <a
            href="/admin/providers"
            className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 transition-all"
          >
            <Server size={18} className="text-cyan-400" />
            <div>
              <p className="text-white text-sm font-medium">Manage Providers</p>
              <p className="text-white/30 text-xs">Add, edit, test servers</p>
            </div>
          </a>

          <a
            href="/admin/library"
            className="flex items-center gap-3 p-4 rounded-xl bg-white/[0.03] border border-white/5 hover:bg-white/[0.06] hover:border-white/10 transition-all"
          >
            <Film size={18} className="text-emerald-400" />
            <div>
              <p className="text-white text-sm font-medium">Browse Library</p>
              <p className="text-white/30 text-xs">View Drive files</p>
            </div>
          </a>
        </div>
      </div>

      {/* System Info */}
      <div className="rounded-2xl bg-white/[0.02] border border-white/5 p-5">
        <h3 className="text-white font-medium text-sm mb-3">System Info</h3>
        <div className="grid grid-cols-2 gap-y-2 text-xs">
          <span className="text-white/30">Platform</span>
          <span className="text-white/60">Next.js 16 + Vercel Edge</span>
          <span className="text-white/30">Media Server</span>
          <span className="text-white/60">HF Spaces (atmos-media)</span>
          <span className="text-white/30">Meta Server</span>
          <span className="text-white/60">HF Spaces (atmos-meta)</span>
          <span className="text-white/30">Drive Proxy</span>
          <span className="text-white/60">HF Spaces (gdrivefwd)</span>
          <span className="text-white/30">Database</span>
          <span className="text-white/60">Supabase (Active)</span>
        </div>
      </div>
    </div>
  );
}
