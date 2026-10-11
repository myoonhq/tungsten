use std::fs;

use tungsten_core::compiler::SchemaCompiler;
use tungsten_core::engine::patch::Patch;
use tungsten_core::engine::Engine;
use tungsten_core::schema::RawSchema;
use tungsten_core::ScalarValue;

fn main() {
    let input = fs::read_to_string("src/example-input/example2.json")
        .expect("failed to read example input");
    let schema: RawSchema = serde_json::from_str(&input).expect("failed to deserialize schema");
    let compiled = SchemaCompiler::new()
        .compile(schema)
        .expect("failed to compile schema");

    println!("Loaded schema:\n{:#?}", compiled.schema());
    println!("Initial form state:\n{:#?}", compiled.state());
    println!("Graph:\n{:#?}", compiled.graph());

    let mut engine = Engine::from_compiled(compiled);

    engine
        .process_patch(Patch::SetValue {
            key: "name".to_string(),
            value: ScalarValue::String("Daniel".to_string()),
        })
        .expect("patch should process");

    println!("Final state:\n{:#?}", engine.state());
}
