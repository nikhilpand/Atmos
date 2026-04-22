"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
  ListTodo, RefreshCw, Trash2, RotateCcw, Download, Upload,
  CheckCircle2, XCircle, Clock, Loader2, AlertTriangle, Pause, Play
} from 'lucide-react';
import { adminGet, adminPost } from '@/lib/adminApi';

interface Job {
  id: string;
  filename: string;
  status: string;
  progress: number;
  phase: string;
  file_size: number;
  speed: number;
  error?: string;
  created_at: string;
  completed_at?: string;
  duration?: string;
}

interface QueueStats {
  queued: number;
  active: number;
  completed: number;
  failed: number;
}

const STATUS_COLORS: Record<string, { bg: string; text: string; icon: React.ElementType }> = {
  queued:      { bg: 'bg-zinc-500/10 border-zinc-500/15',   text: 'text-zinc-400',   icon: Clock },
  downloading: { bg: 'bg-blue-500/10 border-blue-500/15',   text: 'text-blue-400',   icon: Download },
  uploading:   { bg: 'bg-violet-500/10 border-violet-500/15', text: 'text-violet-400', icon: Upload },
  completed:   { bg: 'bg-emerald-500/10 border-emerald-500/15', text: 'text-emerald-400', icon: CheckCircle2 },
  failed:      { bg: 'bg-red-500/10 border-red-500/15',     text: 'text-red-400',    icon: XCircle },
};

function formatSpeed(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return '—';
  if (bytesPerSec > 1024 * 1024) return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  if (bytesPerSec > 1024) return `${(bytesPerSec / 1024).toFixed(0)} KB/s`;
  return `${bytesPerSec} B/s`;
}

function formatSize(bytes: number): string {
  if (!bytes) return '—';
  if (bytes > 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes > 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}

export default function QueuePage() {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [stats, setStats] = useState<QueueStats>({ queued: 0, active: 0, completed: 0, failed: 0 });
  const [isLoading, setIsLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');

  const fetchQueue = useCallback(async () => {
    try {
      const data = await adminGet('/api/admin/queue');
      setJobs(data.jobs || []);
      setStats(data.stats || { queued: 0, active: 0, completed: 0, failed: 0 });
    } catch { /* silent */ }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => {
    fetchQueue();
    const interval = setInterval(fetchQueue, 3000); // Poll every 3s for live updates
    return () => clearInterval(interval);
  }, [fetchQueue]);

  const retryJob = async (jobId: string) => {
    try {
      await adminPost(`/api/admin/queue/retry/${jobId}`);
      fetchQueue();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const clearFinished = async () => {
    try {
      await adminPost('/api/admin/queue/clear');
      fetchQueue();
    } catch (e: any) {
      alert(e.message);
    }
  };

  const filtered = filter === 'all' ? jobs : jobs.filter(j => j.status === filter);

  const statCards = [
    { label: 'Queued', value: stats.queued, color: 'text-zinc-400', bg: 'bg-zinc-500/8' },
    { label: 'Active', value: stats.active, color: 'text-blue-400', bg: 'bg-blue-500/8' },
    { label: 'Completed', value: stats.completed, color: 'text-emerald-400', bg: 'bg-emerald-500/8' },
    { label: 'Failed', value: stats.failed, color: 'text-red-400', bg: 'bg-red-500/8' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Transfer Queue</h1>
          <p className="text-white/30 text-sm mt-0.5">Manage downloads and uploads in real-time</p>
        </div>
        <div className="flex gap-2">
          <button onClick={clearFinished}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-red-500/10 hover:bg-red-500/15 border border-red-500/15 text-red-400/70 hover:text-red-400 text-xs font-medium transition-all">
            <Trash2 size={13} /> Clear Finished
          </button>
          <button onClick={fetchQueue}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] text-white/50 hover:text-white text-xs font-medium transition-all">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* Stats Row */}
      <div className="grid grid-cols-4 gap-3">
        {statCards.map(s => (
          <div key={s.label} className={`${s.bg} rounded-xl p-4 border border-white/[0.04] text-center`}>
            <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
            <p className="text-white/30 text-[11px] mt-1">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Filter Tabs */}
      <div className="flex gap-1 p-1 rounded-xl bg-white/[0.03] border border-white/[0.04] w-fit">
        {['all', 'queued', 'downloading', 'uploading', 'completed', 'failed'].map(f => (
          <button key={f} onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-all ${
              filter === f ? 'bg-white/[0.08] text-white' : 'text-white/30 hover:text-white/50'
            }`}>
            {f}
          </button>
        ))}
      </div>

      {/* Job List */}
      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 rounded-xl bg-white/[0.02] border border-white/[0.03] animate-pulse" />
          ))
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <ListTodo size={36} className="mx-auto mb-3 text-white/10" />
            <p className="text-white/25 text-sm">No jobs in queue</p>
          </div>
        ) : (
          filtered.map(job => {
            const sc = STATUS_COLORS[job.status] || STATUS_COLORS.queued;
            const Icon = sc.icon;
            const isActive = ['downloading', 'uploading'].includes(job.status);
            return (
              <div key={job.id} className={`rounded-xl border p-4 transition-all ${sc.bg}`}>
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-white/[0.04]`}>
                    <Icon size={16} className={`${sc.text} ${isActive ? 'animate-pulse' : ''}`} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white/80 text-sm font-medium truncate">{job.filename}</p>
                    <div className="flex items-center gap-3 mt-0.5">
                      <span className={`text-[10px] font-semibold uppercase ${sc.text}`}>{job.phase || job.status}</span>
                      {job.file_size > 0 && <span className="text-white/20 text-[10px]">{formatSize(job.file_size)}</span>}
                      {isActive && job.speed > 0 && <span className="text-white/20 text-[10px]">{formatSpeed(job.speed)}</span>}
                      {job.duration && <span className="text-white/15 text-[10px]">{job.duration}</span>}
                    </div>
                    {isActive && (
                      <div className="w-full h-1 rounded-full bg-white/[0.04] mt-2 overflow-hidden">
                        <div className={`h-full rounded-full transition-all duration-500 ${
                          job.status === 'downloading' ? 'bg-blue-500' : 'bg-violet-500'
                        }`} style={{ width: `${job.progress}%` }} />
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 flex-shrink-0">
                    {isActive && <span className="text-white/40 text-xs font-mono">{job.progress}%</span>}
                    {job.status === 'failed' && (
                      <button onClick={() => retryJob(job.id)} title="Retry"
                        className="p-1.5 rounded-lg text-amber-400/50 hover:text-amber-400 hover:bg-amber-500/10 transition-all">
                        <RotateCcw size={14} />
                      </button>
                    )}
                    {job.error && (
                      <span title={job.error} className="text-red-400/40 cursor-help">
                        <AlertTriangle size={14} />
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
