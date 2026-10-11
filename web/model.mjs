// Isolated authored format. Not a native d2m encoder or a game-server database.
export const SCHEMA = 'twremake.authored-map.v1';
export const DEFAULT_MAP_SIDE = 512;
export const MAX_MAP_SIDE = 1024;
export const clone = v => structuredClone(v);
export function resizeMap(map, width, height) {
  if (![width,height].every(n=>Number.isInteger(n) && n>=8 && n<=MAX_MAP_SIDE)) throw Error(`尺寸須為 8–${MAX_MAP_SIDE} 格`);
  if ([...map.tiles,...map.entities].some(o=>o.x>=width || o.y>=height)) throw Error('有物件位於新尺寸之外，請先移動或移除');
  const {width:oldWidth,height:oldHeight}=map.grid;
  if (width===oldWidth && height===oldHeight) return map;
  const flags=Array(width*height).fill(2),heights=Array(width*height).fill(0);
  for(let y=0;y<Math.min(height,oldHeight);y++) for(let x=0;x<Math.min(width,oldWidth);x++) {
    flags[y*width+x]=map.collision.flags[y*oldWidth+x];
    heights[y*width+x]=map.collision.heights[y*oldWidth+x];
  }
  Object.assign(map.grid,{width,height});Object.assign(map.collision,{flags,heights});return map;
}
// Compact local drafts keep a mostly empty large canvas within browser storage limits.
// Downloaded / saved projects still use the full, portable authored-map schema.
export function serializeDraft(map) {
  const flagsRle=[],heightsSparse=[],flags=map.collision.flags;
  for(let i=0;i<flags.length;) {const value=flags[i],start=i;while(i<flags.length && flags[i]===value)i++;flagsRle.push(value,i-start);}
  for(let i=0;i<map.collision.heights.length;i++) if(map.collision.heights[i]!==0) heightsSparse.push(i,map.collision.heights[i]);
  return JSON.stringify({draftSchema:'twremake.editor-draft.v2',map:{...map,collision:{...map.collision,flags:undefined,heights:undefined,flagsRle,heightsSparse}}});
}
export function deserializeDraft(text) {
  const d=JSON.parse(text);if(d.draftSchema!=='twremake.editor-draft.v2')return d;
  const map=d.map,g=map?.grid,c=map?.collision;
  if(!g || ![g.width,g.height].every(n=>Number.isInteger(n) && n>=8 && n<=MAX_MAP_SIDE) || !Array.isArray(c?.flagsRle) || !Array.isArray(c.heightsSparse) || c.flagsRle.length%2 || c.heightsSparse.length%2)throw Error('本機草稿資料損壞');
  const length=g.width*g.height,flags=Array(length),heights=Array(length).fill(0);let offset=0;
  for(let i=0;i<c.flagsRle.length;i+=2) {
    const value=c.flagsRle[i],count=c.flagsRle[i+1];
    if(!Number.isInteger(value) || value<0 || value>255 || !Number.isInteger(count) || count<1 || offset+count>length)throw Error('草稿通行位元資料損壞');
    flags.fill(value,offset,offset+count);offset+=count;
  }
  if(offset!==length)throw Error('草稿通行位元長度不符');
  for(let i=0;i<c.heightsSparse.length;i+=2) {
    const index=c.heightsSparse[i],value=c.heightsSparse[i+1];
    if(!Number.isInteger(index) || index<0 || index>=length || !Number.isFinite(value) || Math.abs(value)>1000)throw Error('草稿高度資料損壞');
    heights[index]=value;
  }
  delete c.flagsRle;delete c.heightsSparse;Object.assign(c,{flags,heights});return map;
}
export function validateMap(d, catalogue) {
  const fail = s => { throw Error(s); };
  if (!d || d.schema !== SCHEMA) fail('不支援的地圖格式');
  if (typeof d.name !== 'string' || d.name.length > 120 || typeof d.id !== 'string' || d.id.length > 80) fail('地圖名稱或編號無效');
  const g = d.grid;
  if (!g || !Number.isInteger(g.width) || !Number.isInteger(g.height) || g.width < 8 || g.height < 8 || g.width > MAX_MAP_SIDE || g.height > MAX_MAP_SIDE) fail(`地圖尺寸須介於 8–${MAX_MAP_SIDE} 格`);
  if (g.coordinateUnitsPerCell !== 4 || g.blockedMask !== 2 || g.blockGroupSize !== 13 || !(g.cellMeters >= .1 && g.cellMeters <= 5)) fail('868 座標與通行規則不相符');
  if (!Array.isArray(d.collision?.flags) || d.collision.flags.length !== g.width*g.height || !d.collision.flags.every(x => Number.isInteger(x) && x >= 0 && x <= 255)) fail('通行位元資料損壞');
  if (!Array.isArray(d.collision.heights) || d.collision.heights.length !== g.width*g.height || !d.collision.heights.every(x => Number.isFinite(x) && Math.abs(x) <= 1000)) fail('高度資料損壞');
  if (!Array.isArray(d.tiles) || d.tiles.length > 500 || !Array.isArray(d.entities) || d.entities.length > 2000) fail('物件數量超出限制');
  const ids = new Set(), assets = new Set(catalogue.assets.map(a => a.id));
  for (const obj of [...d.tiles, ...d.entities]) {
    if (typeof obj.id !== 'string' || ids.has(obj.id)) fail('物件編號重複'); ids.add(obj.id);
    if (![obj.x,obj.y].every(x=>Number.isFinite(x) && x>=0 && x<MAX_MAP_SIDE)) fail('物件座標無效');
    if (obj.x>=g.width || obj.y>=g.height) fail('物件位於地圖外');
    if (obj.assetId) {
      if (!assets.has(obj.assetId)) fail('找不到地形模組：'+obj.assetId);
      if (!Number.isFinite(obj.yaw) || !Number.isFinite(obj.height) || Math.abs(obj.height)>1000 || !Number.isFinite(obj.scale) || !(obj.scale>=.25 && obj.scale<=4)) fail('地形變換無效');
    } else {
      if (!['spawn','portal','npc','monster'].includes(obj.type) || typeof obj.name !== 'string' || obj.name.length>120) fail('物件類型或名稱無效');
      if (obj.type === 'portal' && ['targetWorld','targetTerrain','targetRegion'].some(k=>!Number.isInteger(obj[k])||obj[k]<0||obj[k]>999999)) fail('出口目標無效');
    }
  }
  return d;
}
export function walkPredicate(map, x, y, resourcePresent=true) {
  const g=map.grid;
  if (!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=g.width*4||y>=g.height*4) return {accepted:false,code:1};
  if (!resourcePresent) return {accepted:false,code:2};
  const cx=x>>>2, cy=y>>>2, flag=map.collision.flags[cy*g.width+cx];
  if (flag === undefined) return {accepted:false,code:3};
  return {accepted:!(flag&2),code:flag&2?4:0,cell:[cx,cy]};
}
export function paint(map, x, y, blocked, radius=1) {
  const g=map.grid, changed=[];
  for(let dy=-radius+1;dy<radius;dy++) for(let dx=-radius+1;dx<radius;dx++) {
    const cx=x+dx,cy=y+dy;
    if(cx<0||cy<0||cx>=g.width||cy>=g.height)continue;
    const i=cy*g.width+cx,old=map.collision.flags[i];
    map.collision.flags[i]=blocked?(old|2):(old&~2); if(old!==map.collision.flags[i])changed.push(i);
  }
  return changed;
}
export function findPath(map,start,end) {
  const {width:w,height:h}=map.grid, index=([x,y])=>y*w+x, a=index(start), b=index(end);
  if(!walkPredicate(map,start[0]*4,start[1]*4).accepted || !walkPredicate(map,end[0]*4,end[1]*4).accepted)return [];
  const prev=new Int32Array(w*h).fill(-1), queue=[a];prev[a]=a;
  for(let head=0;head<queue.length;head++) {
    const v=queue[head];if(v===b)break;
    const x=v%w,y=Math.floor(v/w);
    // Deliberately 4-way editor preview; native diagonal path sorting is unresolved.
    for(const [cx,cy]of[[x+1,y],[x-1,y],[x,y+1],[x,y-1]]) {
      const n=cy*w+cx;
      if(cx<0||cy<0||cx>=w||cy>=h||prev[n]!==-1||map.collision.flags[n]&2)continue;
      if(Math.abs(map.collision.heights[n]-map.collision.heights[v])>.45)continue;
      prev[n]=v;queue.push(n);
    }
  }
  if(prev[b]===-1)return [];
  const path=[];for(let v=b;;v=prev[v]){path.push([v%w,Math.floor(v/w)]);if(v===a)break;}return path.reverse();
}
export function deriveNavigation(map,catalogue) {
  const g=map.grid;map.collision.flags.fill(2);map.collision.heights.fill(0);
  for(const tile of map.tiles) {
    const a=catalogue.assets.find(a=>a.id===tile.assetId),r=tile.yaw*Math.PI/180,c=Math.cos(r),s=Math.sin(r);
    for(const [x,z,h]of a.localNavigation) {
      const cx=Math.round(tile.x+(c*x+s*z)*tile.scale/g.cellMeters),cy=Math.round(tile.y+(-s*x+c*z)*tile.scale/g.cellMeters);
      if(cx<0||cy<0||cx>=g.width||cy>=g.height)continue;
      const i=cy*g.width+cx;map.collision.flags[i]&=~2;map.collision.heights[i]=h*tile.scale+tile.height;
    }
  }
  map.collision.provenance='Authored union of transformed PoE mesh-derived cells; manual review required for overlaps and seams';
}
export function checkMap(map) {
  const issues=[],spawn=map.entities.filter(e=>e.type==='spawn');
  if(spawn.length!==1)issues.push('需有一個起始出生點');
  for(const e of map.entities) {
    if(!walkPredicate(map,Math.floor(e.x)*4,Math.floor(e.y)*4).accepted)issues.push(`${e.name} 位於阻擋格`);
    if(e.type==='portal'&&spawn.length===1&&!findPath(map,[Math.floor(spawn[0].x),Math.floor(spawn[0].y)],[Math.floor(e.x),Math.floor(e.y)]).length)issues.push(`${e.name} 無法從出生點走到`);
  }
  if(!map.entities.some(e=>e.type==='portal'))issues.push('尚未放置出口');
  return issues;
}
export function exportMap(map,catalogue) {
  const d=clone(map);validateMap(d,catalogue);
  d.updatedUTC=new Date().toISOString();d.acceptance={editorOnly:true,desktopGameplayAccepted:false,browserGameplayAccepted:false,runtimeIntegrated:false};
  d.assetManifest=[...new Set(d.tiles.map(t=>t.assetId))].map(id=>{const a=catalogue.assets.find(a=>a.id===id);return{id,model:a.model,source:a.source,preview:a.preview,geometryBuffersUnchanged:a.geometryBuffersUnchanged,textureMax:a.textureMax};});
  d.coordinateContract={cellToNative:[4,4],metresToCell:1/d.grid.cellMeters,axis:'PoE glTF X,Z -> authored cell X,Y',note:'Explicit new-map adapter; native pixel projection and original .d2m writer not claimed'};
  d.validation={issues:checkMap(d),pathPreview:'editor-only four-way BFS with .45m step limit'};
  return d;
}
