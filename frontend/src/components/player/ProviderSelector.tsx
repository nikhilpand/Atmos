"use client";

import React from 'react';
import { motion } from 'framer-motion';
import { Server, CheckCircle2, AlertCircle, Wifi } from 'lucide-react';

interface ProviderSelectorProps {
  providers: { id: string; name: string; url: string; priority: number; healthScore?: number }[];
  activeProviderId: string;
  onSelect: (id: string) => void;
  failedProviders?: Set<string>;
  compact?: boolean;
}

export default function ProviderSelector({
  providers,
  activeProviderId,
  onSelect,
  failedProviders = new Set(),
  compact = false,
}: ProviderSelectorProps) {
  if (providers.length === 0) return null;

  if (compact) {
    return (
      <div className="flex flex-wrap gap-1.5">
        {providers.map((p, i) => {
          const isActive = p.id === activeProviderId;
          const isFailed = failedProviders.has(p.id);

          return (
            <button
              key={p.id}
              onClick={() => !isFailed && onSelect(p.id)}
              disabled={isFailed}
              className={`relative px-3 py-1.5 text-xs font-semibold rounded-lg transition-all duration-200 ${
                isActive
                  ? 'bg-violet-600/90 text-white shadow-[0_0_15px_rgba(139,92,246,0.5)] border border-violet-400/40'
                  : isFailed
                  ? 'bg-red-900/20 text-red-400/50 cursor-not-allowed border border-red-500/10'
                  : 'bg-white/5 text-white/70 hover:bg-white/10 hover:text-white backdrop-blur-md border border-white/10'
              }`}
            >
              {`Server ${i + 1}`}
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-panel rounded-2xl p-4 space-y-2 max-w-sm"
    >
      <div className="flex items-center gap-2 mb-3 px-1">
        <Server size={14} className="text-violet-400" />
        <h3 className="text-white/80 text-xs font-semibold uppercase tracking-widest">Servers</h3>
        <span className="text-white/30 text-[10px] ml-auto">{providers.length} available</span>
      </div>

      <div className="space-y-1">
        {providers.map((p, i) => {
          const isActive = p.id === activeProviderId;
          const isFailed = failedProviders.has(p.id);
          const health = p.healthScore || 100;

          return (
            <button
              key={p.id}
              onClick={() => !isFailed && onSelect(p.id)}
              disabled={isFailed}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl transition-all duration-200 text-left ${
                isActive
                  ? 'bg-violet-600/20 border border-violet-500/30'
                  : isFailed
                  ? 'bg-red-900/10 border border-red-500/10 opacity-40 cursor-not-allowed'
                  : 'bg-white/[0.02] border border-white/5 hover:bg-white/5 hover:border-white/10'
              }`}
            >
              {/* Health indicator dot */}
              <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                isFailed ? 'bg-red-500' :
                isActive ? 'bg-violet-400 shadow-[0_0_6px_rgba(139,92,246,0.8)]' :
                health >= 80 ? 'bg-emerald-400' :
                health >= 50 ? 'bg-amber-400' :
                'bg-red-400'
              }`} />

              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium truncate ${
                  isActive ? 'text-white' : isFailed ? 'text-red-400/60' : 'text-white/70'
                }`}>
                  {p.name || `Server ${i + 1}`}
                </p>
              </div>

              {/* Status icon */}
              {isActive && <CheckCircle2 size={14} className="text-violet-400 flex-shrink-0" />}
              {isFailed && <AlertCircle size={14} className="text-red-400/50 flex-shrink-0" />}
              {!isActive && !isFailed && (
                <Wifi size={12} className="text-white/20 flex-shrink-0" />
              )}
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}
