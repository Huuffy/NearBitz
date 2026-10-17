-- Migration 010: Add mca_master to company_source enum
-- Run after migration 009.

ALTER TYPE company_source ADD VALUE IF NOT EXISTS 'mca_master';
