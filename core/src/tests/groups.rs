use serde_json::{json, Value};

use crate::compiler::{CompileError, SchemaCompiler};
use crate::engine::{patch::Patch, Engine};
use crate::fields::FieldLibrary;
use crate::groups::{GroupRenderLibrary, GroupRenderType};
use crate::schema::{GroupVariant, RawSchema, MAX_GROUP_DEPTH};
use crate::ScalarValue;

fn schema(form: Vec<Value>) -> RawSchema {
    serde_json::from_value(json!({"schemaVersion":"sprout","form":form})).unwrap()
}
fn group(key: &str, variant: &str, render: &str, subform: Vec<Value>) -> Value {
    json!({"type":"group","variant":variant,"key":key,"render":{"type":render,"settings":{}},"subform":subform})
}
fn field(key: &str) -> Value {
    json!({"type":"text","key":key})
}
fn compile(form: Vec<Value>) -> Result<crate::compiler::CompiledSchema, CompileError> {
    SchemaCompiler::new().compile(schema(form))
}

#[test]
fn retains_tree_and_assigns_leaf_ids_in_depth_first_order() {
    let tree = schema(vec![
        field("first"),
        group(
            "person",
            "basic",
            "card",
            vec![
                field("person.name"),
                group(
                    "person.address",
                    "basic",
                    "row",
                    vec![field("person.address.city")],
                ),
            ],
        ),
        field("last"),
    ]);
    let compiled = SchemaCompiler::new().compile(tree.clone()).unwrap();
    assert_eq!(compiled.schema(), &tree);
    assert_eq!(
        compiled
            .raw_fields()
            .iter()
            .map(|f| f.key.as_str())
            .collect::<Vec<_>>(),
        vec!["first", "person.name", "person.address.city", "last"]
    );
    assert_eq!(compiled.field_id("person.address.city"), Some(2));
    assert_eq!(
        compiled.field_path(2),
        Some("form[1].subform[1].subform[0]")
    );
    assert_eq!(compiled.state().fields.len(), 4);
    assert!(compiled.field_id("person").is_none());
    assert!(!compiled.state().fields.contains_key("person"));
}

#[test]
fn basic_groups_accept_mixed_fields_and_nested_sectioned_groups() {
    compile(vec![group(
        "form",
        "basic",
        "group",
        vec![
            field("form.name"),
            group(
                "form.tabs",
                "sectioned",
                "tabs",
                vec![group(
                    "form.tabs.contact",
                    "basic",
                    "fieldset",
                    vec![field("form.tabs.contact.email")],
                )],
            ),
        ],
    )])
    .unwrap();
}

#[test]
fn rejects_every_non_basic_direct_section_child() {
    for child in [
        field("form.name"),
        group("form.inner", "sectioned", "tabs", vec![]),
    ] {
        let error = compile(vec![group("form", "sectioned", "wizard", vec![child])]).unwrap_err();
        assert!(error
            .to_string()
            .contains("tg_schema_sectioned_group_requires_basic_groups_as_direct_children"));
        assert!(error.to_string().contains("form[0].subform[0]"));
    }
}

#[test]
fn namespace_boundaries_are_not_text_prefixes_and_never_repaired() {
    for key in [
        "city",
        "person.name",
        "person.addressBook.city",
        "person.address",
    ] {
        let error = compile(vec![group(
            "person.address",
            "basic",
            "group",
            vec![field(key)],
        )])
        .unwrap_err();
        let message = error.to_string();
        assert!(
            message.contains("tg_schema_child_must_be_inside_parent_group_namespace")
                && message.contains("person.address"),
            "{}",
            message
        );
        assert!(message.contains(key));
    }
    // Intermediate segments do not require extra groups.
    compile(vec![group(
        "person",
        "basic",
        "group",
        vec![field("person.address.city")],
    )])
    .unwrap();
}

#[test]
fn component_keys_are_unique_across_all_kinds() {
    for form in [
        vec![group("person", "basic", "group", vec![]), field("person")],
        vec![field("person"), group("person", "basic", "group", vec![])],
        vec![
            group("person", "basic", "group", vec![]),
            group("person", "basic", "card", vec![]),
        ],
    ] {
        assert!(compile(form)
            .unwrap_err()
            .to_string()
            .contains("tg_schema_duplicate_component_key_first_declared_at"));
    }
    assert!(matches!(
        compile(vec![group(
            "person",
            "basic",
            "group",
            vec![field("person.name"), field("person.name")]
        )]),
        Err(CompileError::DuplicateFieldKey { .. })
    ));
}

