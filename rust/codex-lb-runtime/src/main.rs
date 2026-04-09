use axum::{
    Json, Router,
    body::Body,
    extract::{RawQuery, State},
    http::{HeaderMap, StatusCode, header},
    response::{Html, Response},
    routing::get,
};
use reqwest::Client;
use serde::Serialize;
use serde_json::Value;
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

#[derive(Debug, Serialize)]
struct PythonLayerApisResponse {
    status: &'static str,
    python_base_url: String,
    source: &'static str,
    paths: Vec<String>,
    detail: Option<String>,
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

#[cfg(test)]
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
        .route("/api/request-logs", get(request_logs))
        .route("/api/request-logs/options", get(request_logs_options))
        .route(
            "/api/request-logs/usage-summary",
            get(request_logs_usage_summary),
        )
        .route("/api/usage/summary", get(usage_summary))
        .route("/api/usage/history", get(usage_history))
        .route("/api/usage/window", get(usage_window))
        .route("/_rust_layer/info", get(runtime_info))
        .route("/_python_layer/health", get(python_layer_health))
        .route("/_python_layer/apis", get(python_layer_apis))
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

async fn live_usage(State(state): State<RuntimeState>, raw_query: RawQuery) -> Response {
    proxy_python_live_usage_xml(
        &state,
        "/live_usage",
        raw_query.0.as_deref(),
        fallback_live_usage_xml(),
    )
    .await
}

async fn live_usage_mapping(State(state): State<RuntimeState>, raw_query: RawQuery) -> Response {
    let minimal = query_param_true(raw_query.0.as_deref(), "minimal");
    proxy_python_live_usage_xml(
        &state,
        "/live_usage/mapping",
        raw_query.0.as_deref(),
        fallback_live_usage_mapping_xml(minimal),
    )
    .await
}

async fn request_logs(
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    proxy_python_json_endpoint(
        &state,
        "/api/request-logs",
        raw_query.0.as_deref(),
        &headers,
    )
    .await
}

async fn request_logs_options(
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    proxy_python_json_endpoint(
        &state,
        "/api/request-logs/options",
        raw_query.0.as_deref(),
        &headers,
    )
    .await
}

async fn request_logs_usage_summary(
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    proxy_python_json_endpoint(
        &state,
        "/api/request-logs/usage-summary",
        raw_query.0.as_deref(),
        &headers,
    )
    .await
}

async fn usage_summary(
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    proxy_python_json_endpoint(
        &state,
        "/api/usage/summary",
        raw_query.0.as_deref(),
        &headers,
    )
    .await
}

async fn usage_history(
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    proxy_python_json_endpoint(
        &state,
        "/api/usage/history",
        raw_query.0.as_deref(),
        &headers,
    )
    .await
}

async fn usage_window(
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    proxy_python_json_endpoint(
        &state,
        "/api/usage/window",
        raw_query.0.as_deref(),
        &headers,
    )
    .await
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

async fn python_layer_apis(
    State(state): State<RuntimeState>,
) -> (StatusCode, Json<PythonLayerApisResponse>) {
    match fetch_python_openapi_paths(&state.python_client, &state.python_base_url).await {
        Ok(paths) => (
            StatusCode::OK,
            Json(PythonLayerApisResponse {
                status: "ok",
                python_base_url: state.python_base_url,
                source: "openapi",
                paths,
                detail: None,
            }),
        ),
        Err(detail) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(PythonLayerApisResponse {
                status: "degraded",
                python_base_url: state.python_base_url,
                source: "openapi",
                paths: Vec::new(),
                detail: Some(detail),
            }),
        ),
    }
}

async fn fetch_python_openapi_paths(
    client: &Client,
    base_url: &str,
) -> Result<Vec<String>, String> {
    let url = format!("{}{}", base_url.trim_end_matches('/'), "/openapi.json");
    let response = client
        .get(url)
        .send()
        .await
        .map_err(|error| format!("openapi request failed: {error}"))?;

    if !response.status().is_success() {
        return Err(format!("openapi returned {}", response.status().as_u16()));
    }

    let payload: Value = response
        .json()
        .await
        .map_err(|error| format!("openapi json parse failed: {error}"))?;
    let paths_obj = payload
        .get("paths")
        .and_then(|paths| paths.as_object())
        .ok_or_else(|| "openapi missing paths object".to_string())?;

    let mut paths: Vec<String> = paths_obj.keys().cloned().collect();
    paths.sort();
    Ok(paths)
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
      .section-title {{
        margin: 18px 0 8px;
        font-size: 0.86rem;
        color: var(--muted);
        letter-spacing: 0.02em;
      }}
      .python-api-status {{
        margin: 0 0 8px;
        font-size: 0.8rem;
        color: var(--muted);
      }}
      .python-api-status.error {{
        color: #fda4af;
      }}
      .python-api-links {{
        max-height: 260px;
        overflow: auto;
        padding-right: 4px;
      }}
      .python-api-links::-webkit-scrollbar {{
        width: 8px;
      }}
      .python-api-links::-webkit-scrollbar-thumb {{
        background: #334155;
        border-radius: 999px;
      }}
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
        <a href="/_python_layer/apis">/_python_layer/apis</a>
      </div>

      <h2 class="section-title">Python APIs (live from OpenAPI)</h2>
      <p id="python-api-status" class="python-api-status">Loading from {python_base_url}...</p>
      <div id="python-api-links" class="links python-api-links"></div>
    </main>
    <script>
      (async () => {{
        const statusEl = document.getElementById("python-api-status");
        const linksEl = document.getElementById("python-api-links");
        try {{
          const response = await fetch("/_python_layer/apis", {{ cache: "no-store" }});
          const payload = await response.json();
          if (!response.ok || payload.status !== "ok") {{
            const detail = payload && payload.detail ? payload.detail : "python apis unavailable";
            statusEl.textContent = "Python API sync failed: " + detail;
            statusEl.classList.add("error");
            return;
          }}

          statusEl.textContent = "Loaded " + payload.paths.length + " APIs from " + payload.python_base_url;
          const baseUrl = String(payload.python_base_url || "").replace(/\/+$/, "");
          for (const path of payload.paths) {{
            const link = document.createElement("a");
            link.textContent = path;
            link.href = baseUrl + path;
            link.target = "_blank";
            link.rel = "noreferrer";
            linksEl.appendChild(link);
          }}
        }} catch (error) {{
          statusEl.textContent = "Python API sync failed: " + error;
          statusEl.classList.add("error");
        }}
      }})();
    </script>
  </body>
</html>
"#,
        profile = state.flags.profile,
        python_base_url = state.python_base_url
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

async fn proxy_python_live_usage_xml(
    state: &RuntimeState,
    endpoint: &str,
    raw_query: Option<&str>,
    fallback_xml: String,
) -> Response {
    let url = build_python_url(&state.python_base_url, endpoint, raw_query);
    match state.python_client.get(url).send().await {
        Ok(upstream_response) => {
            let status = upstream_response.status();
            let content_type = upstream_response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("application/xml")
                .to_string();
            let cache_control = upstream_response
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("no-store")
                .to_string();

            match upstream_response.text().await {
                Ok(body) => xml_response(status, &content_type, &cache_control, body),
                Err(_) => xml_fallback_response(fallback_xml),
            }
        }
        Err(_) => xml_fallback_response(fallback_xml),
    }
}

fn build_python_url(base_url: &str, endpoint: &str, raw_query: Option<&str>) -> String {
    let mut url = format!("{}{}", base_url.trim_end_matches('/'), endpoint);
    if let Some(query) = raw_query.filter(|query| !query.trim().is_empty()) {
        url.push('?');
        url.push_str(query);
    }
    url
}

fn query_param_true(raw_query: Option<&str>, param_name: &str) -> bool {
    raw_query
        .map(|query| {
            query.split('&').any(|pair| {
                let mut parts = pair.splitn(2, '=');
                let key = parts.next().unwrap_or("").trim();
                let value = parts.next().unwrap_or("").trim();
                key == param_name
                    && matches!(
                        value.to_ascii_lowercase().as_str(),
                        "1" | "true" | "yes" | "on"
                    )
            })
        })
        .unwrap_or(false)
}

fn fallback_live_usage_xml() -> String {
    let generated_at = generated_at_epoch_seconds();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<live_usage generated_at="{generated_at}" total_sessions="0" mapped_sessions="0" unattributed_sessions="0" total_task_previews="0" account_task_previews="0" session_task_previews="0">
</live_usage>
"#
    )
}

fn fallback_live_usage_mapping_xml(minimal: bool) -> String {
    let generated_at = generated_at_epoch_seconds();
    let minimal = if minimal { "true" } else { "false" };
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<live_usage_mapping generated_at="{generated_at}" active_snapshot="" total_process_sessions="0" total_runtime_sessions="0" account_count="0" working_now_count="0" minimal="{minimal}">
  <accounts count="0">
  </accounts>
  <unmapped_cli_snapshots count="0">
  </unmapped_cli_snapshots>
</live_usage_mapping>
"#
    )
}

