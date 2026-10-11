# Bootstrap design

The optional `@myoonhq/tungsten/react/design/bootstrap` adapter supports Bootstrap
5.3.8 and later 5.x versions. Qualification uses Bootstrap 5.3.8. Install Bootstrap
in the application and load its CSS before Tungsten's adapter styles:

```sh
npm install @myoonhq/tungsten bootstrap@^5.3.8
```

```tsx
import { Tungsten, TungstenEditor } from '@myoonhq/tungsten/react'
import bootstrap from '@myoonhq/tungsten/react/design/bootstrap'
import 'bootstrap/dist/css/bootstrap.min.css'
import '@myoonhq/tungsten/react/design/bootstrap.css'

<Tungsten schema={schema} design={bootstrap} colorScheme="dark" onSubmit={save} />
<TungstenEditor initialSchema={schema} design={bootstrap} colorScheme="dark" />
```

The adapter and shared widget styles install automatically; the explicit adapter
CSS import supports static stylesheet loading and contains the shared styles too.
Bootstrap's own CSS is always supplied by the application, so customized Bootstrap
builds and existing application stylesheets can be reused. Bootstrap is an optional
peer dependency: applications using only the default design need not install it.
Neither Bootstrap JavaScript nor React-Bootstrap is required.

The adapter applies Bootstrap control, button, card, tab, badge, dropdown and
feedback classes. Shared Tungsten widgets keep their controlled values, accessible
keyboard interactions, async loading, error reveal and Gregorian date entry.
All six field types, 16 basic groups, six sectioned groups and both repeaters use
the same settings as the default design. Complex select/date pickers and native
dialog overlays retain Tungsten's interaction implementation, styled through the
Bootstrap palette; they are not Bootstrap JavaScript widgets.

`colorScheme` inherits `TungstenThemeProvider` or defaults to light. Every form and
loading/failure root sets its own `data-bs-theme`; the adapter never sets a theme
on the document. Native dialogs and inline menus inherit the form's palette.
Changing the theme preserves entered values, focus, errors and presentation state.
The editor's authoring/settings UI retains the Tungsten design; `design` selects
its live form preview.

Custom Bootstrap palettes should supply its normal `--bs-*` variables, including
light/dark subtle surfaces and emphasis colors. Override variables on `.tb-root`
with a suitably specific selector. Shared layout and widget styles use `.tg-*`
classes in both designs; adapter adjustments are scoped to `.tb-root`.
Bootstrap's stylesheet includes its global Reboot styles, as in any Bootstrap app.

Bootstrap remains MIT licensed. Tungsten's adapter is AGPL-3.0-only; applications
must retain upstream Bootstrap copyright and license notices when distributing
its CSS.
