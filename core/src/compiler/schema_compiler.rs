use std::collections::HashMap;
use std::error::Error;
use std::fmt::{Display, Formatter};

use super::compiled_schema::CompiledSchema;
use super::value_graph::{
    DependencyKind, ValueActionKind, ValueEdgeOrigin, ValueGraph, ValueGraphBuildError,
};
use crate::engine::graph::{FieldId, TriggerIndex, TriggerIndexBuildError};
use crate::engine::runtime::FormState;
use crate::fields::{
    CompiledField, ConditionOperand, FieldCompileError, FieldLibrary, FieldValueError, Operation,
    RawField,
};
use crate::groups::GroupRenderLibrary;
use crate::schema::RawSchema;

/// Converts neutral descriptors into an immutable, runtime-ready schema.
#[derive(Clone, Debug)]
pub struct SchemaCompiler {
    library: FieldLibrary,
    group_renderers: GroupRenderLibrary,
}

impl SchemaCompiler {
    pub fn new() -> Self {
        Self::with_library(FieldLibrary::default())
    }

    pub fn with_library(library: FieldLibrary) -> Self {
        Self {
            library,
            group_renderers: GroupRenderLibrary::default(),
        }
    }

    pub fn with_libraries(library: FieldLibrary, group_renderers: GroupRenderLibrary) -> Self {
        Self {
            library,
            group_renderers,
        }
    }

    pub fn library(&self) -> &FieldLibrary {
        &self.library
    }

    pub fn group_renderers(&self) -> &GroupRenderLibrary {
        &self.group_renderers
    }

    pub fn compile(&self, schema: RawSchema) -> Result<CompiledSchema, CompileError> {
        let (raw_fields, field_paths) = super::structure::expand(&schema, &self.group_renderers)?;
        self.compile_expanded(schema, raw_fields, field_paths)
    }

    pub(crate) fn compile_templates(
        &self,
        schema: RawSchema,
    ) -> Result<CompiledSchema, CompileError> {
        let (fields, paths) = super::structure::expand_templates(&schema, &self.group_renderers)?;
        self.compile_expanded(schema, fields, paths)
    }

    pub(crate) fn validate_template_structure(
        &self,
        schema: &RawSchema,
    ) -> Result<(), CompileError> {
        super::structure::expand_templates(schema, &self.group_renderers).map(|_| ())
    }

    pub(crate) fn compile_expanded(
        &self,
        schema: RawSchema,
        raw_fields: Vec<RawField>,
        field_paths: Vec<String>,
    ) -> Result<CompiledSchema, CompileError> {
        let key_index = build_key_index(&raw_fields)?;
        let mut fields = self.compile_fields(&raw_fields)?;

        self.compile_conditions(&mut fields, &key_index)?;

        let trigger_index = TriggerIndex::from_fields(&fields, &key_index)
            .map_err(|error| unknown_reference_from_trigger(&fields, error))?;
        let value_graph = ValueGraph::build(&fields, &key_index)
            .map_err(|error| unknown_reference_from_value_graph(&fields, error))?;

        if let Some(cycle) = value_graph.first_cycle() {
            return Err(CompileError::ValueCycle {
                path: cycle
                    .path
                    .iter()
                    .map(|field_id| fields[*field_id].common().key.clone())
                    .collect(),
                provenance: cycle
                    .origins
                    .iter()
                    .map(|origin| cycle_provenance(&fields, origin))
                    .collect(),
            });
        }

        let initial_state = FormState::from_fields(&fields);

        Ok(CompiledSchema::new(
            schema,
            raw_fields,
            field_paths,
            fields,
            key_index,
            initial_state,
            trigger_index,
            value_graph,
        ))
    }

    pub(crate) fn compile_fields(
        &self,
        schema: &[RawField],
    ) -> Result<Vec<CompiledField>, CompileError> {
        schema
            .iter()
            .map(|raw| {
                let Some(field_type) = self.library.get(raw.field_type()) else {
                    return Err(CompileError::UnknownFieldType {
                        field_key: raw.key.clone(),
                        field_type: raw.field_type.clone(),
                    });
                };

                field_type
                    .compile(raw)
                    .map_err(|source| CompileError::InvalidField {
                        field_key: raw.key.clone(),
                        field_type: raw.field_type.clone(),
                        source,
                    })
            })
            .collect()
    }

