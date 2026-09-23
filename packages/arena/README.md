# @keel-engine/arena

Matches between staked tokens that a contract settles from a zk proof — any number of
entrants, any rules. Every **format** commits to the same generic input and yields the
same generic result, so a game adds a kind of match (a 20-car sprint, a 10 000-car
royale, a tournament round) by writing one `defineMatchFormat` and registering its
program on-chain. The contract never learns the rules.

```
MatchInput  "HSMI" v1 · formatId · matchId · paramsDigest · trackDigest · seed · n · entrantsDigest
Entrant     uint256 tokenId · bytes32 seed · uint128 stake · bytes32 config        (112 bytes)
chain       d0 = sha256("HSME" ‖ matchId), d(i+1) = sha256(d(i) ‖ entrant i)      one slot for any field size
MatchResult "HSMR" v1 · n · k ≤ 32 placings (entrant, score) · inline spent[n]  |  merkle root + totalSpent
```

```ts
import { defineMatchFormat } from "@keel/game-engine/arena";

export const SPRINT = defineMatchFormat<SprintParams>({
  id: "hashers/sprint@1", formatId: 1, inlineMax: 64,
  encodeParams, decodeParams,
  run: ({ seed, params, track, entrants }) => ({ placings, spent }),   // your rules, provable integers
});
SPRINT.execute(SPRINT.inputOf(match), SPRINT.witnessOf(match));      // what the prover runs
```

`defineMatchFormat` does the rest once for every format: it checks the params, track and entrant
list against their digests, enforces `spent ≤ stake` and distinct placings, and picks the
settlement — **inline** up to `inlineMax` entrants (every stake applied in the settle call), a
**Merkle root** past it (entrants claim with `settlementTree(...).proof(i)`; leaves and nodes are
domain-separated sha256, `verifySettlement` is exactly what the contract runs).

The Rust twin is the `arena` module of crate `keel-proof` (`zk/keel-proof`): `run_format` checks the
same digests and encodes the same result, so a guest is a few lines around the format's rules.
Operators prepare, audit and claim from the SDK: `pnpm game:arena prepare|audit|claim`.
