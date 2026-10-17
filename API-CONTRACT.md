# Memento API contract (dev)

Base URL: same origin, `/api`. All endpoints except register/login require a valid session cookie where noted. Mutation requests (`POST`, `PUT`, `DELETE`) require a same-origin `Origin` header. JSON responses use `application/json`; errors use `{ "error": "..." }`.

## Frozen compatibility and privacy contracts (Phase 0)

These are named contracts, enforced by tests, not aspirations:

- **Roles and identity.** Roles are `owner`, `editor`, `viewer`, plus `revoked` and `unrelated` which both resolve to `404` for the exact resource. Every domain resource is identified by the exact composite `(ownerId, id)`; the same `id` may exist under different owners and is never merged, guessed from row order, or authorized by a matching bare ID.
- **Authorization is current and server-side.** Every read and mutation rechecks access at the moment it runs, including image streaming, reactions, perspectives, tags, uploads, cleanup and export. Hiding a control in the UI is never authorization. Revoked and unrelated callers receive the same denial.
- **Session generations.** Client-side async results are fenced by the auth generation; a response from a previous account can never populate the next session's state.
- **Moments sort order.** `GET /api/moments` returns the complete accessible set with no guaranteed server order. The client sorts deterministically by memory date plus optional time, newest or oldest, with owner id and moment id as tie-breakers. Order is not part of the wire contract.
- **Tag semantics.** Multiple selected tags are OR semantics: a moment matches if it carries any selected tag. Tags are stored per owner; deleting a tag removes it from that owner's moments and tracks only.
- **Date-only behavior.** A date-only moment (`YYYY-MM-DD`) is validated as a real calendar date, stored as the literal date plus optional `HH:MM` time, and never reinterpreted in UTC. Timestamp-form dates must carry an explicit offset or `Z`.
- **Owned versus accessible counts.** The client's counts, year lists and tag lists derive from the loaded accessible set (owned plus accepted collaborations), never from a separate server counter. A revoked track's moments leave those derivations immediately.
- **Export scope.** JSON backup contains tracks, moments, tags and (when requested) perspectives the signed-in user currently owns or can access, plus same-origin `/api/images/:id` references — never photo bytes, never object keys. Perspectives export covers owned moments only and follows every page before download; any page failure prevents the file.
- **Draft retention.** Create/edit drafts are kept in memory for the current signed-in page session only (see Phase 1). No localStorage/IndexedDB/private-text persistence, no network transmission of drafts, and reload or tab close can lose them.
- **Cache policy.** Authenticated image responses (including server-cache hits and 304s) use `Cache-Control: private, max-age=300, must-revalidate`. There are no public URLs, no shared/CDN caching and no long-lived `immutable` caching for private images. Static hashed assets are `public, max-age=31536000, immutable`; HTML and `/api/` are `no-store`.
- **Build/test output is not UI proof.** A passing lint/build/test run, a green health endpoint or a bundle hash cannot prove layout fit, permission behavior or performance. Browser interaction QA and measurements are separate evidence.

## Frozen compatibility and privacy contracts (Phase 1)

- **Version conflicts are recoverable, never silent.** A `409` carries `{ "code": "VERSION_CONFLICT", "currentVersion": number }`. The client keeps the user's draft on screen and reads the current version through the exact `(ownerId, id)` read below; it never auto-resubmits and never force-overwrites. Adopting the server version is an explicit action that also adopts its version number.
- **Conflicted or denied content is never rewritten by the client.** "Your edits" and "Latest saved" are rendered as escaped plain text. A deleted or revoked memory stops the save, reports an access change, and leaves the user's typed text on screen to copy — it never renders freshly denied server content.
- **Draft images are never authority.** Only attachments still present on the freshly fetched server version are kept when adopting latest values; pending local files stay pending. The server continues validating every image association and parent track.
- **Memory dates are local calendar dates.** The entry date default is built from the user's local calendar day, and a date-only value keeps its literal `YYYY-MM-DD`. Created/edited timestamps stay server-authoritative, and historical memory dates are never rewritten.
- **Create capability comes from server roles.** Whether a create affordance renders is decided by the caller's `owner`/`editor` role on some current track — never by which track happens to be selected locally. An account with no track is offered track creation, because it cannot create a moment at all; a viewer-only account gets read-only guidance.
- **Drafts are one in-memory session store.** Drafts are keyed by auth generation, create/edit identity, expected version and owner; they are cleared on logout/account switch, are never written to localStorage/IndexedDB, and are never transmitted. Blob preview URLs have exactly one owner at a time.

