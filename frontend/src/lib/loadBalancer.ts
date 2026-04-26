// ═══════════════════════════════════════════════════════════════════════
// ATMOS V6 — Intelligent Load Balancer for HF Backend Servers
// ═══════════════════════════════════════════════════════════════════════
// Distributes requests across multiple HF servers with health-aware routing

interface ServerHealth {
  url: string;
  role: string;
  avgResponseMs: number;
  failCount: number;
  lastCheck: number;
  isHealthy: boolean;
}

const serverHealthMap = new Map<string, ServerHealth>();
let roundRobinIndex = 0;

/**
 * Register a server with its role for load balancing
 */
export function registerServer(url: string, role: string): void {
  if (!url || serverHealthMap.has(url)) return;
  serverHealthMap.set(url, {
    url,
    role,
    avgResponseMs: 500,
    failCount: 0,
    lastCheck: Date.now(),
    isHealthy: true,
  });
}

/**
 * Record a successful response from a server
 */
export function recordSuccess(url: string, responseTimeMs: number): void {
  const health = serverHealthMap.get(url);
  if (!health) return;
  // Exponential moving average
  health.avgResponseMs = health.avgResponseMs * 0.7 + responseTimeMs * 0.3;
  health.failCount = Math.max(0, health.failCount - 1);
  health.isHealthy = true;
  health.lastCheck = Date.now();
}

/**
 * Record a failed response from a server
 */
export function recordFailure(url: string): void {
  const health = serverHealthMap.get(url);
  if (!health) return;
  health.failCount++;
  health.isHealthy = health.failCount < 3;
  health.lastCheck = Date.now();
}

/**
 * Get the healthiest server for a given role.
 * Uses round-robin among healthy servers, falling back to any available server.
 */
export function getHealthiestServer(role: string): string | null {
  const candidates = Array.from(serverHealthMap.values())
    .filter(s => s.role === role || s.role === 'general');

  if (candidates.length === 0) return null;

  // Filter healthy ones first
  const healthy = candidates.filter(s => s.isHealthy);
  const pool = healthy.length > 0 ? healthy : candidates;

  // Sort by average response time (fastest first)
  pool.sort((a, b) => a.avgResponseMs - b.avgResponseMs);

  // Round-robin within the top performers
  const topN = Math.min(3, pool.length);
  const idx = roundRobinIndex % topN;
  roundRobinIndex++;

  return pool[idx].url;
}

/**
 * Fetch with load-balanced server selection and automatic failover.
 * If the primary server fails, transparently retries on the next healthiest.
 */
export async function fetchWithLoadBalancing(
  path: string,
  role: string,
  fallbackUrl: string,
  options?: RequestInit,
): Promise<Response> {
  const serverUrl = getHealthiestServer(role) || fallbackUrl;
  const url = `${serverUrl}${path}`;
  const start = Date.now();

  try {
    const res = await fetch(url, {
      ...options,
      signal: options?.signal || AbortSignal.timeout(8000),
    });
    recordSuccess(serverUrl, Date.now() - start);
    return res;
  } catch (err) {
    recordFailure(serverUrl);

    // Try fallback if different from primary
    if (serverUrl !== fallbackUrl) {
      try {
        const fallbackRes = await fetch(`${fallbackUrl}${path}`, {
          ...options,
          signal: AbortSignal.timeout(8000),
        });
        recordSuccess(fallbackUrl, Date.now() - start);
        return fallbackRes;
      } catch {
        recordFailure(fallbackUrl);
      }
    }

    throw err;
  }
}

/**
 * Get health status of all registered servers (for debug/UI)
 */
export function getServerHealthStatus(): ServerHealth[] {
  return Array.from(serverHealthMap.values());
}
