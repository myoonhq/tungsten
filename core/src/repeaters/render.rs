use crate::schema::GroupRender;
use serde::Deserialize;
use serde_json::Value;
use std::collections::BTreeMap;

type RenderValidator = fn(&Value) -> Result<(), String>;

#[derive(Clone, Debug)]
pub struct RepeaterRenderLibrary(
    BTreeMap<String, RenderValidator>,
    BTreeMap<String, Vec<crate::schema::RawComponent>>,
);
impl RepeaterRenderLibrary {
    pub fn empty() -> Self {
        Self(BTreeMap::new(), BTreeMap::new())
    }
    pub fn register(
        &mut self,
        name: impl Into<String>,
        validate: fn(&Value) -> Result<(), String>,
    ) -> Result<(), String> {
        let name = name.into();
        if self.0.contains_key(&name) {
            return Err(crate::messages::diagnostic(
                "tg_schema_repeater_renderer_already_registered",
                serde_json::json!({"name": name}),
            ));
        }
        self.0.insert(name, validate);
        Ok(())
    }
    pub fn register_described(
        &mut self,
        name: impl Into<String>,
        validate: fn(&Value) -> Result<(), String>,
        settings: Vec<crate::schema::RawComponent>,
    ) -> Result<(), String> {
        let name = name.into();
        self.register(name.clone(), validate)?;
        self.1.insert(name, settings);
        Ok(())
    }
    pub fn descriptors(&self) -> impl Iterator<Item = crate::catalog::RendererDescriptor> + '_ {
        self.0
            .keys()
            .map(move |name| crate::catalog::RendererDescriptor {
                r#type: name.clone(),
                variant: None,
                settings: self.1.get(name).cloned(),
            })
    }
    pub(super) fn validate(&self, render: &GroupRender) -> Result<(), String> {
        if !render.settings.is_object() {
            return Err("tg_schema_render_settings_must_be_an_object".into());
        }
        self.0.get(&render.render_type).ok_or_else(|| {
            crate::messages::diagnostic(
                "tg_schema_unknown_repeater_renderer",
                serde_json::json!({"p0": render.render_type}),
            )
        })?(&render.settings)
    }
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StackSettings {
    gap: Option<u16>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct TabsSettings {
    initial_index: Option<usize>,
}
impl Default for RepeaterRenderLibrary {
    fn default() -> Self {
        let mut library = Self::empty();
        library
            .register("undereachother", |value| {
                let settings: StackSettings =
                    serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
                if settings.gap.is_some_and(|gap| gap > 128) {
                    return Err("tg_schema_gap_must_be_from_0_to_128_pixels".into());
                }
                Ok(())
            })
            .unwrap();
        library
            .register("tabs", |value| {
                let settings: TabsSettings =
                    serde_json::from_value(value.clone()).map_err(|e| e.to_string())?;
                let _ = settings.initial_index;
                Ok(())
            })
            .unwrap();
        library.1.insert("undereachother".into(), crate::catalog::components(serde_json::json!([{ "type":"number","key":"gap","view":{"label":"tg_catalog_gap_px"},"validators":[{"kind":"min","value":0},{"kind":"max","value":128}] }])));
        library.1.insert("tabs".into(), crate::catalog::components(serde_json::json!([{ "type":"number","key":"initialIndex","view":{"label":"tg_catalog_initial_instance_index"},"validators":[{"kind":"min","value":0}] }])));
        library
    }
}
