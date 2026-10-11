use crate::compiler::SchemaCompiler;
use crate::engine::graph::TriggerIndex;
use crate::engine::patch::Patch;
use crate::engine::runtime::FormState;
use crate::repeaters::{FormData, RepeaterForm};
use crate::schema::RawSchema;
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use wasm_bindgen::prelude::*;

#[derive(Debug, Serialize)]
pub struct LoadFormResponse {
    pub schema: RawSchema,
    pub state: FormState,
    pub graph: TriggerIndex,
    pub valid: bool,
    pub generation: String,
    pub revision: String,
    pub effects: Vec<crate::sources::SourceEffect>,
}

#[derive(Debug, Serialize)]
pub struct ProcessPatchResponse {
    pub patches: Vec<Patch>,
    pub state: FormState,
}

#[derive(Debug, Serialize)]
pub struct ValidateFormResponse {
    pub valid: bool,
    pub state: FormState,
}

#[wasm_bindgen]
pub struct EngineRuntime {
    engine: Option<RepeaterForm>,
    initial_values: Option<FormData>,
    sources: BTreeSet<String>,
    generation: u64,
    revision: u64,
    processing_limit: usize,
}

#[wasm_bindgen]
impl EngineRuntime {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        console_error_panic_hook::set_once();
        Self {
            engine: None,
            initial_values: None,
            sources: Default::default(),
            generation: 0,
            revision: 0,
            processing_limit: 100,
        }
    }

    #[wasm_bindgen]
    pub fn set_processing_limit(&mut self, limit: f64) -> Result<(), JsValue> {
        if !limit.is_finite() || limit < 1.0 || limit.fract() != 0.0 || limit > u32::MAX as f64 {
            return Err(JsValue::from_str("tg_schema_invalid_processing_limit"));
        }
        self.processing_limit = limit as usize;
        if let Some(form) = &mut self.engine {
            form.set_processing_limit(self.processing_limit);
        }
        Ok(())
    }
    #[wasm_bindgen]
    pub fn take_warnings(&mut self) -> String {
        serde_json::to_string(
            &self
                .engine
                .as_mut()
                .map(|form| form.engine_mut().take_warnings())
                .unwrap_or_default(),
        )
        .unwrap()
    }

    /// Registry discovery does not require an installed form.
    #[wasm_bindgen]
    pub fn get_catalog(&self) -> Result<String, JsValue> {
        let catalog = crate::catalog::AuthoringCatalog::from_registries(
            &SchemaCompiler::new(),
            &crate::repeaters::RepeaterRenderLibrary::default(),
        );
        serde_json::to_string(&catalog).map_err(|e| JsValue::from_str(&e.to_string()))
    }

    #[wasm_bindgen]
    pub fn load_form(&mut self, json: &str) -> Result<String, JsValue> {
        self.load_form_with_values(json, "null", true)
    }

    #[wasm_bindgen]
    pub fn load_form_integrated(
        &mut self,
        json: &str,
        values: &str,
        preserve: bool,
        sources: &str,
    ) -> Result<String, JsValue> {
        let sources: BTreeSet<String> = serde_json::from_str(sources).map_err(js_error)?;
        let preserve = preserve && sources == self.sources;
        let previous = std::mem::replace(&mut self.sources, sources);
        let result = self.load_form_with_values(json, values, preserve);
        if result.is_err() {
            self.sources = previous;
        }
        result
    }

    /// Initialize the schema, load all values, evaluate and validate before commit.
    /// Hosts may preserve state for equivalent data and presentation-only reloads.
    #[wasm_bindgen]
    pub fn load_form_with_values(
        &mut self,
        json: &str,
        values_json: &str,
        preserve_state: bool,
    ) -> Result<String, JsValue> {
        let schema: RawSchema = serde_json::from_str(json).map_err(|e| {
            JsValue::from_str(&crate::messages::diagnostic(
                "tg_schema_failed_to_deserialize_schema",
                serde_json::json!({"e": e.to_string()}),
            ))
        })?;
        let values: Option<FormData> = serde_json::from_str(values_json).map_err(|e| {
            JsValue::from_str(&crate::messages::diagnostic(
                "tg_schema_failed_to_deserialize_initial_values",
                serde_json::json!({"e": e.to_string()}),
            ))
        })?;
        if preserve_state && self.initial_values == values {
            if let Some(engine) = &mut self.engine {
                if engine
                    .reload_presentation(schema.clone())
                    .map_err(|error| JsValue::from_str(&error))?
                {
                    let response = LoadFormResponse {
                        schema: engine.schema().clone(),
                        state: engine.state().clone(),
                        graph: engine.engine().graph().clone(),
                        valid: engine.valid(),
                        generation: self.generation.to_string(),
                        revision: self.revision.to_string(),
                        effects: engine.engine_mut().source_effects(),
                    };
                    return serde_json::to_string(&response)
                        .map_err(|error| JsValue::from_str(&error.to_string()));
                }
            }
        }
        let mut candidate = RepeaterForm::load_with_limit(
            SchemaCompiler::new(),
            crate::repeaters::RepeaterRenderLibrary::default(),
            schema,
            values.as_ref(),
            self.processing_limit,
            self.sources.clone(),
        )
        .map_err(|error| {
            JsValue::from_str(&crate::messages::diagnostic(
                "tg_schema_failed_to_load_form",
                serde_json::json!({"error": (error).to_string()}),
            ))
        })?;
        self.generation += 1;
        self.revision = 0;
        let valid = candidate.valid();
        let response = LoadFormResponse {
            schema: candidate.schema().clone(),
            state: candidate.state().clone(),
            graph: candidate.engine().graph().clone(),
            valid,
            generation: self.generation.to_string(),
            revision: self.revision.to_string(),
            effects: candidate.engine_mut().source_effects(),
        };
        let json = serde_json::to_string(&response).map_err(|e| {
            JsValue::from_str(&crate::messages::diagnostic(
                "tg_schema_failed_to_serialize_load_response",
                serde_json::json!({"e": e.to_string()}),
            ))
        })?;
        candidate.engine_mut().take_dirty();
        self.engine = Some(candidate);
        self.initial_values = values;
        Ok(json)
    }

    /// Reload meaningful data on an installed schema without recompiling it.
    #[wasm_bindgen]
    pub fn load_values(&mut self, values_json: &str) -> Result<String, JsValue> {
        let values: Option<FormData> = serde_json::from_str(values_json).map_err(|e| {
            JsValue::from_str(&crate::messages::diagnostic(
                "tg_schema_failed_to_deserialize_initial_values",
                serde_json::json!({"e": e.to_string()}),
            ))
        })?;
        let engine = self.engine.as_mut().ok_or_else(|| {
            JsValue::from_str("tg_schema_engine_not_initialized_call_load_form_first")
        })?;
        let candidate = RepeaterForm::load_with_limit(
            SchemaCompiler::new(),
            crate::repeaters::RepeaterRenderLibrary::default(),
            engine.schema().clone(),
            values.as_ref(),
            self.processing_limit,
            self.sources.clone(),
        )
        .map_err(|error| JsValue::from_str(&error))?;
        let response = ValidateFormResponse {
            valid: candidate.valid(),
            state: candidate.state().clone(),
        };
        let json = serde_json::to_string(&response)
            .map_err(|error| JsValue::from_str(&error.to_string()))?;
        self.generation += 1;
        self.revision = 0;
        self.engine = Some(candidate);
        self.initial_values = values;
        Ok(json)
    }

    /// Commands are serialized by the worker. Structure commits before ordinary evaluation.
    #[wasm_bindgen]
    pub fn add_instance(&mut self, key: &str) -> Result<String, JsValue> {
        let form = self
            .engine
            .as_mut()
            .ok_or_else(|| JsValue::from_str("tg_schema_engine_not_initialized"))?;
        form.add(key).map_err(|error| JsValue::from_str(&error))?;
        self.integration_snapshot()
    }
    #[wasm_bindgen]
    pub fn remove_instance(&mut self, key: &str, index: f64) -> Result<String, JsValue> {
        let form = self
            .engine
            .as_mut()
            .ok_or_else(|| JsValue::from_str("tg_schema_engine_not_initialized"))?;
        form.remove(key, checked_index(index)?)
            .map_err(|error| JsValue::from_str(&error))?;
        self.integration_snapshot()
    }
    #[wasm_bindgen]
    pub fn reorder_instance(&mut self, key: &str, from: f64, to: f64) -> Result<String, JsValue> {
        let form = self
            .engine
            .as_mut()
            .ok_or_else(|| JsValue::from_str("tg_schema_engine_not_initialized"))?;
        form.reorder(key, checked_index(from)?, checked_index(to)?)
            .map_err(|error| JsValue::from_str(&error))?;
        self.integration_snapshot()
    }
    #[wasm_bindgen]
    pub fn get_values(&self) -> Result<String, JsValue> {
        let form = self
            .engine
            .as_ref()
            .ok_or_else(|| JsValue::from_str("tg_schema_engine_not_initialized"))?;
        serde_json::to_string(&form.values()).map_err(|error| JsValue::from_str(&error.to_string()))
    }

    #[wasm_bindgen]
    pub fn process_patch(&mut self, patch_json: &str) -> Result<String, JsValue> {
        let patch: Patch = serde_json::from_str(patch_json).map_err(|e| {
            JsValue::from_str(&crate::messages::diagnostic(
                "tg_schema_failed_to_deserialize_patch",
                serde_json::json!({"e": e.to_string()}),
            ))
        })?;

        let engine = self.engine.as_mut().ok_or_else(|| {
            JsValue::from_str("tg_schema_engine_not_initialized_call_load_form_first")
        })?;

        let patches = engine.process_patch(patch).map_err(|e| {
            JsValue::from_str(&crate::messages::diagnostic(
                "tg_schema_failed_to_process_patch",
                serde_json::json!({"e": e.to_string()}),
            ))
        })?;

        let response = ProcessPatchResponse {
            patches,
            state: engine.state().clone(),
        };

        serde_json::to_string(&response).map_err(|e| {
            JsValue::from_str(&crate::messages::diagnostic(
                "tg_schema_failed_to_serialize_patch_response",
                serde_json::json!({"e": e.to_string()}),
            ))
        })
    }

    #[wasm_bindgen]
    pub fn process_patch_delta(&mut self, patch_json: &str) -> Result<String, JsValue> {
        let patch: Patch = serde_json::from_str(patch_json).map_err(js_error)?;
        let form = self
            .engine
            .as_mut()
            .ok_or_else(|| JsValue::from_str("tg_schema_engine_not_initialized"))?;
        let patches = form.process_patch(patch).map_err(js_error)?;
        self.delta(patches)
    }
    #[wasm_bindgen]
    pub fn integrate(&mut self, generation: &str, command_json: &str) -> Result<String, JsValue> {
        if generation != self.generation.to_string() {
            return self.delta(vec![]);
        }
        let command: IntegrationCommand = serde_json::from_str(command_json).map_err(js_error)?;
        let engine = self
            .engine
            .as_mut()
            .ok_or_else(|| JsValue::from_str("tg_schema_engine_not_initialized"))?
            .engine_mut();
        match command {
            IntegrationCommand::Source { command } => {
                engine.source_command(command).map_err(js_error)?;
            }
            IntegrationCommand::Upload {
                handle,
                file_id,
                loading,
                error,
                uploaded,
            } => {
                let registration = engine
                    .registrations()
                    .into_iter()
                    .find(|r| r.handle.is_some_and(|h| h.0.to_string() == handle));
                if let Some(registration) = registration {
                    let key = registration.field.key;
                    if let crate::ScalarValue::Files(mut value) =
                        engine.field_state(&key).unwrap().value.clone()
                    {
                        if let Some(file) = value
                            .files
                            .iter_mut()
                            .find(|f| f.id == file_id && !f.uploaded)
                        {
                            if let Some(uploaded) = uploaded {
                                *file = uploaded;
                                engine
                                    .process_patch(Patch::SetValue {
                                        key: key.clone(),
                                        value: crate::ScalarValue::Files(value),
                                    })
                                    .map_err(js_error)?;
                            }
                            engine
                                .set_upload_state(&key, loading, error)
                                .map_err(js_error)?;
                        }
                    }
                }
            }
        }
        self.delta(vec![])
    }
    #[wasm_bindgen]
    pub fn integration_metadata(&mut self) -> Result<String, JsValue> {
        serde_json::to_string(&self.metadata()?).map_err(js_error)
    }
    #[wasm_bindgen]
    pub fn integration_snapshot(&mut self) -> Result<String, JsValue> {
        self.snapshot(false)
    }
    #[wasm_bindgen]
    pub fn validate_integrated(&mut self) -> Result<String, JsValue> {
        self.engine
            .as_mut()
            .ok_or_else(|| JsValue::from_str("tg_schema_engine_not_initialized"))?
            .validate_all();
        self.snapshot(true)
    }
    #[wasm_bindgen]
    pub fn validate_form(&mut self) -> Result<String, JsValue> {
        let engine = self.engine.as_mut().ok_or_else(|| {
            JsValue::from_str("tg_schema_engine_not_initialized_call_load_form_first")
        })?;

        let valid = engine.validate_all();
        let response = ValidateFormResponse {
            valid,
            state: engine.state().clone(),
        };

        serde_json::to_string(&response).map_err(|e| {
            JsValue::from_str(&crate::messages::diagnostic(
                "tg_schema_failed_to_serialize_validation_response",
                serde_json::json!({"e": e.to_string()}),
            ))
        })
    }

    #[wasm_bindgen]
    pub fn get_state(&self) -> Result<String, JsValue> {
        let engine = self
            .engine
            .as_ref()
            .ok_or_else(|| JsValue::from_str("tg_schema_engine_not_initialized"))?;

        serde_json::to_string(engine.state()).map_err(|e| {
            JsValue::from_str(&crate::messages::diagnostic(
                "tg_schema_failed_to_serialize_state",
                serde_json::json!({"e": e.to_string()}),
            ))
        })
    }
}

