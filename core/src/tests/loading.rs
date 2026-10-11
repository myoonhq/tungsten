use serde_json::{json, Value};

use super::helpers::{engine_from_json, field_state};
use crate::engine::{patch::Patch, processor::ProcessError, runtime::FormValues};
use crate::ScalarValue;

fn values(value: Value) -> FormValues {
    serde_json::from_value(value).unwrap()
}

#[test]
fn supplied_values_override_defaults_without_losing_null_or_falsy_values() {
    let mut engine = engine_from_json(
        r#"[
        {"type":"text","key":"name","current_value":"Default"},
        {"type":"text","key":"empty","current_value":"Default"},
        {"type":"number","key":"count","current_value":10},
        {"type":"boolean","key":"enabled","current_value":true},
        {"type":"text","variant":"email","key":"email","current_value":"default@example.com"},
        {"type":"text","key":"fallback","current_value":"Schema value"},
        {"type":"text","key":"omitted"}
    ]"#,
    );
    assert!(engine
        .load_values(Some(&values(json!({
            "name":null,"empty":"","count":0,"enabled":false,"email":" ada@example.com "
        }))))
        .unwrap());
    assert_eq!(field_state(&engine, "name").value, ScalarValue::Null);
    assert_eq!(
        field_state(&engine, "empty").value,
        ScalarValue::String("".into())
    );
    assert_eq!(
        field_state(&engine, "count").value,
        ScalarValue::Number(0.0)
    );
    assert_eq!(
        field_state(&engine, "enabled").value,
        ScalarValue::Bool(false)
    );
    assert_eq!(
        field_state(&engine, "email").value,
        ScalarValue::String("ada@example.com".into())
    );
    assert_eq!(
        field_state(&engine, "fallback").value,
        ScalarValue::String("Schema value".into())
    );
    assert_eq!(field_state(&engine, "omitted").value, ScalarValue::Null);
}

#[test]
fn loading_defaults_evaluates_rules_even_when_no_value_changed() {
    let mut engine = engine_from_json(
        r#"[
        {"type":"text","key":"notice","hidden":true,"rules":[
            {"when":{"property":"age","operation":"GEqt","value":18},"then":[{"kind":"show"}]}
        ]},
        {"type":"number","key":"age","current_value":18}
    ]"#,
    );
    assert!(engine.load_values(None).unwrap());
    assert!(!field_state(&engine, "notice").hidden);
}

#[test]
fn evaluates_only_after_all_values_exist_and_all_value_predecessors_stabilize() {
    let mut engine = engine_from_json(
        r#"[
        {"type":"text","key":"observer","rules":[
            {"when":{"property":"right","operation":"Eq","value":"old"},"then":[{"kind":"set_errors","errors":["Transient"]}]}
        ]},
        {"type":"text","key":"output","rules":[
            {"when":{"property":"left","operation":"Eq","value":{"ref":"right"}},"then":[{"kind":"set_value","value":"equal"}]}
        ]},
        {"type":"text","key":"right","current_value":"old","rules":[
            {"when":{"property":"source","operation":"Eq","value":"go"},"then":[{"kind":"set_value","value":"ready"}]}
        ]},
        {"type":"text","key":"left","current_value":"old","rules":[
            {"when":{"property":"source","operation":"Eq","value":"go"},"then":[{"kind":"set_value","value":"ready"}]}
        ]},
        {"type":"text","key":"source"}
    ]"#,
    );
    assert!(engine
        .load_values(Some(&values(json!({"source":"go", "left":"different"}))))
        .unwrap());
    assert_eq!(
        field_state(&engine, "output").value,
        ScalarValue::String("equal".into())
    );
    assert!(field_state(&engine, "observer").errors.is_empty());
}

#[test]
fn does_not_run_value_rules_on_transient_inputs_from_other_predecessors() {
    let mut engine = engine_from_json(
        r#"[
        {"type":"text","key":"output","rules":[
            {"when":{"property":"left","operation":"Eq","value":{"ref":"right"}},"then":[{"kind":"set_value","value":"transient"}]}
        ]},
        {"type":"text","key":"left","rules":[
            {"when":{"property":"source","operation":"Eq","value":"go"},"then":[{"kind":"set_value","value":"temporary"}]}
        ]},
        {"type":"text","key":"right","current_value":"temporary","rules":[
            {"when":{"property":"source","operation":"Eq","value":"go"},"then":[{"kind":"set_value","value":"final"}]}
        ]},
        {"type":"text","key":"source","current_value":"go"}
    ]"#,
    );
    assert!(engine.load_values(None).unwrap());
    assert_eq!(field_state(&engine, "output").value, ScalarValue::Null);
}

