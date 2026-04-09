use super::{
    proxy::{build_python_ws_url, proxy_python_raw_endpoint_with_method, reqwest_method_from_axum},
    state::RuntimeState,
};
use axum::{
    body::{Body, Bytes},
    extract::{
        Path, RawQuery, State,
        ws::{Message as AxumWsMessage, WebSocket, WebSocketUpgrade},
    },
    http::{HeaderMap, HeaderName, HeaderValue, StatusCode, header},
    response::Response,
};
use futures_util::{SinkExt, StreamExt};
use tokio_tungstenite::{
    connect_async,
    tungstenite::{Message as UpstreamWsMessage, client::IntoClientRequest},
};

pub(crate) async fn proxy_backend_codex_responses_ws(
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

pub(crate) async fn proxy_v1_responses_ws(
    ws_upgrade: WebSocketUpgrade,
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    proxy_websocket_response(ws_upgrade, state, "/v1/responses", raw_query.0, headers)
}

pub(crate) async fn proxy_dashboard_overview_ws(
    ws_upgrade: WebSocketUpgrade,
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    proxy_websocket_response(
        ws_upgrade,
        state,
        "/api/dashboard/overview/ws",
        raw_query.0,
        headers,
    )
}

pub(crate) async fn proxy_account_terminal_ws(
    Path(account_id): Path<String>,
    ws_upgrade: WebSocketUpgrade,
    State(state): State<RuntimeState>,
    raw_query: RawQuery,
    headers: HeaderMap,
) -> Response {
    let endpoint = format!("/api/accounts/{account_id}/terminal/ws");
    proxy_websocket_response(ws_upgrade, state, endpoint, raw_query.0, headers)
}

pub(crate) async fn proxy_backend_codex_responses_http(
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

pub(crate) async fn proxy_v1_responses_http(
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
    if state.is_bridge_drain_active() {
        return bridge_draining_response();
    }

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
    endpoint: impl Into<String>,
    raw_query: Option<String>,
    headers: HeaderMap,
) -> Response {
    if state.is_bridge_drain_active() {
        return bridge_draining_response();
    }

    let endpoint = endpoint.into();
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
        response
            .headers_mut()
            .insert(HeaderName::from_static("x-codex-turn-state"), value);
    }
    response
}

async fn proxy_websocket_bridge(
    downstream: WebSocket,
    state: RuntimeState,
    endpoint: String,
    raw_query: Option<String>,
    incoming_headers: HeaderMap,
    turn_state: String,
) {
    let upstream_url = build_python_ws_url(&state.python_base_url, &endpoint, raw_query.as_deref());
    let Ok(mut upstream_request) = upstream_url.into_client_request() else {
        let _ = close_websocket_silent(downstream).await;
        return;
    };

    forward_websocket_headers(
        upstream_request.headers_mut(),
        &incoming_headers,
        &turn_state,
    );

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
    if !outgoing_headers.contains_key(&turn_state_header)
        && let Ok(value) = HeaderValue::from_str(turn_state)
    {
        outgoing_headers.insert(turn_state_header, value);
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
            if let Some(upstream_message) = downstream_to_upstream_message(message)
                && upstream_tx.send(upstream_message).await.is_err()
            {
                break;
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
            if let Some(downstream_message) = upstream_to_downstream_message(message)
                && downstream_tx.send(downstream_message).await.is_err()
            {
                break;
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
        AxumWsMessage::Text(text) => Some(UpstreamWsMessage::Text(text.to_string())),
        AxumWsMessage::Binary(binary) => Some(UpstreamWsMessage::Binary(binary.to_vec())),
        AxumWsMessage::Ping(ping) => Some(UpstreamWsMessage::Ping(ping.to_vec())),
        AxumWsMessage::Pong(pong) => Some(UpstreamWsMessage::Pong(pong.to_vec())),
        AxumWsMessage::Close(_) => Some(UpstreamWsMessage::Close(None)),
    }
}

fn upstream_to_downstream_message(message: UpstreamWsMessage) -> Option<AxumWsMessage> {
    match message {
        UpstreamWsMessage::Text(text) => Some(AxumWsMessage::Text(text.to_string().into())),
        UpstreamWsMessage::Binary(binary) => Some(AxumWsMessage::Binary(binary.into())),
        UpstreamWsMessage::Ping(ping) => Some(AxumWsMessage::Ping(ping.into())),
        UpstreamWsMessage::Pong(pong) => Some(AxumWsMessage::Pong(pong.into())),
        UpstreamWsMessage::Close(_) => Some(AxumWsMessage::Close(None)),
        _ => None,
    }
}

async fn close_websocket_silent(mut socket: WebSocket) -> Result<(), axum::Error> {
    socket.send(AxumWsMessage::Close(None)).await
}

fn bridge_draining_response() -> Response {
    Response::builder()
        .status(StatusCode::SERVICE_UNAVAILABLE)
        .header(header::CONTENT_TYPE, "application/json")
        .header(header::CACHE_CONTROL, "no-store")
        .body(Body::from(
            r#"{"detail":"HTTP bridge is draining — new sessions not accepted during shutdown"}"#,
        ))
        .unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::SERVICE_UNAVAILABLE)
                .header(header::CONTENT_TYPE, "application/json")
                .header(header::CACHE_CONTROL, "no-store")
                .body(Body::from(r#"{"detail":"Service is draining"}"#))
                .expect("build static JSON draining response")
        })
}
