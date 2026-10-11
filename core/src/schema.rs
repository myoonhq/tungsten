//! Sprout's structural input. Groups are containers, never value fields.
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

use crate::fields::RawField;

pub const SCHEMA_VERSION: &str = "sprout";
pub const MAX_GROUP_DEPTH: usize = 24;

std::thread_local! {
    // Each group parses its raw JSON independently, so bound the complete
    // deserialization chain as well as the later iterative compiler walk.
    static PARSING_GROUP_DEPTH: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

struct ParsingGroup;
impl ParsingGroup {
    fn enter<E: serde::de::Error>() -> Result<Self, E> {
        PARSING_GROUP_DEPTH.with(|depth| {
            if depth.get() >= MAX_GROUP_DEPTH {
                return Err(E::custom(crate::messages::diagnostic(
                    "tg_schema_group_nesting_exceeds_levels",
                    serde_json::json!({"MAX_GROUP_DEPTH": MAX_GROUP_DEPTH}),
                )));
            }
            depth.set(depth.get() + 1);
            Ok(Self)
        })
    }
}
impl Drop for ParsingGroup {
    fn drop(&mut self) {
        PARSING_GROUP_DEPTH.with(|depth| depth.set(depth.get() - 1));
    }
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawSchema {
    #[serde(rename = "schemaVersion")]
    pub schema_version: String,
    pub form: Vec<RawComponent>,
}

impl RawSchema {
    pub fn from_fields(fields: Vec<RawField>) -> Self {
        Self {
            schema_version: SCHEMA_VERSION.into(),
            form: fields.into_iter().map(RawComponent::Field).collect(),
        }
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
pub enum RawComponent {
    Field(RawField),
    Group(RawGroup),
    Repeater(RawRepeater),
}

impl<'de> Deserialize<'de> for RawComponent {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        struct ComponentType {
            #[serde(rename = "type", alias = "field_type")]
            kind: String,
        }
        // Buffer the JSON text, not a second allocated generic object tree.
        // Parsing descriptors from their original text also rejects duplicate
        // known properties instead of silently keeping the last occurrence.
        let raw = Box::<serde_json::value::RawValue>::deserialize(deserializer)?;
        let component_type: ComponentType =
            serde_json::from_str(raw.get()).map_err(serde::de::Error::custom)?;
        // Select by type before parsing: a malformed group cannot fall back to
        // an opaque custom scalar field.
        if component_type.kind == "group" {
            let _depth = ParsingGroup::enter::<D::Error>()?;
            serde_json::from_str(raw.get()).map(Self::Group)
        } else if component_type.kind == "repeater" {
            let _depth = ParsingGroup::enter::<D::Error>()?;
            serde_json::from_str(raw.get()).map(Self::Repeater)
        } else {
            serde_json::from_str(raw.get()).map(Self::Field)
        }
        .map_err(serde::de::Error::custom)
    }
}

impl RawComponent {
    pub fn key(&self) -> &str {
        match self {
            Self::Field(field) => &field.key,
            Self::Group(group) => &group.key,
            Self::Repeater(repeater) => &repeater.key,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GroupVariant {
    Basic,
    Sectioned,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawGroup {
    #[serde(rename = "type")]
    pub component_type: String,
    pub variant: GroupVariant,
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<GroupView>,
    pub render: GroupRender,
    pub subform: Vec<RawComponent>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GroupView {
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct GroupRender {
    #[serde(rename = "type")]
    pub render_type: String,
    pub settings: Value,
}

/// Collection logic is independent of its renderer and has no group variant.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawRepeater {
    #[serde(rename = "type")]
    pub component_type: String,
    pub key: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub view: Option<GroupView>,
    pub template: Vec<RawComponent>,
    pub render: GroupRender,
    #[serde(default)]
    pub min: usize,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub max: Option<usize>,
    #[serde(default)]
    pub reorder: bool,
    #[serde(default)]
    pub validators: Vec<crate::fields::RawValidator>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub current_value: Option<Vec<Value>>,
}
