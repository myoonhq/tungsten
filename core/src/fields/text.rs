use std::sync::Arc;

use super::common::Operation;
use super::compiled::{scalar_type, CompiledField, FieldBehavior};
use super::errors::{FieldCompileError, FieldValueError, ValidationError};
use super::library::FieldType;
use super::raw::RawField;
use super::validation::{compile_string_validators, validate_string, StringValidator};
use crate::types::ScalarValue;

#[derive(Clone, Copy, Debug, Default)]
pub struct TextFieldType;

impl FieldType for TextFieldType {
    fn type_name(&self) -> &'static str {
        "text"
    }

    fn descriptor(&self) -> crate::catalog::FieldDescriptor {
        let mut descriptor = crate::catalog::scalar(
            "text",
            "tg_schema_text",
            "tg_schema_plain_email_password_and_telephone_strings_or_null_email_trims_whitespace",
            "string",
            crate::catalog::string_validators(),
        );
        descriptor.settings = Some(crate::catalog::components(serde_json::json!([
            {"type":"text","key":"variant","current_value":"plain","view":{"label":"tg_catalog_variant","editorControl":"select","options":["plain","email","password","tel"]}},
            {"type":"boolean","key":"textarea","view":{"label":"tg_catalog_multiline_plain_only"}},
            {"type":"number","key":"rows","view":{"label":"tg_catalog_rows_required_for_multiline","description":"tg_schema_positive_integer_ignored_when_multiline_is_disabled"},"validators":[{"kind":"min","value":1}]},
            {"type":"boolean","key":"resizable","view":{"label":"tg_catalog_allow_vertical_resizing_multiline_only","description":"tg_schema_defaults_to_true_when_omitted"}}
        ])));
        descriptor
    }

    fn compile(&self, raw: &RawField) -> Result<CompiledField, FieldCompileError> {
        let variant = compile_settings(raw)?;
        let validators = compile_string_validators(&raw.validators)?;
        CompiledField::new(
            raw,
            Arc::new(TextBehavior {
                validators,
                variant,
            }),
        )
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
enum TextVariant {
    Plain,
    Email,
    Password,
    Tel,
}

fn compile_settings(raw: &RawField) -> Result<TextVariant, FieldCompileError> {
    for key in raw.configuration.keys() {
        if !["variant", "textarea", "rows", "resizable", "bindings"].contains(&key.as_str()) {
            return Err(FieldCompileError::UnsupportedConfiguration {
                property: key.clone(),
            });
        }
    }
    let invalid = |message: &str| FieldCompileError::InvalidConfiguration {
        message: message.into(),
    };
    let variant = match raw.configuration.get("variant") {
        None => TextVariant::Plain,
        Some(value) => match value.as_str() {
            Some("plain") => TextVariant::Plain,
            Some("email") => TextVariant::Email,
            Some("password") => TextVariant::Password,
            Some("tel") => TextVariant::Tel,
            _ => {
                return Err(invalid(
                    "tg_schema_variant_must_be_plain_email_password_or_tel",
                ))
            }
        },
    };
    let textarea = match raw.configuration.get("textarea") {
        None => false,
        Some(value) => value
            .as_bool()
            .ok_or_else(|| invalid("tg_schema_textarea_must_be_a_boolean"))?,
    };
    if textarea {
        if variant != TextVariant::Plain {
            return Err(invalid("tg_schema_textarea_requires_the_plain_variant"));
        }
        if raw
            .configuration
            .get("rows")
            .and_then(serde_json::Value::as_u64)
            .is_none_or(|rows| rows == 0 || rows > u32::MAX as u64)
        {
            return Err(invalid(
                "tg_schema_textarea_requires_rows_as_a_positive_32_bit_integer",
            ));
        }
        if raw
            .configuration
            .get("resizable")
            .is_some_and(|value| !value.is_boolean())
        {
            return Err(invalid("tg_schema_resizable_must_be_a_boolean"));
        }
    } else if raw.configuration.contains_key("rows") || raw.configuration.contains_key("resizable")
    {
        return Err(invalid(
            "tg_schema_rows_and_resizable_require_textarea_true",
        ));
    }
    Ok(variant)
}

#[derive(Debug)]
struct TextBehavior {
    validators: Vec<StringValidator>,
    variant: TextVariant,
}

impl FieldBehavior for TextBehavior {
    fn type_name(&self) -> &'static str {
        "text"
    }

    fn comparison_domain(&self) -> &'static str {
        "string"
    }

    fn supports_operation(&self, _operation: Operation) -> bool {
        true
    }

    fn normalize_value(&self, value: &ScalarValue) -> Result<ScalarValue, FieldValueError> {
        match value {
            ScalarValue::String(text) if self.variant == TextVariant::Email => {
                Ok(ScalarValue::String(text.trim().to_string()))
            }
            ScalarValue::String(_) | ScalarValue::Null => Ok(value.clone()),
            _ => Err(FieldValueError::InvalidType {
                expected: "tg_schema_string_or_null".to_string(),
                received: scalar_type(value).to_string(),
            }),
        }
    }

    fn validate(&self, value: &ScalarValue) -> Vec<ValidationError> {
        let mut errors = validate_string(&self.validators, value);
        if self.variant == TextVariant::Email {
            if let ScalarValue::String(text) = value {
                if !text.is_empty() && !has_basic_email_shape(text) {
                    errors.push(ValidationError::new("email", "tg_validation_email"));
                }
            }
        }
        errors
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fields::errors::{FieldValueError, ValidationError};

    fn compile(json: &str) -> CompiledField {
        let raw: RawField = serde_json::from_str(json).expect("text field should deserialize");
        TextFieldType
            .compile(&raw)
            .expect("text field should compile")
    }

    #[test]
    fn owns_text_type_and_normalization_semantics() {
        let field = compile(r#"{"key":"name","type":"text","current_value":"  Ada  "}"#);

        assert_eq!(
            field.common().initial_value,
            ScalarValue::String("  Ada  ".to_string())
        );
        assert_eq!(
            field.normalize_value(&ScalarValue::String(" Grace ".to_string())),
            Ok(ScalarValue::String(" Grace ".to_string()))
        );
        assert_eq!(
            field.normalize_value(&ScalarValue::Number(1.0)),
            Err(FieldValueError::InvalidType {
                expected: "tg_schema_string_or_null".to_string(),
                received: "number".to_string(),
            })
        );
    }

    #[test]
    fn owns_required_and_length_validation() {
        let field = compile(
            r#"{
                "key":"name",
                "type":"text",
                "validators":[
                    {"kind":"required"},
                    {"kind":"min_length","value":2},
                    {"kind":"max_length","value":4}
                ]
            }"#,
        );

        assert_eq!(
            field.validate(&ScalarValue::Null),
            vec![ValidationError::new("required", "tg_validation_required")]
        );
        assert_eq!(
            field.validate(&ScalarValue::String("x".to_string())),
            vec![
                ValidationError::new("min_length", "tg_validation_min_length")
                    .with_params(serde_json::json!({"min": 2}))
            ]
        );
        assert_eq!(
            field.validate(&ScalarValue::String("hello".to_string())),
            vec![
                ValidationError::new("max_length", "tg_validation_max_length")
                    .with_params(serde_json::json!({"max": 4}))
            ]
        );
    }
}

