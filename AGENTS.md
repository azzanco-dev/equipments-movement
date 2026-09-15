# Equipment Movement — Project Context

## Product and communication

- This is an Arabic-first equipment gate movement system. Reply to the product owner in Arabic unless they ask for another language.
- For all newly added Arabic UI copy, do not use alif with hamza or madda. Normalize `أ`, `إ`, and `آ` to plain `ا`. Existing Arabic copy will be normalized separately later; do not rewrite it as part of unrelated changes.
- Current scope is the operational foundation (phase 1): equipment, drivers, companies, projects, lessors/owners, users, site and workshop entry/exit movements, movement photos, and the entry, equipment, and workshop reports.
- Workshop ENTRY is classified by purpose: `maintenance` or `parking` (standby).
- Planned later phases: phase 2 links equipment to contractor POs and monthly timesheets; phase 3 links external-supplier equipment to purchasing (POs and rental accruals). Do not introduce contracts/POs, timesheets, sales, purchasing, accounting, notifications, charts, or other future modules unless explicitly requested.
- Preserve existing behavior and make incremental changes. Do not rebuild working features merely to match a preferred architecture.
- The improvement plan and task status are tracked in Notion (page "Equipment Movement", database "مهام المشروع"). When a tracked task is completed, update its status there.

## Architecture

- Next.js 15 App Router with React 18 and TypeScript.
- `app/[[...path]]/page.tsx` hosts the current client application; route selection is handled in `src/App.tsx` while modules are migrated incrementally.
- UI screens live in `src/screens`; reusable controls live in `src/components`; domain types and helpers live in `src/lib`.
- Supabase provides PostgreSQL, Auth, Storage, RLS, database functions, and migrations.
- Supabase migrations in `supabase/migrations` are the database source of truth. Never edit an already-applied migration to change production behavior; add a new timestamped migration.
- Movement creation and movement-photo mutations use the Next.js API routes in `app/api/movements`. The API forwards the signed-in user's bearer token, so Supabase RLS remains authoritative.
- Never expose service-role credentials or secrets to client code. Never commit `.env` values.

## Authorization and database integrity

- Roles are `admin`, `supervisor`, `workshop`, `assistant_workshop_manager`, `workshop_manager`, and `monitor`; preserve the reviewed permission model for each movement context.
  - `admin`: full access to master data, users, reports, and settings.
  - `supervisor`: site movements for their assigned companies.
  - `workshop`: the limited workshop movement form.
  - `assistant_workshop_manager` / `workshop_manager`: workshop movements plus workshop classification and management views.
  - `monitor`: read-only dashboard, logs, and movement details.
- Client-side role routing must fail closed: an unknown or missing role must never receive the admin interface.
- Roles are assigned only by trusted server paths (admin Edge Functions or admin-only database functions), never from user-editable signup metadata.
- Critical rules must be enforced in PostgreSQL/RLS, not only in React or API validation.
- Do not weaken `entry_exit_logs`, `entry_exit_photos`, Storage, drivers, or master-data RLS.
- Do not expose raw PostgreSQL or Supabase errors to users. Map known errors to safe, understandable UI messages.
- Views that expose protected data must use `security_invoker = true` unless a reviewed, narrowly-scoped `SECURITY DEFINER` function is required.
- For `SECURITY DEFINER` functions: set a fixed `search_path`, revoke public/anon execution, grant only the required authenticated role, and validate `auth.uid()`/role as appropriate.

## Movement invariants

