# Munet-web — Architecture Audit + Gap Analysis

**Date:** 2026-04-26
**Scope:** Frontend + Backend + AWS, gap analysis against panel restructure + public-site map requirements

---

## 1. As-Is Architecture

### 1.1 Frontend

#### Routes (src/App.tsx)


| Path                         | Component                             | Auth Guard | Role Gate                |
| ---------------------------- | ------------------------------------- | ---------- | ------------------------ |
| `/`                          | `HomePage`                            | None       | None                     |
| `/quienes-somos`             | `QuienesSomosPage`                    | None       | None                     |
| `/exposiciones`              | `ExposicionesPage`                    | None       | None                     |
| `/exposiciones/electricidad` | `ElectricidadPage`                    | None       | None                     |
| `/planifica-tu-visita`       | `PlanificaPage`                       | None       | None                     |
| `/boletos`                   | `BoletosPage`                         | None       | None                     |
| `/mis-boletos`               | `OrderLookupPage`                     | None       | None                     |
| `/checkout/success`          | `CheckoutSuccessPage`                 | None       | None                     |
| `/checkout/cancel`           | `CheckoutCancelPage`                  | None       | None                     |
| `/actividades`               | `ActividadesPage`                     | None       | None                     |
| `/actividades/:eventId`      | `EventDetailPage`                     | None       | None                     |
| `/mapa`                      | `MapaPage`                            | None       | None                     |
| `/servicios`                 | `ServiciosPage`                       | None       | None                     |
| `/fotogaleria`               | `FotogaleriaPage`                     | None       | None                     |
| `/renta-de-espacios`         | `RentaEspaciosPage`                   | None       | None                     |
| `/involucrate`               | `InvolucratePage`                     | None       | None                     |
| `/contacto`                  | `ContactoPage`                        | None       | None                     |
| `/aviso-de-privacidad`       | `AvisoPrivacidadPage`                 | None       | None                     |
| `/panel/`*                   | `PanelShell` (lazy, Cognito-isolated) | Cognito    | Role-based per sub-route |


#### Panel sub-routes (src/components/panel/PanelShell.tsx)


| Path                      | Component                       | Role Gate                                                                |
| ------------------------- | ------------------------------- | ------------------------------------------------------------------------ |
| `/panel` (index)          | `DashboardPage`                 | `isAdmin()` check inside component (non-admin sees "Acceso restringido") |
| `/panel/login`            | `LoginPage`                     | None (public)                                                            |
| `/panel/scanner`          | `ScannerPage`                   | Any authenticated                                                        |
| `/panel/sales`            | `AssistedSalesPage`             | Any authenticated                                                        |
| `/panel/config`           | `TicketConfigPage`              | `AuthGuard requiredRole="Admin"`                                         |
| `/panel/special-days`     | `SpecialDaysPage`               | Any authenticated                                                        |
| `/panel/actividades`      | `EventsPage`                    | Any authenticated                                                        |
| `/panel/events`           | Redirect → `/panel/actividades` | —                                                                        |
| `/panel/contenido-guia`   | `ComingSoonPlaceholder`         | Any authenticated                                                        |
| `/panel/visitas-grupales` | `GroupRequestsPage`             | Any authenticated                                                        |
| `/panel/staff`            | `StaffPage`                     | `AuthGuard requiredRole="Admin"`                                         |
| `/panel/directory`        | `DirectoryPage`                 | Any authenticated                                                        |
| `/panel/inquiries`        | `InquiriesPage`                 | Any authenticated                                                        |
| `/panel/export`           | `ExportPage`                    | Any authenticated                                                        |


#### Panel module inventory (src/pages/panel/)

- **DashboardPage** (`src/pages/panel/DashboardPage.tsx`) — 4 KPI cards: Órdenes hoy, Ingresos, Escaneos QR, Ocupación (with progress bar). Section "Visitantes por tipo" (visitorsByType dict from Lambda). Admin-only. Polls every 30s. No date-range filter. No point-of-sale breakdown. No rentals/events data. No CSV/PDF export from this page.
- **ScannerPage** (`src/pages/panel/ScannerPage.tsx`) — QR scanner for ticket validation.
- **AssistedSalesPage** (`src/pages/panel/AssistedSalesPage.tsx`) — Taquilla / guided sales flow.
- **TicketConfigPage** (`src/pages/panel/TicketConfigPage.tsx`) — Edit ticket prices (Admin only).
- **SpecialDaysPage** (`src/pages/panel/SpecialDaysPage.tsx`) — Manage free days and holidays.
- **EventsPage** (`src/pages/panel/EventsPage.tsx`) — CRUD for museum events/actividades.
- **GroupRequestsPage** (`src/pages/panel/GroupRequestsPage.tsx`) — View/update group visit requests.
- **StaffPage** (`src/pages/panel/StaffPage.tsx`) — Create/deactivate staff, Cognito provisioning (Admin only).
- **DirectoryPage** (`src/pages/panel/DirectoryPage.tsx`) — Contact directory, visible to all staff.
- **InquiriesPage** (`src/pages/panel/InquiriesPage.tsx`) — Rental space inquiries inbox.
- **ExportPage** (`src/pages/panel/ExportPage.tsx`) — Date-range export to CSV (orders, scans, staff; "revenue" option in frontend form but not wired to backend; backend accepts: orders/scans/staff).
- `**contenido-guia`** — `ComingSoonPlaceholder` (route exists, page not built).

