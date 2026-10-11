use crate::{
    compiler::SchemaCompiler,
    engine::patch::Patch,
    repeaters::RepeaterForm,
    sources::{SourceCommand, SourceEffect},
    ScalarValue,
};
use serde_json::{json, Value};
fn form(fields: Value, values: Option<Value>) -> Result<RepeaterForm, String> {
    let values = values.map(|v| serde_json::from_value(v).unwrap());
    RepeaterForm::load_with_sources(
        SchemaCompiler::new(),
        serde_json::from_value(json!({"schemaVersion":"sprout","form":fields})).unwrap(),
        values.as_ref(),
        ["names".to_string(), "choices".to_string()].into(),
    )
}
fn resolve(form: &mut RepeaterForm, effect: &SourceEffect, data: Value) -> bool {
    form.engine_mut()
        .source_command(SourceCommand::Resolve {
            id: effect.id.clone(),
            revision: effect.revision.clone(),
            data,
        })
        .unwrap()
}
#[test]
fn sources_wait_disable_and_propagate_only_ready_values() {
    let mut f = form(json!([
        {"type":"text","key":"first","bindings":{"value":{"source":"names"}}},
        {"type":"text","key":"second","bindings":{"value":{"source":"names","params":{"name":{"ref":"first"}}}}},
        {"type":"text","key":"observer","rules":[{"when":{"property":"first","operation":"Eq","value":null},"then":[{"kind":"set_value","value":"WRONG"}]}]}
    ]), None).unwrap();
    assert!(!f.valid());
    assert_eq!(f.state().fields["observer"].value, ScalarValue::Null);
    assert!(f.state().fields["second"].unresolved);
    let effects = f.engine_mut().source_effects();
    assert_eq!(effects.len(), 1);
    assert!(resolve(&mut f, &effects[0], json!("Ada")));
    let effects = f.engine_mut().source_effects();
    assert_eq!(effects.len(), 1);
    assert_eq!(effects[0].params["name"], ScalarValue::String("Ada".into()));
    resolve(&mut f, &effects[0], json!("Ready"));
    assert!(f.valid());
}
#[test]
fn wrong_types_fail_without_overwriting_and_retry_has_new_revision() {
    let mut f = form(
        json!([{ "type":"number","key":"age","bindings":{"value":{"source":"names"}}}]),
        None,
    )
    .unwrap();
    let first = f.engine_mut().source_effects().remove(0);
    resolve(&mut f, &first, json!([1, 2]));
    assert_eq!(f.state().fields["age"].value, ScalarValue::Null);
    assert!(!f.valid());
    assert!(!f.state().fields["age"].source_errors.is_empty());
    assert!(f.state().fields["age"].loading_sources.is_empty());
    f.engine_mut()
        .source_command(SourceCommand::Retry {
            id: first.id.clone(),
        })
        .unwrap();
    let second = f.engine_mut().source_effects().remove(0);
    assert_ne!(first.revision, second.revision);
    assert!(!resolve(&mut f, &first, json!(90)));
    resolve(&mut f, &second, json!(30));
    assert!(f.valid());
}
#[test]
fn live_inputs_invalidate_old_requests_and_options_clear_invalid_selection() {
    let mut f = form(json!([
        {"type":"text","key":"country","current_value":"SK"},
        {"type":"select","key":"city","current_value":"BA","bindings":{"options":{"source":"choices","params":{"country":{"ref":"country"}}}}}
    ]), None).unwrap();
    let first = f.engine_mut().source_effects().remove(0);
    f.process_patch(Patch::SetValue {
        key: "country".into(),
        value: ScalarValue::String("CZ".into()),
    })
    .unwrap();
    let second = f.engine_mut().source_effects().remove(0);
    assert!(!resolve(
        &mut f,
        &first,
        json!([{"value":"BA","label":"Bratislava"}])
    ));
    resolve(&mut f, &second, json!([{"value":"PR","label":"Prague"}]));
    assert!(f.valid());
    assert_eq!(f.state().fields["city"].value, ScalarValue::Null);
    f.process_patch(Patch::SetValue {
        key: "city".into(),
        value: ScalarValue::String("PR".into()),
    })
    .unwrap();
    assert!(f.valid());
}
#[test]
fn initial_sources_preserve_draft_values_and_live_is_explicit() {
    let fields = json!([{ "type":"text","key":"name","bindings":{"value":{"source":"names"}}}]);
    let mut f = form(fields, Some(json!({"name":"saved"}))).unwrap();
    assert!(f.engine_mut().source_effects().is_empty());
    assert!(f.valid());
    let mut live = form(json!([{ "type":"text","key":"name","bindings":{"value":{"source":"names","apply":"live"}}}]), Some(json!({"name":"saved"}))).unwrap();
    assert_eq!(live.engine_mut().source_effects().len(), 1);
    assert!(!live.valid());
}
#[test]
fn rejects_source_cycles_and_invalid_bindings_even_in_empty_templates() {
    for fields in [
        json!([{ "type":"text","key":"name","bindings":{"value":{"source":"names","params":{"x":{"ref":"name"}}}}}]),
        json!([{ "type":"text","key":"name","bindings":{"options":{"source":"names"}}}]),
        json!([{ "type":"text","key":"name","bindings":{"value":{"source":"missing"}}}]),
        json!([{ "type":"repeater","key":"items","render":{"type":"undereachother","settings":{}},"template":[{"type":"text","key":"items.name","bindings":{"value":{"source":"names","params":{"x":{"ref":"missing"}}}}}]}]),
    ] {
        assert!(form(fields, None).is_err());
    }
}
#[test]
fn repeater_requests_follow_handles_and_reject_old_positions() {
    let mut f = form(json!([{ "type":"repeater","key":"items","reorder":true,"render":{"type":"undereachother","settings":{}},"template":[
        {"type":"text","key":"items.input"},
        {"type":"select","key":"items.choice","bindings":{"options":{"source":"choices","params":{"input":{"ref":"items[current].input"}}}}}
    ]}]), Some(json!({"items":[{"input":"one"},{"input":"two"}]}))).unwrap();
    let effects = f.engine_mut().source_effects();
    assert_eq!(effects.len(), 2);
    let first = effects
        .iter()
        .find(|e| e.params["input"] == ScalarValue::String("one".into()))
        .unwrap();
    let handle = f.engine().field_handle("items[0].choice").unwrap();
    f.reorder("items", 0, 1).unwrap();
    assert_eq!(f.engine().field_handle("items[1].choice"), Some(handle));
    assert!(!resolve(
        &mut f,
        first,
        json!([{"value":"old","label":"Old"}])
    ));
    let effect = f
        .engine_mut()
        .source_effects()
        .into_iter()
        .find(|e| e.id == first.id)
        .unwrap();
    resolve(&mut f, &effect, json!([{"value":"new","label":"New"}]));
    assert_eq!(
        f.state().fields["items[1].choice"]
            .options
            .as_ref()
            .unwrap()[0]
            .value
            .as_str()
            .unwrap(),
        "new"
    );
    f.remove("items", 1).unwrap();
    assert!(!resolve(&mut f, &effect, json!([])));
}
#[test]
fn file_constraints_and_durable_projection_work_in_groups_and_repeaters() {
    let fields = json!([{ "type":"file","key":"files","upload":{"api":"main","endpoint":"files","timing":"selection"},"maxSize":10,"accept":[".txt"],"validators":[{"kind":"required"}] }]);
    let mut f = form(fields, None).unwrap();
    assert!(!f.valid());
    let files = json!({"files":[{"id":"one","name":"hello.txt","size":5,"mediaType":"text/plain","uploaded":true}]});
    f.process_patch(Patch::SetValue {
        key: "files".into(),
        value: serde_json::from_value(files.clone()).unwrap(),
    })
    .unwrap();
    assert!(f.valid());
    assert_eq!(f.values()["files"], files);
    let mut bad = files.clone();
    bad["files"][0]["size"] = json!(11);
    f.process_patch(Patch::SetValue {
        key: "files".into(),
        value: serde_json::from_value(bad).unwrap(),
    })
    .unwrap();
    assert!(!f.valid());
    assert!(form(json!([{ "type":"file","key":"files" }]), None).is_err());
    assert!(form(json!([{ "type":"file","key":"files","upload":{"api":"main","endpoint":"files","timing":"never"} }]),None).is_err());
}
#[test]
fn isolated_edits_only_dirty_one_field_in_ten_thousand() {
    let fields: Vec<Value> = (0..10_000)
        .map(|i| json!({"type":"text","key":format!("field{i}")}))
        .collect();
    let mut f = form(json!(fields), None).unwrap();
    f.engine_mut().take_dirty();
    f.process_patch(Patch::SetValue {
        key: "field5000".into(),
        value: ScalarValue::String("changed".into()),
    })
    .unwrap();
    let dirty = f.engine_mut().take_dirty();
    assert_eq!(dirty.len(), 1);
    assert!(dirty.contains_key("field5000"));
}

