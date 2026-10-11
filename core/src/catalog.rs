//! Authoring metadata owned by the same registries that compile forms.
//! Settings are ordinary Tungsten components, usable by any framework editor.
use crate::{
    fields::Operation,
    schema::{RawComponent, SCHEMA_VERSION},
};
use serde::Serialize;
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatorDescriptor {
    pub kind: String,
    pub label: String,
    pub description: String,
    pub settings: Vec<RawComponent>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldDescriptor {
    pub r#type: String,
    pub label: String,
    pub description: String,
    pub value_type: String,
    /// None means the extension did not publish an authoring schema.
    pub settings: Option<Vec<RawComponent>>,
    pub validators: Vec<ValidatorDescriptor>,
    pub operations: Vec<Operation>,
}
impl FieldDescriptor {
    pub fn opaque(name: &str) -> Self {
        Self {
            r#type: name.into(),
            label: name.into(),
            description:
                "tg_catalog_registered_custom_field_authoring_metadata_has_not_been_supplied".into(),
            value_type: "unknown".into(),
            settings: None,
            validators: vec![],
            operations: vec![],
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RendererDescriptor {
    pub r#type: String,
    pub variant: Option<crate::schema::GroupVariant>,
    pub settings: Option<Vec<RawComponent>>,
}
#[derive(Clone, Debug, Serialize)]
pub struct ActionDescriptor {
    pub kind: String,
    pub label: String,
    pub settings: Vec<RawComponent>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthoringCatalog {
    pub schema_version: String,
    pub max_depth: usize,
    pub fields: Vec<FieldDescriptor>,
    pub common_settings: Vec<RawComponent>,
    pub group_settings: Vec<RawComponent>,
    pub repeater_settings: Vec<RawComponent>,
    pub group_renderers: Vec<RendererDescriptor>,
    pub repeater_renderers: Vec<RendererDescriptor>,
    pub actions: Vec<ActionDescriptor>,
}
impl AuthoringCatalog {
    pub fn from_registries(
        compiler: &crate::compiler::SchemaCompiler,
        repeaters: &crate::repeaters::RepeaterRenderLibrary,
    ) -> Self {
        Self {
            schema_version: SCHEMA_VERSION.into(),
            max_depth: crate::schema::MAX_GROUP_DEPTH,
            fields: compiler.library().descriptors().collect(),
            common_settings: components(json!([
                {"type":"text","key":"key","view":{"label":"tg_catalog_field_key","description":"tg_catalog_fully_qualified_dot_separated_key"},"validators":[{"kind":"required"}]},
                {"type":"text","key":"view.label","view":{"label":"tg_catalog_label"}},
                {"type":"text","key":"view.description","view":{"label":"tg_catalog_description","editorControl":"textarea"}}
            ])),
            group_settings: vec![],
            repeater_settings: components(json!([
                {"type":"number","key":"min","view":{"label":"tg_catalog_minimum_instances","description":"tg_catalog_defaults_to_0"},"validators":[{"kind":"min","value":0}],"current_value":0},
                {"type":"number","key":"max","view":{"label":"tg_catalog_maximum_instances","description":"tg_catalog_leave_empty_for_no_limit"},"validators":[{"kind":"min","value":0}]},
                {"type":"boolean","key":"reorder","view":{"label":"tg_catalog_allow_reordering"},"current_value":false}
            ])),
            group_renderers: compiler.group_renderers().descriptors().collect(),
            repeater_renderers: repeaters.descriptors().collect(),
            actions: vec![
                action(
                    "set_value",
                    "tg_catalog_set_value",
                    json!([{ "type":"text","key":"value","view":{"label":"tg_catalog_value_json","editorControl":"json"},"current_value":"null" }]),
                ),
                action("clear_value", "tg_catalog_clear_value", json!([])),
                action(
                    "set_hidden",
                    "tg_catalog_set_visibility",
                    json!([{ "type":"boolean","key":"hidden","view":{"label":"tg_catalog_hidden"},"current_value":true }]),
                ),
                action("show", "tg_catalog_show_field", json!([])),
                action(
                    "set_errors",
                    "tg_catalog_set_behavior_errors",
                    json!([{ "type":"text","key":"errors","view":{"label":"tg_catalog_errors_json_array","editorControl":"json"},"current_value":"[]" }]),
                ),
            ],
        }
    }
}
fn action(kind: &str, label: &str, settings: Value) -> ActionDescriptor {
    ActionDescriptor {
        kind: kind.into(),
        label: label.into(),
        settings: components(settings),
    }
}
pub(crate) fn components(value: Value) -> Vec<RawComponent> {
    serde_json::from_value(value).expect("built-in metadata is a component schema")
}
pub(crate) fn validator(
    kind: &str,
    label: &str,
    description: &str,
    numeric: bool,
    length: bool,
) -> ValidatorDescriptor {
    let settings = if numeric {
        components(
            json!([{"type":"number","key":"value","view":{"label":"tg_catalog_limit"},"validators": if length { json!([{"kind":"required"},{"kind":"min","value":0}]) } else { json!([{"kind":"required"}]) }}]),
        )
    } else {
        vec![]
    };
    ValidatorDescriptor {
        kind: kind.into(),
        label: label.into(),
        description: description.into(),
        settings,
    }
}
pub(crate) fn scalar(
    name: &str,
    label: &str,
    description: &str,
    domain: &str,
    validators: Vec<ValidatorDescriptor>,
) -> FieldDescriptor {
    FieldDescriptor {
        r#type: name.into(),
        label: label.into(),
        description: description.into(),
        value_type: domain.into(),
        settings: Some(vec![]),
        validators,
        operations: if domain == "boolean" {
            vec![Operation::Eq, Operation::Neq]
        } else {
            vec![
                Operation::Eq,
                Operation::Neq,
                Operation::Lt,
                Operation::Gt,
                Operation::LEqt,
                Operation::GEqt,
            ]
        },
    }
}
pub(crate) fn string_validators() -> Vec<ValidatorDescriptor> {
    vec![
        validator(
            "required",
            "tg_catalog_required",
            "tg_catalog_a_nonempty_string_is_required",
            false,
            false,
        ),
        validator(
            "min_length",
            "tg_catalog_minimum_length",
            "tg_catalog_counts_unicode_characters_does_not_trim_text",
            true,
            true,
        ),
        validator(
            "max_length",
            "tg_catalog_maximum_length",
            "tg_catalog_counts_unicode_characters",
            true,
            true,
        ),
    ]
}
pub(crate) fn group_settings(kind: &str) -> Vec<RawComponent> {
    let mut settings = Vec::new();
    if !matches!(
        kind,
        "tabs" | "segmented-view" | "wizard" | "stepper" | "pages" | "carousel"
    ) {
        settings.extend(components(json!([{ "type":"number","key":"gap","view":{"label":"tg_catalog_gap_px"},"validators":[{"kind":"min","value":0},{"kind":"max","value":128}] }])));
    } else {
        settings.extend(components(json!([{ "type":"text","key":"initialSection","view":{"label":"tg_catalog_initial_section_key","description":"tg_catalog_must_identify_a_direct_child_group"} }])));
    }
    if matches!(
        kind,
        "collapsible" | "accordion" | "details" | "expansion-panel" | "modal" | "drawer" | "sheet"
    ) {
        settings.extend(components(
            json!([{ "type":"boolean","key":"initiallyOpen","view":{"label":"tg_catalog_initially_open"} }]),
        ));
    }
    if matches!(kind, "modal" | "drawer" | "sheet") {
        settings.extend(components(
            json!([{ "type":"text","key":"triggerLabel","view":{"label":"tg_catalog_trigger_label"} }]),
        ));
    }
    if matches!(kind, "row" | "column") {
        settings.extend(components(json!([{ "type":"text","key":"align","view":{"label":"tg_catalog_alignment","editorControl":"select","options":["start","center","end","stretch"]} }])));
    }
    if kind == "row" {
        settings.extend(components(json!([{ "type":"boolean","key":"wrap","view":{"label":"tg_catalog_wrap"} },{ "type":"number","key":"columns","view":{"label":"tg_catalog_columns"},"validators":[{"kind":"min","value":1},{"kind":"max","value":12}] }])));
    }
    settings
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        compiler::SchemaCompiler,
        fields::{FieldLibrary, NumberFieldType},
        groups::{GroupRenderLibrary, GroupRenderType},
        repeaters::RepeaterRenderLibrary,
        schema::{GroupVariant, RawSchema},
    };

    #[test]
    fn catalogue_uses_actual_registries_and_all_metadata_compiles() {
        let compiler = SchemaCompiler::new();
        let catalog =
            AuthoringCatalog::from_registries(&compiler, &RepeaterRenderLibrary::default());
        assert_eq!(
            catalog
                .fields
                .iter()
                .map(|f| f.r#type.as_str())
                .collect::<Vec<_>>(),
            compiler.library().type_names().collect::<Vec<_>>()
        );
        assert_eq!(
            catalog.group_renderers.len(),
            compiler.group_renderers().types().count()
        );
        assert_eq!(catalog.repeater_renderers.len(), 2);
        let mut settings = vec![
            catalog.common_settings,
            catalog.group_settings,
            catalog.repeater_settings,
        ];
        for field in catalog.fields {
            if let Some(form) = field.settings {
                settings.push(form);
            }
            for validator in field.validators {
                settings.push(validator.settings);
            }
        }
        for renderer in catalog
            .group_renderers
            .into_iter()
            .chain(catalog.repeater_renderers)
        {
            settings.push(renderer.settings.unwrap());
        }
        for action in catalog.actions {
            settings.push(action.settings);
        }
        for form in settings {
            let schema: RawSchema =
                serde_json::from_value(json!({"schemaVersion":"sprout","form":form})).unwrap();
            compiler
                .compile(schema)
                .expect("authoring metadata must itself be a valid Tungsten form");
        }
    }

    #[test]
    fn extensions_are_discovered_with_described_and_opaque_settings() {
        let mut fields = FieldLibrary::new();
        fields.register(NumberFieldType).unwrap();
        let mut groups = GroupRenderLibrary::empty();
        let renderer = GroupRenderType {
            variant: GroupVariant::Basic,
            validate_settings: |_| Ok(()),
        };
        groups.register("opaque", renderer.clone()).unwrap();
        groups
            .register_described(
                "custom",
                renderer,
                components(json!([{"type":"number","key":"spacing"}])),
            )
            .unwrap();
        let mut repeaters = RepeaterRenderLibrary::empty();
        repeaters.register("opaque", |_| Ok(())).unwrap();
        repeaters
            .register_described("custom", |_| Ok(()), vec![])
            .unwrap();
        let catalog = AuthoringCatalog::from_registries(
            &SchemaCompiler::with_libraries(fields, groups),
            &repeaters,
        );
        assert_eq!(catalog.fields.len(), 1);
        assert_eq!(catalog.fields[0].r#type, "number");
        assert!(catalog
            .group_renderers
            .iter()
            .find(|r| r.r#type == "opaque")
            .unwrap()
            .settings
            .is_none());
        assert_eq!(
            catalog
                .group_renderers
                .iter()
                .find(|r| r.r#type == "custom")
                .unwrap()
                .settings
                .as_ref()
                .unwrap()
                .len(),
            1
        );
        assert!(catalog
            .repeater_renderers
            .iter()
            .find(|r| r.r#type == "opaque")
            .unwrap()
            .settings
            .is_none());
        assert_eq!(
            catalog
                .repeater_renderers
                .iter()
                .find(|r| r.r#type == "custom")
                .unwrap()
                .settings
                .as_ref()
                .unwrap()
                .len(),
            0
        );
    }
}
