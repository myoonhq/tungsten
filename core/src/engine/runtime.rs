use std::collections::BTreeMap;

use serde::Serialize;

use crate::fields::{CompiledField, ValidationError};
use crate::types::ScalarValue;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct RuntimeFieldState {
    pub value: ScalarValue,
    pub hidden: bool,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    pub disabled: bool,
    #[serde(rename = "readOnly", skip_serializing_if = "std::ops::Not::not")]
    pub read_only: bool,
    pub errors: Vec<crate::messages::Text>,
    #[serde(
        rename = "loadingSources",
        skip_serializing_if = "std::collections::BTreeSet::is_empty"
    )]
    pub loading_sources: std::collections::BTreeSet<String>,
    #[serde(rename = "sourceErrors", skip_serializing_if = "BTreeMap::is_empty")]
    pub source_errors: BTreeMap<String, crate::messages::Text>,
    pub unresolved: bool,
    pub uploading: bool,
    #[serde(rename = "uploadError", skip_serializing_if = "Option::is_none")]
    pub upload_error: Option<crate::messages::Text>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<crate::fields::select::SelectOption>>,

    #[serde(skip)]
    behavior_errors: Vec<String>,

    #[serde(skip)]
    validation_errors: Vec<ValidationError>,
}

impl RuntimeFieldState {
    pub fn eligible(&self) -> bool {
        !self.hidden && !self.disabled
    }
    pub fn valid(&self) -> bool {
        !self.eligible()
            || (self.errors.is_empty()
                && self.loading_sources.is_empty()
                && self.source_errors.is_empty()
                && !self.unresolved
                && !self.uploading
                && self.upload_error.is_none())
    }
    pub fn behavior_errors(&self) -> &[String] {
        &self.behavior_errors
    }

    pub fn validation_errors(&self) -> &[ValidationError] {
        &self.validation_errors
    }

    pub(crate) fn set_behavior_errors(&mut self, errors: Vec<String>) -> bool {
        if self.behavior_errors == errors {
            return false;
        }

        self.behavior_errors = errors;
        self.rebuild_public_errors();
        true
    }

    pub(crate) fn set_validation_errors(&mut self, errors: Vec<ValidationError>) -> bool {
        if self.validation_errors == errors {
            return false;
        }

        self.validation_errors = errors;
        self.rebuild_public_errors();
        true
    }

    fn rebuild_public_errors(&mut self) {
        self.errors.clear();
        self.errors.extend(
            self.behavior_errors
                .iter()
                .cloned()
                .map(crate::messages::Text::Literal),
        );
        self.errors.extend(
            self.validation_errors
                .iter()
                .map(|error| error.message.clone().into()),
        );
    }
}

/// Meaningful input data, independent of derived visibility and errors.
pub type FormValues = BTreeMap<String, ScalarValue>;

#[derive(Debug, Clone, Serialize)]
pub struct FormState {
    pub fields: BTreeMap<String, RuntimeFieldState>,
    #[serde(skip_serializing_if = "BTreeMap::is_empty")]
    pub repeaters: BTreeMap<String, crate::repeaters::RepeaterState>,
}

impl FormState {
    pub fn from_fields(fields: &[CompiledField]) -> Self {
        let mut states = BTreeMap::new();

        for field in fields {
            let common = field.common();
            let behavior_errors = common.initial_behavior_errors.clone();

            states.insert(
                common.key.clone(),
                RuntimeFieldState {
                    value: common.initial_value.clone(),
                    hidden: common.hidden,
                    disabled: common.disabled,
                    read_only: common.read_only,
                    errors: behavior_errors
                        .iter()
                        .cloned()
                        .map(crate::messages::Text::Literal)
                        .collect(),
                    loading_sources: Default::default(),
                    source_errors: Default::default(),
                    unresolved: false,
                    uploading: false,
                    upload_error: None,
                    options: common.initial_options.clone(),
                    behavior_errors,
                    validation_errors: Vec::new(),
                },
            );
        }

        Self {
            fields: states,
            repeaters: BTreeMap::new(),
        }
    }
}
