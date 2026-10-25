use crate::error::{AppError, AppResult};
use serde::Serialize;
use std::{
    collections::{BTreeMap, HashSet},
    fs::{File, OpenOptions},
    io::{Read, Seek, SeekFrom},
    path::Path,
};

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Format {
    Zip,
    Tar,
    Gzip,
    Xz,
}
impl Format {
    pub fn for_path(path: &Path) -> AppResult<Self> {
        let name = path.to_string_lossy().to_lowercase();
        if name.ends_with(".zip") {
            Ok(Self::Zip)
        } else if name.ends_with(".tar.gz") || name.ends_with(".tgz") {
            Ok(Self::Gzip)
        } else if name.ends_with(".tar.xz") || name.ends_with(".txz") {
            Ok(Self::Xz)
        } else if name.ends_with(".tar") {
            Ok(Self::Tar)
        } else {
            Err(AppError::bad(
                "Supported archives: ZIP, TAR, TAR.GZ and TAR.XZ",
            ))
        }
    }
}
#[derive(Clone, Debug, Serialize)]
pub struct Entry {
    pub path: String,
    pub size: u64,
    pub directory: bool,
    #[serde(skip)]
    pub mode: Option<u32>,
}
fn archive_error(error: impl std::fmt::Display) -> AppError {
    AppError::bad(format!("Archive: {error}"))
}
fn safe_name(name: &str, directory: bool) -> AppResult<Option<String>> {
    let normalized = name.replace('\\', "/");
    if normalized.starts_with('/') || normalized.contains('\0') {
        return Err(AppError::bad("Archive contains an unsafe path"));
    }
    let mut parts = Vec::new();
    for part in normalized.split('/') {
        if part == ".." || part.contains(':') || part == ".derp" || part.starts_with(".derp-") {
            return Err(AppError::bad("Archive contains an unsafe path"));
        }
        if !part.is_empty() && part != "." {
            parts.push(part);
        }
    }
    if parts.is_empty() {
        return if directory {
            Ok(None)
        } else {
            Err(AppError::bad("Archive contains an empty filename"))
        };
    }
    Ok(Some(parts.join("/")))
}
struct CheckedReader<R, F> {
    reader: R,
    check: F,
}
impl<R: Read, F: Fn() -> AppResult<()>> Read for CheckedReader<R, F> {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        (self.check)().map_err(|error| std::io::Error::other(error.1))?;
        self.reader.read(buffer)
    }
}
impl<R: Seek, F> Seek for CheckedReader<R, F> {
    fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
        self.reader.seek(position)
    }
}
fn visit(
    path: &Path,
    check: &impl Fn() -> AppResult<()>,
    mut visitor: impl FnMut(Entry, &mut dyn Read) -> AppResult<()>,
) -> AppResult<()> {
    let format = Format::for_path(path)?;
    let file = CheckedReader {
        reader: File::open(path).map_err(AppError::io)?,
        check,
    };
    if format == Format::Zip {
        let mut archive = zip::ZipArchive::new(file).map_err(archive_error)?;
        if archive.len() > 100_000 {
            return Err(AppError::bad("Archive has too many entries"));
        }
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(archive_error)?;
            let mode = entry.unix_mode();
            if mode.is_some_and(|mode| {
                let kind = mode & 0o170000;
                kind != 0 && kind != 0o100000 && kind != 0o040000
            }) {
                return Err(AppError::bad("Archive contains a link or special file"));
            }
            let directory = entry.is_dir();
            let Some(path) = safe_name(&entry.name().map_err(archive_error)?, directory)? else {
                continue;
            };
            let info = Entry {
                path,
                directory,
                size: entry.size(),
                mode,
            };
            visitor(info, &mut entry)?;
        }
    } else {
        let reader: Box<dyn Read + '_> = match format {
            Format::Gzip => Box::new(flate2::read::MultiGzDecoder::new(file)),
            Format::Xz => Box::new(xz2::read::XzDecoder::new_multi_decoder(file)),
            _ => Box::new(file),
        };
        let mut archive = tar::Archive::new(CheckedReader { reader, check });
        for (index, entry) in archive.entries().map_err(archive_error)?.enumerate() {
            if index >= 100_000 {
                return Err(AppError::bad("Archive has too many entries"));
            }
            let mut entry = entry.map_err(archive_error)?;
            let kind = entry.header().entry_type();
            if !kind.is_file() && !kind.is_dir() {
                return Err(AppError::bad("Archive contains a link or special file"));
            }
            let raw = entry.path_bytes();
            let name = std::str::from_utf8(&raw)
                .map_err(|_| AppError::bad("Archive contains a filename that is not UTF-8"))?;
            let Some(path) = safe_name(name, kind.is_dir())? else {
                continue;
            };
            let info = Entry {
                path,
                directory: kind.is_dir(),
                size: entry.size(),
                mode: Some(entry.header().mode().map_err(archive_error)?),
            };
            visitor(info, &mut entry)?;
        }
    }
    Ok(())
}
pub fn inspect(path: &Path) -> AppResult<Vec<Entry>> {
    inspect_checked(path, || Ok(()))
}
pub fn inspect_checked(path: &Path, check: impl Fn() -> AppResult<()>) -> AppResult<Vec<Entry>> {
    let mut entries: BTreeMap<String, Entry> = BTreeMap::new();
    visit(path, &check, |entry, _| {
        if let Some(previous) = entries.get(&entry.path) {
            if !previous.directory || !entry.directory {
                return Err(AppError::bad("Archive contains duplicate file paths"));
            }
        } else {
            entries.insert(entry.path.clone(), entry);
        }
        Ok(())
    })?;
    Ok(entries.into_values().collect())
}
pub const PREVIEW_MAX_BYTES: u64 = 32 * 1024 * 1024;
pub fn read_entry(
    path: &Path,
    target: &str,
    limit: u64,
    check: impl Fn() -> AppResult<()>,
) -> AppResult<Vec<u8>> {
    let target =
        safe_name(target, false)?.ok_or_else(|| AppError::bad("Choose a file to preview"))?;
    let compressed_tar = Format::for_path(path)? != Format::Zip;
    let mut scanned = 0_u64;
    let mut seen = BTreeMap::new();
    let mut result = None;
    visit(path, &check, |entry, input| {
        check()?;
        if let Some(previous_directory) = seen.insert(entry.path.clone(), entry.directory) {
            if !previous_directory || !entry.directory {
                return Err(AppError::bad("Archive contains duplicate file paths"));
            }
        }
        scanned = scanned.saturating_add(entry.size);
        if compressed_tar && scanned > 512 * 1024 * 1024 {
            return Err(AppError::bad(
                "This archive is too large to scan for a preview. Extract the file instead.",
            ));
        }
        if entry.path == target {
            if entry.directory {
                return Err(AppError::bad("Choose a file, not a folder"));
            }
            if entry.size > limit {
                return Err(AppError::bad(
                    "This file is too large to preview. Extract it instead (preview limit: 32 MiB).",
                ));
            }
            let mut bytes = Vec::with_capacity(entry.size as usize);
            input
                .take(limit.saturating_add(1))
                .read_to_end(&mut bytes)
                .map_err(archive_error)?;
            if bytes.len() as u64 > limit || bytes.len() as u64 != entry.size {
                return Err(AppError::bad("Archive entry has an invalid size"));
            }
            result = Some(bytes);
        }
        Ok(())
    })?;
    result.ok_or_else(|| AppError::not_found("File not found in archive"))
}

