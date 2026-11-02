# AnimeStream account storage — live Supabase project

The AnimeStream Supabase project has been created in the free-plan organization in the Ireland region (`eu-west-1`). The `public.user_library` table and per-user Row Level Security policies have already been applied to that project.

## Storage behavior

- Guests keep My List, Continue Watching, and watch progress in their browser's `localStorage`.
- Signed-in users sync those same three items to their own Supabase row.
- Catalogue caches, device/player settings, manga/comics files, and unrelated site behavior remain unchanged.
- The browser uses only the Supabase publishable key. No service-role or secret key is present in the frontend.

## Project configuration

`assets/js/supabase-config.js` is configured with the live project's URL and publishable key.

Project URL: `https://wmdgpiammobabvuaxret.supabase.co`

Project reference: `wmdgpiammobabvuaxret`

## Remaining steps before account sign-in works on the public site

1. Deploy this updated project to the existing website host (the deployment credentials are not connected to this workspace, so this has not been published to the public website from here).
2. In Supabase Dashboard → Authentication → URL Configuration, set the Site URL to `https://www.amstream.site` and add `https://www.amstream.site/**` to Redirect URLs (and add any alternate production domain actually used by the site).
3. In Authentication → Providers, ensure Email is enabled. If email confirmation is enabled, new users must confirm their email before signing in.
4. Test guest persistence, sign-up/login, cloud library sync in another browser, and sign-out/guest separation.

The SQL file is included for reference/reprovisioning; it has already been applied to the live project. Do not put a Supabase secret/service-role key in browser code.
