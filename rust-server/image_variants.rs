use crate::config::ImageOptimizationConfig;
use fast_image_resize::{FilterType, PixelType, ResizeAlg, ResizeOptions, Resizer, images::Image};
use image::{DynamicImage, ImageDecoder};
use moxcms::{ColorProfile, Layout, TransformOptions};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, VecDeque},
    io::BufReader,
    path::{Path, PathBuf},
    sync::atomic::{AtomicU64, Ordering},
    time::{SystemTime, UNIX_EPOCH},
};
use tokio::{
    fs,
    sync::{mpsc, oneshot},
};
use tokio_util::sync::CancellationToken;

const CACHE_SCHEMA: u8 = 1;
const MAX_PIXELS: u64 = 100_000_000;
const MAX_DECODED_BYTES: u64 = 512 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Priority {
    Active = 0,
    Next = 1,
    Prefetch = 2,
}

#[derive(Clone, Copy, Debug)]
pub struct Demand {
    pub viewport_width: f64,
    pub viewport_height: f64,
    pub dpr: f64,
    pub scale: f64,
    pub priority: Priority,
}

#[derive(Debug)]
pub struct Variant {
    pub data: Vec<u8>,
    pub etag: String,
}

#[derive(Clone, Debug)]
struct SourceInfo {
    width: u32,
    height: u32,
    modified_ms: u128,
    size: u64,
}

type Waiter = oneshot::Sender<Result<(), String>>;

enum Message {
    Request {
        id: u64,
        file: PathBuf,
        cache: PathBuf,
        target_width: u32,
        quality: u8,
        priority: Priority,
        waiter: Waiter,
    },
    Cancel {
        id: u64,
        cache: PathBuf,
    },
}

struct Job {
    file: PathBuf,
    cache: PathBuf,
    temp: PathBuf,
    target_width: u32,
    quality: u8,
    priority: Priority,
    waiters: HashMap<u64, Waiter>,
    cancellation: CancellationToken,
    started: bool,
}

struct Completion {
    cache: PathBuf,
    result: Result<(), String>,
}

pub struct ImageVariants {
    config: ImageOptimizationConfig,
    cache_dir: PathBuf,
    sender: mpsc::UnboundedSender<Message>,
    next_id: AtomicU64,
}

impl ImageVariants {
    pub fn new(cache_dir: PathBuf, config: ImageOptimizationConfig) -> Self {
        let concurrency = std::thread::available_parallelism()
            .map(|cores| cores.get().div_ceil(2).clamp(1, 8))
            .unwrap_or(1);
        let (sender, receiver) = mpsc::unbounded_channel();
        tokio::spawn(run_queue(
            receiver,
            concurrency,
            config.max_cache_size,
            cache_dir.clone(),
        ));
        let startup_dir = cache_dir.clone();
        let startup_limit = config.max_cache_size;
        tokio::spawn(async move {
            if let Err(error) = prune_cache(&startup_dir, startup_limit).await {
                eprintln!("Failed to prune image variant cache: {error}");
            }
        });
        Self {
            config,
            cache_dir,
            sender,
            next_id: AtomicU64::new(1),
        }
    }

    pub fn enabled(&self) -> bool {
        self.config.enabled
    }