## Exact moment read (Phase 1)

- `GET /api/moments/:id?ownerId=<uuid>` returns `{ "moment": { ...fields, "version": number, "resourceOwnerId": string } }` for the caller's currently authorized access to that exact `(ownerId, id)`.
- Errors: `400` when `ownerId` is missing or not a UUID, `401` unauthenticated, `404` for revoked or unrelated access. It never falls back to cached metadata for a resource the caller may no longer read.
- This is the only read the conflict comparison uses, so its denial behavior is a frozen contract.

## Saved memories (Phase 2)

A save is the caller's **own** bookkeeping. It is not a milestone, not a reaction and not collaboration. Nothing is copied from the author's content, and the memory's owner and other collaborators cannot see who saved what.

- **Schema.** `saved_moments(user_id, moment_owner_id, moment_id, saved_at)`, primary key `(user_id, moment_owner_id, moment_id)`, foreign keys to the user and to the exact `(owner_id, id)` moment with delete cascades. There is no copied story, photo, public id or semantic profile.
- **`PUT /api/moments/:id/saved`** JSON `{ "ownerId": string, "active": boolean }` → `{ "saved": { "ownerId": string, "id": string, "saved": boolean } }`. This is a **desired state, not a toggle**: repeating either value is the same fact, so a retried request and a double tap settle identically. There is deliberately no racing toggle endpoint.
- **Who may save.** Anyone who can currently read the memory — owner, editor or viewer. Saving grants no edit or export right.
- **Serialized with owner writes.** The save runs under the target owner's mutation locks and rechecks exact current access inside the transaction, so a revoke, move or delete racing the save always wins. A save after revocation is `404`.
- **`GET /api/saved`** → `{ "saved": [{ "ownerId", "id" }], "count": number }`, `Cache-Control: no-store`. Both the list and the count are **intersected with the caller's current authorization** before returning, so a revoked memory leaves both without leaking an id or a title. Retaining a dormant relationship row does not restore authorization on its own.
- **`GET /api/saved/moments?limit=&cursor=`** → `{ "items": [{ "ownerId", "id", "savedAt" }], "nextCursor": string | null }`. Newest first, keyset paginated (never `OFFSET`), default limit 40 / max 100, and it returns identities and timestamps only — never the author's content. A malformed or foreign cursor is `400`.
- **Errors.** `400` for a missing/non-UUID `ownerId` or a non-boolean `active`, `401` unauthenticated, `404` when the memory is unreadable to the caller.
- **Separate from content backup.** Saved state is *not* part of the JSON content export. It is private usage state and mixing it into an author-facing content file would misrepresent what a backup contains.

## Search and filter semantics (Phase 2)

One implementation (`src/lib/momentFilters.ts`) is shared by the client list, the resurfacing selector and the Blindbox, and mirrored by the server query.

- **Search folding.** Comparison uses NFC, explicit `đ`/`Đ` → `d`/`D`, then combining-mark removal, then case and whitespace folding, so "da lat" finds "Đà Lạt". **Display and stored text are never rewritten.**
- **Search fields.** Title, story, insight, tags, emotion, place name/city/country — exactly those. Collaborator perspective bodies are deliberately **not** in global search.
- **Tag semantics.** Selected tags remain OR, matched on folded **equality** (no substring matching).
- **Date range.** An optional inclusive `YYYY-MM-DD` From/To window, validated as real calendar dates and never browser-parsed. Picking a year replaces the range; entering a range clears the year — one shared rule in both directions.
- **Undated and future dates.** A malformed memory date is never silently hidden by a range filter. A future memory date is filtered like any other date, not special-cased.
- **Sort.** Canonical memory date, `HH:MM` time fallback, then owner UUID and moment id as tie-breakers. A malformed date sorts last rather than being parsed by the browser. Order is deterministic across machines and on the server.
- **Privacy.** No search-phrase history, no analytics payload and no private text in query logs. The server read path for search must use a JSON body and must not log search text in the query string.

## Authentication

