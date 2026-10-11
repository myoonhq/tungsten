use std::collections::HashMap;

use crate::fields::RawField;
use crate::groups::GroupRenderLibrary;
use crate::schema::{GroupVariant, RawComponent, RawSchema, MAX_GROUP_DEPTH, SCHEMA_VERSION};

use super::CompileError;

pub(super) fn expand(
    schema: &RawSchema,
    renderers: &GroupRenderLibrary,
) -> Result<(Vec<RawField>, Vec<String>), CompileError> {
    expand_components(schema, renderers, false)
}

pub(crate) fn expand_templates(
    schema: &RawSchema,
    renderers: &GroupRenderLibrary,
) -> Result<(Vec<RawField>, Vec<String>), CompileError> {
    expand_components(schema, renderers, true)
}

fn expand_components(
    schema: &RawSchema,
    renderers: &GroupRenderLibrary,
    include_templates: bool,
) -> Result<(Vec<RawField>, Vec<String>), CompileError> {
    if schema.schema_version != SCHEMA_VERSION {
        return Err(CompileError::UnsupportedSchemaVersion {
            version: schema.schema_version.clone(),
        });
    }
    let mut fields = Vec::new();
    let mut paths = Vec::new();
    let mut keys: HashMap<&str, (bool, String)> = HashMap::new();
    let mut stack = Vec::new();
    for (index, component) in schema.form.iter().enumerate().rev() {
        stack.push((component, None, 0, format!("form[{index}]")));
    }
    while let Some((component, parent, depth, path)) = stack.pop() {
        let key = component.key();
        let invalid = |message: String| CompileError::InvalidStructure {
            path: path.clone(),
            key: key.to_string(),
            message,
        };
        if key.is_empty() && matches!(component, RawComponent::Field(_)) {
            return Err(CompileError::EmptyFieldKey {
                field_index: fields.len(),
            });
        }
        if !key.split('.').all(|segment| {
            !segment.is_empty()
                && segment
                    .bytes()
                    .all(|c| c.is_ascii_alphanumeric() || c == b'_' || c == b'-')
        }) {
            return Err(invalid("tg_schema_keys_must_contain_non_empty_dot_separated_ascii_letter_digit_underscore_or_hyphen_segm".into()));
        }
        if let Some(parent) = parent {
            let (parent_key, sectioned): (&str, bool) = parent;
            if !key
                .strip_prefix(parent_key)
                .is_some_and(|suffix| suffix.starts_with('.'))
            {
                return Err(invalid(crate::messages::diagnostic(
                    "tg_schema_child_must_be_inside_parent_group_namespace",
                    serde_json::json!({"p0": parent_key}),
                )));
            }
            if sectioned
                && !matches!(component, RawComponent::Group(group) if group.variant == GroupVariant::Basic)
            {
                return Err(invalid(crate::messages::diagnostic(
                    "tg_schema_sectioned_group_requires_basic_groups_as_direct_children",
                    serde_json::json!({"p0": parent_key}),
                )));
            }
        }
        let is_group = !matches!(component, RawComponent::Field(_));
        if let Some((previous_is_group, previous_path)) = keys.insert(key, (is_group, path.clone()))
        {
            if !is_group && !previous_is_group {
                return Err(CompileError::DuplicateFieldKey { key: key.into() });
            }
            return Err(invalid(crate::messages::diagnostic(
                "tg_schema_duplicate_component_key_first_declared_at",
                serde_json::json!({"previous_path": previous_path}),
            )));
        }
        match component {
            RawComponent::Field(field) => {
                if field.field_type == "group" || field.field_type == "repeater" {
                    return Err(invalid(
                        "tg_schema_group_is_reserved_for_structural_components".into(),
                    ));
                }
                fields.push(field.clone());
                paths.push(path);
            }
            RawComponent::Repeater(repeater) => {
                if !include_templates {
                    return Err(invalid(
                        "initialize collections with RepeaterForm::load".into(),
                    ));
                }
                if depth >= MAX_GROUP_DEPTH {
                    return Err(invalid(crate::messages::diagnostic(
                        "tg_schema_structural_nesting_exceeds_levels",
                        serde_json::json!({"MAX_GROUP_DEPTH": MAX_GROUP_DEPTH}),
                    )));
                }
                for (index, child) in repeater.template.iter().enumerate().rev() {
                    stack.push((
                        child,
                        Some((repeater.key.as_str(), false)),
                        depth + 1,
                        format!("{path}.template[{index}]"),
                    ));
                }
            }
            RawComponent::Group(group) => {
                if group.component_type != "group" {
                    return Err(invalid("tg_schema_group_type_must_be_group".into()));
                }
                if depth >= MAX_GROUP_DEPTH {
                    return Err(invalid(crate::messages::diagnostic(
                        "tg_schema_group_nesting_exceeds_levels",
                        serde_json::json!({"MAX_GROUP_DEPTH": MAX_GROUP_DEPTH}),
                    )));
                }
                renderers.validate(group).map_err(invalid)?;
                for (index, child) in group.subform.iter().enumerate().rev() {
                    stack.push((
                        child,
                        Some((group.key.as_str(), group.variant == GroupVariant::Sectioned)),
                        depth + 1,
                        format!("{path}.subform[{index}]"),
                    ));
                }
            }
        }
    }
    Ok((fields, paths))
}