    pub async fn read(&self, file: &Path, demand: Demand) -> Option<Variant> {
        if !self.config.enabled || !valid_demand(demand) || bypassed(file).await {
            return None;
        }
        let file = file.to_owned();
        let info = tokio::task::spawn_blocking({
            let file = file.clone();
            move || inspect(&file)
        })
        .await
        .ok()
        .and_then(Result::ok)?;
        let required = contained_width(&info, demand);
        if required >= info.width as f64 {
            return None;
        }
        let target_width = self
            .config
            .widths
            .iter()
            .copied()
            .find(|width| *width as f64 >= required)?;
        if target_width >= info.width {
            return None;
        }
        if fs::create_dir_all(&self.cache_dir).await.is_err() {
            return None;
        }
        let cache = self.cache_path(&file, &info, target_width);
        if cache.exists() {
            touch(&cache);
            return fs::read(&cache).await.ok().map(|data| Variant {
                data,
                etag: etag(&cache),
            });
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (waiter, receiver) = oneshot::channel();
        self.sender
            .send(Message::Request {
                id,
                file,
                cache: cache.clone(),
                target_width,
                quality: self.config.quality,
                priority: demand.priority,
                waiter,
            })
            .ok()?;
        let mut guard = RequestGuard {
            id,
            cache: cache.clone(),
            sender: self.sender.clone(),
            complete: false,
        };
        let result = receiver.await.ok()?;
        guard.complete = true;
        if result.is_err() {
            return None;
        }
        fs::read(&cache).await.ok().map(|data| Variant {
            data,
            etag: etag(&cache),
        })
    }

    fn cache_path(&self, file: &Path, info: &SourceInfo, width: u32) -> PathBuf {
        let canonical = std::fs::canonicalize(file).unwrap_or_else(|_| file.to_owned());
        let digest = Sha256::digest(canonical.to_string_lossy().as_bytes());
        let source_hash = digest[..12]
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        self.cache_dir.join(format!(
            "{source_hash}-m{}-s{}-w{width}-q{}-webp-v{CACHE_SCHEMA}.webp",
            info.modified_ms, info.size, self.config.quality
        ))
    }
}

struct RequestGuard {
    id: u64,
    cache: PathBuf,
    sender: mpsc::UnboundedSender<Message>,
    complete: bool,
}

impl Drop for RequestGuard {
    fn drop(&mut self) {
        if !self.complete {
            let _ = self.sender.send(Message::Cancel {
                id: self.id,
                cache: self.cache.clone(),
            });
        }
    }
}

fn valid_demand(demand: Demand) -> bool {
    demand.viewport_width.is_finite()
        && demand.viewport_height.is_finite()
        && demand.dpr.is_finite()
        && demand.scale.is_finite()
        && demand.viewport_width > 0.0
        && demand.viewport_height > 0.0
        && demand.viewport_width <= 32_768.0
        && demand.viewport_height <= 32_768.0
        && demand.dpr > 0.0
        && demand.scale >= 0.25
        && demand.scale <= 4.0
}

fn contained_width(info: &SourceInfo, demand: Demand) -> f64 {
    let dpr = demand.dpr.min(2.0);
    let box_width = demand.viewport_width * dpr * demand.scale;
    let box_height = demand.viewport_height * dpr * demand.scale;
    box_width
        .min(box_height * info.width as f64 / info.height as f64)
        .ceil()
}

fn inspect(file: &Path) -> Result<SourceInfo, String> {
    let metadata = std::fs::metadata(file).map_err(|error| error.to_string())?;
    let reader = image::ImageReader::open(file)
        .map_err(|error| error.to_string())?
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    let mut decoder = reader.into_decoder().map_err(|error| error.to_string())?;
    let (mut width, mut height) = decoder.dimensions();
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    if matches!(
        orientation,
        image::metadata::Orientation::Rotate90
            | image::metadata::Orientation::Rotate270
            | image::metadata::Orientation::Rotate90FlipH
            | image::metadata::Orientation::Rotate270FlipH
    ) {
        std::mem::swap(&mut width, &mut height);
    }
    let pixels = u64::from(width) * u64::from(height);
    if pixels > MAX_PIXELS || pixels.saturating_mul(4) > MAX_DECODED_BYTES {
        return Err("Image exceeds optimization safety limits".into());
    }
    Ok(SourceInfo {
        width,
        height,
        modified_ms: metadata
            .modified()
            .unwrap_or(UNIX_EPOCH)
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis(),
        size: metadata.len(),
    })
}

async fn bypassed(file: &Path) -> bool {
    let extension = file
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "jpg" | "jpeg" | "png" | "webp") {
        return true;
    }
    if extension == "jpg" || extension == "jpeg" {
        return false;
    }
    let file = file.to_owned();
    tokio::task::spawn_blocking(move || {
        let input = BufReader::new(std::fs::File::open(file).ok()?);
        Some(if extension == "png" {
            image::codecs::png::PngDecoder::new(input)
                .ok()?
                .is_apng()
                .ok()?
        } else {
            image::codecs::webp::WebPDecoder::new(input)
                .ok()?
                .has_animation()
        })
    })
    .await
    .ok()
    .flatten()
    .unwrap_or(true)
}

