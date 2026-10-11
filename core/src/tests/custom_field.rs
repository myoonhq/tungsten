use crate::schema::RawSchema;
use std::sync::Arc;

use serde_json::Value;

use crate::compiler::{CompileError, SchemaCompiler};
use crate::engine::patch::Patch;
use crate::engine::Engine;
use crate::fields::{
    CompiledField, FieldBehavior, FieldCompileError, FieldLibrary, FieldType, FieldValueError,
    RawField, ValidationError,
};
use crate::types::ScalarValue;

#[derive(Clone, Copy, Debug)]
struct TestCodeFieldType;

impl FieldType for TestCodeFieldType {
    fn type_name(&self) -> &'static str {
        "test_code"
    }

    fn compile(&self, raw: &RawField) -> Result<CompiledField, FieldCompileError> {
        for property in raw.configuration.keys() {
            if property != "trim" && property != "uppercase" {
                return Err(FieldCompileError::UnsupportedConfiguration {
                    property: property.clone(),
                });
            }
        }

        let trim = read_bool_configuration(raw, "trim")?;
        let uppercase = read_bool_configuration(raw, "uppercase")?;
        let forbidden_values = compile_forbidden_values(raw, trim, uppercase)?;

        CompiledField::new(
            raw,
            Arc::new(TestCodeBehavior {
                trim,
                uppercase,
                forbidden_values,
            }),
        )
    }
}

#[derive(Debug)]
struct TestCodeBehavior {
    trim: bool,
    uppercase: bool,
    forbidden_values: Vec<String>,
}

impl FieldBehavior for TestCodeBehavior {
    fn type_name(&self) -> &'static str {
        "test_code"
    }

    fn comparison_domain(&self) -> &'static str {
        "test_code"
    }

    fn default_value(&self) -> ScalarValue {
        ScalarValue::String("draft".to_string())
    }

    fn normalize_value(&self, value: &ScalarValue) -> Result<ScalarValue, FieldValueError> {
        match value {
            ScalarValue::String(value) => Ok(ScalarValue::String(normalize_string(
                value,
                self.trim,
                self.uppercase,
            ))),
            ScalarValue::Null => Ok(ScalarValue::Null),
            value => Err(FieldValueError::InvalidType {
                expected: "tg_schema_string_or_null".to_string(),
                received: crate::fields::compiled::scalar_type(value).to_string(),
            }),
        }
    }

    fn validate(&self, value: &ScalarValue) -> Vec<ValidationError> {
        match value {
            ScalarValue::String(value) if self.forbidden_values.contains(value) => {
                vec![ValidationError::new(
                    "forbidden",
                    "This value is forbidden.",
                )]
            }
            _ => Vec::new(),
        }
    }
}

fn read_bool_configuration(raw: &RawField, property: &str) -> Result<bool, FieldCompileError> {
    match raw.configuration.get(property) {
        None => Ok(false),
        Some(Value::Bool(value)) => Ok(*value),
        Some(_) => Err(FieldCompileError::UnsupportedConfiguration {
            property: property.to_string(),
        }),
    }
}

fn compile_forbidden_values(
    raw: &RawField,
    trim: bool,
    uppercase: bool,
) -> Result<Vec<String>, FieldCompileError> {
    raw.validators
        .iter()
        .map(|validator| {
            if validator.kind != "forbidden" {
                return Err(FieldCompileError::UnsupportedValidator {
                    validator: validator.kind.clone(),
                });
            }

            let value = validator
                .configuration
                .get("value")
                .and_then(Value::as_str)
                .ok_or_else(|| FieldCompileError::InvalidValidator {
                    validator: validator.kind.clone(),
                    message: "'value' must be a string".to_string(),
                })?;

            if validator.configuration.len() != 1 {
                return Err(FieldCompileError::InvalidValidator {
                    validator: validator.kind.clone(),
                    message: "expected only the 'value' property".to_string(),
                });
            }

            Ok(normalize_string(value, trim, uppercase))
        })
        .collect()
}

fn normalize_string(value: &str, trim: bool, uppercase: bool) -> String {
    let value = if trim { value.trim() } else { value };

    if uppercase {
        value.to_uppercase()
    } else {
        value.to_string()
    }
}

