use crate::engine::patch::Patch;
use crate::engine::processor::ProcessError;
use crate::fields::FieldValueError;
use crate::types::ScalarValue;

use super::helpers::{engine_from_json, field_state, VISIBILITY_SCHEMA};

#[test]
fn creates_initial_runtime_state() {
    let engine = engine_from_json(VISIBILITY_SCHEMA);

    let age = field_state(&engine, "age");
    let email = field_state(&engine, "email");

    assert_eq!(engine.state().fields.len(), 2);

    assert_eq!(age.value, ScalarValue::Null);
    assert!(!age.hidden);
    assert!(age.errors.is_empty());

    assert_eq!(email.value, ScalarValue::Null);
    assert!(email.hidden);
    assert!(email.errors.is_empty());
}

#[test]
fn applies_direct_set_value_patch() {
    let mut engine = engine_from_json(VISIBILITY_SCHEMA);

    let processed = engine
        .process_patch(Patch::SetValue {
            key: "age".to_string(),
            value: ScalarValue::Number(16.0),
        })
        .expect("valid number patch should process");

    assert_eq!(field_state(&engine, "age").value, ScalarValue::Number(16.0));

    assert_eq!(
        processed.first(),
        Some(&Patch::SetValue {
            key: "age".to_string(),
            value: ScalarValue::Number(16.0),
        })
    );
}

#[test]
fn initializes_declared_values_hidden_state_and_behavior_errors() {
    let engine = engine_from_json(
        r#"[
            {
                "key":"name",
                "type":"text",
                "current_value":"Ada",
                "hidden":true,
                "errors":["Declared schema error"]
            },
            {
                "key":"email",
                "type":"text","variant":"email",
                "current_value":"  ada@example.com  "
            }
        ]"#,
    );

    let name = field_state(&engine, "name");
    assert_eq!(name.value, ScalarValue::String("Ada".to_string()));
    assert!(name.hidden);
    assert_eq!(
        serde_json::to_value(&name.errors).unwrap(),
        serde_json::json!(["Declared schema error"])
    );
    assert_eq!(name.behavior_errors(), &["Declared schema error"]);
    assert!(name.validation_errors().is_empty());

    assert_eq!(
        field_state(&engine, "email").value,
        ScalarValue::String("ada@example.com".to_string()),
        "initial values should use field-owned normalization"
    );
}

#[test]
fn rejects_wrong_runtime_value_types_without_mutating_state() {
    let mut engine = engine_from_json(r#"[{"key":"age","type":"number"}]"#);

    let error = engine
        .process_patch(Patch::SetValue {
            key: "age".to_string(),
            value: ScalarValue::String("18".to_string()),
        })
        .expect_err("string-to-number coercion must not be silent");

    assert_eq!(
        error,
        ProcessError::InvalidValue {
            field_key: "age".to_string(),
            source: FieldValueError::InvalidType {
                expected: "tg_schema_number_or_null".to_string(),
                received: "string".to_string(),
            },
        }
    );
    assert_eq!(field_state(&engine, "age").value, ScalarValue::Null);
}

#[test]
fn validation_errors_do_not_overwrite_rule_generated_errors() {
    let mut engine = engine_from_json(
        r#"[
            {"key":"source","type":"number"},
            {
                "key":"target",
                "type":"text",
                "current_value":"ready",
                "validators":[{"kind":"required"}],
                "rules":[{
                    "when":{"property":"source","operation":"Eq","value":1},
                    "then":[
                        {"kind":"set_value","value":""},
                        {"kind":"set_errors","errors":["Rule-generated error"]}
                    ]
                }]
            }
        ]"#,
    );

    engine
        .process_patch(Patch::SetValue {
            key: "source".to_string(),
            value: ScalarValue::Number(1.0),
        })
        .expect("valid source patch should stabilize");

    let target = field_state(&engine, "target");
    assert_eq!(target.behavior_errors(), &["Rule-generated error"]);
    assert_eq!(target.validation_errors().len(), 1);
    assert_eq!(target.validation_errors()[0].code, "required");
    assert_eq!(
        serde_json::to_value(&target.errors).unwrap(),
        serde_json::json!(["Rule-generated error", {"messageKey": "tg_validation_required"}])
    );
}
