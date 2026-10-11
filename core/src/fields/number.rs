use std::sync::Arc;

use super::common::Operation;
use super::compiled::{scalar_type, CompiledField, FieldBehavior};
use super::errors::{FieldCompileError, FieldValueError, ValidationError};
use super::library::FieldType;
use super::raw::RawField;
use super::validation::{
    compile_number_validators, reject_configuration, validate_number, NumberValidator,
};
use crate::types::ScalarValue;

#[derive(Clone, Copy, Debug, Default)]
pub struct NumberFieldType;

impl FieldType for NumberFieldType {
    fn type_name(&self) -> &'static str {
        "number"
    }

    fn descriptor(&self) -> crate::catalog::FieldDescriptor {
        crate::catalog::scalar(
            "number",
            "Number",
            "tg_schema_finite_numbers_or_null_no_string_coercion",
            "number",
            vec![
                crate::catalog::validator(
                    "required",
                    "tg_catalog_required",
                    "tg_schema_a_number_is_required_zero_is_valid",
                    false,
                    false,
                ),
                crate::catalog::validator(
                    "min",
                    "tg_schema_minimum",
                    "tg_schema_inclusive_lower_bound",
                    true,
                    false,
                ),
                crate::catalog::validator(
                    "max",
                    "tg_schema_maximum",
                    "tg_schema_inclusive_upper_bound",
                    true,
                    false,
                ),
            ],
        )
    }

    fn compile(&self, raw: &RawField) -> Result<CompiledField, FieldCompileError> {
        reject_configuration(raw)?;
        let validators = compile_number_validators(&raw.validators)?;
        CompiledField::new(raw, Arc::new(NumberBehavior { validators }))
    }
}

#[derive(Debug)]
struct NumberBehavior {
    validators: Vec<NumberValidator>,
}

impl FieldBehavior for NumberBehavior {
    fn type_name(&self) -> &'static str {
        "number"
    }

    fn comparison_domain(&self) -> &'static str {
        "number"
    }

    fn supports_operation(&self, _operation: Operation) -> bool {
        true
    }

    fn normalize_value(&self, value: &ScalarValue) -> Result<ScalarValue, FieldValueError> {
        match value {
            ScalarValue::Number(value) if value.is_finite() => Ok(ScalarValue::Number(*value)),
            ScalarValue::Number(_) => Err(FieldValueError::InvalidValue {
                message: "tg_schema_number_must_be_finite".to_string(),
            }),
            ScalarValue::Null => Ok(ScalarValue::Null),
            _ => Err(FieldValueError::InvalidType {
                expected: "tg_schema_number_or_null".to_string(),
                received: scalar_type(value).to_string(),
            }),
        }
    }

    fn validate(&self, value: &ScalarValue) -> Vec<ValidationError> {
        validate_number(&self.validators, value)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fields::errors::{FieldValueError, ValidationError};

    fn compile(json: &str) -> CompiledField {
        let raw: RawField = serde_json::from_str(json).expect("number field should deserialize");
        NumberFieldType
            .compile(&raw)
            .expect("number field should compile")
    }

    #[test]
    fn owns_number_type_and_normalization_semantics() {
        let field = compile(r#"{"key":"age","type":"number","current_value":0}"#);

        assert_eq!(field.common().initial_value, ScalarValue::Number(0.0));
        assert_eq!(
            field.normalize_value(&ScalarValue::String("1".to_string())),
            Err(FieldValueError::InvalidType {
                expected: "tg_schema_number_or_null".to_string(),
                received: "string".to_string(),
            })
        );
    }

    #[test]
    fn owns_required_and_range_validation() {
        let field = compile(
            r#"{
                "key":"age",
                "type":"number",
                "validators":[
                    {"kind":"required"},
                    {"kind":"min","value":0},
                    {"kind":"max","value":120}
                ]
            }"#,
        );

        assert_eq!(
            field.validate(&ScalarValue::Null),
            vec![ValidationError::new("required", "tg_validation_required")]
        );
        assert_eq!(
            field.validate(&ScalarValue::Number(-1.0)),
            vec![ValidationError::new("min", "tg_validation_min")
                .with_params(serde_json::json!({"min": 0.0}))]
        );
        assert_eq!(
            field.validate(&ScalarValue::Number(121.0)),
            vec![ValidationError::new("max", "tg_validation_max")
                .with_params(serde_json::json!({"max": 120.0}))]
        );
        assert!(field.validate(&ScalarValue::Number(0.0)).is_empty());
    }
}
