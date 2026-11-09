# AnimeStream custom database accounts

The current app does **not** use Supabase Auth, Google OAuth, email confirmation, or SMTP. It uses the custom `account-api` Edge Function and private database tables. Passwords are stored as salted PBKDF2 hashes, not plaintext. The browser stores only an opaque session token; only its hash is persisted in `animestream_sessions`.

The account function uses the server-only `SUPABASE_SERVICE_ROLE_KEY`. Never put it in frontend files or a GitHub client-side config. The browser uses the project's publishable key only to identify the project at the Edge Function gateway.

For a fresh database, apply `custom_accounts_schema.sql` first and then `rooms_schema.sql`. The account API must be deployed as `account-api`; the Rooms API is `rooms-api`.
