//! WASM boundary tests executed in a real browser.

#![cfg(target_arch = "wasm32")]

use tungsten_core::wasm_runtime::EngineRuntime;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

wasm_bindgen_test_configure!(run_in_browser);

const VALID_SCHEMA: &str = r#"
{"schemaVersion":"sprout","form":[
  {
    "key": "name",
    "type": "text",
    "view": {
      "label": "Name"
    },
    "validators": [
      {
        "kind": "required"
      }
    ]
  }
]}
"#;

const EMAIL_SCHEMA: &str = r#"
{"schemaVersion":"sprout","form":[
  {
    "key": "email",
    "type": "text", "variant": "email",
    "view": {
      "label": "Email"
    }
  }
]}
"#;

#[wasm_bindgen_test]
fn loads_valid_schema_through_wasm_boundary() -> Result<(), JsValue> {
    let mut runtime = EngineRuntime::new();

    let response_json = runtime.load_form(VALID_SCHEMA)?;
    let response: serde_json::Value = serde_json::from_str(&response_json)
        .map_err(|error| JsValue::from_str(&format!("load_form returned invalid JSON: {error}")))?;

    let schema = response
        .get("schema")
        .and_then(|schema| schema.get("form"))
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| {
            JsValue::from_str("load_form response did not contain a schema form array")
        })?;

    assert_eq!(schema.len(), 1);
    assert_eq!(schema[0]["key"], "name");
    assert_eq!(schema[0]["type"], "text");

    let state_json = runtime.get_state()?;
    let state: serde_json::Value = serde_json::from_str(&state_json)
        .map_err(|error| JsValue::from_str(&format!("get_state returned invalid JSON: {error}")))?;

    assert!(
        state.is_object(),
        "get_state should return a serialized FormState object"
    );

    Ok(())
}

