//! Structural transactions are separate from rule evaluation. Stable public
//! handles survive movement; dense graph slots are private traversal indexes.
use super::graph::{FieldId, TriggeredRule};
use super::processor::{
    effects_to_patches, is_value_consequence, is_value_patch, patch_key, ProcessError,
};
use super::Engine;
use crate::compiler::schema_compiler::{build_key_index, cycle_provenance};
use crate::compiler::{CompileError, SchemaCompiler};
use crate::fields::{ConditionOperand, RawField};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, HashMap, HashSet, VecDeque};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct FieldHandle(pub u64);

#[derive(Clone, Debug)]
pub struct FieldRegistration {
    pub handle: Option<FieldHandle>,
    pub field: RawField,
}

impl Engine {
    pub fn field_handle(&self, key: &str) -> Option<FieldHandle> {
        self.key_index.get(key).map(|id| self.handles[*id])
    }

    /// Read public identities without cloning complete field declarations.
    pub fn field_handles(&self) -> impl Iterator<Item = (&str, FieldHandle)> {
        self.raw_fields
            .iter()
            .zip(&self.handles)
            .map(|(field, handle)| (field.key.as_str(), *handle))
    }

    pub fn registrations(&self) -> Vec<FieldRegistration> {
        self.raw_fields
            .iter()
            .cloned()
            .zip(&self.handles)
            .map(|(field, handle)| FieldRegistration {
                handle: Some(*handle),
                field,
            })
            .collect()
    }

    pub fn add_fields(
        &mut self,
        compiler: &SchemaCompiler,
        fields: Vec<RawField>,
    ) -> Result<Vec<FieldHandle>, String> {
        let old = self.handles.len();
        let mut declarations = self.registrations();
        declarations.extend(fields.into_iter().map(|field| FieldRegistration {
            handle: None,
            field,
        }));
        self.update_structure(compiler, declarations)?;
        Ok(self.handles[old..].to_vec())
    }

    pub fn remove_fields(
        &mut self,
        compiler: &SchemaCompiler,
        handles: &[FieldHandle],
    ) -> Result<(), String> {
        if handles.iter().any(|handle| !self.handles.contains(handle)) {
            return Err("tg_schema_unknown_or_stale_field_handle".into());
        }
        let remove: HashSet<_> = handles.iter().copied().collect();
        let declarations = self
            .registrations()
            .into_iter()
            .filter(|d| !remove.contains(&d.handle.unwrap()))
            .collect();
        self.update_structure(compiler, declarations)
    }

    pub fn reorder_fields(
        &mut self,
        compiler: &SchemaCompiler,
        handles: &[FieldHandle],
    ) -> Result<(), String> {
        if handles.len() != self.handles.len() {
            return Err("tg_schema_reorder_must_include_every_field_handle_once".into());
        }
        let mut declarations: HashMap<_, _> = self
            .registrations()
            .into_iter()
            .map(|d| (d.handle.unwrap(), d))
            .collect();
        let ordered = handles
            .iter()
            .map(|handle| {
                declarations
                    .remove(handle)
                    .ok_or_else(|| "tg_schema_unknown_duplicate_or_stale_field_handle".to_string())
            })
            .collect::<Result<Vec<_>, _>>()?;
        self.update_structure(compiler, ordered)
    }

