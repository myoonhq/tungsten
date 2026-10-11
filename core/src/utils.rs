#[cfg(target_arch = "wasm32")]
use wasm_bindgen::JsCast;

#[cfg(target_arch = "wasm32")]
#[macro_export]
macro_rules! log {
    ($($t:tt)*) => {
        if cfg!(debug_assertions) { web_sys::console::log_1(&format!($($t)*).into()) }
    };
}

#[cfg(not(target_arch = "wasm32"))]
#[macro_export]
macro_rules! log {
    ($($t:tt)*) => {
        if cfg!(debug_assertions) { eprintln!($($t)*) }
    };
}

#[cfg(target_arch = "wasm32")]
pub fn now_ms() -> f64 {
    let global = js_sys::global();

    if let Ok(worker) = global.clone().dyn_into::<web_sys::WorkerGlobalScope>() {
        if let Some(performance) = worker.performance() {
            return performance.now();
        }
    }

    if let Ok(window) = global.dyn_into::<web_sys::Window>() {
        if let Some(performance) = window.performance() {
            return performance.now();
        }
    }

    0.0
}

#[cfg(not(target_arch = "wasm32"))]
pub fn now_ms() -> f64 {
    use std::time::{SystemTime, UNIX_EPOCH};

    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs_f64()
        * 1_000.0
}
