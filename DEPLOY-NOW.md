# AnimeStream — Supabase-ready deployment package

This package is prepared for the existing AnimeStream Vercel project. Its files are at the project root (`index.html`, `api/`, `assets/`, and `vercel.json`).

## Supabase connection already configured

- Project URL: `https://wmdgpiammobabvuaxret.supabase.co`
- Project reference: `wmdgpiammobabvuaxret`
- Browser key: Supabase **publishable** key, stored in `assets/js/supabase-config.js`
- Database: `public.user_library` is already created in the live Supabase project with Row Level Security and per-user policies.

The publishable key is intended to be visible in browser code. Do not add a `service_role` or Supabase secret key to this package.

## Deploy to the existing Vercel project

1. Extract this ZIP.
2. Open a terminal in the extracted project folder (the folder containing `vercel.json`).
3. Deploy to your existing Vercel project using the Vercel CLI:

   ```bash
   npx vercel login
   npx vercel link
   npx vercel --prod
   ```

4. During `vercel link`, select the existing AnimeStream Vercel project. Do not create a new project unless you intend to change the site's deployment target.

No build command is required for this static HTML + Vercel Functions project. Keep the `api/` directory at the root so the existing API endpoints continue to deploy.

## One-time Supabase Auth URL configuration

In Supabase Dashboard → Authentication → URL Configuration, set:

- Site URL: `https://www.amstream.site`
- Redirect URL: `https://www.amstream.site/**`
- Redirect URL: `https://amstream.site/**`

Add any other production hostname you actually use. If you test on Vercel preview deployments, add the specific preview URL pattern you use rather than a broad wildcard if possible.

In Authentication → Providers → Email, make sure Email is enabled. If email confirmation is enabled, new accounts must click the confirmation link before they can sign in. The sign-up UI already handles that state.

## Included account behavior

- Guests keep My List, Continue Watching, and watch progress in browser localStorage.
- Signed-in users sync those three items to their own Supabase row.
- Manga/comics reading data and catalogue/device caches are not added to Supabase.
- Existing APIs and player implementation are preserved.

## Verification checklist after deployment

1. Open the production website and check that the login modal offers account creation and guest mode.
2. Continue as guest, add an anime to My List, refresh, and confirm it remains.
3. Create an account and confirm the email if confirmation is enabled.
4. Log in and check that `public.user_library` receives exactly one row for that account.
5. Add a title / watch progress, reload, and confirm it syncs.
6. Log in from a second browser/device and confirm the same account library appears.
7. Sign out and confirm the separate guest library is restored.

The Supabase database is already live, but this package has not been deployed to Vercel from this workspace. Complete the deploy steps above before treating the public site as live on Supabase.
