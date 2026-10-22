// Bounded, local-only upload diagnostics.
//
// Off by default: enabled only when the bundle is built with
// VITE_UPLOAD_DIAGNOSTICS=true. Nothing is persisted (no localStorage) and
// nothing is sent anywhere; records live in one in-memory ring that is cleared
// whenever the account/session generation changes.
//
// The numbers answer "where did the seconds go?" without recording what the
// user saved: stage labels come from the fixed server vocabulary, identifiers
// are random diagnostic IDs, and file names, captions, object keys and URLs are
// never part of a record.
import type { RequestTiming } from './api';

export const DIAGNOSTIC_LIMIT = 25;
export const STAGE_LABEL_LIMIT = 16;
export const ENV_FLAG = 'VITE_UPLOAD_DIAGNOSTICS';

export type UploadDiagnosticKind =
  | 'prepare'
  | 'moment-write'
  | 'image-upload'
  | 'reconcile'
  // Lifecycle of one upload attempt. A photo that never leaves the device is the
  // case the server log can never show, so the client records it here.
  | 'upload-start'
  | 'upload-abort-timeout'
  | 'upload-abort-session'
  | 'upload-failed'
  | 'upload-resume'
  | 'upload-committed';

export interface UploadDiagnostic {
  kind: UploadDiagnosticKind;
  /** Random per-upload correlation id; never an account or resource id. */
  uploadId: string | null;
  /** Client-side elapsed time for this kind of work. */
  clientMs: number | null;
  /** Origin-side elapsed time reported by the upload route (up-total). */
  serverMs: number | null;
  /** clientMs minus serverMs: transit, queueing and anything before the origin. */
  transitMs: number | null;
  status: number | null;
  diagnosticId: string | null;
  stages: Record<string, number> | null;
}

const KINDS = new Set<UploadDiagnosticKind>([
  'prepare',
  'moment-write',
  'image-upload',
  'reconcile',
  'upload-start',
  'upload-abort-timeout',
  'upload-abort-session',
  'upload-failed',
  'upload-resume',
  'upload-committed',
]);
const METRIC = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,64}$/;
const MAX_MS = 600_000;

function finite(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number < 0 || number > MAX_MS) return null;
  return Math.round(number * 1000) / 1000;
}

/** Parse a Server-Timing header into a bounded map of numeric metrics. */
export function parseServerTiming(header: string | null | undefined): Record<string, number> | null {
  if (typeof header !== 'string' || !header) return null;
  const stages: Record<string, number> = {};
  let count = 0;
  for (const metric of header.split(',')) {
    const [rawName, ...params] = metric.split(';').map(part => part.trim());
    if (!METRIC.test(rawName)) continue;
    const dur = params.find(param => param.toLowerCase().startsWith('dur='));
    if (!dur) continue;
    const value = finite(dur.slice(4));
    if (value === null) continue;
    stages[rawName] = value;
    count += 1;
    if (count >= STAGE_LABEL_LIMIT) break;
  }
  return count ? stages : null;
}

/**
 * Describe one photo upload attempt. `clientMs` is the browser-side elapsed time
 * (upload + origin work + download of the response). Subtracting the origin's
 * `up-total` leaves an unattributed remainder: transport and queueing, never a
 * precise network-upload measurement.
 */
export function describeUploadTiming({
  uploadId = null,
  clientMs,
  timing = null,
}: {
  uploadId?: string | null;
  clientMs: number;
  timing?: RequestTiming | null;
}): UploadDiagnostic {
  const stages = timing ? parseServerTiming(timing.serverTiming) : null;
  const serverMs = stages?.['up-total'] ?? null;
  const client = finite(clientMs);
  return {
    kind: 'image-upload',
    uploadId,
    clientMs: client,
    serverMs,
    transitMs: client !== null && serverMs !== null ? Math.max(0, Math.round((client - serverMs) * 1000) / 1000) : null,
    status: timing?.status ?? null,
    diagnosticId: timing?.diagnosticId ?? null,
    stages,
  };
}

export function createUploadDiagnostics({ enabled = false, limit = DIAGNOSTIC_LIMIT }: { enabled?: boolean; limit?: number } = {}) {
  const entries: UploadDiagnostic[] = [];
  const bounded = Number.isInteger(limit) && limit > 0 ? limit : DIAGNOSTIC_LIMIT;

  function sanitize(input: UploadDiagnostic): UploadDiagnostic | null {
    if (!input || !KINDS.has(input.kind)) return null;
    const stages = input.stages
      ? Object.entries(input.stages)
        .filter(([name, value]) => METRIC.test(name) && finite(value) !== null)
        .slice(0, STAGE_LABEL_LIMIT)
        .map(([name, value]) => [name, finite(value) as number] as const)
      : [];
    return {
      kind: input.kind,
      uploadId: typeof input.uploadId === 'string' && IDENTIFIER.test(input.uploadId) ? input.uploadId : null,
      clientMs: finite(input.clientMs),
      serverMs: finite(input.serverMs),
      transitMs: finite(input.transitMs),
      status: Number.isInteger(input.status) && (input.status as number) >= 100 && (input.status as number) <= 599 ? input.status : null,
      diagnosticId: typeof input.diagnosticId === 'string' && IDENTIFIER.test(input.diagnosticId) ? input.diagnosticId : null,
      stages: stages.length ? Object.fromEntries(stages) : null,
    };
  }

  return {
    enabled,
    limit: bounded,
    record(input: UploadDiagnostic): UploadDiagnostic | null {
      if (!enabled) return null;
      const clean = sanitize(input);
      if (!clean) return null;
      entries.push(clean);
      if (entries.length > bounded) entries.splice(0, entries.length - bounded);
      return clean;
    },
    snapshot(): UploadDiagnostic[] {
      return entries.map(entry => ({ ...entry, stages: entry.stages ? { ...entry.stages } : null }));
    },
    clear() {
      entries.length = 0;
    },
  };
}

export type UploadDiagnostics = ReturnType<typeof createUploadDiagnostics>;

const envEnabled = (): boolean => {
  try {
    return import.meta.env?.VITE_UPLOAD_DIAGNOSTICS === 'true';
  } catch {
    return false;
  }
};

export const uploadDiagnostics = createUploadDiagnostics({ enabled: envEnabled() });

/** Record a diagnostic, awaited by nothing and never throwing into the save path. */
export function recordUploadDiagnostic(entry: UploadDiagnostic): UploadDiagnostic | null {
  try {
    return uploadDiagnostics.record(entry);
  } catch {
    return null;
  }
}

/** Drop every record on an account or session change. */
export function clearUploadDiagnostics(): void {
  uploadDiagnostics.clear();
}

/** Convenience for the non-upload phases: only the client-side elapsed time is known. */
export function phaseDiagnostic(kind: Exclude<UploadDiagnosticKind, 'image-upload'>, clientMs: number, uploadId: string | null = null): UploadDiagnostic {
  return {
    kind,
    uploadId,
    clientMs,
    serverMs: null,
    transitMs: null,
    status: null,
    diagnosticId: null,
    stages: null,
  };
}
