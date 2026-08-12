use std::borrow::Cow;

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum OwnerRoute<'a> {
    Library,
    Home,
    Spaces,
    Space {
        id: Cow<'a, str>,
        presentation: Option<SpacePresentation>,
    },
    Workspace,
    Canvas,
    Assistant,
    Offline,
    Settings,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum SpacePresentation {
    Focus,
    Tiled,
    Map,
}

fn space_presentation(value: &str) -> Option<SpacePresentation> {
    match value {
        "focus" => Some(SpacePresentation::Focus),
        "tiled" => Some(SpacePresentation::Tiled),
        "map" => Some(SpacePresentation::Map),
        _ => None,
    }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) enum RouteKind<'a> {
    Login,
    Owner(OwnerRoute<'a>),
    Share { token: &'a str, workspace: bool },
    NotFound,
}

fn without_optional_trailing_slash(path: &str) -> &str {
    if path == "/" {
        path
    } else {
        path.strip_suffix('/').unwrap_or(path)
    }
}

pub(crate) fn classify_path(path: &str) -> RouteKind<'_> {
    let path = without_optional_trailing_slash(path);
    let owner = match path {
        "/" | "/library" => Some(OwnerRoute::Library),
        "/home" => Some(OwnerRoute::Home),
        "/spaces" => Some(OwnerRoute::Spaces),
        "/workspace" => Some(OwnerRoute::Workspace),
        "/canvas" => Some(OwnerRoute::Canvas),
        "/assistant" => Some(OwnerRoute::Assistant),
        "/offline" => Some(OwnerRoute::Offline),
        "/settings" => Some(OwnerRoute::Settings),
        _ => None,
    };
    if let Some(owner) = owner {
        return RouteKind::Owner(owner);
    }
    if let Some(rest) = path.strip_prefix("/spaces/id/")
        && let Some(rest) = rest.strip_prefix('~')
    {
        let (encoded_id, presentation) = match rest.split_once('/') {
            Some((id, value)) if !value.contains('/') => (id, space_presentation(value)),
            Some(_) => return RouteKind::NotFound,
            None => (rest, None),
        };
        if encoded_id.is_empty() || presentation.is_none() && rest.contains('/') {
            return RouteKind::NotFound;
        }
        return percent_encoding::percent_decode_str(encoded_id)
            .decode_utf8()
            .ok()
            .filter(|id| {
                id.encode_utf16().count() <= 128
                    && !id
                        .chars()
                        .any(|character| character <= '\u{001f}' || character == '\u{007f}')
            })
            .map(|id| RouteKind::Owner(OwnerRoute::Space { id, presentation }))
            .unwrap_or(RouteKind::NotFound);
    }
    if path == "/login" {
        return RouteKind::Login;
    }

    let Some(rest) = path.strip_prefix("/share/") else {
        return RouteKind::NotFound;
    };
    let mut segments = rest.split('/');
    let Some(token) = segments.next().filter(|token| !token.is_empty()) else {
        return RouteKind::NotFound;
    };
    match (segments.next(), segments.next()) {
        (None, None) => RouteKind::Share {
            token,
            workspace: false,
        },
        (Some("workspace"), None) => RouteKind::Share {
            token,
            workspace: true,
        },
        _ => RouteKind::NotFound,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct RouteCase {
        url: String,
        kind: String,
        token: Option<String>,
        id: Option<String>,
        presentation: Option<String>,
    }

    fn kind_name(route: &RouteKind<'_>) -> &'static str {
        match route {
            RouteKind::Login => "login",
            RouteKind::Owner(OwnerRoute::Library) => "library",
            RouteKind::Owner(OwnerRoute::Home) => "home",
            RouteKind::Owner(OwnerRoute::Spaces) => "spaces",
            RouteKind::Owner(OwnerRoute::Space { .. }) => "space",
            RouteKind::Owner(OwnerRoute::Workspace) => "workspace",
            RouteKind::Owner(OwnerRoute::Canvas) => "canvas",
            RouteKind::Owner(OwnerRoute::Assistant) => "assistant",
            RouteKind::Owner(OwnerRoute::Offline) => "offline",
            RouteKind::Owner(OwnerRoute::Settings) => "settings",
            RouteKind::Share {
                workspace: false, ..
            } => "share",
            RouteKind::Share {
                workspace: true, ..
            } => "shareWorkspace",
            RouteKind::NotFound => "notFound",
        }
    }

    #[test]
    fn matches_shared_route_cases() {
        let cases: Vec<RouteCase> =
            serde_json::from_str(include_str!("../tests/fixtures/route-cases.json")).unwrap();
        for case in cases {
            let url = url::Url::parse(&format!("http://localhost{}", case.url)).unwrap();
            let route = classify_path(url.path());
            assert_eq!(kind_name(&route), case.kind, "{}", case.url);
            let token = match &route {
                RouteKind::Share { token, .. } => Some(*token),
                _ => None,
            };
            assert_eq!(token, case.token.as_deref(), "{}", case.url);

            let route = classify_path(url.path());
            let id = match route {
                RouteKind::Owner(OwnerRoute::Space { id, .. }) => Some(id),
                _ => None,
            };
            assert_eq!(id.as_deref(), case.id.as_deref(), "{}", case.url);

            let route = classify_path(url.path());
            let presentation = match route {
                RouteKind::Owner(OwnerRoute::Space { presentation, .. }) => {
                    presentation.map(|presentation| match presentation {
                        SpacePresentation::Focus => "focus",
                        SpacePresentation::Tiled => "tiled",
                        SpacePresentation::Map => "map",
                    })
                }
                _ => None,
            };
            assert_eq!(presentation, case.presentation.as_deref(), "{}", case.url);
        }
    }

    #[test]
    fn space_ids_are_single_opaque_percent_decoded_segments() {
        assert_eq!(
            classify_path("/spaces/id/~folder%2Fdesk%25one"),
            RouteKind::Owner(OwnerRoute::Space {
                id: Cow::Borrowed("folder/desk%one"),
                presentation: None,
            })
        );
        assert_eq!(classify_path("/spaces/id/~one/two"), RouteKind::NotFound);
        assert_eq!(classify_path("/spaces/id/~%FF"), RouteKind::NotFound);
        assert_eq!(
            classify_path("/spaces/id/~control%00id"),
            RouteKind::NotFound
        );
        assert_eq!(
            classify_path(&format!("/spaces/id/~{}", "a".repeat(129))),
            RouteKind::NotFound
        );
        assert_eq!(classify_path("/spaces/id/research"), RouteKind::NotFound);
        assert_eq!(
            classify_path("/spaces/id/~."),
            RouteKind::Owner(OwnerRoute::Space {
                id: Cow::Borrowed("."),
                presentation: None,
            })
        );
        assert_eq!(
            classify_path("/spaces/id/~folder%2Fdesk/map"),
            RouteKind::Owner(OwnerRoute::Space {
                id: Cow::Borrowed("folder/desk"),
                presentation: Some(SpacePresentation::Map),
            })
        );
        assert_eq!(
            classify_path("/spaces/id/~folder/grid"),
            RouteKind::NotFound
        );
    }
}