/// Enforces Tungsten's intentionally small email contract without pretending
/// to implement the full RFC mailbox grammar.
fn has_basic_email_shape(value: &str) -> bool {
    if value.chars().any(char::is_whitespace) {
        return false;
    }

    let mut address_parts = value.split('@');
    let Some(local) = address_parts.next() else {
        return false;
    };
    let Some(domain) = address_parts.next() else {
        return false;
    };

    if local.is_empty() || domain.is_empty() || address_parts.next().is_some() {
        return false;
    }

    let mut domain_label_count = 0usize;
    for label in domain.split('.') {
        if label.is_empty() {
            return false;
        }
        domain_label_count += 1;
    }

    domain_label_count >= 2
}

#[cfg(test)]
mod email_tests {
    use super::*;
    use crate::fields::errors::{FieldValueError, ValidationError};

    fn compile(json: &str) -> CompiledField {
        let raw: RawField = serde_json::from_str(json).expect("email field should deserialize");
        TextFieldType
            .compile(&raw)
            .expect("email field should compile")
    }

    #[test]
    fn owns_email_type_and_whitespace_normalization() {
        let field = compile(
            r#"{"key":"email","type":"text","variant":"email","current_value":"  ada@example.com  "}"#,
        );

        assert_eq!(
            field.common().initial_value,
            ScalarValue::String("ada@example.com".to_string())
        );
        assert_eq!(
            field.normalize_value(&ScalarValue::Bool(true)),
            Err(FieldValueError::InvalidType {
                expected: "tg_schema_string_or_null".to_string(),
                received: "boolean".to_string(),
            })
        );
    }

