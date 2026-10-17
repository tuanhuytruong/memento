import { queryBlindbox, queryPostcardPicker } from './discovery-queries.mjs';
/** Mount after the existing same-origin/JSON middleware; auth must set req.user.id.
 * Pass the existing quoted qschema, pool and safeMoment function. */
export function mountDiscoveryRoutes(app, { auth, pool, qschema, safeMoment }) {
  for (const [path, query] of [['blindbox', queryBlindbox], ['postcard-picker', queryPostcardPicker]]) {
    app.post(`/api/discovery/${path}`, auth, async (req, res, next) => {
      try { res.set('Cache-Control', 'no-store').json(await query(pool, req.user.id, req.body, qschema, { safeMoment })); }
      catch (error) { next(error); }
    });
  }
}
