mod app;
mod auth;
mod canvas_persistence;
mod config;
mod error;
mod file_search;
mod hermes;
mod hermes_process;
mod html;
mod image_variants;
mod markdown_images;
mod media;
mod routes;
mod server;
mod shares;
mod store;
mod thumbnails;
mod virtual_directory;
mod workspace_persistence;

#[tokio::main]
async fn main() {
    server::run().await;
}
