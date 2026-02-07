# Database Schemas Documentation

This document provides references to the database schemas used in the Sloth system.

**IMPORTANT:** For the latest schema definitions, always refer to the SQL files directly. This document provides context and relationships only.

---

## Schema Locations

### Central Schema (sloth_central_schema)
**Location:** `db/central/`

**Files:**
- `0_sloth_central.sql` - Schema definitions (CREATE TABLE statements)
- `1_sloth_central_dml.sql` - Initial data (INSERT statements)

**Purpose:** Multi-tenant hub data for managing local instances and desktop app distribution

**Key Tables:**
- `tblmanagers` - Manager/company registration with portal paths
- `tblusers` - Desktop app users mapped to managers
- `tblapikeys` - API keys for local instance authentication
- `tbldesktopappinstallers` - OS-specific desktop app installer files
- `tbladmins` - Central system administrators

**Relationships:**
- `tblusers.managerID` → `tblmanagers.managerID` (one-to-many)

---

### Local Schema (sloth_schema)
**Location:** `db/local/`

**Files:**
- `0_sloth_local.sql` - Schema definitions (CREATE TABLE statements)
- `1_sloth_local_dml.sql` - Initial data (INSERT statements)
- `2_codolis_data.sql` - Sample/demo data

**Purpose:** Company management data (one schema per local instance)

**Key Table Groups:**

**Company & Settings:**
- `tblcompanies` - Company profile information
- `tblsettings` - Global application settings (singleton table)

**Employee Management:**
- `tblemployees` - Employee profiles with embeddable components (system, personal, organizational, address, education)

**Projects & Clients:**
- `tblprojects`, `tblclients`, `tblteams`, `tblactivities`

**Time Tracking:**
- `tblrealizations` - Time entries with status workflow (CREATED → PENDING → ACCEPTED/REJECTED)

**Absence Management:**
- `tblabsences`, `tblabsencetypes`, `tblabsencetypeemployeeconfig`

**Session Tracking (Desktop App Data):**
- `tblsessions`, `tblscreenshots`, `tblprocesses`, `tblevents`

**Collaboration:**
- `tblnotifications`, `tbltodos`, `tbldocuments`, `tblequipment`

**Security:**
- `tblrefreshtokens` - JWT refresh tokens

**Major Relationships:**
- Realizations: `tblemployees` ← `tblrealizations` → `tblprojects`, `tblactivities`
- Absences: `tblemployees` ← `tblabsences` → `tblabsencetypes`
- Sessions: `tblemployees` ← `tblsessions` ← `tblscreenshots`, `tblprocesses`
- Projects: `tblclients` ← `tblprojects`

---

## Elasticsearch Indexes (Local Only)

**Purpose:** Full-text search for specific entities

**Documents:**
- `todos` index → `TodoDocument` (mapped from `tbltodos`)
- `documents` index → `DocumentDocument` (mapped from `tbldocuments`)
- `notifications` index → `NotificationDocument` (mapped from `tblnotifications`)

**Configuration:** See `Sloth Web/Sloth-Local/src/main/java/com/codolis/sloth/search/`

---

## Schema Evolution

**Migration Strategy:**
- Manual SQL scripts for now (future: Flyway/Liquibase integration)
- Always backup before schema changes
- Test migrations in development environment first

**Version Control:**
- Central: Schema version tracked in application (future enhancement)
- Local: `settingsVersion` in `tblsettings` table

---

## Quick Reference

### To view schemas:
```bash
# Central schema
cat db/central/0_sloth_central.sql

# Local schema
cat db/local/0_sloth_local.sql
```

### To initialize databases (Docker):
```bash
# Start Docker containers (auto-initializes from db/ folders)
docker-compose up -d

# Access MySQL Central
docker exec -it <container_name> mysql -u sloth -p sloth_central_schema

# Access MySQL Local
docker exec -it <container_name> mysql -u sloth -p sloth_schema
```

### To search for specific tables/columns:
```bash
# Find table definition
grep -A 20 "CREATE TABLE.*tblemployees" db/local/0_sloth_local.sql

# Find column usage
grep "employeeID" db/local/0_sloth_local.sql
```

---

Last Updated: 2025-11-20
