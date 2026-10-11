"""Create small original demo GLBs from boxes; no game assets are required."""
from pathlib import Path
import hashlib, json, struct

ROOT=Path(__file__).resolve().parents[1];WEB=ROOT/'web'
COLORS=[[.28,.38,.22,1],[.43,.34,.22,1],[.22,.40,.48,1],[.34,.24,.14,1],[.16,.31,.19,1],[.48,.49,.43,1],[.65,.38,.22,1]]

def write(path,data):path.parent.mkdir(parents=True,exist_ok=True);path.write_text(json.dumps(data,ensure_ascii=False,separators=(',',':')),'utf-8')
def model(path,boxes):
    points=[];normals=[]
    faces=[((1,0,0),[(1,0,0),(1,1,0),(1,1,1),(1,0,1)]),((-1,0,0),[(0,0,1),(0,1,1),(0,1,0),(0,0,0)]),((0,1,0),[(0,1,1),(1,1,1),(1,1,0),(0,1,0)]),((0,-1,0),[(0,0,0),(1,0,0),(1,0,1),(0,0,1)]),((0,0,1),[(1,0,1),(1,1,1),(0,1,1),(0,0,1)]),((0,0,-1),[(0,0,0),(0,1,0),(1,1,0),(1,0,0)])]
    for normal,vs in faces:
        for i in [0,1,2,0,2,3]:points.extend(vs[i]);normals.extend(normal)
    pos=struct.pack('<'+'f'*len(points),*points);nrm=struct.pack('<'+'f'*len(normals),*normals);binary=pos+nrm
    gl={'asset':{'version':'2.0','generator':'tw Map Editor original box demo'},'scene':0,'scenes':[{'nodes':list(range(len(boxes)))}],'nodes':[{'name':name,'mesh':material,'translation':[x,y,z],'scale':[w,h,d]}for name,material,x,y,z,w,h,d in boxes],'meshes':[{'primitives':[{'attributes':{'POSITION':0,'NORMAL':1},'material':i}]}for i in range(len(COLORS))],'materials':[{'pbrMetallicRoughness':{'baseColorFactor':c,'metallicFactor':0,'roughnessFactor':1}}for c in COLORS],'buffers':[{'byteLength':len(binary)}],'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(pos)},{'buffer':0,'byteOffset':len(pos),'byteLength':len(nrm)}],'accessors':[{'bufferView':0,'componentType':5126,'count':36,'type':'VEC3','min':[0,0,0],'max':[1,1,1]},{'bufferView':1,'componentType':5126,'count':36,'type':'VEC3'}]}
    js=json.dumps(gl,separators=(',',':')).encode();js+=b' '*(-len(js)%4)
    path.parent.mkdir(parents=True,exist_ok=True);path.write_bytes(struct.pack('<III',0x46546c67,2,28+len(js)+len(binary))+struct.pack('<II',len(js),0x4e4f534a)+js+struct.pack('<II',len(binary),0x004e4942)+binary)

def main():
    assets=[];specs=[('demo-riverbank','河岸範例',[15,15],0),('demo-river','河道範例',[7.5,15],2),('demo-rocks','岩岸範例',[7.5,7.5],1),('demo-camp','營地範例（自製）',[37.5,45],1)]
    for id,name,(w,d),color in specs:
        boxes=[('ground-floor',color,0,-.2,0,w,.2,d)]
        if id=='demo-riverbank':
            for x,z in [(2,2),(11,3),(3,11)]:boxes.extend([('tree-trunk',3,x,0,z,.7,2.7,.7),('tree-crown',4,x-1,2.3,z-1,2.7,3,2.7)])
        if id=='demo-rocks':
            for x,z,h in [(1,2,1),(3,1,2),(5,4,1.6)]:boxes.append(('rock',5,x,0,z,1.5,h,2))
        if id=='demo-camp':
            for x,z in [(3,3),(24,3),(3,30),(25,31)]:boxes.extend([('cabin',3,x,0,z,7,3,7),('roof',6,x-.5,3,z-.5,8,.65,8)])
            boxes.extend([('campfire',6,17,0,20,1,.4,1),('ground-path',0,13,.01,0,7,.04,d)])
        p=WEB/'models'/f'{id}.glb';model(p,boxes);sha=hashlib.sha256(p.read_bytes()).hexdigest();relative=f'models/{id}.glb';source={'path':relative,'bytes':p.stat().st_size,'sha256':sha}
        nav=[[x*.25,z*.25,0]for z in range(int(d*4))for x in range(int(w*4))]
        assets.append({'id':id,'name':name,'model':relative,'thumbnail':f'thumbnails/{id}.svg','sizeM':[w,d],'source':source,'preview':source,'geometryBuffersUnchanged':True,'textureMax':0,'localNavigation':nav,'provenance':'original procedural box demo; not extracted game art'})
        thumb=WEB/'thumbnails'/f'{id}.svg';thumb.parent.mkdir(exist_ok=True);rgb='#'+''.join(f'{int(v*255):02x}'for v in COLORS[color][:3]);thumb.write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 160"><path d="M128 15 242 75 128 140 14 75Z" fill="{rgb}" stroke="#98c9ac"/><path d="M100 75 128 55 158 75 128 95Z" fill="#976543"/><text x="128" y="156" text-anchor="middle" fill="#c8e4d2" font-size="12">{w} × {d} m</text></svg>','utf-8')
    inputs=[a['source']for a in assets]
    catalog={'schema':'twremake.map-editor.catalog.v1','kind':'original procedural demo','assets':assets,'worlds':[{'id':900001,'name':'自製範例世界','terrains':[900001]},{'id':900002,'name':'自製出口目標','terrains':[900002]}],'rules':{'coordinateUnitsPerCell':4,'blockedMask':2,'blockGroupSize':13,'scope':'authoring arithmetic and data grouping; no native resource or server parity claim'},'inputs':inputs,'threeVersion':'0.179.1'}
    w=h=512;flags=[2]*(w*h);heights=[0]*(w*h);tiles=[]
    for i,(id,x,y)in enumerate([('demo-riverbank',48,48),('demo-river',108,48),('demo-rocks',48,108),('demo-camp',138,48)]):
        tiles.append({'id':'demo-tile-'+str(i),'assetId':id,'x':x,'y':y,'yaw':0,'height':0,'scale':1})
        a=next(a for a in assets if a['id']==id)
        for dx,dz,height in a['localNavigation']:flags[(y+round(dz*4))*w+x+round(dx*4)]=0
    entities=[{'id':'demo-spawn','type':'spawn','name':'範例出生點','x':64,'y':64},{'id':'demo-portal','type':'portal','name':'範例出口','x':150,'y':64,'targetWorld':900002,'targetTerrain':900002,'targetRegion':0}]
    template={'schema':'twremake.authored-map.v1','id':'tw-map-editor-demo','name':'河岸與營地・自製範例','grid':{'width':w,'height':h,'cellMeters':.25,'coordinateUnitsPerCell':4,'blockedMask':2,'blockGroupSize':13},'tiles':tiles,'collision':{'flags':flags,'heights':heights,'provenance':'original demo rectangles; author may edit collision'},'entities':entities,'provenance':{'kind':'original procedural demo','inputs':inputs,'sourceCoverage':'4 self-generated demo modules','jp868NativeParityConfirmed':False},'acceptance':{'editorOnly':True,'desktopGameplayAccepted':False,'browserGameplayAccepted':False,'runtimeIntegrated':False}}
    write(WEB/'data/catalog.json',catalog);write(WEB/'data/riverbank-template.json',template);(WEB/'maps').mkdir(exist_ok=True);(WEB/'maps/.gitkeep').touch()
    write(WEB/'data/map-library.json',{'schema':'twremake.map-library.v1','maps':[{'id':'original-demo','name':'河岸與營地・自製範例','path':'data/riverbank-template.json','description':'本專案自製的範例地形，可自由編輯。'}]})
    print('Generated 4 original GLB modules and a 512-cell demo map')

if __name__=='__main__':main()
