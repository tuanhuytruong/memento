import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import dotenv from 'dotenv';
dotenv.config({ path: process.env.ENV_FILE || '.env.local' });

const { app, validateDocument } = await import('../server.mjs');
const { pool, createInvite, hashInvite } = await import('../memento-db.mjs');

test('document validation preserves event fields and rejects invalid dates', () => {
  const track = validateDocument({ title: 'Roadmap', description: '', color: 'indigo', icon: 'Cpu', tags: [] }, 'track');
  assert.equal(track.title, 'Roadmap');
  assert.equal(validateDocument({ eventId: 'x', date: '2026-02-30', images: [], tags: [] }, 'moment'), null);
  assert.equal(validateDocument({ eventId: 'x', date: '2026-02-03', time: '26:00', images: [], tags: [] }, 'moment'), null);
  assert.ok(validateDocument({ eventId: 'x', date: '2026-02-28', images: [], tags: [] }, 'moment'));
  assert.ok(validateDocument({ eventId: 'x', date: '2026-02-28T09:30:00Z', images: [], tags: [] }, 'moment'));
  assert.equal(validateDocument({ eventId: 'x', date: '2026-02-30T09:30:00Z', images: [], tags: [] }, 'moment'), null);
});

test('authenticated API integration with owner isolation and R2 prefix', { timeout: 120000 }, async t => {
  if (process.env.RUN_INTEGRATION !== '1') return t.skip('Set RUN_INTEGRATION=1 for DB/R2-backed API integration');
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const origin = base;
  async function request(path, { method='GET', token, body, headers={}, multipart }={}) {
    const h = { ...headers };
    if (['POST','PUT','DELETE'].includes(method)) h.Origin = origin;
    if (token) h.Cookie = `memento_session=${token}`;
    if (multipart) body = multipart;
    else if (body !== undefined) { h['Content-Type']='application/json'; body=JSON.stringify(body); }
    const res=await fetch(base+path,{method,headers:h,body});
    const type=res.headers.get('content-type')||'';
    const data=type.includes('application/json')?await res.json():await res.arrayBuffer();
    return {res,data};
  }
  const username = `test_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`;
  const secondUsername = `test_${crypto.randomUUID().replaceAll('-','').slice(0,20)}`;
  let token, token2, userId, userId2, trackId, momentId, imageId, inviteHash1, inviteHash2;
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
    const sessionRow=await pool.query('SELECT token_hash,expires_at FROM "memento_dev".sessions WHERE user_id=$1',[userId]);assert.notEqual(sessionRow.rows[0].token_hash,token);assert.ok(new Date(sessionRow.rows[0].expires_at)>new Date());
    const track=(await request('/api/tracks',{method:'POST',token,body:{title:'Test track',description:'',color:'indigo',icon:'Cpu',tags:[]}}));
    assert.equal(track.res.status,201); trackId=track.data.track.id;
    assert.equal((await request('/api/tracks',{token})).data.tracks.length,1);
    const updatedTrack=await request('/api/tracks/'+trackId,{method:'PUT',token,body:{description:'changed'}});assert.equal(updatedTrack.res.status,200);assert.equal(updatedTrack.data.track.description,'changed');
    const moment=await request('/api/moments',{method:'POST',token,body:{eventId:trackId,title:'API moment',date:'2026-09-24',time:'10:30',description:'',tags:[],images:[]}});
    assert.equal(moment.res.status,201);momentId=moment.data.moment.id;
    const secondInvite=await createInvite(1); inviteHash2=hashInvite(secondInvite);
    const registered2=await request('/api/auth/register',{method:'POST',body:{username:secondUsername,password:'a-very-long-test-password-2',inviteCode:secondInvite}});assert.equal(registered2.res.status,200);userId2=registered2.data.user.id;
    token2=registered2.res.headers.get('set-cookie').match(/memento_session=([^;]+)/)[1];
    assert.equal((await request('/api/tracks',{token:token2})).data.tracks.length,0);
    assert.equal((await request('/api/moments',{token:token2})).data.moments.length,0);
    assert.equal((await request('/api/tracks/'+trackId,{method:'PUT',token:token2,body:{title:'intrusion'}})).res.status,404);
    const form=new FormData();form.set('momentId',momentId);form.set('file',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lqkAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'test.png');
    const uploaded=await request('/api/images',{method:'POST',token,multipart:form});assert.equal(uploaded.res.status,201);imageId=uploaded.data.image.id;assert.match(uploaded.data.image.url,/^\/api\/images\//);
    const stored=await pool.query('SELECT object_key FROM "memento_dev".images WHERE id=$1',[imageId]);assert.ok(stored.rows[0].object_key.startsWith('memento_dev/'));
    const moments=await request('/api/moments',{token});assert.deepEqual(moments.data.moments[0].images,[`/api/images/${imageId}`]);
    const updatedMoment=await request(`/api/moments/${momentId}`,{method:'PUT',token,body:{description:'updated through API'}});assert.equal(updatedMoment.res.status,200);assert.equal(updatedMoment.data.moment.description,'updated through API');assert.deepEqual(updatedMoment.data.moment.images,[`/api/images/${imageId}`]);
    assert.equal((await request(`/api/moments/${momentId}`,{method:'DELETE',token:token2})).res.status,404);
    const fetched=await request(`/api/images/${imageId}`,{token});assert.equal(fetched.res.status,200);assert.equal(fetched.res.headers.get('content-type'),'image/png');assert.ok(fetched.data.byteLength>0);
    assert.equal((await request(`/api/images/${imageId}`,{token:token2})).res.status,404);
    const tag=await request('/api/tags',{method:'POST',token,body:{tag:'verified'}});assert.equal(tag.res.status,201);
    assert.deepEqual((await request('/api/tags',{token})).data.tags,['verified']);
    assert.equal((await request('/api/tags/verified',{method:'DELETE',token})).res.status,200);
    assert.equal((await request(`/api/images/${imageId}`,{method:'DELETE',token})).res.status,200);imageId=undefined;
    assert.equal((await request('/api/moments/'+momentId,{method:'DELETE',token})).res.status,200);momentId=undefined;
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
    if(userId) await pool.query('DELETE FROM "memento_dev".users WHERE id=$1',[userId]).catch(()=>{});
    if(userId2) await pool.query('DELETE FROM "memento_dev".users WHERE id=$1',[userId2]).catch(()=>{});
    if(inviteHash1) await pool.query('DELETE FROM "memento_dev".invites WHERE code_hash=$1',[inviteHash1]).catch(()=>{});
    if(inviteHash2) await pool.query('DELETE FROM "memento_dev".invites WHERE code_hash=$1',[inviteHash2]).catch(()=>{});
    await new Promise(resolve=>server.close(resolve));
  }
});
