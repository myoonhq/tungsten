use super::{
    CompiledField, FieldBehavior, FieldCompileError, FieldType, FieldValueError, RawField,
    ValidationError,
};
use crate::ScalarValue;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct SelectOption {
    pub value: ChoiceValue,
    pub label: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Hash, Deserialize, Serialize)]
#[serde(untagged)]
pub enum ChoiceValue {
    String(String),
    Bool(bool),
}
impl ChoiceValue {
    pub fn as_str(&self) -> Option<&str> {
        match self {
            Self::String(value) => Some(value),
            Self::Bool(_) => None,
        }
    }
    fn scalar(&self) -> ScalarValue {
        match self {
            Self::String(value) => ScalarValue::String(value.clone()),
            Self::Bool(value) => ScalarValue::Bool(*value),
        }
    }
}
pub fn options(value: serde_json::Value) -> Result<Vec<SelectOption>, String> {
    choice_options(value, false)
}
pub(crate) fn choice_options(
    value: serde_json::Value,
    boolean: bool,
) -> Result<Vec<SelectOption>, String> {
    let entries: Vec<SelectOption> = serde_json::from_value(value).map_err(|e| {
        crate::messages::diagnostic("tg_schema_invalid_options", serde_json::json!({"p0": if boolean { "radio" } else { "select" }, "p1": e.to_string()}))
    })?;
    let mut seen = std::collections::HashSet::new();
    if entries.iter().any(|entry| {
        (match &entry.value {
            ChoiceValue::String(value) => boolean || value.is_empty(),
            ChoiceValue::Bool(_) => !boolean,
        }) || !seen.insert(&entry.value)
    }) {
        return Err(if boolean {
            "tg_schema_radio_option_values_must_be_unique_booleans"
        } else {
            "tg_schema_select_option_values_must_be_nonempty_unique_strings"
        }
        .into());
    }
    Ok(entries)
}

/// Reconcile a selection only against a successfully loaded options list.
pub(crate) fn reconcile_value(
    value: &ScalarValue,
    options: &[SelectOption],
    select_first_option: bool,
) -> ScalarValue {
    let available: std::collections::HashSet<&str> = options
        .iter()
        .filter_map(|option| option.value.as_str())
        .collect();
    let reconciled = match value {
        ScalarValue::Bool(value)
            if !options
                .iter()
                .any(|option| option.value == ChoiceValue::Bool(*value)) =>
        {
            ScalarValue::Null
        }
        ScalarValue::String(value) if !available.contains(value.as_str()) => ScalarValue::Null,
        ScalarValue::Strings(values) => ScalarValue::Strings(
            values
                .iter()
                .filter(|value| available.contains(value.as_str()))
                .cloned()
                .collect(),
        ),
        _ => value.clone(),
    };
    if select_first_option {
        if let Some(first) = options.first() {
            return match &reconciled {
                ScalarValue::Null => first.value.scalar(),
                ScalarValue::Strings(values) if values.is_empty() => {
                    ScalarValue::Strings(vec![first
                        .value
                        .as_str()
                        .expect("multiple select has string options")
                        .into()])
                }
                _ => reconciled,
            };
        }
    }
    reconciled
}
pub(super) fn required(raw: &RawField) -> Result<bool, FieldCompileError> {
    let mut required = false;
    for validator in &raw.validators {
        if validator.kind != "required" {
            return Err(FieldCompileError::UnsupportedValidator {
                validator: validator.kind.clone(),
            });
        }
        if required || !validator.configuration.is_empty() {
            return Err(FieldCompileError::InvalidValidator {
                validator: "required".into(),
                message: "tg_schema_required_must_occur_once_with_no_parameters".into(),
            });
        }
        required = true;
    }
    Ok(required)
}
#[derive(Clone, Copy, Debug)]
pub struct SelectFieldType;
impl FieldType for SelectFieldType {
    fn type_name(&self) -> &'static str {
        "select"
    }
    fn descriptor(&self) -> crate::catalog::FieldDescriptor {
        let mut descriptor = crate::catalog::scalar(
            "select",
            "tg_schema_select",
            "tg_schema_single_or_multiple_string_valued_choices_options_bindings_and_selectfirstoption_use_js",
            "string",
            vec![crate::catalog::validator(
                "required",
                "tg_catalog_required",
                "tg_schema_a_selection_is_required",
                false,
                false,
            )],
        );
        descriptor.settings = None;
        descriptor
    }
    fn compile(&self, raw: &RawField) -> Result<CompiledField, FieldCompileError> {
        if let Some(key) = raw.configuration.keys().find(|key| {
            !["options", "bindings", "multiple", "selectFirstOption"].contains(&key.as_str())
        }) {
            return Err(FieldCompileError::UnsupportedConfiguration {
                property: key.clone(),
            });
        }
        if let Some(value) = raw.configuration.get("options") {
            options(value.clone())
                .map_err(|message| FieldCompileError::InvalidConfiguration { message })?;
        }
        let multiple = match raw.configuration.get("multiple") {
            None => false,
            Some(serde_json::Value::Bool(value)) => *value,
            Some(_) => {
                return Err(FieldCompileError::InvalidConfiguration {
                    message: "tg_schema_multiple_must_be_a_boolean".into(),
                })
            }
        };
        if raw
            .configuration
            .get("selectFirstOption")
            .is_some_and(|value| !value.is_boolean())
        {
            return Err(FieldCompileError::InvalidConfiguration {
                message: "tg_schema_selectfirstoption_must_be_a_boolean".into(),
            });
        }
        CompiledField::new(
            raw,
            Arc::new(SelectBehavior {
                required: required(raw)?,
                multiple,
            }),
        )
    }
}
#[derive(Debug)]
struct SelectBehavior {
    required: bool,
    multiple: bool,
}
impl FieldBehavior for SelectBehavior {
    fn type_name(&self) -> &'static str {
        "select"
    }
    fn comparison_domain(&self) -> &'static str {
        if self.multiple {
            "string_array"
        } else {
            "string"
        }
    }
    fn default_value(&self) -> ScalarValue {
        if self.multiple {
            ScalarValue::Strings(vec![])
        } else {
            ScalarValue::Null
        }
    }
    fn normalize_value(&self, value: &ScalarValue) -> Result<ScalarValue, FieldValueError> {
        if self.multiple {
            return match value {
                ScalarValue::Null => Ok(self.default_value()),
                ScalarValue::Strings(values) => {
                    let mut seen = std::collections::HashSet::new();
                    if values
                        .iter()
                        .any(|value| value.is_empty() || !seen.insert(value))
                    {
                        Err(FieldValueError::InvalidValue {
                            message: "tg_schema_selected_values_must_be_nonempty_and_unique".into(),
                        })
                    } else {
                        Ok(value.clone())
                    }
                }
                _ => Err(FieldValueError::InvalidType {
                    expected: "tg_schema_string_array_or_null".into(),
                    received: super::compiled::scalar_type(value).into(),
                }),
            };
        }
        match value {
            ScalarValue::String(_) | ScalarValue::Null => Ok(value.clone()),
            _ => Err(FieldValueError::InvalidType {
                expected: "tg_schema_string_or_null".into(),
                received: super::compiled::scalar_type(value).into(),
            }),
        }
    }
    fn validate(&self, value: &ScalarValue) -> Vec<ValidationError> {
        if self.required
            && (matches!(value, ScalarValue::Null)
                || matches!(value, ScalarValue::String(s) if s.is_empty())
                || matches!(value, ScalarValue::Strings(s) if s.is_empty()))
        {
            vec![ValidationError::new("required", "tg_validation_required")]
        } else {
            vec![]
        }
    }
}
