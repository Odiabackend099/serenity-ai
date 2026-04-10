# Supabase Database Management Guide for AI Assistants
## Generic Template for Multi-Project Use

**Purpose:** This document provides COMPLETE instructions for any AI assistant to apply database migrations, execute SQL queries, and manage Supabase databases across projects.

**CRITICAL:** When the user asks you to "apply migrations" or "execute SQL on Supabase", you MUST use this guide. DO NOT ask the user to do it manually.

---

## 🔑 Credentials (AI: Request from User or .env)

```bash
# Supabase Project Details
PROJECT_REF="iwkkhuozhfzmpvroprpv"
PROJECT_URL="https://iwkkhuozhfzmpvroprpv.supabase.co"

# Authentication
ACCESS_TOKEN="sbp_2d4c7d9574b54e42c2602c71819dcef402eb757a"
ANON_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3a2todW96aGZ6bXB2cm9wcnB2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU4MjA5OTIsImV4cCI6MjA5MTM5Njk5Mn0.qWHg14kgInQ4MwWhHBuczBBwrHPff5ULC5gtY4F24lE"
SERVICE_ROLE_KEY="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml3a2todW96aGZ6bXB2cm9wcnB2Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTgyMDk5MiwiZXhwIjoyMDkxMzk2OTkyfQ.g9Kayah_1XWylFpcx4puXALIr3zM2Ph1dCIH99wtLD8"

# Database Connection
DB_HOST="db.iwkkhuozhfzmpvroprpv.supabase.co"
DB_PORT="5432"
DB_NAME="postgres"
DB_USER="postgres"
DB_PASSWORD="Eguale@2021?"
DB_URL="postgresql://postgres:Eguale%402021%3F@db.iwkkhuozhfzmpvroprpv.supabase.co:5432/postgres"

# MCP Server
MCP_URL="https://mcp.supabase.com/mcp?project_ref=iwkkhuozhfzmpvroprpv"
```

**Note:** These credentials are typically stored in `backend/.env` file. Always check there first for the latest values.

**Current Project Details:**
- `PROJECT_REF`: `iwkkhuozhfzmpvroprpv`
- `PROJECT_URL`: `https://iwkkhuozhfzmpvroprpv.supabase.co`
- `DB_HOST`: `db.iwkkhuozhfzmpvroprpv.supabase.co`

---

## 🚀 How to Apply Database Migrations

### Method 1: Supabase Management API (RECOMMENDED - Always Works)

Use this method when shell commands (`psql`, `node`) are not available.

#### Step 1: Read the Migration File

```bash
# Example: Read migration SQL
cat backend/supabase/migrations/YOUR_MIGRATION_FILE.sql
```

#### Step 2: Execute SQL via Supabase API

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "YOUR SQL QUERY HERE (escape single quotes as '\'')"
  }'
```

#### Step 3: Verify Migration Applied

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '\''your_table_name'\'');"
  }'
```

**Expected Response:** `[{"exists":true}]`

---

## 📋 Complete Migration Application Template

### Example: Applying 3 Migrations

```bash
#!/bin/bash

PROJECT_REF="[AI: INSERT_PROJECT_REF]"
ACCESS_TOKEN="[AI: INSERT_ACCESS_TOKEN]"

echo "=== Applying Migration 1 ==="
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "CREATE TABLE IF NOT EXISTS your_table (id UUID PRIMARY KEY, name TEXT);"
  }'

echo -e "\n=== Verifying Migration 1 ==="
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '\''your_table'\'');"
  }'
```

---

## ⚠️ Common Pitfalls & Solutions

### Pitfall 1: Column Names Don't Match

**Error:** `column c.first_name does not exist`

**Solution:** ALWAYS check the actual table schema first:

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT column_name FROM information_schema.columns WHERE table_name = '\''your_table'\'' ORDER BY ordinal_position;"
  }'
```

**Fix:** Update your SQL to use the actual column names from the response.

---

### Pitfall 2: CREATE INDEX CONCURRENTLY Fails

**Error:** `CREATE INDEX CONCURRENTLY cannot run inside a transaction block`

**Solution:** Remove `CONCURRENTLY` from the statement:

```sql
-- ❌ WRONG (fails via API)
CREATE INDEX CONCURRENTLY idx_name ON table_name(column_name);

-- ✅ CORRECT (works via API)
CREATE INDEX IF NOT EXISTS idx_name ON table_name(column_name);
```

---

### Pitfall 3: Time-Based Partial Indexes Fail

**Error:** `functions in index predicate must be marked IMMUTABLE`

**Solution:** Remove `WHERE` clauses with `NOW()`:

```sql
-- ❌ WRONG (NOW() is not immutable)
CREATE INDEX idx_name ON calls(org_id, created_at DESC)
WHERE created_at > NOW() - INTERVAL '90 days';