#[wasm_bindgen_test]
fn dates_times_and_timezone_instants_cross_the_real_wasm_boundary() -> Result<(), JsValue> {
    let mut runtime = EngineRuntime::new();
    let schema = r#"{"schemaVersion":"sprout","form":[
        {"type":"date","key":"day","validators":[{"kind":"required"}]},
        {"type":"date","key":"time","mode":"time"},
        {"type":"date","key":"meeting","mode":"datetime","timeZone":"Europe/Bratislava","validators":[{"kind":"min","value":"2026-10-07T08:00:00Z"}]},
        {"type":"boolean","key":"matched","rules":[{"when":{"property":"meeting","operation":"Eq","value":"2026-10-07T10:30:00+02:00"},"then":[{"kind":"set_value","value":true}]}]}
    ]}"#;
    runtime.load_form_with_values(
        schema,
        r#"{"day":"2024-02-29","time":"09:30","meeting":"2026-10-07T10:30:00+02:00"}"#,
        false,
    )?;
    let values: serde_json::Value = serde_json::from_str(&runtime.get_values()?).unwrap();
    assert_eq!(values["day"], "2024-02-29");
    assert_eq!(values["time"], "09:30:00");
    assert_eq!(values["meeting"], "2026-10-07T08:30:00Z");
    assert_eq!(values["matched"], true);
    runtime.process_patch(r#"{"kind":"set_value","key":"day","value":"2023-02-29"}"#)?;
    let invalid: serde_json::Value = serde_json::from_str(&runtime.validate_form()?).unwrap();
    assert_eq!(invalid["valid"], false);
    assert_eq!(
        invalid["state"]["fields"]["day"]["errors"][0],
        serde_json::json!({"messageKey":"tg_validation_date","params":{"format":{"messageKey":"tg_validation_date_format_date"}}})
    );
    runtime.process_patch(r#"{"kind":"set_value","key":"day","value":"2026-10-07"}"#)?;
    let valid: serde_json::Value = serde_json::from_str(&runtime.validate_form()?).unwrap();
    assert_eq!(valid["valid"], true);
    Ok(())
}

#[wasm_bindgen_test]
fn validates_full_form_through_wasm_boundary() -> Result<(), JsValue> {
    let mut runtime = EngineRuntime::new();
    runtime.load_form(VALID_SCHEMA)?;

    let invalid_json = runtime.validate_form()?;
    let invalid: serde_json::Value = serde_json::from_str(&invalid_json).map_err(|error| {
        JsValue::from_str(&format!("validate_form returned invalid JSON: {error}"))
    })?;

    assert_eq!(invalid["valid"], false);
    assert_eq!(
        invalid["state"]["fields"]["name"]["errors"][0],
        serde_json::json!({"messageKey":"tg_validation_required"})
    );

    runtime.process_patch(r#"{"kind":"set_value","key":"name","value":"Ada"}"#)?;

    let valid_json = runtime.validate_form()?;
    let valid: serde_json::Value = serde_json::from_str(&valid_json).map_err(|error| {
        JsValue::from_str(&format!("validate_form returned invalid JSON: {error}"))
    })?;

    assert_eq!(valid["valid"], true);
    assert_eq!(
        valid["state"]["fields"]["name"]["errors"]
            .as_array()
            .map(Vec::len),
        Some(0)
    );

    Ok(())
}

#[wasm_bindgen_test]
fn validates_email_format_through_wasm_boundary() -> Result<(), JsValue> {
    let mut runtime = EngineRuntime::new();
    runtime.load_form(EMAIL_SCHEMA)?;

    let invalid_json =
        runtime.process_patch(r#"{"kind":"set_value","key":"email","value":"not-an-email"}"#)?;
    let invalid: serde_json::Value = serde_json::from_str(&invalid_json).map_err(|error| {
        JsValue::from_str(&format!("process_patch returned invalid JSON: {error}"))
    })?;

    assert_eq!(
        invalid["state"]["fields"]["email"]["errors"][0],
        serde_json::json!({"messageKey":"tg_validation_email"})
    );

    let invalid_submit_json = runtime.validate_form()?;
    let invalid_submit: serde_json::Value =
        serde_json::from_str(&invalid_submit_json).map_err(|error| {
            JsValue::from_str(&format!("validate_form returned invalid JSON: {error}"))
        })?;
    assert_eq!(invalid_submit["valid"], false);

    let valid_json =
        runtime.process_patch(r#"{"kind":"set_value","key":"email","value":"ada@example.com"}"#)?;
    let valid: serde_json::Value = serde_json::from_str(&valid_json).map_err(|error| {
        JsValue::from_str(&format!("process_patch returned invalid JSON: {error}"))
    })?;

    assert_eq!(
        valid["state"]["fields"]["email"]["errors"]
            .as_array()
            .map(Vec::len),
        Some(0)
    );

    let valid_submit_json = runtime.validate_form()?;
    let valid_submit: serde_json::Value =
        serde_json::from_str(&valid_submit_json).map_err(|error| {
            JsValue::from_str(&format!("validate_form returned invalid JSON: {error}"))
        })?;
    assert_eq!(valid_submit["valid"], true);

    Ok(())
}

const GROUP_SCHEMA: &str = r#"{
  "schemaVersion":"sprout","form":[{
    "type":"group","variant":"sectioned","key":"person",
    "view":{"label":"Person"},"render":{"type":"tabs","settings":{}},"subform":[{
      "type":"group","variant":"basic","key":"person.contact",
      "render":{"type":"group","settings":{}},"subform":[{
        "type":"text","variant":"email","key":"person.contact.email","view":{"label":"Email","description":"Kept across WASM"},
        "validators":[{"kind":"required"}]
      }]
    }]
  }]
}"#;

#[wasm_bindgen_test]
fn retains_group_tree_and_validates_all_leaves() {
    let mut runtime = EngineRuntime::new();
    let response: serde_json::Value =
        serde_json::from_str(&runtime.load_form(GROUP_SCHEMA).unwrap()).unwrap();
    assert_eq!(response["schema"]["schemaVersion"], "sprout");
    assert_eq!(response["schema"]["form"][0]["type"], "group");
    assert_eq!(
        response["schema"]["form"][0]["subform"][0]["subform"][0]["view"]["description"],
        "Kept across WASM"
    );
    assert!(response["state"]["fields"].get("person").is_none());
    let validation: serde_json::Value =
        serde_json::from_str(&runtime.validate_form().unwrap()).unwrap();
    assert_eq!(validation["valid"], false);
    assert_eq!(
        validation["state"]["fields"]["person.contact.email"]["errors"][0],
        serde_json::json!({"messageKey":"tg_validation_required"})
    );
}

#[wasm_bindgen_test]
fn renderer_reload_preserves_state_and_failed_load_keeps_the_previous_engine() {
    let mut runtime = EngineRuntime::new();
    runtime.load_form(GROUP_SCHEMA).unwrap();
    runtime
        .process_patch(
            r#"{"kind":"set_value","key":"person.contact.email","value":" ada@example.com "}"#,
        )
        .unwrap();
    let wizard = GROUP_SCHEMA.replace("tabs", "wizard");
    let reloaded: serde_json::Value =
        serde_json::from_str(&runtime.load_form(&wizard).unwrap()).unwrap();
    assert_eq!(
        reloaded["state"]["fields"]["person.contact.email"]["value"],
        "ada@example.com"
    );
    assert!(runtime
        .load_form(&GROUP_SCHEMA.replace("sprout", "moss"))
        .is_err());
    assert!(runtime
        .load_form(&GROUP_SCHEMA.replace("person.contact.email", "outside"))
        .is_err());
    let retained: serde_json::Value = serde_json::from_str(&runtime.get_state().unwrap()).unwrap();
    assert_eq!(
        retained["fields"]["person.contact.email"]["value"],
        "ada@example.com"
    );
    assert!(runtime.load_form("[]").is_err());
}

#[wasm_bindgen_test]
fn loads_values_after_init_and_validates_before_returning() {
    let mut runtime = EngineRuntime::new();
    let initial: serde_json::Value =
        serde_json::from_str(&runtime.load_form(VALID_SCHEMA).unwrap()).unwrap();
    assert_eq!(initial["valid"], false);
    assert_eq!(
        initial["state"]["fields"]["name"]["errors"][0],
        serde_json::json!({"messageKey":"tg_validation_required"})
    );
    let loaded: serde_json::Value =
        serde_json::from_str(&runtime.load_values(r#"{"name":"Ada"}"#).unwrap()).unwrap();
    assert_eq!(loaded["valid"], true);
    assert_eq!(loaded["state"]["fields"]["name"]["value"], "Ada");
    let defaults: serde_json::Value =
        serde_json::from_str(&runtime.load_values("null").unwrap()).unwrap();
    assert_eq!(defaults["valid"], false);
    assert!(defaults["state"]["fields"]["name"]["value"].is_null());
}

#[wasm_bindgen_test]
fn initial_values_reloads_and_invalid_inputs_are_atomic() {
    let mut runtime = EngineRuntime::new();
    let values = r#"{"person.contact.email":" ada@example.com "}"#;
    let initial: serde_json::Value = serde_json::from_str(
        &runtime
            .load_form_with_values(GROUP_SCHEMA, values, true)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(initial["valid"], true);
    assert_eq!(
        initial["state"]["fields"]["person.contact.email"]["value"],
        "ada@example.com"
    );
    runtime
        .process_patch(
            r#"{"kind":"set_value","key":"person.contact.email","value":"edited@example.com"}"#,
        )
        .unwrap();
    let reloaded: serde_json::Value = serde_json::from_str(
        &runtime
            .load_form_with_values(&GROUP_SCHEMA.replace("tabs", "wizard"), values, true)
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        reloaded["state"]["fields"]["person.contact.email"]["value"],
        "edited@example.com"
    );
    let before = runtime.get_state().unwrap();
    for invalid in [
        r#"{"person.contact.email":5}"#,
        r#"{"unknown":"value"}"#,
        r#"{"fields":{"name":{"value":"Ada"}}}"#,
        "[]",
    ] {
        assert!(runtime.load_values(invalid).is_err());
        assert_eq!(runtime.get_state().unwrap(), before);
        assert!(runtime
            .load_form_with_values(VALID_SCHEMA, invalid, false)
            .is_err());
        assert_eq!(runtime.get_state().unwrap(), before);
    }
    let replaced: serde_json::Value = serde_json::from_str(
        &runtime
            .load_form_with_values(
                GROUP_SCHEMA,
                r#"{"person.contact.email":"new@example.com"}"#,
                true,
            )
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        replaced["state"]["fields"]["person.contact.email"]["value"],
        "new@example.com"
    );
    let cleared: serde_json::Value = serde_json::from_str(
        &runtime
            .load_form_with_values(GROUP_SCHEMA, "null", true)
            .unwrap(),
    )
    .unwrap();
    assert!(cleared["state"]["fields"]["person.contact.email"]["value"].is_null());
}

const REPEATER_SCHEMA: &str = r#"{"schemaVersion":"sprout","form":[{
  "type":"repeater","key":"person","min":0,"max":3,"reorder":true,
  "render":{"type":"tabs","settings":{}},"validators":[{"kind":"required"}],
  "template":[{"type":"text","key":"person.name","view":{"label":"Name"},"validators":[{"kind":"required"}]},
    {"type":"text","key":"person.note","rules":[{"when":{"property":"person[current].name","operation":"Eq","value":"Ada"},"then":[{"kind":"set_hidden","hidden":true}]}]}]
}]}"#;

#[wasm_bindgen_test]
fn repeater_operations_and_array_projection_cross_the_real_wasm_boundary() {
    let mut runtime = EngineRuntime::new();
    let loaded: serde_json::Value = serde_json::from_str(
        &runtime
            .load_form_with_values(
                REPEATER_SCHEMA,
                r#"{"person":[{"name":"Ada"},{"name":"Grace"}]}"#,
                false,
            )
            .unwrap(),
    )
    .unwrap();
    assert_eq!(loaded["state"]["repeaters"]["person"]["length"], 2);
    assert_eq!(loaded["state"]["fields"]["person[0].note"]["hidden"], true);
    let id = loaded["state"]["repeaters"]["person"]["instances"][0]["id"].clone();
    let moved: serde_json::Value =
        serde_json::from_str(&runtime.reorder_instance("person", 0.0, 1.0).unwrap()).unwrap();
    assert_eq!(
        moved["state"]["repeaters"]["person"]["instances"][1]["id"],
        id
    );
    assert_eq!(moved["state"]["fields"]["person[1].name"]["value"], "Ada");
    assert_eq!(moved["state"]["fields"]["person[1].note"]["hidden"], true);
    runtime.add_instance("person").unwrap();
    let before = runtime.get_state().unwrap();
    assert!(runtime.add_instance("person").is_err());
    assert_eq!(runtime.get_state().unwrap(), before);
    runtime
        .process_patch(r#"{"kind":"set_value","key":"person[2].name","value":"Lin"}"#)
        .unwrap();
    runtime.remove_instance("person", 0.0).unwrap();
    let values: serde_json::Value = serde_json::from_str(&runtime.get_values().unwrap()).unwrap();
    assert_eq!(
        values,
        serde_json::json!({"person":[{"name":"Ada","note":null},{"name":"Lin","note":null}]})
    );
    let validation: serde_json::Value =
        serde_json::from_str(&runtime.validate_form().unwrap()).unwrap();
    assert_eq!(validation["valid"], true);
    let before = runtime.get_state().unwrap();
    assert!(runtime
        .load_values(r#"{"person":[{"unknown":"bad"}]}"#)
        .is_err());
    assert_eq!(runtime.get_state().unwrap(), before);
}

#[wasm_bindgen_test]
fn empty_repeater_load_and_presentation_reload_keep_runtime_membership() {
    let mut runtime = EngineRuntime::new();
    let empty: serde_json::Value =
        serde_json::from_str(&runtime.load_form(REPEATER_SCHEMA).unwrap()).unwrap();
    assert_eq!(empty["valid"], true);
    assert_eq!(empty["state"]["repeaters"]["person"]["length"], 0);
    runtime.add_instance("person").unwrap();
    runtime
        .process_patch(r#"{"kind":"set_value","key":"person[0].name","value":"Edited"}"#)
        .unwrap();
    let reloaded: serde_json::Value = serde_json::from_str(
        &runtime
            .load_form(&REPEATER_SCHEMA.replace("tabs", "undereachother"))
            .unwrap(),
    )
    .unwrap();
    assert_eq!(reloaded["state"]["repeaters"]["person"]["length"], 1);
    assert_eq!(
        reloaded["state"]["fields"]["person[0].name"]["value"],
        "Edited"
    );
    let replaced: serde_json::Value =
        serde_json::from_str(&runtime.load_values(r#"{"person":[]}"#).unwrap()).unwrap();
    assert_eq!(replaced["state"]["repeaters"]["person"]["length"], 0);
    assert_eq!(replaced["valid"], true);
}

#[wasm_bindgen_test]
fn structural_indexes_reject_fractions_negatives_and_overflow_without_mutation() {
    let mut runtime = EngineRuntime::new();
    runtime
        .load_form_with_values(
            REPEATER_SCHEMA,
            r#"{"person":[{"name":"Ada"},{"name":"Grace"}]}"#,
            false,
        )
        .unwrap();
    let before = runtime.get_state().unwrap();
    for index in [-1.0, 0.5, 4294967296.0, f64::NAN] {
        assert!(runtime.remove_instance("person", index).is_err());
        assert!(runtime.reorder_instance("person", index, 0.0).is_err());
        assert_eq!(runtime.get_state().unwrap(), before);
    }
}

#[wasm_bindgen_test]
fn nested_collections_load_bind_move_and_submit_through_wasm() {
    let schema=serde_json::json!({"schemaVersion":"sprout","form":[{"type":"repeater","key":"people","reorder":true,"render":{"type":"tabs","settings":{}},"template":[
        {"type":"text","key":"people.name"},
        {"type":"repeater","key":"people.children","reorder":true,"render":{"type":"tabs","settings":{}},"template":[
            {"type":"text","key":"people.children.name"},
            {"type":"text","key":"people.children.note","rules":[{"when":{"property":"people[current].children[current].name","operation":"Eq","value":{"ref":"people[current].name"}},"then":[{"kind":"set_hidden","hidden":true}]}]}
        ]}
    ]}]}).to_string();
    let values=serde_json::json!({"people":[{"name":"Ada","children":[{"name":"Ada","note":"hidden"}]},{"name":"Grace","children":[]}]}).to_string();
    let mut runtime = EngineRuntime::new();
    let loaded: serde_json::Value = serde_json::from_str(
        &runtime
            .load_form_with_values(&schema, &values, false)
            .unwrap(),
    )
    .unwrap();
    let child_id = loaded["state"]["repeaters"]["people[0].children"]["instances"][0]["id"].clone();
    assert_eq!(
        loaded["state"]["fields"]["people[0].children[0].note"]["hidden"],
        true
    );
    runtime.reorder_instance("people", 0.0, 1.0).unwrap();
    let moved: serde_json::Value = serde_json::from_str(&runtime.get_state().unwrap()).unwrap();
    assert_eq!(
        moved["repeaters"]["people[1].children"]["instances"][0]["id"],
        child_id
    );
    runtime.add_instance("people[0].children").unwrap();
    runtime
        .process_patch(r#"{"kind":"set_value","key":"people[0].children[0].name","value":"Lin"}"#)
        .unwrap();
    let submitted: serde_json::Value =
        serde_json::from_str(&runtime.get_values().unwrap()).unwrap();
    assert_eq!(
        submitted,
        serde_json::json!({"people":[{"name":"Grace","children":[{"name":"Lin","note":null}]},{"name":"Ada","children":[{"name":"Ada","note":"hidden"}]}]})
    );
    let before = runtime.get_state().unwrap();
    assert!(runtime
        .load_values(r#"{"people":[{"children":false}]}"#)
        .is_err());
    assert_eq!(runtime.get_state().unwrap(), before);
    runtime.remove_instance("people", 0.0).unwrap();
    runtime.remove_instance("people[0].children", 0.0).unwrap();
    let submitted: serde_json::Value =
        serde_json::from_str(&runtime.get_values().unwrap()).unwrap();
    assert_eq!(
        submitted,
        serde_json::json!({"people":[{"name":"Ada","children":[]}]})
    );
}

#[wasm_bindgen_test]
fn discovers_authoring_catalog_before_loading_a_form() {
    let runtime = EngineRuntime::new();
    let catalog: serde_json::Value = serde_json::from_str(&runtime.get_catalog().unwrap()).unwrap();
    assert_eq!(catalog["schemaVersion"], "sprout");
    let field_types: Vec<&str> = catalog["fields"]
        .as_array()
        .unwrap()
        .iter()
        .map(|field| field["type"].as_str().unwrap())
        .collect();
    assert_eq!(
        field_types,
        ["text", "number", "boolean", "select", "file", "date"]
    );
    assert_eq!(catalog["groupRenderers"].as_array().unwrap().len(), 22);
    assert_eq!(catalog["repeaterRenderers"].as_array().unwrap().len(), 2);
    assert!(
        runtime.get_state().is_err(),
        "discovery must not initialize form state"
    );
}

#[wasm_bindgen_test]
fn integrated_validation_preserves_values_handles_and_next_delta() -> Result<(), JsValue> {
    let mut runtime = EngineRuntime::new();
    runtime.load_form(VALID_SCHEMA)?;
    let response: serde_json::Value =
        serde_json::from_str(&runtime.validate_integrated()?).unwrap();
    assert_eq!(response["valid"], false);
    assert_eq!(response["values"]["name"], serde_json::Value::Null);
    assert_eq!(
        response["state"]["fields"]["name"]["value"],
        serde_json::Value::Null
    );
    let handle = response["handles"]["name"].clone();
    assert!(handle.is_string());
    let delta: serde_json::Value = serde_json::from_str(
        &runtime.process_patch_delta(r#"{"kind":"set_value","key":"name","value":"Ada"}"#)?,
    )
    .unwrap();
    assert_eq!(delta["fields"]["name"]["value"], "Ada");
    assert!(delta.get("state").is_none());
    let next: serde_json::Value = serde_json::from_str(&runtime.validate_integrated()?).unwrap();
    assert_eq!(next["valid"], true);
    assert_eq!(next["values"]["name"], "Ada");
    assert_eq!(next["handles"]["name"], handle);
    Ok(())
}
