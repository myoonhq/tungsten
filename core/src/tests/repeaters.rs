use crate::{
    compiler::SchemaCompiler,
    engine::{patch::Patch, structure::FieldRegistration, Engine},
    fields::{CompiledField, FieldBehavior, FieldCompileError, FieldLibrary, FieldType, RawField},
    repeaters::{FormData, RepeaterForm, RepeaterRenderLibrary},
    schema::RawSchema,
    ScalarValue,
};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

fn schema(form: Value) -> RawSchema {
    serde_json::from_value(json!({"schemaVersion":"sprout","form":form})).unwrap()
}
fn repeater() -> Value {
    json!({"type":"repeater","key":"person","reorder":true,"render":{"type":"undereachother","settings":{}},"template":[{"type":"text","key":"person.name","validators":[{"kind":"required"}]}]})
}
fn load(form: Value, data: Value) -> Result<RepeaterForm, String> {
    let data: Option<FormData> = serde_json::from_value(data).unwrap();
    RepeaterForm::load(SchemaCompiler::new(), schema(form), data.as_ref())
}
fn value(form: &RepeaterForm, key: &str) -> ScalarValue {
    form.state().fields[key].value.clone()
}
fn snapshot(form: &RepeaterForm) -> Value {
    json!({"state":form.state(),"graph":form.engine().graph(),"values":form.values()})
}
fn rule(property: &str, operand: Value, action: Value) -> Value {
    json!({"when":{"property":property,"operation":"Eq","value":operand},"then":[action]})
}
#[test]
fn zero_one_many_load_submit_defaults_and_required_noop() {
    let mut r = repeater();
    r["validators"] = json!([{"kind":"required"}]);
    r["current_value"] = json!([{"name":"Default"}]);
    let f = load(json!([r.clone()]), Value::Null).unwrap();
    assert_eq!(f.values()["person"], json!([{"name":"Default"}]));
    for items in [
        json!([]),
        json!([{"name":"Ada"}]),
        json!([{"name":"Ada"},{"name":"Grace"},{"name":"Lin"}]),
    ] {
        let f = load(json!([r.clone()]), json!({"person":items})).unwrap();
        assert_eq!(f.values()["person"], items);
        assert_eq!(
            f.state().repeaters["person"].length,
            items.as_array().unwrap().len()
        );
        assert!(f.valid());
    }
}
#[test]
fn hidden_invalid_children_are_retained_without_blocking_validation() {
    let mut r = repeater();
    r["template"] = json!([{"type":"text","variant":"email","key":"person.email","hidden":true,"validators":[{"kind":"required"}]},{"type":"text","key":"person.name","current_value":"Default"}]);
    let f = load(json!([r]), json!({"person":[{"email":"wrong"},{}]})).unwrap();
    assert!(f.valid());
    assert_eq!(f.state().fields["person[0].email"].errors.len(), 0);
    assert_eq!(f.state().fields["person[1].email"].errors.len(), 0);
    assert_eq!(
        f.values()["person"],
        json!([{"email":"wrong","name":"Default"},{"email":null,"name":"Default"}])
    );
}
#[test]
fn bounds_validate_loaded_data_without_padding_or_truncation_and_enforce_operations() {
    let mut r = repeater();
    r["min"] = json!(1);
    r["max"] = json!(2);
    let mut f = load(json!([r.clone()]), json!({"person":[]})).unwrap();
    assert_eq!(f.state().repeaters["person"].length, 0);
    assert!(!f.valid());
    f.add("person").unwrap();
    assert!(f
        .remove("person", 0)
        .unwrap_err()
        .contains("tg_schema_repeater_is_at_min"));
    f.add("person").unwrap();
    assert!(f
        .add("person")
        .unwrap_err()
        .contains("tg_schema_repeater_has_reached_max"));
    let mut over = load(
        json!([r]),
        json!({"person":[{"name":"A"},{"name":"B"},{"name":"C"}]}),
    )
    .unwrap();
    assert_eq!(over.state().repeaters["person"].length, 3);
    assert!(!over.valid());
    over.remove("person", 2).unwrap();
    assert!(over.valid());
}
#[test]
fn add_remove_reorder_preserve_stable_handles_errors_values_and_unrelated_state() {
    let mut f = load(
        json!([{"type":"text","key":"other"},repeater()]),
        json!({"person":[{"name":"A"},{"name":"B"}],"other":"Untouched"}),
    )
    .unwrap();
    f.process_patch(Patch::SetErrors {
        key: "person[0].name".into(),
        errors: vec!["owned".into()],
    })
    .unwrap();
    f.process_patch(Patch::SetHidden {
        key: "other".into(),
        hidden: true,
    })
    .unwrap();
    let a = f.engine().field_handle("person[0].name").unwrap();
    let b = f.engine().field_handle("person[1].name").unwrap();
    let other = f.state().fields["other"].clone();
    let id = f.state().repeaters["person"].instances[0].id.clone();
    f.reorder("person", 0, 1).unwrap();
    assert_eq!(f.engine().field_handle("person[1].name"), Some(a));
    assert_eq!(f.engine().field_handle("person[0].name"), Some(b));
    assert_eq!(f.state().repeaters["person"].instances[1].id, id);
    assert_eq!(
        serde_json::to_value(&f.state().fields["person[1].name"].errors).unwrap(),
        serde_json::json!(["owned"])
    );
    f.add("person").unwrap();
    assert_eq!(f.state().fields["other"], other);
    assert_eq!(value(&f, "person[1].name"), ScalarValue::String("A".into()));
    assert_eq!(f.state().fields["person[2].name"].errors.len(), 1);
    f.remove("person", 0).unwrap();
    assert_eq!(f.engine().field_handle("person[0].name"), Some(a));
    assert!(f.engine().field_handle("person[2].name").is_none());
    assert!(f.state().fields["person[0].name"]
        .errors
        .contains(&"owned".into()));
    let stale = f
        .engine_mut()
        .remove_fields(&SchemaCompiler::new(), &[b])
        .unwrap_err();
    assert!(stale.contains("tg_schema_unknown_or_stale_field_handle"));
}
#[test]
fn current_and_operand_refs_follow_identity_numeric_refs_follow_position() {
    let mut r = repeater();
    r["template"] = json!([
 {"type":"text","key":"person.name"},
 {"type":"text","key":"person.copy","rules":[rule("person[current].name",json!({"ref":"person[current].match"}),json!({"kind":"set_value","value":"matched"}))]},
 {"type":"text","key":"person.match"}]);
    let outside = json!({"type":"text","key":"outside","rules":[rule("person[0].name",json!("B"),json!({"kind":"set_value","value":"B first"}))]});
    let mut f = load(
        json!([r, outside]),
        json!({"person":[{"name":"A","match":"A"},{"name":"B","match":"no"}]}),
    )
    .unwrap();
    assert_eq!(
        value(&f, "person[0].copy"),
        ScalarValue::String("matched".into())
    );
    assert_eq!(value(&f, "person[1].copy"), ScalarValue::Null);
    f.process_patch(Patch::SetValue {
        key: "person[0].copy".into(),
        value: ScalarValue::String("manual".into()),
    })
    .unwrap();
    f.reorder("person", 1, 0).unwrap();
    assert_eq!(
        value(&f, "person[1].copy"),
        ScalarValue::String("manual".into())
    );
    assert_eq!(value(&f, "outside"), ScalarValue::String("B first".into()));
    f.process_patch(Patch::SetValue {
        key: "person[0].match".into(),
        value: ScalarValue::String("B".into()),
    })
    .unwrap();
    assert_eq!(
        value(&f, "person[0].copy"),
        ScalarValue::String("matched".into())
    );
}
#[test]
fn removal_rejects_dangling_numeric_reference_atomically() {
    let outside = json!({"type":"text","key":"outside","rules":[rule("person[1].name",json!("B"),json!({"kind":"set_hidden","hidden":true}))]});
    let mut f = load(
        json!([repeater(), outside]),
        json!({"person":[{"name":"A"},{"name":"B"}]}),
    )
    .unwrap();
    let before = snapshot(&f);
    assert!(f
        .remove("person", 1)
        .unwrap_err()
        .contains("person[1].name"));
    assert_eq!(snapshot(&f), before);
    assert!(f.remove("person", 0).is_err());
    assert_eq!(snapshot(&f), before);
}
#[test]
fn reordered_numeric_edges_reject_new_cycle_atomically() {
    let mut r = repeater();
    r["template"] = json!([
 {"type":"text","key":"person.a","rules":[rule("outside",json!("x"),json!({"kind":"set_value","value":"x"}))]},
 {"type":"text","key":"person.b"}]);
    let outside = json!({"type":"text","key":"outside","rules":[rule("person[0].b",json!("x"),json!({"kind":"set_value","value":"x"}))]});
    let mut f = load(json!([r, outside]), json!({"person":[{},{}]})).unwrap();
    // A generic dependency edit creates a legal connection in instance 1;
    // moving it into slot 0 closes outside -> a -> b -> outside.
    let mut declarations = f.engine().registrations();
    let target = declarations
        .iter_mut()
        .find(|d| d.field.key == "person[1].b")
        .unwrap();
    target.field.rules = serde_json::from_value(json!([rule(
        "person[1].a",
        json!("x"),
        json!({"kind":"set_value","value":"x"})
    )]))
    .unwrap();
    f.engine_mut()
        .update_structure(&SchemaCompiler::new(), declarations)
        .unwrap();
    let before = snapshot(&f);
    // Generic structural permutation/rebinding proves cycle preflight; repeater templates themselves stay homogeneous.
    let mut declarations = f.engine().registrations();
    for d in &mut declarations {
        if d.field.key.starts_with("person[1].") {
            d.field.key = d.field.key.replace("person[1]", "person[0]");
            for rule in &mut d.field.rules {
                rule.when.property = rule.when.property.replace("person[1]", "person[0]");
            }
        } else if d.field.key.starts_with("person[0].") {
            d.field.key = d.field.key.replace("person[0]", "person[1]");
        }
    }
    assert!(f
        .engine_mut()
        .update_structure(&SchemaCompiler::new(), declarations)
        .unwrap_err()
        .contains("tg_schema_value_cycle"));
    assert_eq!(snapshot(&f), before);
}
#[test]
fn failed_structural_evaluation_rolls_back_touched_state_graph_and_membership() {
    let mut r = repeater();
    r["template"] = json!([{"type":"text","key":"person.name","rules":[rule("trigger",json!("go"),json!({"kind":"set_value","value":"generated"})),rule("trigger",json!("go"),json!({"kind":"set_hidden","hidden":true}))]}]);
    let mut f = load(
        json!([{"type":"text","key":"trigger"},r]),
        json!({"trigger":"go","person":[{}]}),
    )
    .unwrap();
    let before = snapshot(&f);
    f.engine_mut().set_processing_limit(2);
    assert!(f.add("person").unwrap_err().contains("safety_limit"));
    assert_eq!(snapshot(&f), before);
    f.engine_mut().set_processing_limit(100);
    f.add("person").unwrap();
    assert_eq!(
        value(&f, "person[1].name"),
        ScalarValue::String("generated".into())
    );
    assert!(f.state().fields["person[1].name"].hidden);
}
#[test]
fn new_field_reads_existing_values_and_propagates_without_reseeding_unrelated_rules() {
    let mut r = repeater();
    r["template"] = json!([{"type":"text","key":"person.name","rules":[rule("trigger",json!("go"),json!({"kind":"set_value","value":"new"}))]}]);
    let unrelated = json!({"type":"text","key":"manual","rules":[rule("trigger",json!("go"),json!({"kind":"set_value","value":"initial"}))]});
    let mut f = load(
        json!([{"type":"text","key":"trigger"},unrelated,r]),
        json!({"trigger":"go","person":[]}),
    )
    .unwrap();
    f.process_patch(Patch::SetValue {
        key: "manual".into(),
        value: ScalarValue::String("edited".into()),
    })
    .unwrap();
    f.add("person").unwrap();
    assert_eq!(value(&f, "manual"), ScalarValue::String("edited".into()));
    assert_eq!(
        value(&f, "person[0].name"),
        ScalarValue::String("new".into())
    );
}
#[test]
fn grouped_item_projection_labels_and_renderer_changes_preserve_data() {
    let mut r = repeater();
    r["template"] = json!([{"type":"group","variant":"basic","key":"person.contact","view":{"label":"Person"},"render":{"type":"card","settings":{}},"subform":[{"type":"text","key":"person.contact.name"}]}]);
    let mut f = load(
        json!([r.clone()]),
        json!({"person":[{"contact":{"name":"Ada"}}]}),
    )
    .unwrap();
    assert_eq!(f.values()["person"], json!([{"contact":{"name":"Ada"}}]));
    assert_eq!(
        serde_json::to_value(&f.state().repeaters["person"].instances[0].label).unwrap(),
        serde_json::json!({"messageKey":"tg_ui_repeater_instance","params":{"index":1,"label":{"messageKey":"Person"}}})
    );
    let id = f.state().repeaters["person"].instances[0].id.clone();
    f.add("person").unwrap();
    r["render"]["type"] = json!("tabs");
    assert!(f.reload_presentation(schema(json!([r]))).unwrap());
    assert_eq!(f.state().repeaters["person"].length, 2);
    assert_eq!(f.state().repeaters["person"].instances[0].id, id);
    assert_eq!(
        value(&f, "person[0].contact.name"),
        ScalarValue::String("Ada".into())
    );
}
#[test]
fn invalid_template_is_rejected_even_empty_and_unindexed_rules_never_expand() {
    for change in [
        json!({"type":"unknown","key":"person.name"}),
        json!({"type":"text","key":"outside"}),
        json!({"type":"text","key":"person.name","validators":[{"kind":"unknown"}]}),
        json!({"type":"text","key":"person.name","current_value":5}),
    ] {
        let mut r = repeater();
        r["template"] = json!([change]);
        assert!(load(json!([r]), json!({"person":[]})).is_err());
    }
    let mut r = repeater();
    r["template"][0]["rules"] = json!([rule(
        "person.name",
        json!("A"),
        json!({"kind":"set_hidden","hidden":true})
    )]);
    assert!(load(json!([r]), json!({"person":[]}))
        .unwrap_err()
        .contains("tg_schema_unindexed_repeater_reference_is_unsupported_use_current_inside_its_template_or_a_numer"));
    let outside = json!({"type":"text","key":"outside","rules":[rule("person[current].name",json!("A"),json!({"kind":"set_hidden","hidden":true}))]});
    assert!(load(json!([repeater(), outside]), json!({"person":[]}))
        .unwrap_err()
        .contains("has_no_owning_instance"));
}
#[test]
fn bad_shapes_unknown_properties_wrong_types_and_bad_loads_are_atomic() {
    let mut f = load(json!([repeater()]), json!({"person":[{"name":"A"}]})).unwrap();
    let before = snapshot(&f);
    for data in [
        json!({"person":null}),
        json!({"person":{}}),
        json!({"person":[false]}),
        json!({"person":[{"unknown":"x"}]}),
        json!({"person":[{"name":2}]}),
        json!({"person[0].name":"x"}),
        json!({"person":[{"name":[]}]}),
        json!({"person":[{"name":{}}]}),
    ] {
        let data: FormData = serde_json::from_value(data).unwrap();
        assert!(f.load_values(Some(&data)).is_err());
        assert_eq!(snapshot(&f), before);
    }
}
#[test]
fn malformed_bounds_renderers_reserved_properties_and_namespaces_reject() {
    for (property, value) in [
        ("min", json!(-1)),
        ("min", json!(0.5)),
        ("max", json!("2")),
        ("variant", json!("basic")),
        ("length", json!(2)),
        ("subform", json!([])),
    ] {
        let mut r = repeater();
        r[property] = value;
        assert!(
            serde_json::from_value::<RawSchema>(json!({"schemaVersion":"sprout","form":[r]}))
                .is_err()
        );
    }
    let mut r = repeater();
    r["min"] = json!(3);
    r["max"] = json!(1);
    assert!(load(json!([r]), Value::Null).is_err());
    let mut r = repeater();
    r["render"]["settings"] = json!({"unknown":true});
    assert!(load(json!([r]), Value::Null).is_err());
    let mut r = repeater();
    r["template"] = json!([{"type":"repeater","key":"person.children","render":{"type":"tabs","settings":{}},"template":[]}]);
    let mut empty = load(json!([r]), Value::Null).unwrap();
    empty.add("person").unwrap();
    assert_eq!(empty.values()["person"], json!([{"children":[]} ]));
    let mut r = repeater();
    r["template"] =
        json!([{"type":"text","key":"person.name"},{"type":"text","key":"person.name.first"}]);
    assert!(load(json!([r]), Value::Null).is_err());
    let outside = json!({"type":"text","key":"person.extra"});
    assert!(load(json!([repeater(), outside]), Value::Null).is_err());
}
#[test]
fn explicit_indices_must_exist_and_current_cannot_cross_repeaters() {
    let outside = json!({"type":"text","key":"outside","rules":[rule("person[2].name",json!("A"),json!({"kind":"set_hidden","hidden":true}))]});
    assert!(load(
        json!([repeater(), outside]),
        json!({"person":[{"name":"A"}]})
    )
    .unwrap_err()
    .contains("person[2].name"));
    let mut a = repeater();
    a["template"][0]["rules"] = json!([rule(
        "other[current].name",
        json!("A"),
        json!({"kind":"set_hidden","hidden":true})
    )]);
    let mut b = repeater();
    b["key"] = json!("other");
    b["template"][0]["key"] = json!("other.name");
    assert!(load(json!([a, b]), Value::Null)
        .unwrap_err()
        .contains("different_repeater"));
}
#[test]
fn repeated_operations_remove_graph_participation_without_duplicate_edges() {
    let mut r = repeater();
    r["template"][0]["rules"] = json!([rule(
        "trigger",
        json!("go"),
        json!({"kind":"set_hidden","hidden":true})
    )]);
    let mut f = load(json!([{"type":"text","key":"trigger"},r]), Value::Null).unwrap();
    for _ in 0..20 {
        f.add("person").unwrap();
        assert_eq!(
            f.engine().graph().node("trigger").unwrap().affects,
            vec!["person[0].name"]
        );
        f.remove("person", 0).unwrap();
        assert!(f
            .engine()
            .graph()
            .node("trigger")
            .unwrap()
            .affects
            .is_empty());
        assert_eq!(f.state().fields.len(), 1);
    }
}
#[derive(Debug)]
struct CountType(Arc<AtomicUsize>);
#[derive(Debug)]
struct CountBehavior;
impl FieldBehavior for CountBehavior {
    fn type_name(&self) -> &'static str {
        "counted"
    }
}
impl FieldType for CountType {
    fn type_name(&self) -> &'static str {
        "counted"
    }
    fn compile(&self, raw: &RawField) -> Result<CompiledField, FieldCompileError> {
        self.0.fetch_add(1, Ordering::SeqCst);
        CompiledField::new(raw, Arc::new(CountBehavior))
    }
}
#[test]
fn only_added_fields_compile_and_generic_handle_apis_work() {
    let count = Arc::new(AtomicUsize::new(0));
    let mut library = FieldLibrary::default();
    library.register(CountType(count.clone())).unwrap();
    let compiler = SchemaCompiler::with_library(library);
    let mut r = repeater();
    r["template"][0]["type"] = json!("counted");
    r["template"][0]["validators"] = json!([]);
    let data: FormData =
        serde_json::from_value(json!({"person":[{"name":"A"},{"name":"B"}]})).unwrap();
    let mut f = RepeaterForm::load(compiler.clone(), schema(json!([r])), Some(&data)).unwrap();
    count.store(0, Ordering::SeqCst);
    f.add("person").unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 1);
    f.reorder("person", 2, 0).unwrap();
    f.remove("person", 0).unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 1);
    let mut engine = Engine::from_compiled(compiler.compile(schema(json!([]))).unwrap());
    let raw: RawField = serde_json::from_value(json!({"type":"counted","key":"a"})).unwrap();
    let handles = engine.add_fields(&compiler, vec![raw]).unwrap();
    assert_eq!(engine.field_handle("a"), Some(handles[0]));
    engine.reorder_fields(&compiler, &handles).unwrap();
    engine.remove_fields(&compiler, &handles).unwrap();
    assert!(engine.state().fields.is_empty());
    let stale = FieldRegistration {
        handle: Some(handles[0]),
        field: serde_json::from_value(json!({"type":"counted","key":"a"})).unwrap(),
    };
    assert!(engine.update_structure(&compiler, vec![stale]).is_err());
}
#[test]
fn custom_collection_renderer_registration_has_no_variant_or_enum() {
    let mut renderers = RepeaterRenderLibrary::default();
    renderers
        .register("custom", |value| {
            if value.get("layout") == Some(&json!("custom")) {
                Ok(())
            } else {
                Err("layout required".into())
            }
        })
        .unwrap();
    assert!(renderers.register("custom", |_| Ok(())).is_err());
    let mut r = repeater();
    r["render"] = json!({"type":"custom","settings":{"layout":"custom"}});
    assert!(RepeaterForm::load_with_renderers(
        SchemaCompiler::new(),
        renderers,
        schema(json!([r])),
        None
    )
    .is_ok());
}

