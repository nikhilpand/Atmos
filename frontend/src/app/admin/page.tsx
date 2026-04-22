"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
  Server, Film, HardDrive, Activity, RefreshCw, TrendingUp, Cpu, MemoryStick,
  Database, Wifi, WifiOff, Clock, Zap, ArrowUpRight, ArrowDownRight,
  Bot, Download, Upload, AlertTriangle, CheckCircle2, XCircle, BarChart3, ListTodo
} from 'lucide-react';
import { adminGet, adminPost, publicGet } from '@/lib/adminApi';

interface SystemData {
  bot_online?: boolean;
  drive_connected?: boolean;
  total_files?: number;
  total_size?: string;
  active_transfers?: number;
  active_transfer_details?: any[];
  failed_transfers?: any[];
  queue_size?: number;
  uptime?: string;
  storage?: { used?: string; total?: string; percent?: number };
  analytics?: { total_views?: number; stream_starts?: number };
}

interface HealthData {
  cpu_percent?: number;
  memory_percent?: number;
  memory_used?: string;
  memory_total?: string;
  disk_percent?: number;
  disk_used?: string;
  disk_total?: string;
  uptime_human?: string;
  api_latency_ms?: number;
  python_version?: string;
  platform?: string;
}

interface ActivityEvent {
  icon: string;
  text: string;
  category: string;
  ts: string;
}

// ─── Metric Ring ─────────────────────────────────────────────────
function MetricRing({ value, max = 100, label, sub, color = 'violet', size = 88 }: {
  value: number; max?: number; label: string; sub?: string; color?: string; size?: number;
}) {
  const pct = Math.min((value / max) * 100, 100);
  const radius = (size - 10) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;
  const colors: Record<string, string> = {
    violet: 'stroke-violet-500', cyan: 'stroke-cyan-500', emerald: 'stroke-emerald-500',
    amber: 'stroke-amber-500', rose: 'stroke-rose-500', blue: 'stroke-blue-500',
  };
  const bgColors: Record<string, string> = {
    violet: 'stroke-violet-500/10', cyan: 'stroke-cyan-500/10', emerald: 'stroke-emerald-500/10',
    amber: 'stroke-amber-500/10', rose: 'stroke-rose-500/10', blue: 'stroke-blue-500/10',
  };
  const warn = pct > 85;
  const activeColor = warn ? 'stroke-rose-500' : (colors[color] || colors.violet);
  const activeBg = warn ? 'stroke-rose-500/10' : (bgColors[color] || bgColors.violet);

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className={activeBg} strokeWidth={4} />
          <circle cx={size / 2} cy={size / 2} r={radius} fill="none" className={activeColor}
            strokeWidth={4} strokeLinecap="round" strokeDasharray={circumference} strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 1s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-white font-bold text-lg leading-none">{Math.round(pct)}%</span>
        </div>
      </div>
      <span className="text-white/50 text-[11px] font-medium">{label}</span>
      {sub && <span className="text-white/25 text-[10px] -mt-1">{sub}</span>}
    </div>
  );
}

// ─── Status Pill ─────────────────────────────────────────────────
function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-medium ${
      ok ? 'bg-emerald-500/8 border-emerald-500/15 text-emerald-400' : 'bg-red-500/8 border-red-500/15 text-red-400'
    }`}>
      <div className={`w-1.5 h-1.5 rounded-full ${ok ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
      {label}
    </div>
  );
}

// ─── Stat Card ───────────────────────────────────────────────────
function StatCard({ icon: Icon, label, value, sub, gradient }: {
  icon: React.ElementType; label: string; value: string | number; sub?: string;
  gradient: string;
}) {
  return (
    <div className={`rounded-2xl bg-gradient-to-br ${gradient} border border-white/[0.04] p-5 hover:border-white/[0.08] transition-all group`}>
      <div className="flex items-center justify-between mb-3">
        <Icon size={18} className="text-white/40 group-hover:text-white/60 transition-colors" />
        {sub && <span className="text-white/20 text-[10px] font-mono">{sub}</span>}
      </div>
      <p className="text-2xl font-bold text-white tracking-tight">{value}</p>
      <p className="text-white/35 text-xs mt-1">{label}</p>
    </div>
  );
}

