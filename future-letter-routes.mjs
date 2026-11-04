import {randomUUID} from 'node:crypto';
import {ApiError,asyncHandler,transaction,expectedVersion} from './mutation-safety.mjs';
import {storyHash,storyOperationKey,uuid} from './story-validation.mjs';
import {validateLetter,validateLetterSchedule} from './future-letter-validation.mjs';
import {readLetter,queryLetters,letterMissing,validateLetterLinks,replaceLetterPhotos} from './future-letter-queries.mjs';
export function mountFutureLetterRoutes(app,{auth,pool,qschema:q}){
 const schema=q.replaceAll('"','');if(!['memento_dev','memento'].includes(schema))throw new Error('Invalid letter schema');
 app.use('/api/future-letters',(_req,res,next)=>{res.set('Cache-Control','no-store');next();});
 const route=(method,path,fn)=>app[method]('/api/future-letters'+path,auth,asyncHandler(async(req,res)=>res.json(await fn(req))));
 route('post','/query',r=>queryLetters(pool,r.user.id,r.body,q));
 route('get','/summary',async r=>(await pool.query(`SELECT count(*) FILTER(WHERE opened_at IS NULL AND sealed_at IS NOT NULL AND release_at<=clock_timestamp())::int AS "readyCount",min(release_at) FILTER(WHERE opened_at IS NULL AND sealed_at IS NOT NULL AND release_at>clock_timestamp()) AS "nextReleaseAt",clock_timestamp() AS "serverNow" FROM ${q}.future_letters WHERE owner_id=$1`,[r.user.id])).rows[0]);
 route('get','/:id',r=>readLetter(pool,r.user.id,r.params.id,q));
 async function operation(c,r,kind,id,hash,key,work){
  const {rows:[op]}=await c.query(`SELECT * FROM ${q}.letter_create_operations WHERE actor_id=$1 AND operation_key=$2`,[r.user.id,key]);
  if(op){if(op.kind!==kind||op.payload_hash!==hash||(id&&op.letter_id!==id))throw new ApiError(409,'Operation identity changed');if(op.deleted_at)throw new ApiError(410,'Letter was deleted');return readLetter(c,r.user.id,op.letter_id,q);}
  const result=await work();await c.query(`INSERT INTO ${q}.letter_create_operations(actor_id,operation_key,kind,payload_hash,letter_id) VALUES($1,$2,$3,$4,$5)`,[r.user.id,key,kind,hash,result.letter.id]);return result;
 }
 route('post','',async r=>{const v=validateLetter(r.body),key=storyOperationKey(r.get('Idempotency-Key'));return transaction(pool,c=>operation(c,r,'create',null,storyHash(v),key,async()=>{const id=randomUUID();await validateLetterLinks(c,r.user.id,v.photos,q);await c.query(`INSERT INTO ${q}.future_letters(id,owner_id,title,body,release_at,timezone) VALUES($1,$2,$3,$4,$5,$6)`,[id,r.user.id,v.title,v.body,v.releaseAt,v.timezone]);await replaceLetterPhotos(c,r.user.id,id,v.photos,q);return readLetter(c,r.user.id,id,q);}),r.user.id,schema);});
 for(const kind of ['put','delete','seal','open'])route(['seal','open'].includes(kind)?'post':kind,'/:id'+(['seal','open'].includes(kind)?'/'+kind:''),async r=>{
  if(!uuid(r.params.id))letterMissing();const version=kind==='open'?null:expectedVersion(r),v=kind==='put'?validateLetter(r.body):kind==='seal'?validateLetterSchedule(r.body):null;
  if(['seal','open'].includes(kind)&&(!r.body||Object.keys(r.body).some(k=>!(kind==='open'?['operationId']:['operationId','expectedVersion','releaseAt','timezone','localTime','offsetMinutes']).includes(k))))throw new ApiError(400,'Invalid letter operation');
  const key=['seal','open'].includes(kind)?storyOperationKey(r.body.operationId):null;
  return transaction(pool,async c=>{
   const work=async()=>{
    const {rows:[old]}=await c.query(`SELECT *,release_at<=clock_timestamp() AS due FROM ${q}.future_letters WHERE owner_id=$1 AND id=$2`,[r.user.id,r.params.id]);if(!old)letterMissing();
    if(kind==='open'){
     if(!old.sealed_at||!old.due)throw new ApiError(409,'Letter is not ready',{code:'LETTER_NOT_READY'});
     if(!old.opened_at)await c.query(`UPDATE ${q}.future_letters SET opened_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp() WHERE id=$1`,[old.id]);
    }else{
     if(old.version!==version)throw new ApiError(409,'Letter changed; reload before saving');
     if(kind==='delete'){await c.query(`DELETE FROM ${q}.future_letters WHERE id=$1`,[old.id]);return {ok:true};}
     if(old.sealed_at)throw new ApiError(409,'Sealed letter cannot be changed');
     if(kind==='put'){await validateLetterLinks(c,r.user.id,v.photos,q);await replaceLetterPhotos(c,r.user.id,old.id,v.photos,q);await c.query(`UPDATE ${q}.future_letters SET title=$2,body=$3,release_at=$4,timezone=$5,version=version+1,updated_at=clock_timestamp() WHERE id=$1`,[old.id,v.title,v.body,v.releaseAt,v.timezone]);}
     if(kind==='seal'){
      if(!old.body.trim())throw new ApiError(400,'Letter body required before sealing');
      const photos=(await c.query(`SELECT moment_id AS "momentId",image_id AS "imageId" FROM ${q}.future_letter_photos WHERE letter_id=$1`,[old.id])).rows;await validateLetterLinks(c,r.user.id,photos,q);
      const result=await c.query(`UPDATE ${q}.future_letters SET sealed_at=clock_timestamp(),release_at=$2,timezone=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1 AND $2::timestamptz>clock_timestamp()`,[old.id,v.releaseAt,v.timezone]);if(!result.rowCount)throw new ApiError(400,'Opening time must be in the future');
     }
    }
    return readLetter(c,r.user.id,old.id,q);
   };
   return key?operation(c,r,kind,r.params.id,storyHash({id:r.params.id,kind,version,...v}),key,work):work();
  },r.user.id,schema);
 });
}
