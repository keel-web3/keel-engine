;; Evidence only: exact-order scalar f64 road raster and nearest-cell reduction.
;; Layout offsets and bounds are supplied by wasm-raster.mjs. No host imports.
(module
  (memory (export "memory") 1 152)
  (func $lower (param $a f64) (param $b f64) (param $reach f64) (param $origin f64) (param $cell f64) (result i32)
    (i32.trunc_sat_f64_s
      (f64.max (f64.const 0)
        (f64.floor (f64.div
          (f64.sub (f64.sub (f64.min (local.get $a) (local.get $b)) (local.get $reach)) (local.get $origin))
          (local.get $cell))))))
  (func $upper (param $a f64) (param $b f64) (param $reach f64) (param $origin f64) (param $cell f64) (param $limit i32) (result i32)
    (i32.trunc_sat_f64_s
      (f64.min (f64.convert_i32_s (i32.sub (local.get $limit) (i32.const 1)))
        (f64.ceil (f64.div
          (f64.sub (f64.add (f64.max (local.get $a) (local.get $b)) (local.get $reach)) (local.get $origin))
          (local.get $cell))))))
  (func (export "raster")
    (param $m i32) (param $px i32) (param $pz i32) (param $profile i32)
    (param $x0 f64) (param $z0 f64) (param $cell f64) (param $w i32) (param $h i32) (param $reach f64)
    (param $wi0 i32) (param $wj0 i32) (param $ww i32) (param $cells i32)
    (param $seen i32) (param $bestD i32) (param $bestY i32) (param $local i32) (param $global i32) (param $epoch i32)
    (result i32)
    (local $n i32) (local $i i32) (local $j i32) (local $i0 i32) (local $i1 i32) (local $j0 i32) (local $j1 i32)
    (local $count i32) (local $at i32) (local $ptr i32)
    (local $ax f64) (local $az f64) (local $bx f64) (local $bz f64) (local $dx f64) (local $dz f64) (local $l2 f64)
    (local $cx f64) (local $cz f64) (local $t f64) (local $ex f64) (local $ez f64) (local $d f64) (local $height f64)
    (local.set $n (i32.const 1))
    (block $allDone
      (loop $segment
        (br_if $allDone (i32.ge_s (local.get $n) (local.get $m)))
        (local.set $ax (f64.load (i32.add (local.get $px) (i32.shl (i32.sub (local.get $n) (i32.const 1)) (i32.const 3)))))
        (local.set $az (f64.load (i32.add (local.get $pz) (i32.shl (i32.sub (local.get $n) (i32.const 1)) (i32.const 3)))))
        (local.set $bx (f64.load (i32.add (local.get $px) (i32.shl (local.get $n) (i32.const 3)))))
        (local.set $bz (f64.load (i32.add (local.get $pz) (i32.shl (local.get $n) (i32.const 3)))))
        (local.set $dx (f64.sub (local.get $bx) (local.get $ax)))
        (local.set $dz (f64.sub (local.get $bz) (local.get $az)))
        (local.set $l2 (f64.add (f64.mul (local.get $dx) (local.get $dx)) (f64.mul (local.get $dz) (local.get $dz))))
        (if (f64.eq (local.get $l2) (f64.const 0)) (then (local.set $l2 (f64.const 1))))
        (local.set $i0 (call $lower (local.get $ax) (local.get $bx) (local.get $reach) (local.get $x0) (local.get $cell)))
        (local.set $i1 (call $upper (local.get $ax) (local.get $bx) (local.get $reach) (local.get $x0) (local.get $cell) (local.get $w)))
        (local.set $j0 (call $lower (local.get $az) (local.get $bz) (local.get $reach) (local.get $z0) (local.get $cell)))
        (local.set $j1 (call $upper (local.get $az) (local.get $bz) (local.get $reach) (local.get $z0) (local.get $cell) (local.get $h)))
        (local.set $j (local.get $j0))
        (block $rowsDone
          (loop $row
            (br_if $rowsDone (i32.gt_s (local.get $j) (local.get $j1)))
            (local.set $i (local.get $i0))
            (block $colsDone
              (loop $col
                (br_if $colsDone (i32.gt_s (local.get $i) (local.get $i1)))
                (local.set $cx (f64.add (local.get $x0) (f64.mul (f64.convert_i32_s (local.get $i)) (local.get $cell))))
                (local.set $cz (f64.add (local.get $z0) (f64.mul (f64.convert_i32_s (local.get $j)) (local.get $cell))))
                (local.set $t
                  (f64.max (f64.const 0)
                    (f64.min (f64.const 1)
                      (f64.div
                        (f64.add
                          (f64.mul (f64.sub (local.get $cx) (local.get $ax)) (local.get $dx))
                          (f64.mul (f64.sub (local.get $cz) (local.get $az)) (local.get $dz)))
                        (local.get $l2)))))
                (local.set $ex (f64.sub (f64.add (local.get $ax) (f64.mul (local.get $dx) (local.get $t))) (local.get $cx)))
                (local.set $ez (f64.sub (f64.add (local.get $az) (f64.mul (local.get $dz) (local.get $t))) (local.get $cz)))
                (local.set $d (f64.sqrt (f64.add (f64.mul (local.get $ex) (local.get $ex)) (f64.mul (local.get $ez) (local.get $ez)))))
                (if (i32.eqz (f64.gt (local.get $d) (local.get $reach)))
                  (then
                    (local.set $at
                      (i32.add
                        (i32.mul (i32.sub (local.get $j) (local.get $wj0)) (local.get $ww))
                        (i32.sub (local.get $i) (local.get $wi0))))
                    (if (i32.or (i32.lt_s (local.get $at) (i32.const 0)) (i32.ge_s (local.get $at) (local.get $cells))) (then unreachable))
                    (local.set $ptr (i32.add (local.get $seen) (i32.shl (local.get $at) (i32.const 2))))
                    (if (i32.or
                          (i32.ne (i32.load (local.get $ptr)) (local.get $epoch))
                          (f64.lt (local.get $d) (f64.load (i32.add (local.get $bestD) (i32.shl (local.get $at) (i32.const 3))))))
                      (then
                        (local.set $height
                          (f64.add
                            (f64.load (i32.add (local.get $profile) (i32.shl (i32.sub (local.get $n) (i32.const 1)) (i32.const 3))))
                            (f64.mul
                              (f64.sub
                                (f64.load (i32.add (local.get $profile) (i32.shl (local.get $n) (i32.const 3))))
                                (f64.load (i32.add (local.get $profile) (i32.shl (i32.sub (local.get $n) (i32.const 1)) (i32.const 3)))))
                              (local.get $t))))
                        (if (i32.ne (i32.load (local.get $ptr)) (local.get $epoch))
                          (then
                            (i32.store (local.get $ptr) (local.get $epoch))
                            (i32.store (i32.add (local.get $local) (i32.shl (local.get $count) (i32.const 2))) (local.get $at))
                            (f64.store (i32.add (local.get $global) (i32.shl (local.get $count) (i32.const 3)))
                              (f64.add (f64.mul (f64.convert_i32_s (local.get $j)) (f64.convert_i32_s (local.get $w))) (f64.convert_i32_s (local.get $i))))
                            (local.set $count (i32.add (local.get $count) (i32.const 1)))))
                        (f64.store (i32.add (local.get $bestD) (i32.shl (local.get $at) (i32.const 3))) (local.get $d))
                        (f64.store (i32.add (local.get $bestY) (i32.shl (local.get $at) (i32.const 3))) (local.get $height))))))
                (local.set $i (i32.add (local.get $i) (i32.const 1)))
                (br $col)))
            (local.set $j (i32.add (local.get $j) (i32.const 1)))
            (br $row)))
        (local.set $n (i32.add (local.get $n) (i32.const 1)))
        (br $segment)))
    (local.get $count))
)
