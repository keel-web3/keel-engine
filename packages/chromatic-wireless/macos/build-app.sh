#!/bin/bash
# SPDX-License-Identifier: MIT
# Build locally; distribution requires release-macos.py and a real Developer ID.
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
out="${1:?Pass an output directory}"
revision="${2:-$(git -C "$root" rev-parse HEAD)}"
version="${CHROMATIC_VERSION:-0.2.0}"
app="$out/Chromatic Helper.app"
[ ! -e "$app" ] || { echo 'Use a fresh output directory.' >&2; exit 1; }
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
"${BUN_BIN:-bun}" build "$root/helper/main.mjs" --compile --target=bun-darwin-arm64 --outfile "$app/Contents/MacOS/chromatic-wifi"
xcrun swiftc -O -target arm64-apple-macos13.0 -framework AppKit "$root/macos/HelperApp.swift" -o "$app/Contents/MacOS/ChromaticHelper"
python3 - "$app" "$version" "$revision" <<'PY'
import sys,plistlib,pathlib
app,version,revision=sys.argv[1:]
p={'CFBundleName':'Chromatic Helper','CFBundleDisplayName':'Chromatic Helper','CFBundleIdentifier':'io.onkeel.chromatic-helper','CFBundleExecutable':'ChromaticHelper','CFBundlePackageType':'APPL','CFBundleShortVersionString':version,'CFBundleVersion':version,'LSMinimumSystemVersion':'13.0','NSHighResolutionCapable':True,'NSLocalNetworkUsageDescription':'Connect to your selected Chromatic on your local network for the Wi-Fi game-link check.','ChromaticSourceRevision':revision}
pathlib.Path(app,'Contents','Info.plist').write_bytes(plistlib.dumps(p))
PY
cp "$root/LICENSES/MIT.txt" "$app/Contents/Resources/LICENSE.txt"
cp "$root/LICENSES/Bun.md" "$app/Contents/Resources/Bun-LICENSE.md"
printf '%s\n' "$revision" > "$app/Contents/Resources/SOURCE-REVISION"
echo "Built $app (not yet signed or notarized)."
