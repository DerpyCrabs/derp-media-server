mod app;
mod auth;
mod config;
mod error;
mod file_search;
mod html;
mod markdown_images;
mod media;
mod routes;
mod server;
mod shares;
mod store;
mod thumbnails;
mod workspace_persistence;

#[tokio::main]
async fn main() {
    server::run().await;
}