**No standalone "Reports" module exists.** The nearest equivalent is `ExportPage` (data export via presigned S3 URL). There is no `/panel/reports` route and no `ReportsPage.tsx` file.

**"Scanned tickets" widget:** The Dashboard's third KPI card (`Escaneos QR`, `summary.qrScans`) is the scanned-tickets metric the requirement wants removed.

#### Sidebar nav items (src/components/panel/PanelSidebar.tsx)

Dashboard, Escaner QR, Precios (Admin only), Venta Asistida, Contenido de Guía, Actividades y Eventos, Días Especiales, Directorio, Renta de Espacios, Visitas Grupales, Exportar, Personal (Admin only).

No "Reports" or "Incidents" nav item exists.

#### State management

- **TanStack Query** — All panel data fetching. Query keys follow `["admin", "{entity}", user.sub]` pattern (e.g. `["admin", "dashboard", user?.sub]`). `staleTime: 30_000` on the panel `QueryClient`. Dashboard refetches every 30s via `refetchInterval`.
- **React Context (AuthContext)** — `src/lib/auth/AuthContext.tsx`. Holds `PanelUser | null`, `isAuthenticated`, `isLoading`, `token`, `cognitoAvailable`. Provides `login`, `logout`, `getToken` (with proactive refresh 5 min before expiry), `completeNewPassword`.
- Role/permission state lives in `user.groups: string[]` populated from JWT `cognito:groups` claim at login.

#### Auth flow

- **Custom form** (not Cognito Hosted UI). `src/lib/auth/cognito.ts` wraps `amazon-cognito-identity-js` SDK using SRP auth flow.
- Login accepts username or email; appends `@panel.munet.mx` if no `@` present.
- JWT attached as `Authorization: Bearer {token}` header on all admin API calls (`src/lib/api/admin.ts`).
- Role read from `cognito:groups` claim in JWT payload — decoded client-side in `parseUserFromPayload`.
- Role gating in UI: `AuthGuard` with `requiredRole` prop checks `user.groups.includes(requiredRole)`.
- Only two `PanelRole` values defined: `"Admin"` and `"Operador"` (`src/lib/auth/types.ts:16`).

#### Public site: "Plan your visit" page (src/pages/PlanificaPage.tsx)

Four-card grid layout:

1. **Horarios** — Mon closed, Tue–Sun 10:00–18:00.
2. **Tarifas** — General $120, Estudiante/INAPAM/Niño $60, Domingo gratis. "Comprar Boletos" CTA.
3. **Cómo Llegar** — Single address (`Av. de los Compositores s/n, Bosque de Chapultepec II Secc.`), embedded keyless Google Maps iframe (coords 19.4135278, -99.1955878), link to official MUNET business listing on Google Maps.
4. **Accesibilidad** — 3 bullet points (wheelchair, elevators, assistance).

Also includes a "Visitas Grupales" group-request form section.

**No parking addresses or parking-specific Google Maps deep links exist anywhere on this page.** The page contains a single museum address and one map embed only.

#### MapaPage (src/pages/MapaPage.tsx)

Separate route `/mapa`. Shows interactive floor plan (`PlanoViewer`, `IndiceMapa` components from `src/data/mapa`). No addresses, no Google Maps deep links, no parking information on this page — it is strictly an internal museum floor-plan viewer.

---

### 1.2 Backend

#### Lambda functions (amplify/functions/)


