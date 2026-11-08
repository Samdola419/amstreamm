# AnimeStream custom database accounts

This build does **not** use Supabase Auth, Google OAuth, SMTP, or `auth.users`. It uses a custom account API deployed as the `account-api` Supabase Edge Function.

## What is stored

- `animestream_accounts`: email, display name, salted PBKDF2-HMAC-SHA-256 password hash (600,000 iterations), and account timestamps. The plaintext password is never stored.
- `animestream_sessions`: hash of an opaque 30-day session token, account ID, and expiry. The raw token is sent only to the signed-in browser.
- `animestream_account_library`: My List, Continue Watching, watch progress, manga progress, and preferences.
- `animestream_auth_limits`: hashed sign-up/sign-in rate-limit keys.

All four tables have RLS enabled and deny `anon` and `authenticated` client access. Only the server-side function uses the service role key. Do not put the service role key in frontend files.

## Deploy details

- Project ref: `uzguqzkqqotxfrjgcjdh`
- Function: `account-api`
- Function endpoint: `https://uzguqzkqqotxfrjgcjdh.supabase.co/functions/v1/account-api`
- Function gateway JWT verification is disabled because the function validates its own opaque session token for protected actions. A publishable API key is still supplied to the gateway.

The Edge Function runtime uses the Supabase-provided `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` environment variables. These are server-side only.

## Sign-in behaviour

Users create an account with an email and password, or sign in with those credentials. Successful sign-in returns a random 256-bit session token. Only the SHA-256 hash of that token is stored in the database. Sessions expire after 30 days and are revoked when the user signs out.

Account creation does not currently verify email ownership. There is no self-service password reset or full account deletion. Users can remove individual My List, Continue Watching, watch-progress, and reading-progress entries from the account page.

## Rollout

The frontend configuration contains only the project URL, publishable key, and account function endpoint. Deploy the static project after the ZIP is updated. Do not configure SMTP or enable Google Auth for this account flow; it does not depend on Supabase Auth.
