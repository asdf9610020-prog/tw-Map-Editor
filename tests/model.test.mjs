import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {clone,validateMap,paint,walkPredicate,findPath,resizeMap,serializeDraft,deserializeDraft,exportMap,deriveNavigation,createAssetMap} from '../web/model.mjs';
const catalog=JSON.parse(fs.readFileSync(new URL('../web/data/catalog.json',import.meta.url),'utf8'));
const sample=JSON.parse(fs.readFileSync(new URL('../web/data/riverbank-template.json',import.meta.url),'utf8'));

test('tile studies preserve geometry anchors and sample cell centers without a half-cell shift',()=>{
  const asset={id:'test-ground',name:'test',sizeM:[2.5,2.5],boundsXZ:[-2.5,-2.5,0,0],navigationKind:'ground-surface-preview',localNavigation:[[-2.375,-2.375,1.25],[-2.125,-2.375,1.3]]};
  const d=createAssetMap(asset);validateMap(d,{assets:[asset]});assert.equal(d.grid.width,512);assert.deepEqual(d.tiles[0],{id:'study-tile',assetId:asset.id,x:42,y:42,height:0,yaw:0,scale:1});
  assert.equal(d.collision.flags[32*512+32],0);assert.equal(d.collision.heights[32*512+32],1.25);assert.equal(d.collision.flags[32*512+33],0);assert.equal(d.collision.flags[32*512+34],2);assert.equal(d.provenance.originalLayoutComplete,false);assert.equal(d.acceptance.runtimeIntegrated,false);
});

test('a decoration without navigable ground never fabricates a spawn or collision',()=>{
  const d=createAssetMap({id:'stump',name:'stump',sizeM:[2.5,2.5],localNavigation:[],navigationKind:'ground-surface-preview'});assert.equal(d.entities.length,0);assert.ok(d.collision.flags.every(f=>f===2));
});

test('public demo has a valid schema and a reachable portal',()=>{
  validateMap(sample,catalog);const [a,b]=sample.entities;assert.ok(findPath(sample,[a.x,a.y],[b.x,b.y]).length);
});
test('walk attributes preserve non-blocking bits and reject native boundaries',()=>{
  const d=clone(sample);d.collision.flags[0]=128;paint(d,0,0,true);assert.equal(d.collision.flags[0],130);
  paint(d,0,0,false);assert.equal(d.collision.flags[0],128);assert.ok(walkPredicate(d,3,3).accepted);assert.equal(walkPredicate(d,-1,0).code,1);assert.equal(walkPredicate(d,2048,0).code,1);
});
test('expanding a map retains source row positions, markers and other bits',()=>{
  const d=clone(sample),tiles=clone(d.tiles),entities=clone(d.entities);d.collision.flags[70*512+60]=129;d.collision.heights[70*512+60]=1.125;
  resizeMap(d,1024,1024);assert.deepEqual(d.tiles,tiles);assert.deepEqual(d.entities,entities);assert.equal(d.collision.flags[70*1024+60],129);assert.equal(d.collision.heights[70*1024+60],1.125);assert.equal(d.collision.flags.at(-1),2);validateMap(d,catalog);
});
test('shrinking through an object and exceeding the maximum are rejected',()=>{
  const d=clone(sample);assert.throws(()=>resizeMap(d,8,8));assert.throws(()=>resizeMap(d,1025,512));
});
test('large and legacy drafts round-trip without losing precision',()=>{
  const d=clone(sample);resizeMap(d,1024,1024);d.collision.heights[900*1024+900]=-1.23456789012345;d.entities.push({id:'far-npc',type:'npc',name:'Far marker',x:900,y:900,templateId:''});
  validateMap(d,catalog);const encoded=serializeDraft(d);assert.deepEqual(deserializeDraft(encoded),d);assert.ok(encoded.length*2<5*1024*1024);assert.deepEqual(deserializeDraft(JSON.stringify(d)),d);
});
test('height differences and blocked seams affect route previews',()=>{
  const d=clone(sample);resizeMap(d,512,512);const a=[60,60],b=[64,60];d.collision.heights[60*512+64]=10;assert.equal(findPath(d,a,b).length,0);
  d.collision.heights[60*512+64]=0;assert.ok(findPath(d,a,b).length);
});
test('derived navigation respects yaw and height',()=>{
  const d=clone(sample);d.tiles=[{id:'yaw',assetId:'test',x:40,y:40,height:3,yaw:90,scale:1}];deriveNavigation(d,{assets:[{id:'test',localNavigation:[[1,0,2]]}]});assert.equal(d.collision.flags[36*512+40],0);assert.equal(d.collision.heights[36*512+40],5);
});
test('export resets gameplay claims while preserving authored content',()=>{
  const d=clone(sample);d.acceptance={runtimeIntegrated:true};const exported=exportMap(d,catalog);validateMap(exported,catalog);assert.equal(exported.acceptance.runtimeIntegrated,false);assert.deepEqual(exported.tiles,d.tiles);assert.deepEqual(exported.collision,d.collision);
});
