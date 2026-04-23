"use client";

import React, { useState, useRef, useEffect } from 'react';
import { Settings, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

interface QualitySelectorProps {
  qualities: { url: string; quality: string }[];
  selectedQuality: string;
  onSelect: (quality: string) => void;
}

export default function QualitySelector({ qualities, selectedQuality, onSelect }: QualitySelectorProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  if (qualities.length <= 1) return null;

  const qualityOrder = ['2160p', '1080p', '720p', '480p', '360p', 'auto'];
  const sorted = [...qualities].sort((a, b) => {
    const ai = qualityOrder.indexOf(a.quality);
    const bi = qualityOrder.indexOf(b.quality);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium transition-all ${
          open
            ? 'bg-violet-600/30 text-violet-300'
            : 'bg-white/10 text-white/60 hover:bg-white/15 hover:text-white'
        }`}
        title="Quality"
      >
        <Settings size={14} />
        <span className="hidden sm:inline">{selectedQuality.toUpperCase()}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute bottom-full mb-2 right-0 min-w-[140px] bg-zinc-900/95 backdrop-blur-2xl border border-white/10 rounded-xl shadow-2xl overflow-hidden z-50"
          >
            <div className="p-1">
              <div className="px-3 py-1.5 text-white/30 text-[10px] font-semibold uppercase tracking-wider">
                Quality
              </div>
              {sorted.map(q => (
                <button
                  key={q.quality}
                  onClick={() => { onSelect(q.quality); setOpen(false); }}
                  className={`w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-sm transition-all ${
                    q.quality === selectedQuality
                      ? 'bg-violet-600/20 text-violet-300'
                      : 'text-white/70 hover:bg-white/5 hover:text-white'
                  }`}
                >
                  <span className="font-medium">{q.quality.toUpperCase()}</span>
                  {q.quality === selectedQuality && <Check size={14} className="text-violet-400" />}
                </button>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
