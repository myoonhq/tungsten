use crate::compiler::{
    CompileError, DependencyKind, SchemaCompiler, ValueActionKind, ValueCycleProvenance,
};

use super::helpers::{MUTUAL_DEPENDENCY_CONVERGES_SCHEMA, STATIC_STATE_CYCLE_SCHEMA};

fn compile(json: &str) -> Result<crate::compiler::CompiledSchema, CompileError> {
    let schema = super::helpers::schema_from_json(json);
    SchemaCompiler::new().compile(schema)
}

fn cycle_error(json: &str) -> CompileError {
    compile(json).expect_err("structural value cycle should fail compilation")
}

#[test]
fn rejects_a_direct_value_self_cycle_with_a_closed_path() {
    let error = cycle_error(
        r#"[
            {
                "key":"self",
                "type":"number",
                "rules":[{
                    "when":{"property":"self","operation":"Eq","value":1},
                    "then":[{"kind":"clear_value"}]
                }]
            }
        ]"#,
    );

    assert_eq!(
        error,
        CompileError::ValueCycle {
            path: vec!["self".to_string(), "self".to_string()],
            provenance: vec![ValueCycleProvenance {
                source_field: "self".to_string(),
                target_field: "self".to_string(),
                target_field_index: 0,
                rule_index: 0,
                action_index: 0,
                dependency_kind: DependencyKind::ConditionProperty,
                action_kind: ValueActionKind::ClearValue,
            }],
        }
    );
    assert_eq!(
        serde_json::from_str::<serde_json::Value>(&error.to_string()).unwrap(),
        serde_json::json!({"messageKey":"tg_schema_value_cycle","params":{"path":"self -> self","provenance":"self -> self via fields[0].rules[0].then[0] (ConditionProperty, ClearValue)"}})
    );
}

#[test]
fn rejects_a_multi_node_value_cycle() {
    let error = cycle_error(STATIC_STATE_CYCLE_SCHEMA);
    let CompileError::ValueCycle { path, provenance } = error else {
        panic!("expected value cycle error");
    };

    assert_eq!(path, vec!["a", "b", "a"]);
    assert_eq!(provenance.len(), 2);
}

#[test]
fn rejects_a_converging_structural_cycle() {
    let error = cycle_error(MUTUAL_DEPENDENCY_CONVERGES_SCHEMA);
    let CompileError::ValueCycle { path, .. } = error else {
        panic!("expected value cycle error");
    };

    assert_eq!(path, vec!["a", "b", "a"]);
}

#[test]
fn mutually_exclusive_guards_do_not_exempt_a_value_cycle() {
    let error = cycle_error(
        r#"[
            {
                "key":"a",
                "type":"number",
                "rules":[{
                    "when":{"property":"b","operation":"Eq","value":0},
                    "then":[{"kind":"set_value","value":1}]
                }]
            },
            {
                "key":"b",
                "type":"number",
                "rules":[{
                    "when":{"property":"a","operation":"Eq","value":2},
                    "then":[{"kind":"set_value","value":3}]
                }]
            }
        ]"#,
    );

    let CompileError::ValueCycle { path, .. } = error else {
        panic!("expected value cycle error");
    };
    assert_eq!(path, vec!["a", "b", "a"]);
}

#[test]
fn visibility_and_error_only_observer_cycles_are_legal() {
    let compiled = compile(
        r#"[
            {
                "key":"a",
                "type":"text",
                "rules":[{
                    "when":{"property":"b","operation":"Eq","value":"show"},
                    "then":[{"kind":"set_hidden","hidden":false}]
                }]
            },
            {
                "key":"b",
                "type":"text",
                "rules":[{
                    "when":{"property":"a","operation":"Eq","value":"invalid"},
                    "then":[{"kind":"set_errors","errors":["observed"]}]
                }]
            }
        ]"#,
    )
    .expect("non-value observer loop should compile");

    assert!(compiled.value_graph().adjacency().iter().all(Vec::is_empty));
    assert_eq!(
        compiled.graph().node("a").expect("a trigger node").affects,
        vec!["b"]
    );
    assert_eq!(
        compiled.graph().node("b").expect("b trigger node").affects,
        vec!["a"]
    );
}

#[test]
fn operand_references_participate_in_the_value_graph() {
    let error = cycle_error(
        r#"[
            {
                "key":"a",
                "type":"number",
                "rules":[{
                    "when":{"property":"gate","operation":"Eq","value":{"ref":"b"}},
                    "then":[{"kind":"set_value","value":1}]
                }]
            },
            {
                "key":"b",
                "type":"number",
                "rules":[{
                    "when":{"property":"a","operation":"Eq","value":1},
                    "then":[{"kind":"set_value","value":1}]
                }]
            },
            {"key":"gate","type":"number"}
        ]"#,
    );

    let CompileError::ValueCycle { path, provenance } = error else {
        panic!("expected value cycle error");
    };

    assert_eq!(path, vec!["a", "b", "a"]);
    assert_eq!(
        provenance
            .iter()
            .map(|edge| edge.dependency_kind)
            .collect::<Vec<_>>(),
        vec![
            DependencyKind::ConditionProperty,
            DependencyKind::OperandRef
        ]
    );
}

#[test]
fn reports_the_first_cycle_in_deterministic_source_order() {
    let json = r#"[
        {
            "key":"a",
            "type":"text",
            "rules":[{
                "when":{"property":"b","operation":"Eq","value":"x"},
                "then":[{"kind":"clear_value"}]
            }]
        },
        {
            "key":"b",
            "type":"text",
            "rules":[{
                "when":{"property":"a","operation":"Eq","value":"x"},
                "then":[{"kind":"clear_value"}]
            }]
        },
        {
            "key":"c",
            "type":"text",
            "rules":[{
                "when":{"property":"d","operation":"Eq","value":"x"},
                "then":[{"kind":"clear_value"}]
            }]
        },
        {
            "key":"d",
            "type":"text",
            "rules":[{
                "when":{"property":"c","operation":"Eq","value":"x"},
                "then":[{"kind":"clear_value"}]
            }]
        }
    ]"#;

    for _ in 0..20 {
        let CompileError::ValueCycle { path, .. } = cycle_error(json) else {
            panic!("expected value cycle error");
        };
        assert_eq!(path, vec!["a", "b", "a"]);
    }
}
