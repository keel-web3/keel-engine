import importlib.util, pathlib, unittest
p=pathlib.Path(__file__).parents[1]/'tools/cgb-profile.py'
spec=importlib.util.spec_from_file_location('profile',p);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ProfileTest(unittest.TestCase):
 def test_small_sample_percentiles(self):
  self.assertEqual(m.distribution([]),{'count':0})
  self.assertEqual(m.distribution([1,2,3,100]),{'count':4,'sum':106,'min':1,'median':2.5,'p95':100,'max':100})
 def test_entropy_guard(self):
  class Symbols: symbols={'_cru_stir':0x14000};rom=bytes(16384)+b'\x3b\x3b\xf8\x0a\x7e\xd1\xd5\x6f'+bytes(32)
  class PB:
   register_file=type('Register',(),{'A':99})()
   def hook_register(self,bank,addr,fn,context): self.hook=(bank,addr,fn)
  pb=PB();receipt=m.guarded_entropy_hook(pb,Symbols());self.assertEqual(pb.hook[:2],(1,0x4005));pb.hook[2](None);self.assertEqual(pb.register_file.A,0);self.assertEqual(receipt['entropy'],0)
  Symbols.rom=bytes(16424)
  with self.assertRaisesRegex(ValueError,'unrecognized'):m.guarded_entropy_hook(pb,Symbols())
 def test_palette_upload_observer_flags_ignored_mode_three_bytes(self):
  code=bytes.fromhex('c5 0e 68 f8 04 2a 87 87 87 f6 80 e2 0c 2a 87 87 87 47 2a 66 6f f0 41 e6 02 20 fa 2a e2 05 20 f5 c1 c9')
  class Symbols:symbols={'_set_bkg_palette':0x310,'_set_sprite_palette':0x30b};rom=bytes(0x310)+code
  class Memory(dict):
   cram=bytearray(64)
   def __getitem__(self,k):return self.cram[dict.get(self,0xff68,0)&63] if k==0xff69 else dict.get(self,k,0)
  class PB:
   register_file=type('Register',(),{'SP':0xc000,'C':0x69,'A':0})()
   memory=Memory();hooks={}
   def hook_register(self,bank,addr,fn,context):self.hooks[addr]=fn
   def _cycles(self):return 42
   def save_state(self,f):
    data=bytearray(17483);data[0]=15;data[4]=1;data[9124]=1;data[8393]=self.memory[0xff40];data[8397]=self.memory[0xff41];data[17351:17415]=self.memory.cram;f.write(data)
  pb=PB();mem=pb.memory;mem.update({0xc002:0,0xc003:1,0xc004:0x00,0xc005:0xc1,0xff40:128,0xff41:3,0xff68:0x80})
  for i in range(8):mem[0xc100+i]=i+1
  observer=m.PaletteUploads(pb,Symbols(),lambda:{'phase':'test','frame':0})
  pb.hooks[0x310](None)
  for i in range(8):pb.register_file.A=i+1;pb.hooks[observer.guard['write']](None)
  pb.hooks[observer.guard['return']](None);r=observer.records[0]
  self.assertEqual(r['mode3Writes'],8);self.assertTrue(r['writeBytesAgree']);self.assertFalse(r['cramBytesAgree']);self.assertEqual(mem[0xff68],0x80)
if __name__=='__main__':unittest.main()
