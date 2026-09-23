//! The generic staked match: @keel-engine/arena's match.ts, merkle.ts and format.ts.
//! A format's guest calls `run_format` with the input bytes and the witness; it checks the
//! witness against the input's digests, hands the decoded match to the format's rules, and
//! returns the public values to commit.
use crate::bytes::{Packer, Reader};
use crate::{program_id, public_values, sha256, Error, Result};
use alloc::vec::Vec;

pub const MAX_PLACINGS: usize = 32;
pub const ENTRANT_BYTES: usize = 112;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entrant {
    /// uint256, big-endian.
    pub token_id: [u8; 32],
    pub seed: [u8; 32],
    pub stake: u128,
    pub config: [u8; 32],
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct MatchInput {
    pub format_id: u32,
    pub match_id: u64,
    pub params_digest: [u8; 32],
    pub track_digest: [u8; 32],
    pub seed: [u8; 32],
    pub n: u32,
    pub entrants_digest: [u8; 32],
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Placing { pub entrant: u32, pub score: u32 }

pub struct Match<'a> {
    pub match_id: u64,
    pub seed: [u8; 32],
    pub params: &'a [u8],
    pub track: Option<&'a [u8]>,
    pub entrants: Vec<Entrant>,
}

pub struct MatchRun { pub placings: Vec<Placing>, pub spent: Vec<u128> }

fn entrant_bytes(p: Packer, e: &Entrant) -> Packer { p.u256(&e.token_id).bytes32(&e.seed).u128(e.stake).bytes32(&e.config) }

pub fn entrants_digest(match_id: u64, entrants: &[Entrant]) -> [u8; 32] {
    let mut d = sha256(&Packer::new().bytes4(b"HSME").u64(match_id).finish());
    for e in entrants { d = sha256(&entrant_bytes(Packer::new().bytes32(&d), e).finish()); }
    d
}

pub fn decode_entrants(b: &[u8]) -> Result<Vec<Entrant>> {
    if b.len() % ENTRANT_BYTES != 0 { return Err(Error::Malformed("the entrant list is whole 112-byte records")); }
    let mut r = Reader::new(b);
    let mut out = Vec::with_capacity(b.len() / ENTRANT_BYTES);
    while r.remaining() > 0 {
        out.push(Entrant { token_id: r.bytes32()?, seed: r.bytes32()?, stake: r.u128()?, config: r.bytes32()? });
    }
    Ok(out)
}

pub fn encode_match_input(m: &MatchInput) -> Vec<u8> {
    Packer::new().bytes4(b"HSMI").u8(1).u32(m.format_id).u64(m.match_id).bytes32(&m.params_digest).bytes32(&m.track_digest)
        .bytes32(&m.seed).u32(m.n).bytes32(&m.entrants_digest).finish()
}

pub fn decode_match_input(b: &[u8]) -> Result<MatchInput> {
    let mut r = Reader::new(b);
    r.magic(b"HSMI")?;
    if r.u8()? != 1 { return Err(Error::Malformed("unknown match input version")); }
    let m = MatchInput {
        format_id: r.u32()?, match_id: r.u64()?, params_digest: r.bytes32()?, track_digest: r.bytes32()?,
        seed: r.bytes32()?, n: r.u32()?, entrants_digest: r.bytes32()?,
    };
    r.end()?;
    Ok(m)
}

pub fn settlement_leaf(index: u32, token_id: &[u8; 32], spent: u128) -> [u8; 32] {
    sha256(&Packer::new().u8(0).u32(index).u256(token_id).u128(spent).finish())
}

fn node(l: &[u8; 32], r: &[u8; 32]) -> [u8; 32] { sha256(&Packer::new().u8(1).bytes32(l).bytes32(r).finish()) }

pub fn settlement_root(mut level: Vec<[u8; 32]>) -> [u8; 32] {
    while level.len() > 1 {
        let mut up = Vec::with_capacity((level.len() + 1) / 2);
        let mut i = 0;
        while i < level.len() {
            up.push(if i + 1 < level.len() { node(&level[i], &level[i + 1]) } else { level[i] });
            i += 2;
        }
        level = up;
    }
    level[0]
}

/// Checks a run against the format contract and encodes the MatchResult ("HSMR").
pub fn encode_result(entrants: &[Entrant], run: &MatchRun, inline_max: usize) -> Result<Vec<u8>> {
    let n = entrants.len();
    if run.spent.len() != n { return Err(Error::Run("a run reports spend for every entrant")); }
    if run.placings.len() > MAX_PLACINGS { return Err(Error::Run("at most 32 placings")); }
    let mut seen = Vec::with_capacity(run.placings.len());
    for p in &run.placings {
        if p.entrant as usize >= n || seen.contains(&p.entrant) { return Err(Error::Run("placings name distinct entrants")); }
        seen.push(p.entrant);
    }
    for (i, s) in run.spent.iter().enumerate() {
        if *s > entrants[i].stake { return Err(Error::Run("an entrant spent more than its stake")); }
    }
    let mut p = Packer::new().bytes4(b"HSMR").u8(1).u32(n as u32).u8(run.placings.len() as u8);
    for x in &run.placings { p = p.u32(x.entrant).u32(x.score); }
    if n <= inline_max {
        p = p.u8(0);
        for s in &run.spent { p = p.u128(*s); }
    } else {
        let leaves = entrants.iter().enumerate().map(|(i, e)| settlement_leaf(i as u32, &e.token_id, run.spent[i])).collect();
        let total: u128 = run.spent.iter().sum();
        p = p.u8(1).bytes32(&settlement_root(leaves)).u128(total);
    }
    Ok(p.finish())
}

pub struct Format<'a> {
    /// "game/format@version".
    pub id: &'a str,
    pub format_id: u32,
    pub inline_max: usize,
}

/// What a format's guest does: check the witness, run the rules, return the public values.
pub fn run_format(
    f: &Format,
    input_bytes: &[u8],
    params: &[u8],
    track: Option<&[u8]>,
    entrants_bytes: &[u8],
    rules: impl FnOnce(&Match) -> Result<MatchRun>,
) -> Result<Vec<u8>> {
    let m = open_match(f, input_bytes, params, track, entrants_bytes)?;
    let run = rules(&m)?;
    let result = encode_result(&m.entrants, &run, f.inline_max)?;
    Ok(public_values(&program_id(f.id), &sha256(input_bytes), &result))
}

/// Checks the witness against the input's digests and opens the match (what every guest of a format starts with).
pub fn open_match<'a>(f: &Format, input_bytes: &[u8], params: &'a [u8], track: Option<&'a [u8]>, entrants_bytes: &[u8]) -> Result<Match<'a>> {
    let input = decode_match_input(input_bytes)?;
    if input.format_id != f.format_id { return Err(Error::Witness("the input is another format's")); }
    if sha256(params) != input.params_digest { return Err(Error::Witness("the params are not the ones the match committed to")); }
    let track_digest = match track { Some(t) => sha256(t), None => [0u8; 32] };
    if track_digest != input.track_digest { return Err(Error::Witness("the track is not the one the match committed to")); }
    let entrants = decode_entrants(entrants_bytes)?;
    if entrants.len() != input.n as usize || entrants_digest(input.match_id, &entrants) != input.entrants_digest {
        return Err(Error::Witness("the entrants are not the ones the match committed to"));
    }
    Ok(Match { match_id: input.match_id, seed: input.seed, params, track, entrants })
}
