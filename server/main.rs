mod app;
mod canvas_persistence;
mod config;
mod error;
mod file_search;
mod hermes;
mod hermes_process;
mod html;
mod image_variants;
mod media;
mod path_metadata;
mod reader_state;
mod routes;
mod server;
mod state_db;
mod store;
mod thumbnails;
mod virtual_directory;
mod workspace_persistence;

#[tokio::main]
async fn main() {
    server::run().await;
}