| Function                  | Method + Path                                   | Purpose                                                                       | Tables                           | Auth                                 |
| ------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------- | -------------------------------- | ------------------------------------ |
| `get-ticket-config`       | `GET /ticket-config`                            | Returns ticket prices, free days, holidays from DynamoDB                      | main (read)                      | Public                               |
| `create-checkout-session` | `POST /checkout`                                | Creates Stripe Checkout session or free order; generates QR+PDF               | main (read/write), S3            | Public                               |
| `create-checkout-session` | `GET /orders?email=...`                         | List orders by email                                                          | main (read)                      | Cognito                              |
| `create-checkout-session` | `GET /orders/{id}`                              | Single order lookup by ULID                                                   | main (read)                      | Public                               |
| `create-checkout-session` | `POST /admin/assisted-checkout`                 | Taquilla-assisted order (free or card)                                        | main (read/write), S3            | Cognito                              |
| `handle-stripe-webhook`   | `POST /webhooks/stripe`                         | Stripe event processing → marks orders complete, issues tickets, sends emails | main (read/write), S3            | Stripe signature                     |
| `submit-inquiry`          | `POST /inquiries`                               | Rental space inquiry form submission                                          | ops (write)                      | Public                               |
| `submit-inquiry`          | `POST /group-requests`                          | Group visit request form                                                      | ops (write)                      | Public                               |
| `validate-ticket`         | `POST /tickets/validate`                        | QR scan validation (DynamoDB primary, HMAC offline fallback)                  | main (read/write)                | Cognito                              |
| `validate-ticket`         | `GET /admin/scanner/daily-key`                  | HMAC daily key for offline scanning                                           | None                             | Cognito (Admin OR Operador)          |
| `admin-dashboard`         | `GET /admin/dashboard`                          | Today's pre-aggregated dashboard summary                                      | main (read)                      | Cognito                              |
| `admin-config`            | `GET /admin/config/special-days`                | Read free days + holidays                                                     | main (read)                      | Cognito                              |
| `admin-config`            | `PUT /admin/config/tickets`                     | Update ticket prices                                                          | main (write)                     | Cognito                              |
| `admin-config`            | `PUT /admin/config/special-days`                | Update free days + holidays                                                   | main (write)                     | Cognito                              |
| `admin-events`            | `GET /events`                                   | Public event list                                                             | ops (read)                       | Public                               |
| `admin-events`            | `GET/POST /admin/events`                        | List/create events                                                            | ops (read/write)                 | Cognito                              |
| `admin-events`            | `GET/PUT/DELETE /admin/events/{id}`             | Single event CRUD                                                             | ops (read/write)                 | Cognito                              |
| `admin-staff`             | `GET/POST /admin/staff`                         | List/create staff + Cognito provisioning                                      | ops (read/write), Cognito IDP    | Cognito (Admin only in Lambda)       |
| `admin-staff`             | `PUT/DELETE /admin/staff/{empNo}`               | Update/deactivate staff                                                       | ops (read/write), Cognito IDP    | Cognito (Admin only in Lambda)       |
| `admin-operations`        | `GET/POST /admin/directory`                     | Staff directory CRUD                                                          | ops (read/write)                 | Cognito (GET: any; mutations: Admin) |
| `admin-operations`        | `PUT/DELETE /admin/directory/{dept}/{memberId}` | Directory member edit/delete                                                  | ops (read/write)                 | Cognito (Admin only)                 |
| `admin-operations`        | `GET /admin/inquiries`                          | List rental inquiries                                                         | ops (read)                       | Cognito (any)                        |
| `admin-operations`        | `PATCH /admin/inquiries/{id}/status`            | Update inquiry status                                                         | ops (read/write)                 | Cognito (Admin only)                 |
| `admin-operations`        | `GET/PATCH /admin/group-requests[/{id}/status]` | Group requests list/status                                                    | ops (read/write)                 | Cognito (Admin on PATCH)             |
| `admin-operations`        | `GET/PUT /admin/guide-content[/{spaceId}]`      | Guide content CRUD                                                            | ops (read/write)                 | Cognito (PUT: Admin)                 |
| `admin-operations`        | `GET /admin/rental-spaces`                      | List space availability flags                                                 | ops (read)                       | Cognito (any)                        |
| `admin-operations`        | `PATCH /admin/rental-spaces/{spaceId}`          | Toggle space availability                                                     | ops (read/write)                 | Cognito (Admin only)                 |
| `admin-operations`        | `POST /admin/export`                            | CSV export to S3, returns presigned URL                                       | main (read scan), ops (read), S3 | Cognito (Admin only)                 |
| `rental-spaces`           | `GET /rental-spaces`                            | Public space availability flags                                               | ops (read)                       | Public                               |


**No EventBridge rules, cron schedules, or Lambda scheduled invocations exist in `amplify/backend.ts`.** Zero `scheduleExpression` references found in the entire `amplify/` directory.

**Critical gap:** The dashboard reads a pre-aggregated `DAILY#{today}/SUMMARY` record (`amplify/functions/admin-dashboard/handler.ts:51`), but **no Lambda writes this record**. No daily aggregation job exists in the codebase. Dashboard always returns zeroed data unless something external writes this record. This is a production bug / missing piece.

