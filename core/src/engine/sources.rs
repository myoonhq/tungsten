use super::{patch::Patch, Engine};
use crate::fields::ConditionOperand;
use crate::sources::{bindings, Entry, Input, SourceCommand, SourceEffect, Status};
use crate::ScalarValue;
use std::collections::{BTreeMap, BTreeSet, VecDeque};

impl Engine {
    pub fn seed_source_values(&mut self, values: &super::runtime::FormValues) {
        self.sources.seeded = values
            .keys()
            .filter_map(|key| self.field_handle(key).map(|h| h.0))
            .collect();
    }
    pub fn source_registry(&self) -> BTreeSet<String> {
        self.sources.registry.clone()
    }
    pub fn configure_sources(&mut self, registry: BTreeSet<String>) -> Result<(), String> {
        let previous = std::mem::replace(&mut self.sources.registry, registry);
        if let Err(error) = self.rebuild_sources() {
            self.sources.registry = previous;
            return Err(error);
        }
        for entry in self.sources.entries.values() {
            if entry.slot == "value" && entry.status != Status::Ready {
                self.form.fields.get_mut(&entry.key).unwrap().unresolved = true;
            }
        }
        self.refresh_sources(true);
        Ok(())
    }
    pub(crate) fn rebuild_sources(&mut self) -> Result<(), String> {
        let mut entries = BTreeMap::new();
        let mut inputs: BTreeMap<String, Vec<String>> = BTreeMap::new();
        let mut edges: BTreeMap<String, Vec<String>> = BTreeMap::new();
        for (field_id, raw) in self.raw_fields.iter().enumerate() {
            for rule in &raw.rules {
                if rule.then.iter().any(super::processor::is_value_consequence) {
                    edges
                        .entry(rule.when.property.clone())
                        .or_default()
                        .push(raw.key.clone());
                    if let ConditionOperand::Ref { r#ref } = &rule.when.value {
                        edges
                            .entry(r#ref.clone())
                            .or_default()
                            .push(raw.key.clone());
                    }
                }
            }
            for (slot, binding) in bindings(raw)? {
                let seeded = slot == "value"
                    && binding.apply.as_deref() != Some("live")
                    && self.sources.seeded.contains(&self.handles[field_id].0);
                if !self.sources.registry.contains(&binding.source) {
                    return Err(crate::messages::diagnostic(
                        "tg_source_unknown_data_source_on",
                        serde_json::json!({"p0": binding.source, "p1": raw.key}),
                    ));
                }
                let id = format!("{}:{slot}", self.handles[field_id].0);
                for input in binding.params.values() {
                    if let Input::Ref { r#ref } = input {
                        if !self.key_index.contains_key(r#ref) {
                            return Err(crate::messages::diagnostic(
                                "tg_schema_unknown_source_input",
                                serde_json::json!({"ref": r#ref}),
                            ));
                        }
                        if !seeded {
                            inputs.entry(r#ref.clone()).or_default().push(id.clone());
                        }
                        // Loaded options can clear a selection, so they also write values.
                        edges
                            .entry(r#ref.clone())
                            .or_default()
                            .push(raw.key.clone());
                    }
                }
                if seeded {
                    continue;
                }
                let previous = self.sources.entries.get(&id);
                let mut entry = previous
                    .filter(|e| e.binding.source == binding.source && e.slot == slot)
                    .cloned()
                    .unwrap_or(Entry {
                        key: raw.key.clone(),
                        slot: slot.clone(),
                        binding: binding.clone(),
                        params: None,
                        revision: 0,
                        status: Status::Waiting,
                    });
                // Concrete paths can change when rows move. Invalidate positional requests.
                if (entry.binding != binding || entry.key != raw.key)
                    && !(entry.slot == "value"
                        && entry.binding.apply.as_deref() != Some("live")
                        && entry.status == Status::Ready)
                {
                    entry.status = Status::Waiting;
                    entry.params = None;
                }
                entry.key = raw.key.clone();
                entry.binding = binding;
                entries.insert(id, entry);
            }
        }
        let mut indegrees: BTreeMap<String, usize> =
            self.key_index.keys().map(|key| (key.clone(), 0)).collect();
        for targets in edges.values() {
            for target in targets {
                *indegrees.get_mut(target).unwrap() += 1;
            }
        }
        let mut queue: VecDeque<_> = indegrees
            .iter()
            .filter(|(_, n)| **n == 0)
            .map(|(key, _)| key.clone())
            .collect();
        let mut count = 0;
        while let Some(key) = queue.pop_front() {
            count += 1;
            for target in edges.get(&key).into_iter().flatten() {
                let n = indegrees.get_mut(target).unwrap();
                *n -= 1;
                if *n == 0 {
                    queue.push_back(target.clone());
                }
            }
        }
        if count != indegrees.len() {
            return Err("tg_schema_data_source_and_value_rule_dependencies_contain_a_cycle".into());
        }
        self.sources.entries = entries;
        self.sources.inputs = inputs;
        Ok(())
    }
    pub fn source_effects(&mut self) -> Vec<SourceEffect> {
        std::mem::take(&mut self.sources.effects)
            .into_iter()
            .filter(|effect| {
                self.sources.entries.get(&effect.id).is_some_and(|entry| {
                    entry.status == Status::Loading && entry.revision.to_string() == effect.revision
                })
            })
            .collect()
    }
    pub(crate) fn refresh_sources(&mut self, all: bool) {
        let ids: BTreeSet<String> = if all {
            self.sources.entries.keys().cloned().collect()
        } else {
            self.dirty
                .iter()
                .flat_map(|key| self.sources.inputs.get(key).into_iter().flatten().cloned())
                .collect()
        };
        let mut pending: VecDeque<_> = ids.into_iter().collect();
        let mut seen = BTreeSet::new();
        while let Some(id) = pending.pop_front() {
            if !seen.insert(id.clone()) {
                continue;
            }
            let entry = &self.sources.entries[&id];
            if entry.slot == "value"
                && entry.binding.apply.as_deref() != Some("live")
                && entry.status == Status::Ready
            {
                continue;
            }
            let params: Option<BTreeMap<String, ScalarValue>> = entry
                .binding
                .params
                .iter()
                .map(|(name, input)| match input {
                    Input::Literal { value } => Some((name.clone(), value.clone())),
                    Input::Ref { r#ref } => {
                        let state = &self.form.fields[r#ref];
                        (!state.unresolved).then(|| (name.clone(), state.value.clone()))
                    }
                })
                .collect();
            if entry.params == params && entry.status != Status::Waiting {
                continue;
            }
            let key = entry.key.clone();
            let slot = entry.slot.clone();
            self.record_state(&key);
            self.record_source(&id);
            self.sources.next_revision += 1;
            let entry = self.sources.entries.get_mut(&id).unwrap();
            entry.params = params.clone();
            entry.revision = self.sources.next_revision;
            entry.status = if params.is_some() {
                Status::Loading
            } else {
                Status::Waiting
            };
            if let Some(params) = params {
                self.sources.effects.push(SourceEffect {
                    id: id.clone(),
                    source: entry.binding.source.clone(),
                    revision: entry.revision.to_string(),
                    params,
                });
            }
            let field = self.form.fields.get_mut(&key).unwrap();
            field.loading_sources.insert(id.clone());
            field.source_errors.remove(&id);
            field.set_validation_errors(vec![]);
            if slot == "value" {
                field.unresolved = true;
            }
            if let Some(dependents) = self.sources.inputs.get(&key) {
                pending.extend(dependents.iter().cloned());
            }
        }
    }
    fn record_source(&mut self, id: &str) {
        if let Some(journal) = &mut self.source_journal {
            if !journal.contains_key(id) {
                journal.insert(id.into(), self.sources.entries[id].clone());
            }
        }
    }
    pub fn source_command(&mut self, command: SourceCommand) -> Result<bool, String> {
        self.transaction(|engine| engine.source_command_inner(command))
    }
    pub(crate) fn transaction<T, E>(
        &mut self,
        action: impl FnOnce(&mut Self) -> Result<T, E>,
    ) -> Result<T, E> {
        if self.journal.is_some() {
            return action(self);
        }
        let dirty = std::mem::take(&mut self.dirty);
        let warnings = std::mem::take(&mut self.warnings);
        self.value_writes.clear();
        self.operation_steps.set(0);
        let effects = self.sources.effects.len();
        let revision = self.sources.next_revision;
        self.journal = Some(BTreeMap::new());
        self.source_journal = Some(BTreeMap::new());
        let result = action(self);
        let fields = self.journal.take().unwrap();
        let sources = self.source_journal.take().unwrap();
        if result.is_err() {
            self.form.fields.extend(fields);
            self.sources.entries.extend(sources);
            self.sources.effects.truncate(effects);
            self.sources.next_revision = revision;
            self.dirty = dirty;
            self.warnings = warnings;
        } else {
            self.dirty.extend(dirty);
            self.warnings.splice(0..0, warnings);
        }
        result
    }
    fn source_command_inner(&mut self, command: SourceCommand) -> Result<bool, String> {
        let (id, revision) = match &command {
            SourceCommand::Retry { id } => (id.clone(), None),
            SourceCommand::Resolve { id, revision, .. }
            | SourceCommand::Fail { id, revision, .. } => (id.clone(), Some(revision.clone())),
        };
        let Some(entry) = self.sources.entries.get(&id) else {
            return Ok(false);
        };
        if revision
            .as_ref()
            .is_some_and(|r| r != &entry.revision.to_string())
            || (revision.is_some() && entry.status != Status::Loading)
        {
            return Ok(false);
        }
        let key = entry.key.clone();
        let slot = entry.slot.clone();
        self.record_source(&id);
        if let SourceCommand::Retry { .. } = command {
            self.sources.entries.get_mut(&id).unwrap().status = Status::Waiting;
            self.refresh_sources(true);
            return Ok(true);
        }
        let outcome = match command {
            SourceCommand::Fail { message, .. } => Err(message),
            SourceCommand::Resolve { data, .. } if slot == "options" => {
                crate::fields::select::choice_options(
                    data,
                    self.raw_fields[self.key_index[&key]].field_type == "boolean",
                )
                .map(|options| (None, Some(options)))
                .map_err(|e| e.to_string())
            }
            SourceCommand::Resolve { data, .. } => serde_json::from_value::<ScalarValue>(data)
                .map_err(|e| e.to_string())
                .and_then(|value| {
                    self.fields[self.key_index[&key]]
                        .normalize_value(&value)
                        .map_err(|e| e.to_string())
                })
                .map(|v| (Some(v), None)),
            _ => unreachable!(),
        };
        self.record_state(&key);
        let state = self.form.fields.get_mut(&key).unwrap();
        state.loading_sources.remove(&id);
        match outcome {
            Err(message) => {
                self.sources.entries.get_mut(&id).unwrap().status = Status::Error;
                state.source_errors.insert(id, message.into());
            }
            Ok((value, options)) => {
                self.sources.entries.get_mut(&id).unwrap().status = Status::Ready;
                state.source_errors.remove(&id);
                if let Some(options) = options {
                    state.options = Some(options);
                }
                // Keep selections while loading or after a failed request. Successful
                // options are authoritative; reconcile through the normal patch/rule path.
                if value.is_some() {
                    state.unresolved = false;
                }
                let ready_value = value.or_else(|| {
                    (slot == "options" && !state.unresolved).then(|| state.value.clone())
                });
                if let Some(mut value) = ready_value {
                    if state.loading_sources.is_empty() && state.source_errors.is_empty() {
                        if let Some(options) = &state.options {
                            let select_first_option = self.raw_fields[self.key_index[&key]]
                                .configuration
                                .get("selectFirstOption")
                                .and_then(serde_json::Value::as_bool)
                                .unwrap_or(false);
                            value = crate::fields::select::reconcile_value(
                                &value,
                                options,
                                select_first_option,
                            );
                        }
                    }
                    let field_id = self.key_index[&key];
                    let identical = self.fields[field_id].values_equal(&state.value, &value);
                    self.process_patch(Patch::SetValue {
                        key: key.clone(),
                        value,
                    })
                    .map_err(|e| e.to_string())?;
                    if identical {
                        for patch in self
                            .evaluate_triggered_rules(field_id)
                            .map_err(|e| e.to_string())?
                        {
                            self.process_patch(patch).map_err(|e| e.to_string())?;
                        }
                    }
                }
                self.validate_field(self.key_index[&key]);
            }
        }
        self.refresh_sources(false);
        Ok(true)
    }
    pub fn set_upload_state(
        &mut self,
        key: &str,
        loading: bool,
        error: Option<String>,
    ) -> Result<(), String> {
        if !self.key_index.contains_key(key) {
            return Err(crate::messages::diagnostic(
                "tg_source_unknown_field",
                serde_json::json!({"key": key}),
            ));
        }
        self.record_state(key);
        let state = self.form.fields.get_mut(key).unwrap();
        state.uploading = loading;
        state.upload_error = error.map(Into::into);
        Ok(())
    }
    pub fn take_dirty(&mut self) -> BTreeMap<String, super::runtime::RuntimeFieldState> {
        std::mem::take(&mut self.dirty)
            .into_iter()
            .filter_map(|key| {
                self.form
                    .fields
                    .get(&key)
                    .cloned()
                    .map(|value| (key, value))
            })
            .collect()
    }
}
