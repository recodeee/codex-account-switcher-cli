use super::state::RuntimeState;
use axum::{
    body::{Body, Bytes},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::Response,
};
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn reqwest_method_from_axum(method: &axum::http::Method) -> reqwest::Method {
    reqwest::Method::from_bytes(method.as_str().as_bytes()).unwrap_or(reqwest::Method::GET)
}

pub(crate) async fn proxy_python_live_usage_xml(
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

pub(crate) async fn proxy_python_json_endpoint(
    state: &RuntimeState,
    endpoint: &str,
    raw_query: Option<&str>,
    incoming_headers: &HeaderMap,
) -> Response {
    proxy_python_json_endpoint_with_method(
        state,
        reqwest::Method::GET,
        endpoint,
        raw_query,
        incoming_headers,
        None,
    )
    .await
}

pub(crate) async fn proxy_python_json_endpoint_with_method(
    state: &RuntimeState,
    method: reqwest::Method,
    endpoint: &str,
    raw_query: Option<&str>,
    incoming_headers: &HeaderMap,
    body: Option<Bytes>,
) -> Response {
    proxy_python_endpoint_with_method(
        state,
        method,
        endpoint,
        raw_query,
        incoming_headers,
        body,
        "application/json",
    )
    .await
}

pub(crate) async fn proxy_python_raw_endpoint_with_method(
    state: &RuntimeState,
    method: reqwest::Method,
    endpoint: &str,
    raw_query: Option<&str>,
    incoming_headers: &HeaderMap,
    body: Option<Bytes>,
) -> Response {
    proxy_python_endpoint_with_method(
        state,
        method,
        endpoint,
        raw_query,
        incoming_headers,
        body,
        "application/octet-stream",
    )
    .await
}

async fn proxy_python_endpoint_with_method(
    state: &RuntimeState,
    method: reqwest::Method,
    endpoint: &str,
    raw_query: Option<&str>,
    incoming_headers: &HeaderMap,
    body: Option<Bytes>,
    default_content_type: &str,
) -> Response {
    let url = build_python_url(&state.python_base_url, endpoint, raw_query);
    let mut request =
        forward_proxy_headers(state.python_client.request(method, url), incoming_headers);

    if let Some(body) = body {
        request = request.body(body);
    }

    match request.send().await {
        Ok(upstream_response) => {
            let status = upstream_response.status();
            let set_cookie_headers: Vec<HeaderValue> = upstream_response
                .headers()
                .get_all(header::SET_COOKIE)
                .iter()
                .cloned()
                .collect();
            let content_type = upstream_response
                .headers()
                .get(header::CONTENT_TYPE)
                .and_then(|value| value.to_str().ok())
                .unwrap_or(default_content_type)
                .to_string();
            let cache_control = upstream_response
                .headers()
                .get(header::CACHE_CONTROL)
                .and_then(|value| value.to_str().ok())
                .unwrap_or("no-store")
                .to_string();
            let upstream_stream = upstream_response.bytes_stream();
            raw_response(
                status,
                &content_type,
                &cache_control,
                &set_cookie_headers,
                Body::from_stream(upstream_stream),
            )
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
        header::CONTENT_TYPE,
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
    set_cookie_headers: &[HeaderValue],
    body: Body,
) -> Response {
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_TYPE, content_type)
        .header(header::CACHE_CONTROL, cache_control);

    for set_cookie in set_cookie_headers {
        builder = builder.header(header::SET_COOKIE, set_cookie.clone());
    }

    builder.body(body).unwrap_or_else(|_| {
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
        &[],
        Body::from(body),
    )
}

fn generated_at_epoch_seconds() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

pub(crate) fn build_python_url(base_url: &str, endpoint: &str, raw_query: Option<&str>) -> String {
    let mut url = format!("{}{}", base_url.trim_end_matches('/'), endpoint);
    if let Some(query) = raw_query.filter(|query| !query.trim().is_empty()) {
        url.push('?');
        url.push_str(query);
    }
    url
}

pub(crate) fn build_python_ws_url(
    base_url: &str,
    endpoint: &str,
    raw_query: Option<&str>,
) -> String {
    let mut ws_base = base_url.trim_end_matches('/').to_string();
    if let Some(rest) = ws_base.strip_prefix("https://") {
        ws_base = format!("wss://{rest}");
    } else if let Some(rest) = ws_base.strip_prefix("http://") {
        ws_base = format!("ws://{rest}");
    }
    build_python_url(&ws_base, endpoint, raw_query)
}

pub(crate) fn query_param_true(raw_query: Option<&str>, param_name: &str) -> bool {
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

pub(crate) fn fallback_live_usage_xml() -> String {
    let generated_at = generated_at_epoch_seconds();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8"?>
<live_usage generated_at="{generated_at}" total_sessions="0" mapped_sessions="0" unattributed_sessions="0" total_task_previews="0" account_task_previews="0" session_task_previews="0">
</live_usage>
"#
    )
}

pub(crate) fn fallback_live_usage_mapping_xml(minimal: bool) -> String {
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
