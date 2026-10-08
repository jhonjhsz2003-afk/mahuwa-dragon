-- Mahuwa Dragon: new D1 database. No personal account or deployment identifiers.
-- Runtime database.js creates the same idempotent tables.

CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,username TEXT NOT NULL COLLATE NOCASE UNIQUE,email TEXT NOT NULL COLLATE NOCASE UNIQUE,password_hash TEXT NOT NULL,password_salt TEXT NOT NULL,avatar_url TEXT NOT NULL DEFAULT '/assets/avatar-default.svg',bio TEXT NOT NULL DEFAULT '',blocked INTEGER NOT NULL DEFAULT 0 CHECK(blocked IN (0,1)),created_at TEXT NOT NULL,updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,expires_at TEXT NOT NULL,created_at TEXT NOT NULL);

CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions(user_id);

CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS auth_limits(id TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0,expires_at INTEGER NOT NULL);

CREATE INDEX IF NOT EXISTS auth_limits_expires_idx ON auth_limits(expires_at);

CREATE TABLE IF NOT EXISTS app_config(key TEXT PRIMARY KEY,value TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS profile_privacy(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,visibility TEXT NOT NULL DEFAULT 'private' CHECK(visibility IN ('private','public')));

CREATE TABLE IF NOT EXISTS user_appearance(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,name_color TEXT NOT NULL DEFAULT 'ice' CHECK(name_color IN ('ice','blue','cyan','green','gold','orange','pink','violet')));

CREATE TABLE IF NOT EXISTS profile_identity(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,cover TEXT NOT NULL DEFAULT 'aurora' CHECK(cover IN ('aurora','inferno','nebula','moon')),frame TEXT NOT NULL DEFAULT 'flame' CHECK(frame IN ('flame','crystal','halo','plain')),title TEXT NOT NULL DEFAULT 'Explorador de histórias');

CREATE TABLE IF NOT EXISTS profile_media(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,mime TEXT NOT NULL,data BLOB NOT NULL CHECK(length(data)<=1000000),x REAL NOT NULL DEFAULT 50 CHECK(x BETWEEN 0 AND 100),y REAL NOT NULL DEFAULT 50 CHECK(y BETWEEN 0 AND 100),zoom REAL NOT NULL DEFAULT 100 CHECK(zoom BETWEEN 100 AND 300),byte_length INTEGER NOT NULL DEFAULT 0 CHECK(byte_length BETWEEN 0 AND 20971520),chunk_count INTEGER NOT NULL DEFAULT 0 CHECK(chunk_count BETWEEN 0 AND 20),version TEXT NOT NULL DEFAULT '',storage TEXT NOT NULL DEFAULT 'd1' CHECK(storage IN ('d1','r2')),object_key TEXT NOT NULL DEFAULT '');

CREATE TABLE IF NOT EXISTS profile_media_chunks(user_id TEXT NOT NULL REFERENCES profile_media(user_id) ON DELETE CASCADE,seq INTEGER NOT NULL CHECK(seq BETWEEN 0 AND 19),data BLOB NOT NULL CHECK(length(data)>0 AND length(data)<=1048576),PRIMARY KEY(user_id,seq));

CREATE TABLE IF NOT EXISTS manga_library(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,media_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('favorite','later','reading','completed','paused','dropped')),metadata TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL,PRIMARY KEY(user_id,media_id,kind));

CREATE UNIQUE INDEX IF NOT EXISTS library_status_unique ON manga_library(user_id,media_id) WHERE kind IN ('reading','completed','paused','dropped');

CREATE INDEX IF NOT EXISTS library_user_order ON manga_library(user_id,updated_at DESC);

CREATE TABLE IF NOT EXISTS reading_progress(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,media_id TEXT NOT NULL,chapter_id TEXT NOT NULL,page INTEGER NOT NULL CHECK(page>=0),total_pages INTEGER NOT NULL CHECK(total_pages BETWEEN 1 AND 20000),percent REAL NOT NULL CHECK(percent BETWEEN 0 AND 100),metadata TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL,PRIMARY KEY(user_id,media_id));

CREATE TABLE IF NOT EXISTS user_settings(user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,payload TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS manga_comments(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,media_id TEXT NOT NULL,chapter_id TEXT,body TEXT NOT NULL CHECK(length(body) BETWEEN 2 AND 2000),spoiler INTEGER NOT NULL DEFAULT 0 CHECK(spoiler IN (0,1)),fingerprint TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,media_id,fingerprint));

CREATE INDEX IF NOT EXISTS comments_media_order ON manga_comments(media_id,created_at DESC,id DESC);

CREATE TABLE IF NOT EXISTS comment_likes(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,comment_id TEXT NOT NULL REFERENCES manga_comments(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(user_id,comment_id));

CREATE INDEX IF NOT EXISTS comment_likes_count ON comment_likes(comment_id);

CREATE TABLE IF NOT EXISTS comment_reports(user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,comment_id TEXT NOT NULL REFERENCES manga_comments(id) ON DELETE CASCADE,created_at TEXT NOT NULL,PRIMARY KEY(user_id,comment_id));

CREATE TABLE IF NOT EXISTS translation_usage(user_id TEXT NOT NULL,day TEXT NOT NULL,kind TEXT NOT NULL,used INTEGER NOT NULL DEFAULT 0 CHECK(used>=0),PRIMARY KEY(user_id,day,kind));
