# Photo Diary DEV preview

Opt in: `https://memento-dev.srv.io.vn/?preview=photo-diary`. Normal entry is unchanged. Sign in at `/` first; revisit preview with the same session. No preview login or mutation controls.

## Boundary / reference mapping
- `src/main.tsx`: query-selected lazy entry, before App mount.
- `src/previews/PhotoDiaryPreview.tsx`: session check, authorized tracks, bounded 12-row newest-first POST `/api/moments/query`, exact GET detail. Existing server authorization and private thumb/display delivery; no backend changes or full moments fetch.
- `photo-diary.css`: scoped cream/ink/butter editorial shell, slim header, serif heading, track/search/date row, asymmetric first chronological card and three supporting cards; one column at mobile. Text-only entries retain truthful order; first-card sizing never means pinned.
- Local `photo-diary-serif.ttf`: Noto Serif regular with Vietnamese coverage, SIL OFL notice beside it. One deliberate regular weight, no synthesized bold/italic styling.
- `tests/photo-diary-live-ui.cjs`: deployed-public-stack authenticated disposable DB/R2 journey. The generated concept crop must exist at `.hermes/qa-generated-photo.jpg` to run. It is QA-only, never bundled or shown to real accounts. Real successful upstream data; two explicitly synthetic transport 503 checks.

Implemented: track/search/inclusive date filters, invalid range, reset, loading/empty/error/retry, bounded next/newest paging, fresh read-only detail, thumb cover/display contain, photo previous/next, Escape/backdrop/close and focus restoration, session-revocation clearing on subsequent reads/focus check.

Unavailable and labelled: Rediscover, Library, creating/editing/sharing, reactions, perspectives and original downloads. Return links lead to normal app; no invented destinations/counts. Date range uses visible native labelled endpoints instead of the concept's decorative single picker. No fictional real-account fallback, public photo URL or static private snapshot.

## Verification
`npm run lint`; `npm run build`; `npm run syntax`; `node --import tsx --test tests/*.test.ts tests/*.test.mjs`; `.env.local` loaded + `RUN_INTEGRATION=1 npm run test:api`; `NODE_PATH=.hermes/browser-deps/node_modules node tests/photo-diary-live-ui.cjs`.

Live screenshots/reports under `.hermes/evidence/photo-diary`. Browser uses the public HTTPS origin (required by CSRF checks), `/snap/bin/chromium`, real disposable session and private generated QA raster. Browser preview traffic permits GET and only the bounded POST query read, asserts zero mutation requests. Setup upload/teardown delete happen outside browser preview traffic. Cleanup waits for manifest removal and user cascade. Public entry and lazy chunk bytes are compared with dist. No PM2 restart or PRD changes.

Visual approval remains Huy's gate. Typography, date endpoints, variable metadata/title lengths, real chronological text-only cards and read-only labels deliberately differ from the static reference. QA fixture screenshots are not screenshots of Huy's private memories and do not imply personal-data validation or visual acceptance.
