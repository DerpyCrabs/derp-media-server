use crate::{
    error::{AppError, AppResult},
    media,
    state_db::AppDatabase,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use image::{DynamicImage, ImageDecoder, ImageEncoder, ImageFormat, codecs::jpeg::JpegEncoder};
use rusqlite::{OptionalExtension, params};
use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    sync::atomic::{AtomicI8, AtomicU64, Ordering},
    time::{Duration, UNIX_EPOCH},
};
use tokio::{
    fs,
    process::Command,
    sync::{OwnedSemaphorePermit, mpsc, oneshot},
};
use tokio_util::sync::CancellationToken;

type Waiter = oneshot::Sender<Result<(), String>>;

enum CommandMessage {
    Request {
        id: u64,
        file: PathBuf,
        cache: PathBuf,
        waiter: Waiter,
        background: Option<OwnedSemaphorePermit>,
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
    waiters: HashMap<u64, Waiter>,
    cancellation: CancellationToken,
    started: bool,
    _background: Option<OwnedSemaphorePermit>,
    foreground: bool,
}

struct Completion {
    cache: PathBuf,
    result: Result<(), String>,
}

pub struct Thumbnailer {
    cache_dir: PathBuf,
    database: AppDatabase,
    sender: mpsc::UnboundedSender<CommandMessage>,
    next_id: AtomicU64,
}

impl Thumbnailer {
    pub fn new(cache_dir: PathBuf, database: AppDatabase) -> Self {
        let concurrency = std::thread::available_parallelism()
            .map(|cores| cores.get().div_ceil(2).clamp(1, 8))
            .unwrap_or(1);
        Self::with_concurrency(cache_dir, database, concurrency)
    }

    fn with_concurrency(cache_dir: PathBuf, database: AppDatabase, concurrency: usize) -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();
        tokio::spawn(run_queue(receiver, concurrency.max(1)));
        Self {
            cache_dir,
            database,
            sender,
            next_id: AtomicU64::new(1),
        }
    }

    pub fn cached(&self, file: &Path, modified: std::time::SystemTime) -> bool {
        self.existing_cache_path(file, modified)
            .is_some_and(|path| path.exists())
            || (!is_audio(file) && self.legacy_cache_path(file, modified).exists())
    }

    fn modified_ms(modified: std::time::SystemTime) -> u128 {
        modified
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
    }

    fn legacy_cache_path(&self, file: &Path, modified: std::time::SystemTime) -> PathBuf {
        let mtime = Self::modified_ms(modified);
        let source = format!("{}-{mtime}", file.display());
        let key: String = STANDARD
            .encode(source)
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .collect();
        self.cache_dir.join(format!("{key}.jpg"))
    }

    fn existing_cache_id(&self, file: &Path) -> AppResult<Option<String>> {
        self.database
            .connection()?
            .query_row(
                "SELECT cache_id FROM thumbnail_cache_ids WHERE source_path=?1",
                [file.to_string_lossy().as_ref()],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| AppError::internal(error.to_string()))
    }

    fn cache_id(&self, file: &Path) -> AppResult<String> {
        if let Some(id) = self.existing_cache_id(file)? {
            return Ok(id);
        }
        let id = uuid::Uuid::new_v4().simple().to_string();
        let connection = self.database.connection()?;
        connection
            .execute(
                "INSERT OR IGNORE INTO thumbnail_cache_ids(source_path, cache_id) VALUES(?1, ?2)",
                params![file.to_string_lossy().as_ref(), id],
            )
            .map_err(|error| AppError::internal(error.to_string()))?;
        connection
            .query_row(
                "SELECT cache_id FROM thumbnail_cache_ids WHERE source_path=?1",
                [file.to_string_lossy().as_ref()],
                |row| row.get(0),
            )
            .map_err(|error| AppError::internal(error.to_string()))
    }

    fn cache_path_for_id(&self, id: &str, modified: std::time::SystemTime) -> PathBuf {
        self.cache_dir
            .join(format!("{id}-{}.jpg", Self::modified_ms(modified)))
    }

    fn existing_cache_path(&self, file: &Path, modified: std::time::SystemTime) -> Option<PathBuf> {
        self.existing_cache_id(file)
            .ok()
            .flatten()
            .map(|id| self.cache_path_for_id(&versioned_id(file, &id), modified))
    }

    fn cache_path(&self, file: &Path, modified: std::time::SystemTime) -> AppResult<PathBuf> {
        Ok(self.cache_path_for_id(&versioned_id(file, &self.cache_id(file)?), modified))
    }

    pub async fn read(&self, file: &Path, modified: std::time::SystemTime) -> AppResult<Vec<u8>> {
        let _foreground = crate::media_warmup::foreground();
        self.read_inner(file, modified, None).await
    }

    pub async fn warm(&self, file: &Path, modified: std::time::SystemTime) {
        let permit = crate::media_warmup::acquire().await;
        let _ = self.read_inner(file, modified, Some(permit)).await;
    }

