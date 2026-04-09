use axum::{
    Json, Router,
    body::Bytes,
    extract::{
        Path, RawQuery, State,
        ws::{Message as AxumWsMessage, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::{Html, Response},
    routing::{any, delete, get, head, options, patch, post, put},
};
use futures_util::{SinkExt, StreamExt};
use reqwest::Client;
use serde_json::Value;
use std::{collections::BTreeMap, env, net::SocketAddr, time::Duration};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message as UpstreamWsMessage, client::IntoClientRequest},
};
use tracing::info;

mod runtime;
#[cfg(test)]
use runtime::state::{RuntimeFlags, resolve_python_base_url, runtime_state_with_flags};
use runtime::{
    contracts::{
        ErrorDetailResponse, HealthCheckResponse, PythonEndpointCheck, PythonLayerApisResponse,
        PythonLayerHealthResponse, RuntimeInfoResponse, StatusResponse,
    },
    proxy::{
        fallback_live_usage_mapping_xml, fallback_live_usage_xml, proxy_python_json_endpoint,
        proxy_python_live_usage_xml, proxy_python_raw_endpoint_with_method, query_param_true,
        build_python_ws_url,
    },
    state::{RuntimeState, runtime_state_from_env},
};

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
        .route("/api/dashboard/overview", get(dashboard_overview))
        .route(
            "/api/dashboard/system-monitor",
            get(dashboard_system_monitor),
        )
        .route("/api/projects/plans", get(projects_plans))
        .route("/api/projects/plans/{plan_slug}", get(project_plan))
        .route(
            "/api/projects/plans/{plan_slug}/runtime",
            get(project_plan_runtime),
        )
        .route(
            "/backend-api/codex/responses",
            get(proxy_backend_codex_responses_ws)
                .post(proxy_backend_codex_responses_http)
                .put(proxy_backend_codex_responses_http)
                .patch(proxy_backend_codex_responses_http)
                .delete(proxy_backend_codex_responses_http)
                .options(proxy_backend_codex_responses_http)
                .head(proxy_backend_codex_responses_http),
        )
        .route(
            "/v1/responses",
            get(proxy_v1_responses_ws)
                .post(proxy_v1_responses_http)
                .put(proxy_v1_responses_http)
                .patch(proxy_v1_responses_http)
                .delete(proxy_v1_responses_http)
                .options(proxy_v1_responses_http)
                .head(proxy_v1_responses_http),
        )
        // AGENT NOTE:
        // Keep /api, /backend-api, and /v1 on wildcard proxy routes by default.
        // The Python layer is the source of truth for auth/session enforcement and
        // endpoint surface. Re-adding many explicit Rust handlers here causes drift
        // and frequent compile breakage when parallel work lands in Python APIs.
        .route("/api/{*path}", any(proxy_api_wildcard))
        .route("/backend-api/{*path}", any(proxy_backend_api_wildcard))
        .route("/v1/{*path}", any(proxy_v1_wildcard))
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

async fn dashboard_overview(
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    proxy_python_json_endpoint(
        &state,
        "/api/dashboard/overview",
        raw_query.0.as_deref(),
        &headers,
    )
    .await
}

async fn dashboard_system_monitor(
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    proxy_python_json_endpoint(
        &state,
        "/api/dashboard/system-monitor",
        raw_query.0.as_deref(),
        &headers,
    )
    .await
}

async fn projects_plans(
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    proxy_python_json_endpoint(
        &state,
        "/api/projects/plans",
        raw_query.0.as_deref(),
        &headers,
    )
    .await
}

async fn project_plan(
    State(state): State<RuntimeState>,
    Path(plan_slug): Path<String>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    let endpoint = format!("/api/projects/plans/{plan_slug}");
    proxy_python_json_endpoint(&state, &endpoint, raw_query.0.as_deref(), &headers).await
}

async fn project_plan_runtime(
    State(state): State<RuntimeState>,
    Path(plan_slug): Path<String>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    let endpoint = format!("/api/projects/plans/{plan_slug}/runtime");
    proxy_python_json_endpoint(&state, &endpoint, raw_query.0.as_deref(), &headers).await
}

