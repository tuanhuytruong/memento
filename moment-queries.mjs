// Phase 3 Task 3.1: the bounded read contract.
//
// The existing `GET /api/moments` returns the caller's entire accessible set,
// and a lot of the app still depends on that (header metrics, track counts,
// filter facets, resurfacing, Blindbox, postcards, JSON backup). Adding LIMIT
// to it would silently truncate all of those, so this endpoint is additive:
// nothing switches over until every consumer has migrated.
//
// Two deliberate design points:
//   * Authorization happens in SQL, before filters and pagination, so a page
//     can never contain a moment the caller may not read. The cursor is not an
//     authorization token and is never trusted for that.
//   * No owner write lock and no mutation metering: this is a read, and
//     queueing it behind an owner's save would make browsing contend with
//     editing for no safety benefit.
//
// Search folding is expressed in SQL with `translate()`, not with an
// extension: `pg_trgm`/`unaccent` need privileges and hurt migration
// portability, and this keeps the fold identical to the client's
// `foldSearchText` for the Vietnamese character set we actually store.

/** Combining marks removed after NFD, matching the client's fold. */
const MARKS = /[\u0300-\u036f]/g;

/**
 * Every precomposed Vietnamese letter we fold, grouped by the bare Latin base
 * it collapses to. The groups matter: `ơ`/`ư` fold to `o`/`u`, not to `a`,
 * because their combining horn is itself a mark that NFD exposes and the
 * client then strips. A blanket mapping to `a` silently corrupts "BUỔI".
 */
const VIETNAMESE_GROUPS = [
  ['a', 'àáảãạăằắẳẵặâầấẩẫậ'],
  ['e', 'èéẻẽẹêềếểễệ'],
  ['i', 'ìíỉĩị'],
  ['o', 'òóỏõọôồốổỗộơờớởỡợ'],
  ['u', 'ùúủũụưừứửữự'],
  ['y', 'ỳýỷỹỵ'],
  ['d', 'đ'],
];
const VIETNAMESE_SRC = VIETNAMESE_GROUPS.flatMap(([, letters]) => [...letters]).join('');
const VIETNAMESE_DST = VIETNAMESE_GROUPS.flatMap(([base, letters]) => base.repeat([...letters].length)).join('');
/**
 * SQL expression that folds a text expression exactly as `foldSearchText`
 * does, for the characters that can appear in stored content: lowercase
 * (so the diacritic sets only need the lowercase forms after folding),
 * then the precomposed Vietnamese letters, then đ/Đ.
 *
 * `translate` is core PostgreSQL, needs no extension and is deterministic
 * under any collation because it is a pure character-for-character map. Only
 * the lowercase set is mapped: `lower()` runs first, so the uppercase forms
 * never reach the translation.
 */
export function sqlFold(expression) {
  // Normalize first. Vietnamese typed on macOS arrives decomposed ("e" plus a
  // combining dot below rather than a single precomposed letter), and
  // `translate` matches single characters only, so without this a memory
  // written on a Mac would silently never be found.
  const composed = `normalize(${expression}, NFC)`;
  const translated = `translate(lower(${composed}), '${VIETNAMESE_SRC}', '${VIETNAMESE_DST}')`;
  // Whitespace is folded too, not just characters: the needle side collapses
  // runs and trims, so the haystack has to or "nhiều   khoảng" would never
  // match a needle of "nhiều khoảng".
  // POSIX class, not \s: PostgreSQL's regexp engine does not honour \s here,
  // and a backslash is one more thing that can be eaten between JS and SQL.
  return `btrim(regexp_replace(${translated}, '[[:space:]]+', ' ', 'g'))`;
}

/**
 * Fold a search needle exactly as the client does. `sqlFold` handles the row
 * side in the database; this handles the needle side so both halves of the
 * `LIKE` comparison use one definition.
 */
