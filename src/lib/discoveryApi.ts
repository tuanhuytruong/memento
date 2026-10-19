import type { TimelineEvent } from '../types';
import type { BlindboxIntent, BlindboxResult } from './blindboxMemory';
import { ApiError } from './api';
// A round sends back the composite identities it already revealed: owner plus id,
// never an id alone, so a shared memory is not excluded because another owner's
// memory happens to share its id.
export type SeenIdentity = { ownerId: string; id: string };
async function discovery<T>(path: string, body: unknown, signal: AbortSignal): Promise<T> {
  const response = await fetch(`/api/discovery/${path}`, { method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  // A rejected payload (an oversized body, for instance) can answer with plain text,
  // so parse defensively and surface one retryable message rather than a parse crash.
  // An explicit JSON null is different: that is the endpoint own "nothing left" answer.
  let data: any = null;
  let parsed = true;
  try { data = JSON.parse(await response.text()); } catch { parsed = false; }
  if (!response.ok) throw new ApiError(data?.error || data?.message || 'Could not load memories. Please retry.', response.status);
  if (!parsed) throw new ApiError('Could not load memories. Please retry.', response.status);
  return data as T;
}
export const requestBlindbox = (intent: BlindboxIntent, query: string, seen: SeenIdentity[], signal: AbortSignal) => discovery<BlindboxResult | null>('blindbox', { intent, query, seen }, signal);
export const requestPostcardPage = (trackKey: string, search: string, cursor: string | null, signal: AbortSignal) => discovery<{ moments: TimelineEvent[]; nextCursor: string | null }>('postcard-picker', { trackKey, search, cursor, limit: 40 }, signal);