fn reqwest_method_from_axum(method: &axum::http::Method) -> reqwest::Method {
    runtime::proxy::reqwest_method_from_axum(method)
}

async fn proxy_backend_codex_responses_ws(
    ws_upgrade: WebSocketUpgrade,
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    proxy_websocket_response(
        ws_upgrade,
        state,
        "/backend-api/codex/responses",
        raw_query.0,
        headers,
    )
}

async fn proxy_v1_responses_ws(
    ws_upgrade: WebSocketUpgrade,
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    proxy_websocket_response(
        ws_upgrade,
        state,
        "/v1/responses",
        raw_query.0,
        headers,
    )
}

async fn proxy_backend_codex_responses_http(
    State(state): State<RuntimeState>,
    method: axum::http::Method,
    raw_query: RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    proxy_responses_http_entry(
        state,
        method,
        raw_query.0,
        headers,
        body,
        "/backend-api/codex/responses",
    )
    .await
}

async fn proxy_v1_responses_http(
    State(state): State<RuntimeState>,
    method: axum::http::Method,
    raw_query: RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    proxy_responses_http_entry(state, method, raw_query.0, headers, body, "/v1/responses").await
}

async fn proxy_responses_http_entry(
    state: RuntimeState,
    method: axum::http::Method,
    raw_query: Option<String>,
    headers: HeaderMap,
    body: Bytes,
    endpoint: &'static str,
) -> Response {
    proxy_python_raw_endpoint_with_method(
        &state,
        reqwest_method_from_axum(&method),
        endpoint,
        raw_query.as_deref(),
        &headers,
        Some(body),
    )
    .await
}

fn proxy_websocket_response(
    ws_upgrade: WebSocketUpgrade,
    state: RuntimeState,
    endpoint: &'static str,
    raw_query: Option<String>,
    headers: HeaderMap,
) -> Response {
    let turn_state = downstream_turn_state(&headers);
    let turn_state_header_value = HeaderValue::from_str(&turn_state).ok();
    let on_upgrade_turn_state = turn_state.clone();
    let mut response = ws_upgrade.on_upgrade(move |downstream| {
        proxy_websocket_bridge(
            downstream,
            state,
            endpoint,
            raw_query,
            headers,
            on_upgrade_turn_state,
        )
    });
    if let Some(value) = turn_state_header_value {
        response.headers_mut().insert(
            HeaderName::from_static("x-codex-turn-state"),
            value,
        );
    }
    response
}

async fn proxy_websocket_bridge(
    downstream: WebSocket,
    state: RuntimeState,
    endpoint: &'static str,
    raw_query: Option<String>,
    incoming_headers: HeaderMap,
    turn_state: String,
) {
    let upstream_url = build_python_ws_url(&state.python_base_url, endpoint, raw_query.as_deref());
    let Ok(mut upstream_request) = upstream_url.into_client_request() else {
        let _ = close_websocket_silent(downstream).await;
        return;
    };

    forward_websocket_headers(upstream_request.headers_mut(), &incoming_headers, &turn_state);

    let Ok((upstream, _)) = connect_async(upstream_request).await else {
        let _ = close_websocket_silent(downstream).await;
        return;
    };

    relay_websocket_streams(downstream, upstream).await;
}

fn forward_websocket_headers(
    outgoing_headers: &mut HeaderMap,
    incoming_headers: &HeaderMap,
    turn_state: &str,
) {
    for (name, value) in incoming_headers {
        if is_disallowed_websocket_handshake_header(name) {
            continue;
        }
        outgoing_headers.insert(name.clone(), value.clone());
    }

    let turn_state_header = HeaderName::from_static("x-codex-turn-state");
    if !outgoing_headers.contains_key(&turn_state_header) {
        if let Ok(value) = HeaderValue::from_str(turn_state) {
            outgoing_headers.insert(turn_state_header, value);
        }
    }
}

