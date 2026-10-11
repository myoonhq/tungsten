# Tungsten API layer

Framework-neutral TypeScript schema/state DTOs, worker protocol, and the WASM
transport live here. This is an internal source boundary; it is
bundled into `@myoonhq/tungsten` rather than published independently.

Do not add React components or design-system styling to this directory.


Sprout schemas use `{ schemaVersion: "sprout", form: [...] }`. Groups preserve
`subform` trees through the WASM load response. Runtime field state uses concrete
canonical leaf paths, while initial and submitted data use recursive arrays for
repeaters. Worker load responses include the
validated schema, and correlated load/patch/validate commands run FIFO.
