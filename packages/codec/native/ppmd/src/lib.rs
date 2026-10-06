#![cfg(target_arch="wasm32")]
use std::{io::Read,alloc::{GlobalAlloc,Layout}};
use ppmd_rust::Ppmd7Decoder;
extern "C" {static __heap_base:u8;}
static mut NEXT:usize=0;
struct Arena;
unsafe impl GlobalAlloc for Arena {
 unsafe fn alloc(&self,layout:Layout)->*mut u8 {
  let base=std::ptr::addr_of!(__heap_base) as usize;
  if NEXT==0{NEXT=base}
  let start=(NEXT+layout.align()-1)&!(layout.align()-1);
  let end=match start.checked_add(layout.size()){Some(end) if end-base<=104*1024*1024=>end,_=>return std::ptr::null_mut()};
  let current=core::arch::wasm32::memory_size::<0>()*65536;
  if end>current&&core::arch::wasm32::memory_grow::<0>((end-current+65535)/65536)==usize::MAX{return std::ptr::null_mut()}
  NEXT=end;start as *mut u8
 }
 unsafe fn dealloc(&self,_:*mut u8,_:Layout){}
}
#[global_allocator]static ARENA:Arena=Arena;
#[no_mangle]pub unsafe extern "C" fn reset(){NEXT=std::ptr::addr_of!(__heap_base) as usize;}
#[no_mangle]pub extern "C" fn allocate(len:usize)->*mut u8 {if len>32*1024*1024{return std::ptr::null_mut()}Box::into_raw(vec![0u8;len].into_boxed_slice()) as *mut u8}
type Decoder=Ppmd7Decoder<&'static[u8]>;
#[no_mangle]pub unsafe extern "C" fn start(input:*const u8,ilen:usize,order:u32,memory:u32)->*mut Decoder{
 if input.is_null()||ilen>4*1024*1024||!(2..=16).contains(&order)||!(1<<20..=64<<20).contains(&memory){return std::ptr::null_mut()}
 match Ppmd7Decoder::new(std::slice::from_raw_parts(input,ilen),order,memory){Ok(decoder)=>Box::into_raw(Box::new(decoder)),Err(_)=>std::ptr::null_mut()}
}
#[no_mangle]pub unsafe extern "C" fn step(state:*mut Decoder,out:*mut u8,len:usize)->i32 {
 if state.is_null()||out.is_null()||len>65536{return -1}
 match (*state).read_exact(std::slice::from_raw_parts_mut(out,len)){Ok(_)=>0,Err(_)=>-2}
}
