# AnimeStream email/password authentication

The static frontend uses Supabase Auth directly. Google OAuth is not used by this build. Users can create an account with an email address and password, sign in, request a password reset, and set a new password from the recovery link. The existing `user_library` table and per-user Row Level Security continue to protect cloud-synced data.

## Supabase Auth settings

Open [AnimeStream Cloud → Auth Providers](https://supabase.com/dashboard/project/uzguqzkqqotxfrjgcjdh/auth/providers):

1. Enable **Email** as a provider.
2. Keep **Confirm email** enabled so new accounts must verify ownership of their email address.
3. Google is no longer required. You can disable the Google provider after confirming no other app still uses it.

## Email delivery for real users

Before opening registration to the public, configure a custom SMTP provider in Supabase Authentication settings. Supabase's default email service is intended for testing and is restricted in recipients and rate. Use a sender address on a domain you control and enter the SMTP host, port, username, password, and sender details in the Supabase dashboard only. Never place SMTP credentials in this repository or browser code.

## URL configuration

Open [AnimeStream Cloud → URL Configuration](https://supabase.com/dashboard/project/uzguqzkqqotxfrjgcjdh/auth/url-configuration):

- Site URL: `https://www.amstream.site`
- Redirect URLs: `https://www.amstream.site/**` and `https://amstream.site/**`

The app sends signup confirmation and password recovery links back to the site root.

## Frontend configuration

`assets/js/auth-config.js` contains only the Supabase project URL and browser-safe publishable key. Never add a Supabase secret/service-role key, SMTP password, or other private credential to that file.

## Cloud library sync

After successful sign-in, the app merges the browser's existing local library with the account's `user_library` row, then syncs My List, Continue Watching, watch progress, manga progress, and playback preferences. Signing out pushes pending changes first and clears that account's saved data from the current browser.