    pub(crate) fn compile_conditions(
        &self,
        fields: &mut [CompiledField],
        key_index: &HashMap<String, FieldId>,
    ) -> Result<(), CompileError> {
        for target in 0..fields.len() {
            for rule_index in 0..fields[target].common().rules.len() {
                let condition = &fields[target].common().rules[rule_index].when;
                let property = condition.property.clone();
                let operation = condition.operation;
                let operand = condition.value.clone();
                let target_key = fields[target].common().key.clone();

                let source_id = key_index.get(&property).copied().ok_or_else(|| {
                    CompileError::UnknownFieldReference {
                        field_key: target_key.clone(),
                        referenced_key: property.clone(),
                    }
                })?;
                let source_behavior = fields[source_id].behavior_arc();

                if !source_behavior.supports_operation(operation) {
                    return Err(CompileError::UnsupportedOperation {
                        field_key: target_key,
                        rule_index,
                        referenced_key: property,
                        operation,
                    });
                }

                match operand {
                    ConditionOperand::Value(value) => {
                        let value = source_behavior.normalize_value(&value).map_err(|source| {
                            CompileError::InvalidConditionValue {
                                field_key: target_key,
                                rule_index,
                                referenced_key: property,
                                source,
                            }
                        })?;

                        fields[target].rules_mut()[rule_index].when.value =
                            ConditionOperand::Value(value);
                    }
                    ConditionOperand::Ref { r#ref } => {
                        let right_id = key_index.get(&r#ref).copied().ok_or_else(|| {
                            CompileError::UnknownFieldReference {
                                field_key: target_key.clone(),
                                referenced_key: r#ref.clone(),
                            }
                        })?;
                        let right_behavior = fields[right_id].behavior();

                        if source_behavior.comparison_domain() != right_behavior.comparison_domain()
                        {
                            return Err(CompileError::OperandTypeMismatch {
                                details: Box::new(OperandTypeMismatchDetails {
                                    field_key: target_key,
                                    rule_index,
                                    left_field: property,
                                    left_type: source_behavior.type_name().to_string(),
                                    right_field: r#ref,
                                    right_type: right_behavior.type_name().to_string(),
                                }),
                            });
                        }
                    }
                }
            }
        }

        Ok(())
    }
}

impl Default for SchemaCompiler {
    fn default() -> Self {
        Self::new()
    }
}

pub(crate) fn build_key_index(
    schema: &[RawField],
) -> Result<HashMap<String, FieldId>, CompileError> {
    let mut key_index = HashMap::with_capacity(schema.len());

    for (field_id, field) in schema.iter().enumerate() {
        if field.key.is_empty() {
            return Err(CompileError::EmptyFieldKey {
                field_index: field_id,
            });
        }

        if key_index.insert(field.key.clone(), field_id).is_some() {
            return Err(CompileError::DuplicateFieldKey {
                key: field.key.clone(),
            });
        }
    }

    Ok(key_index)
}

fn unknown_reference_from_trigger(
    fields: &[CompiledField],
    error: TriggerIndexBuildError,
) -> CompileError {
    CompileError::UnknownFieldReference {
        field_key: fields[error.target].common().key.clone(),
        referenced_key: error.referenced_key,
    }
}

fn unknown_reference_from_value_graph(
    fields: &[CompiledField],
    error: ValueGraphBuildError,
) -> CompileError {
    CompileError::UnknownFieldReference {
        field_key: fields[error.target].common().key.clone(),
        referenced_key: error.referenced_key,
    }
}

