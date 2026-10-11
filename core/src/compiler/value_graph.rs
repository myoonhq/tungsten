use std::cmp::Reverse;
use std::collections::{BinaryHeap, HashMap};
use std::error::Error;
use std::fmt::{Display, Formatter};

use crate::fields::{CompiledField, ConditionOperand, Consequence};

/// Dense traversal slot in the current concrete declaration order.
///
/// Structural transactions remap slots; engine::structure::FieldHandle provides
/// stable identity. Graph traversal never depends on hash iteration.
pub type FieldId = usize;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DependencyKind {
    ConditionProperty,
    OperandRef,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValueActionKind {
    SetValue,
    ClearValue,
}

/// The declaration that caused one value-dependency edge to exist.
///
/// `target` is also the target field's schema index. Rule and action indexes
/// are local to that target field and preserve declaration order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValueEdgeOrigin {
    pub source: FieldId,
    pub target: FieldId,
    pub rule_index: usize,
    pub action_index: usize,
    pub dependency_kind: DependencyKind,
    pub action_kind: ValueActionKind,
}

/// One deduplicated value dependency.
///
/// Multiple rules, actions, or condition operands can establish the same
/// `source -> target` edge. The adjacency contains that edge once while
/// retaining every origin in stable declaration order.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValueEdge {
    pub target: FieldId,
    pub origins: Vec<ValueEdgeOrigin>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValueGraph {
    adjacency: Vec<Vec<ValueEdge>>,
}

/// The first cycle encountered in schema/adjacency order.
///
/// `path` is closed: the first and last field IDs are equal. `origins` has one
/// entry for every path edge and therefore has `path.len() - 1` entries.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValueCycle {
    pub path: Vec<FieldId>,
    pub origins: Vec<ValueEdgeOrigin>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ValueGraphBuildError {
    pub target: FieldId,
    pub rule_index: usize,
    pub dependency_kind: DependencyKind,
    pub referenced_key: String,
}

impl Display for ValueGraphBuildError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        write!(
            formatter,
            "{}",
            crate::messages::diagnostic(
                "tg_schema_field_at_index_rule_references_unknown_field_through",
                serde_json::json!({"p0": self.target, "p1": self.rule_index, "p2": self.referenced_key, "p3": format!("{:?}", self.dependency_kind)})
            )
        )
    }
}

impl Error for ValueGraphBuildError {}

impl ValueGraph {
    /// Builds the conservative graph used for static value-cycle analysis.
    ///
    /// A rule contributes edges only when it can write or clear its owner's
    /// value. Guards are intentionally ignored: both `when.property` and an
    /// operand reference are structural value dependencies regardless of
    /// whether their business conditions can be active together.
    pub fn build(
        fields: &[CompiledField],
        key_index: &HashMap<String, FieldId>,
    ) -> Result<Self, ValueGraphBuildError> {
        let mut adjacency = vec![Vec::new(); fields.len()];
        let mut edge_indexes = vec![HashMap::<FieldId, usize>::new(); fields.len()];

        Self::add_targets(
            &mut adjacency,
            &mut edge_indexes,
            fields,
            key_index,
            0..fields.len(),
        )?;

        Ok(Self { adjacency })
    }

    fn add_targets(
        adjacency: &mut [Vec<ValueEdge>],
        edge_indexes: &mut [HashMap<FieldId, usize>],
        fields: &[CompiledField],
        key_index: &HashMap<String, FieldId>,
        targets: impl IntoIterator<Item = FieldId>,
    ) -> Result<(), ValueGraphBuildError> {
        for target in targets {
            let field = &fields[target];
            for (rule_index, rule) in field.common().rules.iter().enumerate() {
                let value_actions = rule
                    .then
                    .iter()
                    .enumerate()
                    .filter_map(|(action_index, action)| {
                        value_action_kind(action).map(|kind| (action_index, kind))
                    })
                    .collect::<Vec<_>>();

                if value_actions.is_empty() {
                    continue;
                }

                let property_source = resolve_source(
                    key_index,
                    target,
                    rule_index,
                    DependencyKind::ConditionProperty,
                    &rule.when.property,
                )?;

                add_origins(
                    adjacency,
                    edge_indexes,
                    property_source,
                    target,
                    rule_index,
                    DependencyKind::ConditionProperty,
                    &value_actions,
                );

                if let ConditionOperand::Ref { r#ref } = &rule.when.value {
                    let operand_source = resolve_source(
                        key_index,
                        target,
                        rule_index,
                        DependencyKind::OperandRef,
                        r#ref,
                    )?;

                    add_origins(
                        adjacency,
                        edge_indexes,
                        operand_source,
                        target,
                        rule_index,
                        DependencyKind::OperandRef,
                        &value_actions,
                    );
                }
            }
        }

        Ok(())
    }

