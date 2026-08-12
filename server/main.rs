mod access;
mod app;
mod application_queries;
mod auth;
mod config;
mod content_commands;
mod error;
mod file_search;
mod hermes;
mod hermes_process;
mod html;
mod image_variants;
mod markdown_images;
mod media;
mod path_metadata;
mod reader_state;
mod resources;
mod route_contract;
mod routes;
mod server;
mod share_images;
mod shares;
mod spaces;
mod state_db;
mod store;
mod thumbnails;
mod virtual_directory;
mod workspace_persistence;

#[tokio::main]
async fn main() {
    server::run().await;
}
