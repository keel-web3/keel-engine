//! Stepped sims (the Rust twin of @keel-engine/proof stepped.ts): simultaneous ticks, so a run is
//! proven as (entity, window) jobs plus one aggregation. A game implements `Stepped`; the job guest
//! calls `prove_job`, the aggregator guest calls `aggregate`.
use crate::bytes::{Packer, Reader};
use crate::{sha256, Error, Result};
use alloc::vec::Vec;

pub trait Stepped {
    type Ctx;
    type Entity: Clone;
    /// Entity `i` at `tick`, from the whole field at `tick - 1`.
    fn step(&self, ctx: &mut Self::Ctx, prev: &[Self::Entity], i: usize, tick: u32) -> Self::Entity;
    fn done(&self, ctx: &Self::Ctx, field: &[Self::Entity], tick: u32) -> bool;
    fn encode(&self, e: &Self::Entity) -> Vec<u8>;
    fn decode(&self, b: &[u8]) -> Result<Self::Entity>;
    /// Encoded size of one entity (fixed: the witness is a flat array of them).
    const ENTITY_BYTES: usize;
}

pub fn field_hash<S: Stepped>(s: &S, field: &[S::Entity]) -> [u8; 32] {
    let mut p = Packer::new();
    for e in field { p = p.raw(&s.encode(e)); }
    sha256(&p.finish())
}

/// One entity's states hashed flat (fixed-size encodings, so unambiguous): half the blocks of a per-state chain.
pub fn trace_hash<S: Stepped>(s: &S, states: &[S::Entity]) -> [u8; 32] {
    let mut buf = Vec::with_capacity(states.len() * S::ENTITY_BYTES);
    for e in states { buf.extend_from_slice(&s.encode(e)); }
    sha256(&buf)
}

/// A job's witness: the window, the entity, the field at `from - 1`, and every entity's states across the window.
pub struct JobWitness<E> { pub window: u32, pub from: u32, pub to: u32, pub entity: u32, pub boundary: Vec<E>, pub traces: Vec<Vec<E>> }

/// "HSJW" v1: u32 window · u32 from · u32 to · u32 entity · u32 n · boundary n entities · traces n x (to-from+1) entities (entity-major).
pub fn decode_witness<S: Stepped>(s: &S, b: &[u8]) -> Result<JobWitness<S::Entity>> {
    let mut r = Reader::new(b);
    r.magic(b"HSJW")?;
    if r.u8()? != 1 { return Err(Error::Malformed("unknown job witness version")); }
    let (window, from, to, entity, n) = (r.u32()?, r.u32()?, r.u32()?, r.u32()?, r.u32()? as usize);
    if to < from || entity as usize >= n { return Err(Error::Malformed("bad job window")); }
    let len = (to - from + 1) as usize;
    let take = |r: &mut Reader| s.decode(r.take(S::ENTITY_BYTES)?);
    let mut boundary = Vec::with_capacity(n);
    for _ in 0..n { boundary.push(take(&mut r)?); }
    let mut traces = Vec::with_capacity(n);
    for _ in 0..n { let mut t = Vec::with_capacity(len); for _ in 0..len { t.push(take(&mut r)?); } traces.push(t); }
    r.end()?;
    Ok(JobWitness { window, from, to, entity, boundary, traces })
}

pub struct JobOutput<E> { pub window: u32, pub from: u32, pub to: u32, pub entity: u32, pub boundary: [u8; 32], pub traces: Vec<[u8; 32]>, pub computed: [u8; 32], pub last: E }

/// "HSJO" v1: u32 window · u32 from · u32 to · u32 entity · bytes32 boundary · u32 n · n x bytes32 traces · bytes32 computed · last entity.
pub fn encode_output<S: Stepped>(s: &S, o: &JobOutput<S::Entity>) -> Vec<u8> {
    let mut p = Packer::new().bytes4(b"HSJO").u8(1).u32(o.window).u32(o.from).u32(o.to).u32(o.entity).bytes32(&o.boundary).u32(o.traces.len() as u32);
    for t in &o.traces { p = p.bytes32(t); }
    p.bytes32(&o.computed).raw(&s.encode(&o.last)).finish()
}