#[test]
fn failed_source_evaluation_rolls_back_and_can_report_failure() {
    let mut f = form(json!([
        {"type":"text","key":"source","bindings":{"value":{"source":"names"}}},
        {"type":"text","key":"target","rules":[{"when":{"property":"source","operation":"Eq","value":"go"},"then":[{"kind":"set_value","value":"changed"}]}]}
    ]), None).unwrap();
    let effect = f.engine_mut().source_effects().remove(0);
    let before = serde_json::to_value(f.state()).unwrap();
    f.set_processing_limit(1);
    assert!(f
        .engine_mut()
        .source_command(SourceCommand::Resolve {
            id: effect.id.clone(),
            revision: effect.revision.clone(),
            data: json!("go")
        })
        .is_err());
    assert_eq!(serde_json::to_value(f.state()).unwrap(), before);
    f.engine_mut()
        .source_command(SourceCommand::Fail {
            id: effect.id,
            revision: effect.revision,
            message: "evaluation failed".into(),
        })
        .unwrap();
    assert!(f.state().fields["source"].loading_sources.is_empty());
    assert!(!f.state().fields["source"].source_errors.is_empty());
}
#[test]
fn clearing_files_uses_a_typed_empty_list_and_nested_projection_preserves_references() {
    let upload = json!({"api":"main","endpoint":"files"});
    let reference = json!({"files":[{"id":"one","name":"a.txt","size":2,"mediaType":"text/plain","uploaded":true}]});
    let mut f = form(json!([
        {"type":"file","key":"file","upload":upload},
        {"type":"repeater","key":"rows","render":{"type":"undereachother","settings":{}},"template":[{"type":"file","key":"rows.file","upload":upload}]}
    ]), Some(json!({"file":reference,"rows":[{"file":reference}]}))).unwrap();
    assert_eq!(f.values()["rows"][0]["file"], reference);
    f.process_patch(Patch::ClearValue { key: "file".into() })
        .unwrap();
    assert_eq!(f.values()["file"], json!({"files":[]}));
}

