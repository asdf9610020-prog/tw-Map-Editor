from pathlib import Path
import hashlib, importlib.util, io, json, struct, tempfile, unittest

ROOT=Path(__file__).resolve().parents[1]
try:
    from PIL import Image
except ImportError:
    Image=None

@unittest.skipUnless(Image,'Install requirements-import.txt for research import checks')
class ResearchImportTests(unittest.TestCase):
    def setUp(self):
        spec=importlib.util.spec_from_file_location('research',ROOT/'tools/import-poe2-research.py');self.module=importlib.util.module_from_spec(spec);spec.loader.exec_module(self.module)
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup);self.root=Path(self.temp.name);self.source=self.root/'tile.glb'
        self.geometry=struct.pack('<9f',0,0,0,1,0,0,0,0,1)
        image=Image.new('RGBA',(1024,16),(100,160,60,128));self.png=self.root/'texture with space.png';image.save(self.png)
        self.gl={'asset':{'version':'2.0'},'buffers':[{'byteLength':len(self.geometry)}],'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(self.geometry)}],'images':[{'uri':'texture%20with%20space.png','extras':{'PNG_sha256':hashlib.sha256(self.png.read_bytes()).hexdigest()}}]}
        self.source.write_bytes(self.module.pack_glb(self.gl,self.geometry))
    def test_external_percent_encoded_png_is_embedded_without_touching_geometry(self):
        before=self.source.read_bytes();out=self.root/'preview.glb';gl,binary,receipt=self.module.preview(self.source,out,self.root,hashlib.sha256(before).hexdigest())
        decoded,full=self.module.unpack_glb(out.read_bytes());self.assertEqual(binary,self.geometry);self.assertEqual(full[:len(self.geometry)],self.geometry);self.assertEqual(self.source.read_bytes(),before);self.assertNotIn('uri',decoded['images'][0])
        view=decoded['bufferViews'][decoded['images'][0]['bufferView']];image=Image.open(io.BytesIO(full[view['byteOffset']:view['byteOffset']+view['byteLength']]));self.assertEqual(image.size,(512,8));self.assertTrue(receipt['geometryBuffersUnchanged'])
    def test_digest_mismatch_and_external_texture_escape_are_rejected(self):
        with self.assertRaises(ValueError):self.module.preview(self.source,self.root/'bad.glb',self.root,'0'*64)
        self.gl['images'][0]['uri']='../outside.png';self.source.write_bytes(self.module.pack_glb(self.gl,self.geometry))
        with self.assertRaises(ValueError):self.module.preview(self.source,self.root/'bad.glb',self.root)
    def test_ground_sampling_uses_only_scene_ground_triangles(self):
        gl={'scene':0,'scenes':[{'nodes':[0]}],'nodes':[{'mesh':0,'translation':[2,1,3],'extras':{'source_role':'ground'}}],'meshes':[{'primitives':[{'attributes':{'POSITION':0}}]}],'accessors':[{'bufferView':0,'componentType':5126,'count':3,'type':'VEC3','min':[0,0,0],'max':[1,0,1]}],'bufferViews':[{'buffer':0,'byteOffset':0,'byteLength':len(self.geometry)}]}
        samples,bounds=self.module.ground_samples(gl,self.geometry);self.assertTrue(samples);self.assertTrue(all(p[2]==1 for p in samples));self.assertEqual(bounds,[2,3,3,4]);self.assertIn([2.125,3.125,1],samples)
        gl['nodes'][0]['extras']['source_role']='main';self.assertEqual(self.module.ground_samples(gl,self.geometry)[0],[])

if __name__=='__main__':unittest.main()
