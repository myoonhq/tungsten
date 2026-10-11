use serde::{Deserialize, Serialize};

use crate::types::ScalarValue;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct FieldView {
    pub label: String,
    // Presentation metadata must survive returning the validated schema tree.
    #[serde(flatten)]
    pub properties: std::collections::BTreeMap<String, serde_json::Value>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Rule {
    pub when: Condition,
    pub then: Vec<Consequence>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Condition {
    pub property: String,
    pub operation: Operation,
    pub value: ConditionOperand,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum Consequence {
    #[serde(rename = "set_hidden")]
    SetHidden { hidden: bool },

    #[serde(rename = "show")]
    Show,

    #[serde(rename = "clear_value")]
    ClearValue,

    #[serde(rename = "set_value")]
    SetValue { value: ScalarValue },

    #[serde(rename = "set_errors", alias = "set_behavior_errors")]
    SetErrors { errors: Vec<String> },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub enum Operation {
    #[serde(alias = "eq")]
    Eq,
    #[serde(alias = "neq")]
    Neq,
    #[serde(alias = "lt")]
    Lt,
    #[serde(alias = "gt")]
    Gt,
    #[serde(alias = "lte")]
    LEqt,
    #[serde(alias = "gte")]
    GEqt,
}

impl Operation {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Eq => "eq",
            Self::Neq => "neq",
            Self::Lt => "lt",
            Self::Gt => "gt",
            Self::LEqt => "lte",
            Self::GEqt => "gte",
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ConditionOperand {
    Value(ScalarValue),
    Ref { r#ref: String },
}
