# JeevanSetu Backend API Service

JeevanSetu ("Bridge of Life") is a progressive, scalable healthcare and education outreach platform designed to coordinate and track welfare programs across rural and urban communities. The platform connects community institutions like **Anganwadi Centers (AWCs)**, **Schools**, and **Health Centers** with beneficiaries (pregnant women, infants, children, and families).

This backend service is built using **NestJS** and **TypeScript**, leveraging **Prisma ORM** with **PostgreSQL** for data management, **Passport.js & JWT** for Role-Based Access Control (RBAC), **Docker** for containerization, and **Nginx** as a reverse proxy with SSL certificate management.

---

## Table of Contents
1. [Core Features](#core-features)
2. [System Architecture & Modules](#system-architecture--modules)
3. [Database Schema Entities](#database-schema-entities)
4. [Role-Based Access Control (RBAC)](#role-based-access-control-rbac)

---

## Core Features

- **Multi-Tenant / Role-Based Portals**: Tailored interfaces and API access controls for Super Admins, Admins, Managers, Analysts, and Outreach Workers.
- **Geographic Hierarchies**: Deep mapping of Indian states, districts, blocks, and villages to organize service delivery.
- **Institution Management**: Unified tracking and monitoring of Anganwadi Centers (AWC), Primary Health Centers, and Schools.
- **Beneficiary Lifecycle Tracking**: Rich demographics, marital status histories, income profiling, family members, and children's welfare tracking.
- **Outreach Workflows**: Programmed activity reporting, sessions tracking, group scheduling, and real-time beneficiary attendance.
- **Worker Management & Auditing**:
  - **Account Sharing (`AccountShare`)**: Enables managers to safely delegate field worker accounts to other active workers.
  - **Approval Requests (`ApprovalRequest`)**: Administrative control over profile updates and critical database edits.
  - **Audit Logging (`AuditLog`)**: Comprehensive tracking of data changes, storing before/after snapshots for audits.
- **Advanced Analytics Dashboards**: In-depth analytics for Coverage Metrics, Activity Demographics, and Outreach Dynamics.

---

## System Architecture & Modules

The backend is modularized under the `src/` directory. Each module follows NestJS design patterns with custom controllers, services, modules, and DTOs:

### 1. Authentication Module
- **Code Directory**: [src/auth](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/src/auth)
- **Features**: 
  - JWT-based authentication using Passport.js.
  - Role decorators ([roles.decorator.ts](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/src/auth/roles.decorator.ts)) and guard ([roles.guard.ts](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/src/auth/roles/roles.guard.ts)) for endpoint protection.
  - User verification, login endpoint (`/auth/login`), and profile extraction (`/auth/me`).

### 2. User Management Module
- **Code Directory**: [src/users](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/src/users)
- **Features**:
  - Administrative control over user creation (Admins, Managers, Analysts).
  - Smart `usercode` generation based on roles.
  - Assigning users to projects and specific states.
  - De-allocating users and updating statuses (Active/Deactivated).
  - Super Admin Dashboard API for platform-wide metrics.

### 3. Project Management Module
- **Code Directory**: [src/projects](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/src/projects)
- **Features**:
  - Projects configuration (Create, read, update, soft delete).
  - Tracking project statuses (Active/Suspended).
  - Access control for checking projects assigned to specific user IDs.

### 4. Locations & Cluster Module
- **Code Directory**: [src/locations](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/src/locations)
- **Features**:
  - Hierarchical geolocations retrieval (States $\rightarrow$ Districts $\rightarrow$ Blocks $\rightarrow$ Villages).
  - Support for custom block and village creation.
  - State project mapping (Assigning states to project instances).
  - Unified Institution creation (Anganwadi Center, School, Health Center).
  - Institution metadata updates and status deactivation.

### 5. Admin Module
- **Code Directory**: [src/admin](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/src/admin)
- **Features**:
  - Admin-specific dashboard.
  - Activity configuration (Create, update, activate/deactivate outreach activities).
  - Session scheduling and mapping sessions to activities.
  - Group-Activity tagging.
  - Review, approval, and rejection of beneficiary profile modification requests from Managers.

### 6. Manager Module
- **Code Directory**: [src/manager](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/src/manager)
- **Features**:
  - Manager dashboard metrics (active workers, pending updates, reports).
  - Adding, updating, activating, and deactivating Outreach Workers under their command.
  - Assigning project-location targets to Outreach Workers.
  - Account sharing delegation logic (`shareAccount` & `revokeShare`).
  - Requesting beneficiary updates from higher Admins.
  - Family member and beneficiary reports tracking.

### 7. Outreach Worker Module
- **Code Directory**: [src/outreach](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/src/outreach)
- **Features**:
  - Field workflows: Registering new beneficiaries and their family members.
  - Submitting activity reports (storing structured JSON dynamic telemetry data).
  - Joining beneficiaries/children into specialized groups.
  - Attendance check-ins for activities and sessions.
  - Personal request trackers (raising field update queries, canceling requests).
  - Field worker dashboard metrics.

### 8. Analyst Module
- **Code Directory**: [src/analyst](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/src/analyst)
- **Features**:
  - Analytical data querying endpoints.
  - Aggregating dashboard stats filtered by Project, Activity, Session, Admin, Manager, Worker, State/District, and Date ranges.
  - Providing outreach dynamics details, demographics distributions, and user trends.

### 9. Dashboard Service Components
- **Code Directory**: [src/dashboard](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/src/dashboard)
- **Sub-modules**:
  - **Coverage Dashboard Service** ([coverage-dashboard.service.ts](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/src/dashboard/coverage-dashboard/coverage-dashboard.service.ts)): Computes beneficiary demographics distributions, coverage trends over months, unique participant metrics, and institutions stats.
  - **Outreach Dynamics Service** ([outreach-dynamics.service.ts](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/src/dashboard/outreach-dynamics/outreach-dynamics.service.ts)): Analyzes active outreach patterns, worker performance logs, cohort sizes, and longitudinal interaction rates.

---

## Database Schema Entities

The database schema ([schema.prisma](file:///c:/Users/Aditya/Desktop/PROJECTS/JeevanSetu/backend/prisma/schema.prisma)) is modeled using PostgreSQL. Key schema structures include:

- **State / District / Block / Village**: The geographical location tables.
- **User & Roles (RBAC)**: Supports roles (`SUPER_ADMIN`, `ADMIN`, `MANAGER`, `OUTREACH`, `ANALYST`) and maps them using `UserRole` mappings.
- **Project**: Represents a central program. Projects map to locations and institutions.
- **Institutions (`Awc`, `School`, `HealthCenter`)**: Entities representing the physical locations of service delivery.
- **Beneficiary & BeneficiaryChild**: Track detailed data profiles. Beneficiaries can belong to groups (`BeneficiaryGroup`) through `GroupMember` and `ChildGroupMember` associations.
- **Activity & Session**: Programs run at institutions. Activities represent a type of program (e.g., vaccination drive, primary education sessions), and Sessions are specific occurrences.
- **ActivityReport**: Telemetry data collected during outreach sessions, saved as dynamic JSON.
- **ApprovalRequest**: Workflow queue for review of sensitive operations.
- **AuditLog**: Automagically logs edits of critical resources with old and new values.
- **AccountShare**: Tracks delegation of active credentials between outreach workers.

---

## Role-Based Access Control (RBAC)

The system enforces strict RBAC rules. Here is a matrix of general capabilities:

| Role | Core Purpose & Operations |
| :--- | :--- |
| **SUPER_ADMIN** | System-wide configuration: Creates Admins & Analysts, assigns projects, global status management. |
| **ADMIN** | Program administration: Creates Managers, configures Activities/Sessions, approves/rejects manager-forwarded profile updates. |
| **MANAGER** | Regional management: Creates and monitors Outreach Workers, assigns field tasks, handles worker account sharing, requests beneficiary edits. |
| **OUTREACH** | Field execution: Performs registrations, records session attendance, logs dynamic JSON activity reports. |
| **ANALYST** | Read-only analytics: Inspects coverage, generates demographic cohorts, reviews outreach dynamics. |

---