    async fn read_inner(
        &self,
        file: &Path,
        modified: std::time::SystemTime,
        background: Option<OwnedSemaphorePermit>,
    ) -> AppResult<Vec<u8>> {
        let warming = background.is_some();
        fs::create_dir_all(&self.cache_dir)
            .await
            .map_err(AppError::io)?;
        let cache = self.cache_path(file, modified)?;
        let legacy = self.legacy_cache_path(file, modified);
        if !is_audio(file) && !cache.exists() && legacy.exists() {
            let _ = fs::rename(&legacy, &cache).await;
        }
        if cache.exists() {
            if warming {
                return Ok(Vec::new());
            }
            match fs::read(&cache).await {
                Ok(data)
                    if image::guess_format(&data)
                        .is_ok_and(|format| format == ImageFormat::Jpeg)
                        && image::load_from_memory(&data).is_ok() =>
                {
                    return Ok(data);
                }
                Ok(_) | Err(_) => {
                    let _ = fs::remove_file(&cache).await;
                }
            }
        }
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let (waiter, receiver) = oneshot::channel();
        self.sender
            .send(CommandMessage::Request {
                id,
                file: file.to_owned(),
                cache: cache.clone(),
                waiter,
                background,
            })
            .map_err(|_| AppError::internal("Thumbnail queue unavailable"))?;
        let mut guard = RequestGuard {
            id,
            cache: cache.clone(),
            sender: self.sender.clone(),
            complete: false,
        };
        receiver
            .await
            .map_err(|_| AppError::internal("Thumbnail queue unavailable"))?
            .map_err(AppError::internal)?;
        guard.complete = true;
        if warming {
            Ok(Vec::new())
        } else {
            fs::read(cache).await.map_err(AppError::io)
        }
    }
}

struct RequestGuard {
    id: u64,
    cache: PathBuf,
    sender: mpsc::UnboundedSender<CommandMessage>,
    complete: bool,
}

impl Drop for RequestGuard {
    fn drop(&mut self) {
        if !self.complete {
            let _ = self.sender.send(CommandMessage::Cancel {
                id: self.id,
                cache: self.cache.clone(),
            });
        }
    }
}

async fn run_queue(mut receiver: mpsc::UnboundedReceiver<CommandMessage>, concurrency: usize) {
    let (complete_sender, mut completions) = mpsc::unbounded_channel::<Completion>();
    let mut jobs = HashMap::<PathBuf, Job>::new();
    let mut pending = VecDeque::<PathBuf>::new();
    let mut active = 0usize;
    loop {
        tokio::select! {
            message = receiver.recv() => match message {
                Some(CommandMessage::Request{id,file,cache,waiter,background}) => {
                    if cache.exists() { let _=waiter.send(Ok(())); continue; }
                    let foreground = background.is_none();
                    let job=jobs.entry(cache.clone()).or_insert_with(||{
                        pending.push_back(cache.clone());
                        Job{file,cache:cache.clone(),temp:cache.with_extension(format!("{}.tmp.jpg",uuid::Uuid::new_v4())),waiters:HashMap::new(),cancellation:CancellationToken::new(),started:false,_background:background,foreground}
                    });
                    job.foreground |= foreground;
                    job.waiters.insert(id,waiter);
                }
                Some(CommandMessage::Cancel{id,cache}) => {
                    if let Some(job)=jobs.get_mut(&cache) {
                        job.waiters.remove(&id);
                        if job.waiters.is_empty() {
                            if !job.started { pending.retain(|candidate|candidate!=&cache); jobs.remove(&cache); }
                        }
                    }
                }
                None => break,
            },
            completion = completions.recv(), if active > 0 => if let Some(completion)=completion {
                if let Some(mut job)=jobs.remove(&completion.cache) {
                    for (_,waiter) in job.waiters.drain(){let _=waiter.send(completion.result.clone());}
                    let _=fs::remove_file(&job.temp).await;
                }
                active-=1;
            }
        }
        while active < concurrency {
            let index = pending
                .iter()
                .position(|cache| jobs.get(cache).is_some_and(|job| job.foreground))
                .unwrap_or(0);
            if let Some(cache) = pending.remove(index) {
                let Some(job) = jobs.get_mut(&cache) else {
                    continue;
                };
                if job.waiters.is_empty() {
                    jobs.remove(&cache);
                    continue;
                }
                job.started = true;
                active += 1;
                let file = job.file.clone();
                let cache = job.cache.clone();
                let temp = job.temp.clone();
                let cancellation = job.cancellation.clone();
                let sender = complete_sender.clone();
                tokio::spawn(async move {
                    let result = generate_and_commit(&file, &temp, &cache, &cancellation)
                        .await
                        .map_err(|error| error.1);
                    let _ = sender.send(Completion { cache, result });
                });
            }
            if pending.is_empty() {
                break;
            }
        }
    }
}