#[test]
fn added_graph_observers_see_only_stabilized_values_and_load_respects_limit() {
    let mut r = repeater();
    r["template"] = json!([
        {"type":"text","key":"person.observer","rules":[rule("person[current].result",json!("transient"),json!({"kind":"set_errors","errors":["transient leaked"]}))]},
        {"type":"text","key":"person.result","rules":[rule("person[current].a",json!("done"),json!({"kind":"set_value","value":"transient"})),rule("person[current].b",json!("done"),json!({"kind":"set_value","value":"final"}))]},
        {"type":"text","key":"person.a","rules":[rule("trigger",json!("go"),json!({"kind":"set_value","value":"done"}))]},
        {"type":"text","key":"person.b","rules":[rule("trigger",json!("go"),json!({"kind":"set_value","value":"done"}))]}
    ]);
    let mut f = load(
        json!([{"type":"text","key":"trigger"},r]),
        json!({"trigger":"go","person":[]}),
    )
    .unwrap();
    f.add("person").unwrap();
    assert_eq!(
        value(&f, "person[0].result"),
        ScalarValue::String("final".into())
    );
    assert!(f.state().fields["person[0].observer"].errors.is_empty());
    let before = snapshot(&f);
    f.engine_mut().set_processing_limit(1);
    let data: FormData = serde_json::from_value(json!({"trigger":"go","person":[{}]})).unwrap();
    assert!(f
        .load_values(Some(&data))
        .unwrap_err()
        .contains("safety_limit"));
    assert_eq!(snapshot(&f), before);
}

