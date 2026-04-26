"use client";

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, X } from 'lucide-react';

interface UpNextOverlayProps {
  visible: boolean;
  title: string;
  subtitle: string; // e.g. "S2 E3"
  posterUrl?: string;
  onPlay: () => void;
  onCancel: () => void;
  countdownSeconds?: number;
}

export default function UpNextOverlay({
  visible,
  title,
  subtitle,
  posterUrl,
  onPlay,
  onCancel,
  countdownSeconds = 5,
}: UpNextOverlayProps) {
  const [secondsLeft, setSecondsLeft] = useState(countdownSeconds);

  useEffect(() => {
    if (!visible) {
      setSecondsLeft(countdownSeconds);
      return;
    }

    const interval = setInterval(() => {
      setSecondsLeft(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [visible, countdownSeconds]);

  // Auto-play when countdown hits 0
  useEffect(() => {
    if (visible && secondsLeft === 0) {
      onPlay();
    }
  }, [visible, secondsLeft, onPlay]);

  const handleCancel = useCallback(() => {
    setSecondsLeft(countdownSeconds);
    onCancel();
  }, [onCancel, countdownSeconds]);

  // Progress for the circular timer (0 to 1)
  const progress = visible ? 1 - (secondsLeft / countdownSeconds) : 0;
  const circumference = 2 * Math.PI * 22; // radius = 22
  const strokeDashoffset = circumference * (1 - progress);

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 20 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="absolute bottom-20 right-4 sm:right-8 z-[80] w-[280px] sm:w-[320px]"
        >
          <div className="relative rounded-2xl overflow-hidden bg-zinc-900/95 backdrop-blur-2xl border border-white/10 shadow-2xl shadow-black/80">
            {/* Header */}
            <div className="flex items-center justify-between px-4 pt-3 pb-1">
              <span className="text-[10px] font-bold text-white/40 uppercase tracking-widest">Up Next</span>
              <button
                onClick={handleCancel}
                className="w-6 h-6 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors"
              >
                <X size={12} className="text-white/60" />
              </button>
            </div>

            {/* Content */}
            <div className="flex gap-3 p-3 pt-1">
              {/* Poster / Timer */}
              <div className="relative flex-shrink-0 w-16 h-24 rounded-lg overflow-hidden bg-white/5">
                {posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={posterUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full shimmer" />
                )}
                {/* Circular countdown timer overlay */}
                <div className="absolute inset-0 flex items-center justify-center bg-black/50">
                  <svg width="48" height="48" className="transform -rotate-90">
                    <circle cx="24" cy="24" r="22" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="3" />
                    <motion.circle
                      cx="24" cy="24" r="22" fill="none"
                      stroke="url(#timerGradient)"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeDasharray={circumference}
                      animate={{ strokeDashoffset }}
                      transition={{ duration: 1, ease: 'linear' }}
                    />
                    <defs>
                      <linearGradient id="timerGradient" x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor="#8b5cf6" />
                        <stop offset="100%" stopColor="#06b6d4" />
                      </linearGradient>
                    </defs>
                  </svg>
                  <span className="absolute text-white font-bold text-lg">{secondsLeft}</span>
                </div>
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                <div>
                  <h4 className="text-white font-semibold text-sm truncate">{title}</h4>
                  <p className="text-violet-300/70 text-xs font-medium mt-0.5">{subtitle}</p>
                </div>

                {/* Play button */}
                <motion.button
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={onPlay}
                  className="flex items-center justify-center gap-1.5 w-full py-2 rounded-lg bg-white text-black text-xs font-bold hover:bg-white/90 transition-colors mt-2"
                >
                  <Play size={12} fill="currentColor" /> Play Now
                </motion.button>
              </div>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
