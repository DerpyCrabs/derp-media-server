#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum OwnerRoute {
    Library,
    Home,
    Spaces,
    Workspace,
    Canvas,
    Assistant,
    Offline,
    Settings,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum RouteKind<'a> {
    Login,
    Owner(OwnerRoute),
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

fn enabled_switch(value: Option<&str>) -> bool {
    !value.is_some_and(|value| {
        let value = value.trim();
        value == "0" || value.eq_ignore_ascii_case("false")
    })
}

pub(crate) fn new_shell_enabled() -> bool {
    enabled_switch(std::env::var("NEW_SHELL").ok().as_deref())
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
    }

    fn kind_name(route: RouteKind<'_>) -> &'static str {
        match route {
            RouteKind::Login => "login",
            RouteKind::Owner(OwnerRoute::Library) => "library",
            RouteKind::Owner(OwnerRoute::Home) => "home",
            RouteKind::Owner(OwnerRoute::Spaces) => "spaces",
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
            assert_eq!(kind_name(route), case.kind, "{}", case.url);
            let token = match route {
                RouteKind::Share { token, .. } => Some(token),
                _ => None,
            };
            assert_eq!(token, case.token.as_deref(), "{}", case.url);
        }
    }

    #[test]
    fn new_shell_switch_defaults_on_and_accepts_explicit_false_values() {
        assert!(enabled_switch(None));
        assert!(enabled_switch(Some("")));
        assert!(enabled_switch(Some("true")));
        assert!(!enabled_switch(Some("0")));
        assert!(!enabled_switch(Some("false")));
        assert!(!enabled_switch(Some(" FALSE ")));
    }
}
