use axum::{
    Json, Router,
    extract::State,
    http::{StatusCode, header},
    response::{Html, IntoResponse},
    routing::get,
};
use reqwest::Client;
use serde::Serialize;
use std::{
    collections::BTreeMap,
    env,
    net::SocketAddr,
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tracing::info;

#[derive(Debug, Serialize)]
struct StatusResponse {
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct HealthCheckResponse {
    status: &'static str,
    checks: Option<BTreeMap<&'static str, &'static str>>,
    bridge_ring: Option<BridgeRingResponse>,
}

#[derive(Debug, Serialize)]
struct BridgeRingResponse {
    ring_fingerprint: Option<String>,
    ring_size: usize,
    instance_id: Option<String>,
    is_member: bool,
    error: Option<String>,
}

#[derive(Debug, Serialize)]
struct ErrorDetailResponse {
    detail: &'static str,
}

#[derive(Debug, Serialize)]
struct RuntimeInfoResponse {
    service: &'static str,
    language: &'static str,
    version: &'static str,
    profile: String,
}

#[derive(Debug, Serialize)]
struct PythonLayerHealthResponse {
    status: &'static str,
    python_base_url: String,
    checks: BTreeMap<String, PythonEndpointCheck>,
}

#[derive(Debug, Serialize)]
struct PythonEndpointCheck {
    status_code: Option<u16>,
    ok: bool,
    detail: String,
}

#[derive(Debug, Clone)]
struct RuntimeFlags {
    profile: String,
    draining: bool,
    startup_pending: bool,
}

#[derive(Clone)]
struct RuntimeState {
    flags: RuntimeFlags,
    python_base_url: String,
    python_client: Client,
}

pub fn app() -> Router {
    app_with_state(runtime_state_from_env())
}

fn app_with_flags(flags: RuntimeFlags) -> Router {
    app_with_state(runtime_state_with_flags(flags))
}

fn app_with_state(state: RuntimeState) -> Router {
    Router::new()
        .route("/", get(root_panel))
        .route("/health", get(health))
        .route("/health/live", get(health_live))
        .route("/health/ready", get(health_ready))
        .route("/health/startup", get(health_startup))
        .route("/live_usage", get(live_usage))
        .route("/live_usage/mapping", get(live_usage_mapping))
        .route("/_rust_layer/info", get(runtime_info))
        .route("/_python_layer/health", get(python_layer_health))
        .with_state(state)
}

#[tokio::main]
async fn main() {
    init_tracing();

    let bind_addr = env::var("RUST_RUNTIME_BIND").unwrap_or_else(|_| "127.0.0.1:8099".to_string());
    let addr: SocketAddr = bind_addr
        .parse()
        .unwrap_or_else(|_| panic!("invalid RUST_RUNTIME_BIND address: {bind_addr}"));

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .unwrap_or_else(|err| panic!("failed to bind {addr}: {err}"));

    info!(%addr, "starting codex-lb rust runtime scaffold");

    axum::serve(listener, app())
        .with_graceful_shutdown(shutdown_signal())
        .await
        .expect("server crashed");
}

fn init_tracing() {
    let filter = tracing_subscriber::EnvFilter::try_from_default_env()
        .unwrap_or_else(|_| tracing_subscriber::EnvFilter::new("info"));
    tracing_subscriber::fmt().with_env_filter(filter).init();
}

async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        let mut terminate = signal(SignalKind::terminate()).expect("install SIGTERM handler");
        tokio::select! {
            _ = tokio::signal::ctrl_c() => {}
            _ = terminate.recv() => {}
        }
    }

    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}

async fn health() -> Json<StatusResponse> {
    Json(StatusResponse { status: "ok" })
}

async fn health_live() -> Json<HealthCheckResponse> {
    Json(HealthCheckResponse {
        status: "ok",
        checks: None,
        bridge_ring: None,
    })
}

