import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {clone,validateMap,walkPredicate,paint,findPath,deriveNavigation,checkMap,exportMap,resizeMap,serializeDraft,deserializeDraft,createAssetMap,DEFAULT_MAP_SIDE,MAX_MAP_SIDE,SCHEMA} from './model.mjs';

const $=id=>document.getElementById(id), esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const [catalogue,template]=await Promise.all(['data/catalog.json','data/riverbank-template.json'].map(async p=>{const r=await fetch(p);if(!r.ok)throw Error(`讀取失敗 ${p}`);return r.json();}));
const libraryResponse=await fetch('data/map-library.json');
const mapLibrary=libraryResponse.ok?await libraryResponse.json():{maps:[]};
resizeMap(template,DEFAULT_MAP_SIDE,DEFAULT_MAP_SIDE);
const requestedProject=new URLSearchParams(location.search).get('project');
const requestedTemplate=new URLSearchParams(location.search).get('template');
const draftKey=requestedProject?'jp868-map-editor-draft-v1:project:'+requestedProject:requestedTemplate?'jp868-map-editor-draft-v1:template:'+requestedTemplate:'jp868-map-editor-draft-v1';
let map=clone(template),tool='select',assetId=catalogue.assets[0].id,selected=null,undo=[],redo=[],stroke=null,drag=null,dirty=false,savingTimer,toastTimer,modelEpoch=0,ready=false;
let pathGroup=new THREE.Group(),tileGroup=new THREE.Group(),entityGroup=new THREE.Group(),selectionGroup=new THREE.Group(),overlay,gridMesh;
const cache=new Map(),pending=new Map(),loader=new GLTFLoader(),scene=new THREE.Scene();scene.background=new THREE.Color('#111c20');
const canvas=$('scene'), renderer=new THREE.WebGLRenderer({canvas,antialias:true,alpha:false,preserveDrawingBuffer:true});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.6;
const camera=new THREE.OrthographicCamera(-30,30,30,-30,.1,1000);camera.position.set(70,90,70);
const controls=new OrbitControls(camera,canvas);controls.enableRotate=false;controls.enableDamping=false;controls.mouseButtons={LEFT:null,MIDDLE:THREE.MOUSE.PAN,RIGHT:THREE.MOUSE.PAN};controls.zoomSpeed=1.2;controls.minZoom=.2;controls.maxZoom=30;
scene.add(new THREE.HemisphereLight(0xd1e5ef,0x7a6952,2));const light=new THREE.DirectionalLight(0xffecd1,2.4);light.position.set(-40,70,-30);scene.add(light);
scene.add(tileGroup,entityGroup,selectionGroup,pathGroup);
const plane=new THREE.Plane(new THREE.Vector3(0,1,0),0),ray=new THREE.Raycaster(),cursor=new THREE.Vector2();
const hover=new THREE.Mesh(new THREE.PlaneGeometry(1,1),new THREE.MeshBasicMaterial({color:0xa8e9b9,transparent:true,opacity:.5,side:THREE.DoubleSide,depthTest:false}));hover.rotation.x=-Math.PI/2;hover.visible=false;hover.renderOrder=20;scene.add(hover);
const objectById=id=>map.tiles.find(t=>t.id===id)||map.entities.find(e=>e.id===id);
const uid=kind=>`${kind}-${crypto.randomUUID().slice(0,8)}`;
function toast(s){$('toast').textContent=s;$('toast').classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.remove('show'),4200);}
function info(title,body){$('infoTitle').textContent=title;$('infoBody').textContent=body;$('info').showModal();}
function markDirty(){dirty=true;$('saveState').textContent='正在保存本機草稿…';clearTimeout(savingTimer);savingTimer=setTimeout(()=>{try{localStorage.setItem(draftKey,serializeDraft(map));$('saveState').textContent='修改已保存至本機草稿';}catch{$('saveState').textContent='本機草稿未保存';toast('本機空間不足，請使用「保存專案」');}},350);}
function checkpoint(){undo.push(clone(map));if(undo.length>30)undo.shift();redo=[];updateHistory();}
function mutate(fn,full=true){checkpoint();fn();selected=selected&&objectById(selected)?selected:null;markDirty();refresh(full);}
function updateHistory(){$('undo').disabled=!undo.length;$('redo').disabled=!redo.length;}
function history(direction){const from=direction==='undo'?undo:redo,to=direction==='undo'?redo:undo;if(!from.length)return;to.push(clone(map));map=from.pop();selected=null;markDirty();refresh(true);updateHistory();}
function updateMeta(){
  $('name').value=map.name;$('mapId').value=map.id;$('width').value=map.grid.width;$('height').value=map.grid.height;
  $('mapTitle').textContent=map.name;$('mapSize').textContent=`${map.grid.width} × ${map.grid.height} 格 · ${map.grid.width*map.grid.cellMeters} × ${map.grid.height*map.grid.cellMeters} m`;
  $('mapExtent').textContent=`實際範圍 ${map.grid.width*map.grid.cellMeters} × ${map.grid.height*map.grid.cellMeters} 公尺；上限 ${MAX_MAP_SIDE} 格。擴張會保留物件位置與原通行格。`;
  const count=map.collision.flags.reduce((n,f)=>n+(!(f&2)?1:0),0);$('stats').textContent=`${map.tiles.length} 地形 · ${map.entities.length} 物件 · ${count.toLocaleString()} 可通行格`;
}
function listObjects(){
  $('objectCount').textContent=map.tiles.length+map.entities.length;
  $('objects').innerHTML=[...map.entities,...map.tiles].map(o=>`<button class="object ${o.id===selected?'selected':''}" data-id="${esc(o.id)}">${({spawn:'⚑',portal:'⇥',npc:'♙',monster:'♟'})[o.type]||'▧'} ${esc(o.name||catalogue.assets.find(a=>a.id===o.assetId)?.name||o.id)}</button>`).join('');
  $('objects').querySelectorAll('button').forEach(b=>b.onclick=()=>select(b.dataset.id));
}
function renderLibrary(){
  const filter=$('search').value.trim().toLowerCase(),category=$('category').value,assets=catalogue.assets.filter(a=>(!category||a.category===category)&&`${a.id} ${a.name} ${a.canonicalSource||''}`.toLowerCase().includes(filter));$('assetCount').textContent=`${assets.length} / ${catalogue.assets.length} 模組`;
  $('assets').innerHTML=assets.map(a=>`<button class="asset ${a.id===assetId?'selected':''}" data-asset="${a.id}" title="${esc(a.canonicalSource||a.id)}"><div class="asset-visual"><img loading="lazy" src="${esc(a.thumbnail||`thumbnails/${a.id}.png`)}" alt="${esc(a.name)}模型預覽"></div><span>${esc(a.name)}<br><small>${a.sizeM.join(' × ')} m</small></span></button>`).join('');
  $('assets').querySelectorAll('button').forEach(b=>b.onclick=()=>{assetId=b.dataset.asset;setTool('terrain');renderLibrary();});
  const asset=catalogue.assets.find(a=>a.id===assetId);$('assetDetails').textContent=`${asset.name} · ${asset.navigationKind==='ground-surface-preview'?'地面三角形通行預覽，需檢查障礙與水面':'研究版通行資料'}${asset.sourceMaterialStatus?' · 地面材質尚待還原':''}`;
}
function inspector(){
  const o=objectById(selected);if(!o){$('selection').innerHTML='<p class="muted">點選畫布或場景清單中的物件</p>';return;}
  const a=o.assetId?catalogue.assets.find(a=>a.id===o.assetId):null;
  $('selection').innerHTML=`<b>${esc(a?.name||o.name)}</b>${o.type?`<label>名稱<input data-prop="name" value="${esc(o.name)}" maxlength="120"></label>`:''}<div class="inline"><label>X（格）<input data-prop="x" type="number" min="0" max="${map.grid.width-1}" step="1" value="${o.x}"></label><label>Y（格）<input data-prop="y" type="number" min="0" max="${map.grid.height-1}" step="1" value="${o.y}"></label></div>${a?`<label>旋轉角度<input data-prop="yaw" type="number" step="90" value="${o.yaw}"></label><label>高度（m）<input data-prop="height" type="number" step="0.25" min="-1000" max="1000" value="${o.height}"></label><label>縮放<input data-prop="scale" type="number" step="0.25" min="0.25" max="4" value="${o.scale}"></label><button id="rotateObject">旋轉 90°</button><button id="copyObject">複製</button>`:''}${o.type==='portal'?`<label>目的世界<select id="targetWorld"><option value="${o.targetWorld}">世界 ${o.targetWorld}</option>${catalogue.worlds.map(w=>`<option value="${w.id}">${w.id} · ${esc(w.name)}</option>`).join('')}</select></label><div class="inline"><label>地形編號<input data-prop="targetTerrain" type="number" min="0" max="999999" value="${o.targetTerrain}"></label><label>目的區域<input data-prop="targetRegion" type="number" min="0" max="999999" value="${o.targetRegion}"></label></div><p class="small muted">區域與世界依 868 出口結構。新增出口屬設計資料，尚未寫入遊戲伺服器。</p>`:''}${['npc','monster'].includes(o.type)?`<label>模板編號<input data-prop="templateId" value="${esc(o.templateId||'')}" maxlength="80"></label><p class="small muted">請填入後續要綁定的遊戲模板編號。</p>`:''}<button id="deleteObject" class="danger">移除物件</button>`;
  $('selection').querySelectorAll('[data-prop]').forEach(input=>input.onchange=()=>{
    const prop=input.dataset.prop,value=['name','templateId'].includes(prop)?input.value:Number(input.value);
    if(typeof value==='number'&&(!Number.isFinite(value)||(prop==='x'&&(value<0||value>=map.grid.width))||(prop==='y'&&(value<0||value>=map.grid.height))||(prop==='scale'&&(value<.25||value>4))||(prop==='height'&&Math.abs(value)>1000)||(['targetTerrain','targetRegion'].includes(prop)&&(!Number.isInteger(value)||value<0||value>999999)))){toast('數值超出可用範圍');inspector();return;}
    mutate(()=>o[prop]=value);
  });
  if(a){$('rotateObject').onclick=()=>rotate();$('copyObject').onclick=()=>copy();}
  if(o.type==='portal'){$('targetWorld').value=String(o.targetWorld);$('targetWorld').onchange=()=>mutate(()=>{o.targetWorld=Number($('targetWorld').value);const w=catalogue.worlds.find(w=>w.id===o.targetWorld);if(w?.terrains.length)o.targetTerrain=w.terrains[0];});}
  $('deleteObject').onclick=()=>remove();
}
function select(id){selected=id;listObjects();inspector();drawSelection();}
function clearGroup(group,dispose=false){
  for(const obj of [...group.children]){group.remove(obj);if(dispose)obj.traverse(o=>{o.geometry?.dispose();if(o.material){for(const m of Array.isArray(o.material)?o.material:[o.material])m.dispose();}});}
}
async function assetModel(id){
  if(cache.has(id))return cache.get(id);if(pending.has(id))return pending.get(id);
  const a=catalogue.assets.find(a=>a.id===id),p=loader.loadAsync(a.model).then(g=>{g.scene.traverse(o=>{if(o.isMesh){o.castShadow=false;o.receiveShadow=false;o.frustumCulled=true;}});cache.set(id,g.scene);pending.delete(id);return g.scene;}).catch(e=>{pending.delete(id);throw e;});pending.set(id,p);return p;
}
function applyTransform(object,tile){object.position.set(tile.x*map.grid.cellMeters,tile.height,tile.y*map.grid.cellMeters);object.rotation.y=tile.yaw*Math.PI/180;object.scale.setScalar(tile.scale);object.userData.tileId=tile.id;object.traverse(o=>o.userData.tileId=tile.id);}
async function drawTiles(){
  const epoch=++modelEpoch;clearGroup(tileGroup);ready=false;$('loading').hidden=false;
  const rows=[...map.tiles];let done=0,errors=0;
  // Bounded sequential loading avoids eight simultaneous source texture decodes.
  for(const t of rows){
    if(epoch!==modelEpoch)return;
    $('loading').textContent=`讀取 ${catalogue.assets.find(a=>a.id===t.assetId)?.name} · ${++done} / ${rows.length}`;
    try{const original=await assetModel(t.assetId);if(epoch!==modelEpoch)return;const model=original.clone(true);applyTransform(model,t);model.traverse(o=>{if(o.isMesh)o.visible=$('props').checked||isGround(o);});tileGroup.add(model);}catch(e){errors++;console.error(e);}
  }
  if(epoch!==modelEpoch)return;ready=true;$('loading').hidden=true;drawSelection();
  if(errors)toast(`${errors} 個地形讀取失敗，請查看來源檔`);window.editor.lastModelErrors=errors;
}
function drawGrid(){
  if(gridMesh){scene.remove(gridMesh);gridMesh.geometry.dispose();gridMesh.material.dispose();}
  const g=map.grid,vertices=[],spacing=10;
  for(let x=0;x<=g.width;x+=spacing)vertices.push(x*g.cellMeters,.03,0,x*g.cellMeters,.03,g.height*g.cellMeters);
  for(let y=0;y<=g.height;y+=spacing)vertices.push(0,.03,y*g.cellMeters,g.width*g.cellMeters,.03,y*g.cellMeters);
  vertices.push(g.width*g.cellMeters,.03,0,g.width*g.cellMeters,.03,g.height*g.cellMeters,0,.03,g.height*g.cellMeters,g.width*g.cellMeters,.03,g.height*g.cellMeters);
  const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));
  gridMesh=new THREE.LineSegments(geometry,new THREE.LineBasicMaterial({color:0x9dbaa7,transparent:true,opacity:.17,depthTest:false}));gridMesh.visible=$('grid').checked;gridMesh.renderOrder=4;scene.add(gridMesh);
}
function drawCollision(){
  if(overlay){scene.remove(overlay);overlay.geometry.dispose();overlay.material.map.dispose();overlay.material.dispose();}
  const g=map.grid,data=new Uint8Array(g.width*g.height*4);
  for(let i=0;i<g.width*g.height;i++){const blocked=map.collision.flags[i]&2;data.set(blocked?[225,93,85,38]:[81,220,151,130],i*4);}
  const tex=new THREE.DataTexture(data,g.width,g.height,THREE.RGBAFormat);tex.needsUpdate=true;tex.magFilter=THREE.NearestFilter;tex.minFilter=THREE.NearestFilter;
  overlay=new THREE.Mesh(new THREE.PlaneGeometry(g.width*g.cellMeters,g.height*g.cellMeters),new THREE.MeshBasicMaterial({map:tex,transparent:true,side:THREE.DoubleSide,depthTest:false}));
  // Plane local +Y is transformed to -Z, so flip texture vertically.
  tex.flipY=true;overlay.rotation.x=-Math.PI/2;overlay.position.set(g.width*g.cellMeters/2,.12,g.height*g.cellMeters/2);overlay.visible=$('collision').checked;overlay.renderOrder=6;scene.add(overlay);
}
function drawEntities(){
  clearGroup(entityGroup,true);
  const colours={spawn:0x97dcae,portal:0xa793ec,npc:0x82c7ef,monster:0xe39777};
  for(const e of map.entities){
    const x=Math.floor(e.x),y=Math.floor(e.y),h=map.collision.heights[y*map.grid.width+x]||0,group=new THREE.Group();
    group.position.set((e.x+.5)*map.grid.cellMeters,h+.12,(e.y+.5)*map.grid.cellMeters);group.userData.entityId=e.id;
    const mat=new THREE.MeshBasicMaterial({color:colours[e.type],depthTest:false,transparent:true,opacity:.95});
    const marker=new THREE.Mesh(e.type==='portal'?new THREE.TorusGeometry(.35,.065,8,28):new THREE.ConeGeometry(.22,.7,5),mat);marker.position.y=.5;marker.renderOrder=12;marker.userData.entityId=e.id;group.add(marker);
    const ring=new THREE.Mesh(new THREE.RingGeometry(.28,.4,24),mat);ring.rotation.x=-Math.PI/2;ring.renderOrder=12;ring.userData.entityId=e.id;group.add(ring);entityGroup.add(group);
  }
}
function drawSelection(){
  clearGroup(selectionGroup,true);const t=objectById(selected);if(!t)return;
  if(t.assetId){const mesh=tileGroup.children.find(c=>c.userData.tileId===t.id);if(mesh){const box=new THREE.BoxHelper(mesh,0xb9edd0);box.material.depthTest=false;box.material.transparent=true;box.material.opacity=.7;box.renderOrder=15;selectionGroup.add(box);}}
  else{const geo=new THREE.RingGeometry(.48,.54,32),mat=new THREE.MeshBasicMaterial({color:0xffffff,depthTest:false,side:THREE.DoubleSide}),ring=new THREE.Mesh(geo,mat);ring.rotation.x=-Math.PI/2;ring.position.set((t.x+.5)*map.grid.cellMeters,.2,(t.y+.5)*map.grid.cellMeters);ring.renderOrder=16;selectionGroup.add(ring);}
}
function refresh(full=false){updateMeta();listObjects();inspector();drawEntities();drawCollision();drawGrid();if(full)drawTiles();else drawSelection();updateHistory();}
function fit(mode=$('top').classList.contains('active')?'top':'iso'){
  const size=Math.max(map.grid.width,map.grid.height)*map.grid.cellMeters,center=new THREE.Vector3(map.grid.width*map.grid.cellMeters/2,0,map.grid.height*map.grid.cellMeters/2);
  controls.target.copy(center);camera.position.copy(center).add(mode==='top'?new THREE.Vector3(0,120,.001):new THREE.Vector3(90,100,90));camera.zoom=1;camera.userData.span=size*(mode==='top'?.54:.6);resize();controls.update();
  $('top').classList.toggle('active',mode==='top');$('iso').classList.toggle('active',mode==='iso');
}
function resize(){const r=$('viewport').getBoundingClientRect(),aspect=r.width/r.height,half=camera.userData.span||38;camera.left=-half*aspect;camera.right=half*aspect;camera.top=half;camera.bottom=-half;camera.updateProjectionMatrix();renderer.setSize(r.width,r.height,false);}
new ResizeObserver(resize).observe($('viewport'));
function updateRay(e){const r=canvas.getBoundingClientRect();cursor.set((e.clientX-r.left)/r.width*2-1,-((e.clientY-r.top)/r.height)*2+1);ray.setFromCamera(cursor,camera);}
function cellAt(e){updateRay(e);const p=new THREE.Vector3();if(!ray.ray.intersectPlane(plane,p))return null;const x=Math.floor(p.x/map.grid.cellMeters),y=Math.floor(p.z/map.grid.cellMeters);if(x<0||y<0||x>=map.grid.width||y>=map.grid.height)return null;return{x,y,point:p};}
function hitAt(e){updateRay(e);const eh=ray.intersectObjects(entityGroup.children,true)[0];if(eh)return eh.object.userData.entityId;return ray.intersectObjects(tileGroup.children,true).find(h=>h.object.userData.tileId)?.object.userData.tileId||null;}
function setTool(value){tool=value;controls.enabled=true;$('tools').querySelectorAll('button').forEach(b=>b.classList.toggle('active',b.dataset.tool===tool));
  const hints={select:'選取後拖移 · R 旋轉 · Delete 移除 · 右鍵平移',terrain:'在畫布點一下放置地形 · R 旋轉選取地形',walk:'拖曳塗上可通行格 · 通行層已顯示',block:'拖曳塗上阻擋格 · 通行層已顯示',spawn:'點選可通行格放置起始出生點',portal:'點選放置出口，再於右側設定目的世界',npc:'點選放置 NPC 標記，再設定模板編號',monster:'點選放置怪物標記，再設定模板編號',test:'點選目的格，預覽從出生點出發的通行路線'};
  $('toolHint').textContent=hints[tool];if(['walk','block','test'].includes(tool)){$('collision').checked=true;if(overlay)overlay.visible=true;}
}
function rotate(){const o=objectById(selected);if(o?.assetId)mutate(()=>o.yaw=(o.yaw+90)%360);}
function copy(){const o=objectById(selected);if(!o?.assetId)return;mutate(()=>{const n=clone(o);n.id=uid('terrain');n.x=Math.min(map.grid.width-1,n.x+10);n.y=Math.min(map.grid.height-1,n.y+10);map.tiles.push(n);selected=n.id;});}
function remove(){if(!selected)return;mutate(()=>{map.tiles=map.tiles.filter(o=>o.id!==selected);map.entities=map.entities.filter(o=>o.id!==selected);selected=null;});}
function snap(n){const step=Number($('snap').value);return Math.round(n/step)*step;}
function moveTo(o,x,y){o.x=Math.min(map.grid.width-1,Math.max(0,snap(x)));o.y=Math.min(map.grid.height-1,Math.max(0,snap(y)));}
canvas.onpointerdown=e=>{
  if(e.button!==0||!ready)return;const c=cellAt(e);if(!c)return;
  if(tool==='select'){const hit=hitAt(e);select(hit);if(hit){checkpoint();const o=objectById(hit);drag={id:hit,origin:[c.x,c.y],position:[o.x,o.y]};canvas.setPointerCapture(e.pointerId);}}
  else if(tool==='terrain')mutate(()=>{const t={id:uid('terrain'),assetId,x:Math.min(map.grid.width-1,snap(c.x)),y:Math.min(map.grid.height-1,snap(c.y)),height:0,yaw:0,scale:1};map.tiles.push(t);selected=t.id;});
  else if(['walk','block'].includes(tool)){checkpoint();stroke=true;canvas.setPointerCapture(e.pointerId);paint(map,c.x,c.y,tool==='block',Number($('brush').value));markDirty();drawCollision();}
  else if(['spawn','portal','npc','monster'].includes(tool)){
    if(tool==='spawn'&&!walkPredicate(map,c.x*4,c.y*4).accepted){toast('出生點須放在可通行格；可先使用通行筆刷');return;}
    mutate(()=>{if(tool==='spawn')map.entities=map.entities.filter(e=>e.type!=='spawn');const o={id:uid(tool),type:tool,name:({spawn:'起始出生點',portal:'新出口',npc:'新 NPC',monster:'新怪物'})[tool],x:c.x,y:c.y};if(tool==='portal')Object.assign(o,{targetWorld:0,targetTerrain:83,targetRegion:0});if(['npc','monster'].includes(tool))o.templateId='';map.entities.push(o);selected=o.id;},false);
  }else if(tool==='test')testWalk([c.x,c.y]);
};
canvas.onpointermove=e=>{
  const c=cellAt(e);if(!c){hover.visible=false;return;}const g=map.grid;
  $('coords').textContent=`格 ${c.x}, ${c.y} · 868 ${c.x*4}, ${c.y*4}`;
  hover.visible=['terrain','walk','block','spawn','portal','npc','monster'].includes(tool);const radius=['walk','block'].includes(tool)?Number($('brush').value):1;
  hover.position.set((c.x+.5)*g.cellMeters,.18,(c.y+.5)*g.cellMeters);hover.scale.set((radius*2-1)*g.cellMeters,(radius*2-1)*g.cellMeters,1);hover.material.color.set(tool==='block'?0xe89f8c:0x9adbb4);
  if(stroke&&(e.buttons&1)){paint(map,c.x,c.y,tool==='block',radius);markDirty();drawCollision();}
  if(drag&&(e.buttons&1)){const o=objectById(drag.id);moveTo(o,drag.position[0]+c.x-drag.origin[0],drag.position[1]+c.y-drag.origin[1]);if(o.assetId){const model=tileGroup.children.find(t=>t.userData.tileId===o.id);if(model)applyTransform(model,o);}else drawEntities();drawSelection();markDirty();}
};
function finishGesture(){if(stroke||drag){stroke=null;drag=null;refresh(false);}}
canvas.onpointerup=finishGesture;canvas.onpointercancel=finishGesture;canvas.onlostpointercapture=finishGesture;canvas.oncontextmenu=e=>e.preventDefault();canvas.onpointerleave=()=>{hover.visible=false;};
function testWalk(end){
  clearGroup(pathGroup,true);const spawn=map.entities.find(e=>e.type==='spawn');if(!spawn){toast('請先放置出生點');return;}
  const path=findPath(map,[Math.floor(spawn.x),Math.floor(spawn.y)],end);if(!path.length){toast('找不到通行路線：檢查阻擋格或高度落差');return;}
  const points=path.map(([x,y])=>new THREE.Vector3((x+.5)*map.grid.cellMeters,(map.collision.heights[y*map.grid.width+x]||0)+.35,(y+.5)*map.grid.cellMeters));
  const line=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineBasicMaterial({color:0xf3d591,depthTest:false}));line.renderOrder=18;pathGroup.add(line);toast(`可通行：${path.length} 格（編輯器路線預覽）`);
}
function download(name,blob){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);}
async function saveSnapshot(d=map){const r=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(exportMap(d,catalogue))});if(!r.ok)throw Error((await r.json()).error||'保存失敗');return r.json();}
async function saveProject(){try{const result=await saveSnapshot();dirty=false;$('saveState').textContent='已保存 '+result.file;toast('專案已保存至獨立 maps 資料夾');return result;}catch(e){toast(e.message);}}
async function switchProject(query){
  try{await saveSnapshot();clearTimeout(savingTimer);localStorage.setItem(draftKey,serializeDraft(map));location.search=query;}catch(e){toast('切換未完成，現有地圖已保留：'+e.message);}
}
async function openMapLibrary(){
  try{const r=await fetch('/api/projects');if(!r.ok)throw Error('讀取保存專案失敗');const saved=(await r.json()).projects;
    $('mapChoices').innerHTML=`<optgroup label="研究區域與範例">${mapLibrary.maps.map(m=>`<option value="template:${esc(m.id)}">${esc(m.name)}</option>`).join('')}</optgroup><optgroup label="已保存專案">${saved.map(p=>`<option value="project:${esc(p.file)}">${esc(p.name)} · ${esc(p.modifiedUTC.slice(0,19))}</option>`).join('')}</optgroup>`;
    const describe=()=>{const value=$('mapChoices').value,m=mapLibrary.maps.find(m=>'template:'+m.id===value);$('mapDescription').textContent=m?m.description:'載入保存專案；其本機草稿會一併還原。';$('loadLibraryMap').disabled=!value;};$('mapChoices').onchange=describe;describe();$('mapsDialog').showModal();
  }catch(e){toast(e.message);}
}
function isGround(o){return o.name.toLowerCase().startsWith('ground')||o.userData.source_role==='ground'||o.parent?.userData.source_role==='ground';}
async function exportBundle(){try{const d=exportMap(map,catalogue),r=await fetch('/api/export',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});if(!r.ok)throw Error((await r.json()).error||'匯出失敗');download(`${safeName(map.id)}.twmap.zip`,await r.blob());toast('地圖包已匯出：專案、通行位元、素材與來源紀錄');}catch(e){toast(e.message);}}
function safeName(s){return s.replace(/[^a-zA-Z0-9_-]/g,'_').slice(0,70)||'new-map';}
function exportPng(){
  const previous=[gridMesh.visible,overlay.visible,entityGroup.visible,selectionGroup.visible,pathGroup.visible,hover.visible];gridMesh.visible=overlay.visible=entityGroup.visible=selectionGroup.visible=pathGroup.visible=hover.visible=false;
  renderer.render(scene,camera);canvas.toBlob(blob=>{if(blob)download(`${safeName(map.id)}-isometric.png`,blob);},'image/png');
  [gridMesh.visible,overlay.visible,entityGroup.visible,selectionGroup.visible,pathGroup.visible,hover.visible]=previous;renderer.render(scene,camera);toast('已匯出目前視角 PNG；可先置中或縮放取景');
}
function loadMap(d){validateMap(d,catalogue);checkpoint();map=clone(d);selected=null;clearGroup(pathGroup,true);markDirty();refresh(true);fit();}
function newMap(){
  const d=clone(template);d.id='new-map-'+Date.now().toString(36);d.name='未命名新地圖';d.tiles=[];d.entities=[];d.collision.flags.fill(2);d.collision.heights.fill(0);d.collision.provenance='empty authored map; all cells blocked until painted or derived';d.provenance.kind='new authored map';loadMap(d);setTool('terrain');toast('空白新地圖已建立，點选素材開始放置');
}
$('tools').querySelectorAll('button').forEach(b=>b.onclick=()=>setTool(b.dataset.tool));
$('category').innerHTML='<option value="">全部分類</option>'+[...new Set(catalogue.assets.map(a=>a.category).filter(Boolean))].sort().map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('');
$('category').onchange=renderLibrary;$('search').oninput=renderLibrary;$('undo').onclick=()=>history('undo');$('redo').onclick=()=>history('redo');$('iso').onclick=()=>fit('iso');$('top').onclick=()=>fit('top');$('fit').onclick=()=>fit();
$('maps').onclick=openMapLibrary;$('closeMaps').onclick=()=>$('mapsDialog').close();
$('loadLibraryMap').onclick=()=>{const [type,...rest]=$('mapChoices').value.split(':');if(!['template','project'].includes(type))return;switchProject('?'+type+'='+encodeURIComponent(rest.join(':')));};
$('assetMap').onclick=async()=>{try{await saveSnapshot();const d=createAssetMap(catalogue.assets.find(a=>a.id===assetId)),saved=await saveSnapshot(d);clearTimeout(savingTimer);localStorage.setItem(draftKey,serializeDraft(map));location.search='?project='+encodeURIComponent(saved.file);}catch(e){toast('地塊建圖失敗，現有地圖已保留：'+e.message);}};
$('grid').onchange=()=>gridMesh.visible=$('grid').checked;$('collision').onchange=()=>overlay.visible=$('collision').checked;
$('props').onchange=()=>tileGroup.traverse(o=>{if(o.isMesh)o.visible=$('props').checked||isGround(o);});
$('name').onchange=()=>mutate(()=>map.name=$('name').value||'未命名新地圖',false);$('mapId').onchange=()=>mutate(()=>map.id=$('mapId').value||'new-map',false);
$('resize').onclick=()=>{
  const w=Number($('width').value),h=Number($('height').value);if(!Number.isInteger(w)||!Number.isInteger(h)||w<8||h<8||w>MAX_MAP_SIDE||h>MAX_MAP_SIDE){toast(`尺寸須為 8–${MAX_MAP_SIDE} 格`);return;}
  if([...map.tiles,...map.entities].some(o=>o.x>=w||o.y>=h)){toast('有物件位於新尺寸之外，請先移動或移除');return;}
  mutate(()=>resizeMap(map,w,h));fit();toast(`已調整為 ${w*map.grid.cellMeters} × ${h*map.grid.cellMeters} 公尺`);
};
$('rebuild').onclick=()=>{mutate(()=>deriveNavigation(map,catalogue),false);toast('已重算通行區；重疊、接縫與新增地形請以筆刷及試走確認');};
$('validate').onclick=()=>{const issues=checkMap(map);info('地圖檢查',issues.length?issues.map(s=>'• '+s).join('\n'):'出生點、通行區與出口路線檢查通過。\n此為編輯器檢查，尚未完成遊戲接入驗收。');};
$('new').onclick=newMap;$('template').onclick=()=>{loadMap(template);toast('河岸範例已載入，可自由修改');};$('save').onclick=saveProject;$('export').onclick=exportBundle;$('png').onclick=exportPng;
$('import').onclick=()=>$('file').click();$('file').onchange=async()=>{const f=$('file').files[0];if(!f)return;try{if(f.size>64*1024*1024)throw Error('專案超過 64MB');loadMap(JSON.parse(await f.text()));toast('地圖專案已匯入');}catch(e){toast('匯入失敗：'+e.message);}finally{$('file').value='';}};
$('source').onclick=()=>info('素材與轉換來源',`${catalogue.kind||'本機匯入素材庫'}\n${catalogue.inputs.map(r=>`${r.path}\nSHA256 ${r.sha256}`).join('\n\n')}\n\n868：4 單位／格、0x02 阻擋、13×13 格分組。\n0.25m 對應一格是本工具的轉換政策。來源與推導通行資料保留於素材目錄。\n自製範例由 tools/make-demo.py 生成；本機素材依自己的來源紀錄顯示。\n尚未輸出原生 .d2m，尚未接入正式遊戲。`);
$('closeInfo').onclick=()=>$('info').close();
document.addEventListener('keydown',e=>{if(['INPUT','SELECT','TEXTAREA'].includes(document.activeElement.tagName)||$('info').open||$('mapsDialog').open)return;
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();history(e.shiftKey?'redo':'undo');}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='y'){e.preventDefault();history('redo');}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='s'){e.preventDefault();saveProject();}else if(e.key==='Delete')remove();else if(e.key.toLowerCase()==='r')rotate();else if(({v:'select',t:'terrain',w:'walk',b:'block'})[e.key.toLowerCase()])setTool(({v:'select',t:'terrain',w:'walk',b:'block'})[e.key.toLowerCase()]);});
window.editor={get map(){return map;},get ready(){return ready;},get selected(){return selected;},get tool(){return tool;},catalogue,mapLibrary,loadMap,walkPredicate,findPath,checkMap,exportMap,deriveNavigation,
  async thumbnail(id){
    const asset=catalogue.assets.find(a=>a.id===id),model=(await loader.loadAsync(asset.model)).scene,ss=new THREE.Scene();ss.background=null;ss.add(model);ss.add(new THREE.HemisphereLight(0xd1e5ef,0x7a6952,2));const ll=new THREE.DirectionalLight(0xffecd1,2.4);ll.position.set(-40,70,-30);ss.add(ll);
    const box=new THREE.Box3().setFromObject(model),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3()),span=Math.max(size.x,size.y,size.z)*.73,cc=new THREE.OrthographicCamera(-span,span,span,-span,.1,1000);cc.position.copy(center).add(new THREE.Vector3(90,100,90));cc.lookAt(center);
    const rr=new THREE.WebGLRenderer({antialias:true,alpha:true,preserveDrawingBuffer:true});rr.setSize(256,256);rr.outputColorSpace=THREE.SRGBColorSpace;rr.toneMapping=THREE.ACESFilmicToneMapping;rr.toneMappingExposure=1.6;rr.render(ss,cc);const data=rr.domElement.toDataURL('image/png');rr.dispose();
    const geometries=new Set(),materials=new Set(),textures=new Set();model.traverse(o=>{if(o.geometry)geometries.add(o.geometry);for(const material of o.material?(Array.isArray(o.material)?o.material:[o.material]):[]){materials.add(material);for(const value of Object.values(material))if(value?.isTexture)textures.add(value);}});for(const resource of [...geometries,...materials,...textures])resource.dispose();return data;
  },
  cellScreen(x,y){const p=new THREE.Vector3((x+.5)*map.grid.cellMeters,0,(y+.5)*map.grid.cellMeters).project(camera),r=canvas.getBoundingClientRect();return{x:r.left+(p.x+1)*r.width/2,y:r.top+(1-p.y)*r.height/2};},lastModelErrors:0};
