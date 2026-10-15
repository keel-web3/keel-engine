"""Preflight must reject incomplete or unbound artifacts before accessing signing services."""
import pathlib,plistlib,subprocess,sys,tempfile,unittest
SCRIPT=pathlib.Path(__file__).with_name('release-macos.py')
class ReleasePreflight(unittest.TestCase):
 def test_incomplete_app_rejected_before_any_signing_tool(self):
  with tempfile.TemporaryDirectory() as temp:
   app=pathlib.Path(temp)/'Incomplete.app';app.mkdir()
   result=subprocess.run([sys.executable,str(SCRIPT),str(app),temp+'/out'],capture_output=True,text=True,env={'PATH':''})
   self.assertNotEqual(result.returncode,0);self.assertIn('Incomplete app: missing Contents/Info.plist',result.stderr)
 def test_source_mismatch_rejected_before_any_signing_tool(self):
  with tempfile.TemporaryDirectory() as temp:
   app=pathlib.Path(temp)/'WrongSource.app'
   for name in ['Contents/MacOS/ChromaticHelper','Contents/MacOS/chromatic-wifi','Contents/Resources/LICENSE.txt','Contents/Resources/Bun-LICENSE.md','Contents/Resources/SOURCE-REVISION']:
    p=app/name;p.parent.mkdir(parents=True,exist_ok=True);p.write_text('0'*40)
   (app/'Contents/Info.plist').write_bytes(plistlib.dumps({'ChromaticSourceRevision':'1'*40}))
   result=subprocess.run([sys.executable,str(SCRIPT),str(app),temp+'/out'],capture_output=True,text=True,env={'PATH':''})
   self.assertNotEqual(result.returncode,0);self.assertIn('exact source commit',result.stderr)
if __name__=='__main__':unittest.main()
