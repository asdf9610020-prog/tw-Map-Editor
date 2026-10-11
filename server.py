"""Loopback-only authoring server. Writes exclusively to the editor maps folder."""
from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
import argparse, datetime, hashlib, io, json, math, re, struct, sys, zipfile
from urllib.parse import unquote, urlsplit

ROOT = Path(__file__).resolve().parent
APP = ROOT/'web'
LIBRARY = APP
MAPS = APP/'maps'
CATALOGUE = json.loads((APP/'data/catalog.json').read_text('utf-8'))
ASSETS = {r['id']: r for r in CATALOGUE['assets']}

def validate(d):
    if not isinstance(d, dict) or d.get('schema') != 'twremake.authored-map.v1': raise ValueError('不支援的地圖格式')
    if not isinstance(d.get('id'), str) or not 1 <= len(d['id']) <= 80 or not isinstance(d.get('name'), str) or len(d['name']) > 120: raise ValueError('名稱或編號無效')
    g=d.get('grid', {}); w,h=g.get('width'),g.get('height')
    if type(w) is not int or type(h) is not int or not (8 <= w <= 1024 and 8 <= h <= 1024): raise ValueError('尺寸須為8–1024格')
    if g.get('coordinateUnitsPerCell') != 4 or g.get('blockedMask') != 2 or g.get('blockGroupSize') != 13: raise ValueError('868 通行規則無效')
    if type(g.get('cellMeters')) not in (int,float) or not .1 <= g['cellMeters'] <= 5: raise ValueError('公尺轉換規則無效')
    c=d.get('collision',{});flags=c.get('flags');heights=c.get('heights')
    if not isinstance(flags,list) or len(flags)!=w*h or any(type(f) is not int or not 0<=f<=255 for f in flags): raise ValueError('通行位元資料無效')
    if not isinstance(heights,list) or len(heights)!=w*h or any(type(f) not in (int,float) or not math.isfinite(f) or abs(f)>1000 for f in heights): raise ValueError('高度資料無效')
    if not isinstance(d.get('tiles'),list) or len(d['tiles'])>500 or not isinstance(d.get('entities'),list) or len(d['entities'])>2000: raise ValueError('物件數量超出範圍')
    ids=set()
    for o in d['tiles']+d['entities']:
        if not isinstance(o,dict) or not isinstance(o.get('id'),str) or o['id'] in ids: raise ValueError('物件編號無效');
        ids.add(o['id'])
        if any(type(o.get(k)) not in (int,float) or not math.isfinite(o[k]) or o[k]<0 or o[k]>=limit for k,limit in [('x',w),('y',h)]): raise ValueError('物件座標無效')
        if 'assetId' in o:
            if o['assetId'] not in ASSETS: raise ValueError('地形來源不存在')
            if any(type(o.get(k)) not in (int,float) or not math.isfinite(o[k]) for k in ['yaw','scale','height']) or not .25<=o['scale']<=4 or abs(o['height'])>1000: raise ValueError('地形變換無效')
        else:
            if o.get('type') not in ['spawn','portal','npc','monster'] or not isinstance(o.get('name'),str) or len(o['name'])>120: raise ValueError('物件類型或名稱無效')
            if o['type']=='portal' and any(type(o.get(k)) is not int or not 0<=o[k]<=999999 for k in ['targetWorld','targetTerrain','targetRegion']): raise ValueError('出口目標無效')
    # Never trust imported acceptance or source paths. Rebuild these server-side.
    d['acceptance']={'editorOnly':True,'desktopGameplayAccepted':False,'browserGameplayAccepted':False,'runtimeIntegrated':False}
    d['assetManifest']=[{k:a[k] for k in ['id','model','source','preview','geometryBuffersUnchanged','textureMax']} for key in dict.fromkeys(t['assetId'] for t in d['tiles']) for a in [ASSETS[key]]]
    return d

def encode(d): return json.dumps(d,ensure_ascii=False,indent=2,allow_nan=False).encode('utf-8')

README = '''tw Map Editor：新地圖交換包

map.twmap.json：完整可重新匯入的編輯專案。
collision.bin：每格一 byte、row-major，bit 0x02 代表阻擋；保留其他位元。
heights.f32le：每格一個 little-endian float32，單位為模型公尺。
models/：目前素材庫所用的GLB模型。
catalog.json：所用模組及其來源 SHA256，均為原素材的衍生預覽。
868-native-regions.json：以13×13格分組的可讀通行資料；不是原生d2m。

匯入方式：啟動編輯器，解壓此包後選「匯入」→ map.twmap.json。
此工具採固定等角視圖呈現 GLB 模組，以0.25m對應一通行格為轉換政策。
868通行座標：x,y為4倍格座標，cell=(x>>2,y>>2)，flags&2阻擋。
通行資料來源依素材目錄；自製範例為矩形通行格，本機庫可提供模型推導值。此資料不代表原版伺服器碰撞。
四方向試走與0.45m高度差限制僅供編輯器預覽。
出口的world/terrain/region是新設計資料，未寫入正式遊戲。
本工具未實作原生d2m寫入、Godot/網頁遊戲載入器或伺服器發布。
需要另行接入並通過桌面與網頁的同批驗收，才能於遊戲使用。
'''

