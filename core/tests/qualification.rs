//! Required owner contracts. These are active gates, including known review
//! findings; failing tests must not be ignored or blessed as current behavior.
use serde_json::json;
use tungsten_core::{
    compiler::SchemaCompiler,
    engine::{patch::Patch, processor::ProcessError, Engine},
    schema::RawSchema,
    ScalarValue,
};
fn engine(fields: serde_json::Value) -> Engine {
    let schema: RawSchema =
        serde_json::from_value(json!({"schemaVersion":"sprout","form":fields})).unwrap();
    Engine::from_compiled(SchemaCompiler::new().compile(schema).unwrap())
}
#[test]
fn f001_hidden_required_values_are_retained_without_blocking_validation() {
    let mut core = engine(json!([
        {"type":"text","key":"retained","current_value":"","hidden":true,"validators":[{"kind":"required"}]},
        {"type":"text","key":"visible","current_value":"ready","validators":[{"kind":"required"}]}
    ]));
    assert!(
        core.load_values(None).unwrap(),
        "F-001: hidden required field must not block"
    );
    assert_eq!(
        core.field_state("retained").unwrap().value,
        ScalarValue::String("".into())
    );
    assert!(core.validate_all());
    core.process_patch(Patch::SetHidden {
        key: "retained".into(),
        hidden: false,
    })
    .unwrap();
    assert!(
        !core.validate_all(),
        "showing the field must restore its validation"
    );
}
#[test]
fn f002_processing_failure_rolls_back_direct_and_derived_mutations() {
    let mut core = engine(json!([
        {"type":"text","key":"source","current_value":"before"},
        {"type":"text","key":"target","current_value":"before","rules":[{"when":{"property":"source","operation":"Eq","value":"go"},"then":[{"kind":"set_value","value":"derived"},{"kind":"set_hidden","hidden":true}]}]}
    ]));
    core.load_values(None).unwrap();
    let before = serde_json::to_value(core.state()).unwrap();
    core.set_processing_limit(2);
    assert!(matches!(
        core.process_patch(Patch::SetValue {
            key: "source".into(),
            value: ScalarValue::String("go".into())
        }),
        Err(ProcessError::ProcessingLimitExceeded { limit: 2 })
    ));
    assert_eq!(
        serde_json::to_value(core.state()).unwrap(),
        before,
        "F-002: failed operation must be atomic"
    );
    core.set_processing_limit(100);
    core.process_patch(Patch::SetValue {
        key: "source".into(),
        value: ScalarValue::String("go".into()),
    })
    .unwrap();
    assert_eq!(
        core.field_state("target").unwrap().value,
        ScalarValue::String("derived".into())
    );
}

#[test]
fn disabled_skips_validation_but_readonly_and_false_required_validate() {
    let mut core = engine(json!([
        {"type":"text","key":"disabled","disabled":true,"validators":[{"kind":"required"}]},
        {"type":"text","key":"readonly","readOnly":true,"validators":[{"kind":"required"}]},
        {"type":"boolean","key":"choice","current_value":false,"validators":[{"kind":"required"}]}
    ]));
    assert!(!core.load_values(None).unwrap());
    assert!(core.field_state("disabled").unwrap().errors.is_empty());
    assert_eq!(core.field_state("readonly").unwrap().errors.len(), 1);
    assert!(core.field_state("choice").unwrap().errors.is_empty());
    core.process_patch(Patch::SetValue {
        key: "readonly".into(),
        value: ScalarValue::String("calculated".into()),
    })
    .unwrap();
    assert!(core.validate_all());
}

#[test]
fn multiple_actual_value_writes_warn_once_per_field_and_cycle() {
    let mut core = engine(json!([
        {"type":"text","key":"source"},
        {"type":"text","key":"target","current_value":"A","rules":[{"when":{"property":"source","operation":"Eq","value":"go"},"then":[{"kind":"set_value","value":"B"},{"kind":"set_value","value":"A"},{"kind":"set_value","value":"C"}]}]}
    ]));
    core.load_values(None).unwrap();
    assert!(core.take_warnings().is_empty());
    core.process_patch(Patch::SetValue {
        key: "source".into(),
        value: ScalarValue::String("go".into()),
    })
    .unwrap();
    let warnings = serde_json::to_value(core.take_warnings()).unwrap();
    assert_eq!(
        warnings,
        json!([{"messageKey":"tg_warning_multiple_value_writes","params":{"fieldKey":"target"}}])
    );
    assert_eq!(
        core.field_state("target").unwrap().value,
        ScalarValue::String("C".into())
    );
    assert!(
        core.take_warnings().is_empty(),
        "warnings are drained exactly once"
    );
    core.process_patch(Patch::SetValue {
        key: "source".into(),
        value: ScalarValue::String("go".into()),
    })
    .unwrap();
    assert!(core.take_warnings().is_empty(), "no-op writes do not warn");
}

#[test]
fn failing_cycle_discards_uncommitted_warnings_and_can_recover() {
    let mut core = engine(json!([
        {"type":"text","key":"source"},
        {"type":"text","key":"target","rules":[{"when":{"property":"source","operation":"Eq","value":"go"},"then":[{"kind":"set_value","value":"B"},{"kind":"set_value","value":"C"},{"kind":"set_value","value":"D"}]}]}
    ]));
    core.load_values(None).unwrap();
    let before = serde_json::to_value(core.state()).unwrap();
    core.set_processing_limit(3);
    assert!(core
        .process_patch(Patch::SetValue {
            key: "source".into(),
            value: ScalarValue::String("go".into())
        })
        .is_err());
    assert_eq!(serde_json::to_value(core.state()).unwrap(), before);
    assert!(core.take_warnings().is_empty());
    core.set_processing_limit(1000);
    core.process_patch(Patch::SetValue {
        key: "source".into(),
        value: ScalarValue::String("go".into()),
    })
    .unwrap();
    assert_eq!(core.take_warnings().len(), 1);
}

#[test]
fn ordinary_validation_failure_commits_data_without_core_error() {
    let mut core = engine(json!([{"type":"text","key":"email","variant":"email"}]));
    core.load_values(None).unwrap();
    core.process_patch(Patch::SetValue {
        key: "email".into(),
        value: ScalarValue::String("invalid".into()),
    })
    .unwrap();
    assert_eq!(
        core.field_state("email").unwrap().value,
        ScalarValue::String("invalid".into())
    );
    assert!(!core.validate_all());
    assert!(core.take_warnings().is_empty());
}
