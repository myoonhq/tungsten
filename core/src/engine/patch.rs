use crate::types::ScalarValue;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum Patch {
    SetValue { key: String, value: ScalarValue },
    SetHidden { key: String, hidden: bool },
    SetErrors { key: String, errors: Vec<String> },
    ClearValue { key: String },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnginePatch {
    pub key: String,
    pub value: ScalarValue,
    pub derived: Vec<DerivedProp>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DerivedProp {
    Hidden(bool),
    Disabled(bool),
    Errors(Vec<String>),
}