async fn generate_and_commit(
    file: &Path,
    temp: &Path,
    cache: &Path,
    cancellation: &CancellationToken,
) -> AppResult<()> {
    #[cfg(test)]
    crate::queue_test_support::before_generation(cache).await;
    #[cfg(test)]
    {
        TEST_GENERATIONS.fetch_add(1, Ordering::SeqCst);
        let delay = TEST_DELAY_MS.load(Ordering::SeqCst);
        if delay > 0 {
            tokio::time::sleep(Duration::from_millis(delay)).await;
        }
    }
    if cancellation.is_cancelled() {
        return Err(AppError::internal("Thumbnail request aborted"));
    }
    let extension = file
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_ascii_lowercase();
    let result = match media::media_type(&extension) {
        "image" => generate_image(file.to_owned(), temp.to_owned(), cancellation.clone()).await,
        "video" => generate_video(file, temp, cancellation).await,
        "audio" => generate_audio(file, temp, cancellation).await,
        _ => Err(AppError::bad("Unsupported thumbnail media type")),
    };
    if let Err(error) = result {
        let _ = fs::remove_file(temp).await;
        return Err(error);
    }
    if cancellation.is_cancelled() {
        let _ = fs::remove_file(temp).await;
        return Err(AppError::internal("Thumbnail request aborted"));
    }
    fs::rename(temp, cache).await.map_err(AppError::io)
}

async fn generate_image(
    file: PathBuf,
    output: PathBuf,
    cancellation: CancellationToken,
) -> AppResult<()> {
    if cancellation.is_cancelled() {
        return Err(AppError::internal("Thumbnail request aborted"));
    }
    tokio::task::spawn_blocking(move || -> AppResult<()> {
        if file
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("svg"))
        {
            return generate_svg(&file, &output);
        }
        let mut decoder = image::ImageReader::open(file)
            .map_err(AppError::io)?
            .with_guessed_format()
            .map_err(AppError::io)?
            .into_decoder()
            .map_err(|error| AppError::internal(error.to_string()))?;
        let orientation = decoder
            .orientation()
            .unwrap_or(image::metadata::Orientation::NoTransforms);
        let mut image = DynamicImage::from_decoder(decoder)
            .map_err(|error| AppError::internal(error.to_string()))?;
        image.apply_orientation(orientation);
        let resized = if image.width() > 300 {
            image.resize(300, u32::MAX, image::imageops::FilterType::Lanczos3)
        } else {
            image
        };
        let rgb = resized.to_rgb8();
        let writer = std::fs::File::create(output).map_err(AppError::io)?;
        JpegEncoder::new_with_quality(writer, 82)
            .write_image(
                &rgb,
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .map_err(|error| AppError::internal(error.to_string()))
    })
    .await
    .map_err(|error| AppError::internal(error.to_string()))?
}

fn generate_svg(file: &Path, output: &Path) -> AppResult<()> {
    let data = std::fs::read(file).map_err(AppError::io)?;
    let mut options = resvg::usvg::Options::default();
    options.fontdb_mut().load_system_fonts();
    options.resources_dir = file.parent().map(Path::to_path_buf);
    let tree = resvg::usvg::Tree::from_data(&data, &options)
        .map_err(|error| AppError::internal(error.to_string()))?;
    let source = tree.size();
    let scale = (300.0 / source.width()).min(1.0);
    let width = (source.width() * scale).ceil().max(1.0) as u32;
    let height = (source.height() * scale).ceil().max(1.0) as u32;
    let mut pixmap = resvg::tiny_skia::Pixmap::new(width, height)
        .ok_or_else(|| AppError::internal("Invalid SVG dimensions"))?;
    resvg::render(
        &tree,
        resvg::tiny_skia::Transform::from_scale(scale, scale),
        &mut pixmap.as_mut(),
    );
    let rgb = image::RgbaImage::from_raw(width, height, pixmap.take())
        .ok_or_else(|| AppError::internal("Invalid SVG render output"))?;
    let rgb = DynamicImage::ImageRgba8(rgb).to_rgb8();
    let writer = std::fs::File::create(output).map_err(AppError::io)?;
    JpegEncoder::new_with_quality(writer, 82)
        .write_image(
            &rgb,
            rgb.width(),
            rgb.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|error| AppError::internal(error.to_string()))
}

async fn command_output(
    command: &str,
    args: &[String],
    duration: Duration,
    cancellation: &CancellationToken,
) -> AppResult<std::process::Output> {
    if cancellation.is_cancelled() {
        return Err(AppError::internal("Thumbnail request aborted"));
    }
    let mut process = Command::new(command);
    process.args(args).kill_on_drop(true);
    tokio::select! {
        result=tokio::time::timeout(duration,process.output())=>result.map_err(|_|AppError::internal(format!("{command} timed out")))?.map_err(AppError::io),
        _=cancellation.cancelled()=>Err(AppError::internal("Thumbnail request aborted")),
    }
}

fn is_audio(file: &Path) -> bool {
    file.extension().is_some_and(|ext| {
        media::media_type(&ext.to_string_lossy().to_ascii_lowercase()) == "audio"
    })
}

fn versioned_id(file: &Path, id: &str) -> String {
    if is_audio(file) {
        format!("{id}-audio-v2")
    } else {
        id.to_owned()
    }
}