#[derive(Serialize)]
struct IntegrationMetadata {
    handles: std::collections::BTreeMap<String, String>,
    effects: Vec<crate::sources::SourceEffect>,
    generation: String,
    revision: String,
}
#[derive(Serialize)]
struct IntegrationSnapshot<'a> {
    state: &'a FormState,
    valid: bool,
    #[serde(flatten)]
    metadata: IntegrationMetadata,
    #[serde(skip_serializing_if = "Option::is_none")]
    values: Option<FormData>,
}
impl EngineRuntime {
    fn metadata(&mut self) -> Result<IntegrationMetadata, JsValue> {
        let form = self
            .engine
            .as_mut()
            .ok_or_else(|| JsValue::from_str("tg_schema_engine_not_initialized"))?;
        let handles = form
            .engine()
            .field_handles()
            .map(|(key, handle)| (key.to_string(), handle.0.to_string()))
            .collect();
        form.engine_mut().take_dirty();
        Ok(IntegrationMetadata {
            handles,
            effects: form.engine_mut().source_effects(),
            generation: self.generation.to_string(),
            revision: self.revision.to_string(),
        })
    }
    fn snapshot(&mut self, values: bool) -> Result<String, JsValue> {
        let metadata = self.metadata()?;
        let form = self.engine.as_ref().unwrap();
        serde_json::to_string(&IntegrationSnapshot {
            state: form.state(),
            valid: form.valid(),
            metadata,
            values: values.then(|| form.values()),
        })
        .map_err(js_error)
    }
}