#[test]
fn repeated_load_resets_derived_state_and_missing_values_to_defaults() {
    let mut engine = engine_from_json(
        r#"[
        {"type":"boolean","key":"enabled","current_value":false},
        {"type":"text","key":"name","current_value":"Default","rules":[
            {"when":{"property":"enabled","operation":"Eq","value":true},"then":[
                {"kind":"set_hidden","hidden":true},{"kind":"set_errors","errors":["Disabled"]}
            ]}
        ]}
    ]"#,
    );
    assert!(engine
        .load_values(Some(&values(json!({"enabled":true, "name":"Existing"}))))
        .unwrap());
    assert!(field_state(&engine, "name").hidden);
    assert!(engine.load_values(None).unwrap());
    assert!(!field_state(&engine, "name").hidden);
    assert!(field_state(&engine, "name").errors.is_empty());
    assert_eq!(
        field_state(&engine, "name").value,
        ScalarValue::String("Default".into())
    );
}

#[test]
fn full_load_validates_visible_grouped_fields_and_retains_hidden_invalid_data() {
    let mut engine = engine_from_json(
        r#"{"schemaVersion":"sprout","form":[
        {"type":"group","key":"person","variant":"basic","render":{"type":"group","settings":{}},"subform":[
            {"type":"text","variant":"email","key":"person.email","validators":[{"kind":"required"}]},
            {"type":"text","key":"person.hidden","hidden":true,"validators":[{"kind":"required"}]}
        ]}
    ]}"#,
    );
    assert!(!engine
        .load_values(Some(&values(json!({"person.email":"not-an-email"}))))
        .unwrap());
    assert_eq!(
        field_state(&engine, "person.email").value,
        ScalarValue::String("not-an-email".into())
    );
    assert_eq!(
        serde_json::to_value(&field_state(&engine, "person.email").errors).unwrap(),
        serde_json::json!([{"messageKey": "tg_validation_email"}])
    );
    assert_eq!(
        serde_json::to_value(&field_state(&engine, "person.hidden").errors).unwrap(),
        serde_json::json!([])
    );
    assert!(!engine.state().fields.contains_key("person"));
}

#[test]
fn bad_keys_and_wrong_value_types_preserve_the_entire_previous_state() {
    let mut engine = engine_from_json(
        r#"[
        {"type":"text","key":"a"},{"type":"number","key":"z"}
    ]"#,
    );
    engine
        .process_patch(Patch::SetValue {
            key: "a".into(),
            value: ScalarValue::String("Saved".into()),
        })
        .unwrap();
    let before = serde_json::to_value(engine.state()).unwrap();
    for data in [
        json!({"a":"Changed", "unknown":1}),
        json!({"a":"Changed", "z":"wrong type"}),
    ] {
        assert!(engine.load_values(Some(&values(data))).is_err());
        assert_eq!(serde_json::to_value(engine.state()).unwrap(), before);
    }
}

#[test]
fn failed_evaluation_rolls_back_values_visibility_and_errors_and_preserves_limit() {
    let mut engine = engine_from_json(
        r#"[
        {"type":"text","key":"source","current_value":"go"},
        {"type":"text","key":"target","rules":[
            {"when":{"property":"source","operation":"Eq","value":"go"},"then":[{"kind":"set_value","value":"derived"}]}
        ]}
    ]"#,
    );
    let before = serde_json::to_value(engine.state()).unwrap();
    engine.set_processing_limit(1);
    assert!(matches!(
        engine.load_values(None),
        Err(ProcessError::ProcessingLimitExceeded { limit: 1 })
    ));
    assert_eq!(serde_json::to_value(engine.state()).unwrap(), before);
    assert_eq!(engine.processing_limit(), 1);
    engine.set_processing_limit(100);
    assert!(engine.load_values(None).unwrap());
}

#[test]
fn empty_form_loads_without_inventing_state() {
    let mut engine = engine_from_json("[]");
    assert!(engine.load_values(None).unwrap());
    assert!(engine.state().fields.is_empty());
}
