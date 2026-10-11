use crate::compiler::SchemaCompiler;
use crate::engine::runtime::RuntimeFieldState;
use crate::engine::Engine;
use crate::schema::RawSchema;

pub const VISIBILITY_SCHEMA: &str = include_str!("../../tests/fixtures/visibility.json");

pub const DEPENDENCIES_SCHEMA: &str = include_str!("../../tests/fixtures/dependencies.json");

pub const NOOP_SCHEMA: &str = include_str!("../../tests/fixtures/noop.json");

pub const DUPLICATE_KEYS_SCHEMA: &str = include_str!("../../tests/fixtures/duplicate_keys.json");

pub const UNKNOWN_DEPENDENCY_SCHEMA: &str =
    include_str!("../../tests/fixtures/unknown_dependency.json");

pub const UNKNOWN_OPERAND_REFERENCE_SCHEMA: &str =
    include_str!("../../tests/fixtures/unknown_operand_reference.json");

pub const MUTUAL_DEPENDENCY_CONVERGES_SCHEMA: &str =
    include_str!("../../tests/fixtures/mutual_dependency_converges.json");

pub const STATIC_STATE_CYCLE_SCHEMA: &str =
    include_str!("../../tests/fixtures/static_state_cycle.json");

pub fn engine_from_json(json: &str) -> Engine {
    let schema = schema_from_json(json);
    let compiled = SchemaCompiler::new()
        .compile(schema)
        .expect("fixture schema should compile");

    Engine::from_compiled(compiled)
}

pub fn field_state<'a>(engine: &'a Engine, key: &str) -> &'a RuntimeFieldState {
    engine
        .field_state(key)
        .unwrap_or_else(|| panic!("expected runtime field `{}`", key))
}

// Existing field-focused tests may construct leaf arrays; production only accepts RawSchema.
pub fn schema_from_json(json: &str) -> RawSchema {
    let value: serde_json::Value = serde_json::from_str(json).expect("test schema JSON");
    if value.is_array() {
        RawSchema::from_fields(serde_json::from_value(value).expect("test fields"))
    } else {
        serde_json::from_value(value).expect("test Sprout schema")
    }
}
