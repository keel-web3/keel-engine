#!/usr/bin/env python3
"""Package already built helper plus complete protocol/UI source. Usage: python3 package-downloads.py OUTPUT_DIR"""
from pathlib import Path
import hashlib,tarfile,sys,shutil
package=Path(__file__).resolve().parent
out=Path(sys.argv[1]).resolve();out.mkdir(parents=True,exist_ok=True)
with tarfile.open(out/'source.tar.gz','w:gz') as archive:
 for name in ['chromatic-wireless','chromatic']:
  root=package.parent/name
  archive.add(root,arcname=name,filter=lambda entry:None if entry.name.endswith('/dist/chromatic-wifi') or '/node_modules/' in entry.name else entry)
with tarfile.open(out/'chromatic-wifi-macos-arm64.tar.gz','w:gz') as archive:
 archive.add(package/'dist/chromatic-wifi',arcname='chromatic-wifi')
 for name in ['README.md','LICENSE','SOURCE.json','LICENSES']:archive.add(package/name,arcname=name)
for name in ['README.md','LICENSE','SOURCE.json']:shutil.copy2(package/name,out/name)
(out/'SHA256SUMS').write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(out.iterdir()) if p.is_file() and p.name not in ['SHA256SUMS','.gitignore']))