async fn run_queue(
    mut receiver: mpsc::UnboundedReceiver<Message>,
    concurrency: usize,
    max_cache_size: u64,
    cache_dir: PathBuf,
) {
    let (completion_sender, mut completions) = mpsc::unbounded_channel::<Completion>();
    let mut jobs = HashMap::<PathBuf, Job>::new();
    let mut pending = [VecDeque::<PathBuf>::new(), VecDeque::new(), VecDeque::new()];
    let mut active = 0usize;
    loop {
        tokio::select! {
            message = receiver.recv() => match message {
                Some(Message::Request { id, file, cache, target_width, quality, priority, waiter }) => {
                    if cache.exists() { let _ = waiter.send(Ok(())); continue; }
                    let job = jobs.entry(cache.clone()).or_insert_with(|| {
                        pending[priority as usize].push_back(cache.clone());
                        Job {
                            file,
                            cache: cache.clone(),
                            temp: cache.with_extension(format!("{}.tmp.webp", uuid::Uuid::new_v4())),
                            target_width,
                            quality,
                            priority,
                            waiters: HashMap::new(),
                            cancellation: CancellationToken::new(),
                            started: false,
                        }
                    });
                    if !job.started && (priority as usize) < job.priority as usize {
                        job.priority = priority;
                        pending[priority as usize].push_back(cache.clone());
                    }
                    job.waiters.insert(id, waiter);
                }
                Some(Message::Cancel { id, cache }) => {
                    if let Some(job) = jobs.get_mut(&cache) {
                        job.waiters.remove(&id);
                        if job.waiters.is_empty() {
                            if job.started { job.cancellation.cancel(); }
                            else { jobs.remove(&cache); }
                        }
                    }
                }
                None => break,
            },
            completion = completions.recv(), if active > 0 => if let Some(completion) = completion {
                if let Some(mut job) = jobs.remove(&completion.cache) {
                    for (_, waiter) in job.waiters.drain() { let _ = waiter.send(completion.result.clone()); }
                    let _ = fs::remove_file(&job.temp).await;
                }
                active -= 1;
            }
        }
        while active < concurrency {
            let next = pending.iter_mut().find_map(VecDeque::pop_front);
            let Some(cache) = next else { break };
            let Some(job) = jobs.get_mut(&cache) else {
                continue;
            };
            if job.started || job.waiters.is_empty() {
                continue;
            }
            job.started = true;
            active += 1;
            let file = job.file.clone();
            let cache = job.cache.clone();
            let temp = job.temp.clone();
            let target_width = job.target_width;
            let quality = job.quality;
            let cancellation = job.cancellation.clone();
            let sender = completion_sender.clone();
            let prune_dir = cache_dir.clone();
            tokio::spawn(async move {
                let result =
                    generate_and_commit(&file, &temp, &cache, target_width, quality, &cancellation)
                        .await
                        .map_err(|error| error.to_string());
                let successful = result.is_ok();
                if let Err(error) = &result
                    && error != "request aborted"
                {
                    eprintln!(
                        "Image variant generation failed for {}: {error}",
                        cache.display()
                    );
                }
                let _ = sender.send(Completion { cache, result });
                if successful {
                    tokio::spawn(async move {
                        if let Err(error) = prune_cache(&prune_dir, max_cache_size).await {
                            eprintln!("Failed to prune image variant cache: {error}");
                        }
                    });
                }
            });
        }
    }
}

