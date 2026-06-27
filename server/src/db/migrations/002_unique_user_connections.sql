ALTER TABLE zoho_connections ADD CONSTRAINT zoho_connections_user_id_unique UNIQUE (user_id);
ALTER TABLE google_connections ADD CONSTRAINT google_connections_user_id_unique UNIQUE (user_id);
