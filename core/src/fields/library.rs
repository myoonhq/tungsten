use std::collections::HashMap;
use std::fmt::Debug;
use std::sync::Arc;

use super::boolean::BooleanFieldType;
use super::compiled::CompiledField;
use super::errors::{FieldCompileError, FieldRegistrationError};
use super::number::NumberFieldType;
use super::raw::RawField;
use super::text::TextFieldType;

pub trait FieldType: Debug + Send + Sync {
    fn type_name(&self) -> &'static str;

    /// Extensions may publish their own settings as an ordinary Tungsten form.
    fn descriptor(&self) -> crate::catalog::FieldDescriptor {
        crate::catalog::FieldDescriptor::opaque(self.type_name())
    }

    fn compile(&self, raw: &RawField) -> Result<CompiledField, FieldCompileError>;
}

/// Deterministic registry of the field types available to a schema compiler.
///
/// The vector preserves registration order for metadata and diagnostics. The
/// map is lookup-only and never controls observable processing order.
#[derive(Clone, Debug)]
pub struct FieldLibrary {
    entries: Vec<Arc<dyn FieldType>>,
    indexes: HashMap<String, usize>,
}

impl FieldLibrary {
    pub fn new() -> Self {
        Self {
            entries: Vec::new(),
            indexes: HashMap::new(),
        }
    }

    pub fn with_builtins() -> Self {
        let mut library = Self::new();
        library
            .register(TextFieldType)
            .expect("built-in text type must be unique");
        library
            .register(NumberFieldType)
            .expect("built-in number type must be unique");
        library
            .register(BooleanFieldType)
            .expect("built-in boolean type must be unique");
        library
            .register(super::select::SelectFieldType)
            .expect("unique select");
        library
            .register(super::file::FileFieldType)
            .expect("unique file");
        library
            .register(super::date::DateFieldType)
            .expect("unique date");
        library
    }

    pub fn register<T>(&mut self, field_type: T) -> Result<(), FieldRegistrationError>
    where
        T: FieldType + 'static,
    {
        self.register_arc(Arc::new(field_type))
    }

    pub fn register_arc(
        &mut self,
        field_type: Arc<dyn FieldType>,
    ) -> Result<(), FieldRegistrationError> {
        let name = field_type.type_name();

        if self.indexes.contains_key(name) {
            return Err(FieldRegistrationError {
                field_type: name.to_string(),
            });
        }

        let index = self.entries.len();
        self.entries.push(field_type);
        self.indexes.insert(name.to_string(), index);
        Ok(())
    }

    pub fn get(&self, name: &str) -> Option<&dyn FieldType> {
        self.indexes
            .get(name)
            .map(|index| self.entries[*index].as_ref())
    }

    pub fn descriptors(&self) -> impl Iterator<Item = crate::catalog::FieldDescriptor> + '_ {
        self.entries.iter().map(|entry| {
            let mut descriptor = entry.descriptor();
            descriptor.r#type = entry.type_name().into();
            descriptor
        })
    }

    pub fn type_names(&self) -> impl Iterator<Item = &'static str> + '_ {
        self.entries.iter().map(|entry| entry.type_name())
    }
}

impl Default for FieldLibrary {
    fn default() -> Self {
        Self::with_builtins()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builtins_have_stable_registration_order() {
        assert_eq!(
            FieldLibrary::default().type_names().collect::<Vec<_>>(),
            vec!["text", "number", "boolean", "select", "file", "date"]
        );
    }

    #[test]
    fn duplicate_registration_is_rejected() {
        let mut library = FieldLibrary::new();
        library
            .register(TextFieldType)
            .expect("first registration should succeed");

        assert_eq!(
            library.register(TextFieldType),
            Err(FieldRegistrationError {
                field_type: "text".to_string(),
            })
        );
    }
}
