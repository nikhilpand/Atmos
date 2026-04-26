// ═══════════════════════════════════════════════════════════════════════
// ATMOS — HF Server Keep-Alive API Route
// ═══════════════════════════════════════════════════════════════════════
// Pings all 4 HF servers to prevent cold-start sleep.
// Called by client on page load + every 10 minutes.

import { NextResponse } from 'next/server';
import { ALL_SERVERS } from '@/lib/constants';

export const runtime = 'edge';

interface PingResult {
  url: string;
  role: string;
  alive: boolean;
  latencyMs: number;
}

export async function GET() {
  const results: PingResult[] = await Promise.all(
    ALL_SERVERS.map(async (server) => {
      const start = Date.now();
      try {
        const res = await fetch(server.url, {
          method: 'HEAD',
          signal: AbortSignal.timeout(6000),
        });
        return {
          url: server.url,
          role: server.role,
          alive: res.ok || res.status === 302 || res.status === 307,
          latencyMs: Date.now() - start,
        };
      } catch {
        return {
          url: server.url,
          role: server.role,
          alive: false,
          latencyMs: Date.now() - start,
        };
      }
    })
  );

  const aliveCount = results.filter(r => r.alive).length;

  return NextResponse.json({
    servers: results,
    aliveCount,
    total: ALL_SERVERS.length,
    timestamp: Date.now(),
  });
}