async fn generate_and_commit(
    file: &Path,
    temp: &Path,
    cache: &Path,
    target_width: u32,
    quality: u8,
    cancellation: &CancellationToken,
) -> Result<(), String> {
    if cancellation.is_cancelled() {
        return Err("request aborted".into());
    }
    let file = file.to_owned();
    let temp = temp.to_owned();
    let generation_temp = temp.clone();
    let result = tokio::task::spawn_blocking(move || {
        generate(&file, &generation_temp, target_width, quality)
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Err(error) = result {
        let _ = fs::remove_file(temp).await;
        return Err(error);
    }
    if cancellation.is_cancelled() {
        let _ = fs::remove_file(temp).await;
        return Err("request aborted".into());
    }
    fs::rename(temp, cache)
        .await
        .map_err(|error| error.to_string())
}

fn generate(file: &Path, output: &Path, target_width: u32, quality: u8) -> Result<(), String> {
    let reader = image::ImageReader::open(file)
        .map_err(|error| error.to_string())?
        .with_guessed_format()
        .map_err(|error| error.to_string())?;
    let mut decoder = reader.into_decoder().map_err(|error| error.to_string())?;
    let orientation = decoder
        .orientation()
        .unwrap_or(image::metadata::Orientation::NoTransforms);
    let icc = decoder.icc_profile().map_err(|error| error.to_string())?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(|error| error.to_string())?;
    image.apply_orientation(orientation);
    let source_width = image.width();
    let source_height = image.height();
    let target_height = (u64::from(source_height) * u64::from(target_width))
        .div_ceil(u64::from(source_width))
        .max(1) as u32;
    let has_alpha = image.color().has_alpha();
    let source = Image::from_vec_u8(
        source_width,
        source_height,
        image.into_rgba8().into_raw(),
        PixelType::U8x4,
    )
    .map_err(|error| error.to_string())?;
    let mut resized = Image::new(target_width, target_height, PixelType::U8x4);
    let options = ResizeOptions::new()
        .resize_alg(ResizeAlg::Convolution(FilterType::Lanczos3))
        .use_alpha(has_alpha);
    Resizer::new()
        .resize(&source, &mut resized, &options)
        .map_err(|error| error.to_string())?;
    let mut rgba = resized.buffer().to_vec();
    if let Some(icc) = icc.filter(|profile| !profile.is_empty()) {
        let source = ColorProfile::new_from_slice(&icc).map_err(|error| error.to_string())?;
        let destination = ColorProfile::new_srgb();
        let transform = source
            .create_transform_8bit(
                Layout::Rgba,
                &destination,
                Layout::Rgba,
                TransformOptions::default(),
            )
            .map_err(|error| error.to_string())?;
        let mut converted = vec![0; rgba.len()];
        let stride = target_width as usize * 4;
        for (source_row, destination_row) in rgba
            .chunks_exact(stride)
            .zip(converted.chunks_exact_mut(stride))
        {
            transform
                .transform(source_row, destination_row)
                .map_err(|error| error.to_string())?;
        }
        rgba = converted;
    }
    let mut webp_config =
        webp::WebPConfig::new().map_err(|_| "Failed to initialize WebP encoder".to_string())?;
    webp_config.quality = quality as f32;
    webp_config.method = 1;
    webp_config.thread_level = 1;
    webp_config.alpha_compression = 1;
    let encoded = webp::Encoder::from_rgba(&rgba, target_width, target_height)
        .encode_advanced(&webp_config)
        .map_err(|error| format!("WebP encoding failed: {error:?}"))?;
    std::fs::write(output, &*encoded).map_err(|error| error.to_string())
}

fn etag(path: &Path) -> String {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    format!("\"{name}\"")
}

fn touch(path: &Path) {
    let path = path.to_owned();
    tokio::task::spawn_blocking(move || {
        let _ = filetime::set_file_mtime(
            path,
            filetime::FileTime::from_system_time(SystemTime::now()),
        );
    });
}

async fn prune_cache(cache_dir: &Path, max_size: u64) -> Result<(), String> {
    fs::create_dir_all(cache_dir)
        .await
        .map_err(|error| error.to_string())?;
    let mut directory = fs::read_dir(cache_dir)
        .await
        .map_err(|error| error.to_string())?;
    let mut entries = Vec::new();
    let mut total = 0_u64;
    while let Some(entry) = directory
        .next_entry()
        .await
        .map_err(|error| error.to_string())?
    {
        if entry.path().extension().and_then(|value| value.to_str()) != Some("webp") {
            continue;
        }
        let Ok(metadata) = entry.metadata().await else {
            continue;
        };
        total = total.saturating_add(metadata.len());
        entries.push((
            metadata.modified().unwrap_or(UNIX_EPOCH),
            metadata.len(),
            entry.path(),
        ));
    }
    if total <= max_size {
        return Ok(());
    }
    entries.sort_by_key(|entry| entry.0);
    let target = max_size.saturating_mul(9) / 10;
    for (_, size, path) in entries {
        if total <= target {
            break;
        }
        if fs::remove_file(path).await.is_ok() {
            total = total.saturating_sub(size);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::GenericImageView;

    #[test]
    fn contained_width_respects_portrait_height_dpr_and_zoom() {
        let info = SourceInfo {
            width: 1000,
            height: 2000,
            modified_ms: 0,
            size: 0,
        };
        let demand = Demand {
            viewport_width: 1900.0,
            viewport_height: 1000.0,
            dpr: 2.0,
            scale: 1.0,
            priority: Priority::Active,
        };
        assert_eq!(contained_width(&info, demand), 1000.0);
    }

    #[test]
    fn demand_validation_rejects_resource_abuse() {
        let mut demand = Demand {
            viewport_width: 1000.0,
            viewport_height: 800.0,
            dpr: 4.0,
            scale: 1.0,
            priority: Priority::Active,
        };
        assert!(valid_demand(demand));
        demand.viewport_width = 100_000.0;
        assert!(!valid_demand(demand));
    }

    #[tokio::test]
    async fn generates_bucketed_webp_and_reuses_visible_cache_identity() {
        let base =
            std::env::temp_dir().join(format!("derp-image-variants-{}", uuid::Uuid::new_v4()));
        let cache = base.join("cache");
        let source = base.join("source.png");
        std::fs::create_dir_all(&base).unwrap();
        let pixels = vec![127_u8; 2000 * 1000 * 3];
        image::save_buffer(&source, &pixels, 2000, 1000, image::ExtendedColorType::Rgb8).unwrap();
        let variants = ImageVariants::new(
            cache.clone(),
            ImageOptimizationConfig {
                widths: vec![640, 1280],
                quality: 82,
                max_cache_size: 64 * 1024 * 1024,
                enabled: true,
            },
        );
        let demand = Demand {
            viewport_width: 500.0,
            viewport_height: 500.0,
            dpr: 1.0,
            scale: 1.0,
            priority: Priority::Active,
        };
        let first = variants.read(&source, demand).await.unwrap();
        let decoded = image::load_from_memory(&first.data).unwrap();
        assert_eq!(decoded.dimensions(), (640, 320));
        let names = std::fs::read_dir(&cache)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        assert_eq!(names.len(), 1);
        assert!(names[0].contains("-w640-q82-webp-v1.webp"));
        let second = variants.read(&source, demand).await.unwrap();
        assert_eq!(first.etag, second.etag);
        std::fs::remove_dir_all(base).unwrap();
    }
}