export default function AdminDashboard() {
  const [system, setSystem] = useState<SystemData | null>(null);
  const [health, setHealth] = useState<HealthData | null>(null);
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [videoCount, setVideoCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [sysRes, healthRes, actRes, vidRes] = await Promise.allSettled([
        adminGet('/api/admin/system'),
        adminGet('/api/admin/health'),
        adminGet('/api/admin/activity?limit=15'),
        publicGet('/api/videos'),
      ]);
      if (sysRes.status === 'fulfilled') setSystem(sysRes.value);
      if (healthRes.status === 'fulfilled') setHealth(healthRes.value);
      if (actRes.status === 'fulfilled') setActivity(actRes.value.events || []);
      if (vidRes.status === 'fulfilled') setVideoCount(vidRes.value.videos?.length || 0);
      setLastRefresh(new Date());
    } catch { /* silent */ } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 10000); // Auto-refresh every 10s
    return () => clearInterval(interval);
  }, [fetchAll]);

  const refresh = () => {
    setRefreshing(true);
    fetchAll();
  };

  const botOnline = system?.bot_online ?? false;
  const driveOk = system?.drive_connected ?? false;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Dashboard</h1>
          <p className="text-white/30 text-sm mt-0.5">
            Real-time system overview
            {lastRefresh && <span className="text-white/15 ml-2">· Last: {lastRefresh.toLocaleTimeString()}</span>}
          </p>
        </div>
        <button onClick={refresh} disabled={refreshing}
          className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] text-white/50 hover:text-white text-xs font-medium transition-all disabled:opacity-40">
          <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {/* Service Status Row */}
      <div className="flex flex-wrap gap-2">
        <StatusPill ok={botOnline} label={botOnline ? 'Telegram Bot Online' : 'Bot Offline'} />
        <StatusPill ok={driveOk} label={driveOk ? 'Google Drive Connected' : 'Drive Disconnected'} />
        <StatusPill ok={!!health} label={health ? `API ${health.api_latency_ms}ms` : 'API Unreachable'} />
        <StatusPill ok={(system?.queue_size || 0) === 0} label={`Queue: ${system?.queue_size || 0}`} />
      </div>

      {/* Live Metrics Rings */}
      {health && (
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-6">
          <h3 className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-5">Live Metrics</h3>
          <div className="flex flex-wrap items-center justify-center gap-8">
            <MetricRing value={health.cpu_percent || 0} label="CPU" sub={`${health.cpu_percent?.toFixed(1)}%`} color="cyan" />
            <MetricRing value={health.memory_percent || 0} label="Memory" sub={`${health.memory_used || '?'} / ${health.memory_total || '?'}`} color="violet" />
            <MetricRing value={health.disk_percent || 0} label="Disk" sub={`${health.disk_used || '?'} / ${health.disk_total || '?'}`} color="amber" />
            {health.api_latency_ms !== undefined && (
              <MetricRing value={Math.min(health.api_latency_ms, 500)} max={500} label="Latency" sub={`${health.api_latency_ms}ms`} color="emerald" />
            )}
          </div>
        </div>
      )}

      {/* Stat Cards Grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard icon={Film} label="Library Files" value={isLoading ? '—' : videoCount} gradient="from-blue-500/8 to-cyan-500/8" sub="Drive" />
        <StatCard icon={Download} label="Active Transfers" value={isLoading ? '—' : (system?.active_transfers || 0)} gradient="from-violet-500/8 to-purple-500/8" sub="Live" />
        <StatCard icon={ListTodo} label="Queue Size" value={isLoading ? '—' : (system?.queue_size || 0)} gradient="from-amber-500/8 to-orange-500/8" />
        <StatCard icon={BarChart3} label="Stream Starts" value={isLoading ? '—' : (system?.analytics?.stream_starts || 0)} gradient="from-emerald-500/8 to-green-500/8" />
        <StatCard icon={Clock} label="Uptime" value={isLoading ? '—' : (health?.uptime_human || system?.uptime || '—')} gradient="from-rose-500/8 to-pink-500/8" />
      </div>

      {/* Storage + Active Transfers Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Google Drive Storage */}
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-5">
          <div className="flex items-center gap-2 mb-4">
            <HardDrive size={16} className="text-blue-400/60" />
            <h3 className="text-white/60 text-sm font-medium">Google Drive Storage</h3>
          </div>
          {system?.storage && system.storage.percent !== undefined ? (
            <>
              <div className="w-full h-2.5 rounded-full bg-white/[0.04] overflow-hidden mb-3">
                <div
                  className={`h-full rounded-full transition-all duration-1000 ${
                    (system.storage.percent || 0) > 90 ? 'bg-gradient-to-r from-red-500 to-orange-500' :
                    (system.storage.percent || 0) > 70 ? 'bg-gradient-to-r from-amber-500 to-yellow-500' :
                    'bg-gradient-to-r from-blue-500 to-cyan-500'
                  }`}
                  style={{ width: `${system.storage.percent}%` }}
                />
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-white/40">{system.storage.used} used</span>
                <span className="text-white/25">{system.storage.total} total</span>
              </div>
            </>
          ) : (
            <p className="text-white/20 text-sm">Storage info unavailable</p>
          )}
        </div>

        {/* Active Transfers */}
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Upload size={16} className="text-violet-400/60" />
            <h3 className="text-white/60 text-sm font-medium">Active Transfers</h3>
          </div>
          {(system?.active_transfer_details?.length || 0) > 0 ? (
            <div className="space-y-2.5 max-h-40 overflow-y-auto">
              {system!.active_transfer_details!.map((t: any, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-white/70 text-xs truncate">{t.filename}</p>
                    <div className="w-full h-1 rounded-full bg-white/[0.04] mt-1 overflow-hidden">
                      <div className="h-full bg-violet-500 rounded-full transition-all" style={{ width: `${t.progress || 0}%` }} />
                    </div>
                  </div>
                  <span className="text-white/30 text-[10px] font-mono flex-shrink-0">{t.progress || 0}%</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-white/20 text-sm">No active transfers</p>
          )}
        </div>
      </div>

      {/* Activity Feed */}
      <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-5">
        <div className="flex items-center gap-2 mb-4">
          <Activity size={16} className="text-emerald-400/60" />
          <h3 className="text-white/60 text-sm font-medium">Activity Feed</h3>
          <span className="text-white/15 text-[10px] ml-auto">Live</span>
        </div>
        {activity.length > 0 ? (
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {activity.map((evt, i) => (
              <div key={i} className="flex items-start gap-2.5 py-1.5 px-2 rounded-lg hover:bg-white/[0.02] transition-colors">
                <span className="text-sm flex-shrink-0 mt-0.5">{evt.icon}</span>
                <p className="text-white/50 text-xs flex-1">{evt.text}</p>
                <span className="text-white/15 text-[10px] font-mono flex-shrink-0">{evt.ts}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-white/20 text-sm">No recent activity</p>
        )}
      </div>

      {/* System Info */}
      <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-5">
        <h3 className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-3">System Info</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-y-2.5 gap-x-6 text-xs">
          <div><span className="text-white/25">Platform</span><p className="text-white/50 mt-0.5">{health?.platform || '—'}</p></div>
          <div><span className="text-white/25">Python</span><p className="text-white/50 mt-0.5">{health?.python_version || '—'}</p></div>
          <div><span className="text-white/25">Frontend</span><p className="text-white/50 mt-0.5">Next.js 16 + Edge</p></div>
          <div><span className="text-white/25">Drive Files</span><p className="text-white/50 mt-0.5">{system?.total_files || 0} ({system?.total_size || '0 B'})</p></div>
          <div><span className="text-white/25">API Latency</span><p className="text-white/50 mt-0.5">{health?.api_latency_ms ?? '—'}ms</p></div>
          <div><span className="text-white/25">Uptime</span><p className="text-white/50 mt-0.5">{health?.uptime_human || system?.uptime || '—'}</p></div>
        </div>
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-3">Quick Actions</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2.5">
          {[
            { label: 'Refresh Cache', sub: 'Force video list refresh', icon: RefreshCw, color: 'text-cyan-400', action: () => publicGet('/api/videos?force_refresh=true') },
            { label: 'Reset Analytics', sub: 'Zero all counters', icon: BarChart3, color: 'text-amber-400', action: () => adminPost('/api/admin/analytics/reset') },
            { label: 'Restart Server', sub: 'Graceful restart', icon: Zap, color: 'text-rose-400', action: () => { if (confirm('Restart the backend server?')) adminPost('/api/admin/restart'); } },
            { label: 'Reorganize Drive', sub: 'Fix folder structure', icon: Database, color: 'text-violet-400', action: () => { if (confirm('Start Drive reorganization?')) adminPost('/api/admin/reorganize'); } },
          ].map(({ label, sub, icon: Icon, color, action }) => (
            <button key={label} onClick={action}
              className="flex items-center gap-3 p-3.5 rounded-xl bg-white/[0.02] border border-white/[0.04] hover:bg-white/[0.04] hover:border-white/[0.08] transition-all text-left group">
              <Icon size={16} className={`${color} opacity-60 group-hover:opacity-100 transition-opacity`} />
              <div>
                <p className="text-white/70 text-xs font-medium group-hover:text-white transition-colors">{label}</p>
                <p className="text-white/20 text-[10px]">{sub}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
