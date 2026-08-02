use percent_encoding::percent_decode_str;
use pulldown_cmark::{Event, Options, Parser, Tag};
use std::{collections::HashSet, path::Path};

fn normalize(value: &str) -> Option<String> {
    let mut segments = Vec::new();
    for segment in value.replace('\\', "/").split('/') {
        match segment {
            "" | "." => {}
            ".." => {
                segments.pop()?;
            }
            value => segments.push(value.to_string()),
        }
    }
    (!segments.is_empty()).then(|| segments.join("/"))
}

pub fn canonical(value: &str) -> Option<String> {
    normalize(value)
}

fn dirname(value: &str) -> &str {
    value
        .rsplit_once('/')
        .map(|(parent, _)| parent)
        .unwrap_or("")
}

fn within(path: &str, root: &str) -> bool {
    path == root || path.starts_with(&(root.to_string() + "/"))
}

fn direct_image(path: &str, directory: &str) -> bool {
    let prefix = if directory.is_empty() {
        String::new()
    } else {
        format!("{directory}/")
    };
    let Some(relative) = path.strip_prefix(&prefix) else {
        return false;
    };
    !relative.is_empty()
        && !relative.contains('/')
        && matches!(
            Path::new(relative)
                .extension()
                .and_then(|value| value.to_str())
                .map(str::to_ascii_lowercase)
                .as_deref(),
            Some(
                "png"
                    | "jpg"
                    | "jpeg"
                    | "gif"
                    | "webp"
                    | "svg"
                    | "bmp"
                    | "ico"
                    | "tif"
                    | "tiff"
                    | "avif"
            )
        )
}

fn kb_root(path: &str, knowledge_bases: &[String]) -> Option<String> {
    knowledge_bases
        .iter()
        .find(|root| within(path, &root.replace('\\', "/")))
        .map(|root| root.replace('\\', "/"))
}

pub fn resolve(
    viewing_path: &str,
    share_path: &str,
    knowledge_bases: &[String],
    raw: &str,
) -> Option<String> {
    if raw.to_ascii_lowercase().starts_with("http://")
        || raw.to_ascii_lowercase().starts_with("https://")
    {
        return None;
    }
    let mut source = percent_decode_str(raw).decode_utf8().ok()?.into_owned();
    let viewing = normalize(viewing_path)?;
    let share = normalize(share_path)?;
    let kb = kb_root(&viewing, knowledge_bases);
    if !source.starts_with('/') && !source.contains('/') && kb.is_some() {
        source = format!("{}/images/{source}", kb.as_deref().unwrap());
    }
    let file_dir = dirname(&viewing);
    let source_first = source
        .split('/')
        .find(|segment| !segment.is_empty())
        .unwrap_or("");
    let viewing_first = viewing
        .split('/')
        .find(|segment| !segment.is_empty())
        .unwrap_or("");
    let absolute = source.starts_with('/')
        || (!file_dir.is_empty() && within(&source, file_dir))
        || within(&source, &share)
        || (!source_first.is_empty() && source_first == viewing_first);
    let resolved = normalize(if absolute {
        source.trim_start_matches('/')
    } else if file_dir.is_empty() {
        &source
    } else {
        return normalize(&format!("{file_dir}/{source}")).and_then(|resolved| {
            authorize_single(&resolved, &share, kb.as_deref()).then_some(resolved)
        });
    })?;
    authorize_single(&resolved, &share, kb.as_deref()).then_some(resolved)
}

fn authorize_single(path: &str, share: &str, kb: Option<&str>) -> bool {
    if path == share {
        return false;
    }
    let directory = dirname(share);
    let sibling_images = if directory.is_empty() {
        "images".into()
    } else {
        format!("{directory}/images")
    };
    kb.is_some_and(|root| direct_image(path, &format!("{root}/images")))
        || direct_image(path, directory)
        || direct_image(path, &sibling_images)
}

pub fn targets(source: &str) -> Vec<String> {
    let mut result = HashSet::new();
    for event in Parser::new_ext(source, Options::ENABLE_GFM) {
        if let Event::Start(Tag::Image { dest_url, .. }) = event {
            let target = html_escape::decode_html_entities(&dest_url);
            if !target.is_empty() {
                result.insert(target.into_owned());
            }
        }
    }
    let bytes = source.as_bytes();
    let mut index = 0;
    while index + 2 < bytes.len() {
        if source[index..].starts_with("![[")
            && let Some(end) = source[index + 3..].find("]]")
        {
            let raw = &source[index + 3..index + 3 + end];
            let raw_target = raw.split('|').next().unwrap_or("").trim();
            let target = html_escape::decode_html_entities(raw_target);
            if !target.is_empty() {
                result.insert(target.into_owned());
            }
            index += end + 5;
            continue;
        }
        index += source[index..]
            .chars()
            .next()
            .map(char::len_utf8)
            .unwrap_or(1);
    }
    result.into_iter().collect()
}

pub fn referenced(source: &str, share_path: &str, knowledge_bases: &[String]) -> HashSet<String> {
    targets(source)
        .into_iter()
        .filter_map(|target| resolve(share_path, share_path, knowledge_bases, &target))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn references(source: &str, share: &str, knowledge_bases: &[&str]) -> Vec<String> {
        let knowledge_bases = knowledge_bases
            .iter()
            .map(|value| value.to_string())
            .collect::<Vec<_>>();
        let mut values = referenced(source, share, &knowledge_bases)
            .into_iter()
            .collect::<Vec<_>>();
        values.sort();
        values
    }

    #[test]
    fn collects_inline_reference_and_obsidian_images() {
        let source = "![inline](images/pic%20one.png)\n![reference][asset]\n![[local&amp;.webp|Preview]]\n\n[asset]: sibling.jpg";
        assert_eq!(
            references(source, "Shared/note.md", &[]),
            vec![
                "Shared/images/pic one.png",
                "Shared/local&.webp",
                "Shared/sibling.jpg"
            ]
        );
    }

    #[test]
    fn authorizes_only_direct_image_siblings() {
        let source = "![good](images/good.png)\n![text](images/private.txt)\n![nested](images/nested/private.png)\n![outside](../Private/private.png)\n![remote](https://example.com/image.png)";
        assert_eq!(
            references(source, "Shared/note.md", &[]),
            vec!["Shared/images/good.png"]
        );
    }

    #[test]
    fn knowledge_base_order_and_bare_names_match_client() {
        assert_eq!(
            references(
                "![[diagram.png]]",
                "Notes/sub/note.md",
                &["Notes", "Notes/sub"]
            ),
            vec!["Notes/images/diagram.png"]
        );
        assert_eq!(
            references(
                "![[diagram.png]]",
                "Notes/sub/note.md",
                &["Notes/sub", "Notes"]
            ),
            vec!["Notes/sub/images/diagram.png"]
        );
        assert_eq!(
            references(
                "![diagram](diagram.png) ![text](secret.txt)",
                "Notes/projects/note.md",
                &["Notes"]
            ),
            vec!["Notes/images/diagram.png"]
        );
    }

    #[test]
    fn decoding_and_root_sibling_locations_match_client() {
        assert_eq!(
            references(
                "![space](images/a%20b.png) ![percent](images/a%2520b.png)",
                "Shared/note.md",
                &[]
            ),
            vec!["Shared/images/a b.png", "Shared/images/a%20b.png"]
        );
        assert_eq!(
            references(
                "![direct](pic.png) ![folder](images/pic.png)",
                "note.md",
                &[]
            ),
            vec!["images/pic.png", "pic.png"]
        );
    }
}