def make_bundle(d):
    result=io.BytesIO();g=d['grid'];w,h=g['width'],g['height'];regions=[]
    for gy in range(math.ceil(h/13)):
        for gx in range(math.ceil(w/13)):
            rw,rh=min(13,w-gx*13),min(13,h-gy*13)
            regions.append({'group':[gx,gy],'width':rw,'height':rh,'flags':[d['collision']['flags'][(gy*13+y)*w+gx*13+x] for y in range(rh) for x in range(rw)]})
    with zipfile.ZipFile(result,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=2) as z:
        z.writestr('map.twmap.json',encode(d));z.writestr('README.txt',README)
        z.writestr('collision.bin',bytes(d['collision']['flags']))
        z.writestr('heights.f32le',struct.pack('<'+'f'*(w*h),*d['collision']['heights']))
        z.writestr('868-native-regions.json',encode({'coordinateUnitsPerCell':4,'blockedMask':2,'blockGroupSize':13,'nativeD2mEncoded':False,'regions':regions}))
        z.writestr('catalog.json',encode({'schema':CATALOGUE['schema'],'assets':[ASSETS[a['id']] for a in d['assetManifest']],'rules':CATALOGUE['rules']}))
        for a in d['assetManifest']: z.write(LIBRARY/a['model'],a['model'])
    return result.getvalue()

class Handler(SimpleHTTPRequestHandler):
    def __init__(self,*args,**kwargs): super().__init__(*args,directory=str(APP),**kwargs)
    def translate_path(self,path):
        rel=unquote(urlsplit(path).path).lstrip('/')
        root=LIBRARY if rel in ['data/catalog.json','data/riverbank-template.json'] or rel.startswith(('models/','thumbnails/')) else APP
        resolved=(root/rel).resolve()
        return str(resolved if resolved.is_relative_to(root.resolve()) else APP/'.blocked-path')
    def log_message(self,fmt,*args):
        if self.path.startswith('/api/'): print(fmt%args,flush=True)
    def end_headers(self):
        self.send_header('X-Content-Type-Options','nosniff');self.send_header('Cache-Control','no-cache');super().end_headers()
    def send_json(self,code,d):
        b=encode(d);self.send_response(code);self.send_header('Content-Type','application/json; charset=utf-8');self.send_header('Content-Length',str(len(b)));self.end_headers();self.wfile.write(b)
    def do_GET(self):
        if self.path=='/api/health': return self.send_json(200,{'ok':True,'tool':'tw-map-editor','root':str(ROOT),'library':str(LIBRARY),'maps':str(MAPS)})
        return super().do_GET()
    def do_POST(self):
        try:
            host=self.headers.get('Host','');expected=f'127.0.0.1:{self.server.server_port}'
            if host not in [expected,f'localhost:{self.server.server_port}']: raise ValueError('Invalid local host')
            origin=self.headers.get('Origin')
            if origin and origin not in [f'http://{expected}',f'http://localhost:{self.server.server_port}']: raise ValueError('Cross-origin writes rejected')
            n=int(self.headers.get('Content-Length',0))
            if not 0<n<=64*1024*1024: raise ValueError('專案須小於64MB')
            if not self.headers.get('Content-Type','').startswith('application/json'): raise ValueError('JSON required')
            if self.path not in ['/api/projects','/api/export']: return self.send_json(404,{'error':'Not found'})
            d=validate(json.loads(self.rfile.read(n)))
            if self.path=='/api/projects':
                MAPS.mkdir(exist_ok=True);stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');slug=re.sub('[^a-zA-Z0-9_-]','_',d['id'])[:70] or 'new-map'
                dest=MAPS/f'{slug}-{stamp}.twmap.json'
                with dest.open('xb') as f: f.write(encode(d))
                return self.send_json(200,{'file':dest.name,'path':str(dest),'sha256':hashlib.sha256(dest.read_bytes()).hexdigest()})
            payload=make_bundle(d);self.send_response(200);self.send_header('Content-Type','application/zip');self.send_header('Content-Length',str(len(payload)));self.end_headers();self.wfile.write(payload)
        except (ValueError,KeyError,TypeError) as e: self.send_json(400,{'error':str(e)})
        except Exception as e:
            print(type(e).__name__,str(e),flush=True);self.send_json(500,{'error':'保存或匯出失敗，請查看工具紀錄'})

def main():
    global LIBRARY,CATALOGUE,ASSETS
    sys.stdout.reconfigure(encoding='utf-8');a=argparse.ArgumentParser();a.add_argument('--port',type=int,default=8790)
    mode=a.add_mutually_exclusive_group();mode.add_argument('--library',type=Path);mode.add_argument('--demo',action='store_true');opt=a.parse_args()
    local=ROOT/'local/library'
    LIBRARY=APP if opt.demo else (opt.library.resolve() if opt.library else local if (local/'data/catalog.json').exists() else APP)
    CATALOGUE=json.loads((LIBRARY/'data/catalog.json').read_text('utf-8-sig'));ASSETS={r['id']:r for r in CATALOGUE['assets']}
    http=ThreadingHTTPServer(('127.0.0.1',opt.port),Handler)
    print(f'tw Map Editor: http://127.0.0.1:{opt.port}/ | library={LIBRARY}',flush=True)
    try: http.serve_forever()
    except KeyboardInterrupt: pass
    finally: http.server_close()

if __name__=='__main__':main()