#[test]
fn rejects_ambiguous_paths_and_bounds_nested_structures() {
    for key in ["a..b", ".a", "a.", "a b", "a/b", "a\\b", "a[0]"] {
        assert!(compile(vec![field(key)]).is_err());
    }
    let mut node = field(&format!(
        "{}.name",
        vec!["a"; MAX_GROUP_DEPTH + 1].join(".")
    ));
    for depth in (1..=MAX_GROUP_DEPTH + 1).rev() {
        node = group(&vec!["a"; depth].join("."), "basic", "group", vec![node]);
    }
    let error =
        serde_json::from_value::<RawSchema>(json!({"schemaVersion":"sprout","form":[node]}))
            .unwrap_err();
    assert!(error
        .to_string()
        .contains("tg_schema_group_nesting_exceeds_levels"));
    // The parse guard unwinds after an error; later valid forms still load.
    compile(vec![group(
        "person",
        "basic",
        "group",
        vec![field("person.name")],
    )])
    .unwrap();
}

#[test]
fn schema_version_is_required_and_only_sprout_is_supported() {
    assert!(serde_json::from_value::<RawSchema>(json!([])).is_err());
    assert!(serde_json::from_value::<RawSchema>(json!({"form":[]})).is_err());
    let mut input = schema(vec![]);
    input.schema_version = "moss".into();
    assert_eq!(
        SchemaCompiler::new().compile(input).unwrap_err(),
        CompileError::UnsupportedSchemaVersion {
            version: "moss".into()
        }
    );
}

#[test]
fn malformed_groups_cannot_fall_back_to_scalar_fields() {
    let base = group("person", "basic", "group", vec![]);
    for property in ["variant", "render", "subform"] {
        let mut bad = base.clone();
        bad.as_object_mut().unwrap().remove(property);
        assert!(serde_json::from_value::<RawSchema>(
            json!({"schemaVersion":"sprout","form":[bad]})
        )
        .is_err());
    }
    for property in ["current_value", "hidden", "rules", "repeatable"] {
        let mut bad = base.clone();
        bad[property] = json!(true);
        assert!(serde_json::from_value::<RawSchema>(
            json!({"schemaVersion":"sprout","form":[bad]})
        )
        .is_err());
    }
}

#[test]
fn validates_renderer_family_settings_and_initial_section() {
    for (variant, renderer, settings) in [
        ("basic", "tabs", json!({})),
        ("sectioned", "row", json!({})),
        ("basic", "row", json!({"columns":0})),
        ("basic", "row", json!({"gap":-1})),
        ("basic", "row", json!({"gap":1.5})),
        ("basic", "row", json!({"align":"left"})),
        ("basic", "group", json!({"wrap":true})),
        ("basic", "group", json!(null)),
        ("sectioned", "tabs", json!({"initialSection":"missing"})),
        ("basic", "unknown", json!({})),
    ] {
        let mut node = group("person", variant, renderer, vec![]);
        node["render"]["settings"] = settings;
        assert!(compile(vec![node]).is_err(), "{}", renderer);
    }
}

#[test]
fn all_builtin_renderers_obey_the_same_structural_contract() {
    for render in [
        "group",
        "section",
        "fieldset",
        "panel",
        "card",
        "inset",
        "fragment",
        "row",
        "column",
        "collapsible",
        "accordion",
        "details",
        "expansion-panel",
        "modal",
        "drawer",
        "sheet",
    ] {
        assert_eq!(
            compile(vec![group(
                "person",
                "basic",
                render,
                vec![field("person.name")]
            )])
            .unwrap()
            .fields()
            .len(),
            1
        );
    }
    for render in [
        "tabs",
        "segmented-view",
        "wizard",
        "stepper",
        "pages",
        "carousel",
    ] {
        assert_eq!(
            compile(vec![group(
                "person",
                "sectioned",
                render,
                vec![group(
                    "person.contact",
                    "basic",
                    "group",
                    vec![field("person.contact.name")]
                )]
            )])
            .unwrap()
            .fields()
            .len(),
            1
        );
    }
}

#[test]
fn grouped_and_flat_fields_have_identical_runtime_results() {
    let source = json!({"type":"text","variant":"email","key":"person.email","current_value":"  ada@example.com  ","validators":[{"kind":"required"}]});
    let target = json!({"type":"text","key":"summary.status","validators":[{"kind":"required"}],"rules":[{"when":{"property":"person.email","operation":"Eq","value":"grace@example.com"},"then":[{"kind":"set_value","value":" ready "}]}]});
    let mut flat = Engine::from_compiled(compile(vec![source.clone(), target.clone()]).unwrap());
    let mut grouped = Engine::from_compiled(
        compile(vec![
            group("person", "basic", "accordion", vec![source]),
            group("summary", "basic", "card", vec![target]),
        ])
        .unwrap(),
    );
    assert_eq!(
        serde_json::to_value(flat.state()).unwrap(),
        serde_json::to_value(grouped.state()).unwrap()
    );
    let patch = Patch::SetValue {
        key: "person.email".into(),
        value: ScalarValue::String(" grace@example.com ".into()),
    };
    assert_eq!(
        flat.process_patch(patch.clone()).unwrap(),
        grouped.process_patch(patch).unwrap()
    );
    assert_eq!(flat.validate_all(), grouped.validate_all());
    assert_eq!(
        serde_json::to_value(flat.state()).unwrap(),
        serde_json::to_value(grouped.state()).unwrap()
    );
    assert!(grouped
        .process_patch(Patch::ClearValue {
            key: "person".into()
        })
        .is_err());
}

