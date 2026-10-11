pub mod graph;
pub mod patch;
pub mod processor;
pub mod runtime;
mod sources;
pub mod structure;

use std::collections::HashMap;

use crate::compiler::CompiledSchema;
use crate::fields::{CompiledField, RawField};
use crate::schema::RawSchema;
use graph::{FieldId, TriggerIndex};
use runtime::{FormState, RuntimeFieldState};

#[derive(Debug)]
pub struct Engine {
    raw_schema: RawSchema,
    raw_fields: Vec<RawField>,
    fields: Vec<CompiledField>,
    key_index: HashMap<String, FieldId>,
    form: FormState,
    trigger_index: TriggerIndex,
    initialization_order: Vec<FieldId>,
    processing_limit: usize,
    value_graph: crate::compiler::ValueGraph,
    handles: Vec<structure::FieldHandle>,
    next_handle: u64,
    journal: Option<std::collections::BTreeMap<String, RuntimeFieldState>>,
    dirty: std::collections::BTreeSet<String>,
    sources: crate::sources::SourceRuntime,
    source_journal: Option<std::collections::BTreeMap<String, crate::sources::Entry>>,
    operation_steps: std::cell::Cell<usize>,
    value_writes: std::collections::BTreeMap<FieldId, usize>,
    warnings: Vec<crate::messages::Message>,
}

impl Engine {
    pub const DEFAULT_PROCESSING_LIMIT: usize = 100_000;

    pub fn from_compiled(compiled: CompiledSchema) -> Self {
        let initialization_order = compiled.value_graph.initialization_order();
        Self {
            handles: (0..compiled.fields.len())
                .map(|id| structure::FieldHandle(id as u64))
                .collect(),
            next_handle: compiled.fields.len() as u64,
            value_graph: compiled.value_graph,
            journal: None,
            dirty: Default::default(),
            sources: Default::default(),
            source_journal: None,
            operation_steps: std::cell::Cell::new(0),
            value_writes: Default::default(),
            warnings: Default::default(),
            raw_schema: compiled.raw_schema,
            raw_fields: compiled.raw_fields,
            fields: compiled.fields,
            key_index: compiled.key_index,
            form: compiled.initial_state,
            trigger_index: compiled.trigger_index,
            initialization_order,
            processing_limit: Self::DEFAULT_PROCESSING_LIMIT,
        }
    }

    pub fn schema(&self) -> &RawSchema {
        &self.raw_schema
    }

    /// Reloading presentation must not reset data. Any change to the ordered
    /// leaf declarations intentionally establishes a fresh runtime instead.
    pub(crate) fn preserves_state_for(&self, compiled: &CompiledSchema) -> bool {
        self.raw_fields == compiled.raw_fields
    }

    pub fn reload(&mut self, compiled: CompiledSchema) {
        if self.preserves_state_for(&compiled) {
            self.raw_schema = compiled.raw_schema;
        } else {
            *self = Self::from_compiled(compiled);
        }
    }

    pub(crate) fn set_repeaters(
        &mut self,
        repeaters: std::collections::BTreeMap<String, crate::repeaters::RepeaterState>,
    ) {
        self.form.repeaters = repeaters;
    }

    pub fn state(&self) -> &FormState {
        &self.form
    }

    pub fn graph(&self) -> &TriggerIndex {
        &self.trigger_index
    }

    pub fn field_state(&self, key: &str) -> Option<&RuntimeFieldState> {
        self.form.fields.get(key)
    }

    pub fn take_warnings(&mut self) -> Vec<crate::messages::Message> {
        std::mem::take(&mut self.warnings)
    }

    pub fn processing_limit(&self) -> usize {
        self.processing_limit
    }

    pub fn set_processing_limit(&mut self, limit: usize) {
        self.processing_limit = limit;
    }
}
