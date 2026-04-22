// ─── ATMOS V2.0 — Structured Logger ────────────────────────────────
// JSON-formatted logs with context for observability.
// Usage: log.info('Message', { key: 'value' })

type LogLevel = 'info' | 'warn' | 'error';

interface LogEntry {
  level: LogLevel;
  msg: string;
  ts: string;
  [key: string]: unknown;
}

function emit(level: LogLevel, msg: string, meta?: Record<string, unknown>) {
  const entry: LogEntry = {
    level,
    msg,
    ts: new Date().toISOString(),
    ...meta,
  };

  const str = JSON.stringify(entry);

  switch (level) {
    case 'error':
      console.error(str);
      break;
    case 'warn':
      console.warn(str);
      break;
    default:
      console.log(str);
  }
}

export const log = {
  info: (msg: string, meta?: Record<string, unknown>) => emit('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit('error', msg, meta),
};
