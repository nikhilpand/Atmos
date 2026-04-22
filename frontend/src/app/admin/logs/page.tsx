"use client";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Terminal, RefreshCw, Trash2, Download, Search, Pause, Play } from 'lucide-react';
import { adminGet } from '@/lib/adminApi';

export default function LogsPage() {
  const [logs, setLogs] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [autoScroll, setAutoScroll] = useState(true);
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchLogs = useCallback(async () => {
    if (paused) return;
    try {
      const data = await adminGet('/api/admin/logs');
      setLogs(data.logs || []);
    } catch { /* silent */ }
  }, [paused]);

  useEffect(() => {
    fetchLogs();
    const interval = setInterval(fetchLogs, 2000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const filtered = filter
    ? logs.filter(l => l.toLowerCase().includes(filter.toLowerCase()))
    : logs;

  const getLineColor = (line: string) => {
    const lower = line.toLowerCase();
    if (lower.includes('error') || lower.includes('❌') || lower.includes('failed')) return 'text-red-400/70';
    if (lower.includes('warn') || lower.includes('⚠')) return 'text-amber-400/70';
    if (lower.includes('✅') || lower.includes('success') || lower.includes('completed')) return 'text-emerald-400/70';
    if (lower.includes('🚀') || lower.includes('started') || lower.includes('booting')) return 'text-cyan-400/70';
    return 'text-white/40';
  };

  const exportLogs = () => {
    const blob = new Blob([logs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `atmos-logs-${new Date().toISOString().split('T')[0]}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Server Logs</h1>
          <p className="text-white/30 text-sm mt-0.5">{logs.length} entries · {paused ? 'Paused' : 'Live'}</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setPaused(!paused)}
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-medium transition-all ${
              paused ? 'bg-amber-500/10 border-amber-500/15 text-amber-400' : 'bg-emerald-500/10 border-emerald-500/15 text-emerald-400'
            }`}>
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? 'Resume' : 'Pause'}
          </button>
          <button onClick={exportLogs}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] text-white/50 hover:text-white text-xs font-medium transition-all">
            <Download size={13} /> Export
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
        <input
          type="text"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          placeholder="Filter logs..."
          className="w-full pl-9 pr-3 py-2 rounded-xl bg-white/[0.04] border border-white/[0.06] text-white text-xs placeholder:text-white/20 focus:outline-none focus:border-violet-500/30 transition-all font-mono"
        />
      </div>

      {/* Log container */}
      <div
        ref={containerRef}
        className="rounded-2xl bg-[#0c0c10] border border-white/[0.04] p-4 font-mono text-xs leading-relaxed max-h-[70vh] overflow-y-auto overflow-x-auto"
        onScroll={() => {
          if (containerRef.current) {
            const { scrollTop, scrollHeight, clientHeight } = containerRef.current;
            setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
          }
        }}
      >
        {filtered.length === 0 ? (
          <div className="text-center py-16">
            <Terminal size={32} className="mx-auto mb-3 text-white/10" />
            <p className="text-white/20 text-sm font-sans">No logs available</p>
          </div>
        ) : (
          filtered.map((line, i) => (
            <div key={i} className={`py-0.5 hover:bg-white/[0.02] px-2 -mx-2 rounded ${getLineColor(line)}`}>
              <span className="text-white/15 mr-3 select-none">{String(i + 1).padStart(4, ' ')}</span>
              {line}
            </div>
          ))
        )}
      </div>

      {/* Auto-scroll indicator */}
      {!autoScroll && (
        <button onClick={() => {
          setAutoScroll(true);
          if (containerRef.current) containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }}
          className="fixed bottom-6 right-6 px-4 py-2 rounded-xl bg-violet-600 text-white text-xs font-medium shadow-lg shadow-violet-500/20 hover:bg-violet-500 transition-all">
          ↓ Scroll to bottom
        </button>
      )}
    </div>
  );
}
