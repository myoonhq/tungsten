use super::{Collection, RepeaterRenderLibrary, MAX_RUNTIME_FIELDS};
use crate::fields::{ConditionOperand, RawField};
use crate::schema::{RawComponent, RawSchema};
use serde_json::Value;
use std::collections::BTreeMap;

/// Group layout is presentation; ordered field declarations and repeater
/// membership/default policies are meaningful. Keep the preexisting scalar
/// reload contract, including field-view declarations, when comparing forms.
pub(super) fn semantic_schema(schema: &RawSchema) -> Value {
    fn declarations(components: &[RawComponent]) -> Vec<Value> {
        let mut values = Vec::new();
        for component in components {
            match component {
                RawComponent::Field(field) => values.push(serde_json::to_value(field).unwrap()),
                RawComponent::Group(group) => values.extend(declarations(&group.subform)),
                RawComponent::Repeater(repeater) => {
                    let mut value = serde_json::to_value(repeater).unwrap();
                    let descriptor = value.as_object_mut().unwrap();
                    descriptor.remove("view");
                    descriptor.remove("render");
                    descriptor.insert(
                        "template".into(),
                        Value::Array(declarations(&repeater.template)),
                    );
                    values.push(value);
                }
            }
        }
        values
    }
    serde_json::json!({ "schemaVersion": schema.schema_version, "declarations": declarations(&schema.form) })
}
pub(super) fn validate_tree(
    components: &[RawComponent],
    renderers: &RepeaterRenderLibrary,
    collections: &mut BTreeMap<String, Collection>,
    inside: bool,
    depth: usize,
) -> Result<Vec<RawComponent>, String> {
    if depth > crate::schema::MAX_GROUP_DEPTH {
        return Err("tg_schema_structural_nesting_limit_exceeded".into());
    }
    let mut validated = Vec::new();
    for component in components {
        validated.push(match component {
            RawComponent::Field(field) => RawComponent::Field(field.clone()),
            RawComponent::Group(group) => {
                let mut group = group.clone();
                group.subform = validate_tree(&group.subform, renderers, collections, inside, depth + 1)?;
                RawComponent::Group(group)
            }
            RawComponent::Repeater(repeater) => {
                if repeater.component_type != "repeater" { return Err("tg_schema_repeater_type_must_be_repeater".into()); }
                if repeater.max.is_some_and(|max| repeater.min > max) { return Err(crate::messages::diagnostic("tg_schema_repeater_min_exceeds_max", serde_json::json!({"p0": repeater.key}))); }
                if repeater.validators.iter().any(|validator| validator.kind != "required") {
                    return Err(crate::messages::diagnostic("tg_schema_repeater_only_accepts_the_no_op_required_validator_use_min_max_for_bounds", serde_json::json!({"p0": repeater.key})));
                }
                renderers.validate(&repeater.render).map_err(|error| crate::messages::diagnostic("tg_schema_repeater_renderer", serde_json::json!({"key": repeater.key, "error": {"messageKey": error}})))?;
                if collections.keys().any(|key| key == &repeater.key || (!inside && (key.starts_with(&format!("{}.", repeater.key)) || repeater.key.starts_with(&format!("{key}."))))) {
                    return Err(crate::messages::diagnostic("tg_schema_duplicate_or_overlapping_repeater_namespace", serde_json::json!({"p0": repeater.key})));
                }
                collections.insert(repeater.key.clone(), Collection { descriptor: repeater.clone(), ids: Vec::new(), identity: repeater.key.clone(), seeds: BTreeMap::new() });
                let mut repeater = repeater.clone();
                repeater.template = validate_tree(&repeater.template, renderers, collections, true, depth + 1)?;
                RawComponent::Repeater(repeater)
            }
        });
    }
    Ok(validated)
}
pub(super) fn first_label(components: &[RawComponent]) -> Option<String> {
    components.iter().find_map(|component| match component {
        RawComponent::Group(group) => group
            .view
            .as_ref()
            .map(|view| view.label.clone())
            .or_else(|| first_label(&group.subform)),
        _ => None,
    })
}
pub(super) fn instantiate(
    components: &[RawComponent],
    key: &str,
    index: usize,
) -> Vec<RawComponent> {
    let rename = |path: &str| {
        format!(
            "{key}[{index}]{}",
            path.strip_prefix(key).expect("validated namespace")
        )
    };
    components
        .iter()
        .map(|component| match component {
            RawComponent::Field(field) => {
                let mut field = field.clone();
                field.key = rename(&field.key);
                RawComponent::Field(field)
            }
            RawComponent::Group(group) => {
                let mut group = group.clone();
                group.key = rename(&group.key);
                if let Some(initial) = group.render.settings.get_mut("initialSection") {
                    if let Some(value) = initial.as_str() {
                        *initial = Value::String(rename(value));
                    }
                }
                group.subform = instantiate(&group.subform, key, index);
                RawComponent::Group(group)
            }
            RawComponent::Repeater(repeater) => {
                let mut repeater = repeater.clone();
                repeater.key = rename(&repeater.key);
                repeater.template = instantiate(&repeater.template, key, index);
                RawComponent::Repeater(repeater)
            }
        })
        .collect()
}
/// Remove positional selectors to recover the authored declaration namespace.
pub(super) fn canonical(path: &str) -> String {
    let mut result = String::new();
    let mut selector = false;
    for c in path.chars() {
        match c {
            '[' => selector = true,
            ']' => selector = false,
            _ if !selector => result.push(c),
            _ => {}
        }
    }
    result
}

