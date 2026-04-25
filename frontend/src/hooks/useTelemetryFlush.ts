"use client";

// ═══════════════════════════════════════════════════════════════════════
// ATMOS V6 — Telemetry Flush Hook
// ═══════════════════════════════════════════════════════════════════════
// Periodically flushes the Zustand telemetry buffer to the HF backend.
// Runs every 60 seconds. Fire-and-forget, never blocks UI.

import { useEffect } from 'react';
import { useWatchStore } from '@/store/useWatchStore';
import { SUBS_URL } from '@/lib/constants';

export function useTelemetryFlush() {
  const flushTelemetry = useWatchStore(s => s.flushTelemetry);

  useEffect(() => {
    const flush = async () => {
      const events = flushTelemetry();
      if (events.length === 0) return;

      try {
        await fetch(`${SUBS_URL}/telemetry/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ events }),
        });
      } catch {
        // Silent fail — telemetry is best-effort
      }
    };

    // Flush on page load (pick up any leftover from last session)
    const initialTimer = setTimeout(flush, 5000);

    // Then every 60 seconds
    const interval = setInterval(flush, 60000);

    // Flush on page unload
    const handleUnload = () => {
      const events = flushTelemetry();
      if (events.length > 0) {
        // Use sendBeacon for reliable delivery on page close
        navigator.sendBeacon(
          `${SUBS_URL}/telemetry/batch`,
          JSON.stringify({ events })
        );
      }
    };

    window.addEventListener('beforeunload', handleUnload);

    return () => {
      clearTimeout(initialTimer);
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleUnload);
    };
  }, [flushTelemetry]);
}