    pub(crate) fn update(
        &self,
        fields: &[CompiledField],
        key_index: &HashMap<String, FieldId>,
        remap: &[Option<FieldId>],
        changed: &std::collections::HashSet<FieldId>,
    ) -> Result<Self, ValueGraphBuildError> {
        let mut adjacency = vec![Vec::new(); fields.len()];
        for (old_source, edges) in self.adjacency.iter().enumerate() {
            let Some(source) = remap[old_source] else {
                continue;
            };
            for edge in edges {
                let Some(target) = remap[edge.target] else {
                    continue;
                };
                if changed.contains(&target) {
                    continue;
                }
                let origins = edge
                    .origins
                    .iter()
                    .cloned()
                    .map(|mut origin| {
                        origin.source = source;
                        origin.target = target;
                        origin
                    })
                    .collect();
                adjacency[source].push(ValueEdge { target, origins });
            }
        }
        let mut indexes = adjacency
            .iter()
            .map(|edges| {
                edges
                    .iter()
                    .enumerate()
                    .map(|(index, edge)| (edge.target, index))
                    .collect()
            })
            .collect::<Vec<_>>();
        Self::add_targets(
            &mut adjacency,
            &mut indexes,
            fields,
            key_index,
            (0..fields.len()).filter(|target| changed.contains(target)),
        )?;
        for edges in &mut adjacency {
            edges.sort_by_key(|edge| edge.target);
        }
        Ok(Self { adjacency })
    }

    /// Value dependencies precede their targets; ties use declaration order.
    /// Compilation has already rejected cycles before this is used by Engine.
    pub(crate) fn initialization_order(&self) -> Vec<FieldId> {
        let mut incoming = vec![0usize; self.adjacency.len()];
        for edges in &self.adjacency {
            for edge in edges {
                incoming[edge.target] += 1;
            }
        }
        let mut ready = BinaryHeap::new();
        for (id, count) in incoming.iter().enumerate() {
            if *count == 0 {
                ready.push(Reverse(id));
            }
        }
        let mut order = Vec::with_capacity(incoming.len());
        while let Some(Reverse(id)) = ready.pop() {
            order.push(id);
            for edge in &self.adjacency[id] {
                incoming[edge.target] -= 1;
                if incoming[edge.target] == 0 {
                    ready.push(Reverse(edge.target));
                }
            }
        }
        debug_assert_eq!(order.len(), self.adjacency.len());
        order
    }

    pub fn adjacency(&self) -> &[Vec<ValueEdge>] {
        &self.adjacency
    }

    pub fn edges_from(&self, source: FieldId) -> Option<&[ValueEdge]> {
        self.adjacency.get(source).map(Vec::as_slice)
    }

    pub fn field_count(&self) -> usize {
        self.adjacency.len()
    }