export function foldNeedle(input) {
  return String(input)
    .normalize('NFC')
    .replace(/\u0110/g, 'D')
    .replace(/\u0111/g, 'd')
    .normalize('NFD')
    .replace(MARKS, '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Canonical sort keys, parameterized by alias so the same expression works in
 * the scoped subquery (`q`) and in an index definition over `moments` (`m`).
 * A malformed date or time falls back to a sentinel instead of being parsed,
 * so the order never depends on the viewer locale or timezone.
 */
export const dateKey = (alias = 'm') => `CASE WHEN ${alias}.document->>'date' ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN ${alias}.document->>'date' ELSE '9999-99-99' END`;
export const timeKey = (alias = 'm') => `CASE WHEN ${alias}.document->>'time' ~ '^\\d{2}:\\d{2}$' THEN ${alias}.document->>'time' ELSE '99:99' END`;

import { ApiError } from './mutation-safety.mjs';

export const DEFAULT_LIMIT = 40;
export const MAX_LIMIT = 100;

const DIRECTIONS = new Set(['newest', 'oldest']);
const SORT_FIELDS = new Set(['date']);

/** A cursor is opaque to callers but never an authorization token. */
export function encodeCursor(tuple) {
  return Buffer.from(JSON.stringify(tuple)).toString('base64url');
}

/**
 * Validate a cursor against the request that is presenting it. Anything that
 * is not exactly the shape this endpoint emits is a 400 rather than a guess,
 * and the scope hash is compared so a cursor minted for one filter set can
 * never be replayed against another.
 */
export function decodeCursor(raw, expectedScope) {
  if (raw == null || raw === '') return null;
  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(raw), 'base64url').toString('utf8'));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const { date, time, ownerId, id, direction, scope } = parsed;
  if (typeof date !== 'string' || typeof time !== 'string') return undefined;
  if (typeof ownerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ownerId)) return undefined;
  if (typeof id !== 'string' || !id) return undefined;
  if (!DIRECTIONS.has(direction)) return undefined;
  if (scope !== expectedScope) return undefined;
  return { date, time, ownerId, id, direction, scope };
}

/**
 * Hash of everything that decides which rows are eligible. Baked into the
 * cursor so pagination cannot silently continue across a changed filter set.
 */