#[test]
fn source_cycles_are_rejected_with_supplied_values_and_empty_collections() {
    assert!(form(json!([{ "type":"text","key":"name","bindings":{"value":{"source":"names","params":{"x":{"ref":"name"}}}}}]), Some(json!({"name":"saved"}))).is_err());
    assert!(form(json!([{ "type":"repeater","key":"rows","render":{"type":"undereachother","settings":{}},"template":[{"type":"text","key":"rows.name","bindings":{"value":{"source":"names","params":{"x":{"ref":"rows[current].name"}}}}}]}]), None).is_err());
}

#[test]
fn multiple_select_defaults_required_clear_and_shape_validation() {
    let fields = json!([{"type":"select","key":"cities","multiple":true,"validators":[{"kind":"required"}],"options":[{"value":"BA","label":"Bratislava"},{"value":"KE","label":"Košice"}]}]);
    let mut f = form(fields.clone(), None).unwrap();
    assert_eq!(
        f.state().fields["cities"].value,
        ScalarValue::Strings(vec![])
    );
    assert!(!f.valid());
    f.process_patch(Patch::SetValue {
        key: "cities".into(),
        value: ScalarValue::Strings(vec!["BA".into(), "KE".into()]),
    })
    .unwrap();
    assert!(f.valid());
    assert_eq!(
        serde_json::to_value(f.values()).unwrap()["cities"],
        json!(["BA", "KE"])
    );
    let before = f.state().clone();
    for value in [
        json!("BA"),
        json!(["BA", "BA"]),
        json!([""]),
        json!({"files":[]}),
    ] {
        assert!(f
            .process_patch(Patch::SetValue {
                key: "cities".into(),
                value: serde_json::from_value(value).unwrap()
            })
            .is_err());
        assert_eq!(
            serde_json::to_value(f.state()).unwrap(),
            serde_json::to_value(&before).unwrap()
        );
    }
    f.process_patch(Patch::ClearValue {
        key: "cities".into(),
    })
    .unwrap();
    assert_eq!(
        f.state().fields["cities"].value,
        ScalarValue::Strings(vec![])
    );
    assert!(!f.valid());
    assert!(form(fields, Some(json!({"cities":["BA"]})))
        .unwrap()
        .valid());
    assert!(form(
        json!([{"type":"select","key":"city","multiple":"true"}]),
        None
    )
    .is_err());
    assert!(form(
        json!([{"type":"select","key":"city","current_value":["BA"]}]),
        None
    )
    .is_err());
}

