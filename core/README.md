# Tungsten core

Rust schema compilation, field behavior, deterministic graph processing,
validation, and WASM runtime for Tungsten.

The public compiler accepts a Sprout `RawSchema` with `schemaVersion` and `form`.
Structural groups validate and expand into ordered scalar fields; the original
tree and leaf source locations remain available in `CompiledSchema`. Groups
have no field behavior, graph node, value, or runtime state.

See the maintained [core contract](https://tungsten.myoon.sk/documentation/?guide=core),
[schema contract](https://tungsten.myoon.sk/documentation/?guide=schema), and
[field contract](https://tungsten.myoon.sk/documentation/?guide=fields).

Initialize with `Engine::from_compiled`, then call `load_values(None)` or supply
a `FormValues` record. Loading fills all inputs, evaluates rules and validates
the full form. It can be called again without recompiling; missing keys use
schema/type defaults. Failed loads retain state.

## Verification

```sh
cargo fmt --all -- --check
cargo test
cargo test --all-targets
cargo check --target wasm32-unknown-unknown
wasm-pack test --headless --chrome
TUNGSTEN_BENCH_MAX_MS=2000 ./scripts/bench.sh
```

Presentation reloads preserve runtime state only when ordered expanded field
declarations are identical. Nested repeaters support adding, removing and
reordering instances while retaining row identity and projecting recursive data
arrays. General schema/state migration remains outside the current contract.
