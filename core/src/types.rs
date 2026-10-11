use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ScalarValue {
    String(String),
    Number(f64),
    Bool(bool),
    Files(FileValue),
    Strings(Vec<String>),
    Null,
}

/// A leaf object, distinct from repeater arrays. Browser bytes never enter core.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FileValue {
    pub files: Vec<FileReference>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FileReference {
    pub id: String,
    pub name: String,
    pub size: u64,
    pub media_type: String,
    pub uploaded: bool,
}
