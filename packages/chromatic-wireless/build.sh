#!/bin/sh
set -eu
cd "$(dirname "$0")"
mkdir -p dist
emcc upstream/cwl_proto.c src/wasm.c -Iupstream -O3 -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,node -sFILESYSTEM=0 -sALLOW_MEMORY_GROWTH=1 -sEXPORTED_RUNTIME_METHODS=HEAPU8 '-sEXPORTED_FUNCTIONS=["_malloc","_free","_peer_new","_peer_free","_peer_poll","_peer_receive","_peer_arm","_peer_disarm","_peer_master","_peer_result","_peer_abandon","_peer_alive","_peer_event","_peer_pop","_peer_overflow"]' -o dist/cwl.mjs