export function scopeHash(filters, direction, userId) {
  const canonical = JSON.stringify({
    u: userId,
    d: direction,
    q: filters.search ?? '',
    y: filters.selectedYear ?? 'all',
    f: filters.dateFrom ?? '',
    t: filters.dateTo ?? '',
    g: [...(filters.selectedTags ?? [])].sort(),
    e: [...(filters.selectedEmotions ?? [])].sort(),
    m: Boolean(filters.milestonesOnly),
    i: Boolean(filters.hasImagesOnly),
    k: filters.trackKey ?? null,
    s: filters.savedOnly === true,
  });
  // FNV-1a: small, deterministic, and good enough to detect an accidental
  // scope change. It is a consistency check, not a signature.
  let hash = 0x811c9dc5;
  for (let index = 0; index < canonical.length; index += 1) {
    hash ^= canonical.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

/**
 * Validate a query request. Returns the normalized request, or throws an
 * ApiError-shaped object so the route can answer 400 with a specific reason.
 */
export function validateQueryRequest(body, userId) {
  // ApiError, not a bare Error: the shared error middleware only maps that
  // type, and a plain .status would fall through to a 500.
  const invalid = (message) => new ApiError(400, message);
  const input = body ?? {};
  const limitRaw = input.limit ?? DEFAULT_LIMIT;
  const limit = Number(limitRaw);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_LIMIT) {
    throw invalid(`limit must be an integer between 1 and ${MAX_LIMIT}`);
  }
  const direction = input.sortDirection ?? 'newest';
  if (!DIRECTIONS.has(direction)) throw invalid('sortDirection must be newest or oldest');
  const sortBy = input.sortBy ?? 'date';
  if (!SORT_FIELDS.has(sortBy)) throw invalid('sortBy is not supported');

  const search = input.search ?? '';
  if (typeof search !== 'string' || search.length > 500) throw invalid('search must be a string of at most 500 characters');
  const selectedYear = input.selectedYear ?? 'all';
  if (typeof selectedYear !== 'string' || (selectedYear !== 'all' && !/^\d{4}$/.test(selectedYear))) throw invalid('selectedYear must be all or a four-digit year');
  const dateFrom = input.dateFrom ?? '';
  const dateTo = input.dateTo ?? '';
  for (const [label, value] of [['dateFrom', dateFrom], ['dateTo', dateTo]]) {
    if (value === '') continue;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw invalid(`${label} must be a calendar date`);
    const [year, month, day] = value.split('-').map(Number);
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (month < 1 || month > 12 || day < 1 || day > daysInMonth) throw invalid(`${label} must be a real calendar date`);
  }
  if (dateFrom && dateTo && dateFrom > dateTo) throw invalid('dateFrom must not be after dateTo');
  // One rule, both directions, mirroring the client: a year replaces a range
  // and a range replaces a year, so the two can never combine into nothing.
  const effectiveYear = dateFrom || dateTo ? 'all' : selectedYear;

  const stringList = (value, label, max) => {
    if (value == null) return [];
    if (!Array.isArray(value) || value.length > max || !value.every(item => typeof item === 'string' && item.length > 0 && item.length <= 128)) {
      throw invalid(`${label} must be an array of at most ${max} short strings`);
    }
    return [...new Set(value)];
  };
  const selectedTags = stringList(input.selectedTags, 'selectedTags', 50);
  const selectedEmotions = stringList(input.selectedEmotions, 'selectedEmotions', 20);
  const milestonesOnly = input.milestonesOnly ?? false;
  const hasImagesOnly = input.hasImagesOnly ?? false;
  if (typeof milestonesOnly !== 'boolean' || typeof hasImagesOnly !== 'boolean') throw invalid('milestonesOnly and hasImagesOnly must be booleans');

  const savedOnly = input.savedOnly ?? false;
  if (typeof savedOnly !== 'boolean') throw invalid('savedOnly must be a boolean');

  let trackKey = null;
  if (input.trackKey != null && input.trackKey !== 'all') {
    const [owner, ...rest] = String(input.trackKey).split(':');
    const id = rest.join(':');
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(owner ?? '') || !id) {
      throw invalid('trackKey must be a composite owner:track identity');
    }
    trackKey = { ownerId: owner, id };
  }

  const includeTotal = input.includeTotal === true;
  const includeFacets = input.includeFacets === true;
  if (typeof (input.includeTotal ?? false) !== 'boolean' || typeof (input.includeFacets ?? false) !== 'boolean') {
    throw invalid('includeTotal and includeFacets must be booleans');
  }

  return {
    limit,
    direction,
    sortBy,
    filters: {
      search,
      selectedYear: effectiveYear,
      dateFrom,
      dateTo,
      selectedTags,
      selectedEmotions,
      milestonesOnly,
      hasImagesOnly,
      savedOnly,
      trackKey,
    },
    includeTotal,
    includeFacets,
  };
}

/**
 * The authorized scope, in one place: the caller's own moments plus moments on
 * tracks they hold an accepted, unrevoked collaboration on. Everything else in
 * this module filters *within* this set, never outside it.
 */
const AUTHORIZED_SCOPE = `(
  SELECT m.owner_id, m.id, m.event_id, m.document, m.version
  FROM {schema}.moments m
  WHERE m.owner_id = $1
     OR EXISTS (
       SELECT 1 FROM {schema}.track_collaborators c
       WHERE c.owner_id = m.owner_id AND c.track_id = m.event_id
         AND c.recipient_id = $1 AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL
     )
)`;

/**
 * Run a bounded, keyset-paginated query over the caller's authorized moments.
 * Images and reaction summaries are fetched only for the returned page and in
 * one batch each, so the cost per page is constant rather than per card.
 */
