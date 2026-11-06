-- Modelo equivalente para MySQL 8.0.16+ ou MariaDB com suporte a CHECK.
-- O aplicativo executavel desta entrega utiliza SQLite. Este arquivo nao configura um driver MySQL.
CREATE TABLE teams (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 name VARCHAR(180) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE clients (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 name VARCHAR(180) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE users (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 name VARCHAR(180) NOT NULL,
 email VARCHAR(254) NOT NULL UNIQUE,
 password_hash VARCHAR(255) NOT NULL,
 role VARCHAR(20) NOT NULL CHECK(role IN ('attendant','supervisor','manager','client')),
 team_id BIGINT UNSIGNED NULL,
 client_id BIGINT UNSIGNED NULL,
 FOREIGN KEY(team_id) REFERENCES teams(id),
 FOREIGN KEY(client_id) REFERENCES clients(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE categories (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 name VARCHAR(180) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE tickets (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 protocol VARCHAR(32) NULL UNIQUE,
 client_id BIGINT UNSIGNED NOT NULL,
 attendant_id BIGINT UNSIGNED NOT NULL,
 team_id BIGINT UNSIGNED NOT NULL,
 category_id BIGINT UNSIGNED NULL,
 subject VARCHAR(180) NOT NULL,
 channel VARCHAR(30) NOT NULL,
 status VARCHAR(24) NOT NULL DEFAULT 'active' CHECK(status IN ('active','awaiting_feedback','resolved','closed_no_response')),
 created_at VARCHAR(35) NOT NULL,
 response_due_at VARCHAR(35) NOT NULL,
 replied_at VARCHAR(35) NULL,
 solution TEXT NULL,
 solution_sent_at VARCHAR(35) NULL,
 feedback_deadline VARCHAR(35) NULL,
 manual_status_changes TINYINT UNSIGNED NOT NULL DEFAULT 0 CHECK(manual_status_changes BETWEEN 0 AND 1),
 closed_at VARCHAR(35) NULL,
 closure_reason VARCHAR(40) NULL,
 solution_attempt INT UNSIGNED NOT NULL DEFAULT 0,
 rejected_at VARCHAR(35) NULL,
 FOREIGN KEY(client_id) REFERENCES clients(id),
 FOREIGN KEY(attendant_id) REFERENCES users(id),
 FOREIGN KEY(team_id) REFERENCES teams(id),
 FOREIGN KEY(category_id) REFERENCES categories(id),
 INDEX tickets_scope_idx(team_id,attendant_id,client_id,status),
 INDEX tickets_deadline_idx(status,feedback_deadline)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE feedbacks (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 protocol VARCHAR(32) NULL UNIQUE,
 ticket_id BIGINT UNSIGNED NOT NULL,
 attempt INT UNSIGNED NOT NULL,
 rating TINYINT UNSIGNED NOT NULL CHECK(rating BETWEEN 1 AND 5),
 resolved TINYINT UNSIGNED NOT NULL CHECK(resolved IN (0,1)),
 mode VARCHAR(16) NOT NULL CHECK(mode IN ('quick','text','audio')),
 text TEXT NULL,
 audio_path VARCHAR(80) NULL,
 audio_seconds DOUBLE NULL,
 sentiment VARCHAR(16) NOT NULL CHECK(sentiment IN ('positive','neutral','negative','pending')),
 criticality VARCHAR(16) NOT NULL CHECK(criticality IN ('critical','regular')),
 reviewed TINYINT UNSIGNED NOT NULL DEFAULT 0,
 summary TEXT NULL,
 analysis_source VARCHAR(24) NOT NULL DEFAULT 'local_rules',
 created_at VARCHAR(35) NOT NULL,
 redacted_at VARCHAR(35) NULL,
 analysis_status VARCHAR(20) NOT NULL DEFAULT 'not_required',
 analysis_error TEXT NULL,
 analysis_attempts INT UNSIGNED NOT NULL DEFAULT 0,
 analysis_started_at VARCHAR(35) NULL,
 analyzed_at VARCHAR(35) NULL,
 transcript TEXT NULL,
 confidence DOUBLE NULL,
 topics JSON NULL,
 evidence JSON NULL,
 analysis_model VARCHAR(180) NULL,
 transcription_model VARCHAR(180) NULL,
 original_sentiment VARCHAR(16) NULL,
 original_criticality VARCHAR(16) NULL,
 original_summary TEXT NULL,
 FOREIGN KEY(ticket_id) REFERENCES tickets(id),
 UNIQUE KEY feedbacks_attempt_unique(ticket_id,attempt),
 INDEX feedbacks_filters_idx(created_at,sentiment,criticality),
 INDEX feedbacks_analysis_idx(analysis_status,id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE reviews (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 feedback_id BIGINT UNSIGNED NOT NULL,
 reviewer_id BIGINT UNSIGNED NOT NULL,
 sentiment VARCHAR(16) NOT NULL,
 criticality VARCHAR(16) NOT NULL,
 justification TEXT NULL,
 action TEXT NULL,
 created_at VARCHAR(35) NOT NULL,
 FOREIGN KEY(feedback_id) REFERENCES feedbacks(id),
 FOREIGN KEY(reviewer_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE resolution_cases (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 ticket_id BIGINT UNSIGNED NULL,
 category_id BIGINT UNSIGNED NULL,
 team_id BIGINT UNSIGNED NOT NULL,
 subject VARCHAR(180) NOT NULL,
 solution TEXT NOT NULL,
 tags TEXT NOT NULL,
 usage_count INT UNSIGNED NOT NULL DEFAULT 0,
 created_at VARCHAR(35) NOT NULL,
 FOREIGN KEY(ticket_id) REFERENCES tickets(id),
 FOREIGN KEY(category_id) REFERENCES categories(id),
 FOREIGN KEY(team_id) REFERENCES teams(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE ticket_replies (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 ticket_id BIGINT UNSIGNED NOT NULL,
 user_id BIGINT UNSIGNED NOT NULL,
 message TEXT NULL,
 created_at VARCHAR(35) NOT NULL,
 FOREIGN KEY(ticket_id) REFERENCES tickets(id),
 FOREIGN KEY(user_id) REFERENCES users(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE audit_events (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 user_id BIGINT UNSIGNED NULL,
 ticket_id BIGINT UNSIGNED NULL,
 event VARCHAR(60) NOT NULL,
 created_at VARCHAR(35) NOT NULL,
 FOREIGN KEY(user_id) REFERENCES users(id),
 FOREIGN KEY(ticket_id) REFERENCES tickets(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
CREATE TABLE login_attempts (
 id BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
 identity CHAR(64) NOT NULL,
 created_at VARCHAR(35) NOT NULL,
 INDEX login_attempts_idx(identity,created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
