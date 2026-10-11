//! Network-independent source bindings. Hosts receive effects and return ready data.
use crate::fields::RawField;
use crate::ScalarValue;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(untagged)]
pub enum Input {
    Ref { r#ref: String },
    Literal { value: ScalarValue },
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Binding {
    pub source: String,
    #[serde(default)]
    pub params: BTreeMap<String, Input>,
    #[serde(default)]
    pub apply: Option<String>,
}
pub fn bindings(raw: &RawField) -> Result<BTreeMap<String, Binding>, String> {
    let Some(value) = raw.configuration.get("bindings") else {
        return Ok(BTreeMap::new());
    };
    let parsed: BTreeMap<String, Binding> = serde_json::from_value(value.clone()).map_err(|e| {
        crate::messages::diagnostic(
            "tg_source_invalid_bindings_on",
            serde_json::json!({"p0": raw.key, "e": e.to_string()}),
        )
    })?;
    for (slot, binding) in &parsed {
        if !["value", "options"].contains(&slot.as_str())
            || (slot == "options"
                && raw.field_type != "select"
                && !(raw.field_type == "boolean"
                    && raw.configuration.get("variant").and_then(Value::as_str) == Some("radio")))
            || binding.source.trim().is_empty()
        {
            return Err(crate::messages::diagnostic(
                "tg_source_unsupported_source_binding_on",
                serde_json::json!({"slot": slot, "p0": raw.key}),
            ));
        }
        if binding
            .apply
            .as_ref()
            .is_some_and(|mode| !["initial", "live"].contains(&mode.as_str()))
            || (slot == "options" && binding.apply.is_some())
        {
            return Err("tg_schema_apply_must_be_initial_live_on_value_bindings_only".into());
        }
        for input in value[slot]["params"]
            .as_object()
            .into_iter()
            .flat_map(|m| m.values())
        {
            if input.as_object().is_none_or(|m| m.len() != 1) {
                return Err("tg_schema_source_inputs_must_contain_exactly_ref_or_value".into());
            }
        }
    }
    Ok(parsed)
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceEffect {
    pub id: String,
    pub source: String,
    pub revision: String,
    pub params: BTreeMap<String, ScalarValue>,
}
#[derive(Clone, Debug, Default)]
pub(crate) struct SourceRuntime {
    pub registry: std::collections::BTreeSet<String>,
    pub entries: BTreeMap<String, Entry>,
    pub inputs: BTreeMap<String, Vec<String>>,
    pub effects: Vec<SourceEffect>,
    pub next_revision: u64,
    pub seeded: std::collections::BTreeSet<u64>,
}
#[derive(Clone, Debug)]
pub(crate) struct Entry {
    pub key: String,
    pub slot: String,
    pub binding: Binding,
    pub params: Option<BTreeMap<String, ScalarValue>>,
    pub revision: u64,
    pub status: Status,
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub(crate) enum Status {
    Waiting,
    Loading,
    Ready,
    Error,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum SourceCommand {
    Resolve {
        id: String,
        revision: String,
        data: Value,
    },
    Fail {
        id: String,
        revision: String,
        message: String,
    },
    Retry {
        id: String,
    },
}
