use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::common::{FieldView, Rule};
use crate::types::ScalarValue;

/// Serializable, field-agnostic input at the JSON and WASM boundaries.
///
/// Core understands the common form-engine properties. Everything else stays
/// opaque until the registered field type compiles it.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RawField {
    pub key: String,

    #[serde(rename = "type", alias = "field_type")]
    pub field_type: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<FieldView>,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rules: Vec<Rule>,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub validators: Vec<RawValidator>,

    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_value: Option<ScalarValue>,

    #[serde(default, skip_serializing_if = "is_false")]
    pub hidden: bool,
    #[serde(default, skip_serializing_if = "is_false")]
    pub disabled: bool,
    #[serde(default, rename = "readOnly", skip_serializing_if = "is_false")]
    pub read_only: bool,

    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub errors: Vec<String>,

    #[serde(flatten)]
    pub configuration: BTreeMap<String, Value>,
}

impl RawField {
    pub fn field_type(&self) -> &str {
        &self.field_type
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct RawValidator {
    pub kind: String,

    #[serde(flatten)]
    pub configuration: BTreeMap<String, Value>,
}

fn is_false(value: &bool) -> bool {
    !*value
}
