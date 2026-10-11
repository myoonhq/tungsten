use std::sync::Arc;

use super::common::Operation;
use super::compiled::{scalar_type, CompiledField, FieldBehavior};
use super::errors::{FieldCompileError, FieldValueError, ValidationError};
use super::library::FieldType;
use super::raw::{RawField, RawValidator};
use crate::types::ScalarValue;

#[derive(Clone, Copy, Debug, Default)]
pub struct BooleanFieldType;

impl FieldType for BooleanFieldType {
    fn type_name(&self) -> &'static str {
        "boolean"
    }

    fn descriptor(&self) -> crate::catalog::FieldDescriptor {
        let mut descriptor = crate::catalog::scalar(
            "boolean",
            "tg_schema_boolean",
            "tg_schema_true_false_or_null_required_checks_presence_false_remains_valid",
            "boolean",
            vec![
                crate::catalog::validator(
                    "required",
                    "tg_catalog_required",
                    "tg_schema_a_boolean_is_required_false_is_valid",
                    false,
                    false,
                ),
                crate::catalog::validator(
                    "must_be_true",
                    "tg_schema_must_be_true",
                    "tg_schema_requires_an_affirmative_value_for_example_accepting_terms",
                    false,
                    false,
                ),
            ],
        );
        descriptor.settings = Some(crate::catalog::components(serde_json::json!([
            {"type":"text","key":"variant","current_value":"checkbox","view":{"label":"tg_catalog_variant","editorControl":"select","options":["checkbox","switch","radio"]}},
            {"type":"text","key":"direction","view":{"label":"tg_catalog_layout_radio_only","editorControl":"select","options":["column","row"]}},
            {"type":"text","key":"options","view":{"label":"tg_catalog_options_radio_only_json","description":"tg_schema_unique_boolean_values_with_labels_omit_for_yes_no","editorControl":"json"}}
        ])));
        descriptor
    }

    fn compile(&self, raw: &RawField) -> Result<CompiledField, FieldCompileError> {
        compile_settings(raw)?;
        let (required, must_be_true) = compile_validators(&raw.validators)?;
        CompiledField::new(
            raw,
            Arc::new(BooleanBehavior {
                required,
                must_be_true,
            }),
        )
    }
}

#[derive(Debug)]
struct BooleanBehavior {
    required: bool,
    must_be_true: bool,
}

impl FieldBehavior for BooleanBehavior {
    fn type_name(&self) -> &'static str {
        "boolean"
    }

    fn comparison_domain(&self) -> &'static str {
        "boolean"
    }

    fn supports_operation(&self, operation: Operation) -> bool {
        matches!(operation, Operation::Eq | Operation::Neq)
    }

    fn normalize_value(&self, value: &ScalarValue) -> Result<ScalarValue, FieldValueError> {
        match value {
            ScalarValue::Bool(_) | ScalarValue::Null => Ok(value.clone()),
            _ => Err(FieldValueError::InvalidType {
                expected: "tg_schema_boolean_or_null".to_string(),
                received: scalar_type(value).to_string(),
            }),
        }
    }

    fn validate(&self, value: &ScalarValue) -> Vec<ValidationError> {
        let mut errors = Vec::new();
        if self.required && matches!(value, ScalarValue::Null) {
            errors.push(ValidationError::new("required", "tg_validation_required"));
        }
        if self.must_be_true && !matches!(value, ScalarValue::Bool(true)) {
            errors.push(ValidationError::new(
                "must_be_true",
                "tg_validation_must_be_true",
            ));
        }
        errors
    }
}

fn compile_settings(raw: &RawField) -> Result<(), FieldCompileError> {
    let invalid = |message: &str| FieldCompileError::InvalidConfiguration {
        message: message.into(),
    };
    for key in raw.configuration.keys() {
        if !["variant", "direction", "options", "bindings"].contains(&key.as_str()) {
            return Err(FieldCompileError::UnsupportedConfiguration {
                property: key.clone(),
            });
        }
    }
    let variant = match raw.configuration.get("variant") {
        None => "checkbox",
        Some(value) => value
            .as_str()
            .ok_or_else(|| invalid("tg_schema_variant_must_be_checkbox_switch_or_radio"))?,
    };
    if !["checkbox", "switch", "radio"].contains(&variant) {
        return Err(invalid(
            "tg_schema_variant_must_be_checkbox_switch_or_radio",
        ));
    }
    if variant != "radio"
        && (raw.configuration.contains_key("options")
            || raw.configuration.contains_key("direction"))
    {
        return Err(invalid(
            "tg_schema_options_and_direction_require_the_radio_variant",
        ));
    }
    if raw
        .configuration
        .get("direction")
        .is_some_and(|v| !matches!(v.as_str(), Some("column" | "row")))
    {
        return Err(invalid("tg_schema_direction_must_be_column_or_row"));
    }
    if let Some(options) = raw.configuration.get("options") {
        super::select::choice_options(options.clone(), true)
            .map_err(|message| FieldCompileError::InvalidConfiguration { message })?;
    }
    Ok(())
}

