pub mod catalog;
pub mod messages;
mod utils;

#[cfg(test)]
mod tests;

mod types;
pub use types::{FileReference, FileValue, ScalarValue};
pub mod sources;

pub mod compiler;
pub mod engine;
pub mod field_types;
pub mod fields;
pub mod groups;
pub mod repeaters;
pub mod schema;

#[cfg(target_arch = "wasm32")]
pub mod wasm_runtime;

#[cfg(all(target_arch = "wasm32", feature = "wee_alloc"))]
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;
