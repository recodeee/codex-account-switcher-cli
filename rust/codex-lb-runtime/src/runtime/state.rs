use reqwest::Client;
use std::{env, time::Duration};

#[derive(Debug, Clone)]
pub(crate) struct RuntimeFlags {
    pub profile: String,
    pub draining: bool,
    pub startup_pending: bool,
}

#[derive(Clone)]
pub(crate) struct RuntimeState {
    pub flags: RuntimeFlags,
    pub python_base_url: String,
    pub python_client: Client,
}

pub(crate) fn runtime_state_from_env() -> RuntimeState {
    runtime_state_with_flags(runtime_flags_from_env())
}

pub(crate) fn runtime_state_with_flags(flags: RuntimeFlags) -> RuntimeState {
    let python_runtime_base_url = env::var("PYTHON_RUNTIME_BASE_URL").ok();
    let app_backend_port = env::var("APP_BACKEND_PORT").ok();
    let python_base_url = resolve_python_base_url(
        python_runtime_base_url.as_deref(),
        app_backend_port.as_deref(),
    );

    let timeout_ms = env::var("RUST_RUNTIME_PYTHON_TIMEOUT_MS")
        .ok()
        .and_then(|raw| raw.trim().parse::<u64>().ok())
        .filter(|value| *value > 0)
        .unwrap_or(1_500);

    let python_client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .expect("build python layer HTTP client");

    RuntimeState {
        flags,
        python_base_url,
        python_client,
    }
}

pub(crate) fn resolve_python_base_url(
    python_runtime_base_url: Option<&str>,
    app_backend_port: Option<&str>,
) -> String {
    if let Some(base_url) = python_runtime_base_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return base_url.to_string();
    }

    let app_backend_port = app_backend_port
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .and_then(|raw| raw.parse::<u16>().ok())
        .filter(|port| *port > 0)
        .unwrap_or(2455);

    format!("http://127.0.0.1:{app_backend_port}")
}

fn runtime_flags_from_env() -> RuntimeFlags {
    RuntimeFlags {
        profile: env::var("RUST_RUNTIME_PROFILE").unwrap_or_else(|_| "phase0".to_string()),
        draining: env_flag_true("RUST_RUNTIME_DRAINING"),
        startup_pending: env_flag_true("RUST_RUNTIME_STARTUP_PENDING"),
    }
}

fn env_flag_true(name: &str) -> bool {
    env::var(name)
        .map(|value| {
            matches!(
                value.trim().to_ascii_lowercase().as_str(),
                "1" | "true" | "yes" | "on"
            )
        })
        .unwrap_or(false)
}