#[test]
fn multiple_select_source_removes_only_unavailable_selected_values() {
    let mut f = form(json!([
        {"type":"select","key":"cities","multiple":true,"current_value":["BA","KE"],"bindings":{"options":{"source":"choices"}}}
    ]), None).unwrap();
    let effect = f.engine_mut().source_effects().remove(0);
    resolve(
        &mut f,
        &effect,
        json!([{"value":"BA","label":"Bratislava"}]),
    );
    assert!(f.valid());
    assert_eq!(
        f.state().fields["cities"].value,
        ScalarValue::Strings(vec!["BA".into()])
    );
    f.process_patch(Patch::SetValue {
        key: "cities".into(),
        value: ScalarValue::Strings(vec!["BA".into()]),
    })
    .unwrap();
    assert!(f.valid());
}

#[test]
fn multiple_select_values_project_and_reload_inside_nested_repeaters() {
    let schema = json!([{"type":"repeater","key":"rows","render":{"type":"undereachother","settings":{}},"template":[
        {"type":"select","key":"rows.cities","multiple":true,"options":[{"value":"BA","label":"Bratislava"}]},
        {"type":"repeater","key":"rows.children","render":{"type":"undereachother","settings":{}},"template":[{"type":"select","key":"rows.children.cities","multiple":true}]}
    ]}]);
    let values = json!({"rows":[{"cities":["BA"],"children":[{"cities":[]}]}]});
    let mut f = form(schema.clone(), Some(values.clone())).unwrap();
    assert_eq!(serde_json::to_value(f.values()).unwrap(), values);
    f.process_patch(Patch::SetValue {
        key: "rows[0].children[0].cities".into(),
        value: ScalarValue::Strings(vec!["KE".into()]),
    })
    .unwrap();
    let saved = serde_json::to_value(f.values()).unwrap();
    assert_eq!(saved["rows"][0]["children"][0]["cities"], json!(["KE"]));
    assert_eq!(
        serde_json::to_value(form(schema, Some(saved.clone())).unwrap().values()).unwrap(),
        saved
    );
}

#[test]
fn changing_country_clears_region_and_city_and_propagates_rules_and_sources() {
    let mut f = form(json!([
        {"type":"text","key":"country","current_value":"SK"},
        {"type":"select","key":"region","current_value":"SK-BA","bindings":{"options":{"source":"choices","params":{"country":{"ref":"country"}}}}},
        {"type":"select","key":"city","current_value":"BA","validators":[{"kind":"required"}],"bindings":{"options":{"source":"choices","params":{"country":{"ref":"country"},"region":{"ref":"region"}}}}},
        {"type":"text","key":"status","rules":[{"when":{"property":"region","operation":"Eq","value":null},"then":[{"kind":"set_value","value":"Region cleared"}]}]},
        {"type":"text","key":"cityStatus","rules":[{"when":{"property":"city","operation":"Eq","value":null},"then":[{"kind":"set_value","value":"City cleared"}]}]}
    ]), None).unwrap();
    let initial = f.engine_mut().source_effects();
    for effect in initial {
        let data = if effect.params.contains_key("region") {
            json!([{"value":"BA","label":"Bratislava"}])
        } else {
            json!([{"value":"SK-BA","label":"Bratislava Region"}])
        };
        resolve(&mut f, &effect, data);
    }
    assert!(f.valid());
    f.process_patch(Patch::SetValue {
        key: "country".into(),
        value: ScalarValue::String("CZ".into()),
    })
    .unwrap();
    let requests = f.engine_mut().source_effects();
    let region = requests
        .iter()
        .find(|e| !e.params.contains_key("region"))
        .unwrap();
    let obsolete_city = requests
        .iter()
        .find(|e| e.params.contains_key("region"))
        .unwrap();
    assert_eq!(
        f.state().fields["region"].value,
        ScalarValue::String("SK-BA".into())
    );
    assert_eq!(
        f.state().fields["region"].options.as_ref().unwrap()[0].label,
        "Bratislava Region"
    );
    resolve(
        &mut f,
        region,
        json!([{"value":"CZ-JM","label":"South Moravian Region"}]),
    );
    assert_eq!(f.state().fields["region"].value, ScalarValue::Null);
    assert_eq!(
        f.state().fields["status"].value,
        ScalarValue::String("Region cleared".into())
    );
    let new_city = f.engine_mut().source_effects().remove(0);
    assert_eq!(new_city.params["region"], ScalarValue::Null);
    assert_eq!(new_city.params["country"], ScalarValue::String("CZ".into()));
    assert!(!resolve(
        &mut f,
        obsolete_city,
        json!([{"value":"BA","label":"Stale"}])
    ));
    resolve(&mut f, &new_city, json!([{"value":"BR","label":"Brno"}]));
    assert_eq!(f.state().fields["city"].value, ScalarValue::Null);
    assert_eq!(
        f.state().fields["cityStatus"].value,
        ScalarValue::String("City cleared".into())
    );
    assert_eq!(
        serde_json::to_value(&f.state().fields["city"].errors).unwrap(),
        serde_json::json!([{"messageKey": "tg_validation_required"}])
    );
    assert!(!f.valid());
}