#[test]
fn schema_collection_defaults_validate_even_when_data_overrides_them() {
    for default in [
        json!([false]),
        json!([{"name":3}]),
        json!([{"extra":"wrong"}]),
    ] {
        let mut r = repeater();
        r["current_value"] = default;
        assert!(load(json!([r]), json!({"person":[]})).is_err());
    }
    let mut r = repeater();
    r["render"] = json!({"type":"custom","settings":{}});
    let mut renderers = RepeaterRenderLibrary::empty();
    renderers.register("custom", |_| Ok(())).unwrap();
    let compiler = SchemaCompiler::with_libraries(
        FieldLibrary::default(),
        crate::groups::GroupRenderLibrary::empty(),
    );
    assert!(
        RepeaterForm::load_with_renderers(compiler, renderers, schema(json!([r])), None).is_ok()
    );
}

#[test]
fn collection_wrapper_preserves_existing_scalar_grouping_reload_contract() {
    let grouped = schema(
        json!([{"type":"group","variant":"basic","key":"profile","render":{"type":"card","settings":{}},"subform":[{"type":"text","key":"profile.name"}]}]),
    );
    let mut form = RepeaterForm::load(SchemaCompiler::new(), grouped, None).unwrap();
    form.process_patch(Patch::SetValue {
        key: "profile.name".into(),
        value: ScalarValue::String("Edited".into()),
    })
    .unwrap();
    assert!(form
        .reload_presentation(schema(json!([{"type":"text","key":"profile.name"}])))
        .unwrap());
    assert_eq!(
        value(&form, "profile.name"),
        ScalarValue::String("Edited".into())
    );
    assert!(!form
        .reload_presentation(schema(
            json!([{"type":"text","key":"profile.name","view":{"label":"Changed"}}])
        ))
        .unwrap());
}

