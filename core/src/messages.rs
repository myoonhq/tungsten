use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Presentation data; consumers resolve keys and interpolate parameters.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct Message {
    #[serde(rename = "messageKey")]
    pub message_key: String,
    #[serde(default, skip_serializing_if = "Map::is_empty")]
    pub params: Map<String, Value>,
}
impl Message {
    pub fn new(key: impl Into<String>) -> Self {
        Self {
            message_key: key.into(),
            params: Map::new(),
        }
    }
    pub fn with_params(mut self, params: Value) -> Self {
        if let Value::Object(mut params) = params {
            // Diagnostic causes are presentation data; paths/field keys/values are literal.
            for name in ["message", "source", "e", "expected", "format"] {
                if let Some(Value::String(value)) = params.get(name) {
                    let nested = serde_json::from_str::<Message>(value)
                        .ok()
                        .or_else(|| value.starts_with("tg_").then(|| Message::new(value)));
                    if let Some(nested) = nested {
                        params.insert(name.into(), serde_json::to_value(nested).unwrap());
                    }
                }
            }
            self.params = params;
        }
        self
    }
}
/// Authored rule messages remain strings and use the same UI lookup/fallback.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Text {
    Message(Message),
    Literal(String),
}
impl From<String> for Text {
    fn from(value: String) -> Self {
        if let Ok(message) = serde_json::from_str::<Message>(&value) {
            return Self::Message(message);
        }
        if value.starts_with("tg_") {
            Self::Message(Message::new(value))
        } else {
            Self::Literal(value)
        }
    }
}
impl From<&str> for Text {
    fn from(value: &str) -> Self {
        value.to_string().into()
    }
}
impl From<Message> for Text {
    fn from(value: Message) -> Self {
        Self::Message(value)
    }
}

/// Legacy diagnostic paths carry encoded messages until the JS boundary decodes them.
/// Validation/state messages are serialized as objects directly.
pub fn diagnostic(key: &str, params: Value) -> String {
    serde_json::to_string(&Message::new(key).with_params(params))
        .expect("message data is serializable")
}