fn checked_index(value: f64) -> Result<usize, JsValue> {
    if !value.is_finite() || value < 0.0 || value.fract() != 0.0 || value > u32::MAX as f64 {
        return Err(JsValue::from_str(
            "tg_schema_instance_index_must_be_a_nonnegative_integer_within_the_supported_range",
        ));
    }
    Ok(value as usize)
}

fn js_error(error: impl std::fmt::Display) -> JsValue {
    JsValue::from_str(&error.to_string())
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
enum IntegrationCommand {
    Source {
        command: crate::sources::SourceCommand,
    },
    Upload {
        handle: String,
        #[serde(rename = "fileId")]
        file_id: String,
        loading: bool,
        error: Option<String>,
        uploaded: Option<crate::FileReference>,
    },
}
impl EngineRuntime {
    fn delta(&mut self, patches: Vec<Patch>) -> Result<String, JsValue> {
        let form = self
            .engine
            .as_mut()
            .ok_or_else(|| JsValue::from_str("tg_schema_engine_not_initialized"))?;
        let fields = form.engine_mut().take_dirty();
        let effects = form.engine_mut().source_effects();
        let base = self.revision;
        self.revision += 1;
        serde_json::to_string(&serde_json::json!({ "patches": patches, "fields": fields, "effects": effects, "generation": self.generation.to_string(), "baseRevision": base.to_string(), "revision": self.revision.to_string() })).map_err(js_error)
    }
}
