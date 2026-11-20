import { AUTHORIZED_SCOPE, isCalendarDate, sqlCalendarDate } from './moment-queries.mjs';
import { ApiError } from './mutation-safety.mjs';

const moods = ['joyful','grateful','inspired','excited','serene','reflective','focused','challenged','nostalgic','proud'];
const placeLimit = 12;
const monthLimit = 24;
const factorLimit = 6; // Per mood and kind; only Joyful/Reflective in the reference radar.

export function validateInsightsQuery(query) {
  const { view, today } = query;
  if (view === 'atlas' && Object.keys(query).length === 1) return {view};
  if (view === 'archive' && Object.keys(query).length === 2 && isCalendarDate(today) && today >= '0001-01-30') return {view, today};
  throw new ApiError(400, 'Invalid archive insights view or local date');
}

const text = (expr) => `CASE WHEN jsonb_typeof(${expr}) = 'string' THEN NULLIF(btrim(${expr} #>> '{}'), '') END`;
const city = text("document->'location'->'city'");
const venue = text("document->'location'->'name'");
const country = text("document->'location'->'country'");
const orderMemory = 'day DESC NULLS LAST, owner_id, id';
const identity = `jsonb_build_object('ownerId', owner_id, 'id', id, 'title', coalesce(title, ''), 'date', day)`;
const source = `
  WITH authorized AS (${AUTHORIZED_SCOPE}),
  moments AS MATERIALIZED (
    SELECT owner_id, id, event_id, document->'tags' AS tags,
      left(${text("document->'title'")}, 200) AS title,
      CASE WHEN ${sqlCalendarDate("document->>'date'")} AND left(document->>'date', 4) <> '0000' THEN document->>'date' END AS day,
      CASE WHEN document->>'emotion' = ANY($2::text[]) THEN document->>'emotion' END AS mood,
      CASE WHEN jsonb_typeof(document->'emotionIntensity') = 'number' THEN
        CASE WHEN (document->>'emotionIntensity')::numeric BETWEEN 1 AND 5 THEN (document->>'emotionIntensity')::numeric ELSE 3 END
        ELSE 3 END AS intensity,
      document->'isMilestone' = 'true'::jsonb AS milestone,
      coalesce(${city}, ${venue}) AS place, ${country} AS country
    FROM authorized
  ),
  tags AS MATERIALIZED (
    SELECT DISTINCT m.owner_id, m.id, lower(normalize(t.label, NFC)) AS key, t.label
    FROM moments m
    CROSS JOIN LATERAL (
      SELECT ${text('value')} AS label
      FROM jsonb_array_elements(CASE WHEN jsonb_typeof(m.tags) = 'array' THEN m.tags ELSE '[]'::jsonb END)
    ) t WHERE t.label IS NOT NULL
  ),
  tag_keys AS (SELECT owner_id, id, key, min(label) AS label FROM tags GROUP BY owner_id, id, key),
  mood_groups AS (
    SELECT mood, count(*)::int AS count, round(avg(intensity), 2) AS average
    FROM moments WHERE mood IS NOT NULL GROUP BY mood
  )`;