#[test]
fn matching_initial_selection_runs_left_and_right_operand_rules_only_when_ready() {
    let mut f = form(json!([
        {"type":"select","key":"choice","current_value":"BA","bindings":{"options":{"source":"choices"}}},
        {"type":"text","key":"input","current_value":"BA"},
        {"type":"text","key":"left","hidden":true,"rules":[{"when":{"property":"choice","operation":"Eq","value":"BA"},"then":[{"kind":"show"}]}]},
        {"type":"text","key":"right","hidden":true,"rules":[{"when":{"property":"input","operation":"Eq","value":{"ref":"choice"}},"then":[{"kind":"show"}]}]}
    ]), Some(json!({"choice":"BA"}))).unwrap();
    assert!(f.state().fields["left"].hidden);
    assert!(f.state().fields["right"].hidden);
    let effect = f.engine_mut().source_effects().remove(0);
    resolve(
        &mut f,
        &effect,
        json!([{"value":"BA","label":"Bratislava"}]),
    );
    assert_eq!(
        f.state().fields["choice"].value,
        ScalarValue::String("BA".into())
    );
    assert!(!f.state().fields["left"].hidden);
    assert!(!f.state().fields["right"].hidden);
    f.engine_mut()
        .source_command(SourceCommand::Retry { id: effect.id })
        .unwrap();
    let retry = f.engine_mut().source_effects().remove(0);
    resolve(&mut f, &retry, json!([{"value":"BA","label":"New label"}]));
    assert_eq!(
        f.state().fields["choice"].value,
        ScalarValue::String("BA".into())
    );
}

#[test]
fn failed_or_malformed_options_preserve_selection_but_empty_success_clears_it() {
    for multiple in [false, true] {
        let initial = if multiple { json!(["BA"]) } else { json!("BA") };
        let mut f = form(json!([{"type":"select","key":"choice","multiple":multiple,"current_value":initial,"validators":[{"kind":"required"}],"bindings":{"options":{"source":"choices"}}}]), None).unwrap();
        let effect = f.engine_mut().source_effects().remove(0);
        resolve(
            &mut f,
            &effect,
            json!([{"value":"BA","label":"Bratislava"}]),
        );
        f.engine_mut()
            .source_command(SourceCommand::Retry {
                id: effect.id.clone(),
            })
            .unwrap();
        let retry = f.engine_mut().source_effects().remove(0);
        resolve(&mut f, &retry, json!([{"value":"bad"}]));
        assert_eq!(
            serde_json::to_value(&f.state().fields["choice"].value).unwrap(),
            initial
        );
        assert_eq!(
            f.state().fields["choice"].options.as_ref().unwrap()[0]
                .value
                .as_str()
                .unwrap(),
            "BA"
        );
        assert!(!f.valid());
        f.engine_mut()
            .source_command(SourceCommand::Retry { id: effect.id })
            .unwrap();
        let retry = f.engine_mut().source_effects().remove(0);
        resolve(&mut f, &retry, json!([]));
        let cleared = if multiple {
            ScalarValue::Strings(vec![])
        } else {
            ScalarValue::Null
        };
        assert_eq!(f.state().fields["choice"].value, cleared);
        assert_eq!(
            serde_json::to_value(&f.state().fields["choice"].errors).unwrap(),
            serde_json::json!([{"messageKey": "tg_validation_required"}])
        );
    }
}

#[test]
fn value_and_options_arrival_order_never_runs_rules_against_unconfirmed_selection() {
    for options_first in [false, true] {
        for selected in ["BA", "UNKNOWN"] {
            let mut f = form(json!([
                {"type":"select","key":"choice","bindings":{"value":{"source":"names"},"options":{"source":"choices"}}},
                {"type":"text","key":"status","rules":[
                    {"when":{"property":"choice","operation":"Eq","value":"BA"},"then":[{"kind":"set_value","value":"Ready"}]},
                    {"when":{"property":"choice","operation":"Eq","value":null},"then":[{"kind":"set_value","value":"Empty"}]}
                ]}
            ]), None).unwrap();
            let effects = f.engine_mut().source_effects();
            let options = effects.iter().find(|e| e.source == "choices").unwrap();
            let value = effects.iter().find(|e| e.source == "names").unwrap();
            let option_data = json!([{"value":"BA","label":"Bratislava"}]);
            if options_first {
                resolve(&mut f, options, option_data.clone());
            } else {
                resolve(&mut f, value, json!(selected));
            }
            assert_eq!(f.state().fields["status"].value, ScalarValue::Null);
            if options_first {
                resolve(&mut f, value, json!(selected));
            } else {
                resolve(&mut f, options, option_data);
            }
            let expected = if selected == "BA" { "Ready" } else { "Empty" };
            assert_eq!(
                f.state().fields["status"].value,
                ScalarValue::String(expected.into())
            );
            assert!(f.valid());
        }
    }
}