fn waveform_image(samples: &[f32]) -> image::RgbImage {
    const BARS: usize = 112;
    let levels: Vec<f32> = (0..BARS)
        .map(|i| {
            let start = samples.len() * i / BARS;
            let end = samples.len() * (i + 1) / BARS;
            let slice = &samples[start..end];
            (slice
                .iter()
                .map(|v| if v.is_finite() { v * v } else { 0.0 })
                .sum::<f32>()
                / slice.len().max(1) as f32)
                .sqrt()
        })
        .collect();
    let peak = levels
        .iter()
        .copied()
        .fold(0.0_f32, f32::max)
        .max(f32::EPSILON);
    let mut canvas = image::RgbImage::from_fn(640, 360, |_, y| {
        let shade = 30 - (y * 5 / 360) as u8;
        image::Rgb([shade, shade + 2, shade + 7])
    });
    for (i, level) in levels.iter().enumerate() {
        let half = ((level / peak).powf(0.65) * 108.0).round().max(2.0) as i32;
        let mix = i as f32 / (BARS - 1) as f32;
        let color = image::Rgb([
            (128.0 + 48.0 * mix) as u8,
            (155.0 + 27.0 * mix) as u8,
            (193.0 + 24.0 * mix) as u8,
        ]);
        for dx in 0..3_u32 {
            for dy in -half..=half {
                if dx != 1 && dy.abs() == half {
                    continue;
                }
                canvas.put_pixel(41 + i as u32 * 5 + dx, (180 + dy) as u32, color);
            }
        }
    }
    canvas
}

async fn generate_audio(
    file: &Path,
    output: &Path,
    cancellation: &CancellationToken,
) -> AppResult<()> {
    // Prefer embedded album art; otherwise render a waveform from the first minute.
    let common = vec![
        "-v".into(),
        "error".into(),
        "-i".into(),
        file.to_string_lossy().into_owned(),
    ];
    let mut cover = common.clone();
    cover.extend(
        [
            "-an",
            "-map",
            "0:v:0",
            "-vf",
            "scale=640:-1",
            "-frames:v",
            "1",
            "-y",
        ]
        .map(String::from),
    );
    cover.push(output.to_string_lossy().into_owned());
    if command_output("ffmpeg", &cover, Duration::from_secs(10), cancellation)
        .await
        .is_ok_and(|r| r.status.success())
    {
        return Ok(());
    }
    let wave = vec![
        "-v".into(),
        "error".into(),
        "-t".into(),
        "60".into(),
        "-i".into(),
        file.to_string_lossy().into_owned(),
        "-vn".into(),
        "-ac".into(),
        "1".into(),
        "-ar".into(),
        "8000".into(),
        "-f".into(),
        "f32le".into(),
        "pipe:1".into(),
    ];
    let result = command_output("ffmpeg", &wave, Duration::from_secs(15), cancellation).await?;
    if !result.status.success() {
        return Err(AppError::internal("Could not prepare audio preview"));
    }
    let samples: Vec<f32> = result
        .stdout
        .chunks_exact(4)
        .map(|v| f32::from_le_bytes(v.try_into().unwrap()))
        .collect();
    if samples.is_empty() {
        return Err(AppError::internal("Audio preview contains no samples"));
    }
    let canvas = waveform_image(&samples);
    let writer = std::fs::File::create(output).map_err(AppError::io)?;
    JpegEncoder::new_with_quality(writer, 90)
        .write_image(
            &canvas,
            canvas.width(),
            canvas.height(),
            image::ExtendedColorType::Rgb8,
        )
        .map_err(|error| AppError::internal(error.to_string()))?;
    Ok(())
}

async fn generate_video(
    file: &Path,
    output: &Path,
    cancellation: &CancellationToken,
) -> AppResult<()> {
    static FFMPEG_AVAILABLE: AtomicI8 = AtomicI8::new(0);
    let available = match FFMPEG_AVAILABLE.load(Ordering::Relaxed) {
        1 => true,
        -1 => false,
        _ => match command_output(
            "ffmpeg",
            &["-version".into()],
            Duration::from_secs(5),
            cancellation,
        )
        .await
        {
            Ok(output) => {
                let available = output.status.success();
                FFMPEG_AVAILABLE.store(if available { 1 } else { -1 }, Ordering::Relaxed);
                available
            }
            Err(error) if cancellation.is_cancelled() => return Err(error),
            Err(_) => {
                FFMPEG_AVAILABLE.store(-1, Ordering::Relaxed);
                false
            }
        },
    };
    if !available {
        return Err(AppError::internal("ffmpeg not available"));
    }
    let probe_args = vec![
        "-v".into(),
        "error".into(),
        "-show_entries".into(),
        "format=duration".into(),
        "-of".into(),
        "default=noprint_wrappers=1:nokey=1".into(),
        file.to_string_lossy().into_owned(),
    ];
    let duration = command_output("ffprobe", &probe_args, Duration::from_secs(5), cancellation)
        .await
        .ok()
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .and_then(|value| value.trim().parse::<f64>().ok())
        .unwrap_or(0.0);
    let seek = if duration > 0.0 {
        (duration * 0.05).min(3.0)
    } else {
        3.0
    };
    let args = vec![
        "-ss".into(),
        seek.to_string(),
        "-i".into(),
        file.to_string_lossy().into_owned(),
        "-vf".into(),
        "thumbnail=n=100,scale='min(300,iw)':-1".into(),
        "-frames:v".into(),
        "1".into(),
        output.to_string_lossy().into_owned(),
        "-y".into(),
    ];
    let result = command_output("ffmpeg", &args, Duration::from_secs(15), cancellation).await?;
    if !result.status.success() {
        return Err(AppError::internal(format!(
            "ffmpeg exited with {}: {}",
            result.status,
            String::from_utf8_lossy(&result.stderr).trim()
        )));
    }
    Ok(())
}