#[test]
fn sectioned_template_groups_rename_initial_section_paths_and_current_refs() {
    let mut r = repeater();
    r["template"] = json!([{"type":"group","variant":"sectioned","key":"person.details","view":{"label":"Person"},"render":{"type":"tabs","settings":{"initialSection":"person.details.contact"}},"subform":[{"type":"group","variant":"basic","key":"person.details.contact","render":{"type":"group","settings":{}},"subform":[{"type":"text","key":"person.details.contact.name"},{"type":"text","key":"person.details.contact.note","rules":[rule("person[current].details.contact.name",json!("A"),json!({"kind":"set_hidden","hidden":true}))]}]}]}]);
    let mut f=load(json!([r]),json!({"person":[{"details":{"contact":{"name":"A"}}},{"details":{"contact":{"name":"B"}}}]})).unwrap();
    f.reorder("person", 0, 1).unwrap();
    let tree = serde_json::to_value(&f.state().repeaters["person"].instances[1].form).unwrap();
    assert_eq!(
        tree[0]["render"]["settings"]["initialSection"],
        "person[1].details.contact"
    );
    assert!(f.state().fields["person[1].details.contact.note"].hidden);
    assert_eq!(f.values()["person"][1]["details"]["contact"]["name"], "A");
}

fn nested() -> Value {
    json!({"type":"repeater","key":"people","reorder":true,"render":{"type":"tabs","settings":{}},"template":[
        {"type":"text","key":"people.name"},
        {"type":"repeater","key":"people.children","reorder":true,"render":{"type":"tabs","settings":{}},"template":[
            {"type":"text","key":"people.children.name","validators":[{"kind":"required"}]},
            {"type":"text","key":"people.children.note","rules":[
                rule("people[current].children[current].name",json!("Ada"),json!({"kind":"set_hidden","hidden":true})),
                rule("people[current].name",json!("Hide"),json!({"kind":"set_hidden","hidden":true}))
            ]}
        ]}
    ]})
}
#[test]
fn nested_loading_projects_zero_one_many_and_binds_current_at_each_level() {
    let data = json!({"people":[{"name":"Parent","children":[{"name":"Ada","note":"one"},{"name":"Grace","note":"two"}]},{"name":"Hide","children":[{"name":"Lin","note":"three"}]},{"name":"Empty","children":[]}]});
    let mut f = load(json!([nested()]), data.clone()).unwrap();
    assert_eq!(json!(f.values()), data);
    assert_eq!(f.state().repeaters["people[0].children"].length, 2);
    assert_eq!(f.state().repeaters["people[2].children"].length, 0);
    assert!(f.state().fields["people[0].children[0].note"].hidden);
    assert!(!f.state().fields["people[0].children[1].note"].hidden);
    assert!(f.state().fields["people[1].children[0].note"].hidden);
    f.process_patch(Patch::SetValue {
        key: "people[0].children[1].name".into(),
        value: ScalarValue::String("Ada".into()),
    })
    .unwrap();
    assert!(f.state().fields["people[0].children[1].note"].hidden);
    assert!(!load(json!([nested()]), json!({"people":[]}))
        .unwrap()
        .state()
        .repeaters
        .contains_key("people[0].children"));
}
#[test]
fn nested_operations_preserve_entire_descendant_identity_and_state() {
    let mut f = load(json!([nested()]), json!({"people":[{"name":"P","children":[{"name":"Ada"},{"name":"Grace"}]},{"name":"Q","children":[]}]})).unwrap();
    let child = f
        .engine()
        .field_handle("people[0].children[0].name")
        .unwrap();
    let id = f.state().repeaters["people[0].children"].instances[0]
        .id
        .clone();
    f.process_patch(Patch::SetErrors {
        key: "people[0].children[0].name".into(),
        errors: vec!["owned".into()],
    })
    .unwrap();
    f.reorder("people", 0, 1).unwrap();
    assert_eq!(
        f.engine().field_handle("people[1].children[0].name"),
        Some(child)
    );
    assert_eq!(
        f.state().repeaters["people[1].children"].instances[0].id,
        id
    );
    assert_eq!(
        serde_json::to_value(&f.state().fields["people[1].children[0].name"].errors).unwrap(),
        serde_json::json!(["owned"])
    );
    f.reorder("people[1].children", 0, 1).unwrap();
    assert_eq!(
        f.engine().field_handle("people[1].children[1].name"),
        Some(child)
    );
    f.add("people[0].children").unwrap();
    assert_eq!(
        f.state().fields["people[0].children[0].name"].errors.len(),
        1
    );
    f.remove("people", 0).unwrap();
    assert_eq!(
        f.engine().field_handle("people[0].children[1].name"),
        Some(child)
    );
    assert!(!f.state().repeaters.contains_key("people[1].children"));
    f.remove("people[0].children", 0).unwrap();
    assert_eq!(
        f.engine().field_handle("people[0].children[0].name"),
        Some(child)
    );
    f.remove("people", 0).unwrap();
    assert!(f.state().fields.is_empty());
    assert_eq!(json!(f.values()), json!({"people":[]}));
}
#[test]
fn nested_defaults_add_and_presentation_reload_preserve_loaded_edits() {
    let mut r = nested();
    r["template"][1]["current_value"] = json!([{"name":"Default","note":"Seed"}]);
    let mut f = load(json!([r.clone()]), json!({"people":[{"name":"P"}]})).unwrap();
    assert_eq!(
        value(&f, "people[0].children[0].name"),
        ScalarValue::String("Default".into())
    );
    f.process_patch(Patch::SetValue {
        key: "people[0].children[0].name".into(),
        value: ScalarValue::String("Edited".into()),
    })
    .unwrap();
    f.add("people").unwrap();
    assert_eq!(
        value(&f, "people[1].children[0].name"),
        ScalarValue::String("Default".into())
    );
    f.reorder("people", 0, 1).unwrap();
    r["template"][1]["render"]["type"] = json!("undereachother");
    let before = json!(f.values());
    assert!(f.reload_presentation(schema(json!([r]))).unwrap());
    assert_eq!(json!(f.values()), before);
    assert_eq!(
        value(&f, "people[1].children[0].name"),
        ScalarValue::String("Edited".into())
    );
}
#[test]
fn nested_bad_shapes_defaults_and_unowned_selectors_reject_atomically() {
    let mut f = load(json!([nested()]), json!({"people":[{"children":[]}]})).unwrap();
    let before = snapshot(&f);
    for data in [
        json!({"people":[{"children":null}]}),
        json!({"people":[{"children":[{"unknown":1}]}]}),
        json!({"people":[{"children":[{"name":5}]}]}),
    ] {
        let values: FormData = serde_json::from_value(data).unwrap();
        assert!(f.load_values(Some(&values)).is_err());
        assert_eq!(snapshot(&f), before);
    }
    let mut bad = nested();
    bad["template"][1]["current_value"] = json!([{"name":5}]);
    assert!(load(json!([bad]), json!({"people":[]})).is_err());
    let mut bad = nested();
    bad["template"][0]["rules"] = json!([rule(
        "people[current].children[current].name",
        json!("Ada"),
        json!({"kind":"show"})
    )]);
    assert!(load(json!([bad]), json!({"people":[]})).is_err());
    let outside = json!({"type":"text","key":"outside","rules":[rule("people[0].children[current].name",json!("Ada"),json!({"kind":"show"}))]});
    assert!(load(json!([nested(), outside]), json!({"people":[]})).is_err());
}
#[test]
fn nested_numeric_references_rebind_and_dangling_removal_rolls_back() {
    let outside = json!({"type":"text","key":"outside","rules":[rule("people[0].children[1].name",json!("Ada"),json!({"kind":"set_hidden","hidden":true}))]});
    let mut f = load(
        json!([nested(), outside]),
        json!({"people":[{"children":[{"name":"Ada"},{"name":"Grace"}]}]}),
    )
    .unwrap();
    assert!(!f.state().fields["outside"].hidden);
    f.reorder("people[0].children", 0, 1).unwrap();
    assert!(f.state().fields["outside"].hidden);
    let before = snapshot(&f);
    assert!(f.remove("people[0].children", 0).is_err());
    assert_eq!(snapshot(&f), before);
    assert!(f.remove("people", 0).is_err());
    assert_eq!(snapshot(&f), before);
}
#[test]
fn three_levels_expand_with_mixed_parent_and_current_operand_references() {
    let r = json!({"type":"repeater","key":"a","reorder":true,"render":{"type":"tabs","settings":{}},"template":[
        {"type":"text","key":"a.name"},
        {"type":"repeater","key":"a.b","render":{"type":"tabs","settings":{}},"template":[
            {"type":"repeater","key":"a.b.c","render":{"type":"tabs","settings":{}},"template":[
                {"type":"text","key":"a.b.c.name"},
                {"type":"text","key":"a.b.c.note","rules":[rule("a[current].b[current].c[current].name",json!({"ref":"a[current].name"}),json!({"kind":"set_hidden","hidden":true}))]}
            ]}
        ]}
    ]});
    let data = json!({"a":[{"name":"A","b":[{"c":[{"name":"A","note":"Hidden"}]}]}]});
    let mut f = load(json!([r]), data.clone()).unwrap();
    assert_eq!(json!(f.values()), data);
    assert!(f.state().fields["a[0].b[0].c[0].note"].hidden);
    f.add("a[0].b[0].c").unwrap();
    assert_eq!(f.state().repeaters["a[0].b[0].c"].length, 2);
}

