use crate::engine::patch::Patch;
use crate::types::ScalarValue;

use super::helpers::{engine_from_json, field_state, DEPENDENCIES_SCHEMA};

#[test]
fn propagates_value_change_through_dependency_chain() {
    let mut engine = engine_from_json(DEPENDENCIES_SCHEMA);

    engine
        .process_patch(Patch::SetValue {
            key: "country".to_string(),
            value: ScalarValue::String("SK".to_string()),
        })
        .expect("valid country patch should process");

    assert_eq!(
        field_state(&engine, "region").value,
        ScalarValue::String("EU".to_string())
    );

    assert!(
        !field_state(&engine, "vat_id").hidden,
        "VAT ID should become visible after region is derived as EU"
    );
}

#[test]
fn propagates_reverse_change_through_dependency_chain() {
    let mut engine = engine_from_json(DEPENDENCIES_SCHEMA);

    engine
        .process_patch(Patch::SetValue {
            key: "country".to_string(),
            value: ScalarValue::String("SK".to_string()),
        })
        .expect("valid country patch should process");

    assert_eq!(
        field_state(&engine, "region").value,
        ScalarValue::String("EU".to_string())
    );

    assert!(!field_state(&engine, "vat_id").hidden);

    engine
        .process_patch(Patch::SetValue {
            key: "country".to_string(),
            value: ScalarValue::String("US".to_string()),
        })
        .expect("valid country patch should process");

    assert_eq!(
        field_state(&engine, "region").value,
        ScalarValue::String("OTHER".to_string())
    );

    assert!(
        field_state(&engine, "vat_id").hidden,
        "VAT ID should become hidden after region changes away from EU"
    );
}
