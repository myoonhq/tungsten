# Tungsten

Deterministic schema-driven forms, powered by a Rust/WASM engine and rendered
through React. Install the `@myoon/tungsten` package in your React application.

## Install

```sh
npm install @myoon/tungsten
```

React 18.3 or 19 is a peer dependency.
Public packages are distributed through npm. Install Tungsten with:

```sh
npm install @myoon/tungsten
```

The default installation initially provides a qualification release during public testing, then follows stable releases.
To opt into newer testing releases, use `@next`; development releases use `@dev`.
No private registry configuration or access token is needed by consumers.

```tsx
import { Tungsten } from '@myoon/tungsten/react'
import schema from './form.schema.json'

export function Form() {
  return <Tungsten schema={schema} onSubmit={values => console.log(values)} />
}
```

The default design is included. An explicit adapter can be imported from
`@myoon/tungsten/react/design/tungsten`, and its stylesheet from
`@myoon/tungsten/react/design/tungsten.css`.

## Bootstrap design

The optional Bootstrap adapter ships in the same package. Install
`bootstrap@^5.3.8` only when using it, then load Bootstrap CSS before the adapter CSS:

```tsx
import { Tungsten } from '@myoon/tungsten/react'
import bootstrap from '@myoon/tungsten/react/design/bootstrap'
import 'bootstrap/dist/css/bootstrap.min.css'
import '@myoon/tungsten/react/design/bootstrap.css'

<Tungsten schema={schema} design={bootstrap} colorScheme="dark" onSubmit={save} />
```

Bootstrap 5.3.8 is qualified; the supported peer range is `^5.3.8`. The adapter
supports every existing field, group and repeater setting in light and dark mode.
It uses Bootstrap CSS and shared controlled Tungsten widgets; Bootstrap JavaScript
and React-Bootstrap are unnecessary. The default design works without Bootstrap.
The editor's `design` prop selects its preview while authoring/settings keep the
Tungsten design. Bootstrap's global Reboot styles are part of its stylesheet.

## Material design

The optional `material` adapter also ships with Tungsten. Install its external peers:

```sh
npm install @myoon/tungsten @mui/material@^9.5.0 @emotion/react@^11.14.0 @emotion/styled@^11.14.1
```

```tsx
import { Tungsten } from '@myoon/tungsten/react'
import material from '@myoon/tungsten/react/design/material'
import '@myoon/tungsten/react/design/material.css'

<Tungsten schema={schema} design={material} colorScheme="dark" language="de" />
```

See [Material setup, theme customization and React 18 requirements](design/material/README.md).
All three designs cover the same fields, groups and repeaters. The site's editor
and examples have independent design, light/dark and language settings, saved per page.
Their selections preserve edits and do not change the website's preferences.

## Light and dark mode

Pass `colorScheme="light"` or `colorScheme="dark"` to `Tungsten` or
`TungstenEditor`. Omitted choices inherit `TungstenThemeProvider`, otherwise light.
The application resolves system preferences and owns persistence. Theme changes
preserve edits, errors, focus and editor drafts.
The default design uses a green Sprout palette in dark mode. The Editor's authoring
controls share the default form palette in both schemes; selecting Bootstrap or
Material changes its live preview while the authoring controls remain Tungsten.

```tsx
import { TungstenThemeProvider } from '@myoon/tungsten/react'

<TungstenThemeProvider colorScheme={appColorScheme}>
  <Tungsten schema={schema} onSubmit={handleSubmit} />
</TungstenThemeProvider>
```

## Initial values

```tsx
const initialValues = { 'person.name': 'Ada', 'person.enabled': false }

<Tungsten schema={schema} initialValues={initialValues} onSubmit={handleSubmit} />
```

Use canonical field keys, including those inside groups. Supplied values override
schema `current_value` defaults; absent keys use schema/type defaults. Omitted or
null initial values load defaults. Explicit null, false, zero and empty strings
remain values. Keep the input object stable across unrelated React renders.

All inputs populate before rules run; derived visibility/errors and full-form
validation are ready on first render. Unknown keys and wrong types fail loading;
validation errors remain editable. Changed data loads again; presentation-only
changes with equal initial data preserve user edits. Only values load/submit,
not navigation, visibility or error state.

## Repeaters

