/**
 * Device-local photo outbox.
 *
 * A photo is written here before the first upload attempt, so switching apps,
 * killing the tab or a stalled network can never lose the file — and never
 * wedges the save gate. The server row and the R2 object stay the source of
 * truth: these bytes are account-scoped, disposable, TTL-bound, and leave the
 * device only through the existing authenticated upload (same uploadId, so a
 * replay can never store the same photo twice).
 */
export type OutboxState = 'pending' | 'uploading' | 'failed' | 'committed';

export type OutboxRecord = {
  uploadId: string;
  /** Signed-in account that owns bytes on this device. */
  uploaderAccountId: string;
  /** Authorized server-side destination; may differ for an editor. */
  resourceOwnerId: string;
  momentId: string;
  blob: Blob;
  name: string;
  type: string;
  bytes: number;
  createdAt: number;
  state: OutboxState;
  attempts: number;
  lastAttemptAt?: number;
};

export const OUTBOX_MAX_ITEMS = 20;
export const OUTBOX_MAX_BYTES = 60 * 1024 * 1024;
/** A blob that never reached R2 is kept past the TTL: losing it would lose the photo. */
export const OUTBOX_COMMITTED_TTL_MS = 24 * 60 * 60 * 1000;

const DB_NAME = 'memento-local-v1';
const DB_VERSION = 2;
const STORE = 'photo-outbox';

type Listener = () => void;

const listeners = new Set<Listener>();
const key = (uploaderAccountId: string, uploadId: string) => `${uploaderAccountId}|${uploadId}`;

/** Mirror of the store, so cards can render a pending photo without awaiting IndexedDB. */
const mirror = new Map<string, OutboxRecord>();
let mirrorOwner: string | null = null;
let memoryOnly: Map<string, OutboxRecord> | null = null;
// Any async persistence started by a previous signed-in session must become a no-op.
// The epoch is process-local by design: it fences late IndexedDB completions from
// recreating bytes after logout/account change.
let sessionEpoch = 0;

export class OutboxSessionInvalidatedError extends Error {
  constructor() { super('Photo outbox session changed.'); this.name = 'OutboxSessionInvalidatedError'; }
}

function assertEpoch(epoch: number) {
  if (epoch !== sessionEpoch) throw new OutboxSessionInvalidatedError();
}

function emit() {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      /* a subscriber must never break the outbox */
    }
  }
}

export function subscribeOutbox(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function outboxSnapshot(ownerId: string | null): OutboxRecord[] {
  if (!ownerId || mirrorOwner !== ownerId) return [];
  return [...mirror.values()]
    .filter((record) => record.uploaderAccountId === ownerId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

function hasIndexedDb(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && !!indexedDB;
  } catch {
    return false;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('byUploader', 'uploaderAccountId');
        store.createIndex('byCreatedAt', 'createdAt');
      } else {
        const store = request.transaction!.objectStore(STORE);
        // Retain v1 byOwner solely to inspect/quarantine legacy rows. New rows use
        // byUploader; no editor record is guessed from destination ownership.
        if (!store.indexNames.contains('byOwner')) store.createIndex('byOwner', 'resourceOwnerId');
        if (!store.indexNames.contains('byUploader')) store.createIndex('byUploader', 'uploaderAccountId');
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB unavailable'));
    request.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function txRun<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const store = tx.objectStore(STORE);
        let request: IDBRequest<T> | void;
        try {
          request = run(store);
        } catch (error) {
          reject(error);
          return;
        }
        tx.oncomplete = () => {
          db.close();
          resolve(request ? request.result : undefined);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('Outbox write failed'));
        };
        tx.onabort = () => {
          db.close();
          reject(tx.error ?? new Error('Outbox write aborted'));
        };
      }),
  );
}

/* -------- degraded mode: no IndexedDB (private mode, odd engines) -------- */

function memoryStore(): Map<string, OutboxRecord> {
  if (!memoryOnly) memoryOnly = new Map();
  return memoryOnly;
}