#### Data models

**Main table** (DynamoDB single-table, `munet-{addr}`, `amplify/backend.ts:45`):


| Entity                | pk                    | sk                  | GSI1PK | GSI1SK | Notes                                                   |
| --------------------- | --------------------- | ------------------- | ------ | ------ | ------------------------------------------------------- |
| Order META            | `ORDER#{orderId}`     | `META`              | —      | —      | Status, email, items, paidTotal, visitDate, channel     |
| Ticket                | `ORDER#{orderId}`     | `TICKET#{ticketId}` | —      | —      | QR, validatedAt, validatedBy                            |
| Config                | `CONFIG#TICKETS`      | `CONFIG`            | —      | —      | ticketTypes array                                       |
| Config (special days) | `CONFIG#SPECIAL_DAYS` | `CONFIG`            | —      | —      | freeDays, holidays                                      |
| **Daily summary**     | `DAILY#{YYYY-MM-DD}`  | `SUMMARY`           | —      | —      | Dashboard aggregation — **never written by any Lambda** |


GSI1 on main table: `GSI1PK`/`GSI1SK` — used for email-based order lookup (`GSI1PK = EMAIL#{email}`).

**Operations table** (DynamoDB single-table, `munet-ops-{addr}`, `amplify/backend.ts:65`):


| Entity            | pk                        | sk                    | GSI1PK               | GSI1SK                               | Notes                                             |
| ----------------- | ------------------------- | --------------------- | -------------------- | ------------------------------------ | ------------------------------------------------- |
| Staff             | `STAFF#{empNo}`           | `META`                | `TYPE#STAFF`         | `STATUS#active/inactive`             | guide/operator/security roles; cognitoUserId link |
| Event             | `EVENT#{eventId}`         | `META`                | `TYPE#EVENT`         | `STATUS#{draft/published/cancelled}` | Museum events/actividades                         |
| Directory member  | `DIRECTORY#{dept}`        | `MEMBER#{memberId}`   | `TYPE#DIRECTORY`     | `DEPT#{dept}`                        | Contact directory                                 |
| Inquiry           | `INQUIRY#{inquiryId}`     | `INQUIRY#{inquiryId}` | `TYPE#INQUIRY`       | —                                    | Rental space inquiries                            |
| Group request     | `GROUP_REQUEST#{id}`      | `META`                | `TYPE#GROUP_REQUEST` | —                                    | Group visit requests                              |
| Guide content     | `GUIDE_CONTENT#{spaceId}` | `META`                | `TYPE#GUIDE_CONTENT` | `GUIDE_CONTENT#{spaceId}`            | Per-space guide notes                             |
| Rental space flag | `RENTAL_SPACE#{spaceId}`  | `META`                | —                    | —                                    | enabled boolean per space                         |


GSI1 on ops table: `GSI1PK`/`GSI1SK` — all entity type queries go through this index.

Valid rental spaces: `auditorio`, `sala-reuniones`, `talleres`, `foro-aire-libre`, `explanada` (`amplify/functions/shared/constants.ts:65`).

Staff roles: `guide`, `operator`, `security` (no `maintenance` role). Staff departments: `direccion`, `operaciones`, `educacion`, `comunicacion`, `mantenimiento`, `seguridad`, `administracion` (`constants.ts:187`).

#### Business flows

- **Ticketing:** Public `POST /checkout` → Stripe Checkout session; visitor pays → `POST /webhooks/stripe` → marks order `completed`, generates QR+PDF, sends SES email. Free orders (Sunday nationals, zero-price) complete synchronously without Stripe. Assisted sales: `POST /admin/assisted-checkout` → same `create-checkout-session` handler with `channel: "assisted"`.
- **QR validation:** `POST /tickets/validate` checks DynamoDB (marks `validatedAt`); falls back to HMAC daily-key offline if DynamoDB throws transient error.
- **Staff onboarding:** `POST /admin/staff` → writes DDB record first → creates Cognito user via `AdminCreateUser` → adds to `Operador` group. Rollback if group assignment fails on a new user.
- **Events:** Full CRUD via `admin-events` Lambda, status: `draft/published/cancelled`. Published events visible publicly via `GET /events`.
- **Rental inquiries:** Public form → `POST /inquiries` → saved to ops table → SES notification email → admin works through status machine: `new → contacted → quoted → booked/rejected/declined`.
- **Group requests:** Public form → `POST /group-requests` → ops table → status: `new → reviewed → confirmed/rejected`.
- **Export:** `POST /admin/export` → Scan on main or ops table (no GSI-based range query — full table scan with filter for date range) → CSV → S3 → presigned URL (5 min expiry).

