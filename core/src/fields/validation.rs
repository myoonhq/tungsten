use std::collections::HashSet;
use std::convert::TryFrom;

use super::errors::{FieldCompileError, ValidationError};
use super::raw::{RawField, RawValidator};
use crate::types::ScalarValue;

#[derive(Clone, Debug)]
pub enum StringValidator {
    Required,
    MinLength(usize),
    MaxLength(usize),
}

#[derive(Clone, Debug)]
pub enum NumberValidator {
    Required,
    Min(f64),
    Max(f64),
}

pub fn reject_configuration(raw: &RawField) -> Result<(), FieldCompileError> {
    if let Some(property) = raw
        .configuration
        .keys()
        .find(|key| key.as_str() != "bindings")
    {
        return Err(FieldCompileError::UnsupportedConfiguration {
            property: property.clone(),
        });
    }

    Ok(())
}

pub fn compile_string_validators(
    validators: &[RawValidator],
) -> Result<Vec<StringValidator>, FieldCompileError> {
    let mut compiled = Vec::with_capacity(validators.len());
    let mut seen = HashSet::new();

    for validator in validators {
        if !seen.insert(validator.kind.as_str()) {
            return Err(FieldCompileError::InvalidValidator {
                validator: validator.kind.clone(),
                message: "tg_schema_validator_is_declared_more_than_once".to_string(),
            });
        }

        let value = match validator.kind.as_str() {
            "required" => {
                expect_keys(validator, &[])?;
                StringValidator::Required
            }
            "min_length" => {
                expect_keys(validator, &["value"])?;
                StringValidator::MinLength(read_usize(validator)?)
            }
            "max_length" => {
                expect_keys(validator, &["value"])?;
                StringValidator::MaxLength(read_usize(validator)?)
            }
            _ => {
                return Err(FieldCompileError::UnsupportedValidator {
                    validator: validator.kind.clone(),
                });
            }
        };

        compiled.push(value);
    }

    let minimum = compiled.iter().find_map(|validator| match validator {
        StringValidator::MinLength(value) => Some(*value),
        _ => None,
    });
    let maximum = compiled.iter().find_map(|validator| match validator {
        StringValidator::MaxLength(value) => Some(*value),
        _ => None,
    });

    if matches!((minimum, maximum), (Some(minimum), Some(maximum)) if minimum > maximum) {
        return Err(FieldCompileError::InvalidValidator {
            validator: "min_length".to_string(),
            message: "tg_schema_minimum_length_cannot_exceed_maximum_length".to_string(),
        });
    }

    Ok(compiled)
}

pub fn compile_number_validators(
    validators: &[RawValidator],
) -> Result<Vec<NumberValidator>, FieldCompileError> {
    let mut compiled = Vec::with_capacity(validators.len());
    let mut seen = HashSet::new();

    for validator in validators {
        if !seen.insert(validator.kind.as_str()) {
            return Err(FieldCompileError::InvalidValidator {
                validator: validator.kind.clone(),
                message: "tg_schema_validator_is_declared_more_than_once".to_string(),
            });
        }

        let value = match validator.kind.as_str() {
            "required" => {
                expect_keys(validator, &[])?;
                NumberValidator::Required
            }
            "min" => {
                expect_keys(validator, &["value"])?;
                NumberValidator::Min(read_f64(validator)?)
            }
            "max" => {
                expect_keys(validator, &["value"])?;
                NumberValidator::Max(read_f64(validator)?)
            }
            _ => {
                return Err(FieldCompileError::UnsupportedValidator {
                    validator: validator.kind.clone(),
                });
            }
        };

        compiled.push(value);
    }

    let minimum = compiled.iter().find_map(|validator| match validator {
        NumberValidator::Min(value) => Some(*value),
        _ => None,
    });
    let maximum = compiled.iter().find_map(|validator| match validator {
        NumberValidator::Max(value) => Some(*value),
        _ => None,
    });

    if matches!((minimum, maximum), (Some(minimum), Some(maximum)) if minimum > maximum) {
        return Err(FieldCompileError::InvalidValidator {
            validator: "min".to_string(),
            message: "tg_schema_minimum_cannot_exceed_maximum".to_string(),
        });
    }

    Ok(compiled)
}

pub fn validate_string(
    validators: &[StringValidator],
    value: &ScalarValue,
) -> Vec<ValidationError> {
    let string = match value {
        ScalarValue::String(value) => Some(value.as_str()),
        ScalarValue::Null => None,
        _ => return Vec::new(),
    };

    let mut errors = Vec::new();

    for validator in validators {
        match validator {
            StringValidator::Required if string.is_none_or(str::is_empty) => {
                errors.push(ValidationError::new("required", "tg_validation_required"));
            }
            StringValidator::MinLength(minimum)
                if string.is_some_and(|value| value.chars().count() < *minimum) =>
            {
                errors.push(
                    ValidationError::new("min_length", "tg_validation_min_length")
                        .with_params(serde_json::json!({"min": minimum})),
                );
            }
            StringValidator::MaxLength(maximum)
                if string.is_some_and(|value| value.chars().count() > *maximum) =>
            {
                errors.push(
                    ValidationError::new("max_length", "tg_validation_max_length")
                        .with_params(serde_json::json!({"max": maximum})),
                );
            }
            _ => {}
        }
    }

    errors
}

pub fn validate_number(
    validators: &[NumberValidator],
    value: &ScalarValue,
) -> Vec<ValidationError> {
    let number = match value {
        ScalarValue::Number(value) => Some(*value),
        ScalarValue::Null => None,
        _ => return Vec::new(),
    };

    let mut errors = Vec::new();

    for validator in validators {
        match validator {
            NumberValidator::Required if number.is_none() => {
                errors.push(ValidationError::new("required", "tg_validation_required"));
            }
            NumberValidator::Min(minimum) if number.is_some_and(|value| value < *minimum) => {
                errors.push(
                    ValidationError::new("min", "tg_validation_min")
                        .with_params(serde_json::json!({"min": minimum})),
                );
            }
            NumberValidator::Max(maximum) if number.is_some_and(|value| value > *maximum) => {
                errors.push(
                    ValidationError::new("max", "tg_validation_max")
                        .with_params(serde_json::json!({"max": maximum})),
                );
            }
            _ => {}
        }
    }

    errors
}

fn expect_keys(validator: &RawValidator, expected: &[&str]) -> Result<(), FieldCompileError> {
    let actual: Vec<&str> = validator.configuration.keys().map(String::as_str).collect();

    if actual == expected {
        return Ok(());
    }

    Err(FieldCompileError::InvalidValidator {
        validator: validator.kind.clone(),
        message: crate::messages::diagnostic(
            "tg_schema_expected_properties",
            serde_json::json!({"p0": expected.join(", ")}),
        ),
    })
}

fn read_usize(validator: &RawValidator) -> Result<usize, FieldCompileError> {
    validator
        .configuration
        .get("value")
        .and_then(serde_json::Value::as_u64)
        .and_then(|value| usize::try_from(value).ok())
        .ok_or_else(|| FieldCompileError::InvalidValidator {
            validator: validator.kind.clone(),
            message: "tg_schema_value_must_be_a_non_negative_integer".to_string(),
        })
}

fn read_f64(validator: &RawValidator) -> Result<f64, FieldCompileError> {
    validator
        .configuration
        .get("value")
        .and_then(serde_json::Value::as_f64)
        .filter(|value| value.is_finite())
        .ok_or_else(|| FieldCompileError::InvalidValidator {
            validator: validator.kind.clone(),
            message: "tg_schema_value_must_be_a_finite_number".to_string(),
        })
}
