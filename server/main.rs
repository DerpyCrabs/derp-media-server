mod app;
mod config;
mod error;
mod file_mutation;
mod file_search;
mod hermes;
mod hermes_process;
mod html;
mod image_variants;
mod logical_path;
mod media;
mod path_metadata;
mod reader_state;
mod routes;
mod server;
mod settings_persistence;
mod state_db;
mod stats_persistence;
mod store;
mod thumbnails;
mod virtual_directory;
mod workspace_persistence;

#[tokio::main]
async fn main() {
    server::run().await;
}