if(requestedProject||requestedTemplate){
  try{
    let path;
    if(requestedProject){if(!/^[a-zA-Z0-9_-]+\.twmap\.json$/.test(requestedProject))throw Error('專案檔名無效');path='maps/'+encodeURIComponent(requestedProject);}
    else{path=mapLibrary.maps.find(m=>m.id===requestedTemplate)?.path;if(!path)throw Error('找不到地圖範例');}
    const response=await fetch(path);if(!response.ok)throw Error('找不到專案檔');
    const project=await response.json();validateMap(project,catalogue);map=project;$('saveState').textContent='已載入地圖';
  }catch(e){info('專案載入失敗',e.message);}
}
try{const draft=localStorage.getItem(draftKey);if(draft){const parsed=deserializeDraft(draft);validateMap(parsed,catalogue);map=parsed;$('saveState').textContent='已還原本機草稿';}}catch(e){console.warn('Draft ignored:',e.message);}
// Restore the active project draft first, including any camp placed by the author.
// Save an independent old-size copy before the initial map's one-time expansion.
if(requestedProject && map.id==='poe2-initial-riverbank-001' && map.editorCanvas?.revision!==2 && (map.grid.width<DEFAULT_MAP_SIDE || map.grid.height<DEFAULT_MAP_SIDE)) {
  try {
    const response=await fetch('/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(exportMap(map,catalogue))});
    if(!response.ok)throw Error((await response.json()).error||'原尺寸備份失敗');
    const backup=await response.json(),oldSize=[map.grid.width,map.grid.height];
    map.editorCanvas={revision:2,expandedFrom:oldSize,backupFile:backup.file,expandedAt:new Date().toISOString()};
    checkpoint();resizeMap(map,Math.max(DEFAULT_MAP_SIDE,map.grid.width),Math.max(DEFAULT_MAP_SIDE,map.grid.height));
    markDirty();toast('已擴大初始地圖並保存原尺寸備份；地形與標記位置保留');
  } catch(e) {info('擴大地圖未完成',e.message+'；現有地圖已保留，可稍後重新整理再試。');}
}
if(map.tiles.length)assetId=map.tiles[0].assetId;
if(map.provenance?.kind==='authored single-tile study')$('category').value=catalogue.assets.find(a=>a.id===assetId)?.category||'';
renderLibrary();refresh(true);fit('iso');setTool('select');
function frame(){requestAnimationFrame(frame);renderer.render(scene,camera);}frame();