const archive = `,
  track_totals AS (
    SELECT count(*)::int AS total, count(*) FILTER (WHERE t.document->>'status' = 'active')::int AS active
    FROM {schema}.tracks t
    WHERE t.owner_id = $1 OR EXISTS (
      SELECT 1 FROM {schema}.track_collaborators c
      WHERE c.owner_id = t.owner_id AND c.track_id = t.id AND c.recipient_id = $1
        AND c.accepted_at IS NOT NULL AND c.revoked_at IS NULL
    )
  ),
  tag_totals AS (SELECT key, left(min(label), 64) AS label, count(*)::int AS count FROM tag_keys GROUP BY key),
  daily AS (
    SELECT day, count(*)::int AS count, round(avg(intensity), 2) AS average,
      mode() WITHIN GROUP (ORDER BY mood) AS mood
    FROM moments WHERE mood IS NOT NULL AND day BETWEEN to_char($3::date - 29, 'YYYY-MM-DD') AND $3::text
    GROUP BY day
  )
  SELECT jsonb_build_object(
    'health', (SELECT jsonb_build_object(
      'total', count(*), 'dated', count(day), 'withMood', count(mood),
      'milestones', count(*) FILTER (WHERE milestone), 'earliest', min(day), 'latest', max(day),
      'withPlace', count(place), 'photos', (SELECT count(*) FROM moments m JOIN {schema}.images i ON i.owner_id = m.owner_id AND i.moment_id = m.id),
      'activeTracks', (SELECT active FROM track_totals), 'totalTracks', (SELECT total FROM track_totals),
      'tagCount', (SELECT count(*) FROM tag_totals),
      'topTag', (SELECT jsonb_build_object('label', label, 'count', count) FROM tag_totals ORDER BY count DESC, key LIMIT 1)
    ) FROM moments),
    'mood', (SELECT jsonb_build_object('logged', count(*), 'average', round(avg(intensity), 2)) FROM moments WHERE mood IS NOT NULL),
    'moods', coalesce((SELECT jsonb_agg(g ORDER BY count DESC, average DESC, mood) FROM mood_groups g), '[]'::jsonb),
    'today', $3::text,
    'daily', coalesce((SELECT jsonb_agg(d ORDER BY day) FROM daily d), '[]'::jsonb)
  ) AS insights`;

