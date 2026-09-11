use super::{catalog, playlists, radio};
use rusqlite::{Connection, params};
use serde_json::json;

fn database() -> Connection {
    let c = Connection::open_in_memory().unwrap();
    c.execute_batch("PRAGMA foreign_keys=ON").unwrap();
    crate::activity::initialize(&c).unwrap();
    crate::media_ai::initialize(&c).unwrap();
    super::initialize(&c).unwrap();
    for (path, artist, genre) in [
        ("a.mp3", "One", "jazz"),
        ("b.mp3", "One", "jazz"),
        ("c.mp3", "Two", "jazz"),
        ("d.mp3", "Three", "metal"),
    ] {
        c.execute(
            "INSERT INTO media_catalog(path,name,kind) VALUES(?1,?1,'audio')",
            [path],
        )
        .unwrap();
        c.execute(
            "INSERT INTO music_tracks(path,fingerprint,metadata,added_at) VALUES(?1,'',?2,1)",
            params![
                path,
                json!({"title":path,"artist":artist,"genre":[genre]}).to_string()
            ],
        )
        .unwrap();
        c.execute(
            "INSERT INTO music_reviews(path,fingerprint,metadata,enrichment,overrides,decision,score,profile_key,version,reviewed_at)
             SELECT path,fingerprint,metadata,enrichment,overrides,?2,85,'test',1,1 FROM music_tracks WHERE path=?1",
            params![path,json!({"id":1,"kind":"song","title":path,"artist":artist,"album":"","genres":[genre],"score":85,"reason":"Fits your music"}).to_string()],
        ).unwrap();
    }
    c
}

#[test]
fn only_reviewed_songs_can_enter_music_recommendations() {
    let c = database();
    c.execute("DELETE FROM music_reviews WHERE path='a.mp3'", [])
        .unwrap();
    c.execute("UPDATE music_reviews SET decision=?1,score=0 WHERE path='b.mp3'",[
        json!({"kind":"effect","title":"Snare","artist":"Sample producer","album":"Sample pack","genres":[],"score":0,"reason":"Instrument sample"}).to_string()
    ]).unwrap();
    c.execute("UPDATE music_reviews SET decision=?1 WHERE path='c.mp3'",[
        json!({"kind":"song","title":"A real song","artist":"Artist","album":"Release","genres":[],"score":80,"reason":"Known song, genre uncertain"}).to_string()
    ]).unwrap();
    let approved = catalog::approved_tracks(&c).unwrap();
    assert_eq!(approved.len(), 2);
    assert!(
        !approved
            .iter()
            .any(|t| t.path == "a.mp3" || t.path == "b.mp3")
    );
    assert!(
        approved
            .iter()
            .find(|t| t.path == "c.mp3")
            .unwrap()
            .genre
            .is_empty()
    );
    assert_eq!(catalog::tracks(&c, true).unwrap().len(), 4);
    c.execute(
        "UPDATE music_tracks SET overrides='{} ' WHERE path='d.mp3'",
        [],
    )
    .unwrap();
    assert_eq!(catalog::approved_tracks(&c).unwrap().len(), 1);
}

#[test]
fn duplicate_copies_do_not_create_multiple_recommendations_or_fake_album_tracks() {
    let c = database();
    let mut tracks = catalog::approved_tracks(&c).unwrap();
    let mut copy = tracks[0].clone();
    copy.path = "Backup/a.mp3".into();
    tracks.push(copy);
    let unique = catalog::unique_songs(tracks);
    assert_eq!(unique.len(), 4);
    assert!(unique.iter().any(|t| t.path == "a.mp3"));
}

#[test]
fn radio_respects_genres_history_manual_queue_and_session_skips() {
    let c = database();
    let all = catalog::tracks(&c, false).unwrap();
    let request = radio::RadioRequest {
        genre: "jazz".into(),
        strict_genre: true,
        exclude: vec!["a.mp3".into()],
        recent: vec!["b.mp3".into()],
        ..Default::default()
    };
    assert_eq!(
        radio::select(&all, &[], &request, &c)
            .unwrap()
            .iter()
            .map(|t| t.path.as_str())
            .collect::<Vec<_>>(),
        vec!["c.mp3"]
    );
    let repeated = radio::select(
        &all,
        &[],
        &radio::RadioRequest {
            allow_repeats: true,
            ..request.clone()
        },
        &c,
    )
    .unwrap();
    assert_eq!(repeated.len(), 2);
    assert!(
        repeated
            .iter()
            .all(|t| t.path != "a.mp3" && t.path != "d.mp3")
    );
    let skipped = radio::select(
        &all,
        &[],
        &radio::RadioRequest {
            skipped: vec!["c.mp3".into()],
            ..request
        },
        &c,
    )
    .unwrap();
    assert!(skipped.is_empty());
}

