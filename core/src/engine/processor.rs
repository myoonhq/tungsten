use std::collections::VecDeque;
use std::error::Error;
use std::fmt::{Display, Formatter};

use super::graph::{FieldId, TriggeredRule};
use super::patch::Patch;
use super::runtime::{FormState, FormValues, RuntimeFieldState};
use super::Engine;
use crate::fields::{ConditionOperand, Consequence, FieldValueError, Rule};
use crate::types::ScalarValue;
use crate::{log, utils::now_ms};

impl Engine {
    /// Applies one external patch, propagates value effects to stability, then
    /// validates exactly the fields whose values changed.
    pub fn process_patch(&mut self, incoming_patch: Patch) -> Result<Vec<Patch>, ProcessError> {
        let started = now_ms();
        let incoming_patch = self.normalize_patch(incoming_patch)?;
        let processed = self.transaction(|engine| {
            let queue = VecDeque::from([incoming_patch]);
            let mut changed_values = std::collections::BTreeSet::new();
            let mut steps = 0usize;
            let processed = engine.process_queue(queue, true, &mut changed_values, &mut steps)?;
            engine.validate_changed_fields(&changed_values);
            // Visibility changes can restore eligibility even without a value edit.
            for patch in &processed {
                if let Patch::SetHidden { key, .. } = patch {
                    engine.validate_field(engine.field_id(key)?);
                }
            }
            engine.refresh_sources(false);
            Ok(processed)
        })?;

        log!(
            "process_patch done: {} patches in {:?}",
            processed.len(),
            now_ms() - started
        );

        Ok(processed)
    }

    /// Replace meaningful data after initialization, then derive and validate state.
    /// Missing keys use schema/type defaults; an explicit null remains a value.
    /// Failed normalization or evaluation leaves the previous state installed.
    pub fn load_values(&mut self, values: Option<&FormValues>) -> Result<bool, ProcessError> {
        let mut candidate = FormState::from_fields(&self.fields);
        for (key, state) in &mut candidate.fields {
            let old = &self.form.fields[key];
            state.loading_sources = old.loading_sources.clone();
            state.unresolved = old.unresolved;
            state.options = old.options.clone().or_else(|| {
                self.raw_fields[self.key_index[key]]
                    .configuration
                    .get("options")
                    .and_then(|v| crate::fields::select::options(v.clone()).ok())
            });
        }
        if let Some(values) = values {
            for (key, value) in values {
                let id = self.field_id(key)?;
                let value = self.fields[id].normalize_value(value).map_err(|source| {
                    ProcessError::InvalidValue {
                        field_key: key.clone(),
                        source,
                    }
                })?;
                candidate
                    .fields
                    .get_mut(key)
                    .expect("compiled field state")
                    .value = value;
            }
        }

        let previous = std::mem::replace(&mut self.form, candidate);
        let result = self.transaction(|engine| engine.evaluate_loaded_values());
        if result.is_err() {
            self.form = previous;
        }
        if result.is_ok() {
            self.refresh_sources(true);
        }
        result
    }

