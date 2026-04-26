"use client";

// ═══════════════════════════════════════════════════════════════════
// ATMOS V9 — Lightweight Toast Notification System
// ═══════════════════════════════════════════════════════════════════
// Usage: window.dispatchEvent(new CustomEvent('atmos:toast', { detail: { message: '...', type: 'info' } }))

import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

interface Toast {
  id: number;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  duration?: number;
}

let _toastId = 0;

export default function ToastProvider() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const addToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++_toastId;
    setToasts(prev => [...prev.slice(-4), { ...t, id }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(x => x.id !== id));
    }, t.duration || 3000);
  }, []);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(x => x.id !== id));
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.message) {
        addToast({
          message: detail.message,
          type: detail.type || 'info',
          duration: detail.duration,
        });
      }
    };
    window.addEventListener('atmos:toast', handler);
    return () => window.removeEventListener('atmos:toast', handler);
  }, [addToast]);

  const iconMap = {
    info: <Info size={16} className="text-cyan-400 flex-shrink-0" />,
    success: <CheckCircle2 size={16} className="text-green-400 flex-shrink-0" />,
    warning: <AlertTriangle size={16} className="text-amber-400 flex-shrink-0" />,
    error: <AlertTriangle size={16} className="text-red-400 flex-shrink-0" />,
  };

  return (
    <div className="fixed bottom-6 right-6 z-[300] flex flex-col gap-2 pointer-events-none max-w-sm">
      <AnimatePresence>
        {toasts.map(toast => (
          <motion.div
            key={toast.id}
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.95 }}
            transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            className="pointer-events-auto flex items-center gap-3 px-4 py-3 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl shadow-black/30"
          >
            {iconMap[toast.type]}
            <span className="text-white/80 text-sm font-medium flex-1">{toast.message}</span>
            <button
              onClick={() => removeToast(toast.id)}
              className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
            >
              <X size={14} />
            </button>
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