- `POST /api/auth/register` JSON `{ "username": string, "password": string, "inviteCode": string }`; consumes a one-time invite and returns `{ "user": { "id": string, "username": string } }` plus an HttpOnly session cookie.
- `POST /api/auth/login` JSON `{ "username": string, "password": string }`; returns the same user shape and sets the session cookie.
- `GET /api/auth/me` returns `{ "user": { "id": string, "username": string } }`.
- `POST /api/auth/logout` revokes the session and clears the cookie; returns `{ "ok": true }`.

## Tracks

- `GET /api/tracks` → `{ "tracks": Track[] }`.
- `POST /api/tracks` JSON track fields (omit `id` to generate one) → `{ "track": Track }`, status 201.
- `PUT /api/tracks/:id` JSON partial or complete track fields → `{ "track": Track }`.
- `DELETE /api/tracks/:id` deletes the owned track and its moments/images → `{ "ok": true }`.

Track records preserve client track fields, including `title`, `description`, `color`, `icon`, `tags`, and optional `status`, `createdAt`, and `updatedAt`; `id` is always present.

## Track visits (private rediscovery state)

- `PUT /api/tracks/:id/visit` JSON `{ "ownerId": uuid }` → `{ "visit": { "trackOwnerId": uuid, "trackId": string, "lastOpenedAt": ISO-8601 } }`. Records the server time of a deliberate track navigation/detail open after an exact `(ownerId, id)` current-access check under the shared schema/owner mutation lock. Owner, editor and viewer may each record their own state; a revoked or unrelated account receives `404`. Missing/malformed identity is `400`.
- `GET /api/track-visits` → `{ "visits": [ { "trackOwnerId": uuid, "trackId": string, "lastOpenedAt": ISO-8601 } ] }` containing only the caller's own timestamps for tracks they can currently access, returned in a single query. One latest timestamp per (user, track) — never an event log, never another account's rows, never exposed to the track owner or collaborators, and never part of the content backup. Visits are not stored for moments, search phrases or reflection drafts; account deletion and track deletion cascade the rows away.

## Moments

- `POST /api/moments` and `PUT /api/moments/:id` require `eventOwnerId` alongside `eventId`; the parent track is identified as `(eventOwnerId, eventId)`. Missing or mismatched identity is rejected, never resolved by row order.

- `GET /api/moments` → `{ "moments": Moment[] }`.
- `POST /api/moments` JSON moment fields plus required `eventOwnerId` for the exact parent track (omit `id` to generate one) → `{ "moment": Moment }`, status 201.
- `PUT /api/moments/:id` JSON partial or complete moment fields (including the exact `ownerId` and `eventOwnerId`) → `{ "moment": Moment }`.
- `DELETE /api/moments/:id` deletes the owned moment and its attached images → `{ "ok": true }`.

Moment records preserve TimelineEvent fields. `id`, `eventId` (track ID), `date`, and `images` are present; `time` is optional. `images` is always an array of same-origin `/api/images/:imageId` paths and only references image objects owned by the authenticated user and attached to that moment. Additional fields such as `title`, `description`, `tags`, `emotion`, `emotionIntensity`, `idea`, `location`, and `isMilestone` are preserved.

## Images