    /// Finds the first structural value cycle without using the call stack.
    ///
    /// Roots are visited by `FieldId`; each adjacency retains target schema
    /// order from compilation. A gray edge therefore identifies the first
    /// deterministic closed cycle under declaration-order traversal.
    pub fn first_cycle(&self) -> Option<ValueCycle> {
        let mut colors = vec![Color::White; self.adjacency.len()];
        let mut parents = vec![None; self.adjacency.len()];
        let mut stack = Vec::<DfsFrame>::new();

        for root in 0..self.adjacency.len() {
            if colors[root] != Color::White {
                continue;
            }

            colors[root] = Color::Gray;
            stack.push(DfsFrame {
                field: root,
                next_edge: 0,
            });

            while let Some(frame_index) = stack.len().checked_sub(1) {
                let field = stack[frame_index].field;
                let edge_index = stack[frame_index].next_edge;

                if edge_index == self.adjacency[field].len() {
                    colors[field] = Color::Black;
                    stack.pop();
                    continue;
                }

                stack[frame_index].next_edge += 1;
                let target = self.adjacency[field][edge_index].target;

                match colors[target] {
                    Color::White => {
                        parents[target] = Some(ParentEdge {
                            source: field,
                            edge_index,
                        });
                        colors[target] = Color::Gray;
                        stack.push(DfsFrame {
                            field: target,
                            next_edge: 0,
                        });
                    }
                    Color::Gray => {
                        return Some(self.reconstruct_cycle(field, edge_index, target, &parents));
                    }
                    Color::Black => {}
                }
            }
        }

        None
    }