pub fn decode_output<S: Stepped>(s: &S, b: &[u8]) -> Result<JobOutput<S::Entity>> {
    let mut r = Reader::new(b);
    r.magic(b"HSJO")?;
    if r.u8()? != 1 { return Err(Error::Malformed("unknown job output version")); }
    let (window, from, to, entity, boundary) = (r.u32()?, r.u32()?, r.u32()?, r.u32()?, r.bytes32()?);
    let n = r.u32()? as usize;
    let mut traces = Vec::with_capacity(n);
    for _ in 0..n { traces.push(r.bytes32()?); }
    let computed = r.bytes32()?;
    let last = s.decode(r.take(S::ENTITY_BYTES)?)?;
    r.end()?;
    Ok(JobOutput { window, from, to, entity, boundary, traces, computed, last })
}

/// The job program: re-derive entity `i` across the window from the witnessed field.
pub fn prove_job<S: Stepped>(s: &S, ctx: &mut S::Ctx, j: &JobWitness<S::Entity>) -> Result<JobOutput<S::Entity>> {
    let n = j.boundary.len();
    if j.traces.len() != n { return Err(Error::Witness("the witness is missing an entity")); }
    let mut computed: Vec<S::Entity> = Vec::new();
    let mut prev: Vec<S::Entity> = j.boundary.clone();
    for (k, t) in (j.from..=j.to).enumerate() {
        if k > 0 { prev = j.traces.iter().map(|tr| tr[k - 1].clone()).collect(); }
        computed.push(s.step(ctx, &prev, j.entity as usize, t));
    }
    Ok(JobOutput {
        window: j.window, from: j.from, to: j.to, entity: j.entity,
        boundary: field_hash(s, &j.boundary),
        traces: j.traces.iter().map(|tr| trace_hash(s, tr)).collect(),
        computed: trace_hash(s, &computed),
        last: computed.last().cloned().ok_or(Error::Witness("an empty window"))?,
    })
}

/// The aggregator's checks over every (verified) job output: tiling, agreement, chaining, completion.
/// `start` is the initial field (from the match input). Returns the final field and its tick.
pub fn aggregate<S: Stepped>(s: &S, ctx: &S::Ctx, start: Vec<S::Entity>, mut outs: Vec<JobOutput<S::Entity>>) -> Result<(Vec<S::Entity>, u32)> {
    let n = start.len();
    outs.sort_by(|a, b| a.window.cmp(&b.window).then(a.entity.cmp(&b.entity)));
    if outs.is_empty() || outs.len() % n != 0 { return Err(Error::Run("jobs do not tile the run")); }
    let mut field = start;
    let mut expect_from = 1u32;
    let windows = outs.len() / n;
    for w in 0..windows {
        let jobs = &outs[w * n..(w + 1) * n];
        let (from, to) = (jobs[0].from, jobs[0].to);
        for (i, o) in jobs.iter().enumerate() {
            if o.window != w as u32 || o.entity != i as u32 { return Err(Error::Run("a window needs exactly one job per entity")); }
            if o.from != from || o.to != to || from != expect_from { return Err(Error::Run("a window does not continue the run")); }
            if o.traces.len() != n || o.traces != jobs[0].traces { return Err(Error::Run("jobs witnessed different traces")); }
            if o.computed != o.traces[i] { return Err(Error::Run("a witnessed trace is not what the rules produce")); }
        }
        let boundary = field_hash(s, &field);
        if jobs.iter().any(|o| o.boundary != boundary) { return Err(Error::Run("a job started from another field")); }
        field = jobs.iter().map(|o| o.last.clone()).collect();
        expect_from = to + 1;
        let is_last = w + 1 == windows;
        if is_last != s.done(ctx, &field, to) { return Err(Error::Run(if is_last { "the run ends before it is done" } else { "the run continues after it was done" })); }
    }
    Ok((field, expect_from - 1))
}
