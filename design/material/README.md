# Material design

The optional `@myoon/tungsten/react/design/material` adapter uses Material UI
9.5 and later 9.x versions, with Emotion 11. Qualification uses MUI 9.5.0, Emotion React 11.14.0 and
Emotion Styled 11.14.1. These remain external optional peers, so applications
using the default design need none of them.

```sh
npm install @myoon/tungsten @mui/material@^9.5.0 @emotion/react@^11.14.0 @emotion/styled@^11.14.1
```

```tsx
import { Tungsten, TungstenEditor } from '@myoon/tungsten/react'
import material from '@myoon/tungsten/react/design/material'
import '@myoon/tungsten/react/design/material.css'

<Tungsten schema={schema} design={material} colorScheme="dark" language="de" />
<TungstenEditor initialSchema={schema} design={material} colorScheme="light" />
```

MUI inputs, checkboxes, radios, switches and buttons retain Tungsten's controlled
values, native refs/events, keyboard navigation, validation and read-only behavior.
All six field types, 16 basic groups, six sectioned groups and both repeaters
support the same settings as the default design. Complex select/date/file widgets,
group layouts and native dialog overlays share Tungsten's interaction implementation,
styled with the local Material theme; they are not MUI Select, Dialog or MUI X widgets.
No MUI X, icon package, date adapter or external font download is required.

The entry also exports `MaterialForm`, `MaterialLoading` and `MaterialFailure`,
matching the other designs' root-component contract.

The theme is scoped to each renderer. `colorScheme` inherits
`TungstenThemeProvider` or defaults to light. Theme/language changes preserve edits,
focus and errors. The adapter does not apply `CssBaseline`, change document styles,
or read the host's system preference. A surrounding MUI provider is not required.
The editor's authoring/settings interface retains Tungsten; `design` selects its preview.
Widget styles install automatically. The explicit CSS export includes the shared styles
and supports hosts that prefer static CSS loading.

Customize Material with standard MUI `ThemeOptions`. Create the design once, outside
your component. Options apply to both schemes; a callback allows separate palettes.
The adapter controls `palette.mode` according to Tungsten's selected color scheme.
`cssVariables`, `colorSchemes` and `defaultColorScheme` are reserved; the adapter
uses local tokens and explicit Tungsten mode selection. It uses its own theme rather
than inheriting an unrelated surrounding MUI theme;
pass your application's theme options explicitly when sharing branding.

```tsx
import { createMaterialDesign } from '@myoon/tungsten/react/design/material'

const branded = createMaterialDesign(mode => ({
  palette: { primary: { main: mode === 'dark' ? '#90caf9' : '#1976d2' } },
  typography: { fontFamily: 'system-ui, sans-serif' },
  shape: { borderRadius: 6 },
}))

<Tungsten schema={schema} design={branded} colorScheme="dark" />
```

For React 18, follow [MUI's installation guide](https://mui.com/material-ui/getting-started/installation/)
to align `react-is` with the application's React version. Browser qualification currently
uses React 19; the declared React 18 peer range does not imply a separate browser result.

Material UI and Emotion retain their MIT licenses. Tungsten's adapter is
AGPL-3.0-only. Preserve upstream copyright and license notices when distributing
those dependencies; Tungsten does not replace their original license permissions.
RTL layout remains a future feature across Tungsten designs.