    fn reconstruct_cycle(
        &self,
        closing_source: FieldId,
        closing_edge_index: usize,
        ancestor: FieldId,
        parents: &[Option<ParentEdge>],
    ) -> ValueCycle {
        let mut reverse_path = vec![closing_source];
        let mut reverse_origins = Vec::new();
        let mut cursor = closing_source;

        while cursor != ancestor {
            let parent = parents[cursor].expect("a gray DFS descendant must have a parent edge");
            let edge = &self.adjacency[parent.source][parent.edge_index];

            reverse_origins.push(first_origin(edge));
            cursor = parent.source;
            reverse_path.push(cursor);
        }

        reverse_path.reverse();
        reverse_origins.reverse();

        reverse_path.push(ancestor);
        reverse_origins.push(first_origin(
            &self.adjacency[closing_source][closing_edge_index],
        ));

        ValueCycle {
            path: reverse_path,
            origins: reverse_origins,
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Color {
    White,
    Gray,
    Black,
}

#[derive(Clone, Copy, Debug)]
struct DfsFrame {
    field: FieldId,
    next_edge: usize,
}

#[derive(Clone, Copy, Debug)]
struct ParentEdge {
    source: FieldId,
    edge_index: usize,
}

fn resolve_source(
    key_index: &HashMap<String, FieldId>,
    target: FieldId,
    rule_index: usize,
    dependency_kind: DependencyKind,
    referenced_key: &str,
) -> Result<FieldId, ValueGraphBuildError> {
    key_index
        .get(referenced_key)
        .copied()
        .ok_or_else(|| ValueGraphBuildError {
            target,
            rule_index,
            dependency_kind,
            referenced_key: referenced_key.to_string(),
        })
}

fn value_action_kind(action: &Consequence) -> Option<ValueActionKind> {
    match action {
        Consequence::SetValue { .. } => Some(ValueActionKind::SetValue),
        Consequence::ClearValue => Some(ValueActionKind::ClearValue),
        Consequence::SetHidden { .. } | Consequence::Show | Consequence::SetErrors { .. } => None,
    }
}

fn add_origins(
    adjacency: &mut [Vec<ValueEdge>],
    edge_indexes: &mut [HashMap<FieldId, usize>],
    source: FieldId,
    target: FieldId,
    rule_index: usize,
    dependency_kind: DependencyKind,
    value_actions: &[(usize, ValueActionKind)],
) {
    let edge_index = match edge_indexes[source].get(&target).copied() {
        Some(edge_index) => edge_index,
        None => {
            let edge_index = adjacency[source].len();
            adjacency[source].push(ValueEdge {
                target,
                origins: Vec::new(),
            });
            edge_indexes[source].insert(target, edge_index);
            edge_index
        }
    };

    let origins = &mut adjacency[source][edge_index].origins;

    for &(action_index, action_kind) in value_actions {
        origins.push(ValueEdgeOrigin {
            source,
            target,
            rule_index,
            action_index,
            dependency_kind,
            action_kind,
        });
    }
}

fn first_origin(edge: &ValueEdge) -> ValueEdgeOrigin {
    edge.origins
        .first()
        .expect("every value edge must retain at least one origin")
        .clone()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fields::{Condition, FieldLibrary, Operation, RawField, Rule};
    use crate::types::ScalarValue;
    use std::collections::BTreeMap;

    fn raw_field(key: String, rules: Vec<Rule>) -> RawField {
        RawField {
            key,
            field_type: "text".to_string(),
            view: None,
            rules,
            validators: Vec::new(),
            current_value: None,
            hidden: false,
            disabled: false,
            read_only: false,
            errors: Vec::new(),
            configuration: BTreeMap::new(),
        }
    }

    fn rule(property: &str, operand: ConditionOperand, then: Vec<Consequence>) -> Rule {
        Rule {
            when: Condition {
                property: property.to_string(),
                operation: Operation::Eq,
                value: operand,
            },
            then,
        }
    }

    fn compile(raw_fields: Vec<RawField>) -> (Vec<CompiledField>, HashMap<String, FieldId>) {
        let library = FieldLibrary::default();
        let fields = raw_fields
            .iter()
            .map(|raw| {
                library
                    .get(raw.field_type())
                    .expect("test field type must be registered")
                    .compile(raw)
                    .expect("test field must compile")
            })
            .collect::<Vec<_>>();
        let key_index = fields
            .iter()
            .enumerate()
            .map(|(field_id, field)| (field.common().key.clone(), field_id))
            .collect();

        (fields, key_index)
    }

    #[test]
    fn keeps_only_value_edges_and_retains_all_stable_origins() {
        let (fields, key_index) = compile(vec![
            raw_field("left".to_string(), Vec::new()),
            raw_field("right".to_string(), Vec::new()),
            raw_field(
                "target".to_string(),
                vec![rule(
                    "left",
                    ConditionOperand::Ref {
                        r#ref: "right".to_string(),
                    },
                    vec![
                        Consequence::SetHidden { hidden: true },
                        Consequence::SetValue {
                            value: ScalarValue::String("value".to_string()),
                        },
                        Consequence::ClearValue,
                        Consequence::SetErrors {
                            errors: vec!["error".to_string()],
                        },
                    ],
                )],
            ),
        ]);

        let graph = ValueGraph::build(&fields, &key_index).expect("graph should build");

        assert_eq!(graph.edges_from(0).expect("left adjacency").len(), 1);
        assert_eq!(graph.edges_from(1).expect("right adjacency").len(), 1);
        assert!(graph.edges_from(2).expect("target adjacency").is_empty());

        assert_eq!(
            graph.edges_from(0).unwrap()[0].origins,
            vec![
                ValueEdgeOrigin {
                    source: 0,
                    target: 2,
                    rule_index: 0,
                    action_index: 1,
                    dependency_kind: DependencyKind::ConditionProperty,
                    action_kind: ValueActionKind::SetValue,
                },
                ValueEdgeOrigin {
                    source: 0,
                    target: 2,
                    rule_index: 0,
                    action_index: 2,
                    dependency_kind: DependencyKind::ConditionProperty,
                    action_kind: ValueActionKind::ClearValue,
                },
            ]
        );
        assert_eq!(
            graph.edges_from(1).unwrap()[0].origins[0].dependency_kind,
            DependencyKind::OperandRef
        );
    }

    #[test]
    fn returns_the_first_closed_cycle_in_schema_order() {
        let (fields, key_index) = compile(vec![
            raw_field(
                "a".to_string(),
                vec![rule(
                    "c",
                    ConditionOperand::Value(ScalarValue::Null),
                    vec![Consequence::SetValue {
                        value: ScalarValue::String("a".to_string()),
                    }],
                )],
            ),
            raw_field(
                "b".to_string(),
                vec![rule(
                    "a",
                    ConditionOperand::Value(ScalarValue::Null),
                    vec![Consequence::ClearValue],
                )],
            ),
            raw_field(
                "c".to_string(),
                vec![rule(
                    "b",
                    ConditionOperand::Value(ScalarValue::Null),
                    vec![Consequence::SetValue {
                        value: ScalarValue::String("c".to_string()),
                    }],
                )],
            ),
            raw_field(
                "later".to_string(),
                vec![rule(
                    "later",
                    ConditionOperand::Value(ScalarValue::Null),
                    vec![Consequence::ClearValue],
                )],
            ),
        ]);

        let cycle = ValueGraph::build(&fields, &key_index)
            .expect("graph should build")
            .first_cycle()
            .expect("cycle should be found");

        assert_eq!(cycle.path, vec![0, 1, 2, 0]);
        assert_eq!(cycle.origins.len(), 3);
        assert_eq!(
            cycle
                .origins
                .iter()
                .map(|origin| (origin.source, origin.target))
                .collect::<Vec<_>>(),
            vec![(0, 1), (1, 2), (2, 0)]
        );
    }

    #[test]
    fn reports_a_direct_self_cycle_as_a_closed_path() {
        let (fields, key_index) = compile(vec![raw_field(
            "self".to_string(),
            vec![rule(
                "self",
                ConditionOperand::Value(ScalarValue::Null),
                vec![Consequence::ClearValue],
            )],
        )]);

        let cycle = ValueGraph::build(&fields, &key_index)
            .expect("graph should build")
            .first_cycle()
            .expect("self cycle should be found");

        assert_eq!(cycle.path, vec![0, 0]);
        assert_eq!(cycle.origins.len(), 1);
        assert_eq!(cycle.origins[0].source, 0);
        assert_eq!(cycle.origins[0].target, 0);
    }

    #[test]
    fn visibility_and_error_observer_loops_are_legal() {
        let (fields, key_index) = compile(vec![
            raw_field(
                "a".to_string(),
                vec![rule(
                    "b",
                    ConditionOperand::Value(ScalarValue::Null),
                    vec![Consequence::SetHidden { hidden: true }],
                )],
            ),
            raw_field(
                "b".to_string(),
                vec![rule(
                    "a",
                    ConditionOperand::Value(ScalarValue::Null),
                    vec![Consequence::SetErrors {
                        errors: vec!["observed".to_string()],
                    }],
                )],
            ),
        ]);

        let graph = ValueGraph::build(&fields, &key_index).expect("graph should build");

        assert!(graph.adjacency().iter().all(Vec::is_empty));
        assert_eq!(graph.first_cycle(), None);
    }

    #[test]
    fn handles_a_large_acyclic_graph_without_recursion() {
        const FIELD_COUNT: usize = 10_000;

        let raw_fields = (0..FIELD_COUNT)
            .map(|field_id| {
                let rules = if field_id > 0 {
                    vec![rule(
                        &format!("field_{}", field_id - 1),
                        ConditionOperand::Value(ScalarValue::Null),
                        vec![Consequence::ClearValue],
                    )]
                } else {
                    Vec::new()
                };

                raw_field(format!("field_{field_id}"), rules)
            })
            .collect();
        let (fields, key_index) = compile(raw_fields);

        let graph = ValueGraph::build(&fields, &key_index).expect("graph should build");

        assert_eq!(graph.field_count(), FIELD_COUNT);
        assert_eq!(graph.first_cycle(), None);
    }

    #[test]
    fn unknown_value_dependency_is_not_silently_dropped() {
        let (fields, key_index) = compile(vec![raw_field(
            "target".to_string(),
            vec![rule(
                "missing",
                ConditionOperand::Value(ScalarValue::Null),
                vec![Consequence::ClearValue],
            )],
        )]);

        assert_eq!(
            ValueGraph::build(&fields, &key_index),
            Err(ValueGraphBuildError {
                target: 0,
                rule_index: 0,
                dependency_kind: DependencyKind::ConditionProperty,
                referenced_key: "missing".to_string(),
            })
        );
    }
}
