use crate::schema::RawSchema;
use std::sync::{Arc, Mutex};

use crate::compiler::SchemaCompiler;
use crate::engine::patch::Patch;
use crate::engine::Engine;
use crate::fields::{
    CompiledField, FieldBehavior, FieldCompileError, FieldLibrary, FieldType, FieldValueError,
    RawField, ValidationError,
};
use crate::types::ScalarValue;

#[derive(Clone, Debug)]
struct TrackingFieldType {
    validations: Arc<Mutex<Vec<(String, ScalarValue)>>>,
}

impl FieldType for TrackingFieldType {
    fn type_name(&self) -> &'static str {
        "tracking"
    }

    fn compile(&self, raw: &RawField) -> Result<CompiledField, FieldCompileError> {
        CompiledField::new(
            raw,
            Arc::new(TrackingBehavior {
                key: raw.key.clone(),
                validations: Arc::clone(&self.validations),
            }),
        )
    }
}

#[derive(Debug)]
struct TrackingBehavior {
    key: String,
    validations: Arc<Mutex<Vec<(String, ScalarValue)>>>,
}

impl FieldBehavior for TrackingBehavior {
    fn type_name(&self) -> &'static str {
        "tracking"
    }

    fn normalize_value(&self, value: &ScalarValue) -> Result<ScalarValue, FieldValueError> {
        match value {
            ScalarValue::String(_) | ScalarValue::Null => Ok(value.clone()),
            _ => Err(FieldValueError::InvalidType {
                expected: "tg_schema_string_or_null".to_string(),
                received: crate::fields::compiled::scalar_type(value).to_string(),
            }),
        }
    }

    fn validate(&self, value: &ScalarValue) -> Vec<ValidationError> {
        self.validations
            .lock()
            .expect("validation log mutex should not be poisoned")
            .push((self.key.clone(), value.clone()));
        Vec::new()
    }
}

#[test]
fn validates_only_changed_values_after_propagation_stabilizes_in_field_order() {
    let validations = Arc::new(Mutex::new(Vec::new()));
    let mut library = FieldLibrary::new();
    library
        .register(TrackingFieldType {
            validations: Arc::clone(&validations),
        })
        .expect("tracking field should register");

    let raw: Vec<RawField> = serde_json::from_str(
        r#"[
            {"key":"source","type":"tracking"},
            {
                "key":"target",
                "type":"tracking",
                "rules":[
                    {
                        "when":{"property":"source","operation":"Eq","value":"go"},
                        "then":[{"kind":"set_value","value":"intermediate"}]
                    },
                    {
                        "when":{"property":"source","operation":"Eq","value":"go"},
                        "then":[{"kind":"set_value","value":"stable"}]
                    }
                ]
            },
            {"key":"untouched","type":"tracking","current_value":"unchanged"}
        ]"#,
    )
    .expect("tracking schema should deserialize");

    let compiled = SchemaCompiler::with_library(library)
        .compile(RawSchema::from_fields(raw))
        .expect("tracking schema should compile");
    let mut engine = Engine::from_compiled(compiled);

    engine
        .process_patch(Patch::SetValue {
            key: "source".to_string(),
            value: ScalarValue::String("go".to_string()),
        })
        .expect("tracking patch should stabilize");

    assert_eq!(
        *validations
            .lock()
            .expect("validation log mutex should not be poisoned"),
        vec![
            ("source".to_string(), ScalarValue::String("go".to_string())),
            (
                "target".to_string(),
                ScalarValue::String("stable".to_string())
            ),
        ],
        "validation must run once, after the final value, in schema field order"
    );
}

