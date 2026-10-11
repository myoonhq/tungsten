use serde_json::{json, Value};
use tungsten_core::{
    compiler::SchemaCompiler,
    engine::{patch::Patch, Engine},
    schema::RawSchema,
    ScalarValue,
};

fn engine(field: Value) -> Engine {
    let schema: RawSchema =
        serde_json::from_value(json!({"schemaVersion":"sprout","form":[field]})).unwrap();
    Engine::from_compiled(SchemaCompiler::new().compile(schema).unwrap())
}
fn round_trip(field: Value, input: Value, expected: Value) {
    let mut core = engine(field);
    let values = serde_json::from_value(json!({"value":input})).unwrap();
    assert!(core.load_values(Some(&values)).unwrap());
    assert_eq!(
        serde_json::to_value(&core.field_state("value").unwrap().value).unwrap(),
        expected
    );
    assert!(core.validate_all());
    assert!(core
        .process_patch(Patch::SetValue {
            key: "value".into(),
            value: serde_json::from_value(expected).unwrap()
        })
        .unwrap()
        .is_empty());
}
macro_rules! text_case {
    ($name:ident, $variant:expr, $input:expr, $expected:expr) => {
        #[test] fn $name() { round_trip(json!({"type":"text","key":"value","variant":$variant}),json!($input),json!($expected)); }
    }
}
text_case!(
    text_plain_preserves_whitespace,
    "plain",
    "  Ada  ",
    "  Ada  "
);
text_case!(
    text_email_normalizes_before_validation,
    "email",
    " ada@example.com ",
    "ada@example.com"
);
text_case!(
    text_password_keeps_literal_value,
    "password",
    "  secret  ",
    "  secret  "
);
text_case!(
    text_tel_does_not_coerce_numbers,
    "tel",
    "+421 123",
    "+421 123"
);
#[test]
fn text_textarea_retains_newlines() {
    round_trip(
        json!({"type":"text","key":"value","textarea":true,"rows":3}),
        json!("one\ntwo"),
        json!("one\ntwo"),
    );
}
#[test]
fn number_required_accepts_zero() {
    round_trip(
        json!({"type":"number","key":"value","validators":[{"kind":"required"}]}),
        json!(0),
        json!(0.0),
    );
}
#[test]
fn boolean_checkbox_required_accepts_false() {
    round_trip(
        json!({"type":"boolean","key":"value","validators":[{"kind":"required"}]}),
        json!(false),
        json!(false),
    );
}
#[test]
fn boolean_switch_required_accepts_false() {
    round_trip(
        json!({"type":"boolean","variant":"switch","key":"value","validators":[{"kind":"required"}]}),
        json!(false),
        json!(false),
    );
}
#[test]
fn boolean_radio_required_accepts_false() {
    round_trip(
        json!({"type":"boolean","variant":"radio","key":"value","options":[{"value":false,"label":"No"},{"value":true,"label":"Yes"}],"validators":[{"kind":"required"}]}),
        json!(false),
        json!(false),
    );
}
#[test]
fn select_single_keeps_nonfirst_saved_option() {
    round_trip(
        json!({"type":"select","key":"value","options":[{"value":"a","label":"Alpha"},{"value":"b","label":"Beta"}]}),
        json!("b"),
        json!("b"),
    );
}
#[test]
fn select_multiple_round_trips_ordered_values() {
    round_trip(
        json!({"type":"select","key":"value","multiple":true,"options":[{"value":"a","label":"Alpha"},{"value":"b","label":"Beta"}]}),
        json!(["b", "a"]),
        json!(["b", "a"]),
    );
}
#[test]
fn file_durable_reference_round_trips() {
    let value = json!({"files":[{"id":"saved","name":"proof.txt","size":3,"mediaType":"text/plain","uploaded":true}]});
    round_trip(
        json!({"type":"file","key":"value","upload":{"api":"test","endpoint":"files"}}),
        value.clone(),
        value,
    );
}
#[test]
fn date_calendar_leap_day_round_trips() {
    round_trip(
        json!({"type":"date","key":"value"}),
        json!("2024-02-29"),
        json!("2024-02-29"),
    );
}
#[test]
fn date_local_time_normalizes_seconds() {
    round_trip(
        json!({"type":"date","key":"value","mode":"time"}),
        json!("09:30"),
        json!("09:30:00"),
    );
}
#[test]
fn date_datetime_normalizes_instant_to_utc() {
    round_trip(
        json!({"type":"date","key":"value","mode":"datetime","timeZone":"Europe/Bratislava"}),
        json!("2026-10-07T10:30:00+02:00"),
        json!("2026-10-07T08:30:00Z"),
    );
}
#[test]
fn date_impossible_calendar_value_is_retained_with_validation_error() {
    let mut core = engine(json!({"type":"date","key":"value"}));
    assert!(!core
        .load_values(Some(
            &serde_json::from_value(json!({"value":"2025-02-29"})).unwrap()
        ))
        .unwrap());
    assert_eq!(
        core.field_state("value").unwrap().value,
        ScalarValue::String("2025-02-29".into())
    );
    assert!(!core.field_state("value").unwrap().errors.is_empty());
}
