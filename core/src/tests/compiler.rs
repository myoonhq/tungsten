use crate::compiler::{CompileError, SchemaCompiler};
use crate::schema::RawSchema;

use super::helpers::{
    DUPLICATE_KEYS_SCHEMA, UNKNOWN_DEPENDENCY_SCHEMA, UNKNOWN_OPERAND_REFERENCE_SCHEMA,
    VISIBILITY_SCHEMA,
};

#[test]
fn compiles_a_valid_field_schema() {
    let schema: RawSchema =
        serde_json::from_str(VISIBILITY_SCHEMA).expect("visibility fixture should deserialize");

    let compiled = SchemaCompiler::new()
        .compile(schema)
        .expect("valid field schema should compile");

    let keys: Vec<&str> = compiled
        .raw_fields()
        .iter()
        .map(|field| field.key.as_str())
        .collect();

    assert_eq!(
        keys,
        vec!["age", "email"],
        "compilation should preserve every field and its order"
    );
}

#[test]
fn rejects_duplicate_field_keys() {
    let schema: RawSchema = serde_json::from_str(DUPLICATE_KEYS_SCHEMA)
        .expect("duplicate-key fixture should deserialize");

    let error = SchemaCompiler::new()
        .compile(schema)
        .expect_err("duplicate field keys should fail compilation");

    assert_eq!(
        error,
        CompileError::DuplicateFieldKey {
            key: "email".to_string(),
        }
    );
}

#[test]
fn rejects_rules_that_depend_on_unknown_fields() {
    let schema: RawSchema = serde_json::from_str(UNKNOWN_DEPENDENCY_SCHEMA)
        .expect("unknown-dependency fixture should deserialize");

    let error = SchemaCompiler::new()
        .compile(schema)
        .expect_err("unknown rule dependencies should fail compilation");

    assert_eq!(
        error,
        CompileError::UnknownFieldReference {
            field_key: "email".to_string(),
            referenced_key: "age".to_string(),
        }
    );
}

#[test]
fn rejects_condition_operands_that_reference_unknown_fields() {
    let schema: RawSchema = serde_json::from_str(UNKNOWN_OPERAND_REFERENCE_SCHEMA)
        .expect("unknown-operand-reference fixture should deserialize");

    let error = SchemaCompiler::new()
        .compile(schema)
        .expect_err("unknown condition operand references should fail compilation");

    assert_eq!(
        error,
        CompileError::UnknownFieldReference {
            field_key: "adult_notice".to_string(),
            referenced_key: "minimum_age".to_string(),
        }
    );
}