---

### 1.3 AWS / Amplify Gen 2

#### amplify/backend.ts summary

- `defineBackend` with 11 functions (no `defineAuth`, `defineData`, `defineStorage` — all resources are raw CDK constructs added to the Amplify custom stack).
- **Two DynamoDB tables:** main (`munet-{addr}`) and ops (`munet-ops-{addr}`). Both: PAY_PER_REQUEST, RETAIN, PITR enabled, AWS_MANAGED encryption, TTL attribute, one GSI each (GSI1).
- **Cognito UserPool:** `selfSignUpEnabled: false`, email sign-in, SRP auth, MFA optional (TOTP only), email account recovery. RETAIN policy.
- **Two Cognito groups:** `Admin` and `Operador`. No other groups exist in IaC.
- **REST API Gateway:** Single REST API named `munet-api`, stage `api`. 26+ routes. Cognito authorizer attached to all protected routes. Gateway-level CORS on 4xx/5xx uses wildcard origin (known limitation documented inline).
- **S3 bucket:** One bucket for ticket PDFs and CSV exports. RETAIN, S3_MANAGED encryption.
- **SES permissions:** `ses:SendEmail` + `ses:SendRawEmail` on `create-checkout-session`, `handle-stripe-webhook`, `submit-inquiry`.
- **IAM for staff Lambda:** `cognito-idp:AdminCreateUser`, `AdminAddUserToGroup`, `AdminDisableUser`, `AdminDeleteUser` on the UserPool ARN.

#### Cognito groups: present vs required


| Group              | Required                     | Status                                                                                    |
| ------------------ | ---------------------------- | ----------------------------------------------------------------------------------------- |
| Super Admin        | Yes (requirement A.2)        | **Missing** — not in IaC or frontend                                                      |
| Admin              | Yes                          | Present (`amplify/backend.ts:109`)                                                        |
| HR                 | Yes (requirement A.2)        | **Missing**                                                                               |
| Operador (general) | Yes                          | Present (`amplify/backend.ts:115`)                                                        |
| Guides             | Yes (requirement A.2)        | **Missing** — currently guides are `role: "guide"` on a staff record, not a Cognito group |
| Maintenance        | Yes (requirement A.2)        | **Missing**                                                                               |
| Events / Commerce  | Yes (requirement A.2)        | **Missing**                                                                               |
| Security           | No explicit group needed yet | **Missing**                                                                               |


Frontend only recognizes `"Admin"` and `"Operador"` as `PanelRole` (`src/lib/auth/types.ts:16`). The `isAdmin()` helper checks for the `"Admin"` string literal. Any new role requires updating this type + all downstream guards.

#### Environment variables (per function)


| Var                     | Functions                                                                                                                         |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `TABLE_NAME`            | get-ticket-config, create-checkout-session, handle-stripe-webhook, submit-inquiry, validate-ticket, admin-dashboard, admin-config |
| `OPERATIONS_TABLE_NAME` | admin-events, admin-staff, admin-operations, submit-inquiry, rental-spaces                                                        |
| `USER_POOL_ID`          | admin-staff                                                                                                                       |
| `STRIPE_SECRET_KEY`     | (Amplify secret, not set via addEnvironment — set via Amplify console)                                                            |
| `STRIPE_WEBHOOK_SECRET` | (Amplify secret)                                                                                                                  |
| `QR_HMAC_SECRET`        | (Amplify secret)                                                                                                                  |
| `SES_FROM_EMAIL`        | (Amplify secret)                                                                                                                  |
| `FRONTEND_URL`          | (Amplify secret)                                                                                                                  |
| `ADMIN_EMAIL`           | (Amplify secret)                                                                                                                  |
| `S3_TICKET_BUCKET`      | handle-stripe-webhook, create-checkout-session, admin-operations                                                                  |


#### Deployment

- **amplify.yml**: backend phase runs `ampx pipeline-deploy`. Frontend: copies `amplify_outputs.json` to `public/`, runs `npm run build`. Assets cached 1yr, `index.html` no-cache.
- **amplify_outputs.json** (snapshot): deployed to `us-east-1`, API at `https://6lzlt4d6rb.execute-api.us-east-1.amazonaws.com`, UserPool `us-east-1_geqDpNMwF`.
- No branch-to-environment mapping in `amplify.yml` (single stage, no staging branch config).

---

## 2. Gap Analysis

### A.1 Dashboard


