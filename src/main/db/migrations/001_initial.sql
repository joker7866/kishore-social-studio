-- 001: initial schema. Secrets (API keys) are never stored in this database.

CREATE TABLE channel_profiles (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  name               TEXT NOT NULL,
  youtube_handle     TEXT NOT NULL DEFAULT '',
  facebook_page      TEXT NOT NULL DEFAULT '',
  instagram_handle   TEXT NOT NULL DEFAULT '',
  youtube_hashtag    TEXT NOT NULL DEFAULT '',
  facebook_hashtag   TEXT NOT NULL DEFAULT '',
  instagram_hashtag  TEXT NOT NULL DEFAULT '',
  is_default         INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL,
  updated_at         TEXT NOT NULL
);

CREATE TABLE drafts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  title         TEXT NOT NULL,
  headline      TEXT NOT NULL,
  context_json  TEXT NOT NULL,
  languages     TEXT NOT NULL,
  tone          TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'generated',
  profile_id    INTEGER REFERENCES channel_profiles(id) ON DELETE SET NULL,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  deleted_at    TEXT
);
CREATE INDEX idx_drafts_updated ON drafts(updated_at);

CREATE TABLE packages (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  draft_id        INTEGER NOT NULL REFERENCES drafts(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  content_type    TEXT NOT NULL,
  generated_json  TEXT NOT NULL,
  edited_json     TEXT,
  provider        TEXT NOT NULL,
  model           TEXT NOT NULL,
  skill_version   TEXT NOT NULL,
  generated_at    TEXT NOT NULL,
  UNIQUE (draft_id, content_type)
);
CREATE INDEX idx_packages_draft ON packages(draft_id);

CREATE TABLE field_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id      INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  field_path      TEXT NOT NULL,
  previous_value  TEXT,
  new_value       TEXT,
  source          TEXT NOT NULL CHECK (source IN ('user', 'regen')),
  created_at      TEXT NOT NULL
);
CREATE INDEX idx_history_package ON field_history(package_id, id);

CREATE TABLE templates (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT NOT NULL,
  tone         TEXT NOT NULL,
  language     TEXT NOT NULL,
  platforms    TEXT NOT NULL,
  preset_json  TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE provider_settings (
  provider    TEXT PRIMARY KEY,
  model       TEXT NOT NULL,
  timeout_ms  INTEGER NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE app_settings (
  key    TEXT PRIMARY KEY,
  value  TEXT NOT NULL
);
