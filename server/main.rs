mod app;
mod application_queries;
mod canvas_persistence;
mod config;
mod contracts;
mod error;
mod extractors;
mod file_commands;
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
    let mut arguments = std::env::args();
    let _binary = arguments.next();
    if arguments.next().as_deref() == Some("--export-contracts") {
        let path = arguments
            .next()
            .unwrap_or_else(|| "lib/generated/api-contracts.ts".into());
        contracts::write_typescript(std::path::Path::new(&path))
            .unwrap_or_else(|error| panic!("Failed to export TypeScript contracts: {error}"));
        return;
    }
    server::run().await;
}
