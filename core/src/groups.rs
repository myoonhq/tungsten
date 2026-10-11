//! Renderer metadata validation only. Core never executes presentation behavior.
use std::collections::BTreeMap;

use serde::{de::DeserializeOwned, Deserialize};
use serde_json::Value;

use crate::schema::{GroupVariant, RawGroup};

#[derive(Clone, Debug)]
pub struct GroupRenderType {
    pub variant: GroupVariant,
    pub validate_settings: fn(&Value) -> Result<(), String>,
}

#[derive(Clone, Debug)]
pub struct GroupRenderLibrary {
    renderers: BTreeMap<String, GroupRenderType>,
    settings: BTreeMap<String, Vec<crate::schema::RawComponent>>,
}

impl GroupRenderLibrary {
    pub fn empty() -> Self {
        Self {
            renderers: BTreeMap::new(),
            settings: BTreeMap::new(),
        }
    }

    pub fn register(
        &mut self,
        name: impl Into<String>,
        renderer: GroupRenderType,
    ) -> Result<(), String> {
        let name = name.into();
        if self.renderers.contains_key(&name) {
            return Err(crate::messages::diagnostic(
                "tg_schema_group_renderer_is_already_registered",
                serde_json::json!({"name": name}),
            ));
        }
        self.renderers.insert(name, renderer);
        Ok(())
    }

    pub fn register_described(
        &mut self,
        name: impl Into<String>,
        renderer: GroupRenderType,
        settings: Vec<crate::schema::RawComponent>,
    ) -> Result<(), String> {
        let name = name.into();
        self.register(name.clone(), renderer)?;
        self.settings.insert(name, settings);
        Ok(())
    }
    pub fn descriptors(&self) -> impl Iterator<Item = crate::catalog::RendererDescriptor> + '_ {
        self.types()
            .map(move |(name, renderer)| crate::catalog::RendererDescriptor {
                r#type: name.into(),
                variant: Some(renderer.variant),
                settings: self.settings.get(name).cloned(),
            })
    }

    pub fn types(&self) -> impl Iterator<Item = (&str, &GroupRenderType)> {
        self.renderers
            .iter()
            .map(move |(name, renderer)| (name.as_str(), renderer))
    }

    pub fn get(&self, name: &str) -> Option<&GroupRenderType> {
        self.renderers.get(name)
    }

    pub fn validate(&self, group: &RawGroup) -> Result<(), String> {
        let renderer = self.get(&group.render.render_type).ok_or_else(|| {
            crate::messages::diagnostic(
                "tg_schema_unknown_group_renderer",
                serde_json::json!({"p0": group.render.render_type}),
            )
        })?;
        if renderer.variant != group.variant {
            return Err(crate::messages::diagnostic(
                "tg_schema_renderer_requires_groups",
                serde_json::json!({"p0": group.render.render_type, "p1": format!("{:?}", renderer.variant)}),
            ));
        }
        if !group.render.settings.is_object() {
            return Err("tg_schema_render_settings_must_be_an_object".into());
        }
        (renderer.validate_settings)(&group.render.settings)?;
        if let Some(initial) = group
            .render
            .settings
            .get("initialSection")
            .and_then(Value::as_str)
        {
            if !group.subform.iter().any(|child| child.key() == initial) {
                return Err(crate::messages::diagnostic(
                    "tg_schema_initialsection_is_not_a_direct_child",
                    serde_json::json!({"initial": initial}),
                ));
            }
        }
        Ok(())
    }
}

impl Default for GroupRenderLibrary {
    fn default() -> Self {
        let mut library = Self::empty();
        for name in [
            "group", "section", "fieldset", "panel", "card", "inset", "fragment",
        ] {
            library
                .register(
                    name,
                    GroupRenderType {
                        variant: GroupVariant::Basic,
                        validate_settings: check_container,
                    },
                )
                .expect("built-in group renderers must be unique");
        }
        for name in ["collapsible", "accordion", "details", "expansion-panel"] {
            library
                .register(
                    name,
                    GroupRenderType {
                        variant: GroupVariant::Basic,
                        validate_settings: check_disclosure,
                    },
                )
                .expect("built-in group renderers must be unique");
        }
        for name in ["modal", "drawer", "sheet"] {
            library
                .register(
                    name,
                    GroupRenderType {
                        variant: GroupVariant::Basic,
                        validate_settings: check_overlay,
                    },
                )
                .expect("built-in group renderers must be unique");
        }
        library
            .register(
                "row",
                GroupRenderType {
                    variant: GroupVariant::Basic,
                    validate_settings: check_row,
                },
            )
            .expect("built-in group renderers must be unique");
        library
            .register(
                "column",
                GroupRenderType {
                    variant: GroupVariant::Basic,
                    validate_settings: check_column,
                },
            )
            .expect("built-in group renderers must be unique");
        for name in [
            "tabs",
            "segmented-view",
            "wizard",
            "stepper",
            "pages",
            "carousel",
        ] {
            library
                .register(
                    name,
                    GroupRenderType {
                        variant: GroupVariant::Sectioned,
                        validate_settings: check_sections,
                    },
                )
                .expect("built-in group renderers must be unique");
        }
        for name in library.renderers.keys().cloned().collect::<Vec<_>>() {
            library
                .settings
                .insert(name.clone(), crate::catalog::group_settings(&name));
        }
        library
    }
}

// Settings are variant-specific and reject misspelled/foreign properties.
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ContainerSettings {
    gap: Option<u16>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct DisclosureSettings {
    gap: Option<u16>,
    initially_open: Option<bool>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct OverlaySettings {
    gap: Option<u16>,
    initially_open: Option<bool>,
    trigger_label: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct RowSettings {
    gap: Option<u16>,
    wrap: Option<bool>,
    align: Option<Alignment>,
    columns: Option<u16>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ColumnSettings {
    gap: Option<u16>,
    align: Option<Alignment>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SectionSettings {
    initial_section: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "lowercase")]
enum Alignment {
    Start,
    Center,
    End,
    Stretch,
}

fn parse<T: DeserializeOwned>(value: &Value) -> Result<T, String> {
    serde_json::from_value(value.clone()).map_err(|error| error.to_string())
}
fn gap(value: Option<u16>) -> Result<(), String> {
    if value.is_some_and(|value| value > 128) {
        return Err("tg_schema_gap_must_be_an_integer_from_0_to_128_pixels".into());
    }
    Ok(())
}
fn check_container(value: &Value) -> Result<(), String> {
    gap(parse::<ContainerSettings>(value)?.gap)
}
fn check_disclosure(value: &Value) -> Result<(), String> {
    let settings = parse::<DisclosureSettings>(value)?;
    let _ = settings.initially_open;
    gap(settings.gap)
}
fn check_overlay(value: &Value) -> Result<(), String> {
    let settings = parse::<OverlaySettings>(value)?;
    let _ = (settings.initially_open, settings.trigger_label);
    gap(settings.gap)
}
fn check_row(value: &Value) -> Result<(), String> {
    let settings = parse::<RowSettings>(value)?;
    let _ = (settings.wrap, settings.align);
    if settings
        .columns
        .is_some_and(|columns| columns == 0 || columns > 12)
    {
        return Err("tg_schema_columns_must_be_an_integer_from_1_to_12".into());
    }
    gap(settings.gap)
}
fn check_column(value: &Value) -> Result<(), String> {
    let settings = parse::<ColumnSettings>(value)?;
    let _ = settings.align;
    gap(settings.gap)
}
fn check_sections(value: &Value) -> Result<(), String> {
    let settings = parse::<SectionSettings>(value)?;
    let _ = settings.initial_section;
    Ok(())
}