export async function queryMoments(client, userId, request, schema, helpers = {}) {
  const { fold = sqlFold, reactionSummaries } = helpers;
  const { limit, direction, filters } = request;
  const scope = scopeHash(filters, request.direction, userId);
  const cursor = request.cursor === undefined ? null : decodeCursor(request.cursor, scope);
  if (cursor === undefined) throw new ApiError(400, 'cursor does not match this query');
  if (cursor && cursor.direction !== direction) throw new ApiError(400, 'cursor does not match this sort direction');

  const args = [userId];
  const where = [];
  const add = (value) => { args.push(value); return `$${args.length}`; };

  if (filters.trackKey) {
    where.push(`q.owner_id = ${add(filters.trackKey.ownerId)} AND q.event_id = ${add(filters.trackKey.id)}`);
  }
  if (filters.selectedYear !== 'all') {
    where.push(`q.document->>'date' LIKE ${add(`${filters.selectedYear}-%`)}`);
  }
  // Inclusive range on the local calendar date. A malformed date is "unknown"
  // and is never silently hidden, exactly as the client behaves.
  if (filters.dateFrom || filters.dateTo) {
    // "unknown date OR inside the window" — the window half is an AND of its
    // own bounds, so joining all three with OR would admit everything above
    // the lower bound.
    const bounds = [];
    if (filters.dateFrom) bounds.push(`q.document->>'date' >= ${add(filters.dateFrom)}`);
    if (filters.dateTo) bounds.push(`q.document->>'date' <= ${add(filters.dateTo)}`);
    const unknownDate = `q.document->>'date' !~ '^\\d{4}-\\d{2}-\\d{2}$'`;
    where.push(bounds.length > 1 ? `(${unknownDate} OR (${bounds.join(' AND ')}))` : `(${unknownDate} OR ${bounds[0]})`);
  }
  if (filters.search.trim()) {
    // One folded haystack built from exactly the fields the client searches.
    const haystack = [
      "coalesce(q.document->>'title','')",
      "coalesce(q.document->>'description','')",
      "coalesce(q.document->>'idea','')",
      "coalesce(q.document->>'emotion','')",
      "coalesce(q.document->'location'->>'name','')",
      "coalesce(q.document->'location'->>'city','')",
      "coalesce(q.document->'location'->>'country','')",
      "coalesce((SELECT string_agg(x.value, ' ') FROM jsonb_array_elements_text(coalesce(q.document->'tags','[]'::jsonb)) x),'')",
    ].map(fold).join(" || ' ' || ");
    // The needle is folded in JS with the same function the client uses, so a
    // query and a local filter can never disagree about what matched.
    where.push(`(${haystack}) LIKE '%' || ${add(foldNeedle(filters.search))} || '%'`);
  }
  // Selected tags keep OR semantics, matched on folded equality.
  if (filters.selectedTags.length > 0) {
    const placeholders = filters.selectedTags.map(tag => add(tag));
    where.push(`EXISTS (SELECT 1 FROM jsonb_array_elements_text(coalesce(q.document->'tags','[]'::jsonb)) t WHERE ${fold('t.value')} IN (${placeholders.join(', ')}))`);
  }
  if (filters.selectedEmotions.length > 0) {
    where.push(`q.document->>'emotion' = ANY(${add(filters.selectedEmotions)})`);
  }
  if (filters.milestonesOnly) where.push(`(q.document->'isMilestone')::text = 'true'`);
  if (filters.hasImagesOnly) where.push(`EXISTS (SELECT 1 FROM {schema}.images i WHERE i.owner_id = q.owner_id AND i.moment_id = q.id)`);
  if (filters.savedOnly) {
    where.push(`EXISTS (SELECT 1 FROM {schema}.saved_moments sv WHERE sv.user_id = $1 AND sv.moment_owner_id = q.owner_id AND sv.moment_id = q.id)`);
  }

  // Keyset predicate. Newest sorts the tuple descending, oldest ascending.
  const cmp = direction === 'newest' ? '<' : '>';
  if (cursor) {
    args.push(cursor.date, cursor.time, cursor.ownerId, cursor.id);
    const [d, t, o, i] = [`$${args.length - 3}`, `$${args.length - 2}`, `$${args.length - 1}`, `$${args.length}`];
    // Row expressions on the left, cursor values on the right. Getting this
    // backwards inverts the page: "newest" would walk toward older rows
    // instead of away from the cursor.
    where.push(`(${dateKey('q')}, ${timeKey('q')}, q.owner_id, q.id) ${cmp} (${d}, ${t}, ${o}, ${i})`);
  }
  args.push(limit + 1);
  const limitParam = `$${args.length}`;
  const order = direction === 'newest' ? 'DESC' : 'ASC';

  const sql = `
    WITH authorized AS (${AUTHORIZED_SCOPE}),
    q AS (SELECT * FROM authorized)
    SELECT q.owner_id, q.id, q.event_id, q.document, q.version,
           ${dateKey('q')} AS sort_date, ${timeKey('q')} AS sort_time
    FROM q
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY ${dateKey('q')} ${order}, ${timeKey('q')} ${order}, q.owner_id ${order}, q.id ${order}
    LIMIT ${limitParam}`.replace(/\{schema\}/g, schema);

  const { rows } = await client.query(sql, args);
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  // Batched, page-scoped enrichment: one query for images, one for reactions.
  const owners = page.map(row => row.owner_id);
  const ids = page.map(row => row.id);
  const [images, reactions] = await Promise.all([
    page.length
      ? client.query(`SELECT owner_id, moment_id, id FROM ${schema}.images WHERE (owner_id, moment_id) IN (SELECT * FROM unnest($1::uuid[], $2::text[])) ORDER BY created_at`, [owners, ids])
      : { rows: [] },
    reactionSummaries ? reactionSummaries(userId, page, client) : new Map(),
  ]);
  const imagesByMoment = new Map();
  for (const image of images.rows) {
    const key = `${image.owner_id}:${image.moment_id}`;
    const list = imagesByMoment.get(key) || [];
    list.push(image);
    imagesByMoment.set(key, list);
  }

  const { safeMoment } = helpers;
  return {
    moments: page.map(row => safeMoment(row.document, imagesByMoment.get(`${row.owner_id}:${row.id}`) || [], reactions.get(`${row.owner_id}:${row.id}`) || [], row.version, row.owner_id)),
    nextCursor: hasMore && last
      ? encodeCursor({ date: last.sort_date, time: last.sort_time, ownerId: last.owner_id, id: last.id, direction, scope })
      : null,
    scope,
  };
}

