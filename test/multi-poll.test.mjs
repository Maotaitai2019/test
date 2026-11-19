import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createApp} from '../server.mjs';
const catalog=JSON.parse(await readFile(new URL('../restaurants.json',import.meta.url),'utf8'));

async function harness(seed,{publicOrigin}={}){
  const database=new PGlite();if(seed)await seed(database);
  let queue=Promise.resolve(),server,base;
  const query=async(sql,params)=>sql.includes(';')&&!params?database.exec(sql):database.query(sql,params);
  const pool={query,async connect(){let release;const next=new Promise(r=>release=r);const previous=queue;queue=next;await previous;return {query,release};}};
  async function restart(){if(server)await new Promise(r=>server.close(r));server=await createApp(pool,{publicOrigin});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;}
  await restart();
  const get=async(cookie='',suffix='')=>{const r=await fetch(base+'/api/poll'+suffix,{headers:{cookie}});assert.equal(r.status,200);return r.json();};
  const visitor=async()=>{const r=await fetch(base+'/api/poll');assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];};
  async function submit(cookie,restaurantId,action='add',{nickname='同一位朋友',requestId=randomUUID(),origin=publicOrigin||base}={}){
    const r=await fetch(base+'/api/poll',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify({nickname,restaurantId,action,requestId})});
    return {status:r.status,body:await r.json()};
  }
  return {database,get,visitor,submit,restart,url:()=>base,close:async()=>{await new Promise(r=>server.close(r));await database.close();}};
}