    #[test]
    fn owns_required_and_length_validation_after_normalization() {
        let field = compile(
            r#"{
                "key":"email",
                "type":"text","variant":"email",
                "validators":[
                    {"kind":"required"},
                    {"kind":"min_length","value":5},
                    {"kind":"max_length","value":20}
                ]
            }"#,
        );

        let normalized = field
            .normalize_value(&ScalarValue::String("   ".to_string()))
            .expect("email string should normalize");
        assert_eq!(
            field.validate(&normalized),
            vec![
                ValidationError::new("required", "tg_validation_required"),
                ValidationError::new("min_length", "tg_validation_min_length")
                    .with_params(serde_json::json!({"min": 5})),
            ]
        );
    }

    #[test]
    fn owns_basic_email_format_validation() {
        let field = compile(r#"{"key":"email","type":"text","variant":"email"}"#);

        for value in [
            "ada@example.com",
            "a@b.c",
            "first.last+tag@sub.example.co.uk",
        ] {
            assert!(
                field
                    .validate(&ScalarValue::String(value.to_string()))
                    .is_empty(),
                "{} should satisfy the email field's structural contract",
                value
            );
        }

        for value in [
            "not-an-email",
            "@example.com",
            "ada@",
            "ada@example",
            "ada@.com",
            "ada@example.",
            "ada@example..com",
            "ada@@example.com",
            "ada @example.com",
        ] {
            assert_eq!(
                field.validate(&ScalarValue::String(value.to_string())),
                vec![ValidationError::new("email", "tg_validation_email")],
                "{value} should be rejected by the email field"
            );
        }

        assert!(field
            .validate(&ScalarValue::String(String::new()))
            .is_empty());
        assert!(field.validate(&ScalarValue::Null).is_empty());

        let normalized = field
            .normalize_value(&ScalarValue::String("  ada@example.com  ".to_string()))
            .expect("padded email should normalize");
        assert!(field.validate(&normalized).is_empty());
    }
}

#[cfg(test)]
mod variant_tests {
    use super::*;
    use serde_json::json;
    fn compile(settings: serde_json::Value) -> Result<CompiledField, FieldCompileError> {
        let mut field = json!({"type":"text","key":"value"});
        field
            .as_object_mut()
            .unwrap()
            .extend(settings.as_object().unwrap().clone());
        TextFieldType.compile(&serde_json::from_value(field).unwrap())
    }
    #[test]
    fn plain_password_and_tel_preserve_whitespace_and_string_values() {
        for variant in ["plain", "password", "tel"] {
            let value = ScalarValue::String("  +00123\n secret  ".into());
            let field =
                compile(json!({"variant":variant,"validators":[{"kind":"required"}]})).unwrap();
            assert_eq!(field.normalize_value(&value).unwrap(), value);
            assert!(field.validate(&value).is_empty());
            assert!(!field
                .validate(&ScalarValue::String(String::new()))
                .is_empty());
            assert!(!field.validate(&ScalarValue::Null).is_empty());
        }
    }
    #[test]
    fn rejects_invalid_textarea_combinations_and_settings() {
        for settings in [
            json!({"variant":"unknown"}),
            json!({"variant":false}),
            json!({"textarea":true}),
            json!({"textarea":"true"}),
            json!({"rows":2}),
            json!({"resizable":true}),
            json!({"textarea":true,"rows":0}),
            json!({"textarea":true,"rows":1.5}),
            json!({"textarea":true,"rows":3,"resizable":"yes"}),
        ] {
            assert!(compile(settings.clone()).is_err(), "{}", settings);
        }
        for variant in ["email", "password", "tel"] {
            assert!(compile(json!({"variant":variant,"textarea":true,"rows":3})).is_err());
        }
        for resizable in [true, false] {
            assert!(compile(
                json!({"variant":"plain","textarea":true,"rows":3,"resizable":resizable})
            )
            .is_ok());
        }
    }
}
