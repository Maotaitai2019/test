import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root=path.dirname(fileURLToPath(import.meta.url));
const catalog=JSON.parse(await readFile(path.join(root,'restaurants.json'),'utf8'));
const choices=new Set(catalog.map(r=>r.id));
const commonHeaders={'X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin'};
class HttpError extends Error{constructor(status,message){super(message);this.status=status;}}
function send(res,data,status=200,extra={}){res.writeHead(status,{...commonHeaders,'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store, max-age=0',...extra});res.end(JSON.stringify(data));}
function actor(req,secure){const old=/(?:^|;\s*)dinner_voter=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie||'')?.[1];const token=old||randomBytes(32).toString('hex');return {hash:createHash('sha256').update(token).digest('hex'),cookie:old?null:`dinner_voter=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure?'; Secure':''}`};}
async function body(req){
  if(Number(req.headers['content-length'])>2048)throw new HttpError(413,'内容过长。');
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>2048)throw new HttpError(413,'内容过长。');chunks.push(chunk);}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new HttpError(400,'提交格式不正确。');}
  if(!data||typeof data!=='object'||Array.isArray(data))throw new HttpError(400,'提交格式不正确。');
  const nickname=typeof data.nickname==='string'?data.nickname.trim():'';
  if(!nickname||Array.from(nickname).length>24||/[\u0000-\u001f\u007f]/.test(nickname))throw new HttpError(400,'请填写1—24个字的昵称。');
  if(!choices.has(data.restaurantId))throw new HttpError(400,'请选择列表中的餐厅。');
  if(typeof data.requestId!=='string'||!/^[a-f0-9-]{36}$/.test(data.requestId))throw new HttpError(400,'提交标识不正确，请刷新重试。');
  return {...data,nickname};
}
export async function createApp(pool,{publicOrigin,staticDir=path.join(root,'dist')}={}){
  await pool.query(await readFile(path.join(root,'schema.sql'),'utf8'));
  const configuredOrigin=publicOrigin?new URL(publicOrigin).origin:null;
  return http.createServer(async(req,res)=>{
    try{
      const origin=configuredOrigin||`http://${req.headers.host}`;
      const url=new URL(req.url,origin);
      if(url.pathname==='/healthz'){
        if(req.method!=='GET'&&req.method!=='HEAD')return send(res,{error:'不支持的方法。'},405,{Allow:'GET, HEAD'});
        await pool.query('SELECT 1');return send(res,{ok:true});
      }
      if(url.pathname==='/api/poll'){
        if(!['GET','POST'].includes(req.method))return send(res,{error:'不支持的方法。'},405,{Allow:'GET, POST'});
        if(req.method==='POST'&&req.headers.origin!==origin)return send(res,{error:'请从投票页面提交。'},403);
        if(req.method==='POST'&&!req.headers['content-type']?.startsWith('application/json'))return send(res,{error:'提交格式不正确。'},415);
        const user=actor(req,origin.startsWith('https:'));const cookie=user.cookie?{'Set-Cookie':user.cookie}:{};
        const input=req.method==='POST'?await body(req):null;
        const db=await pool.connect();
        try{
          if(req.method==='GET'){
            const rawBefore=Number(url.searchParams.get('before'));
            const before=Number.isSafeInteger(rawBefore)&&rawBefore>0?rawBefore:Number.MAX_SAFE_INTEGER;
            await db.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
            const counts=(await db.query('SELECT restaurant_id, COUNT(*)::int AS count FROM votes GROUP BY restaurant_id')).rows;
            const mine=(await db.query('SELECT nickname,restaurant_id,updated_at FROM votes WHERE voter_hash=$1',[user.hash])).rows[0]||null;
            const rows=(await db.query('SELECT id,nickname,restaurant_id,action,created_at FROM vote_events WHERE id<$1 ORDER BY id DESC LIMIT 31',[before])).rows.map(e=>({...e,id:Number(e.id),created_at:Number(e.created_at)}));
            if(mine)mine.updated_at=Number(mine.updated_at);
            await db.query('COMMIT');const events=rows.slice(0,30);const hasMore=rows.length>30;
            return send(res,{counts,mine,events,hasMore,nextBefore:hasMore?events.at(-1).id:null,checkedAt:Date.now()},200,cookie);
          }
          await db.query('BEGIN');
          // Serialize one browser's changes across service instances and overlapping requests.
          await db.query('SELECT pg_advisory_xact_lock($1)',[BigInt('0x'+user.hash.slice(0,15)).toString()]);
          const prior=(await db.query('SELECT voter_hash FROM vote_events WHERE request_id=$1',[input.requestId])).rows[0];
          if(prior){if(prior.voter_hash!==user.hash)throw new HttpError(409,'请重新提交。');await db.query('COMMIT');return send(res,{ok:true},200,cookie);}
          const recent=(await db.query('SELECT COUNT(*)::int AS count FROM vote_events WHERE voter_hash=$1 AND created_at>$2',[user.hash,Date.now()-60000])).rows[0];
          if(recent.count>=6)throw new HttpError(429,'刚才改票有点频繁，等一分钟再试吧。');
          const mine=(await db.query('SELECT nickname,restaurant_id FROM votes WHERE voter_hash=$1',[user.hash])).rows[0];
          if(mine?.nickname===input.nickname&&mine.restaurant_id===input.restaurantId){await db.query('COMMIT');return send(res,{ok:true,unchanged:true},200,cookie);}
          const now=Date.now();
          await db.query('INSERT INTO vote_events(request_id,voter_hash,nickname,restaurant_id,action,created_at) VALUES($1,$2,$3,$4,$5,$6)',[input.requestId,user.hash,input.nickname,input.restaurantId,mine?'change':'vote',now]);
          await db.query('INSERT INTO votes(voter_hash,nickname,restaurant_id,created_at,updated_at) VALUES($1,$2,$3,$4,$4) ON CONFLICT(voter_hash) DO UPDATE SET nickname=excluded.nickname,restaurant_id=excluded.restaurant_id,updated_at=excluded.updated_at',[user.hash,input.nickname,input.restaurantId,now]);
          await db.query('COMMIT');return send(res,{ok:true},200,cookie);
        }catch(error){try{await db.query('ROLLBACK');}catch{}if(error.code==='23505')throw new HttpError(409,'提交正在处理，请刷新查看记录。');throw error;}finally{db.release();}
      }
      if(!['GET','HEAD'].includes(req.method))return send(res,{error:'不支持的方法。'},405,{Allow:'GET, HEAD'});
      let pathname;try{pathname=decodeURIComponent(url.pathname);}catch{throw new HttpError(400,'地址不正确。');}
      const target=path.resolve(staticDir,'.'+pathname);
      if(!target.startsWith(path.resolve(staticDir)+path.sep)&&target!==path.resolve(staticDir))throw new HttpError(404,'页面不存在。');
      const filename=pathname==='/'?path.join(staticDir,'index.html'):target;
      const info=await stat(filename).catch(()=>null);if(!info?.isFile())throw new HttpError(404,'页面不存在。');
      const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg','.ico':'image/x-icon','.json':'application/json; charset=utf-8'}[path.extname(filename)]||'application/octet-stream';
      res.writeHead(200,{...commonHeaders,'Content-Type':mime,'Content-Length':info.size,'Cache-Control':pathname.startsWith('/assets/')?'public, max-age=31536000, immutable':'no-cache'});
      if(req.method==='HEAD')return res.end();createReadStream(filename).on('error',()=>res.destroy()).pipe(res);
    }catch(error){if(!res.headersSent)send(res,{error:error instanceof HttpError?error.message:'暂时连不上投票记录，请稍后重试。'},error instanceof HttpError?error.status:503);else res.destroy();if(!(error instanceof HttpError))console.error('Application error:',error.code||error.name);}
  });
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required. Use the Render Postgres internal connection string.');
  const {default:pg}=await import('pg');const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:5,connectionTimeoutMillis:15000,idleTimeoutMillis:30000});
  pool.on('error',error=>console.error('Database connection error:',error.code||error.name));
  const server=await createApp(pool,{publicOrigin:process.env.PUBLIC_ORIGIN||process.env.RENDER_EXTERNAL_URL});
  server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('Dinner poll is listening.'));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(async()=>{await pool.end();process.exit(0);}));
}