#[test]
fn cross_group_cycles_and_group_value_references_are_rejected() {
    let rule = |key, source| json!({"type":"number","key":key,"rules":[{"when":{"property":source,"operation":"Eq","value":1},"then":[{"kind":"set_value","value":1}]}]});
    assert!(matches!(
        compile(vec![
            group("a", "basic", "group", vec![rule("a.value", "b.value")]),
            group("b", "basic", "group", vec![rule("b.value", "a.value")])
        ]),
        Err(CompileError::ValueCycle { .. })
    ));
    assert!(matches!(
        compile(vec![group(
            "a",
            "basic",
            "group",
            vec![rule("a.value", "a")]
        )]),
        Err(CompileError::UnknownFieldReference { .. })
    ));
}

#[test]
fn validates_inactive_sections_and_preserves_view_metadata() {
    let mut leaf = field("person.contact.email");
    leaf["validators"] = json!([{"kind":"required"}]);
    leaf["view"] =
        json!({"label":"Email","description":"Preserved","placeholder":"ada@example.com"});
    let compiled = compile(vec![group(
        "person",
        "sectioned",
        "wizard",
        vec![group("person.contact", "basic", "group", vec![leaf])],
    )])
    .unwrap();
    assert_eq!(
        serde_json::to_value(compiled.schema()).unwrap()["form"][0]["subform"][0]["subform"][0]
            ["view"]["description"],
        "Preserved"
    );
    let mut engine = Engine::from_compiled(compiled);
    assert!(!engine.validate_all());
    assert!(!engine
        .field_state("person.contact.email")
        .unwrap()
        .errors
        .is_empty());
}

#[test]
fn custom_renderer_registration_does_not_require_a_central_enum() {
    let mut renderers = GroupRenderLibrary::default();
    renderers
        .register(
            "custom",
            GroupRenderType {
                variant: GroupVariant::Basic,
                validate_settings: |settings| {
                    if settings.get("tone") == Some(&json!("quiet")) {
                        Ok(())
                    } else {
                        Err("tone must be quiet".into())
                    }
                },
            },
        )
        .unwrap();
    let mut node = group("person", "basic", "custom", vec![field("person.name")]);
    node["render"]["settings"] = json!({"tone":"quiet"});
    let compiled = SchemaCompiler::with_libraries(FieldLibrary::default(), renderers)
        .compile(schema(vec![node]))
        .unwrap();
    assert_eq!(compiled.fields().len(), 1);
}

#[test]
fn presentation_reload_preserves_values_errors_and_processing_limit() {
    let original = vec![group(
        "person",
        "basic",
        "group",
        vec![field("person.name")],
    )];
    let mut engine = Engine::from_compiled(compile(original).unwrap());
    engine.set_processing_limit(500);
    engine
        .process_patch(Patch::SetValue {
            key: "person.name".into(),
            value: ScalarValue::String("Ada".into()),
        })
        .unwrap();
    engine
        .process_patch(Patch::SetErrors {
            key: "person.name".into(),
            errors: vec!["Business error".into()],
        })
        .unwrap();
    let before = serde_json::to_value(engine.state()).unwrap();
    engine.reload(
        compile(vec![group(
            "person",
            "basic",
            "accordion",
            vec![field("person.name")],
        )])
        .unwrap(),
    );
    assert_eq!(serde_json::to_value(engine.state()).unwrap(), before);
    assert_eq!(engine.processing_limit(), 500);
    assert_eq!(
        serde_json::to_value(engine.schema()).unwrap()["form"][0]["render"]["type"],
        "accordion"
    );
    engine.reload(
        compile(vec![group(
            "person",
            "basic",
            "group",
            vec![field("person.other")],
        )])
        .unwrap(),
    );
    assert!(engine.field_state("person.name").is_none());
    assert_eq!(
        engine.field_state("person.other").unwrap().value,
        ScalarValue::Null
    );
}

#[test]
fn rejects_duplicate_renderer_registrations_and_ambiguous_json_properties() {
    let mut renderers = GroupRenderLibrary::default();
    assert_eq!(renderers.types().count(), 22);
    assert!(renderers
        .register(
            "group",
            GroupRenderType {
                variant: GroupVariant::Basic,
                validate_settings: |_| Ok(())
            }
        )
        .is_err());
    for input in [
        r#"{"schemaVersion":"sprout","form":[{"type":"text","type":"group","key":"person"}]}"#,
        r#"{"schemaVersion":"sprout","form":[{"type":"text","key":"name","key":"other"}]}"#,
        r#"{"schemaVersion":"sprout","schemaVersion":"moss","form":[]}"#,
    ] {
        assert!(serde_json::from_str::<RawSchema>(input).is_err());
    }
}
