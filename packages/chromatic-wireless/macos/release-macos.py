#!/usr/bin/env python3
"""Sign, notarize, staple and assess an already built Mac app. Never publishes unsigned builds.
Credentials: NOTARY_KEYCHAIN_PROFILE, or NOTARY_KEY_ID/NOTARY_ISSUER_ID/NOTARY_KEY_PATH.
SIGNING_IDENTITY may select a Developer ID Application certificate from the login keychain.
"""
import hashlib,json,os,pathlib,plistlib,re,subprocess,sys
app=pathlib.Path(sys.argv[1]).resolve()
out=pathlib.Path(sys.argv[2]).resolve();out.mkdir(parents=True,exist_ok=True)
root=pathlib.Path(__file__).resolve().parent
# Do not sign or submit an incomplete app, even if compilation itself succeeded.
for relative in ['Contents/Info.plist','Contents/MacOS/ChromaticHelper','Contents/MacOS/chromatic-wifi','Contents/Resources/LICENSE.txt','Contents/Resources/Bun-LICENSE.md','Contents/Resources/SOURCE-REVISION']:
    if not (app/relative).is_file():raise SystemExit('Incomplete app: missing '+relative)
info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
revision=(app/'Contents/Resources/SOURCE-REVISION').read_text().strip()
if not re.fullmatch('[a-f0-9]{40}',revision) or info.get('ChromaticSourceRevision')!=revision:raise SystemExit('App requires an exact source commit before distribution.')

def run(args):
    result=subprocess.run(args,capture_output=True,text=True)
    if result.returncode:
        message=result.stderr or result.stdout or 'No diagnostic output.'
        for field in ['NOTARY_KEY_ID','NOTARY_ISSUER_ID','NOTARY_KEY_PATH','SIGNING_IDENTITY']:
            if os.environ.get(field):message=message.replace(os.environ[field],'[redacted]')
        raise SystemExit(args[0]+' failed: '+message[:2000])
    return result.stdout
identity=os.environ.get('SIGNING_IDENTITY')
if not identity:
    identities=re.findall(r'\b([A-Fa-f0-9]{40})\s+"Developer ID Application:[^"\n]+"',run(['security','find-identity','-v','-p','codesigning']))
    if len(identities)!=1:raise SystemExit('Set SIGNING_IDENTITY to the intended Developer ID Application identity.')
    identity=identities[0]
if os.environ.get('NOTARY_KEYCHAIN_PROFILE'):
    auth=['--keychain-profile',os.environ['NOTARY_KEYCHAIN_PROFILE']]
else:
    required=['NOTARY_KEY_ID','NOTARY_ISSUER_ID','NOTARY_KEY_PATH']
    if not all(os.environ.get(k) for k in required):raise SystemExit('Configure Apple notarization credentials before signing a release.')
    auth=['--key',os.environ['NOTARY_KEY_PATH'],'--key-id',os.environ['NOTARY_KEY_ID'],'--issuer',os.environ['NOTARY_ISSUER_ID']]
helper=app/'Contents/MacOS/chromatic-wifi'
run(['codesign','--force','--options','runtime','--timestamp','--identifier','io.onkeel.chromatic-helper.transport','--entitlements',str(root/'helper.entitlements.plist'),'--sign',identity,str(helper)])
run(['codesign','--force','--options','runtime','--timestamp','--sign',identity,str(app)])
run(['codesign','--verify','--strict','--deep',str(app)])
print('Developer ID signatures verified. Submitting to Apple.',flush=True)
submission=out/'notary-submission.zip'
if submission.exists():raise SystemExit('Use a fresh release output directory.')
run(['ditto','-c','-k','--keepParent',str(app),str(submission)])
submitted=json.loads(run(['xcrun','notarytool','submit',str(submission),*auth,'--output-format','json']))
submission_id=submitted['id'];(out/'notary-submission.json').write_text(json.dumps(submitted,indent=2)+'\n')
print('Notarization submission: '+submission_id,flush=True)
result=json.loads(run(['xcrun','notarytool','wait',submission_id,*auth,'--output-format','json','--timeout','20m']))
(out/'notary-result.json').write_text(json.dumps(result,indent=2)+'\n')
if result.get('status')!='Accepted':
    try:(out/'notary-log.json').write_text(run(['xcrun','notarytool','log',submission_id,*auth]))
    except subprocess.CalledProcessError:pass
    raise SystemExit('Apple did not accept this build. No release archive was created; inspect the private notary log.')
run(['xcrun','stapler','staple',str(app)])
run(['xcrun','stapler','validate',str(app)])
run(['codesign','--verify','--strict','--deep',str(app)])
assessment=subprocess.run(['spctl','--assess','--type','execute','--verbose=4',str(app)],capture_output=True,text=True,check=True)
(out/'gatekeeper.txt').write_text(assessment.stdout+assessment.stderr)
archive=out/'Chromatic-Helper-macOS-arm64.zip'
run(['ditto','-c','-k','--keepParent',str(app),str(archive)])
info=plistlib.loads((app/'Contents/Info.plist').read_bytes())
manifest={'version':info['CFBundleShortVersionString'],'sourceRepository':'https://github.com/Ravonus/chromatic-helper','sourceRevision':info['ChromaticSourceRevision'],'artifact':archive.name,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'notarization':{'id':submission_id,'status':'Accepted','stapled':True},'gatekeeper':'accepted'}
(out/'release.json').write_text(json.dumps(manifest,indent=2)+'\n')
(out/'SHA256SUMS').write_text(manifest['sha256']+'  '+archive.name+'\n')
print('Accepted by Apple; stapled ticket and Gatekeeper assessment verified. '+str(archive),flush=True)