fn is_disallowed_websocket_handshake_header(name: &HeaderName) -> bool {
    matches!(
        name.as_str().to_ascii_lowercase().as_str(),
        "host"
            | "connection"
            | "upgrade"
            | "sec-websocket-version"
            | "sec-websocket-key"
            | "sec-websocket-extensions"
            | "content-length"
    )
}

fn downstream_turn_state(headers: &HeaderMap) -> String {
    if let Some(value) = headers
        .get("x-codex-turn-state")
        .and_then(|raw| raw.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return value.to_string();
    }
    format!(
        "turn_{:x}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|duration| duration.as_nanos())
            .unwrap_or(0)
    )
}

fn should_upgrade_websocket(
    method: &axum::http::Method,
    headers: &HeaderMap,
    upgrade_extractor_available: bool,
) -> bool {
    upgrade_extractor_available
        && method == axum::http::Method::GET
        && header_has_token(headers, &header::CONNECTION, "upgrade")
        && header_has_token(headers, &header::UPGRADE, "websocket")
}

fn header_has_token(headers: &HeaderMap, name: &HeaderName, token: &str) -> bool {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            value
                .split(',')
                .any(|part| part.trim().eq_ignore_ascii_case(token))
        })
        .unwrap_or(false)
}

async fn relay_websocket_streams(
    downstream: WebSocket,
    upstream: tokio_tungstenite::WebSocketStream<
        tokio_tungstenite::MaybeTlsStream<tokio::net::TcpStream>,
    >,
) {
    let (mut downstream_tx, mut downstream_rx) = downstream.split();
    let (mut upstream_tx, mut upstream_rx) = upstream.split();

    let downstream_to_upstream = async {
        while let Some(message_result) = downstream_rx.next().await {
            let Ok(message) = message_result else {
                break;
            };

            let is_close = matches!(message, AxumWsMessage::Close(_));
            if let Some(upstream_message) = downstream_to_upstream_message(message) {
                if upstream_tx.send(upstream_message).await.is_err() {
                    break;
                }
            }
            if is_close {
                break;
            }
        }
        let _ = upstream_tx.close().await;
    };

    let upstream_to_downstream = async {
        while let Some(message_result) = upstream_rx.next().await {
            let Ok(message) = message_result else {
                break;
            };

            let is_close = matches!(message, UpstreamWsMessage::Close(_));
            if let Some(downstream_message) = upstream_to_downstream_message(message) {
                if downstream_tx.send(downstream_message).await.is_err() {
                    break;
                }
            }
            if is_close {
                break;
            }
        }
        let _ = downstream_tx.send(AxumWsMessage::Close(None)).await;
    };

    tokio::join!(downstream_to_upstream, upstream_to_downstream);
}

fn downstream_to_upstream_message(message: AxumWsMessage) -> Option<UpstreamWsMessage> {
    match message {
        AxumWsMessage::Text(text) => Some(UpstreamWsMessage::Text(text.to_string().into())),
        AxumWsMessage::Binary(binary) => Some(UpstreamWsMessage::Binary(binary)),
        AxumWsMessage::Ping(ping) => Some(UpstreamWsMessage::Ping(ping)),
        AxumWsMessage::Pong(pong) => Some(UpstreamWsMessage::Pong(pong)),
        AxumWsMessage::Close(_) => Some(UpstreamWsMessage::Close(None)),
    }
}

fn upstream_to_downstream_message(message: UpstreamWsMessage) -> Option<AxumWsMessage> {
    match message {
        UpstreamWsMessage::Text(text) => Some(AxumWsMessage::Text(text.to_string().into())),
        UpstreamWsMessage::Binary(binary) => Some(AxumWsMessage::Binary(binary)),
        UpstreamWsMessage::Ping(ping) => Some(AxumWsMessage::Ping(ping)),
        UpstreamWsMessage::Pong(pong) => Some(AxumWsMessage::Pong(pong)),
        UpstreamWsMessage::Close(_) => Some(AxumWsMessage::Close(None)),
        _ => None,
    }
}