fn xml_fallback_response(body: String) -> Response {
    xml_response(StatusCode::OK, "application/xml", "no-store", body)
}

fn xml_response(
    status: StatusCode,
    content_type: &str,
    cache_control: &str,
    body: String,
) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, cache_control)
        .body(Body::from(body))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/xml")
                .header(header::CACHE_CONTROL, "no-store")
                .body(Body::from(
                    r#"<?xml version="1.0" encoding="UTF-8"?>
<error detail="invalid response build state" />
"#,
                ))
                .expect("build static XML error response")
        })
}

async fn proxy_python_json_endpoint(
    state: &RuntimeState,
    endpoint: &str,
    raw_query: Option<&str>,
    incoming_headers: &HeaderMap,
) -> Response {
    let url = build_python_url(&state.python_base_url, endpoint, raw_query);
    let request = forward_proxy_headers(state.python_client.get(url), incoming_headers);
    match request.send().await {
        Ok(upstream_response) => {
            let status = upstream_response.status();
            let content_type = upstream_response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("application/json")
                .to_string();
            let cache_control = upstream_response
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("no-store")
                .to_string();

            match upstream_response.bytes().await {
                Ok(body) => raw_response(status, &content_type, &cache_control, Body::from(body)),
                Err(error) => json_fallback_response(format!(
                    r#"{{"detail":"upstream body read failed: {error}"}}"#
                )),
            }
        }
        Err(error) => json_fallback_response(format!(
            r#"{{"detail":"upstream request failed: {error}"}}"#
        )),
    }
}