#[test]
fn custom_genres_override_service_tags_and_hidden_tracks_stay_out_of_radio() {
    let c = database();
    c.execute(
        "UPDATE music_tracks SET enrichment=?1,overrides=?2 WHERE path='a.mp3'",
        params![
            json!({"genre":["metal"]}).to_string(),
            json!({"genre":["Hip Hop","hiphop"],"artist":"Corrected"}).to_string()
        ],
    )
    .unwrap();
    c.execute("INSERT INTO media_feedback VALUES('b.mp3','hide',0)", [])
        .unwrap();
    let all = catalog::tracks(&c, false).unwrap();
    let a = all.iter().find(|t| t.path == "a.mp3").unwrap();
    assert_eq!(a.genre, vec!["hip-hop"]);
    assert_eq!(a.genre_source, "custom");
    assert_eq!(a.artist, "Corrected");
    assert!(!all.iter().any(|t| t.path == "b.mp3"));
    assert_eq!(catalog::tracks(&c, true).unwrap().len(), 4);
}

#[test]
fn temporary_exclusions_expire_without_removing_likes() {
    let c = database();
    c.execute(
        "INSERT INTO media_feedback VALUES('a.mp3','more',?1)",
        [crate::app::timestamp_ms() as i64 + 86_400_000],
    )
    .unwrap();
    assert!(
        !catalog::tracks(&c, false)
            .unwrap()
            .iter()
            .any(|t| t.path == "a.mp3")
    );
    assert!(
        catalog::tracks(&c, true)
            .unwrap()
            .iter()
            .find(|t| t.path == "a.mp3")
            .unwrap()
            .liked
    );
    c.execute("UPDATE media_feedback SET until=1 WHERE path='a.mp3'", [])
        .unwrap();
    assert!(
        catalog::tracks(&c, false)
            .unwrap()
            .iter()
            .find(|t| t.path == "a.mp3")
            .unwrap()
            .liked
    );
}

