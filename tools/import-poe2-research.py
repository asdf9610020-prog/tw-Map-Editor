"""Import a verified PoE2 research export into a new, ignored local library.

Never writes into the research project or an existing library. Source geometry,
all LODs and packed fields remain byte-identical; external PNGs are embedded as
512px authoring previews. Ground-only samples are a design aid, not game collision.
"""
from pathlib import Path
from PIL import Image
import argparse, array, hashlib, html, io, json, math, os, struct, sys
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
EXPORT = 'artifacts/maps-first-g1-2-all210-portable-terrain-export-v09-attempt-2/all210-portable-terrain-records.json'
FAMILIES = {'slash':'林地斜切','slashriverbank':'斜岸河流','slash_woods':'林地邊界','oldforestwoods':'古老森林','new':'寬河變體','rottenforest':'腐木林','mudburrow':'泥穴','areatransitions':'區域過渡','woods_wideriver':'森林寬河','woods':'林間道路','broadleaf':'闊葉樹樁','clutter':'伐木雜物','connections':'河岸接合','road':'森林道路','lumbermill':'伐木營地','redvalewoods':'紅谷森林','shallowriver':'淺河','wideriver':'寬河','wideriver_narrowriver':'寬窄河交界'}

def read(p): return json.loads(p.read_text('utf-8-sig'))
def write(p,d): p.parent.mkdir(parents=True,exist_ok=True); p.write_text(json.dumps(d,ensure_ascii=False,separators=(',',':')),'utf-8')
def sha(b): return hashlib.sha256(b).hexdigest()
def pin(p): return {'path':p.name,'bytes':p.stat().st_size,'sha256':sha(p.read_bytes())}
def inside(root,rel):
    p=(root/rel).resolve()
    if not p.is_relative_to(root.resolve()): raise ValueError('Path leaves library: '+str(rel))
    return p

def unpack_glb(b):
    if struct.unpack_from('<III',b)[:2]!=(0x46546c67,2): raise ValueError('Unsupported GLB')
    n,tag=struct.unpack_from('<II',b,12)
    if tag!=0x4e4f534a: raise ValueError('GLB JSON missing')
    gl=json.loads(b[20:20+n]);bn,bt=struct.unpack_from('<II',b,20+n)
    if bt!=0x004e4942: raise ValueError('GLB BIN missing')
    return gl,b[28+n:28+n+bn]

def pack_glb(gl,binary):
    js=json.dumps(gl,separators=(',',':')).encode();js+=b' '*(-len(js)%4)
    return struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary

def preview(src,dest,root,expected=None,texture_cache=None):
    b=src.read_bytes()
    if expected and sha(b)!=expected: raise ValueError('Research GLB digest mismatch: '+src.name)
    gl,binary=unpack_glb(b);original=binary;out=bytearray(binary);textures=[]
    for im in gl.get('images',[]):
        if 'uri' in im:
            path=(src.parent/unquote(im['uri'])).resolve()
            if not path.is_relative_to(root.resolve()): raise ValueError('Texture leaves research root')
            raw=path.read_bytes();expected_png=im.get('extras',{}).get('PNG_sha256')
            if expected_png and sha(raw)!=expected_png: raise ValueError('PNG digest mismatch: '+path.name)
        else:
            v=gl['bufferViews'][im['bufferView']];raw=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']];path=None
        digest=sha(raw);cache=texture_cache if texture_cache is not None else {}
        if digest not in cache:
            with Image.open(io.BytesIO(raw)) as image:
                image=image.convert('RGBA');image.thumbnail((512,512));buf=io.BytesIO();image.save(buf,'PNG');cache[digest]=buf.getvalue()
        data=cache[digest]
        out.extend(b'\0'*(-len(out)%4));index=len(gl['bufferViews']);gl['bufferViews'].append({'buffer':0,'byteOffset':len(out),'byteLength':len(data)});out.extend(data)
        im.pop('uri',None);im['bufferView']=index;im['mimeType']='image/png'
        textures.append({'source':path.name if path else 'embedded','sourceSha256':digest,'previewSha256':sha(data)})
    out.extend(b'\0'*(-len(out)%4));gl['buffers']=[{'byteLength':len(out)}]
    gl['asset']['extras']={'source':pin(src),'previewTextureMax':512,'geometryBuffersUnchanged':True,'sourceBinaryPrefixSha256':sha(original)}
    dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(pack_glb(gl,out))
    assert out[:len(original)]==original
    return gl,original,{'source':pin(src),'preview':pin(dest),'geometryBuffersUnchanged':True,'sourceBinaryPrefixSha256':sha(original),'textures':textures}

