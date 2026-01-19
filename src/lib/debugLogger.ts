type LogLevel = 'log' | 'warn' | 'error';

export type DebugLogEntry = {
  id: string;
  ts: number;
  level: LogLevel;
  message: string;
};

const MAX_LOGS = 300;

let initialized = false;
let entries: DebugLogEntry[] = [];
let listeners: Array<(logs: DebugLogEntry[]) => void> = [];

const safeStringify = (value: unknown): string => {
  try {
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name}: ${value.message}${value.stack ? `\n${value.stack}` : ''}`;
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  } catch {
    try {
      return String(value);
    } catch {
      return '[unserializable]';
    }
  }
};

const formatArgs = (args: unknown[]): string => {
  return args.map(safeStringify).join(' ');
};

const emit = () => {
  const snapshot = [...entries];
  for (const l of listeners) l(snapshot);
};

const push = (level: LogLevel, args: unknown[]) => {
  const entry: DebugLogEntry = {
    id: `${Date.now()}_${Math.random().toString(16).slice(2)}`,
    ts: Date.now(),
    level,
    message: formatArgs(args),
  };

  entries = [...entries, entry].slice(-MAX_LOGS);
  emit();
};

export function initConsoleCapture() {
  if (initialized) return;
  initialized = true;

  const original = {
    log: console.log,
    warn: console.warn,
    error: console.error,
  };

  console.log = (...args: unknown[]) => {
    try { push('log', args); } catch {}
    original.log(...args);
  };

  console.warn = (...args: unknown[]) => {
    try { push('warn', args); } catch {}
    original.warn(...args);
  };

  console.error = (...args: unknown[]) => {
    try { push('error', args); } catch {}
    original.error(...args);
  };

  // mark init
  try {
    push('log', ['[DebugLog] Console capture initialized']);
  } catch {}
}

export function getDebugLogs() {
  return [...entries];
}

export function clearDebugLogs() {
  entries = [];
  emit();
}

export function subscribeDebugLogs(listener: (logs: DebugLogEntry[]) => void) {
  listeners = [...listeners, listener];
  listener([...entries]);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function exportDebugLogsText(logs: DebugLogEntry[]) {
  const pad = (n: number) => String(n).padStart(2, '0');
  const fmt = (ts: number) => {
    const d = new Date(ts);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  };

  return logs
    .map((l) => `[${fmt(l.ts)}] ${l.level.toUpperCase()} ${l.message}`)
    .join('\n');
}
