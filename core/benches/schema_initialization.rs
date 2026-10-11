use std::hint::black_box;
use std::time::{Duration, Instant};

use criterion::{criterion_group, criterion_main, BatchSize, Criterion, Throughput};
use serde_json::{json, Value};

use tungsten_core::compiler::SchemaCompiler;
use tungsten_core::schema::RawSchema;

const FIELD_COUNTS: [usize; 4] = [10, 100, 1_000, 10_000];

struct BenchmarkDataset {
    name: String,
    field_count: usize,
    json: String,
}

fn field_type(index: usize) -> &'static str {
    match index % 3 {
        0 => "number",
        1 => "text",
        _ => "email",
    }
}

fn representative_value(index: usize) -> Value {
    match field_type(index) {
        "number" => json!(1),
        "text" => json!("ready"),
        "email" => json!("ready@example.com"),
        _ => unreachable!("field_type only returns registered benchmark types"),
    }
}

fn field_key(index: usize) -> String {
    format!("field_{index:05}")
}

fn generated_field(index: usize, rules: Vec<Value>) -> Value {
    let mut field = json!({
        "key": field_key(index),
        "type": if field_type(index) == "email" { "text" } else { field_type(index) },
        "variant": if field_type(index) == "email" { "email" } else { "plain" },
        "view": {
            "label": format!("Generated field {index}")
        },
        "validators": [
            {
                "kind": "required"
            }
        ],
        "rules": rules
    });
    if field_type(index) == "number" {
        field.as_object_mut().unwrap().remove("variant");
    }
    field
}

/// Builds a deterministic sparse DAG with a long value path.
///
/// Value edges always point from a lower schema index to a higher one. Extra
/// visibility, error, and operand-reference dependencies exercise the trigger
/// index without creating value cycles.
fn sparse_acyclic_schema_json(field_count: usize) -> String {
    let mut fields = Vec::with_capacity(field_count);

    for index in 0..field_count {
        let mut rules = Vec::new();

        if index >= 1 {
            let previous_index = index - 1;

            rules.push(json!({
                "when": {
                    "property": field_key(previous_index),
                    "operation": "Eq",
                    "value": representative_value(previous_index)
                },
                "then": [
                    {
                        "kind": "set_hidden",
                        "hidden": false
                    },
                    {
                        "kind": "set_value",
                        "value": representative_value(index)
                    }
                ]
            }));
        }

        if index >= 2 {
            let dependency_index = index - 2;

            rules.push(json!({
                "when": {
                    "property": field_key(dependency_index),
                    "operation": "Neq",
                    "value": representative_value(dependency_index)
                },
                "then": [
                    {
                        "kind": "set_errors",
                        "errors": [
                            "Dependency is not ready"
                        ]
                    }
                ]
            }));
        }

        if index >= 6 {
            let left_index = index - 3;
            let right_index = index - 6;

            // Both operands have the same generated field type because their
            // indexes differ by a multiple of three.
            rules.push(json!({
                "when": {
                    "property": field_key(left_index),
                    "operation": "Eq",
                    "value": {
                        "ref": field_key(right_index)
                    }
                },
                "then": [
                    {
                        "kind": "set_hidden",
                        "hidden": false
                    }
                ]
            }));
        }

        fields.push(generated_field(index, rules));
    }

    serde_json::to_string(&json!({"schemaVersion": "sprout", "form": fields}))
        .expect("generated benchmark schema should serialize")
}

fn benchmark_datasets() -> Vec<BenchmarkDataset> {
    FIELD_COUNTS
        .iter()
        .copied()
        .map(|field_count| BenchmarkDataset {
            name: format!("{field_count}_fields_sparse_acyclic"),
            field_count,
            json: sparse_acyclic_schema_json(field_count),
        })
        .collect()
}

fn deserialize_schema(json: &str) -> RawSchema {
    serde_json::from_str(json).expect("benchmark schema should deserialize")
}

fn compile_schema(schema: RawSchema) {
    let compiled = SchemaCompiler::new()
        .compile(schema)
        .expect("acyclic benchmark schema should compile");

    black_box(compiled);
}

fn initialize_from_json(json: &str) {
    compile_schema(deserialize_schema(json));
}

fn benchmark_schema_initialization(criterion: &mut Criterion) {
    let datasets = benchmark_datasets();

    // `cargo test --all-targets` executes harness-free Criterion binaries in
    // the debug profile. It should verify that every generated size compiles,
    // but statistical timing and release-only ceilings are not meaningful
    // there. The benchmark script enables `benchmarks` in the release profile.
    if cfg!(debug_assertions) || !cfg!(feature = "benchmarks") {
        for dataset in &datasets {
            initialize_from_json(black_box(dataset.json.as_str()));
        }
        return;
    }

    let largest = datasets
        .last()
        .expect("benchmark field counts must contain a largest dataset");
    assert_initialization_ceiling(largest);

    for dataset in &datasets {
        let mut group =
            criterion.benchmark_group(format!("schema_initialization/{}", dataset.name));
        group.throughput(Throughput::Elements(dataset.field_count as u64));
        group.warm_up_time(Duration::from_millis(500));
        group.measurement_time(Duration::from_secs(if dataset.field_count == 10_000 {
            3
        } else {
            2
        }));
        group.sample_size(10);

        group.bench_function("deserialize", |bencher| {
            bencher.iter(|| {
                let schema = deserialize_schema(black_box(dataset.json.as_str()));
                black_box(schema);
            });
        });

        let parsed_schema = deserialize_schema(&dataset.json);
        group.bench_function("compile", |bencher| {
            bencher.iter_batched(
                || parsed_schema.clone(),
                compile_schema,
                BatchSize::LargeInput,
            );
        });

        group.bench_function("deserialize_and_compile", |bencher| {
            bencher.iter(|| initialize_from_json(black_box(dataset.json.as_str())));
        });

        group.finish();
    }
}

/// Enforces a coarse release-build ceiling on the largest supported dataset.
///
/// Criterion detects smaller performance movement. This guard is intentionally
/// limited to catastrophic regressions in parsing, graph construction, cycle
/// analysis, or initial state construction.
fn assert_initialization_ceiling(dataset: &BenchmarkDataset) {
    let maximum_ms = std::env::var("TUNGSTEN_BENCH_MAX_MS")
        .ok()
        .map(|value| {
            let parsed = value.parse::<u64>().unwrap_or_else(|_| {
                panic!(
                    "TUNGSTEN_BENCH_MAX_MS must be a positive integer, received '{}'",
                    value
                )
            });

            assert!(
                parsed > 0,
                "TUNGSTEN_BENCH_MAX_MS must be a positive integer, received '0'"
            );
            parsed
        })
        .unwrap_or(1_000);
    let maximum = Duration::from_millis(maximum_ms);

    initialize_from_json(&dataset.json);

    let mut samples = Vec::with_capacity(5);
    for _ in 0..5 {
        let started = Instant::now();
        initialize_from_json(&dataset.json);
        samples.push(started.elapsed());
    }
    samples.sort_unstable();

    let median = samples[samples.len() / 2];

    eprintln!(
        "{}-field sparse acyclic initialization guard: median={median:?}, maximum={maximum:?}",
        dataset.field_count
    );

    assert!(
        median <= maximum,
        "{}-field sparse acyclic schema initialization took {:?}, exceeding the configured maximum of {:?}",
        dataset.field_count,
        median,
        maximum
    );
}

criterion_group! {
    name = benches;
    config = Criterion::default();
    targets = benchmark_schema_initialization
}

criterion_main!(benches);
