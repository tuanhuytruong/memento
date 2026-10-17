import './mutation-safety.test.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env.local' });

const { app, validateDocument } = await import('../server.mjs');
const { pool, createInvite, hashInvite, qschema } = await import('../memento-db.mjs');
const { transaction } = await import('../mutation-safety.mjs');

test('document validation preserves event fields and rejects invalid dates', () => {
  const track = validateDocument({ title: 'Roadmap', description: '', color: 'indigo', icon: 'Cpu', tags: [] }, 'track');
  assert.equal(track.title, 'Roadmap');
  assert.equal(validateDocument({ eventId: 'x', date: '2026-02-30', images: [], tags: [] }, 'moment'), null);
  assert.equal(validateDocument({ eventId: 'x', date: '2026-02-03', time: '26:00', images: [], tags: [] }, 'moment'), null);
  assert.ok(validateDocument({ eventId: 'x', date: '2026-02-28', images: [], tags: [] }, 'moment'));
  assert.ok(validateDocument({ eventId: 'x', date: '2026-02-28T09:30:00Z', images: [], tags: [] }, 'moment'));
  assert.equal(validateDocument({ eventId: 'x', date: '2026-02-30T09:30:00Z', images: [], tags: [] }, 'moment'), null);
});

// Phase 0 frozen contract: a date-only memory keeps its literal calendar date.
// The server never reinterprets it in UTC, so a date near local midnight can
// never shift to a neighbouring calendar day.
test('frozen contract: date-only moments keep their literal calendar date and tags stay exact', () => {
  const dateOnly = validateDocument({ eventId: 'x', date: '2026-01-01', images: [], tags: ['Tết', ' gia đình '] }, 'moment');
  assert.equal(dateOnly.date, '2026-01-01', 'date-only must be stored literally, never ISO-shifted');
  assert.equal(dateOnly.time, undefined);
  // The same contract at the other end of the year.
  assert.equal(validateDocument({ eventId: 'x', date: '2026-12-31', images: [], tags: [] }, 'moment').date, '2026-12-31');
  // Tag strings are preserved verbatim (trimming happens client-side); the
  // server enforces only presence and the 64-character bound.
  assert.deepEqual(dateOnly.tags, ['Tết', ' gia đình ']);
  assert.equal(validateDocument({ eventId: 'x', date: '2026-01-01', images: [], tags: ['x'.repeat(65)] }, 'moment'), null);
  assert.equal(validateDocument({ eventId: 'x', date: '2026-01-01', images: [], tags: ['  '] }, 'moment'), null);
  // Timestamp-form dates must carry an explicit offset or Z.
  assert.ok(validateDocument({ eventId: 'x', date: '2026-01-01T23:59:59+07:00', images: [], tags: [] }, 'moment'));
  assert.equal(validateDocument({ eventId: 'x', date: '2026-01-01T23:59:59', images: [], tags: [] }, 'moment'), null);
});

test('perspective validation trims text and enforces bounds and kind', async () => {
  const { validatePerspective } = await import('../server.mjs');
  assert.deepEqual(validatePerspective({kind:'reflection',body:'  nhớ nhà  '}),{kind:'reflection',body:'nhớ nhà'});
  assert.equal(validatePerspective({kind:'unknown',body:'text'}),null);
  assert.equal(validatePerspective({kind:'perspective',body:'  '}),null);
  assert.equal(validatePerspective({kind:'perspective',body:'x'.repeat(2001)}),null);
  assert.deepEqual(validatePerspective({body:' words ',expectedVersion:1},false),{kind:undefined,body:'words'});
});