| Requirement                                                             | Status                                | Evidence                                                                                                       | Notes                                                                                                                |
| ----------------------------------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Centralize sales, revenue, tickets, attendance on Dashboard             | Partial                               | `DashboardPage.tsx` has ordersCount, revenue, qrScans, occupancy                                               | Attendance = occupancy card. No incidents. No rentals. No events KPIs.                                               |
| Remove standalone "Reports" module                                      | Present (already absent)              | No `ReportsPage.tsx`, no `/panel/reports` route anywhere                                                       | Nothing to remove. Export lives in `ExportPage.tsx` at `/panel/export`.                                              |
| Filters: date range, ticket type, revenue by day-of-week, point of sale | Missing                               | `DashboardPage.tsx:44-53` — query has no params; Lambda `GET /admin/dashboard` accepts zero query params       | Dashboard Lambda reads a single daily `SUMMARY` record — it cannot accept date-range filters without backend rework. |
| Remove "scanned tickets" widget                                         | Present (identified, not yet removed) | `DashboardPage.tsx:143-149` — `ScanLine` / "Escaneos QR" KPI card using `summary.qrScans`                      | One-line UI removal, but the underlying metric has value; confirm whether to truly drop or relabel.                  |
| CSV/PDF export from Dashboard                                           | Missing                               | No export controls in `DashboardPage.tsx`                                                                      | Export exists separately at `/panel/export`. Integration into Dashboard is net new.                                  |
| Venue rentals + Munet events on Dashboard                               | Missing                               | `DashboardPage.tsx` fetches only from `admin-dashboard` Lambda which reads only the main table `DAILY#` record | No `EVENT` or `RENTAL` aggregation in dashboard Lambda or pre-agg record.                                            |


**Critical backend gap:** The `DAILY#/SUMMARY` record is never written. The aggregation job is referenced in the handler but not implemented (`admin-dashboard/handler.ts:51`). All KPI cards show zeroes in production unless someone manually writes this record.

### A.2 Roles and Permissions


| Requirement                                                                  | Status  | Evidence                                                                                                                     | Notes                                                                                                           |
| ---------------------------------------------------------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Super Admin role (delete admins, change prices)                              | Missing | `src/lib/auth/types.ts:16` — only `"Admin"` and `"Operador"` defined; `amplify/backend.ts:109` — no SuperAdmin Cognito group | Price change is currently any Admin via `PUT /admin/config/tickets` (no Super Admin gate).                      |
| Admin role (cannot change prices, cannot delete Super Admin, CAN onboard HR) | Missing | Current Admin can change prices (`TicketConfigPage` behind `requiredRole="Admin"`); HR concept doesn't exist                 | Role hierarchy inversion: current Admin CAN change prices, which the requirement reserves for Super Admin only. |
| HR role (onboard/offboard operational staff)                                 | Missing | No `"HR"` Cognito group; staff CRUD is Admin-only in `admin-staff/handler.ts:213`                                            | Needs new Cognito group + Lambda role check + frontend AuthGuard update.                                        |
| Guides role (tour content, QR scanner, assisted sales)                       | Missing | Scanner and sales are available to all `Operador` — no Guide-specific group                                                  | `validate-ticket` checks `isAdmin OR hasGroup("Operador")`; no Guide gate.                                      |
| Maintenance role (incident management, only role to resolve incidents)       | Missing | No `"Maintenance"` group; no incidents data model anywhere in codebase                                                       | Entire incidents system is missing (data model + Lambda + UI).                                                  |
| Events/Commerce role (venue rentals, event/activity management)              | Missing | No `"Events"` Cognito group; event management currently Admin-only or any-Operador                                           | No role boundary exists in Lambda for event/rental mutations vs. Admin.                                         |


### A.3 Cross-cutting


| Feature                                                                        | Status  | Evidence                                                                                                                                                                                                           |
| ------------------------------------------------------------------------------ | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Staff directory                                                                | Present | `DirectoryPage.tsx` at `/panel/directory`; backend `GET/POST/PUT/DELETE /admin/directory` fully implemented in `admin-operations`                                                                                  |
| Complex map (public)                                                           | Partial | `MapaPage.tsx` at `/mapa` — interactive floor plan with `PlanoViewer` + `IndiceMapa`. No Google Maps addresses/deep links for parking. Not the same as the "plan your visit" location card in `PlanificaPage.tsx`. |
| Panic button                                                                   | Missing | Zero references to "panic", "panico", "emergency", "incident" in `src/`. Not built.                                                                                                                                |
| Incidents tab — any role opens incidents                                       | Missing | No incident data model in `amplify/functions/shared/types.ts`. No route, no Lambda, no DDB entity.                                                                                                                 |
| Incident typologies (cleaning, damage, electrical, restrooms, security, other) | Missing | Not found anywhere in codebase.                                                                                                                                                                                    |
| Incident states: Open → In progress → Resolved                                 | Missing | Not found.                                                                                                                                                                                                         |
| Only Maintenance resolves incidents                                            | Missing | Maintenance role doesn't exist; incidents system doesn't exist.                                                                                                                                                    |