#[test]
fn option_clearing_and_triggered_rules_roll_back_together_on_evaluation_failure() {
    let mut f = form(json!([
        {"type":"select","key":"choice","current_value":"BA","bindings":{"options":{"source":"choices"}}},
        {"type":"text","key":"target","rules":[{"when":{"property":"choice","operation":"Eq","value":null},"then":[{"kind":"set_value","value":"changed"}]}]}
    ]), None).unwrap();
    let first = f.engine_mut().source_effects().remove(0);
    resolve(&mut f, &first, json!([{"value":"BA","label":"Bratislava"}]));
    f.engine_mut()
        .source_command(SourceCommand::Retry { id: first.id })
        .unwrap();
    let next = f.engine_mut().source_effects().remove(0);
    let before = serde_json::to_value(f.state()).unwrap();
    f.set_processing_limit(1);
    assert!(f
        .engine_mut()
        .source_command(SourceCommand::Resolve {
            id: next.id.clone(),
            revision: next.revision.clone(),
            data: json!([])
        })
        .is_err());
    assert_eq!(serde_json::to_value(f.state()).unwrap(), before);
    f.set_processing_limit(100);
    resolve(&mut f, &next, json!([]));
    assert_eq!(f.state().fields["choice"].value, ScalarValue::Null);
    assert_eq!(
        f.state().fields["target"].value,
        ScalarValue::String("changed".into())
    );
}

#[test]
fn implicit_option_value_changes_are_included_in_cycle_detection() {
    assert!(form(json!([
        {"type":"select","key":"choice","bindings":{"options":{"source":"choices","params":{"choice":{"ref":"choice"}}}}}
    ]), None).is_err());
    assert!(form(json!([
        {"type":"text","key":"country","rules":[{"when":{"property":"region","operation":"Eq","value":null},"then":[{"kind":"set_value","value":"SK"}]}]},
        {"type":"select","key":"region","bindings":{"options":{"source":"choices","params":{"country":{"ref":"country"}}}}}
    ]), None).is_err());
}

#[test]
fn select_first_option_is_opt_in_and_supports_single_and_multiple_values() {
    for multiple in [false, true] {
        for enabled in [false, true] {
            let mut f = form(json!([{"type":"select","key":"choice","multiple":multiple,"selectFirstOption":enabled,"bindings":{"options":{"source":"choices"}}}]), None).unwrap();
            let effect = f.engine_mut().source_effects().remove(0);
            resolve(
                &mut f,
                &effect,
                json!([{"value":"second-code","label":"First by response order"},{"value":"first-code","label":"Second by response order"}]),
            );
            let expected = match (multiple, enabled) {
                (true, true) => json!(["second-code"]),
                (true, false) => json!([]),
                (false, true) => json!("second-code"),
                (false, false) => Value::Null,
            };
            assert_eq!(
                serde_json::to_value(&f.state().fields["choice"].value).unwrap(),
                expected
            );
        }
    }
    for setting in [json!("true"), json!(1), Value::Null, json!({})] {
        assert!(form(
            json!([{"type":"select","key":"choice","selectFirstOption":setting}]),
            None
        )
        .is_err());
    }
}

