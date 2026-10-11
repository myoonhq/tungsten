# Tungsten design

The default visual implementation of the React renderer contract. Each field
renderer is deliberately easy to locate under `src/`; shared form chrome,
field shell behavior, installation, and scoped CSS live alongside them.

This design is bundled as
`@myoonhq/tungsten/react/design/tungsten`. The Bootstrap design is a sibling adapter using shared presentation primitives
and interaction code. Its class mapping and palette live in `design/bootstrap`;
the default design does not import Bootstrap. Material remains deferred.


Group renderers are registered separately from scalar fields. Basic containers,
layout, disclosures and overlays live in their behavior-specific modules;
sectioned tabs and sequences live in `sectioned-groups.tsx`. Accordion presents
one collapsible basic subform. Each built-in component and the
`tungstenGroupRenderers` map are public design exports.

See [renderer settings](https://tungsten.myoon.sk/documentation/?guide=schema) and the
[UI contract](https://tungsten.myoon.sk/documentation/?guide=ui) before adding or replacing one.
