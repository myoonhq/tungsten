use std::cmp::Ordering;
use std::fmt::Debug;
use std::sync::Arc;

use super::common::{Consequence, FieldView, Operation, Rule};
use super::errors::{FieldCompileError, FieldValueError, ValidationError};
use super::raw::RawField;
use crate::types::ScalarValue;

/// Object-safe runtime semantics for one compiled field.
///
/// Defaults cover fields that accept arbitrary scalar values and only need
/// equality comparisons. Concrete fields override only their type,
/// normalization, ordering, or validation semantics.
pub trait FieldBehavior: Debug + Send + Sync {
    fn type_name(&self) -> &'static str;

    fn comparison_domain(&self) -> &'static str {
        self.type_name()
    }

    fn supports_operation(&self, operation: Operation) -> bool {
        matches!(operation, Operation::Eq | Operation::Neq)
    }

    fn default_value(&self) -> ScalarValue {
        ScalarValue::Null
    }

    fn normalize_value(&self, value: &ScalarValue) -> Result<ScalarValue, FieldValueError> {
        Ok(value.clone())
    }

    fn initial_value(
        &self,
        declared: Option<&ScalarValue>,
    ) -> Result<ScalarValue, FieldValueError> {
        match declared {
            Some(value) => self.normalize_value(value),
            None => self.normalize_value(&self.default_value()),
        }
    }

    fn validate(&self, _value: &ScalarValue) -> Vec<ValidationError> {
        Vec::new()
    }

    fn values_equal(&self, left: &ScalarValue, right: &ScalarValue) -> bool {
        left == right
    }

    fn compare(
        &self,
        left: &ScalarValue,
        operation: Operation,
        right: &ScalarValue,
    ) -> Result<bool, FieldValueError> {
        if !self.supports_operation(operation) {
            return Err(FieldValueError::UnsupportedOperation { operation });
        }

        let left = self.normalize_value(left)?;
        let right = self.normalize_value(right)?;

        match operation {
            Operation::Eq => Ok(left == right),
            Operation::Neq => Ok(left != right),
            Operation::Lt => compare_ordered(&left, &right).map(|order| order == Ordering::Less),
            Operation::Gt => compare_ordered(&left, &right).map(|order| order == Ordering::Greater),
            Operation::LEqt => compare_ordered(&left, &right)
                .map(|order| matches!(order, Ordering::Less | Ordering::Equal)),
            Operation::GEqt => compare_ordered(&left, &right)
                .map(|order| matches!(order, Ordering::Greater | Ordering::Equal)),
        }
    }
}

fn compare_ordered(left: &ScalarValue, right: &ScalarValue) -> Result<Ordering, FieldValueError> {
    match (left, right) {
        (ScalarValue::String(left), ScalarValue::String(right)) => Ok(left.cmp(right)),
        (ScalarValue::Number(left), ScalarValue::Number(right)) => left
            .partial_cmp(right)
            .ok_or_else(|| FieldValueError::InvalidValue {
                message: "tg_schema_numbers_must_be_finite_and_orderable".to_string(),
            }),
        _ => Err(FieldValueError::InvalidType {
            expected: scalar_type(left).to_string(),
            received: scalar_type(right).to_string(),
        }),
    }
}

pub fn scalar_type(value: &ScalarValue) -> &'static str {
    match value {
        ScalarValue::String(_) => "string",
        ScalarValue::Number(_) => "number",
        ScalarValue::Bool(_) => "boolean",
        ScalarValue::Files(_) => "files",
        ScalarValue::Strings(_) => "tg_schema_string_array",
        ScalarValue::Null => "null",
    }
}

#[derive(Clone, Debug)]
pub struct CompiledFieldCommon {
    pub key: String,
    pub view: Option<FieldView>,
    pub rules: Vec<Rule>,
    pub initial_value: ScalarValue,
    pub hidden: bool,
    pub disabled: bool,
    pub read_only: bool,
    pub initial_behavior_errors: Vec<String>,
    pub initial_options: Option<Vec<super::select::SelectOption>>,
}

#[derive(Clone, Debug)]
pub struct CompiledField {
    common: CompiledFieldCommon,
    behavior: Arc<dyn FieldBehavior>,
}

impl CompiledField {
    pub fn new(
        raw: &RawField,
        behavior: Arc<dyn FieldBehavior>,
    ) -> Result<Self, FieldCompileError> {
        crate::sources::bindings(raw)
            .map_err(|message| FieldCompileError::InvalidConfiguration { message })?;
        let initial_value = behavior
            .initial_value(raw.current_value.as_ref())
            .map_err(|source| FieldCompileError::InvalidInitialValue { source })?;

        let mut rules = raw.rules.clone();

        for (rule_index, rule) in rules.iter_mut().enumerate() {
            for (action_index, action) in rule.then.iter_mut().enumerate() {
                let value = match action {
                    Consequence::SetValue { value } => value,
                    Consequence::ClearValue => {
                        behavior
                            .normalize_value(&ScalarValue::Null)
                            .map_err(|source| FieldCompileError::InvalidActionValue {
                                rule_index,
                                action_index,
                                source,
                            })?;
                        continue;
                    }
                    Consequence::SetHidden { .. }
                    | Consequence::Show
                    | Consequence::SetErrors { .. } => continue,
                };

                *value = behavior.normalize_value(value).map_err(|source| {
                    FieldCompileError::InvalidActionValue {
                        rule_index,
                        action_index,
                        source,
                    }
                })?;
            }
        }

        Ok(Self {
            common: CompiledFieldCommon {
                key: raw.key.clone(),
                view: raw.view.clone(),
                rules,
                initial_value,
                hidden: raw.hidden,
                disabled: raw.disabled,
                read_only: raw.read_only,
                initial_behavior_errors: raw.errors.clone(),
                initial_options: raw.configuration.get("options").and_then(|v| {
                    super::select::choice_options(v.clone(), raw.field_type == "boolean").ok()
                }),
            },
            behavior,
        })
    }

    pub fn common(&self) -> &CompiledFieldCommon {
        &self.common
    }

    pub(crate) fn rebind(&mut self, raw: &RawField) {
        self.common.key = raw.key.clone();
        // Keep action values already normalized by the owning behavior.
        for (compiled, declared) in self.common.rules.iter_mut().zip(&raw.rules) {
            compiled.when = declared.when.clone();
        }
        self.common.view = raw.view.clone();
    }

    pub fn behavior(&self) -> &dyn FieldBehavior {
        self.behavior.as_ref()
    }

    pub(crate) fn behavior_arc(&self) -> Arc<dyn FieldBehavior> {
        Arc::clone(&self.behavior)
    }

    pub(crate) fn rules_mut(&mut self) -> &mut [Rule] {
        &mut self.common.rules
    }

    pub fn normalize_value(&self, value: &ScalarValue) -> Result<ScalarValue, FieldValueError> {
        self.behavior.normalize_value(value)
    }

    pub fn validate(&self, value: &ScalarValue) -> Vec<ValidationError> {
        self.behavior.validate(value)
    }

    pub fn values_equal(&self, left: &ScalarValue, right: &ScalarValue) -> bool {
        self.behavior.values_equal(left, right)
    }

    pub fn compare(
        &self,
        left: &ScalarValue,
        operation: Operation,
        right: &ScalarValue,
    ) -> Result<bool, FieldValueError> {
        self.behavior.compare(left, operation, right)
    }
}
