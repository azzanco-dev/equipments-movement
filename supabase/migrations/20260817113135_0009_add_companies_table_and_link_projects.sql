/*
# Add Companies table and link Projects to Companies

## Summary
This migration creates a new `companies` table to represent construction/contracting companies
that the equipment rental business leases to. Each company can have multiple projects.
The existing `projects` table is updated to reference a company via `company_id` instead of
the free-text `company` column. The old `company` text column is kept for backward compatibility
(no data loss), but new writes should use `company_id`.

## New Tables
- `companies`
  - `id` (uuid, primary key)
  - `name_ar` (text, not null) — company name in Arabic
  - `name_en` (text, not null) — company name in English
  - `created_at` (timestamptz, default now())

## Modified Tables
- `projects`
  - Added `company_id` (uuid, nullable, references `companies(id)` ON DELETE SET NULL)
  - The existing `company` text column remains but is no longer the primary way to associate
    a project with a company. New code should use `company_id`.

## Security
- RLS enabled on `companies`.
- CRUD policies for `authenticated` role (admin-only app with sign-in).
- Same 4-policy pattern (select/insert/update/delete) scoped to authenticated.

## Notes
1. The `company` text column on `projects` is NOT dropped — existing data is preserved.
2. A unique index is added on `companies(name_ar)` and `companies(name_en)` to prevent duplicates.
*/

-- ============ COMPANIES ============
CREATE TABLE IF NOT EXISTS companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name_ar text NOT NULL,
  name_en text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE companies ENABLE ROW LEVEL SECURITY;

CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_ar ON companies(lower(name_ar));
CREATE UNIQUE INDEX IF NOT EXISTS idx_companies_name_en ON companies(lower(name_en));

-- RLS policies for companies (authenticated only — app has sign-in)
DROP POLICY IF EXISTS "select_companies" ON companies;
CREATE POLICY "select_companies" ON companies FOR SELECT
  TO authenticated USING (true);

DROP POLICY IF EXISTS "insert_companies" ON companies;
CREATE POLICY "insert_companies" ON companies FOR INSERT
  TO authenticated WITH CHECK (true);

DROP POLICY IF EXISTS "update_companies" ON companies;
CREATE POLICY "update_companies" ON companies FOR UPDATE
  TO authenticated USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "delete_companies" ON companies;
CREATE POLICY "delete_companies" ON companies FOR DELETE
  TO authenticated USING (true);

-- ============ PROJECTS: add company_id ============
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'projects' AND column_name = 'company_id'
  ) THEN
    ALTER TABLE projects ADD COLUMN company_id uuid REFERENCES companies(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_projects_company_id ON projects(company_id);