pub const PLACEHOLDER: &[u8] = &[
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0,
    0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 218, 99, 100, 248, 207, 80, 15, 0, 3,
    134, 1, 128, 90, 52, 125, 107, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
];

#[cfg(test)]
static TEST_GENERATIONS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static TEST_DELAY_MS: AtomicU64 = AtomicU64::new(0);
#[cfg(test)]
static TEST_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;

    use crate::image_variants::Priority;
    use crate::queue_test_support::{Gate, until};

    struct QueueFixture {
        base: PathBuf,
        sender: mpsc::UnboundedSender<CommandMessage>,
        task: tokio::task::JoinHandle<()>,
    }

    impl QueueFixture {
        fn new() -> Self {
            let base = std::env::temp_dir()
                .join(format!("derp-thumbnails-queue-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&base).unwrap();
            image::RgbImage::from_pixel(32, 32, image::Rgb([10, 20, 30]))
                .save(base.join("source.png"))
                .unwrap();
            let (sender, receiver) = mpsc::unbounded_channel();
            let task = tokio::spawn(run_queue(receiver, 1));
            let fixture = Self { base, sender, task };
            std::fs::write(fixture.cache("barrier"), []).unwrap();
            fixture
        }

        fn cache(&self, name: &str) -> PathBuf {
            self.base.join(format!("{name}.jpg"))
        }
        fn gate(&self, name: &str) -> Gate {
            Gate::new(self.cache(name))
        }

        fn request(
            &self,
            id: u64,
            name: &str,
            priority: Priority,
        ) -> oneshot::Receiver<Result<(), String>> {
            let (waiter, receiver) = oneshot::channel();
            let background = (priority == Priority::Prefetch).then(|| {
                Arc::new(tokio::sync::Semaphore::new(1))
                    .try_acquire_owned()
                    .unwrap()
            });
            self.sender
                .send(CommandMessage::Request {
                    id,
                    file: self.base.join("source.png"),
                    cache: self.cache(name),

                    waiter,
                    background,
                })
                .unwrap();
            receiver
        }

        fn cancel(&self, id: u64, name: &str) {
            self.sender
                .send(CommandMessage::Cancel {
                    id,
                    cache: self.cache(name),
                })
                .unwrap();
        }

        async fn sync(&self) {
            until(self.request(u64::MAX, "barrier", Priority::Active))
                .await
                .unwrap()
                .unwrap();
        }
    }

    impl Drop for QueueFixture {
        fn drop(&mut self) {
            self.task.abort();
            let _ = std::fs::remove_dir_all(&self.base);
        }
    }

    #[tokio::test]
    async fn cancelling_one_running_subscriber_does_not_fail_the_other() {
        let _lock = TEST_LOCK.lock().await;
        let q = QueueFixture::new();
        let gate = q.gate("shared");
        let first = q.request(1, "shared", Priority::Prefetch);
        gate.started().await;
        let second = q.request(2, "shared", Priority::Active);
        q.cancel(1, "shared");
        q.sync().await;
        assert!(until(first).await.is_err());
        gate.release();
        until(second).await.unwrap().unwrap();
        q.sync().await;
        assert_eq!(gate.starts(), 1);
        assert!(q.cache("shared").exists());
    }

    #[tokio::test]
    async fn abandoned_running_job_retains_its_background_permit_until_completion() {
        let _lock = TEST_LOCK.lock().await;
        let q = QueueFixture::new();
        let gate = q.gate("shared");
        let capacity = Arc::new(tokio::sync::Semaphore::new(1));
        let (waiter, receiver) = oneshot::channel();
        q.sender
            .send(CommandMessage::Request {
                id: 1,
                file: q.base.join("source.png"),
                cache: q.cache("shared"),

                waiter,
                background: Some(capacity.clone().try_acquire_owned().unwrap()),
            })
            .unwrap();
        gate.started().await;
        q.cancel(1, "shared");
        q.sync().await;
        assert!(until(receiver).await.is_err());
        assert_eq!(capacity.available_permits(), 0);
        let rejoined = q.request(2, "shared", Priority::Active);
        q.sync().await;
        gate.release();
        until(rejoined).await.unwrap().unwrap();
        q.sync().await;
        assert_eq!(capacity.available_permits(), 1);
        assert_eq!(gate.starts(), 1);
    }

    #[tokio::test]
    async fn cancelling_one_pending_subscriber_keeps_the_shared_job() {
        let _lock = TEST_LOCK.lock().await;
        let q = QueueFixture::new();

        let blocker = q.gate("blocker");
        let shared = q.gate("shared");
        let first = q.request(1, "blocker", Priority::Active);
        blocker.started().await;
        let cancelled = q.request(2, "shared", Priority::Prefetch);
        let remaining = q.request(3, "shared", Priority::Active);
        q.cancel(2, "shared");
        q.sync().await;
        assert!(until(cancelled).await.is_err());
        assert_eq!(shared.starts(), 0);
        blocker.release();
        until(first).await.unwrap().unwrap();
        shared.started().await;
        shared.release();
        until(remaining).await.unwrap().unwrap();
        q.sync().await;
        assert_eq!(shared.starts(), 1);
        assert!(q.cache("shared").exists());
    }

    #[tokio::test]
    async fn cancelling_running_subscribers_keeps_result_and_worker_slot() {
        let _lock = TEST_LOCK.lock().await;
        let q = QueueFixture::new();

        let shared = q.gate("shared");
        let first = q.request(1, "shared", Priority::Prefetch);
        shared.started().await;
        let second = q.request(2, "shared", Priority::Active);
        q.cancel(1, "shared");
        q.sync().await;
        assert!(until(first).await.is_err());
        q.cancel(2, "shared");
        q.sync().await;
        assert!(until(second).await.is_err());
        let following = q.gate("following");
        let next = q.request(3, "following", Priority::Active);
        q.sync().await;
        assert_eq!(following.starts(), 0);
        let rejoined = q.request(4, "shared", Priority::Active);
        q.sync().await;
        shared.release();
        until(rejoined).await.unwrap().unwrap();
        following.started().await;
        assert!(q.cache("shared").exists());
        assert_eq!(shared.starts(), 1);
        following.release();
        until(next).await.unwrap().unwrap();
        q.sync().await;
    }

    #[tokio::test]
    async fn cancelling_all_pending_subscribers_removes_the_job() {
        let _lock = TEST_LOCK.lock().await;
        let q = QueueFixture::new();

        let blocker = q.gate("blocker");
        let obsolete = q.gate("obsolete");
        let following = q.gate("following");
        let first = q.request(1, "blocker", Priority::Active);
        blocker.started().await;
        let a = q.request(2, "obsolete", Priority::Prefetch);
        let b = q.request(3, "obsolete", Priority::Active);
        q.cancel(2, "obsolete");
        q.cancel(3, "obsolete");
        let next = q.request(4, "following", Priority::Prefetch);
        q.sync().await;
        assert!(until(a).await.is_err());
        assert!(until(b).await.is_err());
        blocker.release();
        until(first).await.unwrap().unwrap();
        following.started().await;
        assert_eq!(obsolete.starts(), 0);
        assert!(!q.cache("obsolete").exists());
        following.release();
        until(next).await.unwrap().unwrap();
        q.sync().await;
    }

    #[tokio::test]
    async fn generation_failure_notifies_subscribers_releases_slot_and_allows_retry() {
        let _lock = TEST_LOCK.lock().await;
        let q = QueueFixture::new();

        let broken = q.gate("broken");
        let following = q.gate("following");
        let first = q.request(1, "broken", Priority::Active);
        broken.started().await;
        let duplicate = q.request(2, "broken", Priority::Active);
        let next = q.request(3, "following", Priority::Active);
        q.sync().await;
        std::fs::write(q.base.join("source.png"), b"corrupt image").unwrap();
        broken.release();
        let error = until(first).await.unwrap().unwrap_err();
        assert_eq!(until(duplicate).await.unwrap().unwrap_err(), error);
        following.started().await;
        assert!(!q.cache("broken").exists());
        image::RgbImage::from_pixel(32, 32, image::Rgb([10, 20, 30]))
            .save(q.base.join("source.png"))
            .unwrap();
        following.release();
        until(next).await.unwrap().unwrap();
        broken.release();
        until(q.request(4, "broken", Priority::Active))
            .await
            .unwrap()
            .unwrap();
        q.sync().await;
        assert_eq!(broken.starts(), 2);
        assert!(q.cache("broken").exists());
        assert!(std::fs::read_dir(&q.base).unwrap().all(|entry| {
            !entry
                .unwrap()
                .file_name()
                .to_string_lossy()
                .contains(".tmp.")
        }));
    }

    #[tokio::test]
    async fn visible_jobs_overtake_background_and_promote_existing_jobs() {
        let _lock = TEST_LOCK.lock().await;
        let q = QueueFixture::new();

        let blocker = q.gate("blocker");
        let background = q.gate("background");
        let promoted = q.gate("promoted");
        let next_gate = q.gate("next");
        let first = q.request(1, "blocker", Priority::Active);
        blocker.started().await;
        let bg = q.request(2, "background", Priority::Prefetch);
        let original = q.request(3, "promoted", Priority::Prefetch);
        let next = q.request(4, "next", Priority::Next);
        let visible = q.request(5, "promoted", Priority::Active);
        q.sync().await;
        blocker.release();
        until(first).await.unwrap().unwrap();
        promoted.started().await;
        assert_eq!(background.starts(), 0);
        assert_eq!(next_gate.starts(), 0);
        promoted.release();
        until(original).await.unwrap().unwrap();
        until(visible).await.unwrap().unwrap();
        next_gate.started().await;
        assert_eq!(background.starts(), 0);
        next_gate.release();
        until(next).await.unwrap().unwrap();
        background.started().await;
        background.release();
        until(bg).await.unwrap().unwrap();
        q.sync().await;
        assert_eq!(promoted.starts(), 1);
    }

    #[test]
    fn waveform_preserves_dynamics_and_normalizes_quiet_audio() {
        let quiet: Vec<f32> = (0..1120)
            .map(|i| if i < 560 { 0.0001 } else { 0.001 })
            .collect();
        let loud: Vec<f32> = quiet.iter().map(|v| v * 100.0).collect();
        let a = waveform_image(&quiet);
        let b = waveform_image(&loud);
        assert_eq!(a, b);
        assert_ne!(a.get_pixel(42, 180), a.get_pixel(40, 180));
        assert_eq!(a.get_pixel(42, 90), a.get_pixel(40, 90));
        assert_ne!(a.get_pixel(42 + 70 * 5, 90), a.get_pixel(40, 90));
        let silence = waveform_image(&vec![0.0; 1120]);
        assert_eq!(silence.get_pixel(42, 90), silence.get_pixel(40, 90));
        assert_ne!(versioned_id(Path::new("track.mp3"), "id"), "id");
        assert_eq!(versioned_id(Path::new("movie.mp4"), "id"), "id");
    }

    fn test_database(base: &Path) -> AppDatabase {
        let database = AppDatabase::new(base.join("app.sqlite3"));
        database
            .connection()
            .unwrap()
            .execute_batch(
                "CREATE TABLE thumbnail_cache_ids (
                   source_path TEXT PRIMARY KEY,
                   cache_id TEXT NOT NULL UNIQUE
                 );",
            )
            .unwrap();
        database
    }

    #[tokio::test]
    async fn cancelled_pending_thumbnail_is_removed_while_started_work_is_kept() {
        let _lock = TEST_LOCK.lock().await;
        let base =
            std::env::temp_dir().join(format!("derp-thumbs-cancel-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&base).unwrap();
        let source = base.join("source.png");
        image::RgbImage::from_pixel(32, 32, image::Rgb([10, 20, 30]))
            .save(&source)
            .unwrap();
        let thumbnails = Arc::new(Thumbnailer::with_concurrency(
            base.join("cache"),
            test_database(&base),
            1,
        ));
        let modified = std::time::SystemTime::now();
        TEST_GENERATIONS.store(0, Ordering::SeqCst);
        TEST_DELAY_MS.store(150, Ordering::SeqCst);
        let first = {
            let thumbnails = thumbnails.clone();
            let source = source.clone();
            tokio::spawn(async move { thumbnails.read(&source, modified).await })
        };
        tokio::time::timeout(Duration::from_secs(2), async {
            while TEST_GENERATIONS.load(Ordering::SeqCst) == 0 {
                tokio::task::yield_now().await;
            }
        })
        .await
        .unwrap();
        let pending = {
            let thumbnails = thumbnails.clone();
            let source = source.clone();
            tokio::spawn(async move {
                thumbnails
                    .read(&source, modified + Duration::from_secs(1))
                    .await
            })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        pending.abort();
        let _ = pending.await;
        first.abort();
        let _ = first.await;
        tokio::time::timeout(Duration::from_secs(2), async {
            while !thumbnails.cached(&source, modified) {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .unwrap();
        assert_eq!(TEST_GENERATIONS.load(Ordering::SeqCst), 1);
        assert!(!thumbnails.cached(&source, modified + Duration::from_secs(1)));
        TEST_DELAY_MS.store(0, Ordering::SeqCst);
        std::fs::remove_dir_all(base).unwrap();
    }

    #[tokio::test]
    async fn queue_deduplicates_and_drops_cancelled_pending_requests() {
        let _lock = TEST_LOCK.lock().await;
        let base = std::env::temp_dir().join(format!("derp-rust-thumbs-{}", uuid::Uuid::new_v4()));
        let cache = base.join("cache");
        std::fs::create_dir_all(&base).unwrap();
        let first_path = base.join("first.png");
        let second_path = base.join("second.png");
        let svg_path = base.join("vector.svg");
        image::RgbImage::from_pixel(32, 32, image::Rgb([10, 20, 30]))
            .save(&first_path)
            .unwrap();
        image::RgbImage::from_pixel(32, 32, image::Rgb([30, 20, 10]))
            .save(&second_path)
            .unwrap();
        std::fs::write(
            &svg_path,
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="640" height="320"><rect width="640" height="320" fill="red"/></svg>"#,
        )
        .unwrap();
        let modified = std::time::SystemTime::now();
        let thumbnails = Arc::new(Thumbnailer::with_concurrency(
            cache,
            test_database(&base),
            2,
        ));

        TEST_GENERATIONS.store(0, Ordering::SeqCst);
        TEST_DELAY_MS.store(80, Ordering::SeqCst);
        let one = {
            let thumbnails = thumbnails.clone();
            let path = first_path.clone();
            tokio::spawn(async move { thumbnails.read(&path, modified).await })
        };
        let duplicate = {
            let thumbnails = thumbnails.clone();
            let path = first_path.clone();
            tokio::spawn(async move { thumbnails.read(&path, modified).await })
        };
        assert_eq!(
            one.await.unwrap().unwrap(),
            duplicate.await.unwrap().unwrap()
        );
        assert_eq!(TEST_GENERATIONS.load(Ordering::SeqCst), 1);

        TEST_GENERATIONS.store(0, Ordering::SeqCst);
        let cached = thumbnails.read(&first_path, modified).await.unwrap();
        assert_eq!(
            cached,
            std::fs::read(thumbnails.cache_path(&first_path, modified).unwrap()).unwrap()
        );
        assert_eq!(TEST_GENERATIONS.load(Ordering::SeqCst), 0);

        std::fs::write(
            thumbnails.cache_path(&first_path, modified).unwrap(),
            b"corrupt",
        )
        .unwrap();
        TEST_GENERATIONS.store(0, Ordering::SeqCst);
        let repaired = thumbnails.read(&first_path, modified).await.unwrap();
        assert!(repaired.starts_with(&[0xff, 0xd8, 0xff]));
        assert_eq!(TEST_GENERATIONS.load(Ordering::SeqCst), 1);

        TEST_GENERATIONS.store(0, Ordering::SeqCst);
        TEST_DELAY_MS.store(120, Ordering::SeqCst);
        let active = {
            let thumbnails = thumbnails.clone();
            let path = first_path.clone();
            tokio::spawn(async move {
                thumbnails
                    .read(&path, modified + Duration::from_secs(1))
                    .await
            })
        };
        tokio::time::sleep(Duration::from_millis(10)).await;
        let cancelled = {
            let thumbnails = thumbnails.clone();
            let path = second_path.clone();
            tokio::spawn(async move { thumbnails.read(&path, modified).await })
        };
        tokio::time::sleep(Duration::from_millis(10)).await;
        cancelled.abort();
        active.await.unwrap().unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
        assert!(thumbnails.cached(&second_path, modified));
        assert_eq!(TEST_GENERATIONS.load(Ordering::SeqCst), 2);

        TEST_GENERATIONS.store(0, Ordering::SeqCst);
        TEST_DELAY_MS.store(60, Ordering::SeqCst);
        let first = {
            let thumbnails = thumbnails.clone();
            let path = first_path.clone();
            tokio::spawn(async move {
                thumbnails
                    .read(&path, modified + Duration::from_secs(2))
                    .await
            })
        };
        let second = {
            let thumbnails = thumbnails.clone();
            let path = second_path.clone();
            tokio::spawn(async move {
                thumbnails
                    .read(&path, modified + Duration::from_secs(2))
                    .await
            })
        };
        tokio::time::sleep(Duration::from_millis(20)).await;
        assert_eq!(TEST_GENERATIONS.load(Ordering::SeqCst), 2);
        tokio::time::sleep(Duration::from_millis(60)).await;
        assert_eq!(TEST_GENERATIONS.load(Ordering::SeqCst), 2);
        first.await.unwrap().unwrap();
        second.await.unwrap().unwrap();
        assert_eq!(TEST_GENERATIONS.load(Ordering::SeqCst), 2);

        TEST_DELAY_MS.store(0, Ordering::SeqCst);
        let svg = thumbnails.read(&svg_path, modified).await.unwrap();
        assert!(svg.starts_with(&[0xff, 0xd8, 0xff]));

        std::fs::remove_dir_all(base).unwrap();
    }

    #[tokio::test]
    async fn long_source_paths_use_short_persistent_cache_ids() {
        let _lock = TEST_LOCK.lock().await;
        let base =
            std::env::temp_dir().join(format!("derp-rust-thumbs-long-{}", uuid::Uuid::new_v4()));
        let source_dir = base.join("a".repeat(120)).join("b".repeat(80));
        std::fs::create_dir_all(&source_dir).unwrap();
        let source = source_dir.join("thumbnail-source.png");
        image::RgbImage::from_pixel(32, 32, image::Rgb([10, 20, 30]))
            .save(&source)
            .unwrap();
        let database = test_database(&base);
        let thumbnails = Thumbnailer::with_concurrency(base.join("cache"), database.clone(), 1);
        let modified = std::time::SystemTime::now();

        let generated = thumbnails.read(&source, modified).await.unwrap();
        assert!(generated.starts_with(&[0xff, 0xd8, 0xff]));
        let cache = thumbnails.cache_path(&source, modified).unwrap();
        assert!(cache.exists());
        assert!(cache.file_name().unwrap().len() < 100);
        assert!(
            thumbnails
                .legacy_cache_path(&source, modified)
                .file_name()
                .unwrap()
                .len()
                > 255
        );

        let stored_id: String = database
            .connection()
            .unwrap()
            .query_row(
                "SELECT cache_id FROM thumbnail_cache_ids WHERE source_path=?1",
                [source.to_string_lossy().as_ref()],
                |row| row.get(0),
            )
            .unwrap();
        assert!(
            cache
                .file_name()
                .unwrap()
                .to_string_lossy()
                .starts_with(&stored_id)
        );

        std::fs::remove_dir_all(base).unwrap();
    }
}