fn forward_proxy_headers(
    mut request: reqwest::RequestBuilder,
    incoming_headers: &HeaderMap,
) -> reqwest::RequestBuilder {
    for header_name in [
        header::COOKIE,
        header::AUTHORIZATION,
        header::USER_AGENT,
        header::ACCEPT,
    ] {
        if let Some(value) = incoming_headers.get(&header_name) {
            request = request.header(header_name.as_str(), value.clone());
        }
    }
    request
}

fn raw_response(
    status: StatusCode,
    content_type: &str,
    cache_control: &str,
    body: Body,
) -> Response {
    Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, cache_control)
        .body(body)
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::CACHE_CONTROL, "no-store")
                .body(Body::from(r#"{"detail":"invalid response build state"}"#))
                .expect("build static JSON error response")
        })
}

fn json_fallback_response(body: String) -> Response {
    raw_response(
        StatusCode::SERVICE_UNAVAILABLE,
        "application/json",
        "no-store",
        Body::from(body),
    )
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
    async fn live_usage_proxies_python_payload_when_upstream_is_available() {
        let (python_base_url, server_handle) = spawn_python_live_usage_stub().await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
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

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let body_text = String::from_utf8(body.to_vec()).unwrap();
        assert!(body_text.contains("total_sessions=\"4\""));
        assert!(body_text.contains("<snapshot name=\"snapshot-a\""));

        server_handle.abort();
    }

    #[tokio::test]
    async fn live_usage_mapping_forwards_minimal_query_to_upstream() {
        let (python_base_url, server_handle) = spawn_python_live_usage_stub().await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/live_usage/mapping?minimal=true")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(response.headers().get("cache-control").unwrap(), "no-store");

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let body_text = String::from_utf8(body.to_vec()).unwrap();
        assert!(body_text.contains("minimal=\"true\""));
        assert!(body_text.contains("mapped_snapshot=\"minimal\""));

        server_handle.abort();
    }

    #[tokio::test]
    async fn live_usage_mapping_fallback_honors_minimal_query_param() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/live_usage/mapping?minimal=true")
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
        let body_text = String::from_utf8(body.to_vec()).unwrap();
        assert!(body_text.contains("minimal=\"true\""));
    }

    #[tokio::test]
    async fn request_logs_usage_summary_proxies_with_forwarded_cookie() {
        let (python_base_url, server_handle) = spawn_python_dashboard_api_stub().await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/request-logs/usage-summary")
                    .header("cookie", "dashboard_session=test")
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
        assert_eq!(payload["last_5h"]["total_tokens"], 42);
        assert_eq!(payload["last_7d"]["total_tokens"], 420);

        server_handle.abort();
    }

    #[tokio::test]
    async fn usage_history_forwards_query_parameters() {
        let (python_base_url, server_handle) = spawn_python_dashboard_api_stub().await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/usage/history?hours=48")
                    .header("cookie", "dashboard_session=test")
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
        assert_eq!(payload["hours"], 48);
        assert_eq!(payload["status"], "ok");

        server_handle.abort();
    }

    #[tokio::test]
    async fn usage_summary_fails_closed_when_python_unreachable() {
        let app = app_with_state(state_for_python_base_url("http://127.0.0.1:9".to_string()));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/usage/summary")
                    .header("cookie", "dashboard_session=test")
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
        assert!(
            payload["detail"]
                .as_str()
                .unwrap_or_default()
                .contains("upstream request failed")
        );
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
        assert!(body_text.contains("/_python_layer/apis"));
        assert!(body_text.contains("Python APIs (live from OpenAPI)"));
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

    #[tokio::test]
    async fn python_layer_apis_lists_openapi_paths() {
        let (python_base_url, server_handle) = spawn_python_stub(StatusCode::OK).await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/_python_layer/apis")
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
        assert_eq!(payload["source"], "openapi");
        assert!(
            payload["paths"]
                .as_array()
                .unwrap()
                .iter()
                .any(|path| path == "/health")
        );
        assert!(
            payload["paths"]
                .as_array()
                .unwrap()
                .iter()
                .any(|path| path == "/api/new")
        );

        server_handle.abort();
    }

    #[tokio::test]
    async fn python_layer_apis_fails_closed_when_unreachable() {
        let app = app_with_state(state_for_python_base_url("http://127.0.0.1:9".to_string()));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/_python_layer/apis")
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
        assert!(
            payload["detail"]
                .as_str()
                .unwrap_or_default()
                .contains("openapi request failed")
        );
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
            )
            .route(
                "/openapi.json",
                get(|| async {
                    Json(json!({
                        "openapi": "3.1.0",
                        "paths": {
                          "/health": {},
                          "/health/live": {},
                          "/health/ready": {},
                          "/health/startup": {},
                          "/api/new": {}
                        }
                    }))
                }),
            );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move { axum::serve(listener, router).await });

        (format!("http://{addr}"), handle)
    }

    async fn spawn_python_live_usage_stub()
    -> (String, tokio::task::JoinHandle<Result<(), std::io::Error>>) {
        let router = Router::new()
            .route(
                "/live_usage",
                get(|| async {
                    (
                        [
                            ("cache-control", "no-store"),
                            ("content-type", "application/xml"),
                        ],
                        r#"<?xml version="1.0" encoding="UTF-8"?>
<live_usage generated_at="2026-04-09T00:00:00Z" total_sessions="4" mapped_sessions="4" unattributed_sessions="0" total_task_previews="1" account_task_previews="1" session_task_previews="1">
  <snapshot name="snapshot-a" session_count="4" />
</live_usage>
"#,
                    )
                }),
            )
            .route(
                "/live_usage/mapping",
                get(|axum::extract::RawQuery(raw_query): axum::extract::RawQuery| async move {
                    let minimal = raw_query
                        .as_deref()
                        .map(|query| query.contains("minimal=true"))
                        .unwrap_or(false);
                    let minimal_str = if minimal { "true" } else { "false" };
                    let mapped_snapshot = if minimal { "minimal" } else { "full" };
                    (
                        [
                            ("cache-control", "no-store"),
                            ("content-type", "application/xml"),
                        ],
                        format!(
                            r#"<?xml version="1.0" encoding="UTF-8"?>
<live_usage_mapping generated_at="2026-04-09T00:00:00Z" active_snapshot="snapshot-a" total_process_sessions="4" total_runtime_sessions="4" account_count="1" working_now_count="1" minimal="{minimal_str}">
  <accounts count="1">
    <account account_id="acc-1" mapped_snapshot="{mapped_snapshot}" />
  </accounts>
  <unmapped_cli_snapshots count="0">
  </unmapped_cli_snapshots>
</live_usage_mapping>
"#
                        ),
                    )
                }),
            );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move { axum::serve(listener, router).await });

        (format!("http://{addr}"), handle)
    }

    async fn spawn_python_dashboard_api_stub()
    -> (String, tokio::task::JoinHandle<Result<(), std::io::Error>>) {
        let router = Router::new()
            .route(
                "/api/request-logs/usage-summary",
                get(|headers: axum::http::HeaderMap| async move {
                    let has_dashboard_cookie = headers
                        .get("cookie")
                        .and_then(|value| value.to_str().ok())
                        .map(|value| value.contains("dashboard_session=test"))
                        .unwrap_or(false);
                    if !has_dashboard_cookie {
                        return (
                            StatusCode::UNAUTHORIZED,
                            Json(json!({ "detail": "missing dashboard session" })),
                        );
                    }

                    (
                        StatusCode::OK,
                        Json(json!({
                            "last_5h": { "total_tokens": 42, "total_cost_usd": 0.42, "total_cost_eur": 0.39, "accounts": [] },
                            "last_7d": { "total_tokens": 420, "total_cost_usd": 4.2, "total_cost_eur": 3.9, "accounts": [] },
                            "fx_rate_usd_to_eur": 0.93
                        })),
                    )
                }),
            )
            .route(
                "/api/usage/history",
                get(
                    |axum::extract::RawQuery(raw_query): axum::extract::RawQuery,
                     headers: axum::http::HeaderMap| async move {
                        let has_dashboard_cookie = headers
                            .get("cookie")
                            .and_then(|value| value.to_str().ok())
                            .map(|value| value.contains("dashboard_session=test"))
                            .unwrap_or(false);
                        if !has_dashboard_cookie {
                            return (
                                StatusCode::UNAUTHORIZED,
                                Json(json!({ "detail": "missing dashboard session" })),
                            );
                        }

                        let hours = raw_query
                            .as_deref()
                            .and_then(|query| query.split('&').find_map(|pair| pair.split_once('=')))
                            .and_then(|(key, value)| {
                                if key == "hours" {
                                    value.parse::<u64>().ok()
                                } else {
                                    None
                                }
                            })
                            .unwrap_or(24);

                        (
                            StatusCode::OK,
                            Json(json!({
                                "status": "ok",
                                "hours": hours,
                                "points": []
                            })),
                        )
                    },
                ),
            )
            .route(
                "/api/usage/summary",
                get(|| async {
                    (
                        StatusCode::OK,
                        Json(json!({
                            "total_tokens": 100,
                            "total_cost_usd": 1.0,
                            "total_cost_eur": 0.93,
                            "request_count": 5
                        })),
                    )
                }),
            );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move { axum::serve(listener, router).await });

        (format!("http://{addr}"), handle)
    }
}
