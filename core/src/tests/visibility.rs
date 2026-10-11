use crate::engine::patch::Patch;
use crate::types::ScalarValue;

use super::helpers::{engine_from_json, field_state, VISIBILITY_SCHEMA};

#[test]
fn shows_email_when_age_becomes_18() {
    let mut engine = engine_from_json(VISIBILITY_SCHEMA);

    engine
        .process_patch(Patch::SetValue {
            key: "age".to_string(),
            value: ScalarValue::Number(18.0),
        })
        .expect("valid age patch should process");

    assert!(
        !field_state(&engine, "email").hidden,
        "email should be visible when age is at least 18"
    );
}

#[test]
fn hides_email_when_age_becomes_less_than_18() {
    let mut engine = engine_from_json(VISIBILITY_SCHEMA);

    engine
        .process_patch(Patch::SetValue {
            key: "age".to_string(),
            value: ScalarValue::Number(18.0),
        })
        .expect("valid age patch should process");

    assert!(
        !field_state(&engine, "email").hidden,
        "test setup failed: email should first become visible"
    );

    engine
        .process_patch(Patch::SetValue {
            key: "age".to_string(),
            value: ScalarValue::Number(17.0),
        })
        .expect("valid age patch should process");

    assert!(
        field_state(&engine, "email").hidden,
        "email should become hidden when age drops below 18"
    );
}