- Valid sequence per equipment and movement context (`site` or `workshop`) is strictly `ENTRY → EXIT → ENTRY → EXIT`.
- Reject `ENTRY → ENTRY`, `EXIT → EXIT`, and `EXIT` without a preceding valid `ENTRY`.
- Ordering is deterministic by `(recorded_at, id)`, including historical insertion and identical timestamps.
- Preserve per-equipment concurrency protection; do not replace database locking with frontend state.
- Site ENTRY requires equipment, independent company and project selections, driver, and an actual movement date. The UI selects the date only and applies the current local time internally when saving. `company_projects` remains for future use and must not restrict current ENTRY creation. Workshop ENTRY/EXIT uses the limited workshop form and requires equipment plus at least one selected photo; it does not require company, project, or driver.
- EXIT inherits company, project, and contractor equipment code from the corresponding latest valid ENTRY. Site EXIT uses the latest current driver after any auditable driver changes made during the open visit.
- Store `driver_id` plus the `driver_name` snapshot. Legacy rows with only `driver_name` must keep displaying correctly.
- Keep the original entry driver immutable. Driver changes during an open site visit are append-only records; multiple changes are supported and closed visits reject further changes.
- `registration_method`, `odometer_reading`, and legacy `photo_url` remain in the database for compatibility, but registration method and odometer are not part of the current movement UI.
- After movement creation succeeds, navigate to `/movements/:id`. A movement must never be submitted twice because a later photo upload failed.

## Movement photos

- New photos use `entry_exit_photos`; keep legacy `entry_exit_logs.photo_url` readable.
- Maximum 3 photos per movement, maximum 10 MB per image, JPEG/PNG/WEBP.
- The max-three rule must remain concurrency-safe and scoped per movement.
- Photo RLS and Storage access follow access to the parent movement. Uploader/admin deletion rules must remain enforced server-side.
- Storage upload is not atomic with PostgreSQL. If the movement is saved but photos fail, report partial success and allow photo management against the saved movement.
- Use stable image containers and `object-contain`; do not crop operational evidence photos.

## Drivers and Quick Create

- Driver master fields: `full_name`, `id_number`, `mobile_number`, `nationality`, `employment_type`, `job_title`.
- Only `full_name` is mandatory for a complete driver record. Quick Create intentionally requires `full_name` and `mobile_number`.
- Nationality and employment type values are controlled by database checks; update frontend lists and database constraints together.
- Quick Create creates real relational records and auto-selects them. Keep its database functions narrowly scoped; it must not grant supervisors unrestricted master-data CRUD.
- Duplicate checks use driver mobile/ID, equipment plate number, and lessor name/mobile as appropriate.

## Equipment ownership

- `ownership_status` is presented as “Owner”: Al-Azani, Takween, third-party F, third-party B, or Other Owner (`external_supplier`).
- Ownership state is derived, not independently edited: Al-Azani is owned; every other classification is rented.
- The external supplier selector appears only for Other Owner and is optional. Every other owner choice clears `lessor_id`.
- Equipment code prefixes suggest classification in the UI: `A` → Al-Azani, `TK` → Takween, `F` → third-party F, `B` → third-party B, otherwise external supplier. Database fields remain the source of truth.
- Quick-created equipment may be marked `master_data_complete = false` until an admin reviews it. Generated internal codes are short (`U001`, `U002`, ...), unique, and database-generated.

## Equipment types

- Equipment types are controlled by the `equipment_types` master table and managed by admins under Settings.
- The master record has one user-facing field, `name`; existing `equipment.type` remains the stored value and is protected by a foreign key to that master list.
- Equipment forms use server-side searchable type selection limited to 20 results. Equipment Excel imports must reference an existing type.
- Settings supports manual type management and Excel import with one equipment-type name column. Types referenced by equipment cannot be deleted.

## Unified list architecture

- Major lists use the shared system in `src/components/data-list` and module configs in `src/lib/listConfigs.ts`.
- Persist search, filters, sort, direction, page, and page size in the URL where practical so Back restores list state.
- Search, filtering, sorting, and pagination for potentially large tables are server-side. Never load a full table merely to filter or sort in the browser.
- Standard page sizes are `20, 50, 100, 200, 350, 500`; default is 20.
- Filter fields and operators are allowlisted per module. Do not expose arbitrary database columns.
- Relational dropdowns use `AsyncSearchSelect`: first/best 20 results, server-side search, about 300 ms debounce, no load-more or infinite scroll.
- Select only fields needed by the list or selector; avoid `select('*')` for large list queries.
- Detail pages show only 10–20 recent child records plus a “View All” route; do not embed a full DataList in details.
- Review query plans and add focused indexes in a new migration when adding common search/filter/sort paths.

