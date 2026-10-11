use crate::engine::patch::Patch;
use crate::types::ScalarValue;

use super::helpers::{engine_from_json, field_state, NOOP_SCHEMA};

#[test]
fn setting_the_same_value_is_a_noop() {
    let mut engine = engine_from_json(NOOP_SCHEMA);

    let first = engine
        .process_patch(Patch::SetValue {
            key: "name".to_string(),
            value: ScalarValue::String("Daniel".to_string()),
        })
        .expect("valid text patch should process");

    assert_eq!(
        first.len(),
        1,
        "the first value assignment should be processed"
    );

    let second = engine
        .process_patch(Patch::SetValue {
            key: "name".to_string(),
            value: ScalarValue::String("Daniel".to_string()),
        })
        .expect("valid text patch should process");

    assert!(
        second.is_empty(),
        "setting an identical value should not be reported as a change"
    );

    assert_eq!(
        field_state(&engine, "name").value,
        ScalarValue::String("Daniel".to_string())
    );
}

#[test]
fn setting_the_same_hidden_state_is_a_noop() {
    let mut engine = engine_from_json(NOOP_SCHEMA);

    assert!(
        field_state(&engine, "details").hidden,
        "test setup failed: details should initially be hidden"
    );

    let processed = engine
        .process_patch(Patch::SetHidden {
            key: "details".to_string(),
            hidden: true,
        })
        .expect("hidden patch should process");

    assert!(
        processed.is_empty(),
        "setting an identical hidden state should not be reported as a change"
    );

    assert!(field_state(&engine, "details").hidden);
}

#[test]
fn setting_the_same_errors_is_a_noop() {
    let mut engine = engine_from_json(NOOP_SCHEMA);

    assert!(
        field_state(&engine, "status").errors.is_empty(),
        "test setup failed: status should initially have no errors"
    );

    let processed = engine
        .process_patch(Patch::SetErrors {
            key: "status".to_string(),
            errors: Vec::new(),
        })
        .expect("behavior error patch should process");

    assert!(
        processed.is_empty(),
        "setting an identical error list should not be reported as a change"
    );

    assert!(field_state(&engine, "status").errors.is_empty());
}

#[test]
fn clearing_an_already_null_value_is_a_noop() {
    let mut engine = engine_from_json(NOOP_SCHEMA);

    assert_eq!(
        field_state(&engine, "status").value,
        ScalarValue::Null,
        "test setup failed: status should initially be null"
    );

    let processed = engine
        .process_patch(Patch::ClearValue {
            key: "status".to_string(),
        })
        .expect("clear patch should process");

    assert!(
        processed.is_empty(),
        "clearing an already-null value should not be reported as a change"
    );

    assert_eq!(field_state(&engine, "status").value, ScalarValue::Null);
}