- `POST /api/images` requires exact moment identity `(ownerId, momentId)` and multipart form fields `file` (JPEG, PNG, GIF, or WebP, maximum 10 MiB), `momentId`, and `ownerId` (the moment resource owner's UUID) → `{ "image": { "id": string, "url": "/api/images/:id", "momentId": string, "contentType": string, "size": number } }`, status 201.
- `GET /api/images/:id` streams authenticated image content with its validated content type and `Cache-Control: private, max-age=300, must-revalidate` (never `no-store`; see the frozen cache-policy contract above).
- `POST /api/images` is admitted before the multipart body is buffered: a global and per-account concurrency cap plus a 10 MiB byte reservation per admitted upload. Overload returns `503` with `Retry-After: 2` before any multipart bytes are held in memory; a body that stalls for 60s is destroyed with `408`. The reservation is held until the associated transform/storage work settles, including on failure, so a disconnect mid-upload cannot free capacity still in use. Multipart metadata is bounded (≤8 fields, ≤10 parts, ≤4 KiB per field).
- `DELETE /api/images/:id` deletes the owned image → `{ "ok": true }`.

Object keys are generated by the server only, under the environment-specific R2 prefix. The dev deployment requires `memento_dev/`; clients cannot provide object keys.

## Tags

- `GET /api/tags` → `{ "tags": string[] }`.
- `POST /api/tags` JSON `{ "tag": string }` → `{ "tag": string }`, status 201.
- `DELETE /api/tags/:tag` removes the user's tag and its use from that user's moments → `{ "ok": true }`.

## Data and security

All records and image operations are scoped to the authenticated user. Sessions are opaque, stored by hash, expire, and are revoked on logout. Authentication cookies are `HttpOnly; Secure; SameSite=Lax`. Request bodies are validated and mutations reject missing or cross-origin `Origin` headers. No endpoint accepts or returns raw R2 object keys.

## Runtime lifecycle, cleanup and database budgets

- **One entrypoint wiring.** `runtime-lifecycle.mjs` is the single startup/shutdown path for both direct execution (`node server.mjs`) and the PM2 wrapper (`pm2-start.mjs`, an operational file that is deployed locally and never committed with features). Starting twice in one process is a no-op: exactly one HTTP listener and one leased cleanup worker.
- **Cleanup worker.** The durable object-cleanup worker starts through whichever entrypoint actually serves traffic, drains in bounded passes with namespace validation, live-reference veto and worker leases, and stops admitting new passes on shutdown. `stop()` waits up to 10s for an in-flight pass and reports `settled:false` if it was still running; the manifest then replays after its lease expires, so no manual drain is ever required. `/health` stays independent of the database, storage and the cleanup worker.
- **Database budgets.** Pool acquisition (default 5s), statement execution (20s), idle-in-transaction (20s) and the per-owner advisory-lock wait (10s) are all bounded and overridable via `DB_ACQUIRE_TIMEOUT_MS`, `DB_STATEMENT_TIMEOUT_MS`, `DB_IDLE_TX_TIMEOUT_MS`, `DB_LOCK_TIMEOUT_MS`. A lock/statement timeout is a **retryable known-not-committed** failure (`503` + `Retry-After: 1`, "your change was not saved"); a connection drop during `COMMIT` is reported as an **ambiguous outcome** (`503` telling the user to refresh and check before retrying) and is never advertised as safe to replay. `/health` does not consult the database and no public DB diagnostics exist.

## Baseline measurement harness

`tests/performance-baseline.cjs` records reproducible Phase 0 baselines (not performance claims): controlled synthetic UI fixtures at 100/1,000/5,000 moments via route interception (payload bytes, request counts, cold/warm usable-timeline time, filter interaction, card DOM count, JS heap), a live authorized DEV API/R2 first-byte section using temporary resources that are deleted afterwards, and a DEV-only index inventory with bounded `EXPLAIN (ANALYZE, BUFFERS)` under a 5s statement timeout. Evidence lands in `.hermes/evidence/next-phase-0/`. The harness prints its limitations: synthetic fixtures are never authenticated account E2E or an R2 benchmark. Invoke it on DEV with:

```bash
NODE_PATH=/home/ubuntu/.cache/memento-ui-playwright/node_modules \
CHROMIUM_PATH=/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell \
MEMENTO_BASELINE_LIVE=1 node tests/performance-baseline.cjs
```

## Perspectives and reflections

- `GET /api/moments/:id/perspectives?ownerId=<uuid>&limit=20&cursor=<base64url>` returns `{ perspectives, nextCursor, capabilities }`; requires access to that exact `(ownerId,momentId)` resource. Limit is 1–50; default 20. A stale/revoked resource returns 404.
- `POST /api/moments/:id/perspectives` JSON `{ ownerId, kind: "perspective"|"reflection", body, clientRequestId }` creates a separate authored entry. Owner/editor only; viewer receives 403. Body is trimmed plain text, 1–2,000 characters. Replaying the same request ID and payload returns the existing row; reusing it with different content returns 409.
- `PUT /api/perspectives/:id` JSON `{ body, expectedVersion }` changes only the author's own text and returns 409 on stale version.
- `DELETE /api/perspectives/:id` lets the author with current owner/editor access remove their own entry; the moment owner may moderate/delete any entry. Neither can impersonate another author.
- `GET /api/perspectives/export?limit=500&cursor=<base64url>` returns all perspectives attached to moments the signed-in user currently owns, including collaborator-authored perspectives, but never contributions on another person's moments. Pages are limited to 1–500 rows and ordered by `created_at,id`; cursors preserve PostgreSQL timestamp precision. The client follows every page before downloading a complete backup; any page failure prevents the download. This endpoint is called only for explicit JSON backup; ordinary account load does not retrieve perspectives.
- Contributions are separate from the moment document, ordered oldest-first by `created_at,id`, and cascade on parent moment or author deletion. Revoking track sharing removes access but does not delete already-created entries. Text is never logged; no public image or content URLs are introduced.

## Postcards (private keepsake export)

- `POST /api/postcards/render` JSON `{ template: "journey"|"ordinary"|"month", moments: [{ ownerId, id }], images: [<imageId> | null], captions: [<string>], title, note?, showDate? }` returns the rendered `image/png` bytes with `Cache-Control: no-store` and `Content-Disposition: attachment; filename="memento-postcard.png"`. The filename is fixed and content-free.
- Selection bounds are enforced before any database or storage read: `journey` and `month` take 1–6 moments, `ordinary` takes 1–3. At most one photo per selected moment, in the same order; `null` is a deliberate text-only cell. Duplicated moments, duplicated photos and a photo count that does not match the moment count are rejected with 400.
- Text limits are guided, not clipped: title ≤ 80 characters, personal note ≤ 500, caption ≤ 80 per moment. Text that cannot fit its allotted area returns 400 with an actionable message rather than a silently truncated image.
- Export is **owner-only**. Every selected moment is re-checked with a fresh exact-owner read immediately before its photo bytes are requested; a viewer, editor or revoked collaborator receives 403, an unrelated account receives 404, and anonymous callers receive 401. A photo that does not belong to the moment it was selected under is rejected with 422.
- No database transaction is held across storage reads or rendering. Each photo read is bounded by a 20s timeout and a 24MB cap, and cancels on client disconnect. Rendering runs at most one per process with a two-deep queue (503 with `Retry-After` when full) and a 30s wall-clock bound. Animated GIF and multi-page images are rejected explicitly (422) instead of being rendered as stills.
- **Whole-pipeline admission precedes every source read.** At most two renders are in flight process-wide, at most one per account, with a nominal byte reservation of 24MB per selected photo capped at 96MB pending. Overload is rejected with `503` + `Retry-After: 2` before a single R2 byte is fetched. A shared source-read budget (four concurrent reads process-wide) aggregates fetches across all in-flight postcards; waiting reads are released to their owner and reject on client disconnect. Reservations are released exactly once, after the underlying fetch/render work has actually settled — a client timeout or disconnect ends the caller's wait, not the native work, and the render slot stays occupied until Sharp settles.
- Nothing is persisted: no postcard table, no object storage write, no public URL. Output carries no EXIF, IPTC or XMP from the source photos. Text reaches the renderer only as escaped literal strings — never markup, never a URL, never a client-supplied path or storage key.
- Render requests are metered separately from saved-content writes: 12 per user per minute (`render` budget), returning 429 with `Retry-After` beyond that.
- The UI downloads the exact bytes the server returned for the preview; it does not re-request or re-render at download time.

### Supported UI harness invocation

The browser harness is `tests/ui-remediation.cjs` and needs a real Playwright install plus a Chromium binary; it is **not** run by `npm test`. On DEV it is invoked explicitly:

```bash
cd /opt/memento-dev
export NODE_PATH=/home/ubuntu/.cache/memento-ui-playwright/node_modules
export CHROMIUM_PATH=/home/ubuntu/.cache/ms-playwright/chromium_headless_shell-1243/chrome-headless-shell-linux-arm64/chrome-headless-shell
export MEMENTO_UI_ARTIFACTS=/opt/memento-dev/.hermes/evidence/<phase>
node tests/ui-remediation.cjs          # exits 0 on success; prints JSON with one line per journey
```

`MEMENTO_UI_URL` overrides the target (default `https://memento-dev.srv.io.vn`); `MEMENTO_UI_DRAFT_ONLY=1` runs only the draft-dismissal subset. All routes are synthetic controlled fixtures, **not** authenticated live-account E2E; that distinction is printed in the result JSON. Without `NODE_PATH` pointing at a Playwright install the harness prints `SKIP` and exits 0 rather than reporting a pass.
