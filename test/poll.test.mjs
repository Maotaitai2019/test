import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
const catalog=JSON.parse(await readFile(new URL('../restaurants.json',import.meta.url),'utf8'));
test('all catalog choices have cropped covers and verified distance provenance',async()=>{
  assert.equal(catalog.length,75);assert.equal(new Set(catalog.map(r=>r.id)).size,75);
  for(const r of catalog){const file=new URL('../public'+r.cover,import.meta.url);assert.ok((await stat(file)).size>1000);const bytes=await readFile(file);assert.equal(bytes.toString('ascii',1,4),'PNG');assert.ok(bytes.readUInt32BE(16)<=300);assert.ok(bytes.readUInt32BE(20)<=240);if(r.distance!==null){assert.ok(r.distance>0);assert.ok(r.minutes>0);assert.ok(r.source.startsWith('https://map.baidu.com/'));}}
  assert.equal(catalog.find(r=>r.id==='fantuan').branch,'玉林店');
  assert.equal(catalog.find(r=>r.id==='heiyang').branch,'玉林店');
  assert.equal(catalog.find(r=>r.id==='feng').branch,'文殊院店');
});
