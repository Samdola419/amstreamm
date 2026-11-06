# Google sign-in setup

AnimeStream's frontend is now wired to the `AnimeStream Cloud` Supabase project and exposes Google as its only account sign-in method. Google OAuth still needs a client ID and client secret from Google Cloud before users can complete the redirect flow.

## Google Cloud

1. Open the [Google Auth Platform clients page](https://console.cloud.google.com/auth/clients) and select or create the Google Cloud project for AnimeStream.
2. Create an OAuth client ID and choose **Web application**.
3. Add these Authorized JavaScript origins:
   - `https://www.amstream.site`
   - `https://amstream.site`
4. Add this Authorized redirect URI exactly:
   - `https://uzguqzkqqotxfrjgcjdh.supabase.co/auth/v1/callback`
5. Save the OAuth client. Keep the Client ID and Client Secret private.

## Supabase

Open [AnimeStream Cloud Auth Providers](https://supabase.com/dashboard/project/uzguqzkqqotxfrjgcjdh/auth/providers):

1. Open the **Google** provider, enable it, and enter the Google Client ID and Client Secret.
2. Disable **Email** and every other provider so Google is the only account method.
3. In **Authentication → URL Configuration**, set the Site URL to `https://www.amstream.site`.
4. Add these Redirect URLs:
   - `https://www.amstream.site/**`
   - `https://amstream.site/**`
   - `http://localhost:3000/**` (only if using that local development URL)

Do not paste the Google Client Secret into `assets/js/auth-config.js` or any frontend file. The frontend only contains the Supabase URL and publishable key.

## Synced user data

The app syncs My List, Continue Watching, movie/series/anime watch progress, manga reading progress, preferred sub/dub language, Auto-next, manga data-saver preference, and player settings. Temporary API/catalogue caches, ad cache, and recent-search history remain local to each browser.
