#!/usr/bin/env python3
"""Package already built helper plus complete protocol/UI source. Usage: python3 package-downloads.py OUTPUT_DIR"""
from pathlib import Path
import hashlib,tarfile,sys,shutil,subprocess
package=Path(__file__).resolve().parent
out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=True)
# Distribution gate: a locally runnable binary is not a valid Mac release.
subprocess.run(['codesign','--verify','--strict',str(package/'dist/chromatic-wifi')],check=True)
subprocess.run(['spctl','--assess','--type','execute',str(package/'dist/chromatic-wifi')],check=True)
with tarfile.open(out/'source.tar.gz','w:gz') as archive:
 for name in ['helper','src','upstream','test','macos','wasm/cwl.mjs','wasm/cwl.wasm','LICENSE','LICENSES','SOURCE.json','README.md','package.json','build.sh','package-downloads.py']:
  archive.add(package/name,arcname='chromatic-wireless/'+name,filter=lambda entry:None if '/__pycache__' in entry.name or entry.name.endswith('.pyc') else entry)
with tarfile.open(out/'chromatic-wifi-macos-arm64.tar.gz','w:gz') as archive:
 archive.add(package/'dist/chromatic-wifi',arcname='chromatic-wifi')
 for name in ['README.md','LICENSE','SOURCE.json','LICENSES']:archive.add(package/name,arcname=name)
for name in ['README.md','LICENSE','SOURCE.json']:shutil.copy2(package/name,out/name)
(out/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(out.iterdir()) if p.is_file() and p.name not in ['SHA256SUMS','.gitignore']))