Repeaters use `type: 'repeater'`, fully qualified keys in `template`, and
`render: { type: 'undereachother' | 'tabs', settings: {} }`. There is no variant.
Root `min` defaults to zero; omitted `max` is unlimited; `reorder: true` enables
movement. A repeater's `required` validator is accepted but has no effect.

A `person.name` template field loads/submits through
`initialValues={{ person: [{ name: 'Ada' }] }}`. Grouped item paths become nested
objects. Rules use `person[current].name` inside the owning template or an
explicit position such as `person[2].name`. Unindexed repeater rule references
remain unsupported for now. Nested repeaters use the same mechanism recursively:
`people[current].children[current].name` resolves each owning instance, and child
arrays load/submit inside parent items.

ADD, REMOVE and reorder update the concrete graph through structural APIs while
preserving surviving data and identity. No whole-state rebuild occurs on those
controls. Custom designs register collection renderers in `design.repeaters`;
all renderers use the same `RepeaterRendererProps` interface.

See the [repeater documentation](https://tungsten.myoon.sk/documentation/?guide=repeaters) and the public
[Repeater example](https://tungsten.myoon.sk/examples/?example=repeaters) for complete examples and reference-removal policy.

## Source layers

- `core/`: Rust compiler, registry, runtime, and WASM interface.
- `api/`: framework-neutral types, worker protocol, and transport.
- `framework/react/`: React integration and its tests.
- `design/tungsten/`: default React renderers and shared interaction primitives.
- `design/bootstrap/`: optional Bootstrap presentation adapter and scoped styling.
- `design/material/`: optional Material UI presentation adapter, local themes and shared widgets.

These are internal layers of one installable package. The website and examples
are available at https://tungsten.myoon.sk/.

## Development

Install the Node version in `.nvmrc`, pnpm, Rust with the `wasm32-unknown-unknown`
target, and wasm-pack 0.15.0. From this repository, run `pnpm install --frozen-lockfile`,
`pnpm build`, `pnpm test`, and `pnpm test:core`. Browser tests are development
tooling: install their browsers with `pnpm exec playwright install`, then run
`pnpm test:integration`. Chrome and Edge projects also require those applications.
For the complete serial matrix, use `pnpm test:integration:run --workers=1 --global-timeout=5400000`.
Playwright, tests and reports are excluded from the installed package.

See the [architecture documentation](https://tungsten.myoon.sk/documentation/?guide=core)
and [release support](https://tungsten.myoon.sk/documentation/?guide=support).

## Sprout groups and contracts

Schemas use `{ "schemaVersion": "sprout", "form": [...] }`. Groups use `subform`,
with a `basic` or `sectioned` variant and explicit `render: { type, settings }`.
Basic groups accept fields and nested groups; sectioned groups contain basic
sections. The default design supplies 16 basic and six sectioned renderers.
Rules, validation, and flat canonical-key values retain their existing semantics.

The [consumer documentation](https://tungsten.myoon.sk/documentation/)
records the current behavior and the starting point for freezing the API.

## Sprout editor and discovery

```tsx
import { TungstenEditor, getAuthoringCatalog } from '@myoon/tungsten/react'

<TungstenEditor initialSchema={schema} onChange={acceptedSchema => save(acceptedSchema)} />
const catalog = await getAuthoringCatalog()
```

The palette and settings come from core registries. Property forms, component
lists, validators and rules are Tungsten forms. Editor, Preview and JSON views,
modal settings, values/state inspection, JSON import/export, undo/redo and nested
template editing are included. Invalid
drafts retain the last accepted preview. Initialization props are read on mount;
remount to replace an editing session. The optional design controls the live
preview. No automatic storage or submission occurs.

`Tungsten` also accepts `onStateChange`, which receives `{ schema, state, values,
valid }` after evaluation. This includes nested arrays and validation errors.
Navigation stays local to renderers. See the
[editor documentation](https://tungsten.myoon.sk/documentation/?guide=editor) for the complete current API.

## Async data and files

`Tungsten` accepts `config` (named APIs and optional request override),
`dataSources` (an external named registry), and schema `bindings` for field values
or select options. Loading disables only affected controls; results are validated,
revision checked, and retryable.

File fields require `upload: { api, endpoint, timing?: 'submit' | 'selection' }`.
Timing defaults to submit. Successful multipart uploads become durable file IDs;
loaded IDs and failed-submit retries do not upload again. `onReady(controller)`
exposes `prepareFiles()` for host-owned draft persistence.

See the [data source guide](https://tungsten.myoon.sk/documentation/?guide=data-sources) and the
[async data and files example](https://tungsten.myoon.sk/examples/?example=async).
Automatic draft saving is opt-in through `onSave` or `config.autosave.endpoint`,
with a configurable trailing debounce (default 200 ms). Invalid drafts may save;
restoring drafts uses `initialValues` or the controller's `loadValues()`.

Date fields support `mode: 'date'` (default), `'time'`, or `'datetime'`.
Datetime fields accept `timeZone` (IANA name or fixed offset; defaults to UTC)
and `disambiguation: 'reject' | 'earlier' | 'later'` for repeated clock times.
They display in that timezone and submit RFC 3339 UTC strings. Date-only values
use `YYYY-MM-DD`; time-only values are local `HH:mm:ss` clock times. All modes
support required and inclusive min/max validators. See the
[date and time example](https://tungsten.myoon.sk/examples/?example=dates).
The default design uses a text input and custom picker. Dates use the Gregorian
calendar and digits 0–9 in every language; order, separators and labels are
localized. Canonical ISO entry is also accepted. Changing language preserves the
stored date or instant. Custom input masks remain outside the current API.

Text fields use `variant: "plain" | "email" | "password" | "tel"`. Plain text supports `textarea: true` with required positive `rows` and optional `resizable` (vertical by default). Boolean fields use `variant: "checkbox" | "switch" | "radio"`; radio options use actual boolean values and support data sources. Boolean `required` accepts false; `must_be_true` requires true. Previous `type: "email"` schemas now use `type: "text", variant: "email"`.

## Localization

Tungsten ships complete English (`en`), Slovak (`sk`), Hungarian (`hu`), German
(`de`), Spanish (`es`) and French (`fr`) system-message catalogs. Select a language
without supplying Tungsten translations:

```tsx
<Tungsten schema={schema} language="de" onSubmit={onSubmit} />
```

Literal labels such as `Vorname` need no translation JSON. For application keys
or optional system overrides, provide one partial flat JSON dictionary:

```tsx
import de from './locales/de.json' // { "contact.name": "Vorname", "tg_ui_submit": "Antrag abschicken" }
const config = { i18n: { translations: { de } } }
<Tungsten schema={schema} config={config} language="de" onSubmit={onSubmit} />
```

Missing keys retain the selected language's bundled messages, then use the
configured fallback language and English. `""` intentionally displays empty text;
`null` is invalid. Regional tags use base-language system messages; custom catalog
keys match the exact configured tag. Catalogs can also be browser-accessible JSON
URLs or loaded from `i18n.directory`. Language changes preserve entered values.
Non-English catalogs load separately when selected or used as the fallback.

The [Localization (i18n) guide](https://tungsten.myoon.sk/documentation/?guide=localization)
contains the supported-language list, custom labels, overrides, parameters,
plurals, a searchable reference for every system key and a blank template download.
The template is also exported as `@myoon/tungsten/locales/template.json`; every
value is `""`, so using it unchanged intentionally empties all system messages.
Official catalogs, language names and the key reference are available under
`@myoon/tungsten/locales/*.json`. `supportedLanguages` is exported from the React
entry point. RTL layout remains future work.

## Licensing and services

Tungsten is free under **AGPL-3.0**, including commercial use when the AGPL
requirements are met. See [LICENSE](LICENSE).

Building proprietary software? [Commercial licenses](COMMERCIAL-LICENSING.md)
are available by contacting [contact@myoon.sk](mailto:contact@myoon.sk). Early
licenses are agreed case by case, with no fixed public pricing. Custom development,
integrations, custom components/features, priority support, and consulting are
available directly from the developer.

This repository contains the official public release history of Tungsten. Development takes place in a private monorepo.

External contributions need the rights workflow described in [CONTRIBUTING.md](CONTRIBUTING.md).

## Build quality

Development uses the Node version in the repository `.nvmrc` and wasm-pack 0.15.0.
Use a wasm-bindgen CLI matching `core/Cargo.lock` when installing the CLI manually.
Lint rejects warnings, builds reject warnings and JavaScript chunks above 500 kB,
and unit/browser tests reject unexpected console warnings, errors and exceptions.
Negative tests declare and assert their expected diagnostics.

The published package includes a separate worker asset containing the WASM runtime.
Deploy all emitted build assets together; let your bundler resolve the worker URL.
The client creates its worker on construction; WASM initializes on the first engine
command, never during package import.