    fn evaluate_loaded_values(&mut self) -> Result<bool, ProcessError> {
        let mut changed_values = std::collections::BTreeSet::new();
        let mut steps = 0;
        // All input values are already populated. Seed value-writing rules even
        // when no value patch changed, with dependencies before their targets.
        for index in 0..self.initialization_order.len() {
            let target = self.initialization_order[index];
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
            self.process_queue(queue, false, &mut changed_values, &mut steps)?;
        }

        // Derive presentation/error properties from stabilized values, rather
        // than retaining effects of transient values encountered while loading.
        for target in 0..self.fields.len() {
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
        Ok(self.validate_all())
    }

    pub(super) fn charge_step(&self, steps: &mut usize) -> Result<(), ProcessError> {
        let used = if self.journal.is_some() {
            self.operation_steps.get()
        } else {
            *steps
        };
        if used >= self.processing_limit {
            return Err(ProcessError::ProcessingLimitExceeded {
                limit: self.processing_limit,
            });
        }
        *steps += 1;
        if self.journal.is_some() {
            self.operation_steps.set(used + 1);
        }
        Ok(())
    }

    pub(super) fn process_queue(
        &mut self,
        mut queue: VecDeque<Patch>,
        propagate_rules: bool,
        changed_values: &mut std::collections::BTreeSet<FieldId>,
        steps: &mut usize,
    ) -> Result<Vec<Patch>, ProcessError> {
        let mut processed = Vec::new();
        while let Some(patch) = queue.pop_front() {
            self.charge_step(steps)?;
            let field_id = self.field_id(patch_key(&patch))?;
            let patch = self.normalize_generated_patch(field_id, patch)?;
            if !self.apply_patch(field_id, &patch) {
                continue;
            }
            if is_value_patch(&patch) {
                changed_values.insert(field_id);
                if propagate_rules {
                    queue.extend(self.evaluate_triggered_rules(field_id)?);
                }
            }
            processed.push(patch);
        }
        Ok(processed)
    }

    /// Validates the current value of every field in schema order.
    ///
    /// This is intended for boundaries such as form submission, where untouched
    /// fields must be checked without fabricating value patches. Rule-generated
    /// behavior errors remain separate internally and contribute to the combined
    /// public validity result.
    pub fn validate_all(&mut self) -> bool {
        for field_id in 0..self.fields.len() {
            self.validate_field(field_id);
        }

        self.form
            .fields
            .values()
            .all(super::runtime::RuntimeFieldState::valid)
    }

    fn normalize_patch(&self, patch: Patch) -> Result<Patch, ProcessError> {
        let key = patch_key(&patch);
        let field_id = self.field_id(key)?;

        match patch {
            Patch::SetValue { key, value } => {
                let value = self.fields[field_id]
                    .normalize_value(&value)
                    .map_err(|source| ProcessError::InvalidValue {
                        field_key: key.clone(),
                        source,
                    })?;
                Ok(Patch::SetValue { key, value })
            }
            Patch::ClearValue { key } => {
                self.fields[field_id]
                    .normalize_value(&ScalarValue::Null)
                    .map_err(|source| ProcessError::InvalidValue {
                        field_key: key.clone(),
                        source,
                    })?;
                Ok(Patch::ClearValue { key })
            }
            Patch::SetHidden { .. } | Patch::SetErrors { .. } => Ok(patch),
        }
    }

    fn normalize_generated_patch(
        &self,
        field_id: FieldId,
        patch: Patch,
    ) -> Result<Patch, ProcessError> {
        match patch {
            Patch::SetValue { key, value } => {
                let value = self.fields[field_id]
                    .normalize_value(&value)
                    .map_err(|source| ProcessError::InvalidGeneratedValue {
                        field_key: key.clone(),
                        source,
                    })?;
                Ok(Patch::SetValue { key, value })
            }
            Patch::ClearValue { key } => {
                self.fields[field_id]
                    .normalize_value(&ScalarValue::Null)
                    .map_err(|source| ProcessError::InvalidGeneratedValue {
                        field_key: key.clone(),
                        source,
                    })?;
                Ok(Patch::ClearValue { key })
            }
            Patch::SetHidden { .. } | Patch::SetErrors { .. } => Ok(patch),
        }
    }

    pub(super) fn field_id(&self, key: &str) -> Result<FieldId, ProcessError> {
        self.key_index
            .get(key)
            .copied()
            .ok_or_else(|| ProcessError::UnknownFieldKey {
                field_key: key.to_string(),
            })
    }

    pub(super) fn apply_patch(&mut self, field_id: FieldId, patch: &Patch) -> bool {
        let key = self.fields[field_id].common().key.clone();
        let old = &self.form.fields[&key];
        let cleared = if matches!(patch, Patch::ClearValue { .. }) {
            Some(
                self.fields[field_id]
                    .normalize_value(&ScalarValue::Null)
                    .expect("clear patch was normalized"),
            )
        } else {
            None
        };
        let changed = match patch {
            Patch::SetValue { value, .. } => !self.fields[field_id].values_equal(&old.value, value),
            Patch::SetHidden { hidden, .. } => old.hidden != *hidden,
            Patch::SetErrors { errors, .. } => old.behavior_errors() != errors,
            Patch::ClearValue { .. } => {
                !self.fields[field_id].values_equal(&old.value, cleared.as_ref().unwrap())
            }
        };
        if !changed {
            return false;
        }
        self.record_state(&key);
        if is_value_patch(patch) {
            let count = self.value_writes.entry(field_id).or_default();
            *count += 1;
            if *count == 2 {
                self.warnings.push(
                    crate::messages::Message::new("tg_warning_multiple_value_writes")
                        .with_params(serde_json::json!({"fieldKey":key})),
                );
            }
        }
        let state = self
            .form
            .fields
            .get_mut(&key)
            .expect("compiled field state");
        match patch {
            Patch::SetValue { value, .. } => state.value = value.clone(),
            Patch::SetHidden { hidden, .. } => state.hidden = *hidden,
            Patch::SetErrors { errors, .. } => {
                state.set_behavior_errors(errors.clone());
            }
            Patch::ClearValue { .. } => state.value = cleared.unwrap(),
        }
        if is_value_patch(patch) && matches!(state.value, ScalarValue::Files(_)) {
            // A corrected attachment selection must not retain a previous upload failure.
            state.upload_error = None;
        }
        true
    }

    pub(super) fn evaluate_triggered_rules(
        &self,
        source: FieldId,
    ) -> Result<Vec<Patch>, ProcessError> {
        let mut patches = Vec::new();

        for &location in self.trigger_index.rules_for(source) {
            let rule = &self.fields[location.target].common().rules[location.rule_index];

            if self.evaluate_rule(location, rule)? {
                patches.extend(effects_to_patches(
                    &self.fields[location.target].common().key,
                    &rule.then,
                ));
            }
        }

        Ok(patches)
    }

    pub(super) fn evaluate_rule(
        &self,
        location: TriggeredRule,
        rule: &Rule,
    ) -> Result<bool, ProcessError> {
        let left_id = self.field_id(&rule.when.property)?;
        let left = self.state_for(left_id);
        if left.unresolved || !left.loading_sources.is_empty() || !left.source_errors.is_empty() {
            return Ok(false);
        }

        let right = match &rule.when.value {
            ConditionOperand::Value(value) => value,
            ConditionOperand::Ref { r#ref } => {
                let right_id = self.field_id(r#ref)?;
                let right = self.state_for(right_id);
                if right.unresolved
                    || !right.loading_sources.is_empty()
                    || !right.source_errors.is_empty()
                {
                    return Ok(false);
                }
                &self.state_for(right_id).value
            }
        };

        self.fields[left_id]
            .compare(&left.value, rule.when.operation, right)
            .map_err(|source| ProcessError::ComparisonFailed {
                field_key: self.fields[left_id].common().key.clone(),
                target_field_key: self.fields[location.target].common().key.clone(),
                rule_index: location.rule_index,
                source,
            })
    }

    fn state_for(&self, field_id: FieldId) -> &RuntimeFieldState {
        self.form
            .fields
            .get(&self.fields[field_id].common().key)
            .expect("compiled fields and runtime state must stay aligned")
    }

    pub(super) fn validate_changed_fields(
        &mut self,
        changed_values: &std::collections::BTreeSet<FieldId>,
    ) {
        for &field_id in changed_values {
            self.validate_field(field_id);
        }
    }

    pub(super) fn validate_field(&mut self, field_id: FieldId) {
        let key = self.fields[field_id].common().key.clone();
        let value = self
            .form
            .fields
            .get(&key)
            .expect("compiled fields and runtime state must stay aligned")
            .value
            .clone();
        if !self.form.fields[&key].eligible() {
            if !self.form.fields[&key].validation_errors().is_empty() {
                self.record_state(&key);
                self.form
                    .fields
                    .get_mut(&key)
                    .unwrap()
                    .set_validation_errors(vec![]);
            }
            return;
        }
        let mut errors = if self.form.fields[&key].unresolved
            || !self.form.fields[&key].loading_sources.is_empty()
        {
            vec![]
        } else {
            self.fields[field_id].validate(&value)
        };
        let state = &self.form.fields[&key];
        if state.loading_sources.is_empty() && state.source_errors.is_empty() {
            if let Some(options) = &state.options {
                let missing = match &value {
                    ScalarValue::String(value) => {
                        !value.is_empty()
                            && !options
                                .iter()
                                .any(|o| o.value.as_str() == Some(value.as_str()))
                    }
                    ScalarValue::Strings(values) => values.iter().any(|value| {
                        !options
                            .iter()
                            .any(|o| o.value.as_str() == Some(value.as_str()))
                    }),
                    ScalarValue::Bool(value) => !options
                        .iter()
                        .any(|o| o.value == crate::fields::select::ChoiceValue::Bool(*value)),
                    _ => false,
                };
                if missing {
                    errors.push(crate::fields::ValidationError::new(
                        "tg_validation_option",
                        "tg_validation_option",
                    ));
                }
            }
        }

        if self.form.fields[&key].validation_errors() != errors {
            self.record_state(&key);
            self.form
                .fields
                .get_mut(&key)
                .expect("compiled state")
                .set_validation_errors(errors);
        }
    }
}

pub(super) fn effects_to_patches(target_key: &str, effects: &[Consequence]) -> Vec<Patch> {
    effects
        .iter()
        .map(|effect| match effect {
            Consequence::SetValue { value } => Patch::SetValue {
                key: target_key.to_string(),
                value: value.clone(),
            },
            Consequence::SetHidden { hidden } => Patch::SetHidden {
                key: target_key.to_string(),
                hidden: *hidden,
            },
            Consequence::Show => Patch::SetHidden {
                key: target_key.to_string(),
                hidden: false,
            },
            Consequence::SetErrors { errors } => Patch::SetErrors {
                key: target_key.to_string(),
                errors: errors.clone(),
            },
            Consequence::ClearValue => Patch::ClearValue {
                key: target_key.to_string(),
            },
        })
        .collect()
}

pub(super) fn is_value_consequence(effect: &Consequence) -> bool {
    matches!(
        effect,
        Consequence::SetValue { .. } | Consequence::ClearValue
    )
}

pub(super) fn is_value_patch(patch: &Patch) -> bool {
    matches!(patch, Patch::SetValue { .. } | Patch::ClearValue { .. })
}

pub(super) fn patch_key(patch: &Patch) -> &str {
    match patch {
        Patch::SetValue { key, .. }
        | Patch::SetHidden { key, .. }
        | Patch::SetErrors { key, .. }
        | Patch::ClearValue { key } => key,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ProcessError {
    UnknownFieldKey {
        field_key: String,
    },
    InvalidValue {
        field_key: String,
        source: FieldValueError,
    },
    InvalidGeneratedValue {
        field_key: String,
        source: FieldValueError,
    },
    ComparisonFailed {
        field_key: String,
        target_field_key: String,
        rule_index: usize,
        source: FieldValueError,
    },
    ProcessingLimitExceeded {
        limit: usize,
    },
}

impl Display for ProcessError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnknownFieldKey { field_key } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_unknown_field_key",
                        serde_json::json!({"field_key": field_key})
                    )
                )
            }
            Self::InvalidValue { field_key, source } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_invalid_value_for_field",
                        serde_json::json!({"field_key": field_key, "source": (source).to_string()})
                    )
                )
            }
            Self::InvalidGeneratedValue { field_key, source } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_compiled_rule_generated_an_invalid_value_for_field",
                        serde_json::json!({"field_key": field_key, "source": (source).to_string()})
                    )
                )
            }
            Self::ComparisonFailed {
                field_key,
                target_field_key,
                rule_index,
                source,
            } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_failed_to_evaluate_field_rule_against",
                        serde_json::json!({"target_field_key": target_field_key, "rule_index": rule_index, "field_key": field_key, "source": (source).to_string()})
                    )
                )
            }
            Self::ProcessingLimitExceeded { limit } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_patch_processing_exceeded_safety_limit",
                        serde_json::json!({"limit": limit})
                    )
                )
            }
        }
    }
}

impl Error for ProcessError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::InvalidValue { source, .. }
            | Self::InvalidGeneratedValue { source, .. }
            | Self::ComparisonFailed { source, .. } => Some(source),
            _ => None,
        }
    }
}
