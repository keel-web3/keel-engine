# Native impact pixel lighting

`keel/pinball-room-lighting` adds two indexed reflected-light ramps to selected
material colours, then paints bounded light pools at actual native feedback
pulse positions. Original shade clusters remain visible. Current characters,
blades and impact sprites draw afterwards; this is a cosmetic pass.

The plan owns frozen palettes and private index maps. Each pass validates all
pulses and projections before writing, respects the existing pixel clip, and
uses at most four visible lights with a maximum 64-pixel radius. Reduced
motion disables flash lighting. Pulse ties use explicit code-unit ordering.

Source parity checks include actual physical25 feedback, palette rejection,
clipping, reduced motion and invalid late pulses. The separate SDK receipt
does not establish whole-game or artistic acceptance. The shared SDK IIFE
loader still has its documented unsupported preexisting-page-`require`
context; the prototype imports canonical source and defines no such resolver.
