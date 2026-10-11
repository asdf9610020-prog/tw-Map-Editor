"""Copy a compatible local library without touching the source or publishing it."""
from pathlib import Path
import argparse, hashlib, json, re, shutil

ROOT=Path(__file__).resolve().parents[1]

def read(p):return json.loads(p.read_text('utf-8-sig'))
def inside(root,rel):
    p=(root/rel).resolve()
    if not p.is_relative_to(root.resolve()):raise ValueError('Library path leaves source folder')
    return p
def scrub(value):
    if isinstance(value,dict):
        return {k:(str(v).replace('\\','/').split('/')[-1] if k=='path' and isinstance(v,str) else scrub(v)) for k,v in value.items()}
    if isinstance(value,list):return [scrub(v)for v in value]
    return value
def main():
    ap=argparse.ArgumentParser();ap.add_argument('--source',type=Path,required=True);ap.add_argument('--project',type=Path);ap.add_argument('--destination',type=Path,default=ROOT/'local/library');opt=ap.parse_args()
    src=opt.source.resolve();dest=opt.destination.resolve()
    if not dest.is_relative_to((ROOT/'local').resolve()):raise ValueError('Destination must stay within this repository local/ folder')
    if dest.exists():raise ValueError('Destination already exists; use a fresh --destination under local/')
    catalog=read(src/'data/catalog.json');template=read(src/'data/riverbank-template.json');files=[]
    for a in catalog['assets']:
        if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}',a['id']):raise ValueError('Invalid asset ID')
        model=inside(src,a['model']);expected=a.get('preview',{}).get('sha256')
        if expected and hashlib.sha256(model.read_bytes()).hexdigest()!=expected:raise ValueError('Model digest mismatch: '+a['id'])
        files.append((model,a['model']))
        thumbnail=a.get('thumbnail','thumbnails/'+a['id']+'.png');thumb=inside(src,thumbnail)
        if thumb.exists():files.append((thumb,thumbnail))
    project=read(opt.project)if opt.project else None
    dest.mkdir(parents=True)
    for original,rel in files:
        target=inside(dest,rel);target.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(original,target)
    (dest/'data').mkdir(exist_ok=True)
    for name,data in [('catalog.json',catalog),('riverbank-template.json',template)]:
        (dest/'data'/name).write_text(json.dumps(scrub(data),ensure_ascii=False,separators=(',',':')),'utf-8')
    if project:
        maps=ROOT/'web/maps';maps.mkdir(exist_ok=True);filename=opt.project.name
        if not re.fullmatch(r'[a-zA-Z0-9_-]+\.twmap\.json',filename):raise ValueError('Project must have a portable .twmap.json filename')
        target=maps/filename
        with target.open('x',encoding='utf-8')as f:json.dump(scrub(project),f,ensure_ascii=False,separators=(',',':'))
    print(json.dumps({'imported':len(catalog['assets']),'library':str(dest),'project':opt.project.name if opt.project else None,'sourceModified':False}))

if __name__=='__main__':main()
