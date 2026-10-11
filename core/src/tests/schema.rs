use crate::schema::RawSchema;

use super::helpers::VISIBILITY_SCHEMA;

#[test]
fn deserializes_valid_schema() {
    let result: Result<RawSchema, serde_json::Error> = serde_json::from_str(VISIBILITY_SCHEMA);

    assert!(
        result.is_ok(),
        "valid visibility fixture failed to deserialize: {:?}",
        result.err()
    );

    let fields = result.unwrap().form;

    assert_eq!(fields.len(), 2);
    assert_eq!(fields[0].key(), "age");
    assert_eq!(fields[1].key(), "email");
}

#[test]
fn rejects_malformed_json() {
    let malformed_json = r#"
    [
      {
        "key": "age",
        "type": "number"
    ]
    "#;

    let result: Result<RawSchema, serde_json::Error> = serde_json::from_str(malformed_json);

    assert!(
        result.is_err(),
        "malformed JSON should not deserialize successfully"
    );
}
