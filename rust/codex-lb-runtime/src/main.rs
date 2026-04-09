use axum::{Json, Router, response::Html, routing::get};
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
        .route("/", get(root_panel))
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

async fn root_panel() -> Html<String> {
    let profile = env::var("RUST_RUNTIME_PROFILE").unwrap_or_else(|_| "phase0".to_string());
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
        <a href="/_rust_layer/info">/_rust_layer/info</a>
      </div>
    </main>
  </body>
</html>
"#
    ))
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
        assert!(body_text.contains("/_rust_layer/info"));
    }
}