async fn health_ready(
    State(state): State<RuntimeState>,
) -> Result<Json<HealthCheckResponse>, (StatusCode, Json<ErrorDetailResponse>)> {
    if state.flags.draining {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorDetailResponse {
                detail: "Service is draining",
            }),
        ));
    }

    let mut checks = BTreeMap::new();
    checks.insert("database", "ok");
    Ok(Json(HealthCheckResponse {
        status: "ok",
        checks: Some(checks),
        bridge_ring: None,
    }))
}

async fn health_startup(
    State(state): State<RuntimeState>,
) -> Result<Json<HealthCheckResponse>, (StatusCode, Json<ErrorDetailResponse>)> {
    if state.flags.startup_pending {
        return Err((
            StatusCode::SERVICE_UNAVAILABLE,
            Json(ErrorDetailResponse {
                detail: "Service is starting",
            }),
        ));
    }

    Ok(Json(HealthCheckResponse {
        status: "ok",
        checks: None,
        bridge_ring: None,
    }))
}

async fn runtime_info(State(state): State<RuntimeState>) -> Json<RuntimeInfoResponse> {
    Json(RuntimeInfoResponse {
        service: "codex-lb-rust-runtime",
        language: "rust",
        version: env!("CARGO_PKG_VERSION"),
        profile: state.flags.profile,
    })
}

async fn live_usage() -> impl IntoResponse {
    let generated_at = generated_at_epoch_seconds();
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<live_usage generated_at="{generated_at}" total_sessions="0" mapped_sessions="0" unattributed_sessions="0" total_task_previews="0" account_task_previews="0" session_task_previews="0">
</live_usage>
"#
    );

    (
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::CONTENT_TYPE, "application/xml"),
        ],
        xml,
    )
}

async fn live_usage_mapping() -> impl IntoResponse {
    let generated_at = generated_at_epoch_seconds();
    let xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<live_usage_mapping generated_at="{generated_at}" active_snapshot="" total_process_sessions="0" total_runtime_sessions="0" account_count="0" working_now_count="0" minimal="false">
  <accounts count="0">
  </accounts>
  <unmapped_cli_snapshots count="0">
  </unmapped_cli_snapshots>
</live_usage_mapping>
"#
    );

    (
        [
            (header::CACHE_CONTROL, "no-store"),
            (header::CONTENT_TYPE, "application/xml"),
        ],
        xml,
    )
}

