"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
  Calendar, Plus, Trash2, RefreshCw, Clock, CheckCircle2, XCircle, Power
} from 'lucide-react';
import { adminGet, adminPost } from '@/lib/adminApi';

interface Schedule {
  id: string;
  channel: string;
  query: string;
  interval: number;
  quality: string;
  enabled: boolean;
  created: string;
  last_run: string | null;
}

function formatInterval(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export default function SchedulesPage() {
  const [schedules, setSchedules] = useState<Schedule[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState({
    channel: '', query: '', interval: 86400, quality: '1080p'
  });

  const fetchSchedules = useCallback(async () => {
    try {
      const data = await adminGet('/api/admin/schedules');
      setSchedules(data.schedules || []);
    } catch { /* silent */ }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  const createSchedule = async () => {
    if (!form.query.trim()) return;
    try {
      await adminPost('/api/admin/schedules', form);
      setShowCreate(false);
      setForm({ channel: '', query: '', interval: 86400, quality: '1080p' });
      fetchSchedules();
    } catch (e: any) { alert(e.message); }
  };

  const deleteSchedule = async (id: string) => {
    if (!confirm('Delete this schedule?')) return;
    try {
      await adminPost('/api/admin/schedules/delete', { id });
      fetchSchedules();
    } catch (e: any) { alert(e.message); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Schedules</h1>
          <p className="text-white/30 text-sm mt-0.5">Automated content search and download schedules</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setShowCreate(true)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-semibold transition-all shadow-lg shadow-violet-500/15">
            <Plus size={14} /> Create Schedule
          </button>
          <button onClick={fetchSchedules}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] text-white/50 hover:text-white text-xs font-medium transition-all">
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* Create Modal */}
      {showCreate && (
        <div className="rounded-2xl bg-white/[0.03] border border-white/[0.06] p-5 space-y-4">
          <h3 className="text-white font-semibold text-sm">New Schedule</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-white/30 text-[11px] mb-1 block">Search Query</label>
              <input type="text" value={form.query} onChange={e => setForm(p => ({ ...p, query: e.target.value }))}
                placeholder="e.g. Breaking Bad"
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-violet-500/30" />
            </div>
            <div>
              <label className="text-white/30 text-[11px] mb-1 block">Channel (optional)</label>
              <input type="text" value={form.channel} onChange={e => setForm(p => ({ ...p, channel: e.target.value }))}
                placeholder="@channel_name"
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-violet-500/30" />
            </div>
            <div>
              <label className="text-white/30 text-[11px] mb-1 block">Interval</label>
              <select value={form.interval} onChange={e => setForm(p => ({ ...p, interval: Number(e.target.value) }))}
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/70 text-sm focus:outline-none appearance-none">
                <option value={3600} className="bg-zinc-900">Every 1 hour</option>
                <option value={21600} className="bg-zinc-900">Every 6 hours</option>
                <option value={43200} className="bg-zinc-900">Every 12 hours</option>
                <option value={86400} className="bg-zinc-900">Every 24 hours</option>
                <option value={604800} className="bg-zinc-900">Every 7 days</option>
              </select>
            </div>
            <div>
              <label className="text-white/30 text-[11px] mb-1 block">Quality</label>
              <select value={form.quality} onChange={e => setForm(p => ({ ...p, quality: e.target.value }))}
                className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white/70 text-sm focus:outline-none appearance-none">
                {['all', '2160p', '1080p', '720p', '480p'].map(q => <option key={q} value={q} className="bg-zinc-900">{q}</option>)}
              </select>
            </div>
          </div>
          <div className="flex gap-2 justify-end">
            <button onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-xl bg-white/5 text-white/40 text-sm hover:text-white/60 transition-colors">Cancel</button>
            <button onClick={createSchedule} disabled={!form.query.trim()}
              className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-sm font-medium transition-all disabled:opacity-30">
              Create
            </button>
          </div>
        </div>
      )}

      {/* Schedule List */}
      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-white/[0.02] border border-white/[0.03] animate-pulse" />
          ))}
        </div>
      ) : schedules.length === 0 ? (
        <div className="text-center py-16">
          <Calendar size={40} className="mx-auto mb-3 text-white/10" />
          <p className="text-white/25 text-sm">No schedules configured</p>
          <p className="text-white/15 text-xs mt-1">Create a schedule to automatically search and download content</p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {schedules.map(s => (
            <div key={s.id} className={`rounded-xl border p-4 transition-all ${
              s.enabled ? 'bg-white/[0.02] border-white/[0.04]' : 'bg-white/[0.01] border-white/[0.02] opacity-50'
            }`}>
              <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  s.enabled ? 'bg-violet-500/10' : 'bg-zinc-500/10'
                }`}>
                  <Calendar size={18} className={s.enabled ? 'text-violet-400' : 'text-zinc-400'} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-white/80 text-sm font-medium">{s.query}</p>
                  <div className="flex items-center gap-3 mt-1 text-[11px]">
                    {s.channel && <span className="text-blue-400/60">@{s.channel}</span>}
                    <span className="text-white/25 flex items-center gap-1"><Clock size={10} /> {formatInterval(s.interval)}</span>
                    <span className="text-white/25">{s.quality}</span>
                    <span className="text-white/15">{s.created}</span>
                    {s.last_run && <span className="text-emerald-400/50">Last: {s.last_run}</span>}
                  </div>
                </div>
                <button onClick={() => deleteSchedule(s.id)}
                  className="p-2 rounded-lg text-white/15 hover:text-red-400 hover:bg-red-500/10 transition-all">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