#[test]
fn nested_min_max_apply_independently_and_new_subtrees_only_compile_new_leaves() {
    let count = Arc::new(AtomicUsize::new(0));
    let mut library = FieldLibrary::default();
    library.register(CountType(count.clone())).unwrap();
    let mut r = nested();
    r["template"][1]["min"] = json!(1);
    r["template"][1]["max"] = json!(2);
    r["template"][1]["current_value"] = json!([{"name":"Default"}]);
    r["template"][1]["template"] = json!([{"type":"counted","key":"people.children.name"}]);
    let data: FormData =
        serde_json::from_value(json!({"people":[{"children":[]},{"children":[{"name":"A"}]}]}))
            .unwrap();
    let mut f = RepeaterForm::load(
        SchemaCompiler::with_library(library),
        schema(json!([r])),
        Some(&data),
    )
    .unwrap();
    assert!(!f.valid());
    assert_eq!(f.state().repeaters["people[0].children"].errors.len(), 1);
    assert!(f.remove("people[1].children", 0).is_err());
    count.store(0, Ordering::SeqCst);
    f.add("people[0].children").unwrap();
    assert!(f.valid());
    assert_eq!(count.load(Ordering::SeqCst), 1);
    f.add("people").unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 2);
    assert_eq!(
        value(&f, "people[2].children[0].name"),
        ScalarValue::String("Default".into())
    );
    f.add("people[1].children").unwrap();
    let before = snapshot(&f);
    assert!(f.add("people[1].children").is_err());
    assert_eq!(snapshot(&f), before);
    f.reorder("people", 0, 2).unwrap();
    f.remove("people", 1).unwrap();
    assert_eq!(count.load(Ordering::SeqCst), 3);
}
#[test]
fn nested_processing_failure_rolls_back_parent_and_default_children_together() {
    let mut r = nested();
    r["template"][1]["current_value"] = json!([{"name":"Ada"}]);
    let mut f = load(json!([r]), json!({"people":[]})).unwrap();
    let before = snapshot(&f);
    f.set_processing_limit(0);
    assert!(f.add("people").is_err());
    assert_eq!(snapshot(&f), before);
    f.set_processing_limit(100_000);
    f.add("people").unwrap();
    assert_eq!(f.state().repeaters["people"].instances[0].id, "0");
    assert_eq!(
        f.state().repeaters["people[0].children"].instances[0].id,
        "1"
    );
    assert!(f.state().fields["people[0].children[0].note"].hidden);
}

