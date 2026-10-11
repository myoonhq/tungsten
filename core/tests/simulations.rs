use serde_json::json;
use tungsten_core::{
    compiler::SchemaCompiler,
    engine::{patch::Patch, Engine},
    schema::RawSchema,
    ScalarValue,
};

// Independent bounded evaluator: each node has one predecessor and explicit
// true/false actions, so there is no unspecified competing-writer precedence.
#[test]
fn seeded_sparse_dags_match_reference_state_after_every_edit_and_noop() {
    for seed in 1u64..=32 {
        let mut random = seed;
        let mut parents = vec![0usize; 64];
        let mut fields = vec![json!({"type":"boolean","key":"f0","current_value":false})];
        for (index, parent) in parents.iter_mut().enumerate().skip(1) {
            random = random.wrapping_mul(6364136223846793005).wrapping_add(1);
            *parent = (random as usize) % index;
            fields.push(json!({"type":"boolean","key":format!("f{index}"),"current_value":false,"rules":[
                {"when":{"property":format!("f{}",parent),"operation":"Eq","value":true},"then":[{"kind":"set_value","value":true}]},
                {"when":{"property":format!("f{}",parent),"operation":"Eq","value":false},"then":[{"kind":"set_value","value":false}]}
            ]}));
        }
        let schema: RawSchema =
            serde_json::from_value(json!({"schemaVersion":"sprout","form":fields})).unwrap();
        let mut core = Engine::from_compiled(SchemaCompiler::new().compile(schema).unwrap());
        core.load_values(None).unwrap();
        for edit in 0..16 {
            let root = edit % 2 == 0;
            let processed = core
                .process_patch(Patch::SetValue {
                    key: "f0".into(),
                    value: ScalarValue::Bool(root),
                })
                .unwrap();
            let mut expected = vec![root; 64];
            for i in 1..64 {
                expected[i] = expected[parents[i]];
            }
            for (i, value) in expected.into_iter().enumerate() {
                assert_eq!(
                    core.field_state(&format!("f{i}")).unwrap().value,
                    ScalarValue::Bool(value),
                    "seed {seed}, edit {edit}, field {i}"
                );
            }
            assert_eq!(processed.len(), 64, "all nodes are reachable, seed {seed}");
            assert!(core
                .process_patch(Patch::SetValue {
                    key: "f0".into(),
                    value: ScalarValue::Bool(root)
                })
                .unwrap()
                .is_empty());
        }
    }
}

#[test]
fn isolated_edit_reports_only_fixed_affected_graph_at_every_form_size() {
    for count in [10, 100, 1000, 10000] {
        let mut fields:Vec<_>=(0..count).map(|i|json!({"type":"text","key":format!("f{i}"),"current_value":"before","validators":[{"kind":"required"}]})).collect();
        fields[1]["rules"] = json!([{ "when":{"property":"f0","operation":"Eq","value":"after"},"then":[{"kind":"set_value","value":"derived"}] }]);
        let schema: RawSchema =
            serde_json::from_value(json!({"schemaVersion":"sprout","form":fields})).unwrap();
        let mut core = Engine::from_compiled(SchemaCompiler::new().compile(schema).unwrap());
        core.load_values(None).unwrap();
        let patches = core
            .process_patch(Patch::SetValue {
                key: "f0".into(),
                value: ScalarValue::String("after".into()),
            })
            .unwrap();
        assert_eq!(
            patches.len(),
            2,
            "{count} fields must not inflate affected results"
        );
        assert_eq!(
            core.field_state(&format!("f{}", count - 1)).unwrap().value,
            ScalarValue::String("before".into())
        );
    }
}