function mirrorSet(record: OutboxRecord) {
  mirror.set(key(record.uploaderAccountId, record.uploadId), record);
  // Only a load names the owner this view belongs to; a write must never re-point an
  // existing view at another account.
  if (!mirrorOwner) mirrorOwner = record.uploaderAccountId;
}

/* ------------------------------ public API ------------------------------ */

export async function outboxLoad(ownerId: string): Promise<OutboxRecord[]> {
  let records: OutboxRecord[] = [];
  if (hasIndexedDb()) {
    try {
      const rows = await txRun<OutboxRecord[]>('readonly', (store) => {
        // Include legacy v1 rows for this account only; records aimed at a different
        // owner are deliberately not discoverable as resumable uploader work.
        if (store.indexNames.contains('byUploader')) return store.index('byUploader').getAll(ownerId);
        return store.index('byOwner').getAll(ownerId);
      });
      records = (rows ?? []).flatMap((row) => {
        const { key: _storedKey, ...rest } = row as OutboxRecord & { key: string; ownerId?: string };
        if (rest.uploaderAccountId && rest.resourceOwnerId) return [rest];
        // v1 records only had destination owner. They are safe to adopt solely when
        // the current account matches it; editor uploads remain quarantined rather
        // than guessed/replayed under another account.
        const legacy = rest as unknown as OutboxRecord & { ownerId?: string };
        if (legacy.ownerId !== ownerId) return [];
        return [{ ...legacy, uploaderAccountId: ownerId, resourceOwnerId: ownerId }];
      });
    } catch {
      records = [...memoryStore().values()].filter((row) => row.uploaderAccountId === ownerId);
    }
  } else {
    records = [...memoryStore().values()].filter((row) => row.uploaderAccountId === ownerId);
  }
  if (mirrorOwner !== ownerId) mirror.clear();
  mirrorOwner = ownerId;
  for (const record of records) mirror.set(key(record.uploaderAccountId, record.uploadId), record);
  emit();
  return records.sort((a, b) => a.createdAt - b.createdAt);
}

export async function outboxPut(record: Omit<OutboxRecord, 'createdAt' | 'state' | 'attempts'> & Partial<Pick<OutboxRecord, 'createdAt' | 'state' | 'attempts'>>): Promise<OutboxRecord> {
  const epoch = sessionEpoch;
  const stored: OutboxRecord = {
    ...record,
    createdAt: record.createdAt ?? Date.now(),
    state: record.state ?? 'pending',
    attempts: record.attempts ?? 0,
  };
  assertEpoch(epoch);
  mirrorSet(stored);
  if (hasIndexedDb()) {
    try {
      await txRun('readwrite', (store) => store.put({ ...stored, key: key(stored.uploaderAccountId, stored.uploadId) }));
    } catch {
      memoryStore().set(key(stored.uploaderAccountId, stored.uploadId), stored);
    }
  } else {
    memoryStore().set(key(stored.uploaderAccountId, stored.uploadId), stored);
  }
  try {
    assertEpoch(epoch);
  } catch (error) {
    // A late IDB put may have landed after logout. Delete only this exact old
    // composite key; uploadId is session-generated and cannot name new work.
    mirror.delete(key(stored.uploaderAccountId, stored.uploadId));
    memoryStore().delete(key(stored.uploaderAccountId, stored.uploadId));
    if (hasIndexedDb()) void txRun('readwrite', (store) => store.delete(key(stored.uploaderAccountId, stored.uploadId))).catch(() => undefined);
    emit();
    throw error;
  }
  await outboxTrim(stored.uploaderAccountId);
  assertEpoch(epoch);
  emit();
  return stored;
}

export async function outboxUpdate(
  ownerId: string,
  uploadId: string,
  patch: Partial<Pick<OutboxRecord, 'state' | 'attempts' | 'lastAttemptAt'>>,
): Promise<OutboxRecord | null> {
  const epoch = sessionEpoch;
  const current = mirror.get(key(ownerId, uploadId));
  if (!current) return null;
  const next: OutboxRecord = { ...current, ...patch };
  mirrorSet(next);
  if (hasIndexedDb()) {
    try {
      await txRun('readwrite', (store) => store.put({ ...next, key: key(ownerId, uploadId) }));
    } catch {
      memoryStore().set(key(ownerId, uploadId), next);
    }
  } else {
    memoryStore().set(key(ownerId, uploadId), next);
  }
  assertEpoch(epoch);
  emit();
  return next;
}