fn compile_validators(validators: &[RawValidator]) -> Result<(bool, bool), FieldCompileError> {
    let mut required = false;
    let mut must_be_true = false;
    for validator in validators {
        let flag = match validator.kind.as_str() {
            "required" => &mut required,
            "must_be_true" => &mut must_be_true,
            _ => {
                return Err(FieldCompileError::UnsupportedValidator {
                    validator: validator.kind.clone(),
                })
            }
        };
        if *flag || !validator.configuration.is_empty() {
            return Err(FieldCompileError::InvalidValidator {
                validator: validator.kind.clone(),
                message: "tg_schema_validator_must_occur_once_with_no_parameters".into(),
            });
        }
        *flag = true;
    }
    Ok((required, must_be_true))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn compile(json: &str) -> Result<CompiledField, FieldCompileError> {
        let raw: RawField = serde_json::from_str(json).expect("boolean field should deserialize");
        BooleanFieldType.compile(&raw)
    }

    #[test]
    fn owns_boolean_type_normalization_and_comparison_semantics() {
        let field = compile(r#"{"key":"enabled","type":"boolean","current_value":true}"#)
            .expect("boolean field should compile");

        assert_eq!(field.common().initial_value, ScalarValue::Bool(true));
        assert_eq!(
            field.normalize_value(&ScalarValue::Bool(false)),
            Ok(ScalarValue::Bool(false))
        );
        assert_eq!(
            field.normalize_value(&ScalarValue::Null),
            Ok(ScalarValue::Null)
        );
        assert_eq!(
            field.normalize_value(&ScalarValue::String("true".to_string())),
            Err(FieldValueError::InvalidType {
                expected: "tg_schema_boolean_or_null".to_string(),
                received: "string".to_string(),
            })
        );

        assert_eq!(
            field.compare(
                &ScalarValue::Bool(true),
                Operation::Eq,
                &ScalarValue::Bool(true)
            ),
            Ok(true)
        );
        assert_eq!(
            field.compare(
                &ScalarValue::Bool(true),
                Operation::Neq,
                &ScalarValue::Bool(false)
            ),
            Ok(true)
        );
        assert_eq!(
            field.compare(
                &ScalarValue::Bool(true),
                Operation::Gt,
                &ScalarValue::Bool(false)
            ),
            Err(FieldValueError::UnsupportedOperation {
                operation: Operation::Gt,
            })
        );
    }

    #[test]
    fn owns_required_validation() {
        let field = compile(
            r#"{
                "key":"enabled",
                "type":"boolean",
                "validators":[{"kind":"required"}]
            }"#,
        )
        .expect("required boolean field should compile");

        assert_eq!(
            field.validate(&ScalarValue::Null),
            vec![ValidationError::new("required", "tg_validation_required")]
        );
        assert!(field.validate(&ScalarValue::Bool(false)).is_empty());
        assert!(field.validate(&ScalarValue::Bool(true)).is_empty());
    }

    #[test]
    fn rejects_non_boolean_values_and_unsupported_validators_during_compilation() {
        let invalid_value = compile(r#"{"key":"enabled","type":"boolean","current_value":1}"#)
            .expect_err("number initial value should fail boolean compilation");
        assert_eq!(
            invalid_value,
            FieldCompileError::InvalidInitialValue {
                source: FieldValueError::InvalidType {
                    expected: "tg_schema_boolean_or_null".to_string(),
                    received: "number".to_string(),
                },
            }
        );

        let invalid_validator = compile(
            r#"{
                "key":"enabled",
                "type":"boolean",
                "validators":[{"kind":"min","value":0}]
            }"#,
        )
        .expect_err("number validator should fail boolean compilation");
        assert_eq!(
            invalid_validator,
            FieldCompileError::UnsupportedValidator {
                validator: "min".to_string(),
            }
        );
    }
}

#[cfg(test)]
mod variant_tests {
    use super::*;
    use serde_json::json;
    fn compile(settings: serde_json::Value) -> Result<CompiledField, FieldCompileError> {
        let mut field = json!({"type":"boolean","key":"answer"});
        field
            .as_object_mut()
            .unwrap()
            .extend(settings.as_object().unwrap().clone());
        BooleanFieldType.compile(&serde_json::from_value(field).unwrap())
    }
    #[test]
    fn distinguishes_presence_from_affirmative_validation_in_every_variant() {
        for variant in ["checkbox", "switch", "radio"] {
            let required =
                compile(json!({"variant":variant,"validators":[{"kind":"required"}]})).unwrap();
            assert!(required.validate(&ScalarValue::Bool(false)).is_empty());
            assert_eq!(required.validate(&ScalarValue::Null).len(), 1);
            let affirmative =
                compile(json!({"variant":variant,"validators":[{"kind":"must_be_true"}]})).unwrap();
            assert!(affirmative.validate(&ScalarValue::Bool(true)).is_empty());
            assert_eq!(
                affirmative.validate(&ScalarValue::Bool(false))[0].code,
                "must_be_true"
            );
            assert_eq!(affirmative.validate(&ScalarValue::Null).len(), 1);
        }
        for validators in [
            json!([{"kind":"must_be_true"},{"kind":"must_be_true"}]),
            json!([{"kind":"must_be_true","value":true}]),
        ] {
            assert!(compile(json!({"validators":validators})).is_err());
        }
    }
    #[test]
    fn checks_boolean_options_layout_and_binding_scope() {
        assert!(compile(json!({"variant":"radio","direction":"row","options":[{"value":false,"label":"No"},{"value":true,"label":"Yes"}]})).is_ok());
        for settings in [
            json!({"variant":"button"}),
            json!({"variant":"radio","direction":"grid"}),
            json!({"options":[]}),
            json!({"variant":"switch","direction":"row"}),
            json!({"variant":"radio","options":[{"value":"false","label":"No"}]}),
            json!({"variant":"radio","options":[{"value":true,"label":"Yes"},{"value":true,"label":"Also yes"}]}),
            json!({"variant":"switch","bindings":{"options":{"source":"choices"}}}),
        ] {
            assert!(compile(settings.clone()).is_err(), "{}", settings);
        }
    }
}
