use criterion::{criterion_group, criterion_main, Criterion};
use serde_json::json;
use std::{hint::black_box, time::Duration};
use tungsten_core::{
    compiler::SchemaCompiler,
    engine::{patch::Patch, Engine},
    schema::RawSchema,
    ScalarValue,
};
fn core(count: usize) -> Engine {
    let fields:Vec<_>=(0..count).map(|index|json!({"type":"text","key":format!("f{index}"),"current_value":"ready","validators":[{"kind":"required"}]})).collect();
    let schema: RawSchema =
        serde_json::from_value(json!({"schemaVersion":"sprout","form":fields})).unwrap();
    let mut core = Engine::from_compiled(SchemaCompiler::new().compile(schema).unwrap());
    core.load_values(None).unwrap();
    core
}
fn localized_edits(criterion: &mut Criterion) {
    for count in [10, 100, 1000, 10000] {
        let mut engine = core(count);
        let mut index = 0;
        let mut edit = || {
            index += 1;
            let patches = engine
                .process_patch(Patch::SetValue {
                    key: "f0".into(),
                    value: ScalarValue::String(format!("edit-{index}")),
                })
                .unwrap();
            assert_eq!(
                patches.len(),
                1,
                "unrelated fields must not inflate affected patches"
            );
            black_box(patches);
        };
        if cfg!(debug_assertions) || !cfg!(feature = "benchmarks") {
            edit();
            continue;
        }
        let mut group = criterion.benchmark_group(format!("localized_edit/{count}_fields"));
        group.warm_up_time(Duration::from_millis(250));
        group.measurement_time(Duration::from_secs(1));
        group.sample_size(20);
        group.bench_function("one_field_with_required_validation", |b| b.iter(&mut edit));
        group.finish();
    }
}
criterion_group!(benches, localized_edits);
criterion_main!(benches);
