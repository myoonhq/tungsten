//! Repeater construction, array projection and membership live here. The engine
//! receives ordinary concrete fields and never interprets collection selectors.
use crate::compiler::SchemaCompiler;
use crate::engine::{patch::Patch, runtime::FormState, structure::FieldRegistration, Engine};
use crate::schema::{RawComponent, RawRepeater, RawSchema};
use serde::Serialize;
use serde_json::{Map, Value};
use std::collections::{BTreeMap, HashMap};

pub type FormData = BTreeMap<String, Value>;
mod projection;
mod render;
mod template;
use projection::{insert_nested, layout, validate_defaults};
pub use render::RepeaterRenderLibrary;
use template::{
    expand_fields, first_label, instantiate, semantic_schema, validate_references, validate_tree,
};

const MAX_RUNTIME_FIELDS: usize = 100_000;
const MAX_INSTANCES: usize = 10_000;

#[derive(Clone, Debug, Serialize)]
pub struct RepeaterInstance {
    /// Monotonic identity is deliberately serialized as a string for JS safety.
    pub id: String,
    pub label: crate::messages::Text,
    pub form: Vec<RawComponent>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepeaterState {
    pub length: usize,
    pub min: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<usize>,
    pub can_add: bool,
    pub can_remove: bool,
    pub can_reorder: bool,
    pub errors: Vec<crate::messages::Text>,
    pub instances: Vec<RepeaterInstance>,
}
#[derive(Clone, Debug)]
struct Collection {
    descriptor: RawRepeater,
    ids: Vec<u64>,
    /// Parent identity plus relative declaration key, never an array position.
    identity: String,
    /// Collection-array defaults specialize newly created leaves. Inputs and
    /// later edits live only in engine state and are never retained here.
    seeds: BTreeMap<u64, BTreeMap<String, crate::ScalarValue>>,
}

#[derive(Debug)]
pub struct RepeaterForm {
    compiler: SchemaCompiler,
    renderers: RepeaterRenderLibrary,
    schema: RawSchema,
    collections: BTreeMap<String, Collection>,
    next_instance: u64,
    engine: Engine,
}
impl RepeaterForm {
    pub fn load(
        compiler: SchemaCompiler,
        schema: RawSchema,
        values: Option<&FormData>,
    ) -> Result<Self, String> {
        Self::load_with_renderers(compiler, RepeaterRenderLibrary::default(), schema, values)
    }
    pub fn load_with_renderers(
        compiler: SchemaCompiler,
        renderers: RepeaterRenderLibrary,
        schema: RawSchema,
        values: Option<&FormData>,
    ) -> Result<Self, String> {
        Self::load_with_limit(
            compiler,
            renderers,
            schema,
            values,
            Engine::DEFAULT_PROCESSING_LIMIT,
            Default::default(),
        )
    }
    pub fn load_with_sources(
        compiler: SchemaCompiler,
        schema: RawSchema,
        values: Option<&FormData>,
        sources: std::collections::BTreeSet<String>,
    ) -> Result<Self, String> {
        Self::load_with_limit(
            compiler,
            RepeaterRenderLibrary::default(),
            schema,
            values,
            Engine::DEFAULT_PROCESSING_LIMIT,
            sources,
        )
    }
    pub(crate) fn load_with_limit(
        compiler: SchemaCompiler,
        renderers: RepeaterRenderLibrary,
        schema: RawSchema,
        values: Option<&FormData>,
        processing_limit: usize,
        sources: std::collections::BTreeSet<String>,
    ) -> Result<Self, String> {
        let mut collections = BTreeMap::new();
        let validation = validate_tree(&schema.form, &renderers, &mut collections, false, 0)?;
        let mut validation = RawSchema {
            schema_version: schema.schema_version.clone(),
            form: validation,
        };
        // Validate every declaration/rule even with no instances. Here selector
        // normalization is ONLY a template type-check, never a runtime binding.
        validate_references(&mut validation.form, &collections, true)?;
        let declarations = compiler
            .compile_templates(validation)
            .map_err(|e| e.to_string())?;
        for raw in &declarations.raw_fields {
            for binding in crate::sources::bindings(raw)?.values() {
                for input in binding.params.values() {
                    if let crate::sources::Input::Ref { r#ref } = input {
                        if !declarations.key_index.contains_key(r#ref) {
                            return Err(crate::messages::diagnostic(
                                "tg_schema_unknown_source_input",
                                serde_json::json!({"ref": r#ref}),
                            ));
                        }
                    }
                }
                if !sources.contains(&binding.source) {
                    return Err(crate::messages::diagnostic(
                        "tg_schema_unknown_data_source",
                        serde_json::json!({"p0": binding.source}),
                    ));
                }
            }
        }
        if !collections.is_empty()
            && declarations
                .raw_fields
                .iter()
                .any(|raw| raw.configuration.contains_key("bindings"))
        {
            // Source cycles are a template error even if no concrete rows exist.
            Engine::from_compiled(declarations.clone()).configure_sources(sources.clone())?;
        }
        fn check_namespaces(components: &[RawComponent], inside: bool) -> Result<(), String> {
            fn flatten<'a>(components: &'a [RawComponent], entries: &mut Vec<&'a RawComponent>) {
                for component in components {
                    match component {
                        RawComponent::Group(group) => flatten(&group.subform, entries),
                        _ => entries.push(component),
                    }
                }
            }
            let mut entries = Vec::new();
            flatten(components, &mut entries);
            for (index, entry) in entries.iter().enumerate() {
                for other in entries.iter().skip(index + 1) {
                    if !inside
                        && matches!(
                            (entry, other),
                            (RawComponent::Field(_), RawComponent::Field(_))
                        )
                    {
                        continue;
                    }
                    if entry.key().starts_with(&format!("{}.", other.key()))
                        || other.key().starts_with(&format!("{}.", entry.key()))
                    {
                        return Err(crate::messages::diagnostic(
                            "tg_schema_overlapping_field_or_repeater_namespace_and",
                            serde_json::json!({"p0": entry.key(), "p1": other.key()}),
                        ));
                    }
                }
                if let RawComponent::Repeater(repeater) = entry {
                    check_namespaces(&repeater.template, true)?;
                }
            }
            Ok(())
        }
        check_namespaces(&schema.form, false)?;
        // Check defaults independently of supplied data, even at zero parents.
        validate_defaults(&collections, &declarations)?;
        let mut next_instance = 0;
        let projection::Layout {
            collections,
            flat,
            supplied,
        } = layout(&schema, None, values, &mut next_instance)?;
        let (fields, _) = expand_fields(&schema, &collections)?;
        let paths = fields.iter().map(|field| field.key.clone()).collect();
        let compiled = if collections.is_empty() {
            declarations
        } else {
            compiler
                .compile_expanded(schema.clone(), fields, paths)
                .map_err(|e| e.to_string())?
        };
        let mut engine = Engine::from_compiled(compiled);
        engine.set_processing_limit(processing_limit);
        engine.seed_source_values(&supplied);
        engine.configure_sources(sources)?;
        engine.load_values(Some(&flat)).map_err(|e| e.to_string())?;
        let mut form = Self {
            compiler,
            renderers,
            schema,
            collections,
            next_instance,
            engine,
        };
        form.refresh_metadata()?;
        Ok(form)
    }
    pub fn engine(&self) -> &Engine {
        &self.engine
    }
    #[cfg(any(test, target_arch = "wasm32"))]
    pub(crate) fn engine_mut(&mut self) -> &mut Engine {
        &mut self.engine
    }
    pub fn set_processing_limit(&mut self, limit: usize) {
        self.engine.set_processing_limit(limit);
    }
    pub fn processing_limit(&self) -> usize {
        self.engine.processing_limit()
    }
    pub fn schema(&self) -> &RawSchema {
        &self.schema
    }
    pub fn state(&self) -> &FormState {
        self.engine.state()
    }
    pub fn valid(&self) -> bool {
        self.state()
            .fields
            .values()
            .all(crate::engine::runtime::RuntimeFieldState::valid)
            && self
                .state()
                .repeaters
                .values()
                .all(|collection| collection.errors.is_empty())
    }
    pub fn validate_all(&mut self) -> bool {
        self.engine.validate_all();
        self.valid()
    }
    pub fn process_patch(&mut self, patch: Patch) -> Result<Vec<Patch>, String> {
        self.engine.process_patch(patch).map_err(|e| e.to_string())
    }
    pub fn load_values(&mut self, values: Option<&FormData>) -> Result<bool, String> {
        // Loading replaces meaningful data and intentionally establishes a fresh
        // initialized collection runtime. Structural controls never use this path.
        let candidate = Self::load_with_limit(
            self.compiler.clone(),
            self.renderers.clone(),
            self.schema.clone(),
            values,
            self.engine.processing_limit(),
            self.engine.source_registry(),
        )?;
        let valid = candidate.valid();
        *self = candidate;
        Ok(valid)
    }
    /// Refresh presentation without replacing collections or user data.
    pub fn reload_presentation(&mut self, schema: RawSchema) -> Result<bool, String> {
        if semantic_schema(&self.schema) != semantic_schema(&schema) {
            return Ok(false);
        }
        let mut collections = BTreeMap::new();
        let validation = validate_tree(&schema.form, &self.renderers, &mut collections, false, 0)?;
        let validation = RawSchema {
            schema_version: schema.schema_version.clone(),
            form: validation,
        };
        self.compiler
            .validate_template_structure(&validation)
            .map_err(|e| e.to_string())?;
        let mut next = self.next_instance;
        let collections = layout(&schema, Some(&self.collections), None, &mut next)?.collections;
        self.collections = collections;
        self.next_instance = next;
        self.schema = schema;
        self.refresh_metadata()?;
        Ok(true)
    }
    pub fn add(&mut self, key: &str) -> Result<(), String> {
        let collection = self.collections.get(key).ok_or_else(|| {
            crate::messages::diagnostic(
                "tg_schema_unknown_repeater",
                serde_json::json!({"key": key}),
            )
        })?;
        if collection
            .descriptor
            .max
            .is_some_and(|max| collection.ids.len() >= max)
        {
            return Err(crate::messages::diagnostic(
                "tg_schema_repeater_has_reached_max",
                serde_json::json!({"key": key}),
            ));
        }
        if collection.ids.len() >= MAX_INSTANCES {
            return Err("tg_schema_instance_safety_limit_exceeded".into());
        }
        let next = self
            .next_instance
            .checked_add(1)
            .ok_or("tg_schema_instance_identity_limit_exceeded")?;
        let mut candidate = self.collections.clone();
        candidate.get_mut(key).unwrap().ids.push(self.next_instance);
        self.commit_collections(candidate, next)?;
        Ok(())
    }
    pub fn remove(&mut self, key: &str, index: usize) -> Result<(), String> {
        let collection = self.collections.get(key).ok_or_else(|| {
            crate::messages::diagnostic(
                "tg_schema_unknown_repeater",
                serde_json::json!({"key": key}),
            )
        })?;
        if index >= collection.ids.len() {
            return Err("tg_schema_remove_index_is_out_of_range".into());
        }
        if collection.ids.len() <= collection.descriptor.min {
            return Err(crate::messages::diagnostic(
                "tg_schema_repeater_is_at_min",
                serde_json::json!({"key": key}),
            ));
        }
        let mut candidate = self.collections.clone();
        candidate.get_mut(key).unwrap().ids.remove(index);
        self.commit_collections(candidate, self.next_instance)
    }
    pub fn reorder(&mut self, key: &str, from: usize, to: usize) -> Result<(), String> {
        let collection = self.collections.get(key).ok_or_else(|| {
            crate::messages::diagnostic(
                "tg_schema_unknown_repeater",
                serde_json::json!({"key": key}),
            )
        })?;
        if !collection.descriptor.reorder {
            return Err(crate::messages::diagnostic(
                "tg_schema_reorder_is_disabled_for",
                serde_json::json!({"key": key}),
            ));
        }
        if from >= collection.ids.len() || to >= collection.ids.len() {
            return Err("tg_schema_reorder_index_is_out_of_range".into());
        }
        if from == to {
            return Ok(());
        }
        let mut candidate = self.collections.clone();
        let ids = &mut candidate.get_mut(key).unwrap().ids;
        let id = ids.remove(from);
        ids.insert(to, id);
        self.commit_collections(candidate, self.next_instance)
    }
    fn commit_collections(
        &mut self,
        candidate: BTreeMap<String, Collection>,
        mut next: u64,
    ) -> Result<(), String> {
        let (old_fields, old_identity) = expand_fields(&self.schema, &self.collections)?;
        let old_handles: HashMap<_, _> = old_fields
            .iter()
            .zip(old_identity)
            .map(|(field, identity)| (identity, self.engine.field_handle(&field.key).unwrap()))
            .collect();
        let candidate = layout(&self.schema, Some(&candidate), None, &mut next)?.collections;
        let (fields, identities) = expand_fields(&self.schema, &candidate)?;
        let declarations = fields
            .into_iter()
            .zip(identities)
            .map(|(field, identity)| FieldRegistration {
                handle: old_handles.get(&identity).copied(),
                field,
            })
            .collect();
        self.engine.update_structure(&self.compiler, declarations)?;
        self.collections = candidate;
        self.next_instance = next;
        self.refresh_metadata()
    }
    fn refresh_metadata(&mut self) -> Result<(), String> {
        let mut states = BTreeMap::new();
        for (key, collection) in &self.collections {
            let count = collection.ids.len();
            let descriptor = &collection.descriptor;
            let mut errors = Vec::new();
            if count < descriptor.min {
                errors.push(
                    crate::messages::Message::new("tg_validation_repeater_min")
                        .with_params(serde_json::json!({"min": descriptor.min}))
                        .into(),
                );
            }
            if descriptor.max.is_some_and(|max| count > max) {
                errors.push(
                    crate::messages::Message::new("tg_validation_repeater_max")
                        .with_params(serde_json::json!({"max": descriptor.max.unwrap()}))
                        .into(),
                );
            }
            let label = first_label(&descriptor.template);
            let mut instances = Vec::new();
            for (index, id) in collection.ids.iter().enumerate() {
                let mut form = instantiate(&descriptor.template, key, index);
                validate_references(&mut form, &self.collections, false)?;
                instances.push(RepeaterInstance {
                    id: id.to_string(),
                    label: match &label {
                        Some(label) => crate::messages::Message::new("tg_ui_repeater_instance").with_params(serde_json::json!({"index": index + 1, "label": {"messageKey": label}})).into(),
                        None => format!("#{}", index + 1).into(),
                    },
                    form,
                });
            }
            states.insert(
                key.clone(),
                RepeaterState {
                    length: count,
                    min: descriptor.min,
                    max: descriptor.max,
                    can_add: descriptor.max.is_none_or(|max| count < max) && count < MAX_INSTANCES,
                    can_remove: count > descriptor.min,
                    can_reorder: descriptor.reorder && count > 1,
                    errors,
                    instances,
                },
            );
        }
        self.engine.set_repeaters(states);
        Ok(())
    }
    pub fn values(&self) -> FormData {
        fn item_fields(
            form: &RepeaterForm,
            components: &[RawComponent],
            prefix: &str,
            item: &mut Map<String, Value>,
        ) {
            for component in components {
                match component {
                    RawComponent::Group(group) => item_fields(form, &group.subform, prefix, item),
                    RawComponent::Field(field) => insert_nested(
                        item,
                        field.key.strip_prefix(prefix).unwrap(),
                        serde_json::to_value(&form.state().fields[&field.key].value).unwrap(),
                    ),
                    RawComponent::Repeater(repeater) => insert_nested(
                        item,
                        repeater.key.strip_prefix(prefix).unwrap(),
                        collection_values(form, &repeater.key),
                    ),
                }
            }
        }
        fn collection_values(form: &RepeaterForm, key: &str) -> Value {
            Value::Array(
                form.state().repeaters[key]
                    .instances
                    .iter()
                    .enumerate()
                    .map(|(index, instance)| {
                        let mut item = Map::new();
                        item_fields(form, &instance.form, &format!("{key}[{index}]."), &mut item);
                        Value::Object(item)
                    })
                    .collect(),
            )
        }
        let mut data = BTreeMap::new();
        for key in self.collections.keys().filter(|key| !key.contains('[')) {
            data.insert(key.clone(), collection_values(self, key));
        }
        for (key, state) in &self.state().fields {
            if !key.contains('[') {
                data.insert(key.clone(), serde_json::to_value(&state.value).unwrap());
            }
        }
        data
    }
}
