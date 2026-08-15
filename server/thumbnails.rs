use crate::{
    error::{AppError, AppResult},
    media,
};
use base64::{Engine, engine::general_purpose::STANDARD};
use image::{DynamicImage, ImageDecoder, ImageEncoder, ImageFormat, codecs::jpeg::JpegEncoder};
use std::{
    collections::{HashMap, VecDeque},
    path::{Path, PathBuf},
    sync::atomic::{AtomicI8, AtomicU64, Ordering},
    time::{Duration, UNIX_EPOCH},
};
use tokio::{
    fs,
    process::Command,
    sync::{mpsc, oneshot},
};
use tokio_util::sync::CancellationToken;

type Waiter = oneshot::Sender<Result<(), String>>;

enum CommandMessage {
    Request {
        id: u64,
        file: PathBuf,
        cache: PathBuf,
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
    waiters: HashMap<u64, Waiter>,
    cancellation: CancellationToken,
    started: bool,
}

struct Completion {
    cache: PathBuf,
    result: Result<(), String>,
}

pub struct Thumbnailer {
    cache_dir: PathBuf,
    sender: mpsc::UnboundedSender<CommandMessage>,
    next_id: AtomicU64,
}

impl Thumbnailer {
    pub fn new(cache_dir: PathBuf) -> Self {
        let concurrency = std::thread::available_parallelism()
            .map(|cores| cores.get().div_ceil(2).clamp(1, 8))
            .unwrap_or(1);
        Self::with_concurrency(cache_dir, concurrency)
    }

    fn with_concurrency(cache_dir: PathBuf, concurrency: usize) -> Self {
        let (sender, receiver) = mpsc::unbounded_channel();
        tokio::spawn(run_queue(receiver, concurrency.max(1)));
        Self {
            cache_dir,
            sender,
            next_id: AtomicU64::new(1),
        }
    }

    pub fn cached(&self, file: &Path, modified: std::time::SystemTime) -> bool {
        self.cache_path(file, modified).exists()
    }

    fn cache_path(&self, file: &Path, modified: std::time::SystemTime) -> PathBuf {
        let mtime = modified
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let source = format!("{}-{mtime}", file.display());
        let key: String = STANDARD
            .encode(source)
            .chars()
            .filter(char::is_ascii_alphanumeric)
            .collect();
        self.cache_dir.join(format!("{key}.jpg"))
    }

    pub async fn read(&self, file: &Path, modified: std::time::SystemTime) -> AppResult<Vec<u8>> {
        fs::create_dir_all(&self.cache_dir)
            .await
            .map_err(AppError::io)?;
        let cache = self.cache_path(file, modified);
        if cache.exists() {
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
        fs::read(cache).await.map_err(AppError::io)
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
                Some(CommandMessage::Request{id,file,cache,waiter}) => {
                    if cache.exists() { let _=waiter.send(Ok(())); continue; }
                    let job=jobs.entry(cache.clone()).or_insert_with(||{
                        pending.push_back(cache.clone());
                        Job{file,cache:cache.clone(),temp:cache.with_extension(format!("{}.tmp.jpg",uuid::Uuid::new_v4())),waiters:HashMap::new(),cancellation:CancellationToken::new(),started:false}
                    });
                    job.waiters.insert(id,waiter);
                }
                Some(CommandMessage::Cancel{id,cache}) => {
                    if let Some(job)=jobs.get_mut(&cache) {
                        job.waiters.remove(&id);
                        if job.waiters.is_empty() {
                            if job.started { job.cancellation.cancel(); }
                            else { pending.retain(|candidate|candidate!=&cache); jobs.remove(&cache); }
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
            while let Some(cache) = pending.pop_front() {
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
                break;
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
mod tests {
    use super::*;
    use std::sync::Arc;

    #[tokio::test]
    async fn queue_deduplicates_and_drops_cancelled_pending_requests() {
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
        let thumbnails = Arc::new(Thumbnailer::with_concurrency(cache, 2));

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
            std::fs::read(thumbnails.cache_path(&first_path, modified)).unwrap()
        );
        assert_eq!(TEST_GENERATIONS.load(Ordering::SeqCst), 0);

        std::fs::write(thumbnails.cache_path(&first_path, modified), b"corrupt").unwrap();
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
        assert!(!thumbnails.cached(&second_path, modified));
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
}
