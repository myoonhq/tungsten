use super::template::{canonical, instantiate};
use super::{Collection, FormData, MAX_INSTANCES, MAX_RUNTIME_FIELDS};
use crate::engine::runtime::FormValues;
use crate::fields::RawField;
use crate::schema::{RawComponent, RawSchema};
use serde_json::{Map, Value};
use std::collections::BTreeMap;

pub(super) fn collect_template_fields<'a>(
    components: &'a [RawComponent],
    fields: &mut Vec<&'a RawField>,
) {
    for component in components {
        match component {
            RawComponent::Field(field) => fields.push(field),
            RawComponent::Group(group) => collect_template_fields(&group.subform, fields),
            RawComponent::Repeater(_) => {}
        }
    }
}
fn members(components: &[RawComponent], prefix: &str, paths: &mut Vec<String>) {
    for component in components {
        match component {
            RawComponent::Group(group) => members(&group.subform, prefix, paths),
            _ => paths.push(
                component
                    .key()
                    .strip_prefix(prefix)
                    .expect("validated namespace")
                    .into(),
            ),
        }
    }
}
fn flatten_item(
    item: &Map<String, Value>,
    prefix: &str,
    expected: &[String],
    leaves: &mut BTreeMap<String, Value>,
) -> Result<(), String> {
    for (name, value) in item {
        if name.is_empty() || name.contains(['.', '[', ']']) {
            return Err(crate::messages::diagnostic(
                "tg_schema_invalid_item_property",
                serde_json::json!({"name": name}),
            ));
        }
        let path = if prefix.is_empty() {
            name.clone()
        } else {
            format!("{prefix}.{name}")
        };
        if expected.contains(&path) {
            leaves.insert(path, value.clone());
        } else if expected
            .iter()
            .any(|key| key.starts_with(&format!("{path}.")))
        {
            let object = value.as_object().ok_or_else(|| {
                crate::messages::diagnostic(
                    "tg_schema_must_be_an_object",
                    serde_json::json!({"path": path}),
                )
            })?;
            flatten_item(object, &path, expected, leaves)?;
        } else {
            return Err(crate::messages::diagnostic(
                "tg_schema_unknown_item_property",
                serde_json::json!({"path": path}),
            ));
        }
    }
    Ok(())
}

/// Materialize only collection membership and initial scalar inputs. Existing
/// collections are located by parent instance identity, independent of position.
pub(super) struct Layout {
    pub collections: BTreeMap<String, Collection>,
    pub flat: FormValues,
    pub supplied: FormValues,
}

