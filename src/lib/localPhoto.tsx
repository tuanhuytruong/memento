import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { outboxSnapshot, subscribeOutbox, type OutboxRecord } from './photoOutbox';

/**
 * Pending photos live on the device until R2 acknowledges them. Cards read this
 * context so a photo appears the moment the moment is saved, and so the chip can
 * say honestly that the upload is still in flight.
 */
type LocalPhotosValue = { ownerId: string | null; records: OutboxRecord[] };

const LocalPhotoContext = createContext<LocalPhotosValue>({ ownerId: null, records: [] });

const objectUrls = new Map<string, string>();

export function LocalPhotoProvider({ ownerId, children }: { ownerId: string | null; children: React.ReactNode }) {
  const [records, setRecords] = useState<OutboxRecord[]>(() => outboxSnapshot(ownerId));

  useEffect(() => {
    setRecords(outboxSnapshot(ownerId));
    return subscribeOutbox(() => setRecords(outboxSnapshot(ownerId)));
  }, [ownerId]);

  // Object URLs are shared per uploadId; drop them as soon as a photo commits or
  // leaves the outbox so memory cannot grow with browsing.
  useEffect(() => {
    const live = new Set(records.filter((record) => record.state !== 'committed').map((record) => record.uploadId));
    for (const [uploadId, url] of objectUrls) {
      if (live.has(uploadId)) continue;
      URL.revokeObjectURL(url);
      objectUrls.delete(uploadId);
    }
  }, [records]);

  const value = useMemo(() => ({ ownerId, records }), [ownerId, records]);
  return <LocalPhotoContext.Provider value={value}>{children}</LocalPhotoContext.Provider>;
}

export type PendingPhoto = {
  uploadId: string;
  url: string;
  state: 'pending' | 'uploading' | 'failed';
  status: string;
};

const STATUS_LABEL: Record<PendingPhoto['state'], string> = {
  pending: 'Photo queued',
  uploading: 'Uploading photo…',
  failed: 'Photo not sent yet',
};

/** Photos for one moment that have not been acknowledged by the server yet. */
export function useLocalPhotos(momentId: string | undefined, resourceOwnerId: string | undefined): PendingPhoto[] {
  const { records } = useContext(LocalPhotoContext);
  const [photos, setPhotos] = useState<PendingPhoto[]>([]);

  useEffect(() => {
    if (!momentId || !resourceOwnerId) {
      setPhotos([]);
      return;
    }
    const pending = records.filter((record) => record.momentId === momentId && record.resourceOwnerId === resourceOwnerId && record.state !== 'committed');
    setPhotos(pending.map((record) => {
      let url = objectUrls.get(record.uploadId);
      if (!url) {
        url = URL.createObjectURL(record.blob);
        objectUrls.set(record.uploadId, url);
      }
      const state = record.state as PendingPhoto['state'];
      return { uploadId: record.uploadId, url, state, status: STATUS_LABEL[state] };
    }));
  }, [records, momentId, resourceOwnerId]);

  return photos;
}