#[test]
fn validate_all_checks_untouched_fields_in_schema_order() {
    let validations = Arc::new(Mutex::new(Vec::new()));
    let mut library = FieldLibrary::new();
    library
        .register(TrackingFieldType {
            validations: Arc::clone(&validations),
        })
        .expect("tracking field should register");

    let raw: Vec<RawField> = serde_json::from_str(
        r#"[
            {"key":"first","type":"tracking","current_value":"one"},
            {"key":"second","type":"tracking","current_value":"two"},
            {"key":"third","type":"tracking"}
        ]"#,
    )
    .expect("tracking schema should deserialize");

    let compiled = SchemaCompiler::with_library(library)
        .compile(RawSchema::from_fields(raw))
        .expect("tracking schema should compile");
    let mut engine = Engine::from_compiled(compiled);

    assert!(engine.validate_all());
    assert_eq!(
        *validations
            .lock()
            .expect("validation log mutex should not be poisoned"),
        vec![
            ("first".to_string(), ScalarValue::String("one".to_string())),
            ("second".to_string(), ScalarValue::String("two".to_string())),
            ("third".to_string(), ScalarValue::Null),
        ]
    );
}

#[test]
fn validate_all_preserves_behavior_errors_in_combined_validity() {
    let raw: Vec<RawField> = serde_json::from_str(
        r#"[
            {
                "key":"name",
                "type":"text",
                "errors":["Rule-generated error"],
                "validators":[{"kind":"required"}]
            }
        ]"#,
    )
    .expect("text schema should deserialize");

    let compiled = SchemaCompiler::new()
        .compile(RawSchema::from_fields(raw))
        .expect("text schema should compile");
    let mut engine = Engine::from_compiled(compiled);

    assert!(!engine.validate_all());

    let state = engine
        .field_state("name")
        .expect("compiled field should have runtime state");
    assert_eq!(state.behavior_errors(), &["Rule-generated error"]);
    assert_eq!(state.validation_errors().len(), 1);
    assert_eq!(
        serde_json::to_value(&state.errors).unwrap(),
        serde_json::json!(["Rule-generated error", {"messageKey": "tg_validation_required"}])
    );
}

#[test]
fn validate_all_clears_stale_validation_errors_when_form_becomes_valid() {
    let raw: Vec<RawField> = serde_json::from_str(
        r#"[{"key":"name","type":"text","validators":[{"kind":"required"}]}]"#,
    )
    .expect("text schema should deserialize");

    let compiled = SchemaCompiler::new()
        .compile(RawSchema::from_fields(raw))
        .expect("text schema should compile");
    let mut engine = Engine::from_compiled(compiled);

    assert!(!engine.validate_all());
    assert!(!engine
        .field_state("name")
        .expect("compiled field should have runtime state")
        .errors
        .is_empty());

    engine
        .process_patch(Patch::SetValue {
            key: "name".to_string(),
            value: ScalarValue::String("Ada".to_string()),
        })
        .expect("valid text patch should process");

    assert!(engine.validate_all());
    assert!(engine
        .field_state("name")
        .expect("compiled field should have runtime state")
        .errors
        .is_empty());
}

#[test]
fn loading_validates_each_eligible_field_once_after_final_values_stabilize() {
    let validations = Arc::new(Mutex::new(Vec::new()));
    let mut library = FieldLibrary::new();
    library
        .register(TrackingFieldType {
            validations: Arc::clone(&validations),
        })
        .unwrap();
    let raw: Vec<RawField> = serde_json::from_str(
        r#"[
        {"key":"target","type":"tracking","rules":[
            {"when":{"property":"source","operation":"Eq","value":"go"},"then":[
                {"kind":"set_value","value":"intermediate"},{"kind":"set_value","value":"stable"}
            ]}
        ]},
        {"key":"source","type":"tracking","current_value":"go"},
        {"key":"untouched","type":"tracking","hidden":true}
    ]"#,
    )
    .unwrap();
    let compiled = SchemaCompiler::with_library(library)
        .compile(RawSchema::from_fields(raw))
        .unwrap();
    let mut engine = Engine::from_compiled(compiled);
    assert!(engine.load_values(None).unwrap());
    assert_eq!(
        *validations.lock().unwrap(),
        vec![
            ("target".into(), ScalarValue::String("stable".into())),
            ("source".into(), ScalarValue::String("go".into())),
        ]
    );
}
