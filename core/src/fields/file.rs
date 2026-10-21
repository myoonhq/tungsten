use super::{
    CompiledField, FieldBehavior, FieldCompileError, FieldType, FieldValueError, RawField,
    ValidationError,
};
use crate::{FileValue, ScalarValue};
use serde::{Deserialize, Serialize};
use std::sync::Arc;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Upload {
    pub api: String,
    pub endpoint: String,
    #[serde(default = "post")]
    pub method: String,
    #[serde(default = "submit")]
    pub timing: String,
    #[serde(default = "file")]
    pub field_name: String,
    #[serde(default)]
    pub result_path: String,
}
fn post() -> String {
    "POST".into()
}
fn submit() -> String {
    "submit".into()
}
fn file() -> String {
    "file".into()
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileSettings {
    pub upload: Upload,
    #[serde(default)]
    pub multiple: bool,
    #[serde(default)]
    pub max_files: Option<usize>,
    #[serde(default)]
    pub max_size: Option<u64>,
    #[serde(default)]
    pub accept: Vec<String>,
}
impl FileSettings {
    pub fn read(raw: &RawField) -> Result<Self, FieldCompileError> {
        let mut config = raw.configuration.clone();
        config.remove("bindings");
        let settings: Self = serde_json::from_value(serde_json::to_value(config).unwrap())
            .map_err(|e| FieldCompileError::InvalidConfiguration {
                message: crate::messages::diagnostic(
                    "tg_schema_invalid_file_configuration",
                    serde_json::json!({"e": e.to_string()}),
                ),
            })?;
        let upload = &settings.upload;
        let invalid = |setting: &str, reason: &str| FieldCompileError::InvalidConfiguration {
            message: crate::messages::diagnostic(
                "tg_schema_invalid_file_setting",
                serde_json::json!({"setting": setting, "reason": {"messageKey": reason}}),
            ),
        };
        for (setting, value) in [
            ("upload.api", &upload.api),
            ("upload.endpoint", &upload.endpoint),
            ("upload.fieldName", &upload.field_name),
        ] {
            if value.trim().is_empty() {
                return Err(invalid(setting, "tg_catalog_a_nonempty_string_is_required"));
            }
        }
        if !["POST", "PUT", "PATCH"].contains(&upload.method.as_str()) {
            return Err(invalid("upload.method", "tg_schema_file_upload_method"));
        }
        if !["submit", "selection"].contains(&upload.timing.as_str()) {
            return Err(invalid("upload.timing", "tg_schema_file_upload_timing"));
        }
        if !upload.result_path.is_empty() && !upload.result_path.starts_with('/') {
            return Err(invalid(
                "upload.resultPath",
                "tg_api_result_path_must_be_a_json_pointer",
            ));
        }
        if settings.max_files == Some(0) {
            return Err(invalid("maxFiles", "tg_schema_file_max_files"));
        }
        if settings
            .accept
            .iter()
            .any(|s| s.is_empty() || (!s.starts_with('.') && !s.contains('/')))
        {
            return Err(invalid("accept", "tg_schema_file_accept"));
        }
        Ok(settings)
    }
    pub fn accepts(&self, name: &str, media_type: &str) -> bool {
        self.accept.is_empty()
            || self.accept.iter().any(|entry| {
                if entry.starts_with('.') {
                    name.to_lowercase().ends_with(&entry.to_lowercase())
                } else if let Some(prefix) = entry.strip_suffix("/*") {
                    media_type.starts_with(&format!("{prefix}/"))
                } else {
                    entry == media_type
                }
            })
    }
}

#[derive(Clone, Copy, Debug)]
pub struct FileFieldType;
impl FieldType for FileFieldType {
    fn type_name(&self) -> &'static str {
        "file"
    }
    fn descriptor(&self) -> crate::catalog::FieldDescriptor {
        let mut descriptor = crate::catalog::scalar(
            "file",
            "tg_schema_file",
            "tg_schema_file_references_upload_is_configured_per_field_settings_use_json",
            "files",
            vec![crate::catalog::validator(
                "required",
                "tg_catalog_required",
                "tg_validation_file_required",
                false,
                false,
            )],
        );
        descriptor.settings = None;
        descriptor
    }
    fn compile(&self, raw: &RawField) -> Result<CompiledField, FieldCompileError> {
        let settings = FileSettings::read(raw)?;
        let required = super::select::required(raw)?;
        CompiledField::new(raw, Arc::new(FileBehavior { settings, required }))
    }
}
#[derive(Debug)]
struct FileBehavior {
    settings: FileSettings,
    required: bool,
}
impl FieldBehavior for FileBehavior {
    fn type_name(&self) -> &'static str {
        "file"
    }
    fn default_value(&self) -> ScalarValue {
        ScalarValue::Files(FileValue { files: vec![] })
    }
    fn normalize_value(&self, value: &ScalarValue) -> Result<ScalarValue, FieldValueError> {
        let files = match value {
            ScalarValue::Files(value) => &value.files,
            ScalarValue::Null => return Ok(self.default_value()),
            _ => {
                return Err(FieldValueError::InvalidType {
                    expected: "tg_schema_file_reference_object".into(),
                    received: super::compiled::scalar_type(value).into(),
                })
            }
        };
        let mut ids = std::collections::HashSet::new();
        if files.iter().any(|f| {
            f.id.is_empty()
                || f.name.is_empty()
                || f.size > 9_007_199_254_740_991
                || !ids.insert(&f.id)
        }) {
            return Err(FieldValueError::InvalidValue {
                message: "tg_schema_file_ids_names_must_be_nonempty_unique_with_safe_integer_sizes"
                    .into(),
            });
        }
        Ok(value.clone())
    }
    fn validate(&self, value: &ScalarValue) -> Vec<ValidationError> {
        let files = match value {
            ScalarValue::Files(value) => &value.files,
            _ => return vec![],
        };
        let mut errors = vec![];
        if self.required && files.is_empty() {
            errors.push(ValidationError::new(
                "required",
                "tg_validation_file_required",
            ));
        }
        let max = if self.settings.multiple {
            self.settings.max_files.unwrap_or(usize::MAX)
        } else {
            1
        };
        if files.len() > max {
            errors.push(
                ValidationError::new("max_files", "tg_validation_max_files")
                    .with_params(serde_json::json!({"max": max})),
            );
        }
        if files
            .iter()
            .any(|file| self.settings.max_size.is_some_and(|size| file.size > size))
        {
            errors.push(ValidationError::new("max_size", "tg_validation_max_size"));
        }
        if files
            .iter()
            .any(|file| !self.settings.accepts(&file.name, &file.media_type))
        {
            errors.push(ValidationError::new("file_type", "tg_validation_file_type"));
        }
        errors
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn invalid_settings_name_the_property_and_localizable_reason() {
        for (config, property, reason) in [
            (
                json!({"upload":{"api":"","endpoint":"files"}}),
                "upload.api",
                "tg_catalog_a_nonempty_string_is_required",
            ),
            (
                json!({"upload":{"api":"main","endpoint":""}}),
                "upload.endpoint",
                "tg_catalog_a_nonempty_string_is_required",
            ),
            (
                json!({"upload":{"api":"main","endpoint":"files","fieldName":""}}),
                "upload.fieldName",
                "tg_catalog_a_nonempty_string_is_required",
            ),
            (
                json!({"upload":{"api":"main","endpoint":"files","method":"GET"}}),
                "upload.method",
                "tg_schema_file_upload_method",
            ),
            (
                json!({"upload":{"api":"main","endpoint":"files","timing":"later"}}),
                "upload.timing",
                "tg_schema_file_upload_timing",
            ),
            (
                json!({"upload":{"api":"main","endpoint":"files","resultPath":"data"}}),
                "upload.resultPath",
                "tg_api_result_path_must_be_a_json_pointer",
            ),
            (
                json!({"upload":{"api":"main","endpoint":"files"},"maxFiles":0}),
                "maxFiles",
                "tg_schema_file_max_files",
            ),
            (
                json!({"upload":{"api":"main","endpoint":"files"},"accept":["pdf"]}),
                "accept",
                "tg_schema_file_accept",
            ),
        ] {
            let mut raw: RawField =
                serde_json::from_value(json!({"type":"file","key":"attachment"})).unwrap();
            raw.configuration = serde_json::from_value(config).unwrap();
            let error = FileSettings::read(&raw).unwrap_err();
            let value: Value = serde_json::from_str(&error.to_string()).unwrap();
            assert_eq!(value["messageKey"], "tg_schema_invalid_file_setting");
            assert_eq!(value["params"]["setting"], property);
            assert_eq!(value["params"]["reason"]["messageKey"], reason);
        }
    }
}