    /// Atomically add/remove/order/rebind declarations. Existing field behavior
    /// is reused; surviving state is moved, never reconstructed or deep-cloned.
    /// Only new fields compile and changed rule owners replace graph edges.
    pub fn update_structure(
        &mut self,
        compiler: &SchemaCompiler,
        declarations: Vec<FieldRegistration>,
    ) -> Result<(), String> {
        let old_ids: HashMap<_, _> = self
            .handles
            .iter()
            .enumerate()
            .map(|(id, handle)| (*handle, id))
            .collect();
        let mut seen = HashSet::new();
        let mut next_handle = self.next_handle;
        let mut handles = Vec::new();
        let mut fields = Vec::new();
        let mut remap = vec![None; self.fields.len()];
        let raw: Vec<_> = declarations.iter().map(|d| d.field.clone()).collect();
        let key_index = build_key_index(&raw).map_err(|e| e.to_string())?;
        for (new_id, declaration) in declarations.iter().enumerate() {
            if let Some(handle) = declaration.handle {
                let old_id = *old_ids
                    .get(&handle)
                    .ok_or("tg_schema_unknown_or_stale_field_handle")?;
                if !seen.insert(handle) {
                    return Err("tg_schema_duplicate_field_handle".into());
                }
                let mut old = self.raw_fields[old_id].clone();
                old.key = declaration.field.key.clone();
                old.rules = declaration.field.rules.clone();
                old.view = declaration.field.view.clone();
                if let Some(bindings) = declaration.field.configuration.get("bindings") {
                    old.configuration
                        .insert("bindings".into(), bindings.clone());
                }
                if old != declaration.field {
                    return Err(
                        "tg_schema_surviving_field_configuration_cannot_change_in_a_structural_operation"
                            .into(),
                    );
                }
                let mut field = if self.raw_fields[old_id]
                    .rules
                    .iter()
                    .map(|rule| &rule.then)
                    .eq(declaration.field.rules.iter().map(|rule| &rule.then))
                {
                    self.fields[old_id].clone()
                } else {
                    crate::fields::CompiledField::new(
                        &declaration.field,
                        self.fields[old_id].behavior_arc(),
                    )
                    .map_err(|error| error.to_string())?
                };
                field.rebind(&declaration.field);
                fields.push(field);
                handles.push(handle);
                remap[old_id] = Some(new_id);
            } else {
                let mut added = compiler
                    .compile_fields(std::slice::from_ref(&declaration.field))
                    .map_err(|e| e.to_string())?;
                fields.push(added.remove(0));
                handles.push(FieldHandle(next_handle));
                next_handle = next_handle
                    .checked_add(1)
                    .ok_or("tg_schema_field_handle_limit_exceeded")?;
            }
        }
        compiler
            .compile_conditions(&mut fields, &key_index)
            .map_err(|e| e.to_string())?;
        let mut changed = HashSet::new();
        for target in 0..fields.len() {
            let Some(&old_id) = old_ids.get(&handles[target]) else {
                changed.insert(target);
                continue;
            };
            let old_rules = &self.fields[old_id].common().rules;
            let new_rules = &fields[target].common().rules;
            let old_binding = |key: &str| self.key_index.get(key).map(|id| self.handles[*id]);
            let new_binding = |key: &str| key_index.get(key).map(|id| handles[*id]);
            let same = old_rules.len() == new_rules.len()
                && old_rules.iter().zip(new_rules).all(|(a, b)| {
                    a.then == b.then
                        && a.when.operation == b.when.operation
                        && old_binding(&a.when.property) == new_binding(&b.when.property)
                        && match (&a.when.value, &b.when.value) {
                            (
                                ConditionOperand::Ref { r#ref: a },
                                ConditionOperand::Ref { r#ref: b },
                            ) => old_binding(a) == new_binding(b),
                            (a, b) => a == b,
                        }
                });
            if !same {
                changed.insert(target);
            }
        }
        let trigger = self
            .trigger_index
            .update(&fields, &key_index, &remap, &changed)
            .map_err(|e| {
                crate::messages::diagnostic(
                    "tg_schema_unknown_reference",
                    serde_json::json!({"p0": e.referenced_key}),
                )
            })?;
        let graph = self
            .value_graph
            .update(&fields, &key_index, &remap, &changed)
            .map_err(|e| {
                crate::messages::diagnostic(
                    "tg_schema_unknown_reference",
                    serde_json::json!({"p0": e.referenced_key}),
                )
            })?;
        if let Some(cycle) = graph.first_cycle() {
            return Err(CompileError::ValueCycle {
                path: cycle
                    .path
                    .iter()
                    .map(|id| fields[*id].common().key.clone())
                    .collect(),
                provenance: cycle
                    .origins
                    .iter()
                    .map(|origin| cycle_provenance(&fields, origin))
                    .collect(),
            }
            .to_string());
        }
        let order = graph.initialization_order();
        let old_dirty = self.dirty.clone();
        // Touch only added, removed and renamed state entries. Unchanged keys
        // keep their existing entries, including isolated fields with no rules.
        let mut removed_states = BTreeMap::new();
        for (old_id, new_id) in remap.iter().enumerate() {
            if new_id.is_none() {
                let key = self.raw_fields[old_id].key.clone();
                removed_states.insert(
                    key.clone(),
                    self.form.fields.remove(&key).expect("installed state"),
                );
            }
        }
        let mut renames = Vec::new();
        let mut moving_states = Vec::new();
        let mut added_keys = Vec::new();
        for (id, field) in fields.iter().enumerate() {
            let new_key = field.common().key.clone();
            if let Some(old_id) = old_ids.get(&handles[id]) {
                let old_key = &self.raw_fields[*old_id].key;
                if old_key != &new_key {
                    moving_states.push((
                        new_key.clone(),
                        self.form.fields.remove(old_key).expect("installed state"),
                    ));
                    renames.push((old_key.clone(), new_key));
                }
            } else {
                added_keys.push(new_key);
            }
        }
        for (key, state) in moving_states {
            self.form.fields.insert(key, state);
        }
        for key in &added_keys {
            let field = &fields[key_index[key]];
            let state = super::runtime::FormState::from_fields(std::slice::from_ref(field))
                .fields
                .remove(key)
                .unwrap();
            self.form.fields.insert(key.clone(), state);
        }
        let old_fields = std::mem::replace(&mut self.fields, fields);
        let old_raw = std::mem::replace(&mut self.raw_fields, raw);
        let old_keys = std::mem::replace(&mut self.key_index, key_index);
        let old_trigger = std::mem::replace(&mut self.trigger_index, trigger);
        let old_graph = std::mem::replace(&mut self.value_graph, graph);
        let old_order = std::mem::replace(&mut self.initialization_order, order);
        let old_handles = std::mem::replace(&mut self.handles, handles);
        let old_sources = self.sources.clone();
        self.operation_steps.set(0);
        self.value_writes.clear();
        let warning_count = self.warnings.len();
        self.journal = Some(BTreeMap::new());
        let result = self.rebuild_sources().and_then(|_| {
            self.refresh_sources(true);
            self.evaluate_structure(&changed).map_err(|e| e.to_string())
        });
        let journal = self.journal.take().unwrap();
        if let Err(error) = result {
            self.warnings.truncate(warning_count);
            self.dirty = old_dirty;
            for (key, state) in journal {
                self.form.fields.insert(key, state);
            }
            for key in added_keys {
                self.form.fields.remove(&key);
            }
            let moving_states = renames
                .into_iter()
                .map(|(old, new)| (old, self.form.fields.remove(&new).expect("renamed state")))
                .collect::<Vec<_>>();
            for (key, state) in moving_states {
                self.form.fields.insert(key, state);
            }
            self.form.fields.extend(removed_states);
            self.fields = old_fields;
            self.raw_fields = old_raw;
            self.key_index = old_keys;
            self.trigger_index = old_trigger;
            self.value_graph = old_graph;
            self.initialization_order = old_order;
            self.handles = old_handles;
            self.sources = old_sources;
            return Err(error);
        }
        self.next_handle = next_handle;
        Ok(())
    }

    /// Structural seeding uses the same bounded queue and comparisons as loading.
    /// Value predecessors settle before observers see the new graph snapshot.
    pub(super) fn evaluate_structure(
        &mut self,
        targets: &std::collections::HashSet<FieldId>,
    ) -> Result<(), ProcessError> {
        if targets.is_empty() {
            return Ok(());
        }
        let mut changed_values = std::collections::BTreeSet::new();
        let mut scheduled = vec![false; self.fields.len()];
        let mut steps = 0;
        for (target, selected) in scheduled.iter_mut().enumerate() {
            if !targets.contains(&target) {
                continue;
            }
            *selected = true;
            let key = self.fields[target].common().key.clone();
            let common = self.fields[target].common();
            if self.form.fields[&key].hidden != common.hidden
                || self.form.fields[&key].behavior_errors() != common.initial_behavior_errors
            {
                self.record_state(&key);
                let state = self.form.fields.get_mut(&key).unwrap();
                state.hidden = self.fields[target].common().hidden;
                state.set_behavior_errors(
                    self.fields[target].common().initial_behavior_errors.clone(),
                );
            }
        }
        for index in 0..self.initialization_order.len() {
            let target = self.initialization_order[index];
            if !scheduled[target] {
                continue;
            }
            let mut queue = VecDeque::new();
            for rule_index in 0..self.fields[target].common().rules.len() {
                let rule = &self.fields[target].common().rules[rule_index];
                if !rule.then.iter().any(is_value_consequence) {
                    continue;
                }
                self.charge_step(&mut steps)?;
                if self.evaluate_rule(TriggeredRule { target, rule_index }, rule)? {
                    queue.extend(
                        effects_to_patches(&self.fields[target].common().key, &rule.then)
                            .into_iter()
                            .filter(is_value_patch),
                    );
                }
            }
            let patches = self.process_queue(queue, false, &mut changed_values, &mut steps)?;
            for patch in patches {
                let source = self.field_id(patch_key(&patch))?;
                for location in self.trigger_index.rules_for(source) {
                    scheduled[location.target] = true;
                }
            }
        }
        for (target, selected) in scheduled.iter().enumerate() {
            if !selected {
                continue;
            }
            for rule_index in 0..self.fields[target].common().rules.len() {
                let rule = &self.fields[target].common().rules[rule_index];
                if rule.then.iter().all(is_value_consequence) {
                    continue;
                }
                self.charge_step(&mut steps)?;
                if self.evaluate_rule(TriggeredRule { target, rule_index }, rule)? {
                    let patches = effects_to_patches(&self.fields[target].common().key, &rule.then);
                    for patch in patches.into_iter().filter(|patch| !is_value_patch(patch)) {
                        self.charge_step(&mut steps)?;
                        self.apply_patch(target, &patch);
                    }
                }
            }
        }
        self.validate_changed_fields(&changed_values);
        for (target, selected) in scheduled.iter().enumerate() {
            if *selected && !changed_values.contains(&target) {
                self.validate_field(target);
            }
        }
        Ok(())
    }

    pub(super) fn record_state(&mut self, key: &str) {
        self.dirty.insert(key.to_string());
        if let Some(journal) = &mut self.journal {
            if !journal.contains_key(key) {
                journal.insert(key.to_string(), self.form.fields[key].clone());
            }
        }
    }
}