pub(crate) fn cycle_provenance(
    fields: &[CompiledField],
    origin: &ValueEdgeOrigin,
) -> ValueCycleProvenance {
    ValueCycleProvenance {
        source_field: fields[origin.source].common().key.clone(),
        target_field: fields[origin.target].common().key.clone(),
        target_field_index: origin.target,
        rule_index: origin.rule_index,
        action_index: origin.action_index,
        dependency_kind: origin.dependency_kind,
        action_kind: origin.action_kind,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValueCycleProvenance {
    pub source_field: String,
    pub target_field: String,
    pub target_field_index: usize,
    pub rule_index: usize,
    pub action_index: usize,
    pub dependency_kind: DependencyKind,
    pub action_kind: ValueActionKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OperandTypeMismatchDetails {
    pub field_key: String,
    pub rule_index: usize,
    pub left_field: String,
    pub left_type: String,
    pub right_field: String,
    pub right_type: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum CompileError {
    UnsupportedSchemaVersion {
        version: String,
    },
    InvalidStructure {
        path: String,
        key: String,
        message: String,
    },
    InvalidSchema {
        message: String,
    },
    EmptyFieldKey {
        field_index: usize,
    },
    DuplicateFieldKey {
        key: String,
    },
    UnknownFieldType {
        field_key: String,
        field_type: String,
    },
    InvalidField {
        field_key: String,
        field_type: String,
        source: FieldCompileError,
    },
    UnknownFieldReference {
        field_key: String,
        referenced_key: String,
    },
    UnsupportedOperation {
        field_key: String,
        rule_index: usize,
        referenced_key: String,
        operation: Operation,
    },
    InvalidConditionValue {
        field_key: String,
        rule_index: usize,
        referenced_key: String,
        source: FieldValueError,
    },
    OperandTypeMismatch {
        details: Box<OperandTypeMismatchDetails>,
    },
    ValueCycle {
        path: Vec<String>,
        provenance: Vec<ValueCycleProvenance>,
    },
}

impl Display for CompileError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::UnsupportedSchemaVersion { version } => write!(
                formatter,
                "{}",
                crate::messages::diagnostic(
                    "tg_schema_unsupported_schemaversion_expected_sprout",
                    serde_json::json!({"version": version})
                )
            ),
            Self::InvalidStructure { path, key, message } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_invalid_component_at",
                        serde_json::json!({"key": key, "path": path, "message": message})
                    )
                )
            }
            Self::InvalidSchema { message } => write!(
                formatter,
                "{}",
                crate::messages::diagnostic(
                    "tg_schema_invalid_schema",
                    serde_json::json!({"message": message})
                )
            ),
            Self::EmptyFieldKey { field_index } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_field_at_index_has_an_empty_key",
                        serde_json::json!({"field_index": field_index})
                    )
                )
            }
            Self::DuplicateFieldKey { key } => write!(
                formatter,
                "{}",
                crate::messages::diagnostic(
                    "tg_schema_duplicate_field_key",
                    serde_json::json!({"key": key})
                )
            ),
            Self::UnknownFieldType {
                field_key,
                field_type,
            } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_unknown_field_type_for_field",
                        serde_json::json!({"field_type": field_type, "field_key": field_key})
                    )
                )
            }
            Self::InvalidField {
                field_key,
                field_type,
                source,
            } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_invalid_field",
                        serde_json::json!({"field_type": field_type, "field_key": field_key, "source": (source).to_string()})
                    )
                )
            }
            Self::UnknownFieldReference {
                field_key,
                referenced_key,
            } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_field_references_unknown_field",
                        serde_json::json!({"field_key": field_key, "referenced_key": referenced_key})
                    )
                )
            }
            Self::UnsupportedOperation {
                field_key,
                rule_index,
                referenced_key,
                operation,
            } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_field_rule_uses_unsupported_operation_for_field",
                        serde_json::json!({"field_key": field_key, "rule_index": rule_index, "p0": operation.as_str(), "referenced_key": referenced_key})
                    )
                )
            }
            Self::InvalidConditionValue {
                field_key,
                rule_index,
                referenced_key,
                source,
            } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_field_rule_has_an_invalid_operand_for",
                        serde_json::json!({"field_key": field_key, "rule_index": rule_index, "referenced_key": referenced_key, "source": (source).to_string()})
                    )
                )
            }
            Self::OperandTypeMismatch { details } => {
                write!(
                    formatter,
                    "{}",
                    crate::messages::diagnostic(
                        "tg_schema_field_rule_cannot_compare_with",
                        serde_json::json!({"field_key": details.field_key, "rule_index": details.rule_index, "left_field": details.left_field, "left_type": details.left_type, "right_field": details.right_field, "right_type": details.right_type})
                    )
                )
            }
            Self::ValueCycle { path, provenance } => write!(
                formatter,
                "{}",
                crate::messages::diagnostic(
                    "tg_schema_value_cycle",
                    serde_json::json!({ "path": path.join(" -> "), "provenance": provenance.iter().map(|edge| format!("{} -> {} via fields[{}].rules[{}].then[{}] ({:?}, {:?})", edge.source_field, edge.target_field, edge.target_field_index, edge.rule_index, edge.action_index, edge.dependency_kind, edge.action_kind)).collect::<Vec<_>>().join(", ") })
                )
            ),
        }
    }
}

impl Error for CompileError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::InvalidField { source, .. } => Some(source),
            Self::InvalidConditionValue { source, .. } => Some(source),
            _ => None,
        }
    }
}