## UI conventions

- Arabic/RTL first, responsive, mobile-friendly, shadcn-style.
- A unified design system is being built. Components are approved by the product owner on the admin-only `/ui-kit` page before screens are migrated to them. Do not migrate screens to unapproved components.
- Approved palette (2026-09-15, compared on `/ui-kit` against three brand-colored directions): keep the current neutral black/white foundation with functional colors, defined as tokens in `src/index.css`. Primary actions and active navigation are monochrome (black in light mode, white in dark mode). No gradients.
- Shared components are built on Radix Primitives (the unstyled `radix-ui` package) and styled entirely with project tokens. `I18nProvider` supplies the Radix direction provider, so do not pass `dir` to individual primitives.
- Use CSS variable tokens (through the Tailwind theme) for colors, borders, and surfaces. Do not hardcode Tailwind palette colors (`gray-*`, `emerald-*`, and so on) or hex values in screens.
- Do not apply letter-spacing (`tracking-*`) or `uppercase` to Arabic text; it breaks letter joining.
- Use logical direction utilities (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`) instead of left/right.
- Shared inputs, selects, date/time controls, and standard buttons are 32 px high. Standard button text is 13 px at weight 400. Large textareas, image areas, plate UI, and primary scanning areas may remain larger when functionally necessary.
- Use green for ENTRY/success and amber for EXIT/warnings; use red only for errors/destructive actions. Show ENTRY/EXIT through the shared status badge rather than ad hoc colors.
- Dark theme must keep text contrast accessible.
- Report and dashboard day boundaries use Saudi time (UTC+03:00), not the browser's local timezone.
- Show a visible error state when data fails to load; never render a load failure as an empty "no data" state.
- Use the translation system in `src/i18n/translations.ts`; add Arabic and English keys together. Avoid hardcoded user-facing strings in reusable UI.
- Mobile form controls must remain at least 16 px font size to prevent iOS focus zoom.

## Working rules

- Inspect the current implementation and latest migrations before changing related behavior.
- Preserve unrelated user changes in a dirty worktree. Do not reset, discard, or rewrite them.
- Use `rg`/`rg --files` for discovery and `apply_patch` for manual file edits.
- Do not add a production dependency unless the task clearly needs it; ask first when the dependency is heavy or materially changes the architecture.
- Keep server/API payloads minimal, validate at both UX and database/server boundaries, and avoid logging secrets or sensitive data.
- Do not start a local or remote data mutation merely to test unless the user has provided a dedicated test account/environment or explicitly authorized production test records.
- For database changes: inspect migration history, add a forward migration, apply it to the linked project when authorized, run linked DB lint, and verify local/remote migration history.
- When implementation is requested and checks pass, commit the scoped changes and push the working branch to `origin/main`, following the established repository workflow unless the user says not to push.

## Verification

Run checks sequentially because `next build` and `tsc` both use `.next` and can race when run in parallel:

```powershell
npm run build
npm run typecheck
npm run lint
npm test
git diff --check
```

For database work also run:

```powershell
npx supabase db lint --linked --level error
npx supabase migration list --linked
```

- Perform proportionate smoke tests for changed routes/APIs.
- Authenticated end-to-end checks require a provided test session. Do not claim authenticated CRUD/photo workflows were tested when only unauthenticated `200/401` smoke checks were run.

## Code review rules

- Flag any movement rule enforced only in frontend code.
- Flag non-deterministic movement/visit pairing that omits `id` after `recorded_at`.
- Flag full-table client-side filtering/pagination for major lists or relational selectors.
- Flag `USING (true)` photo access, public Storage reads, missing `uploaded_by = auth.uid()`, or service-role use in browser code.
- Flag changes that drop legacy `driver_name` or `photo_url` compatibility.
- Flag UI that reports total movement failure after the movement row was already saved.
- Flag client routing that grants admin UI to an unknown role, and any role taken from user-editable signup metadata.
- Flag new UI that bypasses approved shared components or hardcodes palette colors instead of tokens.