pub fn extract(
    path: &Path,
    output: &Path,
    selected: &[String],
    mut copy: impl FnMut(&mut dyn Read, &mut File) -> AppResult<()>,
    check: impl Fn() -> AppResult<()>,
    current: impl Fn(&str),
) -> AppResult<()> {
    let names: HashSet<_> = selected.iter().map(String::as_str).collect();
    std::fs::create_dir(output).map_err(AppError::io)?;
    visit(path, &check, |entry, reader| {
        check()?;
        if !names.contains(entry.path.as_str()) {
            return Ok(());
        }
        current(&entry.path);
        let destination = output.join(&entry.path);
        if entry.directory {
            std::fs::create_dir_all(destination).map_err(AppError::io)?;
        } else {
            std::fs::create_dir_all(destination.parent().unwrap()).map_err(AppError::io)?;
            let mut file = OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&destination)
                .map_err(AppError::io)?;
            copy(reader, &mut file)?;
            #[cfg(unix)]
            if let Some(mode) = entry.mode {
                use std::os::unix::fs::PermissionsExt;
                file.set_permissions(std::fs::Permissions::from_mode(mode & 0o777))
                    .map_err(AppError::io)?;
            }
        }
        Ok(())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn archive_names_accept_relative_tar_roots_and_reject_escaping_paths() {
        assert_eq!(
            safe_name("./folder/file.txt", false).unwrap(),
            Some("folder/file.txt".into())
        );
        assert_eq!(safe_name("./", true).unwrap(), None);
        for name in [
            "/etc/passwd",
            "../outside",
            "a/../outside",
            "a\\..\\outside",
            "C:/outside",
            ".derp-private/file",
            "a/.derp/file",
            "bad\0name",
        ] {
            assert!(safe_name(name, false).is_err(), "{name}");
        }
    }
    fn fixture_dir() -> std::path::PathBuf {
        let path = std::env::temp_dir().join(format!("derp-archive-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir(&path).unwrap();
        path
    }
    fn tar_bytes() -> Vec<u8> {
        let mut archive = tar::Builder::new(Vec::new());
        for (name, content, mode) in [
            ("folder/one.txt", "one", 0o755),
            ("folder/two.txt", "two", 0o644),
        ] {
            let mut header = tar::Header::new_gnu();
            header.set_size(content.len() as u64);
            header.set_mode(mode);
            header.set_cksum();
            archive
                .append_data(&mut header, name, content.as_bytes())
                .unwrap();
        }
        archive.into_inner().unwrap()
    }
    #[test]
    fn tar_gzip_and_xz_support_selective_extraction_and_file_modes() {
        use std::io::Write;
        let root = fixture_dir();
        let bytes = tar_bytes();
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gzip.write_all(&bytes).unwrap();
        let mut xz = xz2::write::XzEncoder::new(Vec::new(), 1);
        xz.write_all(&bytes).unwrap();
        for (extension, data) in [
            ("tar", bytes),
            ("tar.gz", gzip.finish().unwrap()),
            ("tar.xz", xz.finish().unwrap()),
        ] {
            let path = root.join(format!("archive.{extension}"));
            std::fs::write(&path, data).unwrap();
            let entries = inspect(&path).unwrap();
            assert_eq!(entries.len(), 2);
            assert_eq!(entries[0].path, "folder/one.txt");
            let destination = root.join(format!("out-{extension}"));
            extract(
                &path,
                &destination,
                &["folder/one.txt".into()],
                |input, output| {
                    std::io::copy(input, output).map_err(AppError::io)?;
                    Ok(())
                },
                || Ok(()),
                |_| {},
            )
            .unwrap();
            assert_eq!(
                std::fs::read_to_string(destination.join("folder/one.txt")).unwrap(),
                "one"
            );
            assert!(!destination.join("folder/two.txt").exists());
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                assert_eq!(
                    std::fs::metadata(destination.join("folder/one.txt"))
                        .unwrap()
                        .permissions()
                        .mode()
                        & 0o777,
                    0o755
                );
            }
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn tar_rejects_symlinks_and_parent_traversal_before_extraction() {
        let root = fixture_dir();
        for link in [false, true] {
            let path = root.join(if link { "link.tar" } else { "escape.tar" });
            let mut archive = tar::Builder::new(File::create(&path).unwrap());
            let mut header = tar::Header::new_gnu();
            header.set_size(0);
            header.set_mode(0o644);
            if link {
                header.set_path("link").unwrap();
                header.set_entry_type(tar::EntryType::Symlink);
                header.set_link_name("../outside").unwrap();
            } else {
                header.as_mut_bytes()[..10].copy_from_slice(b"../outside");
            }
            header.set_cksum();
            archive.append(&header, std::io::empty()).unwrap();
            archive.finish().unwrap();
            assert!(inspect(&path).is_err());
        }
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn compressed_archive_inspection_honors_cancellation() {
        let root = fixture_dir();
        let path = root.join("archive.tar");
        std::fs::write(&path, tar_bytes()).unwrap();
        assert!(inspect_checked(&path, || Err(AppError::bad("Cancelled"))).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn previews_read_exact_entries_without_creating_files_and_enforce_limits() {
        use std::io::Write;
        let root = fixture_dir();
        let mut gzip = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gzip.write_all(&tar_bytes()).unwrap();
        let mut xz = xz2::write::XzEncoder::new(Vec::new(), 1);
        xz.write_all(&tar_bytes()).unwrap();
        for (extension, bytes) in [
            ("tar", tar_bytes()),
            ("tgz", gzip.finish().unwrap()),
            ("txz", xz.finish().unwrap()),
        ] {
            let path = root.join(format!("test.{extension}"));
            std::fs::write(&path, bytes).unwrap();
            assert_eq!(
                read_entry(&path, "folder/two.txt", 32, || Ok(())).unwrap(),
                b"two"
            );
            assert!(read_entry(&path, "folder/two.txt", 2, || Ok(())).is_err());
            assert!(read_entry(&path, "missing.txt", 32, || Ok(())).is_err());
            assert!(read_entry(&path, "../folder/one.txt", 32, || Ok(())).is_err());
            assert!(
                read_entry(&path, "folder/one.txt", 32, || Err(AppError::bad(
                    "Cancelled"
                )))
                .is_err()
            );
        }
        let path = root.join("test.zip");
        let mut archive = zip::ZipWriter::new(File::create(&path).unwrap());
        archive
            .start_file("Книга/README.txt", zip::write::SimpleFileOptions::default())
            .unwrap();
        archive.write_all(b"exact\r\ntext\n").unwrap();
        archive.finish().unwrap();
        assert_eq!(
            read_entry(&path, "Книга/README.txt", 32, || Ok(())).unwrap(),
            b"exact\r\ntext\n"
        );
        assert!(!root.join("folder").exists());
        assert!(!root.join("Книга").exists());
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn preview_rejects_unsafe_entries_even_after_the_requested_file() {
        use std::io::Write;
        let root = fixture_dir();
        let path = root.join("unsafe.zip");
        let mut archive = zip::ZipWriter::new(File::create(&path).unwrap());
        for name in ["good.txt", "../outside.txt"] {
            archive
                .start_file(name, zip::write::SimpleFileOptions::default())
                .unwrap();
            archive.write_all(b"content").unwrap();
        }
        archive.finish().unwrap();
        assert!(read_entry(&path, "good.txt", 32, || Ok(())).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }
}
