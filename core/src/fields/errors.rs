use std::error::Error;
use std::fmt::{Display, Formatter};

use super::common::Operation;

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FieldValueError {
    InvalidType { expected: String, received: String },
    InvalidValue { message: String },
    UnsupportedOperation { operation: Operation },
}

impl Display for FieldValueError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidType { expected, received } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_expected_received",
                        serde_json::json!({"expected": expected, "received": received})
                    )
                )
            }
            Self::InvalidValue { message } => formatter.write_str(message),
            Self::UnsupportedOperation { operation } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_operation_is_not_supported",
                        serde_json::json!({"p0": operation.as_str()})
                    )
                )
            }
        }
    }
}

impl Error for FieldValueError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FieldCompileError {
    InvalidConfiguration {
        message: String,
    },
    UnsupportedConfiguration {
        property: String,
    },
    UnsupportedValidator {
        validator: String,
    },
    InvalidValidator {
        validator: String,
        message: String,
    },
    InvalidInitialValue {
        source: FieldValueError,
    },
    InvalidActionValue {
        rule_index: usize,
        action_index: usize,
        source: FieldValueError,
    },
}

impl Display for FieldCompileError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidConfiguration { message } => formatter.write_str(message),
            Self::UnsupportedConfiguration { property } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_unsupported_field_configuration",
                        serde_json::json!({"property": property})
                    )
                )
            }
            Self::UnsupportedValidator { validator } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_unsupported_validator",
                        serde_json::json!({"validator": validator})
                    )
                )
            }
            Self::InvalidValidator { validator, message } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_invalid_validator",
                        serde_json::json!({"validator": validator, "message": message})
                    )
                )
            }
            Self::InvalidInitialValue { source } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_invalid_current_value",
                        serde_json::json!({"source": (source).to_string()})
                    )
                )
            }
            Self::InvalidActionValue {
                rule_index,
                action_index,
                source,
            } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_invalid_value_at_rules_then",
                        serde_json::json!({"rule_index": rule_index, "action_index": action_index, "source": (source).to_string()})
                    )
                )
            }
        }
    }
}

impl Error for FieldCompileError {}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValidationError {
    pub code: String,
    pub message: crate::messages::Message,
}

impl ValidationError {
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: crate::messages::Message::new(message),
        }
    }
    pub fn with_params(mut self, params: serde_json::Value) -> Self {
        self.message = self.message.with_params(params);
        self
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct FieldRegistrationError {
    pub field_type: String,
}

impl Display for FieldRegistrationError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{}",
            crate::messages::diagnostic(
                "tg_schema_field_type_is_already_registered",
                serde_json::json!({"p0": self.field_type})
            )
        )
    }
}

impl Error for FieldRegistrationError {}
