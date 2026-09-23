//! Packed bytes: big-endian, fixed width, no padding (Solidity's abi.encodePacked), the
//! same as @keel-engine/proof's createPacker / createReader.
use crate::{Error, Result};
use alloc::vec::Vec;

#[derive(Default)]
pub struct Packer(pub Vec<u8>);

impl Packer {
    pub fn new() -> Self { Self(Vec::new()) }
    pub fn u8(mut self, v: u8) -> Self { self.0.push(v); self }
    pub fn u16(mut self, v: u16) -> Self { self.0.extend_from_slice(&v.to_be_bytes()); self }
    pub fn i16(mut self, v: i16) -> Self { self.0.extend_from_slice(&v.to_be_bytes()); self }
    pub fn u32(mut self, v: u32) -> Self { self.0.extend_from_slice(&v.to_be_bytes()); self }
    pub fn u64(mut self, v: u64) -> Self { self.0.extend_from_slice(&v.to_be_bytes()); self }
    pub fn u128(mut self, v: u128) -> Self { self.0.extend_from_slice(&v.to_be_bytes()); self }
    /// A u256 as its 32 big-endian bytes.
    pub fn u256(self, v: &[u8; 32]) -> Self { self.raw(v) }
    pub fn bytes32(self, v: &[u8; 32]) -> Self { self.raw(v) }
    pub fn bytes4(self, magic: &[u8; 4]) -> Self { self.raw(magic) }
    pub fn raw(mut self, v: &[u8]) -> Self { self.0.extend_from_slice(v); self }
    pub fn finish(self) -> Vec<u8> { self.0 }
}

pub struct Reader<'a> { b: &'a [u8], at: usize }

impl<'a> Reader<'a> {
    pub fn new(b: &'a [u8]) -> Self { Self { b, at: 0 } }
    pub fn take(&mut self, n: usize) -> Result<&'a [u8]> {
        if self.at + n > self.b.len() { return Err(Error::Malformed("read past the end")); }
        let s = &self.b[self.at..self.at + n];
        self.at += n;
        Ok(s)
    }
    fn arr<const N: usize>(&mut self) -> Result<[u8; N]> {
        let mut a = [0u8; N];
        a.copy_from_slice(self.take(N)?);
        Ok(a)
    }
    pub fn u8(&mut self) -> Result<u8> { Ok(self.take(1)?[0]) }
    pub fn u16(&mut self) -> Result<u16> { Ok(u16::from_be_bytes(self.arr()?)) }
    pub fn i16(&mut self) -> Result<i16> { Ok(i16::from_be_bytes(self.arr()?)) }
    pub fn u32(&mut self) -> Result<u32> { Ok(u32::from_be_bytes(self.arr()?)) }
    pub fn u64(&mut self) -> Result<u64> { Ok(u64::from_be_bytes(self.arr()?)) }
    pub fn u128(&mut self) -> Result<u128> { Ok(u128::from_be_bytes(self.arr()?)) }
    pub fn bytes32(&mut self) -> Result<[u8; 32]> { self.arr() }
    pub fn magic(&mut self, want: &[u8; 4]) -> Result<()> {
        if self.take(4)? != want { return Err(Error::Malformed("bad magic")); }
        Ok(())
    }
    pub fn remaining(&self) -> usize { self.b.len() - self.at }
    pub fn end(&self) -> Result<()> {
        if self.at != self.b.len() { return Err(Error::Malformed("trailing bytes")); }
        Ok(())
    }
}