def accessor(gl,binary,index):
    a=gl['accessors'][index];v=gl['bufferViews'][a['bufferView']];types={5126:('f',4),5125:('I',4),5123:('H',2),5121:('B',1)};fmt,size=types[a['componentType']];count={'SCALAR':1,'VEC3':3}[a['type']];stride=v.get('byteStride',count*size);offset=v.get('byteOffset',0)+a.get('byteOffset',0)
    if stride==count*size:
        data=array.array(fmt);data.frombytes(binary[offset:offset+a['count']*stride])
        if sys.byteorder!='little':data.byteswap()
        return data
    return [n for i in range(a['count'])for n in struct.unpack_from('<'+fmt*count,binary,offset+i*stride)]

def ground_samples(gl,binary):
    samples={};bounds=[math.inf,math.inf,-math.inf,-math.inf];scenes=gl.get('scenes',[]);nodes=gl.get('nodes',[])
    def visit(i,parent=(0,0,0)):
        n=nodes[i];t=n.get('translation',[0,0,0]);pos=tuple(parent[k]+t[k]for k in range(3))
        if 'rotation' in n or 'matrix' in n or n.get('scale',[1,1,1])!=[1,1,1]: raise ValueError('Unexpected node transform; cannot infer ground samples')
        if 'mesh' in n:
            mesh=gl['meshes'][n['mesh']]
            for p in mesh['primitives']:
                a=gl['accessors'][p['attributes']['POSITION']]
                if 'min' in a:
                    bounds[0]=min(bounds[0],a['min'][0]+pos[0]);bounds[1]=min(bounds[1],a['min'][2]+pos[2]);bounds[2]=max(bounds[2],a['max'][0]+pos[0]);bounds[3]=max(bounds[3],a['max'][2]+pos[2])
            is_ground=n.get('extras',{}).get('source_role')=='ground' or n.get('name','').lower().startswith('ground')
            if is_ground:
                for p in mesh['primitives']:
                    if p.get('mode',4)!=4:continue
                    vs=accessor(gl,binary,p['attributes']['POSITION']);ix=accessor(gl,binary,p['indices'])if 'indices'in p else range(len(vs)//3)
                    for j in range(0,len(ix)-2,3):
                        pts=[(vs[ix[j+k]*3]+pos[0],vs[ix[j+k]*3+1]+pos[1],vs[ix[j+k]*3+2]+pos[2])for k in range(3)];a,b,c=pts
                        den=(b[2]-c[2])*(a[0]-c[0])+(c[0]-b[0])*(a[2]-c[2])
                        if abs(den)<1e-9:continue
                        ux,uy,uz=[b[k]-a[k]for k in range(3)];vx,vy,vz=[c[k]-a[k]for k in range(3)];normal=(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx)
                        if abs(normal[1])/math.sqrt(sum(v*v for v in normal))<.65:continue
                        for y in range(math.floor(min(q[2]for q in pts)*4),math.ceil(max(q[2]for q in pts)*4)):
                            z=(y+.5)/4
                            for x in range(math.floor(min(q[0]for q in pts)*4),math.ceil(max(q[0]for q in pts)*4)):
                                xx=(x+.5)/4;aa=((b[2]-c[2])*(xx-c[0])+(c[0]-b[0])*(z-c[2]))/den;bb=((c[2]-a[2])*(xx-c[0])+(a[0]-c[0])*(z-c[2]))/den;cc=1-aa-bb
                                if min(aa,bb,cc)<-1e-7:continue
                                height=aa*a[1]+bb*b[1]+cc*c[1];key=(x,y);samples[key]=max(samples.get(key,-math.inf),height)
        for child in n.get('children',[]):visit(child,pos)
    for i in scenes[gl.get('scene',0)]['nodes']:visit(i)
    if not all(math.isfinite(v)for v in bounds):bounds=[0,0,2.5,2.5]
    return [[(x+.5)/4,(y+.5)/4,h]for(x,y),h in sorted(samples.items())],bounds

def world_map(world,nav,name,id):
    w=h=512;flags=[2]*(w*h);heights=[0]*(w*h)
    for key,height in nav['heights'].items():
        x,y=map(int,key.split(':'))
        if 0<=x<w and 0<=y<h:flags[y*w+x]=0;heights[y*w+x]=height
    tiles=[{'id':i['id'],'assetId':Path(i['scene']).stem,'x':i['position_m'][0]*4,'y':i['position_m'][2]*4,'height':i['position_m'][1],'yaw':i['yaw_degrees'],'scale':i.get('scale',1)}for i in world['geometry']['instances']]
    scenario=world['scenario'];entities=[{'id':'source-spawn','type':'spawn','name':'研究版出生點','x':scenario['spawn'][0]*4,'y':scenario['spawn'][1]*4},{'id':'source-exit','type':'portal','name':'研究版出口（待綁定）','x':scenario['exit'][0]*4,'y':scenario['exit'][1]*4,'targetWorld':900001 if scenario.get('town')else 900002,'targetTerrain':900001 if scenario.get('town')else 900002,'targetRegion':1}]
    for key,a in world.get('actors',{}).items():
        if a.get('position_xz'):entities.append({'id':'actor-'+key,'type':'npc','name':key,'x':a['position_xz'][0]*4,'y':a['position_xz'][1]*4,'templateId':a['source_id'],'sourcePlacementStatus':a.get('placement_status')})
    return {'schema':'twremake.authored-map.v1','id':id,'name':name,'grid':{'width':w,'height':h,'cellMeters':.25,'coordinateUnitsPerCell':4,'blockedMask':2,'blockGroupSize':13},'tiles':tiles,'entities':entities,'collision':{'flags':flags,'heights':heights,'provenance':'Research mesh-derived navigation adapted to 868; source server collision unknown'},'provenance':{'kind':'PoE2 research subset adapted for editing','sourceWorldId':world['world_id'],'sourceCoverage':world['source_state'],'originalLayoutComplete':False,'jp868NativeParityConfirmed':False},'acceptance':{'editorOnly':True,'runtimeIntegrated':False,'desktopGameplayAccepted':False,'browserGameplayAccepted':False}}

def main():
    sys.stdout.reconfigure(encoding='utf-8');ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);ap.add_argument('--base-library',type=Path,default=ROOT/'local/library');ap.add_argument('--destination',type=Path,required=True);opt=ap.parse_args();src=opt.source.resolve();base=opt.base_library.resolve();dest=opt.destination.resolve()
    if not dest.is_relative_to((ROOT/'local').resolve())or dest.exists():raise ValueError('Use a new destination inside this repository local/ folder')
    export=read(src/EXPORT);catalog=read(base/'data/catalog.json');template=read(base/'data/riverbank-template.json');dest.mkdir(parents=True);receipts=[];textures={}
    for a in catalog['assets']:
        a['category']='既有河岸與營地';a['navigationKind']='research-navigation'
        if a['id']=='clearfell_encampment_01':a['name']='皆伐營地'
        for rel in [a['model'],a.get('thumbnail','thumbnails/'+a['id']+'.png')]:
            p=inside(base,rel)
            if not p.exists():continue
            q=inside(dest,rel);q.parent.mkdir(parents=True,exist_ok=True)
            import shutil
            shutil.copyfile(p,q)
    for n,r in enumerate(export['TGTs']):
        file=src/r['GLB_path'];id='g12-'+file.stem;source=r['canonical_source_TGT'];family=source.split('/')[-2];category=FAMILIES.get(family,'其他地塊');out=dest/'models'/f'{id}.glb'
        gl,binary,receipt=preview(file,out,src,r['GLB_sha256'],textures);nav,bounds=ground_samples(gl,binary);receipts.append({'id':id,'canonicalSource':source,**receipt,'groundSamples':len(nav)})
        label=category+' · '+Path(source).stem
        thumb=f'thumbnails/{id}.svg';q=dest/thumb;q.parent.mkdir(exist_ok=True);q.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 160"><path d="M128 15 242 75 128 135 14 75Z" fill="#345b45" stroke="#a1cdae"/><text x="128" y="85" text-anchor="middle" fill="#def4e4" font-size="18">{r["TGT_size"][0]*2.5:g} × {r["TGT_size"][1]*2.5:g} m</text><text x="128" y="156" text-anchor="middle" fill="#c8e4d2" font-size="11">{html.escape(Path(source).stem[:30])}</text></svg>','utf-8')
        catalog['assets'].append({'id':id,'name':label,'category':category,'model':f'models/{id}.glb','thumbnail':thumb,'sizeM':[v*2.5 for v in r['TGT_size']],'boundsXZ':bounds,'source':receipt['source'],'preview':receipt['preview'],'geometryBuffersUnchanged':True,'textureMax':512,'localNavigation':nav,'navigationKind':'ground-surface-preview','canonicalSource':source,'sourceTgtSha256':r['TGT_source_sha256'],'sourcePlacementStatus':'source tile assembly candidate; ARM/TGR world placement unverified','sourceMaterialStatus':'source RGB preview; ground MTD/mask/layers unresolved','groundTrianglesOnly':True})
        if(n+1)%25==0:print(f'Imported {n+1}/{len(export["TGTs"])}',flush=True)
    catalog['kind']='PoE2 研究素材庫：河岸、皆伐營地與 G1_2 地塊';catalog['inputs'].append(pin(src/EXPORT));catalog['researchSummary']={'newTiles':len(export['TGTs']),'sourceCells':export['summary']['cells'],'sourceVertices':export['summary']['vertices'],'sourceTriangles':export['summary']['triangles'],'completeAreas':False,'groundMaterialsComplete':False}
    write(dest/'data/catalog.json',catalog);write(dest/'data/riverbank-template.json',template);entries=[]
    for world,nav,name,id,scope in [('clearfell_mace_v07.json','clearfell_campaign_navigation.json','皆伐營地 · 中央區域','poe2-clearfell-central','中央固定房間；周邊區域尚未取得完整排列'),('riverbank_mace_v07.json','riverbank_opening_navigation.json','河岸 · 入口區域','poe2-riverbank-entrance','8 個入口地塊；整張河岸與生成種子未知')]:
        d=world_map(read(src/'game/data/worlds'/world),read(src/'game/data/worlds'/nav),name,id);d['provenance']['inputs']=[pin(src/'game/data/worlds'/world),pin(src/'game/data/worlds'/nav)];rel=f'templates/{id}.twmap.json';write(dest/rel,d);entries.append({'id':id,'name':name,'path':rel,'description':scope,'status':'研究區域，可編輯'})
    write(dest/'data/map-library.json',{'schema':'twremake.map-library.v1','maps':entries,'researchSummary':catalog['researchSummary']});write(dest/'import-receipt.json',{'sourceModified':False,'assets':len(catalog['assets']),'newTiles':len(receipts),'presets':entries,'exportIndex':pin(src/EXPORT),'models':receipts})
    print(json.dumps({'library':str(dest),'assets':len(catalog['assets']),'newTiles':len(receipts),'maps':len(entries)},ensure_ascii=False))

if __name__=='__main__':main()