#[test]
fn smart_playlist_rules_are_intersected_and_path_moves_preserve_order() {
    let mut c = database();
    c.execute("INSERT INTO media_feedback VALUES('a.mp3','more',0)", [])
        .unwrap();
    let all = catalog::tracks(&c, false).unwrap();
    let rules = playlists::Rules {
        genre: "jazz".into(),
        liked: true,
        unplayed: true,
        not_played_days: 30,
        ..Default::default()
    };
    assert_eq!(
        all.iter()
            .filter(|t| playlists::matches(t, &rules, 100 * 86_400_000))
            .count(),
        1
    );
    c.execute(
        "INSERT INTO music_playlists(id,name,created_at,updated_at) VALUES('p','Ordered',1,1)",
        [],
    )
    .unwrap();
    c.execute_batch("INSERT INTO music_playlist_tracks VALUES('p',0,'b.mp3'),('p',1,'a.mp3');")
        .unwrap();
    let tx = c.transaction().unwrap();
    super::move_paths(&tx, "a.mp3", "renamed.mp3").unwrap();
    tx.commit().unwrap();
    let path: String = c
        .query_row(
            "SELECT path FROM music_playlist_tracks WHERE playlist_id='p' AND position=1",
            [],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(path, "renamed.mp3");
    let tx = c.transaction().unwrap();
    super::remove_paths(&tx, "b.mp3").unwrap();
    tx.commit().unwrap();
    assert_eq!(
        c.query_row("SELECT count(*) FROM music_playlist_tracks", [], |r| r
            .get::<_, i64>(0))
            .unwrap(),
        1
    );
}

#[test]
fn prepared_stations_reject_missing_duplicate_and_cross_station_candidate_ids() {
    assert_eq!(
        radio::validate_stations(
            &json!([{"id":1,"picks":[2,0]},{"id":0,"picks":[1]}]),
            &[2, 3]
        )
        .unwrap(),
        vec![(1, vec![2, 0]), (0, vec![1])]
    );
    for invalid in [
        json!([{"id":0,"picks":[0]}]),
        json!([{"id":0,"picks":[0]},{"id":0,"picks":[1]}]),
        json!([{"id":0,"picks":[2]},{"id":1,"picks":[0]}]),
        json!([{"id":0,"picks":[1,1]},{"id":1,"picks":[0]}]),
    ] {
        assert!(radio::validate_stations(&invalid, &[2, 3]).is_err());
    }
}

#[test]
fn prepared_station_snapshot_filters_tracks_that_are_hidden_deleted_or_no_longer_approved() {
    let c = database();
    c.execute(
        "INSERT INTO music_radio_stations VALUES('genre:jazz',?1,?2,'profile',1)",
        params![
            json!({"genre":"jazz","artist":""}).to_string(),
            json!(["a.mp3", "b.mp3", "c.mp3", "missing.mp3"]).to_string()
        ],
    )
    .unwrap();
    c.execute("INSERT INTO media_feedback VALUES('a.mp3','hide',0)", [])
        .unwrap();
    c.execute("DELETE FROM music_reviews WHERE path='b.mp3'", [])
        .unwrap();
    let snapshot = radio::snapshot(&c, &catalog::approved_tracks(&c).unwrap()).unwrap();
    assert_eq!(snapshot["stations"][0]["items"], json!(["c.mp3"]));
    assert_eq!(snapshot["tracks"].as_array().unwrap().len(), 2);
}

#[test]
fn genre_mixes_use_prepared_selections_without_one_artist_crowding_out_the_page() {
    let c = database();
    let template = catalog::approved_tracks(&c).unwrap().remove(0);
    let genres: Vec<_> = (0..6).map(|i| format!("genre-{i}")).collect();
    let mut tracks = Vec::new();
    for i in 0..12 {
        let mut track = template.clone();
        track.path = format!("favorite/{i}.mp3");
        track.title = format!("Favorite song {i}");
        track.artist = "Favorite artist".into();
        track.ai_score = 99.0;
        track.genre = genres.clone();
        tracks.push(track);
    }
    let mut stations = Vec::new();
    for (genre_index, genre) in genres.iter().enumerate() {
        let mut paths: Vec<_> = tracks[..12]
            .iter()
            .map(|track| track.path.clone())
            .collect();
        for artist in 0..3 {
            for song in 0..4 {
                let mut track = template.clone();
                track.path = format!("{genre}/{artist}/{song}.mp3");
                track.title = format!("Song {song}");
                track.artist = format!("Artist {genre_index}-{artist}");
                track.ai_score = 80.0;
                track.genre = vec![genre.clone()];
                paths.push(track.path.clone());
                tracks.push(track);
            }
        }
        stations.push(json!({"genre":genre,"artist":"","items":paths}));
    }
    let mut omitted = template;
    omitted.path = "not-selected-by-ai.mp3".into();
    omitted.genre = genres;
    omitted.ai_score = 100.0;
    tracks.push(omitted);
    let page = catalog::home_mixes(&tracks, &json!({"stations":stations}));
    let mixes = page.as_array().unwrap();
    assert_eq!(mixes.len(), 6);
    let artists: std::collections::HashSet<_> = mixes
        .iter()
        .flat_map(|mix| mix["items"].as_array().unwrap())
        .map(|track| track["artist"].as_str().unwrap())
        .collect();
    assert_eq!(artists.len(), 19);
    for mix in mixes {
        let items = mix["items"].as_array().unwrap();
        assert_eq!(items.len(), 12);
        assert!(
            items
                .iter()
                .filter(|track| track["artist"] == "Favorite artist")
                .count()
                <= 3
        );
        assert!(
            items
                .iter()
                .all(|track| track["path"] != "not-selected-by-ai.mp3")
        );
        assert!(
            items
                .iter()
                .all(|track| track["genre"].as_array().unwrap().contains(&mix["genre"]))
        );
    }
}

#[test]
fn single_artist_and_duplicate_station_labels_do_not_fill_genre_mix_cards() {
    let c = database();
    let mut tracks = catalog::approved_tracks(&c).unwrap();
    for track in &mut tracks {
        track.genre.extend(["fusion".into(), "smooth jazz".into()]);
    }
    let page = catalog::home_mixes(
        &tracks,
        &json!({"stations":[
            {"genre":"jazz","artist":"","items":["a.mp3","c.mp3"]},
            {"genre":"fusion","artist":"","items":["a.mp3","c.mp3"]},
            {"genre":"smooth jazz","artist":"","items":["a.mp3","b.mp3"]}
        ]}),
    );
    assert_eq!(page.as_array().unwrap().len(), 1);
    assert_eq!(page[0]["count"], 2);
    assert!(
        catalog::home_mixes(&tracks, &json!({"stations":[]}))
            .as_array()
            .unwrap()
            .is_empty()
    );
}

#[test]
fn recommended_tracks_and_albums_spread_across_eligible_artists() {
    let c = database();
    let template = catalog::approved_tracks(&c).unwrap().remove(0);
    let mut tracks = Vec::new();
    for artist in 0..8 {
        for album in 0..3 {
            for song in 0..3 {
                let mut track = template.clone();
                track.path = format!("{artist}/{album}/{song}.mp3");
                track.title = format!("Song {album}-{song}");
                track.artist = format!("Artist {artist}");
                track.album_artist = track.artist.clone();
                track.album = format!("Album {artist}-{album}");
                track.ai_score = if artist == 0 { 99.0 } else { 80.0 };
                tracks.push(track);
            }
        }
    }
    let page = catalog::home_sections(&tracks, None);
    let recommended = page["rows"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["id"] == "recommended")
        .unwrap();
    let artists: std::collections::HashSet<_> = recommended["items"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["artist"].as_str().unwrap())
        .collect();
    assert_eq!(artists.len(), 8);
    let album_artists: std::collections::HashSet<_> = page["albums"]
        .as_array()
        .unwrap()
        .iter()
        .map(|item| item["artist"].as_str().unwrap())
        .collect();
    assert_eq!(album_artists.len(), 6);
}