### A.4 Notifications


| Feature                       | Status  | Evidence                                                                                                                                                   |
| ----------------------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Notification data model       | Missing | No notification entity in either DynamoDB table schema (`amplify/functions/shared/types.ts`). No SNS, SQS, or WebSocket resources in `amplify/backend.ts`. |
| In-panel notification surface | Missing | No notification bell/drawer in `PanelLayout` or `PanelSidebar`.                                                                                            |
| Readiness for later           | Low     | Would need: new DynamoDB entity (ops table), new Lambda route, WebSocket or polling mechanism, frontend notification context. Nothing is scaffolded.       |


### B.1 Public site map page


| Requirement                                 | Status            | Evidence                                                                                                                                                                                                                                                                                                                  |
| ------------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Current "plan your visit" map/hours section | Present           | `PlanificaPage.tsx:314-357` — "Cómo Llegar" card with single address, Google Maps embed (keyless iframe), and a deep link to the MUNET business listing.                                                                                                                                                                  |
| Main access address                         | Present (partial) | `PlanificaPage.tsx:323` — `Av. de los Compositores s/n, Bosque de Chapultepec II Secc.` — no label calling it "Main access".                                                                                                                                                                                              |
| MUNET parking (Periférico) deep link        | Missing           | Not in `PlanificaPage.tsx`. Not in `MapaPage.tsx`. No parking address anywhere.                                                                                                                                                                                                                                           |
| Avenida Compositores parking deep link      | Missing           | Not in codebase.                                                                                                                                                                                                                                                                                                          |
| La Tapatía parking deep link                | Missing           | Not in codebase.                                                                                                                                                                                                                                                                                                          |
| Where to add                                | —                 | `PlanificaPage.tsx:314-357` is the exact location. The "Cómo Llegar" TiltCard section. The existing card can be extended with a list of `<a href="https://maps.google.com/maps?q={coords}">` links below the existing map embed, or the card can be widened to two-column with the map on left and address list on right. |


---

## 3. Risks and Open Questions

- **Production dashboard shows all-zeroes.** The `DAILY#/SUMMARY` record is never written — no aggregation job exists (`amplify/backend.ts` has zero EventBridge/cron/schedule definitions). This is not a gap-against-requirements issue — it's a production bug that must be resolved before or alongside dashboard restructure.
- **Export: "revenue" type in frontend not wired to backend.** `ExportPage.tsx:23` lists `{ value: "revenue", label: "Ingresos" }` as an option. `admin-operations/handler.ts:547-558` only handles `orders`, `scans`, `staff` — `revenue` falls through to `return badRequest('Invalid entity type')`. Frontend will produce a 400 error when user selects "Ingresos".
- **Export uses full-table Scan for date-range queries.** `admin-operations/handler.ts:640-658` runs `ScanCommand` with `FilterExpression` — not a GSI query. At scale this will be slow and expensive. No GSI covers `ORDER#` records by `createdAt`.
- **Role model debt is architectural.** Current binary `Admin | Operador` is hardcoded in `src/lib/auth/types.ts:16`, `PanelSidebar.tsx`, `AuthGuard.tsx`, and every Lambda's `isAdmin()` check. Expanding to 6 roles (Super Admin, Admin, HR, Guide, Maintenance, Events) requires: new Cognito groups in IaC, updated `PanelRole` union type, new `hasGroup()` wrappers in frontend, and Lambda-level enforcement rewrites across `admin-staff`, `admin-config`, `admin-events`, `admin-operations`. This is the highest-effort item in the restructure.
- `**/panel/contenido-guia` is a stub.** The route exists (`PanelShell.tsx:170`) and the backend is fully implemented (`GET/PUT /admin/guide-content/{spaceId}`), but the page shows `ComingSoonPlaceholder`. Frontend not built.
- **No staging branch.** `amplify.yml` has no branch-specific configuration. All pushes go to a single deployed environment. Any schema or role changes affect production immediately.
- **Role taxonomy mismatch.** Requirements call for 6 groups (Super Admin, Admin, HR, Guides, Maintenance, Events). Production today has 2 (`Admin`, `Operador`). Every role-gating site — frontend `AuthGuard`, sidebar, every Lambda `isAdmin()` — needs rewriting around a real group hierarchy.
- `**MaintenanceRole` vs `mantenimiento` department.** `DEPARTMENTS` in constants includes `"mantenimiento"`, but this is a staff directory department, not a Cognito access-control group. Incidents-resolving capability requires a real Cognito group, not just a department tag.
- **No hard gate on price changes.** The requirement says only Super Admin can change prices. Currently any user in the `Admin` Cognito group can call `PUT /admin/config/tickets`. The Lambda (`admin-config`) does not distinguish Admin vs Super Admin because Super Admin doesn't exist.