async fn close_websocket_silent(mut socket: WebSocket) -> Result<(), axum::Error> {
    socket.send(AxumWsMessage::Close(None)).await
}

async fn proxy_api_wildcard(
    State(state): State<RuntimeState>,
    method: axum::http::Method,
    Path(path): Path<String>,
    raw_query: RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let endpoint = format!("/api/{path}");
    proxy_python_raw_endpoint_with_method(
        &state,
        reqwest_method_from_axum(&method),
        &endpoint,
        raw_query.0.as_deref(),
        &headers,
        Some(body),
    )
    .await
}

async fn proxy_backend_api_wildcard(
    State(state): State<RuntimeState>,
    method: axum::http::Method,
    Path(path): Path<String>,
    raw_query: RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let endpoint = format!("/backend-api/{path}");
    proxy_python_raw_endpoint_with_method(
        &state,
        reqwest_method_from_axum(&method),
        &endpoint,
        raw_query.0.as_deref(),
        &headers,
        Some(body),
    )
    .await
}

async fn proxy_v1_wildcard(
    State(state): State<RuntimeState>,
    method: axum::http::Method,
    Path(path): Path<String>,
    raw_query: RawQuery,
    headers: HeaderMap,
    body: Bytes,
) -> Response {
    let endpoint = format!("/v1/{path}");
    proxy_python_raw_endpoint_with_method(
        &state,
        reqwest_method_from_axum(&method),
        &endpoint,
        raw_query.0.as_deref(),
        &headers,
        Some(body),
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
    let mut last_error = "openapi request failed".to_string();

    for attempt in 0..3 {
        let response = match client.get(&url).send().await {
            Ok(response) => response,
            Err(error) => {
                last_error = format!("openapi request failed: {error}");
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(150 * (attempt + 1) as u64)).await;
                    continue;
                }
                return Err(last_error);
            }
        };

        if !response.status().is_success() {
            last_error = format!("openapi returned {}", response.status().as_u16());
            if attempt < 2 {
                tokio::time::sleep(Duration::from_millis(150 * (attempt + 1) as u64)).await;
                continue;
            }
            return Err(last_error);
        }

        let payload: Value = match response.json().await {
            Ok(payload) => payload,
            Err(error) => {
                last_error = format!("openapi json parse failed: {error}");
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(150 * (attempt + 1) as u64)).await;
                    continue;
                }
                return Err(last_error);
            }
        };

        let paths_obj = match payload.get("paths").and_then(|paths| paths.as_object()) {
            Some(paths_obj) => paths_obj,
            None => {
                last_error = "openapi missing paths object".to_string();
                if attempt < 2 {
                    tokio::time::sleep(Duration::from_millis(150 * (attempt + 1) as u64)).await;
                    continue;
                }
                return Err(last_error);
            }
        };

        let mut paths: Vec<String> = paths_obj.keys().cloned().collect();
        paths.sort();
        return Ok(paths);
    }

    Err(last_error)
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
        const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
        let retryCount = 0;
        while (true) {{
          try {{
            const response = await fetch("/_python_layer/apis", {{ cache: "no-store" }});
            const payload = await response.json();
            if (!response.ok || payload.status !== "ok") {{
              const detail = payload && payload.detail ? payload.detail : "python apis unavailable";
              retryCount += 1;
              statusEl.textContent = "Python API sync retrying (" + retryCount + "): " + detail;
              statusEl.classList.add("error");
              await sleep(Math.min(2500, 300 + retryCount * 200));
              continue;
            }}

            statusEl.classList.remove("error");
            statusEl.textContent = "Loaded " + payload.paths.length + " APIs from " + payload.python_base_url;
            linksEl.innerHTML = "";
            const baseUrl = String(payload.python_base_url || "").replace(/\/+$/, "");
            for (const path of payload.paths) {{
              const link = document.createElement("a");
              link.textContent = path;
              link.href = baseUrl + path;
              link.target = "_blank";
              link.rel = "noreferrer";
              linksEl.appendChild(link);
            }}
            break;
          }} catch (error) {{
            retryCount += 1;
            statusEl.textContent = "Python API sync retrying (" + retryCount + "): " + error;
            statusEl.classList.add("error");
            await sleep(Math.min(2500, 300 + retryCount * 200));
          }}
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

#[cfg(test)]
mod tests {
    use super::{
        RuntimeFlags, RuntimeState, app, app_with_flags, app_with_state, resolve_python_base_url,
    };
    use axum::{
        Json, Router,
        body::Body,
        http::{Request, StatusCode},
        routing::{get, post},
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

    #[test]
    fn python_base_url_prefers_explicit_runtime_value() {
        assert_eq!(
            resolve_python_base_url(Some("http://127.0.0.1:8888"), Some("2455")),
            "http://127.0.0.1:8888"
        );
    }

    #[test]
    fn python_base_url_uses_app_backend_port_when_runtime_value_missing() {
        assert_eq!(
            resolve_python_base_url(None, Some("32455")),
            "http://127.0.0.1:32455"
        );
    }

    #[test]
    fn python_base_url_falls_back_to_default_port_for_invalid_app_port() {
        assert_eq!(
            resolve_python_base_url(None, Some("not-a-port")),
            "http://127.0.0.1:2455"
        );
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
        let app = app_with_state(state_for_python_base_url("http://127.0.0.1:9".to_string()));
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
        let app = app_with_state(state_for_python_base_url("http://127.0.0.1:9".to_string()));
        let response = app
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
    async fn dashboard_overview_proxies_with_forwarded_cookie() {
        let (python_base_url, server_handle) = spawn_python_dashboard_api_stub().await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/dashboard/overview")
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
        assert_eq!(payload["status"], "ok");
        assert_eq!(payload["overview"], "proxied");

        server_handle.abort();
    }

    #[tokio::test]
    async fn dashboard_system_monitor_proxies_upstream_shape() {
        let (python_base_url, server_handle) = spawn_python_dashboard_api_stub().await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/dashboard/system-monitor?include_processes=true")
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
        assert_eq!(payload["status"], "ok");
        assert_eq!(payload["include_processes"], true);

        server_handle.abort();
    }

    #[tokio::test]
    async fn dashboard_system_monitor_fails_closed_without_dashboard_session() {
        let (python_base_url, server_handle) = spawn_python_dashboard_api_stub().await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/dashboard/system-monitor")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["detail"], "missing dashboard session");

        server_handle.abort();
    }

    #[tokio::test]
    async fn dashboard_system_monitor_fails_closed_when_python_unreachable() {
        let app = app_with_state(state_for_python_base_url("http://127.0.0.1:9".to_string()));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/dashboard/system-monitor")
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
    async fn api_wildcard_forwards_dashboard_auth_session() {
        let (python_base_url, server_handle) = spawn_python_dashboard_api_stub().await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/dashboard-auth/session")
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
        assert_eq!(payload["status"], "ok");
        assert_eq!(payload["authenticated"], true);

        server_handle.abort();
    }

    #[tokio::test]
    async fn backend_api_wildcard_forwards_query_parameters() {
        let (python_base_url, server_handle) = spawn_python_dashboard_api_stub().await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/backend-api/ping?scope=ops")
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
        assert_eq!(payload["scope"], "ops");

        server_handle.abort();
    }

    #[tokio::test]
    async fn v1_wildcard_forwards_post_body_content_type_and_set_cookie() {
        let (python_base_url, server_handle) = spawn_python_dashboard_api_stub().await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/echo")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"task":"quota-sync"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert!(response.headers().get("set-cookie").is_some());

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let payload: Value = serde_json::from_slice(&body).unwrap();
        assert_eq!(payload["status"], "ok");
        assert_eq!(payload["content_type"], "application/json");
        assert_eq!(payload["payload"]["task"], "quota-sync");

        server_handle.abort();
    }

    #[tokio::test]
    async fn v1_wildcard_preserves_stream_content_type() {
        let (python_base_url, server_handle) = spawn_python_dashboard_api_stub().await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/v1/events")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"stream":true}"#))
                    .unwrap(),
            )
            .await
            .unwrap();

        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response
                .headers()
                .get("content-type")
                .and_then(|value| value.to_str().ok()),
            Some("text/event-stream")
        );
        assert!(response.headers().get("set-cookie").is_some());

        let body = http_body_util::BodyExt::collect(response.into_body())
            .await
            .unwrap()
            .to_bytes();
        let body_text = String::from_utf8_lossy(&body);
        assert!(body_text.contains("data: ping"));

        server_handle.abort();
    }

    #[tokio::test]
    async fn project_plan_runtime_forwards_slug_and_query_parameters() {
        let (python_base_url, server_handle) = spawn_python_dashboard_api_stub().await;
        let app = app_with_state(state_for_python_base_url(python_base_url));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/projects/plans/plan-alpha/runtime?project_id=proj-7")
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
        assert_eq!(payload["plan_slug"], "plan-alpha");
        assert_eq!(payload["project_id"], "proj-7");
        assert_eq!(payload["runtime_status"], "active");

        server_handle.abort();
    }

    #[tokio::test]
    async fn projects_plans_fail_closed_when_python_unreachable() {
        let app = app_with_state(state_for_python_base_url("http://127.0.0.1:9".to_string()));

        let response = app
            .oneshot(
                Request::builder()
                    .uri("/api/projects/plans")
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
        fn has_dashboard_cookie(headers: &axum::http::HeaderMap) -> bool {
            headers
                .get("cookie")
                .and_then(|value| value.to_str().ok())
                .map(|value| value.contains("dashboard_session=test"))
                .unwrap_or(false)
        }

        fn query_param(raw_query: Option<&str>, key: &str) -> Option<String> {
            raw_query.and_then(|query| {
                query
                    .split('&')
                    .filter_map(|pair| pair.split_once('='))
                    .find_map(|(pair_key, value)| {
                        if pair_key == key {
                            Some(value.to_string())
                        } else {
                            None
                        }
                    })
            })
        }

        let router = Router::new()
            .route(
                "/api/request-logs/usage-summary",
                get(|headers: axum::http::HeaderMap| async move {
                    if !has_dashboard_cookie(&headers) {
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
                        if !has_dashboard_cookie(&headers) {
                            return (
                                StatusCode::UNAUTHORIZED,
                                Json(json!({ "detail": "missing dashboard session" })),
                            );
                        }

                        let hours = query_param(raw_query.as_deref(), "hours")
                            .and_then(|value| value.parse::<u64>().ok())
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
            )
            .route(
                "/api/dashboard/overview",
                get(|headers: axum::http::HeaderMap| async move {
                    if !has_dashboard_cookie(&headers) {
                        return (
                            StatusCode::UNAUTHORIZED,
                            Json(json!({ "detail": "missing dashboard session" })),
                        );
                    }

                    (
                        StatusCode::OK,
                        Json(json!({
                            "status": "ok",
                            "overview": "proxied"
                        })),
                    )
                }),
            )
            .route(
                "/api/dashboard/system-monitor",
                get(
                    |axum::extract::RawQuery(raw_query): axum::extract::RawQuery,
                     headers: axum::http::HeaderMap| async move {
                        if !has_dashboard_cookie(&headers) {
                            return (
                                StatusCode::UNAUTHORIZED,
                                Json(json!({ "detail": "missing dashboard session" })),
                            );
                        }

                        let include_processes = query_param(raw_query.as_deref(), "include_processes")
                            .map(|value| value == "true")
                            .unwrap_or(false);

                        (
                            StatusCode::OK,
                            Json(json!({
                                "status": "ok",
                                "include_processes": include_processes
                            })),
                        )
                    },
                ),
            )
            .route(
                "/api/dashboard-auth/session",
                get(|headers: axum::http::HeaderMap| async move {
                    if !has_dashboard_cookie(&headers) {
                        return (
                            StatusCode::UNAUTHORIZED,
                            Json(json!({ "detail": "missing dashboard session" })),
                        );
                    }

                    (
                        StatusCode::OK,
                        Json(json!({
                            "status": "ok",
                            "authenticated": true
                        })),
                    )
                }),
            )
            .route(
                "/backend-api/ping",
                get(|axum::extract::RawQuery(raw_query): axum::extract::RawQuery| async move {
                    let scope = query_param(raw_query.as_deref(), "scope").unwrap_or_default();
                    (
                        StatusCode::OK,
                        Json(json!({
                            "status": "ok",
                            "scope": scope
                        })),
                    )
                }),
            )
            .route(
                "/v1/echo",
                post(|headers: axum::http::HeaderMap, body: axum::body::Bytes| async move {
                    let content_type = headers
                        .get("content-type")
                        .and_then(|value| value.to_str().ok())
                        .unwrap_or_default()
                        .to_string();
                    let payload: Value = serde_json::from_slice(&body)
                        .unwrap_or_else(|_| json!({ "task": "" }));

                    (
                        StatusCode::OK,
                        [("set-cookie", "stub_session=ok; HttpOnly; Path=/; SameSite=Lax")],
                        Json(json!({
                            "status": "ok",
                            "content_type": content_type,
                            "payload": payload
                        })),
                    )
                }),
            )
            .route(
                "/v1/events",
                post(|| async move {
                    (
                        StatusCode::OK,
                        [
                            ("content-type", "text/event-stream"),
                            ("cache-control", "no-cache"),
                            ("set-cookie", "stream_session=ok; HttpOnly; Path=/; SameSite=Lax"),
                        ],
                        "data: ping\n\n",
                    )
                }),
            )
            .route(
                "/api/projects/plans",
                get(
                    |axum::extract::RawQuery(raw_query): axum::extract::RawQuery,
                     headers: axum::http::HeaderMap| async move {
                        if !has_dashboard_cookie(&headers) {
                            return (
                                StatusCode::UNAUTHORIZED,
                                Json(json!({ "detail": "missing dashboard session" })),
                            );
                        }

                        let project_id = query_param(raw_query.as_deref(), "project_id");
                        (
                            StatusCode::OK,
                            Json(json!({
                                "status": "ok",
                                "project_id": project_id,
                                "items": [{ "slug": "plan-alpha" }]
                            })),
                        )
                    },
                ),
            )
            .route(
                "/api/projects/plans/{plan_slug}/runtime",
                get(
                    |axum::extract::Path(plan_slug): axum::extract::Path<String>,
                     axum::extract::RawQuery(raw_query): axum::extract::RawQuery,
                     headers: axum::http::HeaderMap| async move {
                        if !has_dashboard_cookie(&headers) {
                            return (
                                StatusCode::UNAUTHORIZED,
                                Json(json!({ "detail": "missing dashboard session" })),
                            );
                        }

                        let project_id = query_param(raw_query.as_deref(), "project_id");
                        (
                            StatusCode::OK,
                            Json(json!({
                                "status": "ok",
                                "plan_slug": plan_slug,
                                "project_id": project_id,
                                "runtime_status": "active"
                            })),
                        )
                    },
                ),
            )
            .route(
                "/api/projects/plans/{plan_slug}",
                get(
                    |axum::extract::Path(plan_slug): axum::extract::Path<String>,
                     headers: axum::http::HeaderMap| async move {
                        if !has_dashboard_cookie(&headers) {
                            return (
                                StatusCode::UNAUTHORIZED,
                                Json(json!({ "detail": "missing dashboard session" })),
                            );
                        }

                        (
                            StatusCode::OK,
                            Json(json!({
                                "status": "ok",
                                "plan_slug": plan_slug
                            })),
                        )
                    },
                ),
            );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        let handle = tokio::spawn(async move { axum::serve(listener, router).await });

        (format!("http://{addr}"), handle)
    }
}
