use axum::{Json, Router, routing::get};
use serde::Serialize;
use std::{env, net::SocketAddr};
use tracing::info;

#[derive(Debug, Serialize)]
struct StatusResponse {
    status: &'static str,
}

#[derive(Debug, Serialize)]
struct RuntimeInfoResponse {
    service: &'static str,
    language: &'static str,
    version: &'static str,
    profile: String,
}

pub fn app() -> Router {
    Router::new()
        .route("/health", get(health))
        .route("/health/live", get(health_live))
        .route("/_rust_layer/info", get(runtime_info))
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

async fn health_live() -> Json<StatusResponse> {
    Json(StatusResponse { status: "ok" })
}

async fn runtime_info() -> Json<RuntimeInfoResponse> {
    let profile = env::var("RUST_RUNTIME_PROFILE").unwrap_or_else(|_| "phase0".to_string());
    Json(RuntimeInfoResponse {
        service: "codex-lb-rust-runtime",
        language: "rust",
        version: env!("CARGO_PKG_VERSION"),
        profile,
    })
}

#[cfg(test)]
mod tests {
    use super::app;
    use axum::{
        body::Body,
        http::{Request, StatusCode},
    };
    use serde_json::Value;
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
}