async fn python_layer_health(
    State(state): State<RuntimeState>,
) -> (StatusCode, Json<PythonLayerHealthResponse>) {
    let mut checks = BTreeMap::new();

    for endpoint in [
        "/health",
        "/health/live",
        "/health/ready",
        "/health/startup",
    ] {
        let check =
            probe_python_endpoint(&state.python_client, &state.python_base_url, endpoint).await;
        checks.insert(endpoint.to_string(), check);
    }

    let all_ok = checks.values().all(|check| check.ok);
    let response = PythonLayerHealthResponse {
        status: if all_ok { "ok" } else { "degraded" },
        python_base_url: state.python_base_url,
        checks,
    };

    (
        if all_ok {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        Json(response),
    )
}

async fn probe_python_endpoint(
    client: &Client,
    base_url: &str,
    endpoint: &str,
) -> PythonEndpointCheck {
    let url = format!("{}{}", base_url.trim_end_matches('/'), endpoint);
    match client.get(url).send().await {
        Ok(response) => {
            let status = response.status();
            PythonEndpointCheck {
                status_code: Some(status.as_u16()),
                ok: status.is_success(),
                detail: if status.is_success() {
                    "ok".to_string()
                } else {
                    format!("upstream returned {}", status.as_u16())
                },
            }
        }
        Err(error) => PythonEndpointCheck {
            status_code: None,
            ok: false,
            detail: format!("request failed: {error}"),
        },
    }
}

async fn root_panel(State(state): State<RuntimeState>) -> Html<String> {
    let version = env!("CARGO_PKG_VERSION");
    Html(format!(
        r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rust Runtime Health</title>
    <style>
      :root {{
        color-scheme: dark;
        --bg: #0f172a;
        --card: #111827;
        --border: #334155;
        --text: #e2e8f0;
        --muted: #94a3b8;
        --ok: #22c55e;
      }}
      * {{ box-sizing: border-box; }}
      body {{
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at top, #1e293b 0%, var(--bg) 55%);
        color: var(--text);
        font-family: "Space Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        padding: 24px;
      }}
      .panel {{
        width: min(720px, 100%);
        background: color-mix(in oklab, var(--card) 92%, black);
        border: 1px solid var(--border);
        border-radius: 18px;
        padding: 24px;
        box-shadow: 0 24px 60px rgba(0, 0, 0, 0.35);
      }}
      .title {{ font-size: clamp(1.2rem, 3.2vw, 1.8rem); margin: 0 0 10px; }}
      .status {{
        display: inline-flex;
        align-items: center;
        gap: 10px;
        padding: 8px 12px;
        border-radius: 999px;
        background: rgba(34, 197, 94, 0.15);
        color: #86efac;
        border: 1px solid rgba(34, 197, 94, 0.4);
        margin-bottom: 14px;
      }}
      .dot {{
        width: 10px;
        height: 10px;
        border-radius: 50%;
        background: var(--ok);
        box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.18);
      }}
      .meta {{ color: var(--muted); margin-bottom: 16px; }}
      .links {{ display: grid; gap: 8px; }}
      a {{
        color: #93c5fd;
        text-decoration: none;
        border: 1px solid var(--border);
        border-radius: 10px;
        padding: 10px 12px;
        background: rgba(15, 23, 42, 0.5);
      }}
      a:hover {{ background: rgba(30, 41, 59, 0.7); }}
    </style>
  </head>
  <body>
    <main class="panel">
      <h1 class="title">codex-lb rust runtime</h1>
      <div class="status"><span class="dot"></span>Rust runtime is healthy and running</div>
      <div class="meta">version: {version} · profile: {profile}</div>
      <div class="links">
        <a href="/health">/health</a>
        <a href="/health/live">/health/live</a>
        <a href="/health/ready">/health/ready</a>
        <a href="/health/startup">/health/startup</a>
        <a href="/_rust_layer/info">/_rust_layer/info</a>
        <a href="/_python_layer/health">/_python_layer/health</a>
      </div>
    </main>
  </body>
</html>
"#,
        profile = state.flags.profile
    ))
}

fn runtime_state_from_env() -> RuntimeState {
    runtime_state_with_flags(runtime_flags_from_env())
}