/**
 * Totals and facets, only when asked for. Computed over the same authorized
 * scope and the same filters as the page, so the number the header shows can
 * never exceed what paging would actually return.
 */
export async function queryFacets(client, userId, request, schema) {
  const { filters } = request;
  const args = [userId];
  const where = [];
  const add = (value) => { args.push(value); return `$${args.length}`; };
  // Rebuild the same predicates; kept beside the page query so the two cannot
  // drift into disagreeing about which rows count.
  if (filters.trackKey) where.push(`q.owner_id = ${add(filters.trackKey.ownerId)} AND q.event_id = ${add(filters.trackKey.id)}`);
  if (filters.selectedYear !== 'all') where.push(`q.document->>'date' LIKE ${add(`${filters.selectedYear}-%`)}`);
  if (filters.search.trim()) {
    const haystack = [
      "coalesce(q.document->>'title','')", "coalesce(q.document->>'description','')",
      "coalesce(q.document->>'idea','')", "coalesce(q.document->>'emotion','')",
      "coalesce(q.document->'location'->>'name','')", "coalesce(q.document->'location'->>'city','')",
      "coalesce(q.document->'location'->>'country','')",
      "coalesce((SELECT string_agg(x.value, ' ') FROM jsonb_array_elements_text(coalesce(q.document->'tags','[]'::jsonb)) x),'')",
    ].map(sqlFold).join(" || ' ' || ");
    where.push(`(${haystack}) LIKE '%' || ${add(filters.search)} || '%'`);
  }
  if (filters.milestonesOnly) where.push(`(q.document->'isMilestone')::text = 'true'`);

  const { rows } = await client.query(`
    WITH authorized AS (${AUTHORIZED_SCOPE}),
    q AS (SELECT * FROM authorized)
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE (q.document->'isMilestone')::text = 'true')::int AS milestones,
      COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM ${schema}.images i WHERE i.owner_id = q.owner_id AND i.moment_id = q.id))::int AS with_images,
      COUNT(DISTINCT left(q.document->>'date', 4))::int AS years,
      COALESCE(min(q.document->>'date'), '') AS earliest,
      COALESCE(max(q.document->>'date'), '') AS latest
    FROM q
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`.replace(/\{schema\}/g, schema), args);
  return rows[0];
}