#[test]
fn scalar_flat_key_loading_is_unchanged_by_nested_namespace_checks() {
    let f = load(
        json!([{"type":"text","key":"contact"},{"type":"text","key":"contact.name"}]),
        json!({"contact":"Flat","contact.name":"Also flat"}),
    )
    .unwrap();
    assert_eq!(
        json!(f.values()),
        json!({"contact":"Flat","contact.name":"Also flat"})
    );
}
#[test]
fn sectioned_groups_inside_nested_repeaters_expand_initial_section_and_refs() {
    let mut r = nested();
    r["template"][1]["template"] = json!([{"type":"group","variant":"sectioned","key":"people.children.sections","render":{"type":"tabs","settings":{"initialSection":"people.children.sections.extra"}},"subform":[
        {"type":"group","variant":"basic","key":"people.children.sections.main","render":{"type":"group","settings":{}},"subform":[{"type":"text","key":"people.children.sections.main.name"}]},
        {"type":"group","variant":"basic","key":"people.children.sections.extra","render":{"type":"group","settings":{}},"subform":[{"type":"text","key":"people.children.sections.extra.note","rules":[rule("people[current].children[current].sections.main.name",json!("Ada"),json!({"kind":"set_hidden","hidden":true}))]}]}
    ]}]);
    let mut f = load(
        json!([r]),
        json!({"people":[{"children":[{"sections":{"main":{"name":"Ada"}}}]}]}),
    )
    .unwrap();
    let group = &f.state().repeaters["people[0].children"].instances[0].form[0];
    if let crate::schema::RawComponent::Group(group) = group {
        assert_eq!(
            group.render.settings["initialSection"],
            json!("people[0].children[0].sections.extra")
        );
    } else {
        panic!("expected group")
    }
    assert!(f.state().fields["people[0].children[0].sections.extra.note"].hidden);
    f.add("people").unwrap();
    f.reorder("people", 0, 1).unwrap();
    assert!(f.state().fields["people[1].children[0].sections.extra.note"].hidden);
}