---

## 4. Surfacing Options for Rentals + Events on Dashboard

**Option 1 — Inline KPI cards**

Add two new KPI card rows to the existing grid: one for today's events (count published + upcoming), one for active rental inquiries (count by status). Simple, consistent with current card pattern. Low engineering cost: add two query calls to dashboard Lambda (query ops table GSI1 for `TYPE#EVENT` and `TYPE#INQUIRY`), add cards to `DashboardPage.tsx`.

Tradeoff: Shows aggregates only. No visibility into which events or which inquiries. Good for a glance, bad for action.

**Option 2 — Table rows below KPI cards**

Keep 4 KPI cards at top. Add a two-column lower section: left = "Próximas Actividades" (today's + next 3 upcoming published events, inline table), right = "Solicitudes de Renta" (last 5 inquiries with status badge). Click-through to respective panel pages.

Tradeoff: More information density. Requires Dashboard Lambda to return richer payload (events list + inquiry summary). Moderate engineering: new response shape, new frontend components. Matches how ops-staff actually use a dashboard — they need to act, not just count.

**Option 3 — Calendar lane (hybrid)**

Add a compact week-view calendar lane below KPIs. Events appear as blocks on their date. Rental inquiries appear as a sidebar list with status. Requires a calendar UI component (no existing calendar primitive in ShadCN/ui that's installed; would need `shadcn add calendar` or a custom component).

Tradeoff: Highest visual value for Events/Commerce staff. Highest engineering cost. Overkill if Dashboard is primarily for Admin daily ops check, not event scheduling (EventsPage already manages scheduling).

---

## Recommendation

**Decision:** Option 2 (table rows below KPI cards) for rentals + events surfacing. Phase the panel restructure in this order:

1. **Phase 1 — Cognito groups + role model** (unblocks everything else). Add `SuperAdmin`, `HR`, `Guia`, `Mantenimiento`, `EventosComercio` groups to `amplify/backend.ts`. Update `PanelRole` type union and create `hasRole(user, role)` helper. Add `isHR`, `isMaintenance`, etc. wrappers in Lambda shared/auth. This is the foundation — no other A.2 work is possible without it.
2. **Phase 2 — Incidents data model + Lambda** (unblocks A.3 Maintenance role and the incident UI). Add `INCIDENT` entity to ops table. Add `POST/GET/PATCH /admin/incidents` routes to `admin-operations` Lambda (or a new `admin-incidents` Lambda). Incident typologies and state machine are fully defined in requirements — straightforward to implement.
3. **Phase 3 — Dashboard consolidation** (A.1). Fix the missing aggregation job (add EventBridge cron Lambda). Remove the qrScans KPI card. Add date-range + ticket-type + day-of-week + point-of-sale filters to dashboard Lambda. Add rental + events inline tables (Option 2). Fold "Exportar" filters + actions into the Dashboard page (reuse `POST /admin/export`); add PDF export.
4. **Phase 4 — UI cleanup** (delete `ExportPage.tsx` + `/panel/export` route + "Exportar" sidebar item now that filters live on Dashboard; build out `contenido-guia` page; price-change gate for SuperAdmin; B.1 parking addresses on PlanificaPage).

**Confidence:** High
**Reasoning:** Role model is the critical path. Every permission-related requirement (A.2, parts of A.3) is blocked on Cognito groups existing. Incidents are the second-highest-effort item and have zero scaffolding. Dashboard aggregation is a production bug that must be fixed before any Dashboard restructure makes sense — fixing it first gives accurate baseline data for the new filters. The parking map addition (B.1) is a 30-minute isolated edit to `PlanificaPage.tsx` and can be done at any phase.

**Next step:** Write plan `feature-role-model/01.md` — Cognito groups IaC + `PanelRole` type + Lambda auth helpers. No UI changes needed in this plan; it is purely infrastructure + shared code. Stress-test the Cognito group naming convention against all Lambda `isAdmin()`/`hasGroup()` call sites before executing.

**Risk if wrong:** If incidents are prioritized before the role model, the Maintenance-only resolve gate cannot be enforced at the API layer — the feature ships with no access control and must be retrofitted. Role model first prevents this class of security rework.