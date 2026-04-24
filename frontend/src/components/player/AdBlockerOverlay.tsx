"use client";

import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { ShieldCheck, Zap } from 'lucide-react';

interface AdBlockerOverlayProps {
  onDismiss: () => void;
}

/**
 * Brief overlay shown when switching providers.
 * Indicates that ATMOS ad-blocking is active and auto-dismisses.
 */
export default function AdBlockerOverlay({ onDismiss }: AdBlockerOverlayProps) {
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setProgress(prev => {
        if (prev >= 100) {
          clearInterval(interval);
          onDismiss();
          return 100;
        }
        return prev + 4;
      });
    }, 80);

    // Auto-dismiss after 2.5s max
    const timer = setTimeout(onDismiss, 2500);

    return () => {
      clearInterval(interval);
      clearTimeout(timer);
    };
  }, [onDismiss]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="absolute inset-0 z-40 flex items-center justify-center bg-black/95 backdrop-blur-xl"
    >
      <div className="flex flex-col items-center gap-5">
        {/* Shield Icon with pulse */}
        <motion.div
          animate={{ scale: [1, 1.1, 1] }}
          transition={{ repeat: Infinity, duration: 1.5 }}
          className="relative"
        >
          <div className="absolute inset-0 rounded-full bg-emerald-500/20 blur-xl" />
          <div className="relative w-16 h-16 rounded-full bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center">
            <ShieldCheck size={28} className="text-emerald-400" />
          </div>
        </motion.div>

        {/* Status text */}
        <div className="text-center space-y-1">
          <p className="text-white/90 text-sm font-semibold tracking-wide flex items-center gap-2">
            <Zap size={12} className="text-emerald-400" />
            ATMOS Protection Active
          </p>
          <p className="text-white/40 text-xs">Ads blocked · Popups disabled · Clean player</p>
        </div>

        {/* Progress bar */}
        <div className="w-48 h-1 rounded-full bg-white/5 overflow-hidden">
          <motion.div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-cyan-400"
            style={{ width: `${progress}%` }}
            transition={{ ease: 'linear' }}
          />
        </div>
      </div>
    </motion.div>
  );
}
