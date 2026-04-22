"use client";

import React from 'react';

interface SpinnerProps {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

/**
 * ATMOS dual-ring animated spinner — used across all loading states.
 * Single source of truth (previously duplicated 4x across components).
 */
export default function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  const dim = {
    sm: 'w-10 h-10',
    md: 'w-16 h-16',
    lg: 'w-20 h-20',
  }[size];

  const inner = {
    sm: 'inset-1',
    md: 'inset-2',
    lg: 'inset-3',
  }[size];

  return (
    <div
      role="status"
      aria-label="Loading"
      className={`relative ${dim} ${className}`}
    >
      <div className="absolute inset-0 rounded-full border-2 border-white/5" />
      <div className="absolute inset-0 rounded-full border-2 border-t-violet-500 animate-spin" />
      <div
        className={`absolute ${inner} rounded-full border-2 border-t-cyan-400/60 animate-spin`}
        style={{ animationDirection: 'reverse', animationDuration: '1.5s' }}
      />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
