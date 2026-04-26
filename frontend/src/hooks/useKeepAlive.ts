"use client";

import { useEffect, useRef } from 'react';

const KEEPALIVE_INTERVAL = 10 * 60 * 1000; // 10 minutes

/**
 * Fires a keep-alive ping to all HF servers on mount and every 10 minutes.
 * Prevents HF free-tier cold starts that cause 10s+ first-request delays.
 */
export function useKeepAlive() {
  const didPing = useRef(false);

  useEffect(() => {
    const ping = () => {
      fetch('/api/keepalive', { priority: 'low' as RequestPriority }).catch(() => {});
    };

    // First ping — slight delay to not block initial render
    if (!didPing.current) {
      didPing.current = true;
      setTimeout(ping, 2000);
    }

    const interval = setInterval(ping, KEEPALIVE_INTERVAL);
    return () => clearInterval(interval);
  }, []);
}
