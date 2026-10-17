-- Migration 012: Add founded_year to companies (parsed from MCA incorporation date)
ALTER TABLE companies ADD COLUMN IF NOT EXISTS founded_year SMALLINT;
