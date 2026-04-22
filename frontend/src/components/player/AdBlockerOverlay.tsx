"use client";

import React, { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { Shield } from 'lucide-react';

interface AdBlockerOverlayProps {
  onDismiss: () => void;
  maxClicks?: number;
  autoTimeout?: number;
}

/**
 * Absorbs the first N clicks to prevent ad popups on embedded iframes.
 * Auto-dismisses after a timeout if user doesn't click.
 */
export default function AdBlockerOverlay({
  onDismiss,
  maxClicks = 3,
  autoTimeout = 4000,
}: AdBlockerOverlayProps) {
  const [clicksAbsorbed, setClicksAbsorbed] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      if (!dismissed) {
        setDismissed(true);
        onDismiss();
      }
    }, autoTimeout);
    return () => clearTimeout(t);
  }, [onDismiss, dismissed, autoTimeout]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const next = clicksAbsorbed + 1;
    setClicksAbsorbed(next);
    if (next >= maxClicks) {
      setDismissed(true);
      onDismiss();
    }
  }, [clicksAbsorbed, onDismiss, maxClicks]);

  if (dismissed) return null;

  const remaining = maxClicks - clicksAbsorbed;

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={handleClick}
      className="absolute inset-0 z-20 cursor-pointer"
      style={{ background: 'transparent' }}
      role="button"
      aria-label={`Ad shield active. Tap ${remaining} more times to dismiss.`}
    >
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.3 }}
        className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-black/60 backdrop-blur-md border border-emerald-500/20 pointer-events-none"
      >
        <Shield size={12} className="text-emerald-400" />
        <span className="text-emerald-300 text-[10px] font-medium">
          Ad Shield · {remaining} click{remaining !== 1 ? 's' : ''} remaining
        </span>
      </motion.div>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.5 }}
          className="px-5 py-3 rounded-2xl bg-black/70 backdrop-blur-xl border border-white/10"
        >
          <p className="text-white/60 text-sm font-medium text-center">Tap {remaining}× to skip ads</p>
          <p className="text-white/30 text-[10px] text-center mt-1">Absorbing ad redirects…</p>
        </motion.div>
      </div>
    </motion.div>
  );
}
