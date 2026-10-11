use std::collections::HashMap;

use super::value_graph::ValueGraph;
use crate::engine::graph::{FieldId, TriggerIndex};
use crate::engine::runtime::FormState;
use crate::fields::{CompiledField, RawField};
use crate::schema::RawSchema;

/// Immutable output of schema compilation.
///
/// Raw descriptors remain separate from trait-backed fields so JSON/WASM
/// boundaries never need to serialize runtime behavior objects.
#[derive(Clone, Debug)]
pub struct CompiledSchema {
    pub(crate) raw_schema: RawSchema,
    pub(crate) raw_fields: Vec<RawField>,
    pub(crate) field_paths: Vec<String>,
    pub(crate) fields: Vec<CompiledField>,
    pub(crate) key_index: HashMap<String, FieldId>,
    pub(crate) initial_state: FormState,
    pub(crate) trigger_index: TriggerIndex,
    pub(crate) value_graph: ValueGraph,
}

impl CompiledSchema {
    // Compilation produces these aligned indexes together; keep that boundary explicit.
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        raw_schema: RawSchema,
        raw_fields: Vec<RawField>,
        field_paths: Vec<String>,
        fields: Vec<CompiledField>,
        key_index: HashMap<String, FieldId>,
        initial_state: FormState,
        trigger_index: TriggerIndex,
        value_graph: ValueGraph,
    ) -> Self {
        Self {
            raw_schema,
            raw_fields,
            field_paths,
            fields,
            key_index,
            initial_state,
            trigger_index,
            value_graph,
        }
    }

    pub fn schema(&self) -> &RawSchema {
        &self.raw_schema
    }

    pub fn raw_fields(&self) -> &[RawField] {
        &self.raw_fields
    }

    /// Source tree location for a deterministic expanded field ID.
    pub fn field_path(&self, field_id: FieldId) -> Option<&str> {
        self.field_paths.get(field_id).map(String::as_str)
    }

    pub fn fields(&self) -> &[CompiledField] {
        &self.fields
    }

    pub fn state(&self) -> &FormState {
        &self.initial_state
    }

    pub fn graph(&self) -> &TriggerIndex {
        &self.trigger_index
    }

    pub fn value_graph(&self) -> &ValueGraph {
        &self.value_graph
    }

    pub fn field_id(&self, key: &str) -> Option<FieldId> {
        self.key_index.get(key).copied()
    }
}
