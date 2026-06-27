ALTER TABLE google_calendars ADD CONSTRAINT google_calendars_user_calendar_unique UNIQUE (user_id, google_calendar_id);
