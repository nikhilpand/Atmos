"use client";

import React, { useState, useEffect, useCallback } from 'react';
import {
  Settings, Shield, Database, Server, Key, Bell, Globe,
  Save, RefreshCw, CheckCircle2, AlertTriangle, Eye, EyeOff, Copy, ExternalLink
} from 'lucide-react';
import { adminGet, adminPost, clearToken, API_BASE } from '@/lib/adminApi';

interface ConfigInfo {
  [key: string]: string;
}

function SettingsCard({ title, icon: Icon, children, color = 'text-violet-400/60' }: {
  title: string; icon: React.ElementType; children: React.ReactNode; color?: string;
}) {
  return (
    <div className="rounded-2xl bg-white/[0.02] border border-white/[0.04] p-5">
      <div className="flex items-center gap-2 mb-4">
        <Icon size={16} className={color} />
        <h3 className="text-white/60 text-sm font-medium">{title}</h3>
      </div>
      {children}
    </div>
  );
}

function ConfigRow({ label, value, status }: { label: string; value: string; status?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-white/[0.03] last:border-0">
      <span className="text-white/40 text-xs">{label}</span>
      <div className="flex items-center gap-2">
        {status !== undefined && (
          status ? <CheckCircle2 size={13} className="text-emerald-400" /> : <AlertTriangle size={13} className="text-red-400" />
        )}
        <span className={`text-xs font-medium ${status === false ? 'text-red-400' : 'text-white/60'}`}>{value}</span>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const [config, setConfig] = useState<ConfigInfo>({});
  const [isLoading, setIsLoading] = useState(true);
  const [showPasswords, setShowPasswords] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const fetchConfig = useCallback(async () => {
    try {
      const data = await adminGet('/api/admin/config');
      setConfig(data.config || {});
    } catch { /* silent */ }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { fetchConfig(); }, [fetchConfig]);

  const testBackend = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const start = Date.now();
      const data = await adminGet('/api/admin/health');
      const latency = Date.now() - start;
      setTestResult(`✅ Backend OK — ${latency}ms latency, CPU: ${data.cpu_percent}%, Memory: ${data.memory_percent}%`);
    } catch (e: any) {
      setTestResult(`❌ Backend Error: ${e.message}`);
    }
    finally { setTesting(false); }
  };

  const copyEndpoint = (path: string) => {
    navigator.clipboard?.writeText(`${API_BASE}${path}`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white tracking-tight">Settings</h1>
          <p className="text-white/30 text-sm mt-0.5">System configuration and diagnostics</p>
        </div>
        <button onClick={fetchConfig}
          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/[0.04] hover:bg-white/[0.07] border border-white/[0.06] text-white/50 hover:text-white text-xs font-medium transition-all">
          <RefreshCw size={13} /> Refresh
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Environment Status */}
        <SettingsCard title="Environment Variables" icon={Key} color="text-amber-400/60">
          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <div key={i} className="h-5 rounded shimmer" />)}
            </div>
          ) : (
            <div>
              {Object.entries(config).map(([key, value]) => (
                <ConfigRow
                  key={key}
                  label={key}
                  value={showPasswords ? value : (value.includes('✅') ? '✅ Configured' : value.includes('❌') ? '❌ Missing' : '•••')}
                  status={value.includes('✅') ? true : value.includes('❌') ? false : undefined}
                />
              ))}
              <button onClick={() => setShowPasswords(!showPasswords)}
                className="flex items-center gap-1.5 mt-3 text-white/25 hover:text-white/40 text-[11px] transition-colors">
                {showPasswords ? <EyeOff size={12} /> : <Eye size={12} />}
                {showPasswords ? 'Hide values' : 'Show values'}
              </button>
            </div>
          )}
        </SettingsCard>

        {/* Connection Test */}
        <SettingsCard title="Connection Test" icon={Globe} color="text-cyan-400/60">
          <div className="space-y-4">
            <div className="text-xs">
              <span className="text-white/25">Backend URL</span>
              <div className="flex items-center gap-2 mt-1.5">
                <code className="text-white/50 font-mono text-[11px] bg-white/[0.04] px-2 py-1 rounded flex-1 truncate">{API_BASE}</code>
                <button onClick={() => navigator.clipboard?.writeText(API_BASE)}
                  className="p-1 rounded text-white/20 hover:text-white transition-colors"><Copy size={13} /></button>
              </div>
            </div>

            <button onClick={testBackend} disabled={testing}
              className="w-full py-2.5 rounded-xl bg-cyan-600/20 hover:bg-cyan-600/30 border border-cyan-500/15 text-cyan-400 text-xs font-medium transition-all disabled:opacity-40">
              {testing ? 'Testing…' : 'Test Connection'}
            </button>

            {testResult && (
              <div className={`p-3 rounded-xl text-xs ${
                testResult.startsWith('✅') ? 'bg-emerald-500/8 border border-emerald-500/15 text-emerald-400' : 'bg-red-500/8 border border-red-500/15 text-red-400'
              }`}>{testResult}</div>
            )}
          </div>
        </SettingsCard>

        {/* API Endpoints */}
        <SettingsCard title="API Endpoints" icon={Server} color="text-violet-400/60">
          <div className="space-y-1.5 max-h-64 overflow-y-auto">
            {[
              { path: '/api/videos', label: 'Video Library', method: 'GET' },
              { path: '/api/files', label: 'File List', method: 'GET' },
              { path: '/api/admin/login', label: 'Admin Login', method: 'POST' },
              { path: '/api/admin/system', label: 'System Stats', method: 'GET' },
              { path: '/api/admin/health', label: 'Health Check', method: 'GET' },
              { path: '/api/admin/logs', label: 'Server Logs', method: 'GET' },
              { path: '/api/admin/queue', label: 'Queue State', method: 'GET' },
              { path: '/api/admin/config', label: 'Config', method: 'GET' },
              { path: '/api/admin/bot-info', label: 'Bot Info', method: 'GET' },
              { path: '/api/admin/history', label: 'History', method: 'GET' },
              { path: '/api/admin/activity', label: 'Activity', method: 'GET' },
              { path: '/api/admin/drive/browse', label: 'Browse Drive', method: 'GET' },
              { path: '/api/discover/search', label: 'Discover Search', method: 'POST' },
              { path: '/api/torrent-search', label: 'Torrent Search', method: 'GET' },
              { path: '/ws/admin', label: 'WebSocket', method: 'WS' },
            ].map(ep => (
              <div key={ep.path} className="flex items-center gap-2 py-1.5 group">
                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                  ep.method === 'GET' ? 'bg-emerald-500/10 text-emerald-400' :
                  ep.method === 'POST' ? 'bg-blue-500/10 text-blue-400' :
                  'bg-amber-500/10 text-amber-400'
                }`}>{ep.method}</span>
                <code className="text-white/40 text-[11px] font-mono flex-1 truncate">{ep.path}</code>
                <span className="text-white/15 text-[10px] hidden group-hover:block">{ep.label}</span>
                <button onClick={() => copyEndpoint(ep.path)}
                  className="p-1 rounded text-white/10 hover:text-white/40 opacity-0 group-hover:opacity-100 transition-all"><Copy size={11} /></button>
              </div>
            ))}
          </div>
        </SettingsCard>

        {/* Danger Zone */}
        <SettingsCard title="Danger Zone" icon={AlertTriangle} color="text-red-400/60">
          <div className="space-y-3">
            <button onClick={() => { if (confirm('Clear all session data and log out?')) { clearToken(); window.location.reload(); } }}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 hover:border-red-500/20 transition-all group">
              <div>
                <p className="text-red-400/70 text-xs font-medium group-hover:text-red-400">Clear Session</p>
                <p className="text-white/15 text-[10px] mt-0.5">Remove all auth tokens</p>
              </div>
              <Shield size={16} className="text-red-400/30 group-hover:text-red-400/50" />
            </button>

            <button onClick={async () => {
              if (!confirm('Restart the backend server? This will temporarily disrupt all connections.')) return;
              try { await adminPost('/api/admin/restart'); alert('Server restart initiated.'); } catch { /* expected */ }
            }}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 hover:border-red-500/20 transition-all group">
              <div>
                <p className="text-red-400/70 text-xs font-medium group-hover:text-red-400">Restart Server</p>
                <p className="text-white/15 text-[10px] mt-0.5">Graceful backend restart</p>
              </div>
              <Server size={16} className="text-red-400/30 group-hover:text-red-400/50" />
            </button>

            <button onClick={async () => {
              if (!confirm('Reset ALL analytics data to zero? This cannot be undone.')) return;
              try { await adminPost('/api/admin/analytics/reset'); alert('Analytics reset.'); } catch (e: any) { alert(e.message); }
            }}
              className="w-full flex items-center justify-between p-3 rounded-xl bg-red-500/5 border border-red-500/10 hover:bg-red-500/10 hover:border-red-500/20 transition-all group">
              <div>
                <p className="text-red-400/70 text-xs font-medium group-hover:text-red-400">Reset Analytics</p>
                <p className="text-white/15 text-[10px] mt-0.5">Zero all view/stream counters</p>
              </div>
              <Database size={16} className="text-red-400/30 group-hover:text-red-400/50" />
            </button>
          </div>
        </SettingsCard>
      </div>
    </div>
  );
}
