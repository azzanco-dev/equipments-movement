# Equipment Movement

Next.js App Router application backed by the existing Supabase project.

## Local setup

1. Copy `.env.example` to `.env.local`.
2. Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Run `npm install` and `npm run dev`.

The existing `supabase/migrations`, RLS policies, database functions, Auth users,
and Storage buckets remain the source of truth. Creating an entry/exit movement
and attaching its photos now goes through `POST /api/movements`; the handler uses
the signed-in user's bearer token and therefore still enforces Supabase RLS.

## Routes

- `/dashboard` and `/logs`
- `/equipment` and `/equipment/:id`
- `/movements/:id`
- `/projects`, `/companies`, `/lessors`, and `/users`

The catch-all App Router page keeps deep links usable while remaining feature
modules can move to dedicated server/client route boundaries incrementally.

## Edge Functions

`supabase/functions` holds the functions that need the service role, which the
Next server never has. Each one identifies the caller with the anon-key client
plus the caller's `Authorization` header and decides by `has_permission()`
evaluated as the caller; the service role is used only for the privileged
reads and writes afterwards.

- `create-user`, `manage-user`: user accounts (`users.manage`).
- `storage-cleanup`: the orphan cleanup of the `log-photos` bucket
  (`movements.photos.delete_any`), driven from Settings › «تنظيف ملفات الصور».
  Body `{ dry_run: boolean, older_than_hours?: number }` (default 2, minimum 1);
  a dry run only counts, a real run removes the unreferenced objects older than
  that and the expired `pending_movement_photo_batches` rows.

Deploy one with `npx supabase functions deploy <name>` from the project folder.
