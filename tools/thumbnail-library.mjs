// Render local model thumbnails without retaining hundreds of GLBs in GPU memory.
import {createRequire} from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
const [directory,url='http://127.0.0.1:8790/']=process.argv.slice(2);
if(!directory||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Usage: node tools/thumbnail-library.mjs local/library http://127.0.0.1:PORT/');
const root=path.resolve(import.meta.dirname,'../local'),library=path.resolve(directory);
if(!library.startsWith(root+path.sep))throw Error('Thumbnail output must stay in local/');
const pkg=process.env.PLAYWRIGHT_MODULE_ROOT,require=pkg?createRequire(pkg+'/playwright/package.json'):createRequire(import.meta.url),{chromium}=require('playwright');
const browser=await chromium.launch({...(process.env.PLAYWRIGHT_CHANNEL?{channel:process.env.PLAYWRIGHT_CHANNEL}:{}),headless:true,args:['--enable-unsafe-swiftshader']});
try{
  const page=await browser.newPage({viewport:{width:1200,height:900}}),errors=[];page.on('pageerror',e=>errors.push(String(e)));await page.goto(url);await page.waitForFunction(()=>window.editor?.ready,{}, {timeout:120000});
  const file=path.join(library,'data/catalog.json'),catalog=JSON.parse(fs.readFileSync(file,'utf8')),loaded=await page.evaluate(()=>editor.catalogue.assets.map(a=>[a.id,a.preview.sha256]));
  if(JSON.stringify(loaded)!==JSON.stringify(catalog.assets.map(a=>[a.id,a.preview.sha256])))throw Error('Server uses another library');
  const results=[];
  for(const a of catalog.assets.filter(a=>a.id.startsWith('g12-'))){
    const png=await page.evaluate(id=>editor.thumbnail(id),a.id);const rel='thumbnails/'+a.id+'.png';fs.writeFileSync(path.join(library,rel),Buffer.from(png.split(',')[1],'base64'));a.thumbnail=rel;results.push(a.id);
    if(results.length%25===0)console.log('Rendered '+results.length);
  }
  if(errors.length)throw Error(errors.join('\n'));fs.writeFileSync(file,JSON.stringify(catalog));fs.writeFileSync(path.join(library,'thumbnail-receipt.json'),JSON.stringify({modelsRendered:results.length,ids:results,pageErrors:errors,renderer:'Three.js WebGL authoring preview; source shader parity unverified'},null,2));console.log('Rendered '+results.length+' source tile previews');
}finally{await browser.close();}