test('authenticated API integration with owner isolation and R2 prefix', { timeout: 120000 }, async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('Set RUN_INTEGRATION=1 for DB/R2-backed API integration');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const origin = base;
  async function request(path, { method='GET', token, body, headers={}, multipart, ownerId= userId }={}) {
    if (method === 'GET' && /^\/api\/moments\/[^/]+\/reactions$/.test(path)) path += `?ownerId=${userId}`;
    const h = { ...headers };
    if (['POST','PUT','DELETE'].includes(method)) h.Origin = origin;
    if (token) h.Cookie = `memento_session=${token}`;
    if (multipart) body = multipart;
    else if (body !== undefined || (method === 'DELETE' && /^\/api\/moments\/[^/]+$/.test(path))) {
      if (/^\/api\/moments\/[^/]+$/.test(path) && ['PUT','DELETE'].includes(method)) body = { ...(body || {}), ownerId };
      if (path === '/api/moments' && method === 'POST') body = { ...(body || {}), eventOwnerId: body?.eventOwnerId ?? ownerId };
      if (/^\/api\/moments\/[^/]+$/.test(path) && method === 'PUT') body = { ...(body || {}), eventOwnerId: body?.eventOwnerId ?? ownerId };
      if (/^\/api\/moments\/[^/]+\/reactions$/.test(path)) body = { ...body, ownerId };
      h['Content-Type']='application/json'; body=JSON.stringify(body);
    }
    const res=await fetch(base+path,{method,headers:h,body});
    const type=res.headers.get('content-type')||'';
    const data=type.includes('application/json')?await res.json():await res.arrayBuffer();
    return {res,data};
  }
  const username = `test_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`;
  const secondUsername = `test_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`;
  let token, token2, userId, userId2, trackId, momentId, imageId, inviteHash1, inviteHash2, lookupUsers=[];
  try {
    const badOrigin = await fetch(base+'/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'valid-long-password',inviteCode:'invalid'})});
    assert.equal(badOrigin.status,403);
    const invite = await createInvite(1); inviteHash1=hashInvite(invite);
    const registered = await request('/api/auth/register',{method:'POST',body:{username,password:'a-very-long-test-password-1',inviteCode:invite}});
    assert.equal(registered.res.status,200); assert.equal(registered.data.user.username,username); userId=registered.data.user.id;
 token = registered.res.headers.get('set-cookie').match(/memento_session=([^;]+)/)[1];
    const reused = await request('/api/auth/register',{method:'POST',body:{username:secondUsername,password:'a-very-long-test-password-2',inviteCode:invite}});
    assert.equal(reused.res.status,400);
    const me=await request('/api/auth/me',{token}); assert.equal(me.data.user.username,username);
    const badLogin=await request('/api/auth/login',{method:'POST',body:{username,password:'incorrect-long-password'}});assert.equal(badLogin.res.status,401);
    const loggedIn=await request('/api/auth/login',{method:'POST',body:{username,password:'a-very-long-test-password-1'}});assert.equal(loggedIn.res.status,200);assert.equal(loggedIn.data.user.id,userId);
    await request('/api/auth/logout',{method:'POST',token});
    const sessionCookie=loggedIn.res.headers.get('set-cookie');
    assert.match(sessionCookie,/HttpOnly/);assert.match(sessionCookie,/Secure/);assert.match(sessionCookie,/SameSite=Lax/);
    token=sessionCookie.match(/memento_session=([^;]+)/)[1];
    const sessionRow=await pool.query(`SELECT token_hash,expires_at FROM ${qschema}.sessions WHERE user_id=$1`,[userId]);assert.notEqual(sessionRow.rows[0].token_hash,token);assert.ok(new Date(sessionRow.rows[0].expires_at)>new Date());
    const track=(await request('/api/tracks',{method:'POST',token,body:{title:'Test track',description:'',color:'indigo',icon:'Cpu',tags:[]}}));
    assert.equal(track.res.status,201); trackId=track.data.track.id;
    assert.equal((await request('/api/tracks',{token})).data.tracks.length,1);
    const updatedTrack=await request('/api/tracks/'+trackId,{method:'PUT',token,body:{description:'changed'}});assert.equal(updatedTrack.res.status,200);assert.equal(updatedTrack.data.track.description,'changed');
    const moment=await request('/api/moments',{method:'POST',token,body:{eventId:trackId,eventOwnerId:userId,title:'API moment',date:'2026-09-24',time:'10:30',description:'',tags:[],images:[]}});
    assert.equal(moment.res.status,201);momentId=moment.data.moment.id;assert.equal(moment.data.moment.resourceOwnerId,userId);
    const secondInvite=await createInvite(1); inviteHash2=hashInvite(secondInvite);
    const registered2=await request('/api/auth/register',{method:'POST',body:{username:secondUsername,password:'a-very-long-test-password-2',inviteCode:secondInvite}});assert.equal(registered2.res.status,200);userId2=registered2.data.user.id;
    token2=registered2.res.headers.get('set-cookie').match(/memento_session=([^;]+)/)[1];
    assert.equal((await request('/api/tracks',{token:token2})).data.tracks.length,0);
    assert.equal((await request('/api/moments',{token:token2})).data.moments.length,0);
    assert.equal((await request('/api/tracks/'+trackId,{method:'PUT',token:token2,body:{title:'intrusion'}})).res.status,404);
    const lookupPrefix = `lookup${crypto.randomUUID().replaceAll('-', '').slice(0,20)}`;
    lookupUsers = ['_Alpha', '_bravo', '_Charlie', '_delta', '0decoy'].map(suffix => ({ id: crypto.randomUUID(), username: `${lookupPrefix}${suffix}` }));
    await Promise.all(lookupUsers.map(user => pool.query(`INSERT INTO ${qschema}.users(id,username,password_hash) VALUES($1,$2,$3)`, [user.id, user.username, 'unused-test-password-hash'])));
    const unauthenticatedSearch = await request(`/api/users/search?q=${lookupPrefix}`);
    assert.equal(unauthenticatedSearch.res.status,401);
    const autocomplete = await request(`/api/users/search?q=${lookupPrefix.toUpperCase()}_`, { token });
    assert.equal(autocomplete.res.status,200);
    assert.deepEqual(autocomplete.data, { usernames: lookupUsers.slice(0, 3).map(user => user.username) });
    assert.equal(Object.keys(autocomplete.data).length, 1);
    assert.ok(autocomplete.data.usernames.every(value => typeof value === 'string'));
    assert.equal((await request('/api/users/search', { token })).res.status,400);
    assert.equal((await request(`/api/users/search?q=${'a'.repeat(33)}`, { token })).res.status,400);
    const selfSearch = await request('/api/users/search?q=test', { token });
    assert.equal(selfSearch.res.status,200);
    assert.ok(!selfSearch.data.usernames.includes(username));
    // Invitations are private until acceptance; viewers can read only the designated track and cannot mutate it.
    const viewerInvite=await request(`/api/tracks/${trackId}/collaborators`,{method:'POST',token,body:{username:secondUsername,role:'viewer'}});assert.equal(viewerInvite.res.status,201);
    assert.equal((await request('/api/tracks',{token:token2})).data.tracks.length,0);
    const pending=await request('/api/collaboration-invitations',{token:token2});assert.equal(pending.data.invitations.length,1);const collaborationId=pending.data.invitations[0].id;
    assert.equal((await request(`/api/collaboration-invitations/${collaborationId}/accept`,{method:'POST',token:token2})).res.status,200);
    const sharedTracks=(await request('/api/tracks',{token:token2})).data.tracks;assert.equal(sharedTracks.length,1);assert.equal(sharedTracks[0].id,trackId);
    const viewerMoments=await request('/api/moments',{token:token2});assert.equal(viewerMoments.data.moments.length,1);assert.deepEqual(viewerMoments.data.moments[0].reactions,[]);assert.equal(viewerMoments.data.moments[0].resourceOwnerId,userId);
     const ownerRequestId=crypto.randomUUID();
     const ownerPerspective=await request(`/api/moments/${momentId}/perspectives`,{method:'POST',token,body:{ownerId:userId,kind:'perspective',body:'Original owner perspective',clientRequestId:ownerRequestId}});assert.equal(ownerPerspective.res.status,201);const ownerPerspectiveId=ownerPerspective.data.perspective.id;
     const ownerPerspectiveReplay=await request(`/api/moments/${momentId}/perspectives`,{method:'POST',token,body:{ownerId:userId,kind:'perspective',body:'Original owner perspective',clientRequestId:ownerRequestId}});assert.equal(ownerPerspectiveReplay.res.status,201);assert.equal(ownerPerspectiveReplay.data.perspective.id,ownerPerspectiveId);
     assert.equal((await request(`/api/moments/${momentId}/perspectives?ownerId=${userId}`,{token})).data.perspectives.length,1);
      // Phase 1 Task 1.4: the exact (ownerId, id) read is the only path the conflict
      // comparison uses, so its authorization behaviour is a frozen contract.
      const exactOwnerRead=await request(`/api/moments/${momentId}?ownerId=${userId}`,{token});
      assert.equal(exactOwnerRead.res.status,200);
      assert.equal(exactOwnerRead.data.moment.id,momentId);
      assert.equal(exactOwnerRead.data.moment.resourceOwnerId,userId);
      assert.equal((await request(`/api/moments/${momentId}?ownerId=${userId}`)).res.status,401,'unauthenticated exact read denied');
      assert.equal((await request(`/api/moments/${momentId}?ownerId=${userId2}`,{token})).res.status,404,'an unrelated owner id yields 404, not content');
      // Revoke the viewer temporarily so this is truly an unauthorized exact-resource read.
      assert.equal((await request(`/api/tracks/${trackId}/collaborators/${userId2}`,{method:'DELETE',token})).res.status,200);
      assert.equal((await request(`/api/moments/${momentId}?ownerId=${userId}`,{token:token2})).res.status,404,'revoked access yields 404 on the exact read, never cached metadata');
      assert.equal((await pool.query(`SELECT 1 FROM ${qschema}.moments WHERE owner_id=$1 AND id=$2`,[userId,momentId])).rowCount,1);
      // Hold the actual target owner's exclusive mutation lock while the former viewer requests that target.
      let releaseOwnerLock;const ownerLockGate=new Promise(resolve=>{releaseOwnerLock=resolve;});let signalOwnerLock;const ownerLockStarted=new Promise(resolve=>{signalOwnerLock=resolve;});
      const ownerLock=transaction(pool,async()=>{signalOwnerLock();await ownerLockGate;},userId,process.env.DB_SCHEMA);await ownerLockStarted;
      let lockWaitTimeout; try { const lockWait=new Promise((_,reject)=>{lockWaitTimeout=setTimeout(()=>reject(new Error('unauthorized GET waited on owner mutation lock')),1500);}); const denied=await Promise.race([request(`/api/moments/${momentId}/perspectives?ownerId=${userId}`,{token:token2}),lockWait]);assert.equal(denied.res.status,404); } finally { clearTimeout(lockWaitTimeout); releaseOwnerLock(); await ownerLock; }
      const reinvite=await request(`/api/tracks/${trackId}/collaborators`,{method:'POST',token,body:{username:secondUsername,role:'viewer'}});assert.equal(reinvite.res.status,201);
      assert.equal((await request(`/api/collaboration-invitations/${reinvite.data.collaborator.id}/accept`,{method:'POST',token:token2})).res.status,200);
     assert.equal((await request(`/api/moments/${momentId}/perspectives`,{method:'POST',token,body:{ownerId:userId,kind:'perspective',body:'Different payload',clientRequestId:ownerRequestId}})).res.status,409);
     const viewerPerspectiveList=await request(`/api/moments/${momentId}/perspectives?ownerId=${userId}`,{token:token2});assert.equal(viewerPerspectiveList.res.status,200);assert.equal(viewerPerspectiveList.data.perspectives.length,1);assert.equal(viewerPerspectiveList.data.capabilities.canCreate,false);
     assert.equal((await request(`/api/moments/${momentId}/perspectives`,{method:'POST',token:token2,body:{ownerId:userId,kind:'perspective',body:'Viewer must not write',clientRequestId:crypto.randomUUID()}})).res.status,403);
    const viewerHeart=await request(`/api/moments/${momentId}/reactions`,{method:'POST',token:token2,body:{emoji:'❤️'}});assert.equal(viewerHeart.res.status,200);assert.deepEqual(viewerHeart.data.selectedEmojis,['❤️']);assert.equal(viewerHeart.data.reactions[0].count,1);assert.deepEqual(viewerHeart.data.reactions[0].usernames,[secondUsername]);
    const viewerParty=await request(`/api/moments/${momentId}/reactions`,{method:'POST',token:token2,body:{emoji:'🎉'}});assert.equal(viewerParty.res.status,200);assert.deepEqual(viewerParty.data.selectedEmojis,['❤️','🎉']);
    const viewerPartyRemoved=await request(`/api/moments/${momentId}/reactions`,{method:'POST',token:token2,body:{emoji:'🎉'}});assert.equal(viewerPartyRemoved.res.status,200);assert.deepEqual(viewerPartyRemoved.data.selectedEmojis,['❤️']);
    const ownerReactions=await request(`/api/moments/${momentId}/reactions`,{token});assert.equal(ownerReactions.res.status,200);assert.deepEqual(ownerReactions.data.selectedEmojis,[]);assert.equal(ownerReactions.data.reactions.reduce((n,reaction)=>n+reaction.count,0),1);
    const ownerAdded=await request(`/api/moments/${momentId}/reactions`,{method:'POST',token,body:{emoji:'✨'}});assert.deepEqual(ownerAdded.data.selectedEmojis,['✨']);assert.equal(ownerAdded.data.reactions.reduce((n,reaction)=>n+reaction.count,0),2);
    const ownerRemoved=await request(`/api/moments/${momentId}/reactions`,{method:'POST',token,body:{emoji:'✨'}});assert.deepEqual(ownerRemoved.data.selectedEmojis,[]);assert.equal(ownerRemoved.data.reactions.reduce((n,reaction)=>n+reaction.count,0),1);
    const ownerMoments=await request('/api/moments',{token});assert.equal(ownerMoments.data.moments[0].reactions.reduce((n,reaction)=>n+reaction.count,0),1);
     const perspectiveExport=await request('/api/perspectives/export',{token});assert.equal(perspectiveExport.res.status,200);assert.equal(perspectiveExport.data.perspectives.length,1);assert.equal(perspectiveExport.data.perspectives[0].body,'Original owner perspective');assert.equal(perspectiveExport.data.perspectives[0].momentOwnerId,userId);assert.equal(perspectiveExport.data.perspectives[0].momentId,momentId);assert.equal(perspectiveExport.data.perspectives[0].authorId,userId);assert.equal(perspectiveExport.data.perspectives[0].username,username);assert.equal(perspectiveExport.data.perspectives[0].momentOwnerId,userId);assert.equal(perspectiveExport.data.perspectives[0].momentId,momentId);assert.equal(perspectiveExport.data.perspectives[0].authorId,userId);assert.equal(perspectiveExport.data.perspectives[0].username,username);
     assert.equal((await request('/api/perspectives/export',{token:token2})).data.perspectives.length,0);
    assert.equal((await request(`/api/moments/${momentId}/reactions`,{method:'POST',token:token2,body:{emoji:'nope'}})).res.status,400);
    assert.equal((await request(`/api/moments/${momentId}`,{method:'PUT',token:token2,body:{title:'nope'}})).res.status,403);
    assert.equal((await request('/api/moments',{method:'POST',token:token2,body:{eventId:trackId,eventOwnerId:userId,title:'nope',date:'2026-09-25',tags:[],images:[]}})).res.status,403);
    assert.equal((await request(`/api/tracks/${trackId}/collaborators`,{method:'POST',token:token2,body:{username,role:'editor'}})).res.status,404);
    // Owner revokes viewer access, then re-invites as editor. Editors are constrained to this one track.
    assert.equal((await request(`/api/tracks/${trackId}/collaborators/${userId2}`,{method:'DELETE',token})).res.status,200);
    assert.equal((await request(`/api/moments/${momentId}/reactions`,{token:token2})).res.status,404);
     assert.equal((await request(`/api/moments/${momentId}/perspectives?ownerId=${userId}`,{token:token2})).res.status,404);
     assert.equal((await request(`/api/perspectives/${ownerPerspectiveId}`,{method:'PUT',token:token2,body:{body:'Stale permission after revoke',expectedVersion:1}})).res.status,404);
    assert.equal((await request(`/api/moments/${momentId}/reactions`,{method:'POST',token:token2,body:{emoji:'❤️'}})).res.status,404);
    assert.equal((await request('/api/tracks',{token:token2})).data.tracks.length,0);
    assert.equal((await request(`/api/moments/${momentId}/perspectives?ownerId=${userId}`,{token})).data.perspectives.length,1);
    const editorInvite=await request(`/api/tracks/${trackId}/collaborators`,{method:'POST',token,body:{username:secondUsername,role:'editor'}});assert.equal(editorInvite.res.status,201);
    const editorPending=await request('/api/collaboration-invitations',{token:token2});assert.equal(editorPending.data.invitations.length,1);
    assert.equal((await request(`/api/collaboration-invitations/${editorPending.data.invitations[0].id}/accept`,{method:'POST',token:token2})).res.status,200);
    const editorMoment=await request('/api/moments',{method:'POST',token:token2,body:{eventId:trackId,eventOwnerId:userId,title:'editor moment',date:'2026-09-25',tags:['shared-tag'],images:[]}});assert.equal(editorMoment.res.status,201);
     const editorRequestId=crypto.randomUUID();const editorPerspective=await request(`/api/moments/${momentId}/perspectives`,{method:'POST',token:token2,body:{ownerId:userId,kind:'perspective',body:'Editor remembers another detail',clientRequestId:editorRequestId}});assert.equal(editorPerspective.res.status,201);const editorPerspectiveId=editorPerspective.data.perspective.id;
      const editorExport=await request('/api/perspectives/export',{token:token2});assert.equal(editorExport.res.status,200);assert.deepEqual(editorExport.data.perspectives,[]);
     const ownerExportAfterEditor=await request('/api/perspectives/export',{token});assert.deepEqual(ownerExportAfterEditor.data.perspectives.map(item=>item.body).sort(),['Editor remembers another detail','Original owner perspective'].sort());const exportedEditor=ownerExportAfterEditor.data.perspectives.find(item=>item.body==='Editor remembers another detail');assert.equal(exportedEditor.momentOwnerId,userId);assert.equal(exportedEditor.momentId,momentId);assert.equal(exportedEditor.authorId,userId2);assert.equal(exportedEditor.username,secondUsername);
      const editorPerspectiveList=await request(`/api/moments/${momentId}/perspectives?ownerId=${userId}`,{token:token2});assert.equal(editorPerspectiveList.res.status,200);assert.deepEqual(editorPerspectiveList.data.perspectives.map(item=>item.body),['Original owner perspective','Editor remembers another detail']);
     assert.equal((await request(`/api/perspectives/${ownerPerspectiveId}`,{method:'PUT',token:token2,body:{body:'Change the owner text',expectedVersion:1}})).res.status,403);
     assert.equal((await request(`/api/perspectives/${ownerPerspectiveId}`,{method:'DELETE',token:token2})).res.status,403);
     const editorEdit=await request(`/api/perspectives/${editorPerspectiveId}`,{method:'PUT',token:token2,body:{body:'Edited by its author',expectedVersion:1}});assert.equal(editorEdit.res.status,200);assert.equal(editorEdit.data.perspective.version,2);
     assert.equal((await request(`/api/perspectives/${editorPerspectiveId}`,{method:'PUT',token:token2,body:{body:'Stale overwrite',expectedVersion:1}})).res.status,409);
     // Cursor pages are stable and complete at the 20-item boundary.
     for(let i=0;i<21;i++){
       const pageItem=await request(`/api/moments/${momentId}/perspectives`,{method:'POST',token:token2,body:{ownerId:userId,kind:'perspective',body:`Page item ${String(i).padStart(2,'0')}`,clientRequestId:crypto.randomUUID()}});
       assert.equal(pageItem.res.status,201);
     }
     const pageOne=await request(`/api/moments/${momentId}/perspectives?ownerId=${userId}`,{token:token2});assert.equal(pageOne.res.status,200);assert.equal(pageOne.data.perspectives.length,20);assert.ok(pageOne.data.nextCursor);
     const pageTwo=await request(`/api/moments/${momentId}/perspectives?ownerId=${userId}&cursor=${encodeURIComponent(pageOne.data.nextCursor)}`,{token:token2});assert.equal(pageTwo.res.status,200);assert.equal(pageTwo.data.perspectives.length,3);assert.equal(pageTwo.data.nextCursor,null);
     assert.equal(new Set([...pageOne.data.perspectives,...pageTwo.data.perspectives].map(item=>item.id)).size,23);
     assert.equal((await request(`/api/moments/${momentId}/perspectives?ownerId=${userId}&cursor=bad`,{token:token2})).res.status,400);
     assert.equal((await request(`/api/perspectives/${editorPerspectiveId}`,{method:'DELETE',token})).res.status,200);
    assert.equal((await request(`/api/moments/${editorMoment.data.moment.id}`,{method:'PUT',token:token2,body:{eventId:'other-track'}})).res.status,403);
    assert.equal((await request(`/api/tracks/${trackId}`,{method:'DELETE',token:token2})).res.status,404);
    assert.equal((await request(`/api/moments/${editorMoment.data.moment.id}`,{method:'DELETE',token:token2,ownerId:userId})).res.status,200);
    const editorReaction=await request(`/api/moments/${momentId}/reactions`,{method:'POST',token:token2,body:{emoji:'😂'}});assert.equal(editorReaction.res.status,200);assert.deepEqual(editorReaction.data.selectedEmojis,['❤️','😂']);
     const collisionTrack=await request('/api/tracks',{method:'POST',token:token2,body:{id:trackId,title:'Collision track',description:'',color:'indigo',icon:'Cpu',tags:[]}});assert.equal(collisionTrack.res.status,201);const collisionTrackId=collisionTrack.data.track.id;
     const collisionMoment=await request('/api/moments',{method:'POST',token:token2,body:{id:momentId,eventId:collisionTrackId,eventOwnerId:userId2,title:'Private duplicate id',date:'2026-09-24',tags:[],images:[]}});assert.equal(collisionMoment.res.status,201);assert.equal(collisionMoment.data.moment.id,momentId);
     const collidingUploadForm=new FormData();collidingUploadForm.set('momentId',momentId);collidingUploadForm.set('ownerId',userId);collidingUploadForm.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNgZGJmZGJmgFAAAK4AGRLRbNUAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'collision.png');
     const collidingUpload=await request('/api/images',{method:'POST',token:token2,multipart:collidingUploadForm});assert.equal(collidingUpload.res.status,201);
     const collidingImageOwner=await pool.query(`SELECT owner_id,moment_id FROM ${qschema}.images WHERE id=$1`,[collidingUpload.data.image.id]);assert.equal(collidingImageOwner.rows[0].owner_id,userId);assert.equal(collidingImageOwner.rows[0].moment_id,momentId);assert.equal((await request(`/api/images/${collidingUpload.data.image.id}`,{method:'DELETE',token:token2})).res.status,200);
     const ownCollisionPerspective=await request(`/api/moments/${momentId}/perspectives`,{method:'POST',token:token2,body:{ownerId:userId2,kind:'perspective',body:'Belongs to second owner',clientRequestId:crypto.randomUUID()}});assert.equal(ownCollisionPerspective.res.status,201);
     const exactCollision=await request(`/api/moments/${momentId}/perspectives?ownerId=${userId2}`,{token:token2});assert.equal(exactCollision.res.status,200);assert.deepEqual(exactCollision.data.perspectives.map(item=>item.body),['Belongs to second owner']);
     assert.equal((await request(`/api/moments/${momentId}/perspectives?ownerId=${userId2}`,{token})).res.status,404);
     const collisionExport=await request('/api/perspectives/export',{token:token2});assert.deepEqual(collisionExport.data.perspectives.map(item=>item.body),['Belongs to second owner']);assert.equal(collisionExport.data.perspectives[0].momentOwnerId,userId2);assert.equal(collisionExport.data.perspectives[0].momentId,momentId);assert.equal(collisionExport.data.perspectives[0].authorId,userId2);assert.equal(collisionExport.data.perspectives[0].username,secondUsername);
      assert.equal((await request('/api/perspectives/export?limit=501',{token:token2})).res.status,400);
      assert.equal((await request('/api/perspectives/export?cursor=bad',{token:token2})).res.status,400);

    const form=new FormData();form.set('momentId',momentId);form.set('ownerId',userId);form.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAAEUlEQVQImWNgZGJmZGJmgFAAAK4AGRLRbNUAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'test.png');
    const uploaded=await request('/api/images',{method:'POST',token,multipart:form});assert.equal(uploaded.res.status,201);imageId=uploaded.data.image.id;assert.match(uploaded.data.image.url,/^\/api\/images\//);
    const stored=await pool.query(`SELECT object_key,thumb_object_key,display_object_key FROM ${qschema}.images WHERE id=$1`,[imageId]);assert.ok(stored.rows[0].object_key.startsWith(`${process.env.DB_SCHEMA}/`));assert.ok(stored.rows[0].thumb_object_key?.startsWith(`${process.env.DB_SCHEMA}/`));assert.ok(stored.rows[0].display_object_key?.startsWith(`${process.env.DB_SCHEMA}/`));
    const moments=await request('/api/moments',{token});assert.deepEqual(moments.data.moments[0].images,[`/api/images/${imageId}`]);
    const updatedMoment=await request(`/api/moments/${momentId}`,{method:'PUT',token,body:{description:'updated through API',expectedVersion:moments.data.moments[0].version}});assert.equal(updatedMoment.res.status,200);assert.equal(updatedMoment.data.moment.description,'updated through API');assert.deepEqual(updatedMoment.data.moment.images,[`/api/images/${imageId}`]);
    const fetched=await request(`/api/images/${imageId}`,{token});assert.equal(fetched.res.status,200);assert.equal(fetched.res.headers.get('content-type'),'image/png');assert.equal(fetched.res.headers.get('cache-control'),'private, max-age=300, must-revalidate');assert.ok(fetched.data.byteLength>0);const thumb=await request(`/api/images/${imageId}?variant=thumb`,{token});assert.equal(thumb.res.status,200);assert.equal(thumb.res.headers.get('content-type'),'image/webp');assert.ok(thumb.data.byteLength>0);const display=await request(`/api/images/${imageId}?variant=display`,{token});assert.equal(display.res.status,200);assert.equal(display.res.headers.get('content-type'),'image/webp');const cached=await request(`/api/images/${imageId}?variant=display&retry=2`,{token});assert.equal(cached.res.status,200);assert.equal(cached.res.headers.get('etag'),display.res.headers.get('etag'));const conditional=await request(`/api/images/${imageId}?variant=display`,{token,headers:{'If-None-Match':display.res.headers.get('etag')}});assert.equal(conditional.res.status,304);assert.equal((await request(`/api/images/${imageId}?variant=bad`,{token})).res.status,400);
    assert.equal((await request(`/api/images/${imageId}`,{token:token2})).res.status,200);
    assert.equal((await request(`/api/tracks/${trackId}/collaborators/${userId2}`,{method:'DELETE',token})).res.status,200);
    assert.equal((await request(`/api/images/${imageId}`,{token:token2})).res.status,404);for(const variant of ['thumb','display'])assert.equal((await request(`/api/images/${imageId}?variant=${variant}`,{token:token2,headers:{'If-None-Match':display.res.headers.get('etag')}})).res.status,404);
    const tag=await request('/api/tags',{method:'POST',token,body:{tag:'verified'}});assert.equal(tag.res.status,201);
    assert.deepEqual((await request('/api/tags',{token})).data.tags,['shared-tag','verified']);
    assert.equal((await request('/api/tags/verified',{method:'DELETE',token})).res.status,200);
    assert.equal((await request(`/api/images/${imageId}`,{method:'DELETE',token})).res.status,200);imageId=undefined;
    assert.equal((await request('/api/moments/'+momentId,{method:'DELETE',token})).res.status,200);
    assert.equal((await pool.query(`SELECT 1 FROM ${qschema}.moment_reactions WHERE moment_owner_id=$1 AND moment_id=$2`,[userId,momentId])).rowCount,0);momentId=undefined;
    assert.equal((await request('/api/tracks/'+trackId,{method:'DELETE',token})).res.status,200);trackId=undefined;
    assert.equal((await request('/api/auth/logout',{method:'POST',token})).res.status,200);
    assert.equal((await request('/api/auth/me',{token})).res.status,401);token=undefined;
    assert.equal((await request('/api/auth/me')).res.status,401);
  } finally {
    if (imageId && token) await request(`/api/images/${imageId}`,{method:'DELETE',token}).catch(()=>{});
    if (momentId && token) await request(`/api/moments/${momentId}`,{method:'DELETE',token}).catch(()=>{});
    if (trackId && token) await request(`/api/tracks/${trackId}`,{method:'DELETE',token}).catch(()=>{});
    if(token) await request('/api/auth/logout',{method:'POST',token}).catch(()=>{});
    if(token2) await request('/api/auth/logout',{method:'POST',token:token2}).catch(()=>{});
    for (const user of lookupUsers) await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`,[user.id]).catch(()=>{});
    if(userId) await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`,[userId]).catch(()=>{});
    if(userId2) await pool.query(`DELETE FROM ${qschema}.users WHERE id=$1`,[userId2]).catch(()=>{});
    if(inviteHash1) await pool.query(`DELETE FROM ${qschema}.invites WHERE code_hash=$1`,[inviteHash1]).catch(()=>{});
    if(inviteHash2) await pool.query(`DELETE FROM ${qschema}.invites WHERE code_hash=$1`,[inviteHash2]).catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
  }
});