#[test]
fn registered_custom_field_compiles_initializes_and_runs_without_core_changes() {
    let raw_schema: Vec<RawField> = serde_json::from_str(
        r#"
        [
          {
            "key": "code",
            "type": "test_code",
            "trim": true,
            "uppercase": true,
            "validators": [
              { "kind": "forbidden", "value": " blocked " }
            ]
          },
          {
            "key": "status",
            "type": "text",
            "rules": [
              {
                "when": {
                  "property": "code",
                  "operation": "Eq",
                  "value": " ready "
                },
                "then": [
                  { "kind": "set_value", "value": "matched" }
                ]
              }
            ]
          }
        ]
        "#,
    )
    .expect("neutral custom-field schema should deserialize");

    assert_eq!(raw_schema[0].configuration["trim"], Value::Bool(true));
    assert_eq!(raw_schema[0].validators[0].kind, "forbidden");

    let mut library = FieldLibrary::default();
    library
        .register(TestCodeFieldType)
        .expect("test field type should register alongside built-ins");

    let compiled = SchemaCompiler::with_library(library)
        .compile(RawSchema::from_fields(raw_schema))
        .expect("registered custom field should compile");
    let code = &compiled.fields()[0];

    assert_eq!(
        code.common().initial_value,
        ScalarValue::String("DRAFT".to_string())
    );
    assert_eq!(
        code.normalize_value(&ScalarValue::String(" ready ".to_string())),
        Ok(ScalarValue::String("READY".to_string()))
    );
    assert_eq!(
        code.normalize_value(&ScalarValue::Bool(true)),
        Err(FieldValueError::InvalidType {
            expected: "tg_schema_string_or_null".to_string(),
            received: "boolean".to_string(),
        })
    );
    assert_eq!(
        code.compare(
            &ScalarValue::String(" ready ".to_string()),
            crate::fields::Operation::Eq,
            &ScalarValue::String("READY".to_string()),
        ),
        Ok(true)
    );
    assert_eq!(
        code.validate(&ScalarValue::String("BLOCKED".to_string())),
        vec![ValidationError::new(
            "forbidden",
            "This value is forbidden."
        )]
    );

    let mut engine = Engine::from_compiled(compiled);
    assert_eq!(
        engine
            .field_state("code")
            .expect("custom field should initialize")
            .value,
        ScalarValue::String("DRAFT".to_string())
    );

    let patches = engine
        .process_patch(Patch::SetValue {
            key: "code".to_string(),
            value: ScalarValue::String(" ready ".to_string()),
        })
        .expect("custom field patch should process");

    assert_eq!(
        patches,
        vec![
            Patch::SetValue {
                key: "code".to_string(),
                value: ScalarValue::String("READY".to_string()),
            },
            Patch::SetValue {
                key: "status".to_string(),
                value: ScalarValue::String("matched".to_string()),
            },
        ]
    );
    assert_eq!(
        engine
            .field_state("status")
            .expect("dependent built-in field should exist")
            .value,
        ScalarValue::String("matched".to_string())
    );

    engine
        .process_patch(Patch::SetValue {
            key: "code".to_string(),
            value: ScalarValue::String(" blocked ".to_string()),
        })
        .expect("custom validator patch should process");
    assert_eq!(
        serde_json::to_value(
            &engine
                .field_state("code")
                .expect("custom field should remain present")
                .errors
        )
        .unwrap(),
        serde_json::json!([{"messageKey": "This value is forbidden."}])
    );
}

#[test]
fn unregistered_type_returns_exact_compiler_error() {
    let raw_schema: Vec<RawField> =
        serde_json::from_str(r#"[{"key":"mystery","type":"not_registered"}]"#)
            .expect("unknown type remains neutral during deserialization");

    let error = SchemaCompiler::new()
        .compile(RawSchema::from_fields(raw_schema))
        .expect_err("unregistered type should fail during compilation");

    assert_eq!(
        error,
        CompileError::UnknownFieldType {
            field_key: "mystery".to_string(),
            field_type: "not_registered".to_string(),
        }
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&error.to_string()).unwrap(),
        serde_json::json!({"messageKey":"tg_schema_unknown_field_type_for_field","params":{"field_key":"mystery","field_type":"not_registered"}})
    );
}