#[test]
fn structural_changes_validate_downstream_visibility_without_a_value_edit() {
    for operation in ["reorder", "remove"] {
        let mut f = load(json!([
            {"type":"repeater","key":"people","reorder":true,"render":{"type":"tabs","settings":{}},"template":[{"type":"text","key":"people.name"}]},
            {"type":"text","key":"derived","rules":[{"when":{"property":"people[0].name","operation":"Eq","value":"y"},"then":[{"kind":"set_value","value":"go"}]}]},
            {"type":"text","key":"target","hidden":true,"validators":[{"kind":"required"}],"rules":[{"when":{"property":"derived","operation":"Eq","value":"go"},"then":[{"kind":"set_hidden","hidden":false}]}]}
        ]), json!({"people":[{"name":"x"},{"name":"y"}]})).unwrap();
        assert!(f.valid());
        if operation == "reorder" {
            f.reorder("people", 1, 0).unwrap();
        } else {
            f.remove("people", 0).unwrap();
        }
        let state = f.state();
        assert!(!state.fields["target"].hidden);
        assert_eq!(state.fields["target"].errors.len(), 1);
        assert!(!f.valid());
        f.process_patch(Patch::SetValue {
            key: "target".into(),
            value: ScalarValue::String("corrected".into()),
        })
        .unwrap();
        assert!(f.valid());
    }
}