pub(super) fn layout(
    schema: &RawSchema,
    previous: Option<&BTreeMap<String, Collection>>,
    data: Option<&FormData>,
    next: &mut u64,
) -> Result<Layout, String> {
    struct Builder<'a> {
        old: BTreeMap<&'a str, &'a Collection>,
        collections: BTreeMap<String, Collection>,
        flat: FormValues,
        supplied: FormValues,
        next: &'a mut u64,
        instances: usize,
    }
    impl Builder<'_> {
        fn walk(
            &mut self,
            components: &[RawComponent],
            inputs: &BTreeMap<String, Value>,
            parent: Option<(&str, u64)>,
            seed_inputs: bool,
        ) -> Result<(), String> {
            for component in components {
                match component {
                    RawComponent::Group(group) => {
                        self.walk(&group.subform, inputs, parent, seed_inputs)?
                    }
                    RawComponent::Field(field) => {
                        if let Some(value) = inputs.get(&field.key) {
                            self.flat.insert(
                                field.key.clone(),
                                serde_json::from_value(value.clone()).map_err(|e| {
                                    crate::messages::diagnostic(
                                        "tg_schema_invalid_value",
                                        serde_json::json!({"p0": field.key, "e": e.to_string()}),
                                    )
                                })?,
                            );
                            if !seed_inputs {
                                self.supplied
                                    .insert(field.key.clone(), self.flat[&field.key].clone());
                            }
                        }
                    }
                    RawComponent::Repeater(repeater) => {
                        let identity = match parent {
                            Some((prefix, id)) => format!(
                                "instance:{id}:{}",
                                repeater.key.strip_prefix(prefix).unwrap()
                            ),
                            None => format!("root:{}", repeater.key),
                        };
                        let old = self.old.get(identity.as_str()).copied();
                        let (items, defaulted) = if old.is_some() {
                            (Vec::new(), false)
                        } else {
                            match inputs.get(&repeater.key) {
                                Some(Value::Array(items)) => (items.clone(), seed_inputs),
                                Some(_) => {
                                    return Err(crate::messages::diagnostic(
                                        "tg_schema_repeater_must_load_an_array",
                                        serde_json::json!({"p0": repeater.key}),
                                    ))
                                }
                                None => (repeater.current_value.clone().unwrap_or_default(), true),
                            }
                        };
                        let count = old.map_or(items.len(), |c| c.ids.len());
                        if count > MAX_INSTANCES {
                            return Err(crate::messages::diagnostic(
                                "tg_schema_repeater_exceeds_safety_limit_of_instances",
                                serde_json::json!({"p0": repeater.key, "MAX_INSTANCES": MAX_INSTANCES}),
                            ));
                        }
                        self.instances += count;
                        if self.instances > MAX_RUNTIME_FIELDS {
                            return Err("tg_schema_runtime_instance_safety_limit_exceeded".into());
                        }
                        let ids = if let Some(old) = old {
                            old.ids.clone()
                        } else {
                            (0..count)
                                .map(|_| {
                                    let id = *self.next;
                                    *self.next = self
                                        .next
                                        .checked_add(1)
                                        .ok_or("tg_schema_instance_identity_limit_exceeded")?;
                                    Ok(id)
                                })
                                .collect::<Result<Vec<_>, String>>()?
                        };
                        let mut collection = Collection {
                            descriptor: repeater.clone(),
                            ids: ids.clone(),
                            identity,
                            seeds: old.map(|c| c.seeds.clone()).unwrap_or_default(),
                        };
                        for (index, id) in ids.iter().enumerate() {
                            let form = instantiate(&repeater.template, &repeater.key, index);
                            let prefix = format!("{}[{index}].", repeater.key);
                            let mut inputs = BTreeMap::new();
                            if old.is_none() {
                                let mut expected = Vec::new();
                                members(&form, &prefix, &mut expected);
                                let item = items[index].as_object().ok_or_else(|| {
                                    crate::messages::diagnostic(
                                        "tg_schema_must_be_an_object_2",
                                        serde_json::json!({"p0": repeater.key, "index": index}),
                                    )
                                })?;
                                let mut leaves = BTreeMap::new();
                                flatten_item(item, "", &expected, &mut leaves).map_err(
                                    |error| format!("'{}[{index}]': {error}", repeater.key),
                                )?;
                                inputs = leaves
                                    .into_iter()
                                    .map(|(path, value)| (format!("{prefix}{path}"), value))
                                    .collect();
                                let mut fields = Vec::new();
                                collect_template_fields(&form, &mut fields);
                                let mut seeds = BTreeMap::new();
                                for field in fields {
                                    if let Some(value) =
                                        inputs.get(&field.key).filter(|_| defaulted)
                                    {
                                        seeds.insert(
                                            field.key.strip_prefix(&prefix).unwrap().into(),
                                            serde_json::from_value(value.clone()).map_err(
                                                |error| {
                                                    crate::messages::diagnostic("tg_schema_invalid_value_2", serde_json::json!({"p0": field.key, "error": (error).to_string()}))
                                                },
                                            )?,
                                        );
                                    }
                                }
                                collection.seeds.insert(*id, seeds);
                            }
                            self.walk(&form, &inputs, Some((&prefix, *id)), defaulted)?;
                        }
                        collection.seeds.retain(|id, _| ids.contains(id));
                        self.collections.insert(repeater.key.clone(), collection);
                    }
                }
            }
            Ok(())
        }
    }
    let mut builder = Builder {
        old: previous
            .into_iter()
            .flat_map(|c| c.values())
            .map(|c| (c.identity.as_str(), c))
            .collect(),
        collections: BTreeMap::new(),
        flat: FormValues::new(),
        supplied: FormValues::new(),
        next,
        instances: 0,
    };
    let empty = BTreeMap::new();
    let inputs = data.unwrap_or(&empty);
    if data.is_some() {
        let mut expected = Vec::new();
        members(&schema.form, "", &mut expected);
        for key in inputs.keys() {
            if !expected.contains(key) {
                return Err(crate::messages::diagnostic(
                    "tg_schema_unknown_initial_value",
                    serde_json::json!({"key": key}),
                ));
            }
        }
    }
    builder.walk(&schema.form, inputs, None, false)?;
    Ok(Layout {
        collections: builder.collections,
        flat: builder.flat,
        supplied: builder.supplied,
    })
}

/// Check every declared collection default, including unreachable nested arrays.
pub(super) fn validate_defaults(
    collections: &BTreeMap<String, Collection>,
    declarations: &crate::compiler::CompiledSchema,
) -> Result<(), String> {
    for collection in collections.values() {
        let schema = RawSchema {
            schema_version: crate::schema::SCHEMA_VERSION.into(),
            form: vec![RawComponent::Repeater(collection.descriptor.clone())],
        };
        let defaults = layout(&schema, None, None, &mut 0)?;
        for (path, value) in defaults.flat {
            let key = canonical(&path);
            let id = declarations
                .field_id(&key)
                .expect("validated template declaration");
            declarations.fields()[id]
                .normalize_value(&value)
                .map_err(|e| {
                    crate::messages::diagnostic(
                        "tg_schema_invalid_schema_current_value",
                        serde_json::json!({"path": path, "e": e.to_string()}),
                    )
                })?;
        }
    }
    Ok(())
}

pub(super) fn insert_nested(object: &mut Map<String, Value>, path: &str, value: Value) {
    if let Some((head, tail)) = path.split_once('.') {
        let next = object
            .entry(head.to_string())
            .or_insert_with(|| Value::Object(Map::new()));
        insert_nested(
            next.as_object_mut().expect("validated item namespaces"),
            tail,
            value,
        );
    } else {
        object.insert(path.into(), value);
    }
}
