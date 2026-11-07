import { randomUUID } from 'node:crypto';
import { ApiError, asyncHandler, transaction, expectedVersion } from './mutation-safety.mjs';
import { validateStory, storyOperationKey, storyHash, uuid } from './story-validation.mjs';
import { queryStories, readStory, validateStoryLinks, replaceStoryItems } from './story-queries.mjs';
export function mountStoryRoutes(app,{auth,pool,qschema:q,safeMoment}){
 const schema=q.replaceAll('"','');if(!['memento_dev','memento'].includes(schema))throw new Error('Invalid story schema');
 app.use('/api/stories',(req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const respond=(res,value)=>res.set('Cache-Control','no-store').json(value);
 app.post('/api/stories/query',auth,asyncHandler(async(req,res)=>respond(res,await queryStories(pool,req.user.id,req.body,q))));
 app.get('/api/stories/:id',auth,asyncHandler(async(req,res)=>respond(res,await readStory(pool,req.user.id,req.params.id,q,safeMoment))));
 app.post('/api/stories',auth,asyncHandler(async(req,res)=>{
  const value=validateStory(req.body),key=storyOperationKey(req.get('Idempotency-Key')),hash=storyHash(value);
  const result=await transaction(pool,async c=>{
   const {rows:[op]}=await c.query(`SELECT * FROM ${q}.story_create_operations WHERE actor_id=$1 AND operation_key=$2`,[req.user.id,key]);
   if(op){if(op.payload_hash!==hash)throw new ApiError(409,'Request key already used with different content');if(op.deleted_at)throw new ApiError(410,'Story was deleted');return readStory(c,req.user.id,op.story_id,q,safeMoment);}
   await validateStoryLinks(c,req.user.id,value,q);const id=randomUUID();
   await c.query(`INSERT INTO ${q}.stories(id,owner_id,track_id,title,opening,closing) VALUES($1,$2,$3,$4,$5,$6)`,[id,req.user.id,value.trackId,value.title,value.opening,value.closing]);
   await replaceStoryItems(c,id,req.user.id,value.items,q);
   await c.query(`INSERT INTO ${q}.story_create_operations(actor_id,operation_key,payload_hash,story_id) VALUES($1,$2,$3,$4)`,[req.user.id,key,hash,id]);
   return readStory(c,req.user.id,id,q,safeMoment);
  },req.user.id,schema);respond(res,result);
 }));
 for(const method of ['put','delete']) app[method]('/api/stories/:id',auth,asyncHandler(async(req,res)=>{
  if(!uuid(req.params.id))throw new ApiError(404,'Story not found');const version=expectedVersion(req),value=method==='put'?validateStory(req.body):null;
  const result=await transaction(pool,async c=>{
   const {rows:[old]}=await c.query(`SELECT * FROM ${q}.stories WHERE id=$1 AND owner_id=$2`,[req.params.id,req.user.id]);
   if(!old)throw new ApiError(404,'Story not found');if(old.version!==version)throw new ApiError(409,'Story changed; reload before saving');
   if(method==='delete'){await c.query(`DELETE FROM ${q}.stories WHERE id=$1`,[old.id]);return {ok:true};}
   if(value.trackId!==old.track_id)throw new ApiError(400,'Story track cannot be changed');
   await validateStoryLinks(c,req.user.id,value,q,old.id);
   await c.query(`UPDATE ${q}.stories SET title=$2,opening=$3,closing=$4,version=version+1,updated_at=clock_timestamp() WHERE id=$1`,[old.id,value.title,value.opening,value.closing]);
   await replaceStoryItems(c,old.id,req.user.id,value.items,q);return readStory(c,req.user.id,old.id,q,safeMoment);
  },req.user.id,schema);respond(res,result);
 }));
}