export async function outboxDelete(ownerId: string, uploadId: string): Promise<void> {
  mirror.delete(key(ownerId, uploadId));
  memoryStore().delete(key(ownerId, uploadId));
  if (hasIndexedDb()) {
    try {
      await txRun('readwrite', (store) => store.delete(key(ownerId, uploadId)));
    } catch {
      /* the mirror already dropped it */
    }
  }
  emit();
}

export async function outboxPurgeOwner(ownerId: string): Promise<void> {
  if (mirrorOwner === ownerId) {
    mirror.clear();
    emit();
  }
  for (const record of [...memoryStore().values()]) if (record.uploaderAccountId === ownerId) memoryStore().delete(key(ownerId, record.uploadId));
  if (!hasIndexedDb()) return;
  try {
    const rows = await txRun<IDBValidKey[]>('readonly', (store) => store.index('byUploader').getAllKeys(ownerId));
    for (const rowKey of rows ?? []) await txRun('readwrite', (store) => store.delete(rowKey));
  } catch {
    /* best effort: a purge failure must not block signing out */
  }
}

export async function outboxPurgeAll(): Promise<void> {
  sessionEpoch += 1;
  mirror.clear();
  mirrorOwner = null;
  emit();
  memoryStore().clear();
  if (!hasIndexedDb()) return;
  try {
    await txRun('readwrite', (store) => store.clear());
  } catch {
    /* best effort */
  }
}

/**
 * Cap the store. Committed records go first, newest last, and a record that never
 * reached R2 survives until the cap forces a choice — losing a queued photo is
 * worse than a slower save.
 */
export async function outboxTrim(ownerId: string): Promise<void> {
  const records = [...mirror.values()].filter((record) => record.uploaderAccountId === ownerId).sort((a, b) => a.createdAt - b.createdAt);
  let totalBytes = records.reduce((sum, record) => sum + record.bytes, 0);
  const removable = [...records].sort((a, b) => Number(b.state === 'committed') - Number(a.state === 'committed') || a.createdAt - b.createdAt);
  for (const record of removable) {
    const overItems = mirror.size > OUTBOX_MAX_ITEMS;
    const overBytes = totalBytes > OUTBOX_MAX_BYTES;
    if (!overItems && !overBytes) break;
    await outboxDelete(record.uploaderAccountId, record.uploadId);
    totalBytes -= record.bytes;
  }
}

/** Drop committed blobs once they are old enough; uncommitted ones are kept. */
export async function outboxEvictExpired(ownerId: string, now = Date.now()): Promise<number> {
  const records = [...mirror.values()].filter((record) => record.uploaderAccountId === ownerId && record.state === 'committed');
  let removed = 0;
  for (const record of records) {
    if (now - record.createdAt < OUTBOX_COMMITTED_TTL_MS) continue;
    await outboxDelete(ownerId, record.uploadId);
    removed += 1;
  }
  return removed;
}

/** The first moment with anything still owed to the server, oldest first. */
export function outboxOldestUncommitted(uploaderAccountId: string | null): { momentId: string; uploaderAccountId: string; resourceOwnerId: string; files: { file: File; uploadId: string }[] } | null {
  if (!uploaderAccountId) return null;
  const pending = outboxSnapshot(uploaderAccountId).filter((record) => record.state !== 'committed');
  if (!pending.length) return null;
  const momentId = pending[0].momentId;
  return {
    momentId,
    uploaderAccountId,
    resourceOwnerId: pending[0].resourceOwnerId,
    files: pending
      .filter((record) => record.momentId === momentId)
      .map((record) => ({
        uploadId: record.uploadId,
        file: new File([record.blob], record.name, { type: record.type }),
      })),
  };
}