#[test]
fn select_first_option_preserves_drafts_and_falls_back_after_options_change() {
    for multiple in [false, true] {
        let saved = if multiple {
            json!(["KE", "BA"])
        } else {
            json!("KE")
        };
        let fields = json!([
            {"type":"text","key":"country","current_value":"SK"},
            {"type":"select","key":"choice","multiple":multiple,"selectFirstOption":true,"bindings":{"options":{"source":"choices","params":{"country":{"ref":"country"}}}}}
        ]);
        let mut f = form(fields.clone(), Some(json!({"country":"SK","choice":saved}))).unwrap();
        let first = f.engine_mut().source_effects().remove(0);
        assert_eq!(
            serde_json::to_value(&f.state().fields["choice"].value).unwrap(),
            saved
        );
        resolve(
            &mut f,
            &first,
            json!([{"value":"BA","label":"Bratislava"},{"value":"KE","label":"Košice"}]),
        );
        assert_eq!(
            serde_json::to_value(&f.state().fields["choice"].value).unwrap(),
            saved
        );
        f.process_patch(Patch::SetValue {
            key: "country".into(),
            value: ScalarValue::String("CZ".into()),
        })
        .unwrap();
        let next = f.engine_mut().source_effects().remove(0);
        resolve(
            &mut f,
            &next,
            json!([{"value":"BR","label":"Brno"},{"value":"PR","label":"Prague"}]),
        );
        let fallback = if multiple { json!(["BR"]) } else { json!("BR") };
        assert_eq!(
            serde_json::to_value(&f.state().fields["choice"].value).unwrap(),
            fallback
        );
        assert!(!resolve(
            &mut f,
            &first,
            json!([{"value":"KE","label":"Stale"}])
        ));
        let values = serde_json::to_value(f.values()).unwrap();
        let mut reopened = form(fields, Some(values)).unwrap();
        let fresh = reopened.engine_mut().source_effects().remove(0);
        resolve(
            &mut reopened,
            &fresh,
            json!([{"value":"PR","label":"Prague"},{"value":"BR","label":"Brno renamed"}]),
        );
        assert_eq!(
            serde_json::to_value(&reopened.state().fields["choice"].value).unwrap(),
            fallback
        );
    }
}

#[test]
fn select_first_option_waits_for_valid_data_handles_empty_and_runs_rules_and_sources() {
    let mut f = form(json!([
        {"type":"select","key":"choice","selectFirstOption":true,"validators":[{"kind":"required"}],"bindings":{"options":{"source":"choices"}}},
        {"type":"text","key":"status","rules":[{"when":{"property":"choice","operation":"Eq","value":"BA"},"then":[{"kind":"set_value","value":"Auto selected"}]}]},
        {"type":"text","key":"dependent","bindings":{"value":{"source":"names","apply":"live","params":{"choice":{"ref":"choice"}}}}}
    ]), None).unwrap();
    let requests = f.engine_mut().source_effects();
    let first = requests.iter().find(|e| e.source == "choices").unwrap();
    assert_eq!(f.state().fields["choice"].value, ScalarValue::Null);
    resolve(&mut f, first, json!([{"value":"BA"}]));
    assert_eq!(f.state().fields["choice"].value, ScalarValue::Null);
    assert!(!f.state().fields["choice"].source_errors.is_empty());
    f.engine_mut()
        .source_command(SourceCommand::Retry {
            id: first.id.clone(),
        })
        .unwrap();
    let retry = f.engine_mut().source_effects().remove(0);
    resolve(&mut f, &retry, json!([]));
    assert_eq!(f.state().fields["choice"].value, ScalarValue::Null);
    assert_eq!(
        serde_json::to_value(&f.state().fields["choice"].errors).unwrap(),
        serde_json::json!([{"messageKey": "tg_validation_required"}])
    );
    f.engine_mut()
        .source_command(SourceCommand::Retry {
            id: first.id.clone(),
        })
        .unwrap();
    let retry = f.engine_mut().source_effects().remove(0);
    resolve(&mut f, &retry, json!([{"value":"BA","label":"Bratislava"}]));
    assert_eq!(
        f.state().fields["choice"].value,
        ScalarValue::String("BA".into())
    );
    assert_eq!(
        f.state().fields["status"].value,
        ScalarValue::String("Auto selected".into())
    );
    let dependent = f.engine_mut().source_effects().remove(0);
    assert_eq!(dependent.params["choice"], ScalarValue::String("BA".into()));
}

