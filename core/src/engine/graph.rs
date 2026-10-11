use std::collections::{HashMap, HashSet};

use serde::Serialize;

use crate::fields::{CompiledField, ConditionOperand};

pub type FieldId = usize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct TriggeredRule {
    pub target: FieldId,
    pub rule_index: usize,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct GraphNode {
    pub key: String,
    pub affects: Vec<String>,
}

/// Runtime index from a changed value to the exact rules that read it.
///
/// `nodes` is a neutral, deterministic descriptor suitable for WASM output.
/// The private ID-based index is the execution structure.
#[derive(Clone, Debug, Serialize)]
pub struct TriggerIndex {
    pub nodes: Vec<GraphNode>,

    #[serde(skip)]
    rules_by_source: Vec<Vec<TriggeredRule>>,

    #[serde(skip)]
    key_index: HashMap<String, FieldId>,
}

impl TriggerIndex {
    pub fn from_fields(
        fields: &[CompiledField],
        key_index: &HashMap<String, FieldId>,
    ) -> Result<Self, TriggerIndexBuildError> {
        let mut nodes = fields
            .iter()
            .map(|field| GraphNode {
                key: field.common().key.clone(),
                affects: Vec::new(),
            })
            .collect::<Vec<_>>();
        let mut rules_by_source = vec![Vec::new(); fields.len()];
        let mut affected_targets = vec![HashSet::new(); fields.len()];

        for (target, field) in fields.iter().enumerate() {
            for (rule_index, rule) in field.common().rules.iter().enumerate() {
                let property = resolve(key_index, target, &rule.when.property)?;
                let mut sources = vec![property];

                if let ConditionOperand::Ref { r#ref } = &rule.when.value {
                    let reference = resolve(key_index, target, r#ref)?;
                    if reference != property {
                        sources.push(reference);
                    }
                }

                for source in sources {
                    rules_by_source[source].push(TriggeredRule { target, rule_index });

                    let target_key = &fields[target].common().key;
                    if affected_targets[source].insert(target) {
                        nodes[source].affects.push(target_key.clone());
                    }
                }
            }
        }

        Ok(Self {
            nodes,
            rules_by_source,
            key_index: key_index.clone(),
        })
    }

    pub(crate) fn update(
        &self,
        fields: &[CompiledField],
        key_index: &HashMap<String, FieldId>,
        remap: &[Option<FieldId>],
        changed: &HashSet<FieldId>,
    ) -> Result<Self, TriggerIndexBuildError> {
        let mut rules_by_source = vec![Vec::new(); fields.len()];
        for (old_source, rules) in self.rules_by_source.iter().enumerate() {
            let Some(source) = remap[old_source] else {
                continue;
            };
            for rule in rules {
                if let Some(target) = remap[rule.target] {
                    if !changed.contains(&target) {
                        rules_by_source[source].push(TriggeredRule {
                            target,
                            rule_index: rule.rule_index,
                        });
                    }
                }
            }
        }
        for (target, field) in fields.iter().enumerate() {
            if !changed.contains(&target) {
                continue;
            }
            for (rule_index, rule) in field.common().rules.iter().enumerate() {
                let property = resolve(key_index, target, &rule.when.property)?;
                rules_by_source[property].push(TriggeredRule { target, rule_index });
                if let ConditionOperand::Ref { r#ref } = &rule.when.value {
                    let source = resolve(key_index, target, r#ref)?;
                    if source != property {
                        rules_by_source[source].push(TriggeredRule { target, rule_index });
                    }
                }
            }
        }
        let nodes = rules_by_source
            .iter_mut()
            .enumerate()
            .map(|(source, rules)| {
                rules.sort_by_key(|rule| (rule.target, rule.rule_index));
                let mut seen = HashSet::new();
                GraphNode {
                    key: fields[source].common().key.clone(),
                    affects: rules
                        .iter()
                        .filter(|rule| seen.insert(rule.target))
                        .map(|rule| fields[rule.target].common().key.clone())
                        .collect(),
                }
            })
            .collect();
        Ok(Self {
            nodes,
            rules_by_source,
            key_index: key_index.clone(),
        })
    }

    pub fn rules_for(&self, source: FieldId) -> &[TriggeredRule] {
        self.rules_by_source
            .get(source)
            .map(Vec::as_slice)
            .unwrap_or_default()
    }

    pub fn field_id(&self, key: &str) -> Option<FieldId> {
        self.key_index.get(key).copied()
    }

    pub fn node(&self, key: &str) -> Option<&GraphNode> {
        self.field_id(key)
            .and_then(|field_id| self.nodes.get(field_id))
    }
}

fn resolve(
    key_index: &HashMap<String, FieldId>,
    target: FieldId,
    key: &str,
) -> Result<FieldId, TriggerIndexBuildError> {
    key_index
        .get(key)
        .copied()
        .ok_or_else(|| TriggerIndexBuildError {
            target,
            referenced_key: key.to_string(),
        })
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct TriggerIndexBuildError {
    pub target: FieldId,
    pub referenced_key: String,
}

/// Compatibility name for callers that consumed the earlier graph DTO.
pub type EffectGraph = TriggerIndex;
