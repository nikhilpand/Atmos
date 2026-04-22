"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
  Cpu, MemoryStick, HardDrive, Wifi, Clock, RefreshCw, Power,
  CheckCircle2, XCircle, AlertTriangle, Server, Bot, Database, Zap
} from 'lucide-react';
import { adminGet, adminPost } from '@/lib/adminApi';

interface HealthData {
  cpu_percent: number;
  memory_percent: number;
  memory_used: string;
  memory_total: string;
  disk_percent: number;
  disk_used: string;
  disk_total: string;
  uptime_human: string;
  uptime_seconds: number;
  api_latency_ms: number;
  python_version: string;
  platform: string;
}

interface ConfigItem { [key: string]: string }
interface BotInfo {
  bot_running: boolean;
  bot_username: string;
  allowed_user_id: string;
  queue_size: number;
  active_workers: number;
  completed: number;
  failed: number;
}

function GaugeBar({ value, label, detail, color = 'violet' }: {
  value: number; label: string; detail?: string; color?: string;
}) {
  const warn = value > 85;
  const barColor = warn ? 'from-red-500 to-orange-500' : 
    color === 'violet' ? 'from-violet-500 to-purple-500' :
    color === 'cyan' ? 'from-cyan-500 to-blue-500' :
    color === 'amber' ? 'from-amber-500 to-yellow-500' :
    'from-emerald-500 to-green-500';

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-white/60 text-sm font-medium">{label}</span>
        <span className={`text-sm font-bold ${warn ? 'text-red-400' : 'text-white/70'}`}>{value.toFixed(1)}%</span>
      </div>
      <div className="w-full h-2.5 rounded-full bg-white/[0.04] overflow-hidden">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${barColor} transition-all duration-1000`}
          style={{ width: `${Math.min(value, 100)}%` }}
        />
      </div>
      {detail && <span className="text-white/25 text-[11px]">{detail}</span>}
    </div>
  );
}

export default function SystemPage() {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [config, setConfig] = useState<ConfigItem>({});
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [history, setHistory] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [restarting, setRestarting] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [h, c, b, hist] = await Promise.allSettled([
        adminGet('/api/admin/health'),
        adminGet('/api/admin/config'),
        adminGet('/api/admin/bot-info'),
        adminGet('/api/admin/history'),
      ]);
      if (h.status === 'fulfilled') setHealth(h.value);
      if (c.status === 'fulfilled') setConfig(c.value.config || {});
      if (b.status === 'fulfilled') setBotInfo(b.value);
      if (hist.status === 'fulfilled') setHistory((hist.value.history || []).slice(0, 20));
    } catch { /* silent */ }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => {
    fetchAll();
    const interval = setInterval(fetchAll, 8000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  const restart = async () => {
    if (!confirm('Are you sure you want to restart the backend server?')) return;
    setRestarting(true);
    try { await adminPost('/api/admin/restart'); } catch { /* expected */ }
    setTimeout(() => setRestarting(false), 5000);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">System Health</h1>
          <p className="text-white/30 text-sm mt-0.5">Server metrics, config, and bot status</p>
        </div>
        <div className="flex gap-2">
          <button onClick={restart} disabled={restarting}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/15 border border-red-500/15 text-red-400/70 hover:text-red-400 text-xs font-medium transition-all disabled:opacity-30">
            <Power size={13} className={restarting ? 'animate-spin' : ''} /> {restarting ? 'Restarting…' : 'Restart Server'}
          </button>
          <button onClick={fetchAll}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] text-white/50 hover:text-white text-xs font-medium transition-all">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* Resource Gauges */}
      {health && (
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-6 space-y-5">
          <h3 className="text-white/50 text-xs font-semibold uppercase tracking-widest">Resource Usage</h3>
          <GaugeBar value={health.cpu_percent} label="CPU Usage" color="cyan" />
          <GaugeBar value={health.memory_percent} label="Memory" detail={`${health.memory_used} / ${health.memory_total}`} color="violet" />
          <GaugeBar value={health.disk_percent} label="Disk" detail={`${health.disk_used} / ${health.disk_total}`} color="amber" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t border-white/[0.04]">
            <div><span className="text-white/25 text-[11px]">Uptime</span><p className="text-white/60 text-sm font-mono mt-0.5">{health.uptime_human}</p></div>
            <div><span className="text-white/25 text-[11px]">API Latency</span><p className="text-white/60 text-sm font-mono mt-0.5">{health.api_latency_ms}ms</p></div>
            <div><span className="text-white/25 text-[11px]">Python</span><p className="text-white/60 text-sm font-mono mt-0.5">{health.python_version}</p></div>
            <div><span className="text-white/25 text-[11px]">Platform</span><p className="text-white/60 text-sm font-mono mt-0.5">{health.platform}</p></div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Bot Status */}
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Bot size={16} className="text-blue-400/60" />
            <h3 className="text-white/60 text-sm font-medium">Telegram Bot</h3>
          </div>
          {botInfo ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                {botInfo.bot_running ? (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/10 border border-emerald-500/15">
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                    <span className="text-emerald-400 text-[11px] font-medium">Online</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-red-500/10 border border-red-500/15">
                    <XCircle size={12} className="text-red-400" />
                    <span className="text-red-400 text-[11px] font-medium">Offline</span>
                  </div>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div><span className="text-white/25">Username</span><p className="text-white/50 font-mono mt-0.5">@{botInfo.bot_username}</p></div>
                <div><span className="text-white/25">User ID</span><p className="text-white/50 font-mono mt-0.5">{botInfo.allowed_user_id}</p></div>
                <div><span className="text-white/25">Queue</span><p className="text-white/50 mt-0.5">{botInfo.queue_size} pending</p></div>
                <div><span className="text-white/25">Workers</span><p className="text-white/50 mt-0.5">{botInfo.active_workers} active</p></div>
                <div><span className="text-white/25">Completed</span><p className="text-emerald-400/70 mt-0.5">{botInfo.completed}</p></div>
                <div><span className="text-white/25">Failed</span><p className="text-red-400/70 mt-0.5">{botInfo.failed}</p></div>
              </div>
            </div>
          ) : (
            <p className="text-white/20 text-sm">Loading…</p>
          )}
        </div>

        {/* Environment Config */}
        <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-5">
          <div className="flex items-center gap-2 mb-4">
            <Server size={16} className="text-violet-400/60" />
            <h3 className="text-white/60 text-sm font-medium">Environment Config</h3>
          </div>
          <div className="space-y-2">
            {Object.entries(config).map(([key, val]) => (
              <div key={key} className="flex items-center justify-between py-1.5 border-b border-white/[0.03] last:border-0">
                <span className="text-white/40 text-xs font-mono">{key}</span>
                <span className={`text-xs font-medium ${val.includes('✅') ? 'text-emerald-400' : 'text-red-400'}`}>{val}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Transfer History */}
      <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-5">
        <h3 className="text-white/50 text-xs font-semibold uppercase tracking-widest mb-3">Recent Transfer History</h3>
        {history.length > 0 ? (
          <div className="space-y-1.5 max-h-80 overflow-y-auto">
            {history.map((h: any, i: number) => (
              <div key={i} className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-white/[0.02] transition-colors">
                {h.status === 'completed' ? (
                  <CheckCircle2 size={14} className="text-emerald-400/50 flex-shrink-0" />
                ) : (
                  <XCircle size={14} className="text-red-400/50 flex-shrink-0" />
                )}
                <span className="text-white/50 text-xs truncate flex-1">{h.filename}</span>
                <span className="text-white/20 text-[10px] font-mono flex-shrink-0">{h.duration || '—'}</span>
                <span className="text-white/15 text-[10px] flex-shrink-0">{h.completed_at?.split(' ')[1] || ''}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-white/20 text-sm">No transfer history</p>
        )}
      </div>
    </div>
  );
}