const atlas = `,
  mood_months AS (
    SELECT left(day, 7) AS month, count(*)::int AS count, round(avg(intensity), 2) AS average,
      mode() WITHIN GROUP (ORDER BY mood) AS mood
    FROM moments WHERE mood IS NOT NULL AND day IS NOT NULL GROUP BY 1
    ORDER BY month DESC LIMIT ${monthLimit}
  ),
  mood_examples AS (
    SELECT mood, jsonb_agg(memory ORDER BY day DESC NULLS LAST, owner_id, id) AS examples
    FROM (
      SELECT mood, day, owner_id, id, ${identity} AS memory,
        row_number() OVER (PARTITION BY mood ORDER BY ${orderMemory}) AS rank
      FROM moments WHERE mood IS NOT NULL
    ) ranked WHERE rank <= 3 GROUP BY mood
  ),
  logged_days AS (SELECT DISTINCT day::date AS day FROM moments WHERE mood IS NOT NULL AND day IS NOT NULL),
  streaks AS (SELECT day - (row_number() OVER (ORDER BY day))::int AS run FROM logged_days),
  year_months AS (SELECT count(DISTINCT extract(month FROM day)) AS months FROM logged_days GROUP BY extract(year FROM day)),
  places AS MATERIALIZED (
    SELECT m.*, lower(normalize(place, NFC)) AS city_key, lower(normalize(coalesce(country, ''), NFC)) AS country_key
    FROM moments m WHERE place IS NOT NULL
  ),
  place_groups AS (
    SELECT city_key, country_key, left(min(place), 200) AS city, left(min(country), 200) AS country,
      count(*)::int AS count, min(day) AS earliest, max(day) AS latest,
      mode() WITHIN GROUP (ORDER BY mood) AS mood
    FROM places GROUP BY city_key, country_key
  ),
  top_places AS MATERIALIZED (
    SELECT * FROM place_groups ORDER BY count DESC, latest DESC NULLS LAST, city_key, country_key LIMIT ${placeLimit}
  ),
  place_cards AS (
    SELECT g.city, g.country, g.count, g.earliest, g.latest, g.mood,
      coalesce((SELECT jsonb_agg(memory ORDER BY day DESC NULLS LAST, owner_id, id) FROM (
        SELECT ${identity} AS memory, day, owner_id, id FROM places p
        WHERE p.city_key = g.city_key AND p.country_key = g.country_key ORDER BY ${orderMemory} LIMIT 3
      ) recent), '[]'::jsonb) AS examples,
      (SELECT i.id FROM places p JOIN {schema}.images i ON i.owner_id = p.owner_id AND i.moment_id = p.id
       WHERE p.city_key = g.city_key AND p.country_key = g.country_key
       ORDER BY p.day DESC NULLS LAST, p.owner_id, p.id, i.created_at, i.id LIMIT 1) AS "imageId",
      g.city_key, g.country_key
    FROM top_places g
  ),
  factors AS (
    SELECT m.mood, 'tag' AS kind, jsonb_build_array(t.key) AS key, t.label FROM tag_keys t
    JOIN moments m ON m.owner_id = t.owner_id AND m.id = t.id WHERE m.mood IS NOT NULL
    UNION ALL
    SELECT mood, 'place', jsonb_build_array(city_key, country_key), concat_ws(', ', place, country) FROM places WHERE mood IS NOT NULL
  ),
  factor_counts AS (
    SELECT kind, key, left(min(label), 200) AS label, count(*)::int AS sample,
      count(*) FILTER (WHERE mood = 'joyful')::int AS joyful,
      count(*) FILTER (WHERE mood = 'reflective')::int AS reflective
    FROM factors GROUP BY kind, key HAVING count(*) >= 4
  ),
  associations AS (
    SELECT f.kind, f.label, f.sample, v.mood, v.count,
      round(v.count::numeric / f.sample, 4) AS share,
      round(g.count::numeric / nullif((SELECT sum(count) FROM mood_groups), 0), 4) AS baseline,
      row_number() OVER (PARTITION BY v.mood, f.kind ORDER BY (v.count::numeric / f.sample) DESC, f.sample DESC, f.key) AS rank
    FROM factor_counts f CROSS JOIN LATERAL (VALUES ('joyful', f.joyful), ('reflective', f.reflective)) v(mood, count)
    JOIN mood_groups g ON g.mood = v.mood WHERE v.count >= 2
  )
  SELECT jsonb_build_object(
    'mood', (SELECT jsonb_build_object('logged', count(*), 'average', round(avg(intensity), 2)) FROM moments WHERE mood IS NOT NULL),
    'moods', coalesce((SELECT jsonb_agg(to_jsonb(g) || jsonb_build_object('examples', e.examples) ORDER BY g.count DESC, g.average DESC, g.mood)
      FROM mood_groups g JOIN mood_examples e USING(mood)), '[]'::jsonb),
    'months', coalesce((SELECT jsonb_agg(m ORDER BY month DESC) FROM mood_months m), '[]'::jsonb),
    'peak', (SELECT ${identity} || jsonb_build_object('mood', mood, 'intensity', intensity) FROM moments
      WHERE milestone AND mood IS NOT NULL ORDER BY intensity DESC, ${orderMemory} LIMIT 1),
    'seals', (SELECT jsonb_build_object(
      'joyPeaks', count(*) FILTER (WHERE mood = 'joyful' AND intensity >= 4 AND day IS NOT NULL),
      'reflectiveDays', count(DISTINCT day) FILTER (WHERE mood IN ('reflective', 'serene')),
      'peakEntries', count(*) FILTER (WHERE intensity >= 5),
      'distinctMoods', count(DISTINCT mood),
      'monthsInYear', coalesce((SELECT max(months) FROM year_months), 0),
      'gratefulPeaks', count(*) FILTER (WHERE mood = 'grateful' AND intensity >= 4),
      'longestStreak', coalesce((SELECT max(length) FROM (SELECT count(*) AS length FROM streaks GROUP BY run) runs), 0),
      'spanMonths', coalesce((left(max(day), 4)::int - left(min(day), 4)::int) * 12 + substring(max(day), 6, 2)::int - substring(min(day), 6, 2)::int, 0)
    ) FROM moments WHERE mood IS NOT NULL),
    'geography', (SELECT jsonb_build_object('places', count(*), 'countries', count(DISTINCT nullif(country_key,'')), 'moments', coalesce(sum(count), 0)) FROM place_groups),
    'places', coalesce((SELECT jsonb_agg(to_jsonb(p) - 'city_key' - 'country_key' ORDER BY count DESC, latest DESC NULLS LAST, city_key, country_key) FROM place_cards p), '[]'::jsonb),
    'associations', coalesce((SELECT jsonb_agg(to_jsonb(a) - 'rank' ORDER BY rank, kind, mood) FROM associations a
      WHERE rank <= ${factorLimit} AND share > baseline), '[]'::jsonb)
  ) AS insights`;

export async function queryArchiveInsights(client, userId, {view, today}, schema) {
  const isArchive = view === 'archive';
  const { rows } = await client.query((source + (isArchive ? archive : atlas)).replaceAll('{schema}', schema),
    isArchive ? [userId, moods, today] : [userId, moods]);
  return rows[0].insights;
}