/**
 * Everything the shell derives from the whole account: header metrics, per
 * track counts, tag counts and the year list. Computed in SQL over the same
 * authorized scope, so these numbers stay full-scope correct once the list
 * itself is paginated — deriving them from a loaded page would make the
 * header quietly report only the first 40 memories.
 */
export async function overviewMoments(client, userId, schema) {
  const [totals, perTrack, tags, years] = await Promise.all([
    client.query(`
      WITH authorized AS (${AUTHORIZED_SCOPE}),
      q AS (SELECT * FROM authorized)
      SELECT
        COUNT(*)::int AS total,
        COUNT(*) FILTER (WHERE (q.document->'isMilestone')::text = 'true')::int AS milestones,
        COUNT(DISTINCT COALESCE(NULLIF(q.document->'location'->>'city', ''), NULLIF(q.document->'location'->>'name', '')))
          FILTER (WHERE COALESCE(NULLIF(q.document->'location'->>'city', ''), NULLIF(q.document->'location'->>'name', '')) <> '')::int AS places,
        COALESCE(sum((SELECT COUNT(*) FROM {schema}.images i WHERE i.owner_id = q.owner_id AND i.moment_id = q.id))::int, 0) AS photos,
        COALESCE(min(NULLIF(left(q.document->>'date', 10), '')), '') AS earliest,
        COALESCE(max(NULLIF(left(q.document->>'date', 10), '')), '') AS latest
      FROM q`.replace(/\{schema\}/g, schema), [userId]),

    client.query(`
      WITH authorized AS (${AUTHORIZED_SCOPE}),
      q AS (SELECT * FROM authorized)
      SELECT q.owner_id AS track_owner_id, q.event_id AS track_id,
             COUNT(*)::int AS count,
             COUNT(*) FILTER (WHERE (q.document->'isMilestone')::text = 'true')::int AS milestones,
             COALESCE(sum((SELECT COUNT(*) FROM {schema}.images i WHERE i.owner_id = q.owner_id AND i.moment_id = q.id))::int, 0) AS photos,
             COALESCE(min(left(q.document->>'date', 10)), '') AS min_date,
             COALESCE(max(left(q.document->>'date', 10)), '') AS max_date
      FROM q GROUP BY q.owner_id, q.event_id`.replace(/\{schema\}/g, schema), [userId]),

    client.query(`
      WITH authorized AS (${AUTHORIZED_SCOPE}),
      q AS (SELECT * FROM authorized)
      SELECT t.value AS name, COUNT(*)::int AS count
      FROM q,
           LATERAL jsonb_array_elements_text(coalesce(q.document->'tags', '[]'::jsonb)) AS t(value)
      WHERE t.value <> ''
      GROUP BY t.value ORDER BY count DESC, t.value ASC`.replace(/\{schema\}/g, schema), [userId]),

    client.query(`
      WITH authorized AS (${AUTHORIZED_SCOPE}),
      q AS (SELECT * FROM authorized)
      SELECT DISTINCT left(q.document->>'date', 4) AS year
      FROM q
      WHERE q.document->>'date' ~ '^\\d{4}-\\d{2}-\\d{2}$'
      ORDER BY year DESC`.replace(/\{schema\}/g, schema), [userId]),
  ]);

  const total = totals.rows[0];
  return {
    total: total.total,
    milestones: total.milestones,
    places: total.places,
    photos: total.photos,
    earliest: total.earliest || null,
    latest: total.latest || null,
    tracks: perTrack.rows.map(row => ({
      trackOwnerId: row.track_owner_id,
      trackId: row.track_id,
      count: row.count,
      milestones: row.milestones,
      photos: row.photos,
      minDate: row.min_date || null,
      maxDate: row.max_date || null,
    })),
    tags: tags.rows.map(row => ({ name: row.name, count: row.count })),
    years: years.rows.map(row => row.year),
  };
}
