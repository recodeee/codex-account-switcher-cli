use reqwest::Client;
use std::{
    env,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
    time::Duration,
};

#[derive(Debug, Clone)]
pub(crate) struct RuntimeFlags {
    pub profile: String,
    pub draining: bool,
    pub startup_pending: bool,
    pub shutdown_drain_timeout_seconds: u64,
}

#[derive(Clone)]
pub(crate) struct RuntimeLifecycle {
    draining: Arc<AtomicBool>,
    bridge_drain_active: Arc<AtomicBool>,
    in_flight_http_requests: Arc<AtomicUsize>,
}

impl RuntimeLifecycle {
    fn new(draining: bool) -> Self {
        Self {
            draining: Arc::new(AtomicBool::new(draining)),
            bridge_drain_active: Arc::new(AtomicBool::new(false)),
            in_flight_http_requests: Arc::new(AtomicUsize::new(0)),
        }
    }

    pub(crate) fn set_draining(&self, draining: bool) {
        self.draining.store(draining, Ordering::SeqCst);
    }

    pub(crate) fn is_draining(&self) -> bool {
        self.draining.load(Ordering::SeqCst)
    }

    pub(crate) fn set_bridge_drain_active(&self, active: bool) {
        self.bridge_drain_active.store(active, Ordering::SeqCst);
    }

    pub(crate) fn is_bridge_drain_active(&self) -> bool {
        self.bridge_drain_active.load(Ordering::SeqCst)
    }

    pub(crate) fn increment_in_flight_http_requests(&self) {
        self.in_flight_http_requests.fetch_add(1, Ordering::SeqCst);
    }

    pub(crate) fn decrement_in_flight_http_requests(&self) {
        self.in_flight_http_requests
            .fetch_update(Ordering::SeqCst, Ordering::SeqCst, |current| {
                Some(current.saturating_sub(1))
            })
            .ok();
    }

    pub(crate) fn in_flight_http_requests(&self) -> usize {
        self.in_flight_http_requests.load(Ordering::SeqCst)
    }
}

#[derive(Clone)]
pub(crate) struct RuntimeState {
    pub flags: RuntimeFlags,
    pub python_base_url: String,
    pub python_client: Client,
    pub lifecycle: RuntimeLifecycle,
}

impl RuntimeState {
    pub(crate) fn set_draining(&self, draining: bool) {
        self.lifecycle.set_draining(draining);
    }

    pub(crate) fn is_draining(&self) -> bool {
        self.lifecycle.is_draining()
    }

    pub(crate) fn set_bridge_drain_active(&self, active: bool) {
        self.lifecycle.set_bridge_drain_active(active);
    }

    pub(crate) fn is_bridge_drain_active(&self) -> bool {
        self.lifecycle.is_bridge_drain_active()
    }

    pub(crate) fn increment_in_flight_http_requests(&self) {
        self.lifecycle.increment_in_flight_http_requests();
    }

    pub(crate) fn decrement_in_flight_http_requests(&self) {
        self.lifecycle.decrement_in_flight_http_requests();
    }

    pub(crate) fn in_flight_http_requests(&self) -> usize {
        self.lifecycle.in_flight_http_requests()
    }

    pub(crate) async fn wait_for_in_flight_http_drain(
        &self,
        timeout: Duration,
        poll_interval: Duration,
    ) -> bool {
        let deadline = tokio::time::Instant::now() + timeout;
        while self.in_flight_http_requests() > 0 && tokio::time::Instant::now() < deadline {
            tokio::time::sleep(poll_interval).await;
        }
        self.in_flight_http_requests() == 0
    }
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
        lifecycle: RuntimeLifecycle::new(flags.draining),
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
        shutdown_drain_timeout_seconds: env::var("RUST_RUNTIME_SHUTDOWN_DRAIN_TIMEOUT_SECONDS")
            .ok()
            .and_then(|raw| raw.trim().parse::<u64>().ok())
            .filter(|seconds| *seconds > 0)
            .unwrap_or(30),
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
