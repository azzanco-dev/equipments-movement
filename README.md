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
