# `@myoonhq/tungsten/react`

React bindings and the default design for the Tungsten form engine, published
from the private `@myoonhq/tungsten` GitHub package.

The package contains the Rust/WASM runtime and runs it in a dedicated worker.
Consumers pass a schema object directly; no repository source imports or
separate core installation are required.

## Usage

```tsx
import { Tungsten } from '@myoonhq/tungsten/react'
import schema from './form.schema.json'

export function Form() {
  return (
    <Tungsten
      schema={schema}
      onSubmit={(values) => {
        console.log(values)
      }}
    />
  )
}
```

The default Tungsten design and its scoped CSS are installed automatically.
The main integration props are:

- `schema`: a direct JSON-compatible `{ schemaVersion: "sprout", form: [...] }` object;
- `design`: an optional React design adapter;
- `initialValues`: canonical input data, including recursive repeater arrays;
- `config` and `dataSources`: transport, operations, localization and named sources;
- `language`: presentation language, independent of stored values;
- `onReady`: access to reset, value loading and file preparation;
- `onStateChange` and `onDiagnostic`: evaluated state and structured diagnostics;
- `onSave`: optional draft saving after the configured debounce;
- `onSubmit`: called with the current value record only after full-form
  validation and file preparation succeed. With a configured submission endpoint,
  it instead observes the settled endpoint outcome, including failures.

## Light and dark mode

Pass `colorScheme="light"` or `colorScheme="dark"` to `Tungsten` or
`TungstenEditor`. Omitted choices inherit `TungstenThemeProvider`, otherwise light.
The application resolves system preferences and owns persistence. Theme changes
preserve edits, errors, focus and editor drafts.

```tsx
import { TungstenThemeProvider } from '@myoonhq/tungsten/react'

<TungstenThemeProvider colorScheme={appColorScheme}>
  <Tungsten schema={schema} onSubmit={handleSubmit} />
</TungstenThemeProvider>
```

## Design hierarchy

The built-in adapter is available as a nested export:

```tsx
import { Tungsten } from '@myoonhq/tungsten/react';
import tungsten from '@myoonhq/tungsten/react/design/tungsten';

<Tungsten schema={schema} design={tungsten} onSubmit={handleSubmit} />
```

Design-only consumers can import the stylesheet explicitly:

```ts
import '@myoonhq/tungsten/react/design/tungsten.css'
```

Future adapters follow the same host-first hierarchy:

```text
@myoonhq/tungsten/react/design/bootstrap
@myoonhq/tungsten/react/design/material
@myoonhq/tungsten/angular/design/tungsten
```

The design object owns React components and field renderer registration. The
main `Tungsten` component performs lookup by the schema's string field type and
does not branch on built-in field names.

## Groups and design contracts

Groups use `type: "group"`, a basic/sectioned `variant`, a globally unique `key`,
required `render: { type, settings }`, and `subform`. A basic group can contain
fields and groups; a sectioned group contains basic groups only. A plain basic
group uses `render: { type: "group", settings: {} }`.

The host renders the tree returned by the engine, keeps inactive sections in
full-form validation/submission, and reveals/focuses invalid nested fields.
The same mounted worker preserves runtime state across group-only presentation
changes. Changes to ordered leaf declarations initialize a fresh form.

Designs may register `groups: { tabs: { variant: "sectioned", Renderer } }`.
`GroupRendererProps` provides recursively rendered basic children or section
content, derived error counts, and invalid-field reveal requests without scalar
group state. The default design exports all group components and its renderer
registry from the public design entry.

See the repository's [UI contract](https://tungsten.myoon.sk/documentation/?guide=ui) and
[Sprout schema contract](https://tungsten.myoon.sk/documentation/?guide=schema).

## Development and publishing

The package manifest and build configuration are at `packages/tungsten`.
Run `pnpm build:library` from the monorepo root, then `pnpm test:package` to verify
the packed library outside the workspace. See the root README and
the package README for registry authentication and release commands.