fn resolve_reference(
    reference: &str,
    collections: &BTreeMap<String, Collection>,
    owner: Option<&str>,
    template_check: bool,
) -> Result<String, String> {
    let families: std::collections::BTreeSet<_> =
        collections.keys().map(|key| canonical(key)).collect();
    let mut authored = String::new();
    let mut concrete = String::new();
    for segment in reference.split('.') {
        if !authored.is_empty() {
            authored.push('.');
            concrete.push('.');
        }
        let (name, selector) = if let Some((name, tail)) = segment.split_once('[') {
            let selector = tail
                .strip_suffix(']')
                .filter(|s| !s.contains(['[', ']']))
                .ok_or_else(|| {
                    crate::messages::diagnostic(
                        "tg_schema_malformed_repeater_reference",
                        serde_json::json!({"reference": reference}),
                    )
                })?;
            (name, Some(selector))
        } else {
            if segment.contains(']') {
                return Err(crate::messages::diagnostic(
                    "tg_schema_malformed_repeater_reference",
                    serde_json::json!({"reference": reference}),
                ));
            }
            (segment, None)
        };
        authored.push_str(name);
        concrete.push_str(name);
        if families.contains(&authored) {
            let selector = selector.ok_or_else(|| crate::messages::diagnostic("tg_schema_unindexed_repeater_reference_is_unsupported_use_current_inside_its_template_or_a_numer", serde_json::json!({"reference": reference})))?;
            let index = if selector == "current" {
                let owner = owner.ok_or_else(|| {
                    crate::messages::diagnostic(
                        "tg_schema_has_no_owning_repeater_instance",
                        serde_json::json!({"reference": reference}),
                    )
                })?;
                if template_check {
                    if !owner.starts_with(&format!("{authored}.")) {
                        return Err(crate::messages::diagnostic("tg_schema_has_no_owning_instance_of_this_repeater_belongs_to_a_different_repeater", serde_json::json!({"reference": reference})));
                    }
                    0
                } else {
                    let tail = owner.strip_prefix(&format!("{concrete}[")).ok_or_else(|| {
                        crate::messages::diagnostic(
                            "tg_schema_belongs_to_a_different_repeater_instance",
                            serde_json::json!({"reference": reference}),
                        )
                    })?;
                    tail.split_once(']').unwrap().0.parse::<usize>().unwrap()
                }
            } else {
                let index = selector.parse::<usize>().map_err(|_| {
                    crate::messages::diagnostic(
                        "tg_schema_invalid_numeric_repeater_selector",
                        serde_json::json!({"reference": reference}),
                    )
                })?;
                if selector != index.to_string() {
                    return Err(crate::messages::diagnostic(
                        "tg_schema_repeater_index_must_be_canonical_in",
                        serde_json::json!({"reference": reference}),
                    ));
                }
                index
            };
            if !template_check {
                concrete.push_str(&format!("[{index}]"));
            }
        } else if selector.is_some() {
            return Err(crate::messages::diagnostic(
                "tg_schema_unknown_or_malformed_repeater_reference",
                serde_json::json!({"reference": reference}),
            ));
        }
    }
    Ok(concrete)
}
pub(super) fn validate_references(
    components: &mut [RawComponent],
    collections: &BTreeMap<String, Collection>,
    template_check: bool,
) -> Result<(), String> {
    for component in components {
        match component {
            RawComponent::Field(field) => {
                let owner = if template_check || field.key.contains('[') {
                    Some(field.key.as_str())
                } else {
                    None
                };
                for rule in &mut field.rules {
                    rule.when.property =
                        resolve_reference(&rule.when.property, collections, owner, template_check)?;
                    if let ConditionOperand::Ref { r#ref } = &mut rule.when.value {
                        *r#ref = resolve_reference(r#ref, collections, owner, template_check)?;
                    }
                }
                if let Some(bindings) = field
                    .configuration
                    .get_mut("bindings")
                    .and_then(|v| v.as_object_mut())
                {
                    for binding in bindings.values_mut() {
                        if let Some(params) =
                            binding.get_mut("params").and_then(|v| v.as_object_mut())
                        {
                            for input in params.values_mut() {
                                if let Some(reference) = input.get_mut("ref") {
                                    let text = reference
                                        .as_str()
                                        .ok_or("tg_schema_source_ref_must_be_a_string")?;
                                    *reference = serde_json::Value::String(resolve_reference(
                                        text,
                                        collections,
                                        owner,
                                        template_check,
                                    )?);
                                }
                            }
                        }
                    }
                }
            }
            RawComponent::Group(group) => {
                validate_references(&mut group.subform, collections, template_check)?
            }
            RawComponent::Repeater(repeater) if template_check => {
                validate_references(&mut repeater.template, collections, true)?
            }
            _ => {}
        }
    }
    Ok(())
}
pub(super) fn expand_fields(
    schema: &RawSchema,
    collections: &BTreeMap<String, Collection>,
) -> Result<(Vec<RawField>, Vec<String>), String> {
    fn walk(
        components: &[RawComponent],
        collections: &BTreeMap<String, Collection>,
        fields: &mut Vec<RawField>,
        identities: &mut Vec<String>,
        instance: Option<(&str, u64, &BTreeMap<String, crate::ScalarValue>)>,
    ) -> Result<(), String> {
        for component in components {
            match component {
                RawComponent::Field(field) => {
                    let mut field = field.clone();
                    identities.push(match instance {
                        Some((prefix, id, seeds)) => {
                            let relative = field.key.strip_prefix(prefix).unwrap();
                            if let Some(value) = seeds.get(relative) {
                                field.current_value = Some(value.clone());
                            }
                            format!("instance:{id}:{relative}")
                        }
                        None => format!("static:{}", field.key),
                    });
                    fields.push(field);
                    if fields.len() > MAX_RUNTIME_FIELDS {
                        return Err("tg_schema_runtime_field_safety_limit_exceeded".into());
                    }
                }
                RawComponent::Group(group) => {
                    walk(&group.subform, collections, fields, identities, instance)?
                }
                RawComponent::Repeater(repeater) => {
                    let collection = &collections[&repeater.key];
                    for (index, id) in collection.ids.iter().enumerate() {
                        let mut form = instantiate(&repeater.template, &repeater.key, index);
                        validate_references(&mut form, collections, false)?;
                        let prefix = format!("{}[{index}].", repeater.key);
                        let empty = BTreeMap::new();
                        walk(
                            &form,
                            collections,
                            fields,
                            identities,
                            Some((&prefix, *id, collection.seeds.get(id).unwrap_or(&empty))),
                        )?;
                    }
                }
            }
        }
        Ok(())
    }
    let mut form = schema.form.clone();
    validate_references(&mut form, collections, false)?;
    let mut fields = Vec::new();
    let mut identities = Vec::new();
    walk(&form, collections, &mut fields, &mut identities, None)?;
    Ok((fields, identities))
}
