from pathlib import Path
import copy, importlib.util, json, struct, unittest, zipfile, io

ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('editor_server',ROOT/'server.py');server=importlib.util.module_from_spec(spec);spec.loader.exec_module(server)

class ServerTests(unittest.TestCase):
    def setUp(self):self.map=json.loads((ROOT/'web/data/riverbank-template.json').read_text('utf-8'))
    def test_bundle_is_self_contained_and_data_is_round_trip(self):
        d=server.validate(self.map)
        with zipfile.ZipFile(io.BytesIO(server.make_bundle(d)))as z:
            self.assertIsNone(z.testzip());self.assertEqual(json.loads(z.read('map.twmap.json'))['collision'],d['collision']);self.assertEqual(z.read('collision.bin'),bytes(d['collision']['flags']));self.assertEqual(len(z.read('heights.f32le')),512*512*4)
            self.assertEqual(len(json.loads(z.read('868-native-regions.json'))['regions']),40*40)
            for a in d['assetManifest']:self.assertEqual(z.read(a['model']),(ROOT/'web'/a['model']).read_bytes())
    def test_invalid_grid_and_object_outside_are_rejected(self):
        d=copy.deepcopy(self.map);d['grid']['width']=1025
        with self.assertRaises(ValueError):server.validate(d)
        d=copy.deepcopy(self.map);d['entities'][0]['x']=512
        with self.assertRaises(ValueError):server.validate(d)
    def test_full_size_has_distinct_boundaries_and_distant_coordinates(self):
        d=copy.deepcopy(self.map);d['grid']['width']=d['grid']['height']=1024;d['collision']={'flags':[2]*(1024*1024),'heights':[0]*(1024*1024)};d['tiles']=[];d['entities']=[{'id':'far','type':'npc','name':'far','x':900,'y':900}]
        self.assertEqual(server.validate(d)['entities'][0]['x'],900)
    def test_import_cannot_promote_acceptance(self):
        self.map['acceptance']={'runtimeIntegrated':True,'browserGameplayAccepted':True};d=server.validate(self.map);self.assertFalse(d['acceptance']['runtimeIntegrated']);self.assertFalse(d['acceptance']['browserGameplayAccepted'])

if __name__=='__main__':unittest.main()
