PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS teams (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS clients (id INTEGER PRIMARY KEY, name TEXT NOT NULL, city TEXT, state TEXT);
CREATE TABLE IF NOT EXISTS users (
 id INTEGER PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('attendant','supervisor','manager','client')),
 team_id INTEGER REFERENCES teams(id), client_id INTEGER REFERENCES clients(id)
);
CREATE TABLE IF NOT EXISTS categories (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tickets (
 id INTEGER PRIMARY KEY AUTOINCREMENT, protocol TEXT UNIQUE, client_id INTEGER NOT NULL REFERENCES clients(id),
 attendant_id INTEGER NOT NULL REFERENCES users(id), team_id INTEGER NOT NULL REFERENCES teams(id), category_id INTEGER REFERENCES categories(id),
 subject TEXT NOT NULL, channel TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','awaiting_feedback','resolved','closed_no_response')),
 created_at TEXT NOT NULL, response_due_at TEXT NOT NULL, replied_at TEXT, solution TEXT, solution_sent_at TEXT, feedback_deadline TEXT,
 manual_status_changes INTEGER NOT NULL DEFAULT 0 CHECK(manual_status_changes BETWEEN 0 AND 1), closed_at TEXT, closure_reason TEXT,
 solution_attempt INTEGER NOT NULL DEFAULT 0, rejected_at TEXT,
 priority TEXT NOT NULL DEFAULT 'medium' CHECK(priority IN ('low','medium','high','critical')),
 support_level INTEGER NOT NULL DEFAULT 1 CHECK(support_level BETWEEN 1 AND 3)
);
CREATE INDEX IF NOT EXISTS tickets_scope_idx ON tickets(team_id,attendant_id,client_id,status);
CREATE INDEX IF NOT EXISTS tickets_deadline_idx ON tickets(status,feedback_deadline);
CREATE TABLE IF NOT EXISTS feedbacks (
 id INTEGER PRIMARY KEY AUTOINCREMENT, protocol TEXT UNIQUE, ticket_id INTEGER NOT NULL REFERENCES tickets(id), attempt INTEGER NOT NULL,
 rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), resolved INTEGER NOT NULL CHECK(resolved IN (0,1)),
 mode TEXT NOT NULL CHECK(mode IN ('quick','text','audio')), text TEXT, audio_path TEXT, audio_seconds REAL,
 sentiment TEXT NOT NULL CHECK(sentiment IN ('positive','neutral','negative','pending')),
 criticality TEXT NOT NULL CHECK(criticality IN ('critical','regular')), reviewed INTEGER NOT NULL DEFAULT 0,
 summary TEXT, analysis_source TEXT NOT NULL DEFAULT 'local_rules', created_at TEXT NOT NULL, redacted_at TEXT,
 analysis_status TEXT NOT NULL DEFAULT 'not_required', analysis_error TEXT, analysis_attempts INTEGER NOT NULL DEFAULT 0,
 analysis_started_at TEXT, analyzed_at TEXT, transcript TEXT, confidence REAL, topics TEXT, evidence TEXT,
 analysis_model TEXT, transcription_model TEXT, original_sentiment TEXT, original_criticality TEXT, original_summary TEXT,
 UNIQUE(ticket_id,attempt)
);
CREATE INDEX IF NOT EXISTS feedbacks_filters_idx ON feedbacks(created_at,sentiment,criticality);
CREATE TABLE IF NOT EXISTS reviews (
 id INTEGER PRIMARY KEY AUTOINCREMENT, feedback_id INTEGER NOT NULL REFERENCES feedbacks(id), reviewer_id INTEGER NOT NULL REFERENCES users(id),
 sentiment TEXT NOT NULL, criticality TEXT NOT NULL, justification TEXT, action TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS resolution_cases (
 id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER REFERENCES tickets(id), category_id INTEGER REFERENCES categories(id),
 team_id INTEGER NOT NULL REFERENCES teams(id), subject TEXT NOT NULL, solution TEXT NOT NULL, tags TEXT NOT NULL, usage_count INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS ticket_replies (
 id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id INTEGER NOT NULL REFERENCES tickets(id), user_id INTEGER NOT NULL REFERENCES users(id), message TEXT, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER REFERENCES users(id), ticket_id INTEGER REFERENCES tickets(id), event TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS login_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT, identity TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS login_attempts_idx ON login_attempts(identity,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS clients_name_nocase ON clients(name COLLATE NOCASE);