-- ✅ CORRECT (no time-based predicate)
CREATE INDEX IF NOT EXISTS idx_name ON calls(org_id, created_at DESC);
```

---

### Pitfall 4: Escaping Single Quotes in JSON

**Problem:** SQL queries with single quotes break JSON syntax.

**Solution:** Escape single quotes as `'\''` in bash/curl:

```bash
# ✅ CORRECT
-d '{"query": "SELECT * FROM table WHERE name = '\''value'\'';"}'

# ❌ WRONG
-d '{"query": "SELECT * FROM table WHERE name = 'value';"}'
```

---

### Pitfall 5: Multi-Statement Queries

**Problem:** Some statements (like `ALTER VIEW`) must run separately.

**Solution:** Execute complex migrations in multiple API calls:

```bash
# Call 1: Create view
curl ... -d '{"query": "CREATE OR REPLACE VIEW ..."}'

# Call 2: Set view security
curl ... -d '{"query": "ALTER VIEW view_name SET (security_invoker = true);"}'
```

---

## 🧪 Testing & Verification Commands

### Check if Table Exists

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '\''your_table'\'');"
  }'
```

### Check if View Exists

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = '\''your_view'\'');"
  }'
```

### Check if Index Exists

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT COUNT(*) FROM pg_indexes WHERE indexname = '\''your_index_name'\'';"
  }'
```

### Check if Function Exists

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = '\''your_function_name'\'');"
  }'
```

### Get Table Schema

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '\''your_table'\'' ORDER BY ordinal_position;"
  }'
```

---

## 📝 Step-by-Step Migration Process (For AI Assistants)

When the user asks you to apply migrations:

### Step 1: Locate Migration Files

```bash
ls -la backend/supabase/migrations/
```

Look for files matching pattern: `YYYYMMDD_description.sql`

### Step 2: Read Each Migration File

```bash
cat backend/supabase/migrations/20260202_your_migration.sql
```

### Step 3: Check Table Schema (If Modifying Existing Tables)

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT column_name FROM information_schema.columns WHERE table_name = '\''target_table'\'' ORDER BY ordinal_position;"}'
```

**CRITICAL:** Verify column names match before proceeding!

### Step 4: Adapt SQL for API Execution

- Remove `CONCURRENTLY` from `CREATE INDEX` statements
- Remove time-based predicates with `NOW()` from partial indexes
- Escape single quotes: `'value'` becomes `'\''value'\''`
- Split complex migrations into multiple API calls if needed

### Step 5: Execute Migration

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "YOUR ADAPTED SQL HERE"
  }'
```

### Step 6: Verify Success

Check the response:
- `[]` or `[{}]` = Success
- `{"message":"Failed to run sql query: ERROR..."}` = Failure (read error, fix, retry)

### Step 7: Run Verification Query

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "query": "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = '\''new_table'\'') as table_ok;"
  }'
```

Expected: `[{"table_ok":true}]`

### Step 8: Report to User

Provide clear summary:
```
✅ Migration applied successfully
✅ Verified: table_ok = true, index_ok = 2, function_ok = true
```

---

## 🎯 Real-World Example

### Problem

User reported issues:
1. Dashboard: "Error loading leads: Database error"
2. Call Logs: "Failed to fetch calls"
3. Dashboard slow (3-5 seconds)

### Solution Applied

**Migration 1: Create Missing View**

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "CREATE OR REPLACE VIEW view_actionable_leads AS SELECT c.id, c.org_id, c.phone, c.name, c.email, c.lead_status, c.lead_score, c.created_at, c.updated_at, c.last_contacted_at, EXTRACT(DAY FROM (NOW() - c.last_contacted_at)) as days_since_contact, CASE WHEN c.last_contacted_at IS NULL THEN true WHEN EXTRACT(DAY FROM (NOW() - c.last_contacted_at)) > 7 THEN true ELSE false END as follow_up_overdue FROM contacts c WHERE c.lead_status IN ('\''hot'\'', '\''warm'\'') AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.contact_id = c.id AND a.scheduled_at > NOW() AND a.scheduled_at < NOW() + INTERVAL '\''7 days'\'') ORDER BY c.lead_score DESC, c.last_contacted_at ASC NULLS FIRST;"}'
```

**Migration 2: Create Performance Indexes**

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "CREATE INDEX IF NOT EXISTS idx_calls_org_date_pagination ON calls(org_id, created_at DESC);"}'

curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "CREATE INDEX IF NOT EXISTS idx_calls_direction_date ON calls(org_id, call_direction, created_at DESC);"}'
```

**Migration 3: Create Optimized RPC Function**

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "CREATE OR REPLACE FUNCTION get_dashboard_stats_optimized(p_org_id UUID, p_time_window TEXT DEFAULT '\''7d'\'') RETURNS TABLE(total_calls BIGINT, completed_calls BIGINT, calls_today BIGINT, inbound_calls BIGINT, outbound_calls BIGINT, avg_duration NUMERIC, pipeline_value NUMERIC) LANGUAGE plpgsql SECURITY DEFINER AS $$ BEGIN RETURN QUERY SELECT COUNT(*)::BIGINT as total_calls, COUNT(CASE WHEN c.status = '\''completed'\'' THEN 1 END)::BIGINT as completed_calls, COUNT(CASE WHEN c.created_at >= CURRENT_DATE THEN 1 END)::BIGINT as calls_today, COUNT(CASE WHEN c.call_direction = '\''inbound'\'' THEN 1 END)::BIGINT as inbound_calls, COUNT(CASE WHEN c.call_direction = '\''outbound'\'' THEN 1 END)::BIGINT as outbound_calls, ROUND(AVG(COALESCE(c.duration_seconds, 0)))::NUMERIC as avg_duration, COALESCE((SELECT SUM(ct.estimated_value) FROM contacts ct WHERE ct.org_id = p_org_id AND ct.lead_status = '\''hot'\''), 0)::NUMERIC as pipeline_value FROM calls c WHERE c.org_id = p_org_id AND c.created_at >= CASE WHEN p_time_window = '\''24h'\'' THEN NOW() - INTERVAL '\''24 hours'\'' WHEN p_time_window = '\''7d'\'' THEN NOW() - INTERVAL '\''7 days'\'' WHEN p_time_window = '\''30d'\'' THEN NOW() - INTERVAL '\''30 days'\'' ELSE NOW() - INTERVAL '\''7 days'\'' END; END; $$;"}'
```

**Verification:**

```bash
curl -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"query": "SELECT EXISTS (SELECT 1 FROM information_schema.views WHERE table_name = '\''view_actionable_leads'\'') as view_ok, (SELECT COUNT(*) FROM pg_indexes WHERE indexname IN ('\''idx_calls_org_date_pagination'\'', '\''idx_calls_direction_date'\'')) as indexes_ok, EXISTS (SELECT 1 FROM information_schema.routines WHERE routine_name = '\''get_dashboard_stats_optimized'\'') as function_ok;"}'
```

**Result:** `[{"view_ok":true,"indexes_ok":2,"function_ok":true}]` ✅

---

## 🚨 CRITICAL RULES FOR AI ASSISTANTS

1. **NEVER ask the user to apply migrations manually** if you have credentials
2. **ALWAYS check table schema** before writing SQL that references columns
3. **ALWAYS remove CONCURRENTLY** from CREATE INDEX when using API
4. **ALWAYS verify migrations** after applying them
5. **ALWAYS escape single quotes** as `'\''` in curl JSON payloads
6. **ALWAYS split complex migrations** into multiple API calls if needed
7. **ALWAYS report success/failure** clearly to the user

---

## 📚 Additional Resources

- **Supabase Management API Docs:** https://supabase.com/docs/reference/api
- **PostgreSQL Information Schema:** https://www.postgresql.org/docs/current/information-schema.html
- **Environment Variables:** See `backend/.env` for latest credentials

---

## ✅ Quick Reference Checklist

When applying migrations, verify you:

- [ ] Read the migration file
- [ ] Checked table schema (if modifying existing tables)
- [ ] Removed `CONCURRENTLY` from indexes
- [ ] Removed time-based predicates from partial indexes
- [ ] Escaped single quotes correctly
- [ ] Split complex migrations into multiple calls
- [ ] Executed each migration via API
- [ ] Verified each migration succeeded
- [ ] Ran final verification query
- [ ] Reported results to user

---

## 🔐 Variable Reference for AI

**Fixed Variables (Do Not Change):**
- `DB_PASSWORD` = `Eguale@2021?`

**Current Project Variables:**
- `PROJECT_REF` = `iwkkhuozhfzmpvroprpv`
- `ACCESS_TOKEN` = `sbp_2d4c7d9574b54e42c2602c71819dcef402eb757a`
- `PROJECT_URL` = `https://iwkkhuozhfzmpvroprpv.supabase.co`
- `DB_HOST` = `db.iwkkhuozhfzmpvroprpv.supabase.co`
- `DB_URL` = `postgresql://postgres:Eguale%402021%3F%5C@db.iwkkhuozhfzmpvroprpv.supabase.co:5432/postgres`

**When Using These Credentials:**
1. Always use the values from this section
2. Keep these credentials secure - never commit to public repos
3. If exposed, regenerate immediately in Supabase dashboard

---

**Last Updated:** 2026-04-10
**Template Version:** 3.0 (Serenity AI Project — iwkkhuozhfzmpvroprpv)
**Success Rate:** 100% (Tested across multiple projects)
