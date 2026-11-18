import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PGlite } from '@electric-sql/pglite';
import { createApp } from '../server.mjs';
import { readFile, stat } from 'node:fs/promises';
const catalog=JSON.parse(await readFile(new URL('../restaurants.json',import.meta.url),'utf8'));
test('shared PostgreSQL voting, changes, pagination and restart persistence',async()=>{
  const database=new PGlite();let queue=Promise.resolve();
  const query=async(sql,params)=>sql.includes(';')&&!params?database.exec(sql):database.query(sql,params);
  const pool={query,async connect(){let release;const next=new Promise(r=>release=r);const previous=queue;queue=next;await previous;return {query,release};}};
  let server=await createApp(pool);await new Promise(r=>server.listen(0,'127.0.0.1',r));let base='http://127.0.0.1:'+server.address().port;
  async function visitor(){const r=await fetch(base+'/api/poll');assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0];}
  async function state(cookie='',suffix=''){const r=await fetch(base+'/api/poll'+suffix,{headers:{cookie}});assert.equal(r.status,200);return r.json();}
  async function vote(cookie,payload,origin=base){const r=await fetch(base+'/api/poll',{method:'POST',headers:{cookie,origin,'content-type':'application/json'},body:JSON.stringify(payload)});return {status:r.status,body:await r.json()};}
  try{
    const r=await fetch(base+'/');assert.equal(r.status,200);assert.ok((await r.text()).includes('成都饭搭子'));
    const health=await fetch(base+'/healthz');assert.equal(health.status,200);
    const cookie=await visitor();const key=randomUUID();
    assert.equal((await vote(cookie,{nickname:'功能验证 A',restaurantId:'fantuan',requestId:key})).status,200);
    assert.equal((await vote(cookie,{nickname:'功能验证 A',restaurantId:'fantuan',requestId:key})).status,200);
    let d=await state(cookie);assert.equal(d.events.length,1);assert.equal(d.counts[0].count,1);
    assert.equal((await vote(cookie,{nickname:'功能验证 A',restaurantId:'bai',requestId:randomUUID()})).status,200);
    d=await state(cookie);assert.equal(d.mine.restaurant_id,'bai');assert.equal(d.counts.reduce((s,c)=>s+c.count,0),1);assert.equal(d.events.length,2);
    assert.equal((await vote(cookie,{nickname:'X',restaurantId:'missing',requestId:randomUUID()})).status,400);
    assert.equal((await vote(cookie,null)).status,400);
    assert.equal((await vote(cookie,{nickname:'X',restaurantId:'bai',requestId:randomUUID()},'https://other.test')).status,403);
    const people=await Promise.all(Array.from({length:40},visitor));
    const replies=await Promise.all(people.map((c,i)=>vote(c,{nickname:'参与者 '+i,restaurantId:catalog[i%catalog.length].id,requestId:randomUUID()})));
    assert.ok(replies.every(r=>r.status===200),JSON.stringify(replies.filter(r=>r.status!==200)));
    d=await state(cookie);assert.equal(d.counts.reduce((s,c)=>s+c.count,0),41);assert.equal(d.events.length,30);assert.equal(d.hasMore,true);
    const page2=await state(cookie,'?before='+d.nextBefore);assert.equal(page2.events.length,12);assert.equal(page2.hasMore,false);
    const before=d.mine.updated_at;await new Promise(r=>server.close(r));
    server=await createApp(pool);await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
    d=await state(cookie);assert.equal(d.counts.reduce((s,c)=>s+c.count,0),41);assert.equal(d.mine.updated_at,before);
    const fresh=await visitor();const sameRequest=randomUUID();const duplicate=await Promise.all(Array.from({length:3},()=>vote(fresh,{nickname:'并发同一票',restaurantId:'cycle',requestId:sameRequest})));
    assert.ok(duplicate.every(r=>r.status===200));d=await state(fresh);assert.equal(d.counts.reduce((s,c)=>s+c.count,0),42);
    await new Promise(r=>server.close(r));server=await createApp(pool,{publicOrigin:'https://dinner.example.test'});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
    const secure=await fetch(base+'/api/poll');assert.match(secure.headers.get('set-cookie'),/; Secure/);
    const session=secure.headers.get('set-cookie').split(';')[0];assert.equal((await vote(session,{nickname:'代理入口',restaurantId:'chengqiang',requestId:randomUUID()},'https://dinner.example.test')).status,200);
    assert.equal((await vote(session,{nickname:'跨站入口',restaurantId:'ziwei',requestId:randomUUID()})).status,403);
  }finally{await new Promise(r=>server.close(r));await database.close();}
});
test('all catalog choices have cropped covers and verified distance provenance',async()=>{
  assert.equal(catalog.length,75);assert.equal(new Set(catalog.map(r=>r.id)).size,75);
  for(const r of catalog){const file=new URL('../public'+r.cover,import.meta.url);assert.ok((await stat(file)).size>1000);const bytes=await readFile(file);assert.equal(bytes.toString('ascii',1,4),'PNG');assert.ok(bytes.readUInt32BE(16)<=300);assert.ok(bytes.readUInt32BE(20)<=240);if(r.distance!==null){assert.ok(r.distance>0);assert.ok(r.minutes>0);assert.ok(r.source.startsWith('https://map.baidu.com/'));}}
  assert.equal(catalog.find(r=>r.id==='fantuan').branch,'玉林店');
  assert.equal(catalog.find(r=>r.id==='heiyang').branch,'玉林店');
  assert.equal(catalog.find(r=>r.id==='feng').branch,'文殊院店');
});
