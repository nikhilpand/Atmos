"use client";

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus, Server, Check, X, AlertTriangle, RefreshCw, Trash2,
  GripVertical, TestTube2, ToggleLeft, ToggleRight, Edit3, Save
} from 'lucide-react';
import { DEFAULT_PROVIDERS } from '@/lib/providers';

// Read admin password from sessionStorage (set by admin login page)
function getAdminPassword(): string {
  if (typeof window === 'undefined') return '';
  return sessionStorage.getItem('atmos_admin_pwd') || '';
}

interface UIProvider {
  id: string;
  name: string;
  slug: string;
  url_pattern: string;
  enabled: boolean;
  priority: number;
  health_score: number;
  fail_count: number;
  last_checked: string | null;
  _testing?: boolean;
  _testResult?: 'pass' | 'fail' | null;
  _editing?: boolean;
}

export default function AdminProviders() {
  const [providers, setProviders] = useState<UIProvider[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProvider, setNewProvider] = useState({ name: '', slug: '', url_pattern: '', priority: 50 });

  const fetchProviders = async () => {
    setIsLoading(true);
    try {
      const res = await fetch('/api/providers', {
        headers: { 'x-admin-password': getAdminPassword() },
      });
      if (res.ok) {
        const data = await res.json();
        setProviders(data.providers || []);
      } else {
        // Use defaults
        setProviders(DEFAULT_PROVIDERS.map(p => ({
          id: p.id,
          name: p.name,
          slug: p.slug,
          url_pattern: p.urlPattern,
          enabled: p.enabled,
          priority: p.priority,
          health_score: p.healthScore,
          fail_count: p.failCount,
          last_checked: null,
        })));
      }
    } catch {
      setProviders(DEFAULT_PROVIDERS.map(p => ({
        id: p.id,
        name: p.name,
        slug: p.slug,
        url_pattern: p.urlPattern,
        enabled: p.enabled,
        priority: p.priority,
        health_score: p.healthScore,
        fail_count: p.failCount,
        last_checked: null,
      })));
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch providers
  useEffect(() => {
    fetchProviders();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Toggle provider enabled/disabled
  const toggleProvider = async (provider: UIProvider) => {
    const updated = { ...provider, enabled: !provider.enabled };
    setProviders(prev => prev.map(p => p.id === provider.id ? updated : p));

    try {
      await fetch('/api/providers', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': getAdminPassword(),
        },
        body: JSON.stringify({ id: provider.id, enabled: !provider.enabled }),
      });
    } catch {
      // Revert on error
      setProviders(prev => prev.map(p => p.id === provider.id ? provider : p));
    }
  };

  // Test provider
  const testProvider = async (provider: UIProvider) => {
    setProviders(prev => prev.map(p =>
      p.id === provider.id ? { ...p, _testing: true, _testResult: null } : p
    ));

    try {
      // Test with a known TMDB ID (Fight Club = 550)
      const testUrl = provider.url_pattern
        .replace('{tmdb_id}', '550')
        .replace('{type}', 'movie');

      await fetch(testUrl, {
        method: 'HEAD',
        mode: 'no-cors',
        signal: AbortSignal.timeout(5000),
      });

      // no-cors HEAD request will always return opaque response, but no throw = likely alive
      setProviders(prev => prev.map(p =>
        p.id === provider.id ? { ...p, _testing: false, _testResult: 'pass' } : p
      ));
    } catch {
      setProviders(prev => prev.map(p =>
        p.id === provider.id ? { ...p, _testing: false, _testResult: 'fail' } : p
      ));
    }

    // Clear test result after 5s
    setTimeout(() => {
      setProviders(prev => prev.map(p =>
        p.id === provider.id ? { ...p, _testResult: null } : p
      ));
    }, 5000);
  };

  // Reset health
  const resetHealth = async (provider: UIProvider) => {
    const updated = { ...provider, health_score: 100, fail_count: 0 };
    setProviders(prev => prev.map(p => p.id === provider.id ? updated : p));

    try {
      await fetch('/api/providers', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': getAdminPassword(),
        },
        body: JSON.stringify({ id: provider.id, health_score: 100, fail_count: 0 }),
      });
    } catch { /* silent */ }
  };

  // Add provider
  const addProvider = async () => {
    if (!newProvider.name || !newProvider.slug || !newProvider.url_pattern) return;

    try {
      const res = await fetch('/api/providers', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': getAdminPassword(),
        },
        body: JSON.stringify(newProvider),
      });

      if (res.ok) {
        fetchProviders();
        setShowAddModal(false);
        setNewProvider({ name: '', slug: '', url_pattern: '', priority: 50 });
      }
    } catch { /* silent */ }
  };

  // Delete provider
  const deleteProvider = async (id: string) => {
    if (!confirm('Delete this provider?')) return;

    setProviders(prev => prev.filter(p => p.id !== id));

    try {
      await fetch(`/api/providers?id=${id}`, {
        method: 'DELETE',
        headers: { 'x-admin-password': getAdminPassword() },
      });
    } catch {
      fetchProviders(); // Refetch on error
    }
  };

  const healthColor = (score: number) => {
    if (score >= 80) return 'text-emerald-400 bg-emerald-500/10';
    if (score >= 50) return 'text-amber-400 bg-amber-500/10';
    return 'text-red-400 bg-red-500/10';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Providers</h1>
          <p className="text-white/40 text-sm mt-1">Manage streaming embed providers</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={fetchProviders}
            className="px-3 py-2 rounded-xl bg-white/5 hover:bg-white/10 border border-white/10 text-white/60 text-xs font-medium transition-all flex items-center gap-1.5"
          >
            <RefreshCw size={12} /> Refresh
          </button>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium transition-all flex items-center gap-1.5"
          >
            <Plus size={14} /> Add Provider
          </button>
        </div>
      </div>

      {/* Provider List */}
      <div className="space-y-2">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 rounded-2xl bg-white/[0.02] border border-white/5">
              <div className="w-8 h-8 rounded-lg shimmer" />
              <div className="flex-1 space-y-2">
                <div className="h-4 w-1/3 rounded shimmer" />
                <div className="h-3 w-2/3 rounded shimmer" />
              </div>
            </div>
          ))
        ) : providers.length === 0 ? (
          <div className="text-center py-16">
            <Server size={40} className="text-white/10 mx-auto mb-3" />
            <p className="text-white/30">No providers configured</p>
          </div>
        ) : (
          providers.map((provider, index) => (
            <motion.div
              key={provider.id}
              layout
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.03 }}
              className={`flex items-center gap-4 p-4 rounded-2xl border transition-all ${
                provider.enabled
                  ? 'bg-white/[0.02] border-white/5 hover:border-white/10'
                  : 'bg-red-900/5 border-red-500/10 opacity-60'
              }`}
            >
              {/* Priority Badge */}
              <div className="w-8 h-8 rounded-lg bg-white/5 flex items-center justify-center text-white/30 text-xs font-bold flex-shrink-0">
                #{provider.priority}
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-white text-sm font-medium">{provider.name}</h3>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${healthColor(provider.health_score)}`}>
                    {provider.health_score}%
                  </span>
                  {provider.fail_count > 0 && (
                    <span className="text-red-400/60 text-[10px]">
                      {provider.fail_count} fails
                    </span>
                  )}
                  {/* Test result indicator */}
                  {provider._testResult === 'pass' && (
                    <span className="text-emerald-400 text-[10px] flex items-center gap-0.5">
                      <Check size={10} /> Alive
                    </span>
                  )}
                  {provider._testResult === 'fail' && (
                    <span className="text-red-400 text-[10px] flex items-center gap-0.5">
                      <X size={10} /> Down
                    </span>
                  )}
                </div>
                <p className="text-white/30 text-xs truncate mt-0.5 font-mono">{provider.url_pattern}</p>
              </div>

              {/* Actions */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {/* Test */}
                <button
                  onClick={() => testProvider(provider)}
                  disabled={provider._testing}
                  className="p-2 rounded-lg text-white/30 hover:text-cyan-400 hover:bg-cyan-500/10 transition-all disabled:opacity-30"
                  title="Test provider"
                >
                  {provider._testing ? (
                    <div className="w-3.5 h-3.5 border border-white/20 border-t-white rounded-full animate-spin" />
                  ) : (
                    <TestTube2 size={14} />
                  )}
                </button>

                {/* Reset Health */}
                {provider.fail_count > 0 && (
                  <button
                    onClick={() => resetHealth(provider)}
                    className="p-2 rounded-lg text-white/30 hover:text-amber-400 hover:bg-amber-500/10 transition-all"
                    title="Reset health"
                  >
                    <RefreshCw size={14} />
                  </button>
                )}

                {/* Toggle Enable/Disable */}
                <button
                  onClick={() => toggleProvider(provider)}
                  className={`p-2 rounded-lg transition-all ${
                    provider.enabled
                      ? 'text-emerald-400 hover:bg-emerald-500/10'
                      : 'text-red-400/50 hover:bg-red-500/10'
                  }`}
                  title={provider.enabled ? 'Disable' : 'Enable'}
                >
                  {provider.enabled ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                </button>

                {/* Delete */}
                <button
                  onClick={() => deleteProvider(provider.id)}
                  className="p-2 rounded-lg text-white/20 hover:text-red-400 hover:bg-red-500/10 transition-all"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Add Provider Modal */}
      <AnimatePresence>
        {showAddModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[200] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setShowAddModal(false)}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-md bg-zinc-900 rounded-2xl border border-white/10 p-6 space-y-5"
            >
              <div className="flex items-center justify-between">
                <h2 className="text-white font-bold text-lg">Add Provider</h2>
                <button onClick={() => setShowAddModal(false)} className="text-white/30 hover:text-white">
                  <X size={18} />
                </button>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-white/50 text-xs font-medium mb-1 block">Name</label>
                  <input
                    type="text"
                    value={newProvider.name}
                    onChange={e => setNewProvider(p => ({ ...p, name: e.target.value }))}
                    placeholder="e.g. VidSrc Pro"
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-violet-500/30"
                  />
                </div>
                <div>
                  <label className="text-white/50 text-xs font-medium mb-1 block">Slug</label>
                  <input
                    type="text"
                    value={newProvider.slug}
                    onChange={e => setNewProvider(p => ({ ...p, slug: e.target.value }))}
                    placeholder="e.g. vidsrc-pro"
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm placeholder:text-white/20 focus:outline-none focus:border-violet-500/30"
                  />
                </div>
                <div>
                  <label className="text-white/50 text-xs font-medium mb-1 block">
                    URL Pattern
                    <span className="text-white/20 ml-1">Use {'{tmdb_id}'} and {'{type}'}</span>
                  </label>
                  <input
                    type="text"
                    value={newProvider.url_pattern}
                    onChange={e => setNewProvider(p => ({ ...p, url_pattern: e.target.value }))}
                    placeholder="https://example.com/embed/{type}/{tmdb_id}"
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm font-mono placeholder:text-white/20 focus:outline-none focus:border-violet-500/30"
                  />
                </div>
                <div>
                  <label className="text-white/50 text-xs font-medium mb-1 block">Priority (1 = highest)</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    value={newProvider.priority}
                    onChange={e => setNewProvider(p => ({ ...p, priority: parseInt(e.target.value) || 50 }))}
                    className="w-full px-3 py-2.5 rounded-xl bg-white/5 border border-white/10 text-white text-sm focus:outline-none focus:border-violet-500/30"
                  />
                </div>
              </div>

              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setShowAddModal(false)}
                  className="px-4 py-2 rounded-xl bg-white/5 text-white/50 text-sm hover:bg-white/10 transition-all"
                >
                  Cancel
                </button>
                <button
                  onClick={addProvider}
                  disabled={!newProvider.name || !newProvider.slug || !newProvider.url_pattern}
                  className="px-4 py-2 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-500 transition-all disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1.5"
                >
                  <Plus size={14} /> Add Provider
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