#[test]
fn boolean_radio_sources_preserve_false_drafts_reject_strings_and_clear_removed_options() {
    let mut f = form(json!([
        {"type":"text","key":"scope","current_value":"one"},
        {"type":"boolean","key":"answer","variant":"radio","validators":[{"kind":"required"}],"bindings":{"options":{"source":"choices","params":{"scope":{"ref":"scope"}}}}},
        {"type":"text","key":"observer","rules":[{"when":{"property":"answer","operation":"Eq","value":false},"then":[{"kind":"set_value","value":"No"}]}]}
    ]), Some(json!({"answer":false}))).unwrap();
    let first = f.engine_mut().source_effects().remove(0);
    assert_eq!(f.state().fields["answer"].value, ScalarValue::Bool(false));
    resolve(&mut f, &first, json!([{"value":"false","label":"Wrong"}]));
    assert_eq!(f.state().fields["answer"].value, ScalarValue::Bool(false));
    assert!(!f.valid());
    f.engine_mut()
        .source_command(SourceCommand::Retry {
            id: first.id.clone(),
        })
        .unwrap();
    let second = f.engine_mut().source_effects().remove(0);
    assert!(!resolve(&mut f, &first, json!([])));
    resolve(
        &mut f,
        &second,
        json!([{"value":false,"label":"No"},{"value":true,"label":"Yes"}]),
    );
    assert!(f.valid());
    assert_eq!(
        f.state().fields["observer"].value,
        ScalarValue::String("No".into())
    );
    f.process_patch(Patch::SetValue {
        key: "scope".into(),
        value: ScalarValue::String("two".into()),
    })
    .unwrap();
    let third = f.engine_mut().source_effects().remove(0);
    resolve(&mut f, &third, json!([{"value":true,"label":"Yes"}]));
    assert_eq!(f.state().fields["answer"].value, ScalarValue::Null);
    assert!(!f.valid());
}

#[test]
fn boolean_radio_waits_for_both_value_and_options_before_reconciling_and_running_rules() {
    for options_first in [false, true] {
        let mut f = form(json!([
            {"type":"boolean","variant":"radio","key":"answer","bindings":{"value":{"source":"names"},"options":{"source":"choices"}}},
            {"type":"text","key":"observer","rules":[{"when":{"property":"answer","operation":"Eq","value":false},"then":[{"kind":"set_value","value":"No"}]}]}
        ]), None).unwrap();
        let effects = f.engine_mut().source_effects();
        let value = effects.iter().find(|e| e.source == "names").unwrap();
        let options = effects.iter().find(|e| e.source == "choices").unwrap();
        if options_first {
            resolve(&mut f, options, json!([{"value":false,"label":"No"}]));
        } else {
            resolve(&mut f, value, json!(false));
        }
        assert_eq!(f.state().fields["observer"].value, ScalarValue::Null);
        if options_first {
            resolve(&mut f, value, json!(false));
        } else {
            resolve(&mut f, options, json!([{"value":false,"label":"No"}]));
        }
        assert!(f.valid());
        assert_eq!(f.state().fields["answer"].value, ScalarValue::Bool(false));
        assert_eq!(
            f.state().fields["observer"].value,
            ScalarValue::String("No".into())
        );
    }
}

#[test]
fn schema_defaults_never_suppress_initial_sources_but_explicit_drafts_do() {
    for (fields, path, draft) in [
        (
            json!([{"type":"text","key":"name","current_value":"Schema","bindings":{"value":{"source":"names"}}}]),
            "name",
            json!({"name":"Draft"}),
        ),
        (
            json!([{"type":"repeater","key":"people","current_value":[{"name":"Schema"}],"render":{"type":"tabs","settings":{}},"template":[{"type":"text","key":"people.name","bindings":{"value":{"source":"names"}}}]}]),
            "people[0].name",
            json!({"people":[{"name":"Draft"}]}),
        ),
        (
            json!([{"type":"repeater","key":"people","current_value":[{}],"render":{"type":"tabs","settings":{}},"template":[{"type":"text","key":"people.name","current_value":"Schema","bindings":{"value":{"source":"names"}}}]}]),
            "people[0].name",
            json!({"people":[{"name":"Draft"}]}),
        ),
        (
            json!([{"type":"repeater","key":"people","current_value":[{"children":[{"name":"Schema"}]}],"render":{"type":"tabs","settings":{}},"template":[{"type":"repeater","key":"people.children","render":{"type":"tabs","settings":{}},"template":[{"type":"text","key":"people.children.name","bindings":{"value":{"source":"names"}}}]}]}]),
            "people[0].children[0].name",
            json!({"people":[{"children":[{"name":"Draft"}]}]}),
        ),
    ] {
        let mut defaults = form(fields.clone(), None).unwrap();
        assert_eq!(
            defaults.state().fields[path].value,
            ScalarValue::String("Schema".into())
        );
        let effects = defaults.engine_mut().source_effects();
        assert_eq!(effects.len(), 1, "{path}");
        resolve(&mut defaults, &effects[0], json!("Loaded"));
        assert_eq!(
            defaults.state().fields[path].value,
            ScalarValue::String("Loaded".into())
        );
        let mut seeded = form(fields, Some(draft)).unwrap();
        assert!(seeded.engine_mut().source_effects().is_empty(), "{}", path);
        assert_eq!(
            seeded.state().fields[path].value,
            ScalarValue::String("Draft".into())
        );
    }
}
