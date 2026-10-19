# Equipment Movement — Project Context

## Product and communication

- This is an Arabic-first equipment gate movement system. Reply to the product owner in Arabic unless they ask for another language.
- For all newly added Arabic UI copy, do not use alif with hamza or madda. Normalize `أ`, `إ`, and `آ` to plain `ا`. Existing Arabic copy will be normalized separately later; do not rewrite it as part of unrelated changes.
- Current scope is the operational foundation (phase 1): equipment, drivers, companies, projects, lessors/owners, users, site and workshop entry/exit movements, movement photos, and the entry, equipment, and workshop reports.
- Workshop ENTRY is classified by purpose: `maintenance`, `parking` (standby) or `out_of_service` («خارج الخدمة», migration 0125). Only `classify_workshop_entry` writes it.
- Planned later phases: phase 2 links equipment to contractor POs and monthly timesheets; phase 3 links external-supplier equipment to purchasing (POs and rental accruals). Do not introduce contracts/POs, timesheets, sales, purchasing, accounting, notifications, charts, or other future modules unless explicitly requested.
- Purchasing, first piece (owner decisions 2026-10-15 to 2026-10-18, migration 0136, database only so far): the shared document «كرت المعدة» (`equipment_cards`: one unit for one company + project over a period, open end = `period_to` NULL, shared fields `rate_unit` default `month` and `standard_hours` default 260, two cards of one unit never overlap) is created ONLY behind the scenes by `add_supplier_po_equipment` and is never edited directly for now; supplier purchase orders (`supplier_pos`, number `SPO` + YY + four-digit yearly sequence consumed at creation, no approval workflow, `lessor_id` NULL only for an internal PO) carry one line per card with the price EXCLUDING VAT (`supplier_po_equipment.price`, 0 for an Al-Azani unit or a lessor marked `lessors.is_internal`; a card sits on at most one open PO) and an append-only audit (`supplier_po_events`); `lessor_contacts` is DB-only. Every write goes through the SECURITY DEFINER functions `create_supplier_po`, `add_supplier_po_equipment`, `update_supplier_po_equipment_price` and `close_supplier_po` (`purchasing.manage`; stable tokens such as `po_closed`, `card_overlap`, `internal_price_must_be_zero`, `equipment_already_on_open_po`); reads need `purchasing.view`. No gate tests a role name. The two keys are the reserved 0126 keys, now `enforced_in = 'database'`, held by `admin` (in `role_permissions` and, as two added admin rows, in the frozen legacy mapping re-created from its 0130 body) and by the custom role `purchasing`. The purchasing screens (2026-10-19, after the owner approved their /ui-kit mockups): `/purchasing` (`src/screens/purchasing/SupplierPosListScreen.tsx`, unified list over `supplier_pos` with `supplierPosListConfig`) and `/purchasing/:id` (`SupplierPoDetail.tsx`, the approved detail-page pattern), the «المشتريات» card on the equipment page (`src/components/purchasing/EquipmentPurchasingCard.tsx`, renders nothing without `purchasing.view`), the dialogs in `src/components/purchasing/`, the data module `src/lib/purchasingData.ts` (selects + the four RPC wrappers; the screens never insert/update a purchasing table directly) and the pure labels / token mapping in `src/lib/purchasing.ts`. The sidebar has «المشتريات» as a parent with its sections (owner 2026-10-19), «اوامر الشراء» = `/purchasing/orders` first (`/purchasing` opens it); the page gates and the admin-shell pages are keyed on `purchasing.view` (`NAV_ENTRIES`, `PAGE_GATES`, `routePageOf`); the admin fallback menu lists the section because the admin holds the key in both mappings. Owner rule 2026-10-19 (migration 0137): a unit joins a PO only while it is INSIDE the PO's company and project right now — `add_supplier_po_equipment` checks the unit's latest movement (an open site ENTRY with the PO's company and project, token `equipment_not_at_po_project`), the add dialog offers only the open site visits of that company and project (`movement_visits`), and the card stores that entry in `equipment_cards.entry_log_id` automatically (no manual link, never overwritten). Nothing links sales to the card yet.
- Explicitly requested so far, and limited to exactly this: charts on the admin home only (Recharts, loaded lazily through `src/components/charts/lazy.tsx`; light token shades with dark readable text, never saturated fills), and WhatsApp movement notices between the workshop and site foremen through UltraMsg (migration 0110). Notices are sent server-side only, from fixed templates, to a recipient resolved in the database; a failed send never delays or fails a movement; the gateway credentials are server environment variables.
- Also explicitly requested (2026-10-08): Afaqy AVL tracking integration, admin only — the equipment carries `tracker_unit_id/name/linked_at` (migration 0122; one Afaqy unit per equipment), the server module `src/lib/server/afaqy.ts` talks to `https://api.afaqy.pro` with `AFAQY_USERNAME`/`AFAQY_PASSWORD` (server env only, token cached, never logged), the routes under `app/api/afaqy/*` require a permission key through `requirePermission` in `src/lib/server/adminRequest.ts` since wave 24 (`units`/`sync` → `settings.integrations`, `position` → `equipment.location.view`; it was `is_admin()` before), Settings › «ربط افاقي» auto-links units by the code in parentheses of the unit name `(A055) 8631 URA` (previous codes too; conflicts are reported, never overwritten without `force`), and the equipment detail/inquiry show the admin-only «الموقع الحالي» card (`EquipmentLocationCard`, 60 s server cache). No write endpoint of Afaqy is ever called.
- Roles and permissions system (owner decision 2026-10-11, waves 22A/22B; migrations 0126/0127): a permission catalogue (`permissions`), system and custom `roles`, `role_permissions`, one role per user in `profile_roles`, the audit `role_changes`, all written only through the admin-only functions of 0126 and managed in Settings › «الادوار والصلاحيات» (`/settings/roles`, `src/components/roles/**`, admin plus `settings.roles`, fail closed). It shipped INACTIVE, and the owner ENABLED it himself on 2026-10-12 from the roles page (the code still never changes the flag): the flag is `app_settings` row `roles_system` = `{"enabled": false}`, readable by every signed-in user and changed only by `set_roles_system_enabled`, which the roles page calls only when the admin presses the activation button after typing the confirmation word; it refuses while `admin_roles_system_offenders()` returns anyone. Never enable it from code, a migration or a default. While inactive, `has_permission()` answers from the frozen `legacy_role_permissions(profiles.role)` mapping, so nothing changes for anybody. `usePermissions()` (`src/auth/PermissionsContext.tsx`) loads `current_permissions()` after sign-in. Routing by permissions, step 1 (wave 23): the SIDEBAR / mobile drawer follows the permissions — `src/lib/navPermissions.ts` holds the item → permission-key table (`NAV_ENTRIES`; the sidebar exists only in the admin shell and lists the sections the permissions pass, the home entry needs `home.admin`, entries are any-of gates, reports children by `reports.view` scope) and `visibleNavItems(state, role, routable)`; `role` is ONLY the fallback while permissions load or after a failed load (the frozen pre-wave-23 role menus), an unknown role gets no sidebar, `reload()` re-renders it, and `tests/wave23Nav.test.cjs` proves the menu equals the old role menu for all six roles with the system off. Step 2 (wave 23, «تعديل اختيار الهيكل»): the SHELL / home and the page guards of src/App.tsx follow the permissions too — `planShell(state, role)` picks `home.admin` → the admin shell, else `home.foreman` → the foreman home (every scope = own-site list), else `home.workshop` → the workshop home (scope `all` = the managers' variant with the embedded admin log; App passes it as `HomeScreen`'s `movementsScope` prop), else (owner decision 2026-10-13) the admin shell WITHOUT its dashboard when any admin-shell section of `NAV_ENTRIES` passes (the sidebar lists exactly the passing sections and the user lands on the first one in menu order, e.g. `equipment.read` alone → «المعدات» only, landing `/equipment`; App.tsx replaces a URL the shell does not open, `/dashboard` included, with `shell.landing`), else the «لا توجد صلاحيات» page (fail closed). The field homes keep precedence and never have a sidebar. Every routable page has a gate in `pageGate(page)` (sidebar entries reuse `NAV_ENTRIES`; the dashboard needs `home.admin`; details, `movements/new`, `print/export` → `movements.export`, settings sub-pages) and a page whose gate fails renders the shell's landing page (its home, as an unknown URL always did; the first section in the dashboard-less admin shell). While permissions load or after a failed load the frozen pre-wave-23 role router (`LEGACY_SHELL_BY_ROLE`) decides; an unknown role waits on the bootstrap spinner while loading. `tests/wave23Shell.test.cjs` proves the shell and every rendered screen equal the 8f17f53 router for the six roles with the system off (one intended difference: the two workshop managers, who hold `movements.export`, now get the PDF print page their export dialog opens). Step 3 (wave 23, «شاشة المستخدمين والهيدر»): while the flag is ON the users list and the user page show and assign the roles-system role (`profile_roles`, the active roles of `roles`; the legacy select is hidden) and the header label under the name is the assigned role's name; `src/lib/userRoleAssignment.ts` derives the legacy `profiles.role` from the chosen role (`legacyRoleFor`: a system role is itself, a custom role keeps the current legacy role except admin → `monitor`, a new user → `monitor`) and plans the save (`planRoleChange`: the legacy change through `manage-user` / `create-user` only when the 0126 trigger accepts it, then `admin_assign_profile_role` when still needed); `PermissionsContext` reads the flag and the own assignment once and refreshes them in `reload()`. While the flag is OFF or unknown everything stays the legacy role exactly as before. Step 4 (wave 24, «الاجراءات حسب الصلاحيات»): the in-screen actions and data decisions follow the permissions too, through the pure functions of `src/lib/actionPermissions.ts` (`decideByPermissions`: the permissions once `ready`, the verbatim pre-wave-24 role rule only while loading or after a failed load) and `resolveHomeMovementsScope` in `src/lib/homeScope.ts` — MovementDetail (`movements.edit_delete`, `movements.site.driver_change` / `movements.photos.manage` by scope, `movements.site.contractor_code` on the user's own open site entry, `movements.photos.delete_any`), EntryExitForm (workshop form = `movements.workshop.create` without `movements.site.create`, every open visit = `movements.exit_cross_context` or `movements.site.create` scope `all`, `movements.notify_foreman`, `equipment.quick_create` by scope, `drivers.quick_create`, `lessors.quick_create`), HomeScreen (`movements.workshop.classify`), the users screens (`users.manage`), EquipmentFormDialog (`equipment.tracker_link` plus `settings.integrations`, `equipment.change_code`), EquipmentLocationCard (`equipment.location.view`) and the WhatsApp status (`settings.integrations`); `tests/wave24Actions.test.cjs` proves every decision equals the old role rule for the six roles with the system off. Server side (wave 24): the API routes decide by `has_permission()` with the caller's token through `requirePermission` (`whatsapp-status` → `settings.integrations`, `workshop-arrival` → `movements.notify_foreman`, Afaqy as above; the movement routes still read `profiles.role` only for early 403s, the database re-checks), and the Edge Functions `create-user` / `manage-user` require `has_permission('users.manage')` evaluated as the caller (anon key plus the caller's Authorization header; the service role only for the privileged writes). `map.view` was retired by migration 0130 (the projects map was cancelled 2026-10-14). The roles page, `/ui-kit` and App.tsx's route-loading skeleton still read `profiles.role`. `is_admin()` stays role-based, and admin parity holds: the `admin` role in `profile_roles` exists exactly for `profiles.role = 'admin'`.
- UI naming (owner decision 2026-10-03): the `site` movement context is called «المشاريع / مشروع» ("Projects / project") everywhere in the UI, including the WhatsApp notices. Database values, keys and code identifiers keep `site`.
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
  - `assistant_workshop_manager` / `workshop_manager`: workshop movements plus workshop classification and management views. Since 2026-10-11 (owner decision, wave 21) they READ every movement and visit, projects and workshop: their home's movements card is the admin log embedded (`LogsScreen`: context tabs المشاريع / الورشة / الكل opening on الورشة, the admin filter dialog, the visits/log views and their Excel export), gated by `homeMovementsScope` in `src/lib/homeScope.ts` (an unknown role falls back to the narrowest list). They still record and classify workshop movements only. All workshop roles already read both contexts in RLS (`select_entry_exit_logs` / `can_access_movement`, migration 0098); the plain `workshop` home stays workshop-only. The admin reports (`/reports/*`) stay admin-only.
  - `monitor`: read-only dashboard, logs, and movement details.
- Client-side role routing must fail closed: an unknown or missing role must never receive the admin interface.
- Roles are assigned only by trusted server paths (admin Edge Functions or admin-only database functions), never from user-editable signup metadata.
- Critical rules must be enforced in PostgreSQL/RLS, not only in React or API validation.
- Do not weaken `entry_exit_logs`, `entry_exit_photos`, Storage, drivers, or master-data RLS.
- Do not expose raw PostgreSQL or Supabase errors to users. Map known errors to safe, understandable UI messages.
- Views that expose protected data must use `security_invoker = true` unless a reviewed, narrowly-scoped `SECURITY DEFINER` function is required.
- For `SECURITY DEFINER` functions: set a fixed `search_path`, revoke public/anon execution, grant only the required authenticated role, and validate `auth.uid()`/role as appropriate.

## Movement invariants

- Valid sequence per equipment is strictly `ENTRY → EXIT → ENTRY → EXIT`. Since migration 0043 it is ONE chain per equipment across both movement contexts (`site` and `workshop`): a unit inside a site cannot enter the workshop until its site exit exists. An EXIT closes an ENTRY of its own context; only an admin may record an exit whose context differs from the open entry's (migration 0108).
- Every function that reads or changes the chain serialises on the sequence trigger's advisory key, `hashtextextended(equipment_id::text, 0)`, taking the row lock first when it locks a movement row.
- Reject `ENTRY → ENTRY`, `EXIT → EXIT`, and `EXIT` without a preceding valid `ENTRY`.
- Ordering is deterministic by `(recorded_at, id)`, including historical insertion and identical timestamps.
- Preserve per-equipment concurrency protection; do not replace database locking with frontend state.
- Site ENTRY requires equipment, independent company and project selections, a driver, and an actual movement date. The driver is mandatory again since 2026-10-05 (owner decision; it was optional from 2026-09-23, migration 0103): enforced by the form and the API, and by a BEFORE INSERT trigger once migration 0120 is applied. The admin Excel import is exempt, and driverless entries recorded while it was optional keep `driver_id` and `driver_name` NULL. The UI selects the date only and applies the current local time internally when saving. `company_projects` remains for future use and must not restrict current ENTRY creation. Workshop ENTRY/EXIT uses the limited workshop form and requires equipment plus at least one selected photo; it does not require company, project, or driver.
- A site EXIT requires its purpose, `exit_purpose` = `maintenance` (للصيانة) or `work_completed` (انتهاء عمل) (migrations 0111 and 0115): enforced by the API, the form and a BEFORE INSERT trigger. The admin Excel import is exempt and stores NULL; entries and workshop rows never carry a purpose; rows recorded before 0111 stay NULL and display a dash.
- EXIT inherits company, project, and contractor equipment code from the corresponding latest valid ENTRY. Site EXIT uses the latest current driver after any auditable driver changes made during the open visit.
- Store `driver_id` plus the `driver_name` snapshot. Legacy rows with only `driver_name` must keep displaying correctly. Display rule since 2026-10-11 (migration 0124): when a movement or driver change is linked to a driver record, screens and exports show the record's CURRENT `full_name` (`driver_full_name` on `movement_log_search` / `movement_visits`, `displayDriverName()` in `src/lib/driverDisplayName.ts`); the snapshot is only the fallback for id-less legacy rows and is never rewritten.
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

- Driver master fields: `full_name`, `id_number`, `mobile_number`, `nationality`, `employment_type`, `job_title`, `employee_number`.
- «الرقم الوظيفي» (`drivers.employee_number`, migration 0131, owner request 2026-10-14, EM-237) is optional, trimmed with a blank stored as NULL by the trigger `normalise_driver_employee_number`, at most 30 characters, and unique as `upper(btrim(employee_number))` (`drivers_employee_number_unique`); it appears in the driver form, the driver detail, the drivers list (column, server-side search, filter and sort) and the drivers Excel import (column `employee_number` or «الرقم الوظيفي», duplicates reported per row); Quick Create does not set it and the driver selectors do not search it.
- Only `full_name` is mandatory for a complete driver record. Quick Create intentionally requires `full_name` and `mobile_number`.
- Nationality and employment type values are controlled by database checks; update frontend lists and database constraints together.
- Employment type «مورد خارجي» (migration 0119) marks drivers of external-supplier equipment: `quick_create_driver` sets it in the database when the selected equipment's owner is `external_supplier`, and the drivers list hides it by default (a visible, removable default filter that keeps drivers with no employment type). Driver selectors never hide these drivers.
- Quick Create creates real relational records and auto-selects them. Keep its database functions narrowly scoped; it must not grant supervisors unrestricted master-data CRUD.
- Duplicate checks use driver mobile/ID, equipment plate number, and lessor name/mobile as appropriate.

## Equipment ownership

- `ownership_status` is presented as “Owner”: Al-Azani, Takween, third-party F, third-party B, or Other Owner (`external_supplier`).
- Ownership state is derived, not independently edited: Al-Azani is owned; every other classification is rented.
- The external supplier selector appears only for Other Owner and is optional. Every other owner choice clears `lessor_id`.
- Equipment code prefixes suggest classification in the UI: `A` → Al-Azani, `TK` → Takween, `F` → third-party F, `B` → third-party B, otherwise external supplier. Database fields remain the source of truth.
- Asset status `equipment.status` is `active` or `sold` only (migration 0125 retired `scrapped` and `rented_out`); the fleet predicate is `is_active AND status = 'active'`.
- Equipment state («الحالة», wave 20, migration 0125) is DERIVED, never stored or edited: from the unit's latest movement across both contexts (`(recorded_at, id)` order), site ENTRY = `working`, any EXIT = `available`, workshop ENTRY = its purpose (`maintenance` / `parking` / `out_of_service`) or `unclassified`, no movement = `available`. The one SQL definition is `equipment_state_from_movement()`, served as `admin_equipment_state.equipment_state` and as the PostgREST computed field `equipment_state(equipment)` (list, detail, update workbook); `src/lib/equipmentState.ts` mirrors it for the inquiry, which reads `get_last_movement`. The «جديدة» mark (`is_new`) is separate from the state: since migration 0129 (owner decision 2026-10-14, EM-236) it means the equipment row was CREATED within the last 7 days (`created_at >= now() - equipment_new_window()`, the window defined once in SQL; `EQUIPMENT_NEW_DAYS` / `isEquipmentNew()` mirror it for the inquiry), served as `admin_equipment_state.is_new` and the computed field `equipment_is_new(equipment)`, which the equipment list also filters server-side («جديدة» yes/no). It no longer means "no movement yet". The equipment list's owner filter is a multi-select (`in`, EM-235). The manual `equipment.operational_status` is retired: not shown, imported or written by the database (the column and `entry_exit_logs.previous_operational_status` stay unused); an import file that still carries it is accepted with a per-row note.
- The flag `equipment.master_data_complete` is retired from the UI (owner decision 2026-10-14, EM-236): no «بيانات غير مكتملة» badge, no filter, the admin form no longer sends it. The column stays in the database (default `true`; the quick-create functions still set it to `false`) like `operational_status`; do not reintroduce it in screens. Generated internal codes are short (`U001`, `U002`, ...), unique, and database-generated.

## Equipment code history

- Every change of `equipment.code` is recorded automatically in the append-only `equipment_code_changes` table (who, when, optional reason; migration 0114). The admin form changes a code through `admin_change_equipment_code`, which carries the reason; other paths (Excel update) are recorded with no reason.
- A previous code of one unit cannot be given to another unit (`equipment_code_previously_used`); a unit may get its own previous code back. Codes are compared as `upper(btrim(code))`.
- Equipment searches (the movement form RPCs, the inquiry suggestions, the equipment list) also match previous codes and mark such results «رقم سابق»; the detail and inquiry pages list «ارقام سابقة».

## Users and notices

- A user's mobile number lives in `profile_contacts` (migration 0113), readable only by an admin and by the user; it is written only by `admin_set_user_mobile`. Never add it to `profiles` or `profile_names`.
- WhatsApp notices (UltraMsg, migration 0110): «ابلاغ الفورمان» is available to the workshop roles and the admin for a unit still inside a project; the site exit and workshop exit notices are automatic. Recipients are resolved in the database, sends are rate-limited per site entry, logged in `movement_notices`, and never block a movement.

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
- Option loaders must throw on a failed query (use `unwrapRows` from `src/lib/supabaseResult.ts`) so the control shows its load error instead of "no results".
- Select only fields needed by the list or selector; avoid `select('*')` for large list queries.
- Detail pages show only 10–20 recent child records plus a “View All” route; do not embed a full DataList in details.
- Review query plans and add focused indexes in a new migration when adding common search/filter/sort paths.
- A filter field may depend on another through `FilterField.visibleWhen` (`{ field, includes }`): it is offered only while the controlling filter selects that value and is dropped from state and URL (`withoutHiddenFilters`) when it stops. First use (owner request 2026-10-15, migration 0132): the «المورد» filter of both `/logs` views (and the workshop managers' embedded copy), a server-side `in` multi-select over `lessors` (`SUPPLIER_FILTER_FIELD` in `src/lib/equipmentSupplier.ts`) shown only while the owner filter selects `external_supplier`; `movement_log_search` and `movement_visits` expose `equipment_lessor_id` / `equipment_lessor_name` (0124 verbatim plus two trailing columns and a `lessors` primary-key LEFT JOIN). The tables show the supplier as a muted line inside the equipment cell for «مالك اخر» units only; no column was added (owner: keep the tables narrow).

## UI conventions

- Arabic/RTL first, responsive, mobile-friendly, shadcn-style.
- A unified design system is being built. Components are approved by the product owner on the admin-only `/ui-kit` page before screens are migrated to them. Do not migrate screens to unapproved components.
- Approved palette (2026-09-15, compared on `/ui-kit` against three brand-colored directions): keep the current neutral black/white foundation with functional colors, defined as tokens in `src/index.css`. Primary actions and active navigation are monochrome (black in light mode, white in dark mode). No gradients.
- Shared components are built on Radix Primitives (the unstyled `radix-ui` package) and styled entirely with project tokens. `I18nProvider` supplies the Radix direction provider, so do not pass `dir` to individual primitives.
- Use CSS variable tokens (through the Tailwind theme) for colors, borders, and surfaces. Do not hardcode Tailwind palette colors (`gray-*`, `emerald-*`, and so on) or hex values in screens.
- Do not apply letter-spacing (`tracking-*`) or `uppercase` to Arabic text; it breaks letter joining.
- Use logical direction utilities (`ms-`, `me-`, `ps-`, `pe-`, `start-`, `end-`, `text-start`) instead of left/right.
- Approved control height (2026-09-16): shared buttons and inputs are 40 px on mobile (below 768 px) and 36 px from 768 px up, with 14 px text at weight 400 (`size="sm"` is 28 px for tables and toolbars). Legacy `.btn-*`/`.input` screens stay 32 px until they are migrated to the shared components. Large textareas, image areas, plate UI, and primary scanning areas may remain larger when functionally necessary.
- Use green for ENTRY/success and amber for EXIT/warnings; use red only for errors/destructive actions. Show ENTRY/EXIT through the shared status badge rather than ad hoc colors.
- Dark theme must keep text contrast accessible.
- Report and dashboard day boundaries use Saudi time (UTC+03:00), not the browser's local timezone.
- Show a visible error state when data fails to load; never render a load failure as an empty "no data" state.
- Use the translation system in `src/i18n/translations.ts`; add Arabic and English keys together. Avoid hardcoded user-facing strings in reusable UI.
- Form validation (owner decision 2026-10-10): rules live as Zod schemas in `src/lib/formValidation.ts` (one schema per form, messages are translation keys); forms call `validateWithSchema` on submit, show the message under the field, focus the first invalid field, and map database errors to the responsible field with `mapDatabaseErrorToField` before falling back to a form-level message. Rules stay lenient: tell the user which field is wrong and why, do not over-restrict. No react-hook-form or resolver packages.
- Mobile form controls must remain at least 16 px font size to prevent iOS focus zoom.
- Detail-page pattern (owner approved 2026-10-19 on /ui-kit, first built for the supplier PO page in `src/screens/ui-kit/PurchasingMockup.tsx`, `PoPageMockupV2`; the existing detail pages are migrated to it one by one, each on the owner's go): (1) a header card with the identifier and its status badge, the key counterpart name on its own line (for purchasing the SUPPLIER NAME, never truncated or mixed with the project — «شغل المشتريات 99% منه مع الموردين»), a small meta line (dates, created by, closed at), and the actions at the end on desktop; (2) a summary strip of two or three `StatCard`s, no «last activity» card; (3) a body that splits from `xl` into the main record list (two thirds) beside the facts (`DescriptionList` with icons) and an event timeline, stacked in that order below; (4) the record list is a list of WIDE CARDS on every screen (identity at the start, counterpart / period / note in the middle, the amount in a fixed-width end block so amounts line up, a total card closing the list), sorted through a «الترتيب» select plus a direction button, not column headers; (5) on mobile the primary actions sit in a bar at the bottom (44 px targets, safe-area padding). Amounts show the official riyal symbol (`RiyalSign` in `src/components/ui`, currentColor, named for screen readers) after the digits, and a price field shows the formatted amount as its hint while typing.

## Working rules

- Inspect the current implementation and latest migrations before changing related behavior.
- Preserve unrelated user changes in a dirty worktree. Do not reset, discard, or rewrite them.
- Use `rg`/`rg --files` for discovery and `apply_patch` for manual file edits.
- Do not add a production dependency unless the task clearly needs it; ask first when the dependency is heavy or materially changes the architecture.
- Keep server/API payloads minimal, validate at both UX and database/server boundaries, and avoid logging secrets or sensitive data.
- Do not start a local or remote data mutation merely to test unless the user has provided a dedicated test account/environment or explicitly authorized production test records.
- For database changes: inspect migration history, add a forward migration, apply it to the linked project when authorized, run linked DB lint, and verify local/remote migration history.
- Work on the `main-home` branch. After each completed task, when checks pass, commit the scoped changes by explicit paths. Push `main-home`, and fast-forward `main` (production, deployed by Vercel) from it, only when the product owner asks.
- Another agent works on the identity-extraction / ERPNext feature in the same checkout: never edit or stage `src/screens/Extracting.tsx`, `src/components/extracting/**`, `src/lib/extracting/**` or `app/api/extracting/**`. One owner-approved exception (2026-10-12): the access gate of that feature is the permission `extracting.view` (migration 0128) — the page checks `usePermissions().can('extracting.view')` (fail closed to the legacy admin role after a failed load) and the routes under `app/api/extracting/*` call `requireExtractingAccess` (`has_permission('extracting.view')` with the caller's token) from `src/lib/extracting/server.ts`. Second owner-approved exception (2026-10-18, security audit lead E-19): the publish route's `create` mode refuses an existing ERPNext Employee (`erp_employee_exists`) and an existing ERPNext User (`erp_user_exists`); linking a login to an existing Employee is the admin's `update` mode only (`app/api/extracting/publish/route.ts`, `src/lib/extracting/messages.ts`, the two translation keys, and the static test in `tests/extracting-publish.test.cjs`).
- Rollout order for database changes: apply a migration before deploying UI that depends on it. When a new database requirement would break the UI that is live, ship the requirement in a later migration applied after the new UI is deployed (as 0111 then 0115 did).
- The product owner applies migrations (`npx supabase db push --linked`); afterwards verify with `npx supabase migration list --linked` and `npx supabase db lint --linked --level error`. New migrations can be syntax-checked locally with the `libpg-query` parser (parse plus `parsePlPgSQL` for each function body).

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