test('legacy vote survives multi-choice migration, additional choices, withdrawals and restart',async()=>{
  const token='a'.repeat(64),hash=createHash('sha256').update(token).digest('hex');
  const h=await harness(async db=>{
    await db.exec(`CREATE TABLE votes(voter_hash TEXT PRIMARY KEY,nickname TEXT NOT NULL,restaurant_id TEXT NOT NULL,created_at BIGINT NOT NULL,updated_at BIGINT NOT NULL);
      CREATE TABLE vote_events(id BIGSERIAL PRIMARY KEY,request_id TEXT NOT NULL UNIQUE,voter_hash TEXT NOT NULL,nickname TEXT NOT NULL,restaurant_id TEXT NOT NULL,action TEXT NOT NULL,created_at BIGINT NOT NULL);`);
    await db.query('INSERT INTO votes VALUES($1,$2,$3,$4,$4)',[hash,'原来的朋友','ziwei',1]);
    await db.query('INSERT INTO vote_events(request_id,voter_hash,nickname,restaurant_id,action,created_at) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),hash,'原来的朋友','ziwei','vote',1]);
  });
  const cookie='dinner_voter='+token;
  try{
    let d=await h.get(cookie);assert.equal(d.mode,'multi');assert.equal(d.totalVotes,1);assert.equal(d.participants,1);assert.equal(d.mySelections[0].restaurant_id,'ziwei');assert.equal(d.events.length,1);
    assert.equal((await h.submit(cookie,'fantuan')).status,200);
    d=await h.get(cookie);assert.deepEqual(new Set(d.mySelections.map(v=>v.restaurant_id)),new Set(['ziwei','fantuan']));assert.equal(d.totalVotes,2);assert.equal(d.participants,1);
    const duplicate=await h.submit(cookie,'fantuan');assert.equal(duplicate.body.unchanged,true);assert.equal((await h.get(cookie)).events.length,2);
    assert.equal((await h.submit(cookie,'ziwei','remove')).status,200);
    d=await h.get(cookie);assert.deepEqual(d.mySelections.map(v=>v.restaurant_id),['fantuan']);assert.equal(d.totalVotes,1);assert.equal(d.events[0].action,'withdraw');
    assert.equal((await h.submit(cookie,'fantuan','add',{nickname:'更新后的昵称'})).status,200);
    d=await h.get(cookie);assert.equal(d.totalVotes,1);assert.equal(d.mySelections[0].nickname,'更新后的昵称');assert.equal(d.events[0].action,'rename');
    await h.restart();d=await h.get(cookie);assert.deepEqual(d.mySelections.map(v=>v.restaurant_id),['fantuan']);assert.equal(d.events.length,4);
    assert.equal((await h.database.query('SELECT COUNT(*)::int AS n FROM votes')).rows[0].n,1,'legacy source was retained');
    const concurrent=await Promise.all(Array.from({length:3},()=>h.submit(cookie,'cycle','add',{nickname:'更新后的昵称'})));
    assert.ok(concurrent.every(r=>r.status===200));d=await h.get(cookie);assert.equal(d.totalVotes,2);assert.equal(d.events.length,5);
    await Promise.all([h.submit(cookie,'fantuan','remove'),h.submit(cookie,'fantuan','remove')]);
    d=await h.get(cookie);assert.deepEqual(d.mySelections.map(v=>v.restaurant_id),['cycle']);assert.equal(d.events.length,6);
    const other=await h.visitor();assert.equal((await h.submit(other,'cycle','remove')).body.unchanged,true);assert.equal((await h.get(cookie)).totalVotes,1);
    const key=randomUUID();assert.equal((await h.submit(other,'bai','add',{requestId:key})).status,200);
    assert.equal((await h.submit(other,'bai','add',{requestId:key})).status,200);
    assert.equal((await h.submit(other,'bai','remove',{requestId:key})).status,409);
    assert.equal((await h.submit(cookie,'bai','add',{requestId:key})).status,409);
    assert.equal((await h.submit(other,'bai','remove')).status,200);
    d=await h.get(other);assert.equal(d.mySelections.length,0);assert.equal(d.participants,1);assert.equal(d.totalVotes,1);
    await h.restart();assert.equal((await h.get(other)).mySelections.length,0);
  }finally{await h.close();}
});

test('one actor can select every restaurant; concurrent users, pagination and restart stay consistent',async()=>{
  const h=await harness();
  try{
    const cookie=await h.visitor();
    const replies=await Promise.all(catalog.map(r=>h.submit(cookie,r.id)));
    assert.ok(replies.every(r=>r.status===200),JSON.stringify(replies.filter(r=>r.status!==200)));
    let d=await h.get(cookie);assert.equal(d.mySelections.length,75);assert.equal(d.totalVotes,75);assert.equal(d.participants,1);assert.ok(d.counts.every(c=>c.count===1));
    const others=await Promise.all(Array.from({length:40},()=>h.visitor()));
    const more=await Promise.all(others.map((c,i)=>h.submit(c,catalog[i].id)));
    assert.ok(more.every(r=>r.status===200));d=await h.get(cookie);assert.equal(d.totalVotes,115);assert.equal(d.participants,41);assert.equal(d.events.length,30);
    const ids=new Set(d.events.map(e=>e.id));let before=d.nextBefore;
    while(before){const page=await h.get(cookie,'?before='+before);for(const e of page.events){assert.ok(!ids.has(e.id));ids.add(e.id);}before=page.nextBefore;}
    assert.equal(ids.size,115);
    const withdrawal=await h.submit(cookie,'ziwei','remove');assert.equal(withdrawal.status,200);
    await h.restart();d=await h.get(cookie);assert.equal(d.mySelections.length,74);assert.equal(d.totalVotes,114);assert.equal(d.participants,41);
    const shared=await h.get();assert.equal(shared.totalVotes,114);assert.equal(shared.mine,null);assert.deepEqual(shared.mySelections,[]);
    assert.equal((await h.submit(cookie,'missing')).status,400);
    assert.equal((await h.submit(cookie,'fantuan','invalid')).status,400);
    assert.equal((await h.submit(cookie,'fantuan','add',{nickname:''})).status,400);
    assert.equal((await h.submit(cookie,'fantuan','add',{origin:'https://other.test'})).status,403);
  }finally{await h.close();}
});

test('HTTPS proxy origin, health and secure identity cookie',async()=>{
  const h=await harness(null,{publicOrigin:'https://dinner.example.test'});
  try{
    const r=await fetch(h.url()+'/api/poll');assert.match(r.headers.get('set-cookie'),/; Secure/);
    const cookie=r.headers.get('set-cookie').split(';')[0];
    assert.equal((await h.submit(cookie,'chengqiang')).status,200);
    assert.equal((await h.submit(cookie,'chengqiang','add',{origin:h.url()})).status,403);
    assert.equal((await fetch(h.url()+'/healthz')).status,200);
    assert.equal((await fetch(h.url()+'/')).status,200);
  }finally{await h.close();}
});