fn runtime_state_with_flags(flags: RuntimeFlags) -> RuntimeState {
    let python_base_url =
        env::var("PYTHON_RUNTIME_BASE_URL").unwrap_or_else(|_| "http://127.0.0.1:8000".to_string());

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

fn generated_at_epoch_seconds() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

#[cfg(test)]
mod tests {
    use super::{RuntimeFlags, RuntimeState, app, app_with_flags, app_with_state};
    use axum::{
        Json, Router,
        body::Body,
        http::{Request, StatusCode},
        routing::get,
    };
    use serde_json::{Value, json};
    use std::time::Duration;
    use tower::ServiceExt;

    #[tokio::test]
    async fn health_endpoint_returns_ok() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn health_live_shape_matches_python_contract() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/health/live")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["status"], "ok");
        assert!(payload["checks"].is_null());
        assert!(payload["bridge_ring"].is_null());
    }

    #[tokio::test]
    async fn health_ready_reports_database_check() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/health/ready")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["status"], "ok");
        assert_eq!(payload["checks"]["database"], "ok");
    }

    #[tokio::test]
    async fn health_startup_defaults_to_ok() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/health/startup")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
    }

    #[tokio::test]
    async fn health_startup_pending_returns_503() {
        let response = app_with_flags(RuntimeFlags {
            profile: "test".to_string(),
            draining: false,
            startup_pending: true,
        })
        .oneshot(
            Request::builder()
                .uri("/health/startup")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["detail"], "Service is starting");
    }

    #[tokio::test]
    async fn live_usage_returns_xml_with_no_store_cache() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/live_usage")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
        assert!(
            response
                .headers()
                .get("content-type")
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("application/xml")
        );

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let body_text = String::from_utf8(body.to_vec()).unwrap();
        assert!(body_text.contains("<live_usage "));
        assert!(body_text.contains("total_sessions=\"0\""));
    }

    #[tokio::test]
    async fn live_usage_mapping_returns_xml_with_no_store_cache() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/live_usage/mapping")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");
        assert!(
            response
                .headers()
                .get("content-type")
                .unwrap()
                .to_str()
                .unwrap()
                .starts_with("application/xml")
        );

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let body_text = String::from_utf8(body.to_vec()).unwrap();
        assert!(body_text.contains("<live_usage_mapping "));
        assert!(body_text.contains("account_count=\"0\""));
    }

    #[tokio::test]
    async fn runtime_info_includes_rust_identity() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/_rust_layer/info")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["language"], "rust");
        assert_eq!(payload["service"], "codex-lb-rust-runtime");
    }

    #[tokio::test]
    async fn root_panel_returns_health_message() {
        let response = app()
            .oneshot(Request::builder().uri("/").body(Body::empty()).unwrap())
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let body_text = String::from_utf8(body.to_vec()).unwrap();
        assert!(body_text.contains("Rust runtime is healthy and running"));
        assert!(body_text.contains("/health/ready"));
        assert!(body_text.contains("/health/startup"));
        assert!(body_text.contains("/_rust_layer/info"));
        assert!(body_text.contains("/_python_layer/health"));
    }

    #[tokio::test]
    async fn python_layer_health_reports_ok_for_healthy_upstream() {
        let (python_base_url, server_handle) = spawn_python_stub(StatusCode::OK).await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/_python_layer/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["status"], "ok");
        assert_eq!(payload["checks"]["/health"]["ok"], true);
        assert_eq!(payload["checks"]["/health/startup"]["status_code"], 200);

        server_handle.abort();
    }

    #[tokio::test]
    async fn python_layer_health_fails_closed_when_upstream_degrades() {
        let (python_base_url, server_handle) =
            spawn_python_stub(StatusCode::SERVICE_UNAVAILABLE).await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/_python_layer/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["status"], "degraded");
        assert_eq!(payload["checks"]["/health/startup"]["ok"], false);
        assert_eq!(payload["checks"]["/health/startup"]["status_code"], 503);

        server_handle.abort();
    }

    fn state_for_python_base_url(python_base_url: String) -> RuntimeState {
        RuntimeState {
            flags: RuntimeFlags {
                profile: "test".to_string(),
                draining: false,
                startup_pending: false,
            },
            python_base_url,
            python_client: reqwest::Client::builder()
                .timeout(Duration::from_millis(500))
                .build()
                .unwrap(),
        }
    }

    async fn spawn_python_stub(
        startup_status: StatusCode,
    ) -> (String, tokio::task::JoinHandle<Result<(), std::io::Error>>) {
        let router = Router::new()
            .route("/health", get(|| async { Json(json!({ "status": "ok" })) }))
            .route(
                "/health/live",
                get(|| async {
                    Json(json!({
                        "status": "ok",
                        "checks": Value::Null,
                        "bridge_ring": Value::Null
                    }))
                }),
            )
            .route(
                "/health/ready",
                get(|| async { Json(json!({ "status": "ok", "checks": { "database": "ok" } })) }),
            )
            .route(
                "/health/startup",
                get(move || async move {
                    (
                        startup_status,
                        Json(if startup_status == StatusCode::OK {
                            json!({ "status": "ok" })
                        } else {
                            json!({ "detail": "Service is starting" })
                        }),
                    )
                }),
            );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move { axum::serve(listener, router).await });

        (format!("http://{addr}"), handle)
    }
}
