export const meta = {
	name: 'catalogo-incidencias-build',
	description: 'Build the unified Sentria "Catálogo de incidencias" grouped table (impl + gate, 3-lens adversarial review, conditional fix)',
	phases: [
		{ title: 'Implement' },
		{ title: 'Review' },
		{ title: 'Fix' },
	],
}

const WT = 'C:/Users/sanal/dev/iago-os/clients/sentria/.worktrees/catalogo-incidencias-unificado'

const GROUND_RULES = [
	'WORKTREE (absolute): ' + WT,
	'You operate ONLY inside this worktree. For every bash command: cd "' + WT + '" first (or use it as cwd). Use absolute paths for Read/Edit/Write.',
	'',
	'HARD PROHIBITIONS:',
	'- NEVER run ANY git command that mutates state: no checkout, pull, fetch, commit, branch, switch, stash, reset, merge, rebase. (Read-only git diff/status/log is allowed.) The orchestrator owns all git.',
	'- NEVER add, remove, or upgrade an npm dependency. No npm install of new packages. This change needs ZERO new deps (framer-motion ^12 is already installed).',
	'- NEVER modify src/components/ui/** (shadcn generated, "Do Not Modify").',
	'- NEVER touch amplify/** (no schema/backend change — this is presentation-only).',
	'- Do NOT modify the feat/turnos-admin-ui branch or any other worktree.',
	'',
	'REPO CONVENTIONS (match exactly — "write code that reads like the surrounding code"):',
	'- Indentation is TABS (not spaces). All existing src files use tabs.',
	'- Component filenames are PascalCase (CategoriasTable.tsx, TipoModal.tsx). lib filenames are kebab-case (catalog-key.ts).',
	'- Named exports only (no default exports). Import alias @/ maps to src/.',
	'- TypeScript strict: NO any, NO "as" casts (except narrow type guards), NO @ts-ignore.',
	'- User-facing copy is Spanish; code identifiers/comments English.',
	'- Use cn() from @/lib/utils for conditional classes. Reuse shadcn primitives from @/components/ui.',
	'',
	'FORMAT-HOOK WARNING: an iaGO root format hook may auto-reformat files you Edit (re-tab, reorder imports). That is BENIGN here (eslint enforces no style/import-order rules; the build is the real gate). BUT beware the biome useConst transform: if you declare a `let` and reassign it in a SEPARATE later Edit, the hook may have already flipped it to `const`, breaking the reassignment with "Assignment to constant variable". Declare any `let` together with its reassignment in the SAME edit, or prefer `const`.',
].join('\n')

const DESIGN = [
	'GOAL: Merge the "Categorías" and "Tipos" tabs of the Catálogo page into ONE tab labeled "Catálogo de incidencias", rendered as a SINGLE grouped table — incident TYPES as rows, visually grouped under collapsible category headers. Presentation reorg only; no data/schema/backend change.',
	'',
	'LOCKED DESIGN — implement exactly, do not redesign:',
	'',
	'== File A (NEW) src/lib/catalog-grouping.ts — pure module, importable by tsx node:test ==',
	'CRITICAL: this file must have NO @/ imports and NO runtime React/aws imports (the tsx test imports it via a RELATIVE path; @/ aliases do not resolve under tsx). Pure TS only.',
	'Export:',
	'  export type ActiveFilter = "activos" | "inactivos" | "todos";',
	'  export function applyActiveFilter<T extends { active: boolean }>(rows: T[], filter: ActiveFilter): T[]',
	'     // activos => active === true ; inactivos => active !== true ; todos => all',
	'  export interface CategoriaRow { id: string; key: string; label: string; sortOrder: number | null; active: boolean; updatedAt?: string; }  // move verbatim (incl. the updatedAt JSDoc) from the old CategoriasTable.tsx',
	'  export interface TipoRow { id: string; key: string; label: string; categoryKey: string; slaResponseMinutes: number | null; slaResolutionMinutes: number | null; active: boolean; updatedAt?: string; }  // move verbatim from old TiposTable.tsx',
	'  export const ORPHAN_GROUP_KEY = "__sin_categoria__";',
	'  export interface CatalogGroup { key: string; category: CategoriaRow | null; label: string; types: TipoRow[]; }',
	'  export function groupCatalog(categories: CategoriaRow[], types: TipoRow[], filter: ActiveFilter): CatalogGroup[]',
	'groupCatalog logic (this is the unit-tested spine — get it exactly right):',
	'  1. knownKeys = new Set(categories.map(c => c.key))  // ALL categories, regardless of filter.',
	'  2. visibleCategories = applyActiveFilter(categories, filter), sorted by (sortOrder ?? 0) ascending, tie-break key.localeCompare(key). Stable.',
	'  3. For each visible category c: its types = applyActiveFilter(types.filter(t => t.categoryKey === c.key), filter), sorted by (sortOrder ?? 0) then key.localeCompare. Push group { key: c.key, category: c, label: c.label, types } — INCLUDE the group even if types is empty (the header + "+ tipo" must still render).',
	'  4. Orphans = types whose categoryKey is NOT in knownKeys. orphanTypes = applyActiveFilter(orphans, filter), sorted same way. If orphanTypes.length > 0, append { key: ORPHAN_GROUP_KEY, category: null, label: "Sin categoría", types: orphanTypes }.',
	'  5. Return [...categoryGroups, ...(orphan ? [orphanGroup] : [])].',
	'  Note the intended semantics (assert in the test): a type whose parent category is filtered OUT (e.g. an active type under an inactive category, under filter "activos") does NOT appear — it is hidden with its category, and is NOT treated as an orphan (its categoryKey IS in knownKeys).',
	'',
	'== File B (NEW) src/components/catalog/CatalogoIncidenciasTable.tsx — the single grouped table ==',
	'Props:',
	'  interface CatalogoIncidenciasTableProps {',
	'    groups: CatalogGroup[];',
	'    canEdit: boolean;',
	'    onEditCategoria: (row: CategoriaRow) => void;',
	'    onToggleCategoriaActive: (row: CategoriaRow) => void;',
	'    onCreateTipoInCategory: (categoryKey: string) => void;',
	'    onEditTipo: (row: TipoRow) => void;',
	'    onToggleTipoActive: (row: TipoRow) => void;',
	'    busy?: boolean;',
	'    pendingId?: string | null;',
	'  }',
	'Import the row/group types from "@/lib/catalog-grouping". Export the component as a named export CatalogoIncidenciasTable.',
	'Render ONE <div className="overflow-x-auto"><Table> ...</Table></div>:',
	'  - <TableHeader> columns IN THIS ORDER: Etiqueta | SLA respuesta | SLA resolución | (canEdit ? Estado) | (canEdit ? Acciones, right-aligned). There is NO "Clave" column and NO "Categoría" column.',
	'  - Local collapse state: const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());  // empty = ALL groups expanded by default. A toggleCollapsed(key) clones the Set.',
	'  - Compute colCount = canEdit ? 5 : 3.',
	'  - For EACH group render its OWN <TableBody> (multiple tbody inside one <Table> is valid HTML and reads as one grouped table):',
	'      * Category HEADER row: a <TableRow className="bg-muted/50 hover:bg-muted/50"> with ONE <TableCell colSpan={colCount}>. Inside, a flex row:',
	'          - A chevron toggle <button type="button" aria-expanded={!isCollapsed} aria-label={(isCollapsed?"Expandir ":"Colapsar ")+group.label} onClick={()=>toggleCollapsed(group.key)}> containing a Framer Motion-animated chevron (motion.span with animate={{ rotate: isCollapsed ? -90 : 0 }} wrapping a lucide ChevronDown). This satisfies the Framer-Motion-on-all-UI rule for the collapse affordance.',
	'          - group.label (font-semibold). A small muted count e.g. "(N)" where N = group.types.length.',
	'          - If group.category (not orphan) AND canEdit: a status Badge (Activa/Inactiva, same emerald/muted styling as the old CategoriasTable) reflecting group.category.active.',
	'          - Right-aligned actions, ONLY when canEdit AND group.category !== null:',
	'              ✎ editar  -> Button ghost icon, Pencil, title/aria-label "Editar "+label, onClick onEditCategoria(group.category)',
	'              toggle    -> Button ghost icon, disabled={busy}; shows Loader2 spin when pendingId===group.category.id, else PowerOff (text-destructive) when active / RotateCcw (emerald) when inactive; onClick onToggleCategoriaActive(group.category); title/aria-label "Desactivar"/"Reactivar".',
	'              + tipo    -> Button size sm/ghost or outline with Plus icon, label "Tipo", ONLY rendered when group.category.active === true (cannot add a type to an archived category — backend rejects an inactive parent), onClick onCreateTipoInCategory(group.category.key).',
	'          - Orphan group (category === null): NO action buttons, NO status badge; optionally a muted note. Its types still render so they are never lost.',
	'      * TYPE rows, wrapped in <AnimatePresence initial={false}> so collapse triggers exit animation. Keep AnimatePresence MOUNTED; conditionally render its children:',
	'          {!isCollapsed && (group.types.length > 0',
	'             ? group.types.map(t => <motion.tr key={t.id} initial={{opacity:0, y:-4}} animate={{opacity:1, y:0}} exit={{opacity:0, y:-4}} transition={{duration:0.15}} className={t.active ? "" : "opacity-60"}> ...cells... </motion.tr>)',
	'             : <motion.tr key={group.key+"-empty"} ...same anim...><TableCell colSpan={colCount} className="py-4 text-center text-sm text-muted-foreground">Sin tipos en esta categoría.{canEdit && group.category?.active ? " Usa “+ Tipo” para agregar uno." : ""}</TableCell></motion.tr>)}',
	'        Type row cells in order: Etiqueta (font-medium) | slaMinutes(slaResponseMinutes) | slaMinutes(slaResolutionMinutes) | (canEdit ? Estado Badge Activo/Inactivo) | (canEdit ? Acciones: edit Pencil -> onEditTipo(t); toggle PowerOff/RotateCcw/Loader2 -> onToggleTipoActive(t), disabled={busy}, spinner when pendingId===t.id). Mirror the old TiposTable action markup + aria-labels.',
	'        Copy the slaMinutes(value:number|null) helper verbatim from the old TiposTable ("— " for null, "{n} min" otherwise).',
	'  - motion.tr must be the framer-motion motion component; rendering motion.tr inside <TableBody> is fine. Ensure it compiles under TS strict (no any).',
	'',
	'== File C (EDIT) src/pages/LineasYMaquinasPage.tsx ==',
	'  - Imports: remove the CategoriasTable and TiposTable imports entirely. Add: import { CatalogoIncidenciasTable } from "@/components/catalog/CatalogoIncidenciasTable". Import the row/filter helpers from "@/lib/catalog-grouping": type CategoriaRow, type TipoRow, type ActiveFilter, applyActiveFilter, type CatalogGroup, groupCatalog.',
	'  - Replace the local ActiveFilter type + applyFilter function with the imported ActiveFilter + applyActiveFilter (delete the local definitions; keep FILTER_LABELS and FilterChips in the page). Update all applyFilter(...) call sites (lines, machines) to applyActiveFilter(...).',
	'  - activeTab logic: tabs are now lineas | maquinas | catalogo. Back-compat: map legacy "categorias" and "tipos" param values to "catalogo". So: const activeTab = tabParam === "maquinas" ? "maquinas" : (tabParam === "catalogo" || tabParam === "categorias" || tabParam === "tipos") ? "catalogo" : "lineas". handleTabChange: when tab === "lineas" delete the param else set it (so catalogo writes ?tab=catalogo). Update the doc comment to mention catalogo + the legacy mapping.',
	'  - Replace the two states categoryFilter and typeFilter with ONE: const [catalogFilter, setCatalogFilter] = useState<ActiveFilter>("activos"). Remove the now-unused ones.',
	'  - Add create-tipo default-category plumbing: const [createTipoCategoryKey, setCreateTipoCategoryKey] = useState<string | null>(null). Change openCreateTipo to accept an optional categoryKey: openCreateTipo = (categoryKey?: string) => { setEditingTipo(null); setCreateTipoCategoryKey(categoryKey ?? null); setTipoModalOpen(true); }.',
	'  - Compute groups: const catalogGroups = useMemo(() => groupCatalog(allCategoriaRows, allTipoRows, isAdmin ? catalogFilter : "activos"), [allCategoriaRows, allTipoRows, catalogFilter, isAdmin]). You may drop the categoryKey.localeCompare sort inside the allTipoRows memo since groupCatalog now owns ordering (optional; harmless to leave).',
	'  - TabsList: replace the two triggers <TabsTrigger value="categorias"> and <TabsTrigger value="tipos"> with ONE <TabsTrigger value="catalogo">Catálogo de incidencias</TabsTrigger>. Keep lineas + maquinas triggers. (Do NOT name it bare "Incidencias" — collides with the Incidentes page.)',
	'  - Remove BOTH the categorias and tipos <TabsContent>. Add ONE <TabsContent value="catalogo"> with a <Card><CardContent className="pt-6 space-y-4">:',
	'       * Admin header (isAdmin): flex row with <FilterChips value={catalogFilter} onChange={setCatalogFilter} /> and a Button onClick={openCreateCategoria} disabled={categoriesLoading || typesLoading}> <Plus/> Nueva categoría </Button>. Non-admin: the existing read-only "Vista de solo lectura…" paragraph.',
	'       * Preserve the "all categories deactivated" amber warning banner (currently in the categorias TabsContent, lines ~628-646) — move it verbatim into this tab (condition: !categoriesLoading && allCategoriaRows.length > 0 && allCategoriaRows.every(r => !r.active)).',
	'       * Loading: while (categoriesLoading || typesLoading) render a DataTableSkeleton (pick a reasonable column set, e.g. admin: [{width:"w-40"},{width:"w-16"},{width:"w-16"},{badge:true}] actions=isAdmin; readonly: [{width:"w-40"},{width:"w-16"},{width:"w-16"}]).',
	'       * Empty: else if allCategoriaRows.length === 0 render <EmptyStateCTA tab="catalogo" canCreate={isAdmin} onCreate={openCreateCategoria} /> (no onAdoptPreset — matches the prior categorias/tipos empty states).',
	'       * Else render <CatalogoIncidenciasTable groups={catalogGroups} canEdit={isAdmin} onEditCategoria={openEditCategoria} onToggleCategoriaActive={toggleCategoriaActive} onCreateTipoInCategory={(k) => openCreateTipo(k)} onEditTipo={openEditTipo} onToggleTipoActive={toggleTipoActive} busy={pendingId !== null} pendingId={pendingId} />.',
	'  - TipoModal call at the bottom: add defaultCategoryKey={createTipoCategoryKey ?? undefined}. Keep categoryLabelMap={categoryLabels}.',
	'  - Keep categoryLabels memo (TipoModal still needs it). Remove any now-unused imports/vars (the page must lint clean: no unused CategoriaRow/TipoRow from the old modules, no unused categoryFilter/typeFilter).',
	'',
	'== File D (EDIT) src/components/catalog/CategoriaModal.tsx ==',
	'  - In EDIT mode only (isEdit / category !== null), add a READ-ONLY "ID interno" field inside the step content (e.g. directly above the Etiqueta field). Render a Label "ID interno" + <Input value={category.key} readOnly disabled className="font-mono text-xs" /> + a helper <p className="text-xs text-muted-foreground">Identificador del sistema. No editable.</p>. It is DISPLAY-ONLY: do NOT add it to the zod schema, the form, or the submit payload. The key remains immutable.',
	'',
	'== File E (EDIT) src/components/catalog/TipoModal.tsx ==',
	'  - Add an optional prop: defaultCategoryKey?: string. In the reset() effect, the CREATE-mode default object sets categoryKey: defaultCategoryKey ?? "". Add defaultCategoryKey to that effect dependency array (the effect early-returns when !open, so this is safe). The edit-mode branch is unchanged.',
	'  - In EDIT mode only (tipo !== null), add the same READ-ONLY "ID interno" field (value={tipo.key}, readOnly disabled, font-mono, helper "Identificador del sistema. No editable.") inside step 0 content. Display-only; not in schema/submit; key stays immutable.',
	'',
	'== File F (EDIT) src/components/catalog/EmptyStateCTA.tsx ==',
	'  - Change the tab union to: tab: "lineas" | "maquinas" | "catalogo".',
	'  - In COPY, REPLACE the categorias and tipos entries with a single catalogo entry: { heading: "Aún no hay catálogo de incidencias", body: "Crea tu primera categoría de incidentes para empezar. Después podrás añadir tipos dentro de cada categoría.", readOnlyBody: "Tu organización aún no tiene catálogo de incidencias configurado. Pide a un administrador que lo configure.", create: "Crear primera categoría" }. Keep lineas + maquinas entries.',
	'',
	'== File G (DELETE) ==',
	'  - Delete src/components/catalog/CategoriasTable.tsx and src/components/catalog/TiposTable.tsx (their CategoriaRow/TipoRow type exports moved to catalog-grouping.ts; the page was their ONLY importer). Use the Bash tool: cd into the worktree and `rm src/components/catalog/CategoriasTable.tsx src/components/catalog/TiposTable.tsx` (this is a file delete, not a git op — allowed). Confirm via grep that nothing else imports them.',
	'',
	'== File H (NEW) scripts/test-catalog-grouping.mjs — node:test via tsx ==',
	'  - Mirror scripts/test-catalog-key.mjs exactly: shebang-less, import { describe, it } from "node:test"; import assert from "node:assert/strict"; import { groupCatalog, applyActiveFilter, ORPHAN_GROUP_KEY } from "../src/lib/catalog-grouping.ts";',
	'  - Cover: (1) types group under the correct category header; group order by sortOrder then key. (2) types within a group ordered by sortOrder then key. (3) filter "todos" includes inactive categories and inactive types. (4) filter "activos" excludes inactive categories AND inactive types. (5) an orphan type (categoryKey not among categories) lands in the ORPHAN_GROUP_KEY group labeled "Sin categoría" and is never dropped. (6) a type under a filtered-OUT (inactive) category does not appear under "activos" and is NOT placed in the orphan group. (7) an active category with zero types still yields a group with an empty types array. Each test must FAIL if the grouping logic regresses.',
	'  - OPTIONAL: add a "test:catalog-grouping": "tsx --test scripts/test-catalog-grouping.mjs" entry to package.json for parity with the other test:* scripts. If package.json is blocked by a protection hook, SKIP it — scripts/run-all-tests.mjs auto-discovers every scripts/test-*.mjs, so the suite runs regardless.',
].join('\n')

const GATES = [
	'GATES (run from inside the worktree; report the REAL exit codes — do not claim green without running):',
	'1. New unit test: cd "' + WT + '" then  npx tsx --test scripts/test-catalog-grouping.mjs   — must pass (all assertions green).',
	'2. Lint: npm run lint   — must be clean (0 errors). Fix any error you introduced.',
	'3. Build: npm run build   (this is tsc -b && vite build) — must exit 0. Fix any type/build regression IN PLACE.',
	'Iterate until all three are green. Do NOT run the full `npm test` (≈70 backend suites, slow, and unaffected by this frontend-only change) — the targeted unit test + build cover this change.',
].join('\n')

// ───────────────────────── Phase 1: Implement ─────────────────────────
phase('Implement')

const IMPL_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		status: { type: 'string', enum: ['DONE', 'DONE_WITH_CONCERNS', 'BLOCKED', 'NEEDS_CONTEXT'] },
		filesChanged: { type: 'array', items: { type: 'string' } },
		filesDeleted: { type: 'array', items: { type: 'string' } },
		testExit: { type: 'number' },
		lintExit: { type: 'number' },
		buildExit: { type: 'number' },
		buildTail: { type: 'string' },
		summary: { type: 'string' },
		concerns: { type: 'array', items: { type: 'string' } },
	},
	required: ['status', 'filesChanged', 'testExit', 'lintExit', 'buildExit', 'summary'],
}

const impl = await agent(
	[
		'You are the implementation engineer for a Sentria (React 19 + Vite + TS strict) presentation-layer feature. Read every file you touch IN FULL before editing.',
		'',
		GROUND_RULES,
		'',
		DESIGN,
		'',
		GATES,
		'',
		'When done, return the structured result: status (DONE only if test+lint+build all exit 0), the list of files changed and deleted, the three exit codes, the last ~15 lines of the build output, a 2-4 sentence summary, and any concerns.',
	].join('\n'),
	{ label: 'implement', phase: 'Implement', agentType: 'frontend', schema: IMPL_SCHEMA },
)

log('Implement: status=' + (impl?.status ?? 'null') + ' test=' + (impl?.testExit) + ' lint=' + (impl?.lintExit) + ' build=' + (impl?.buildExit))

// ───────────────────────── Phase 2: Review (3 parallel read-only lenses) ─────────────────────────
phase('Review')

const FINDINGS_SCHEMA = {
	type: 'object',
	additionalProperties: false,
	properties: {
		verdict: { type: 'string', enum: ['PASS', 'PASS_WITH_CONCERNS', 'FAIL'] },
		findings: {
			type: 'array',
			items: {
				type: 'object',
				additionalProperties: false,
				properties: {
					severity: { type: 'string', enum: ['Critical', 'Important', 'Minor'] },
					file: { type: 'string' },
					line: { type: 'string' },
					issue: { type: 'string' },
					suggestedFix: { type: 'string' },
				},
				required: ['severity', 'issue'],
			},
		},
	},
	required: ['verdict', 'findings'],
}

const reviewCommon = [
	GROUND_RULES,
	'',
	'You are a READ-ONLY adversarial reviewer. Do NOT edit, build, or run any mutating command. You MAY run read-only commands: Read files, Grep, and `git -C "' + WT + '" diff origin/sentria-qc` / `git -C "' + WT + '" status` to see the change set.',
	'Review the implemented change in the worktree against the LOCKED DESIGN below. Report ONLY actionable findings with severity. NEVER dismiss a finding as acceptable/carry-over/MVP. Be aggressive and specific (file + line + concrete fix).',
	'',
	DESIGN,
].join('\n')

const reviews = await parallel([
	() => agent(
		[
			reviewCommon,
			'',
			'YOUR LENS — HARD CONSTRAINTS + PLAN COMPLIANCE. Verify each, flag any miss:',
			'1. The catalog `key` ("clave") is the IMMUTABLE system FK spine (it is the DynamoDB id of the form org#category#key / org#type#key, stored on every Incident and on Technician arrays; the Telegram bot routes on it; reports group on it). It must NEVER be removed from the data model. Confirm: CategoriaRow/TipoRow STILL carry `key`; mutations still auto-derive `key` on create and never send it on update; groupCatalog keys on it. Only the COLUMN is hidden. FAIL if `key` was dropped from any row type or mutation.',
			'2. "ID interno" field is present in EDIT mode of BOTH CategoriaModal and TipoModal, is READ-ONLY (readOnly AND disabled), shows the real key, and is NOT in any zod schema or submit payload. FAIL if editable or if it leaks into the submit.',
			'3. NO "Clave" column remains anywhere in the catalog UI. The unified type rows are exactly: Etiqueta | SLA respuesta | SLA resolución | Estado | Acciones (admin). No Categoría column either.',
			'4. Category→type integrity preserved: TipoModal still picks from ACTIVE categories only; "+ tipo" is gated to ACTIVE category headers; nothing weakened the server FK validation path. Deactivating a category must not regress the bot active-filter (no amplify/** changes).',
			'5. NO hard delete anywhere. Only soft-delete (toggle active via deactivate*/update active). FAIL on any new delete path.',
			'6. Tab is labeled exactly "Catálogo de incidencias" (NOT bare "Incidencias"). Final tabs: Líneas de Producción | Máquinas | Catálogo de incidencias.',
			'7. Deep-link back-compat: legacy ?tab=categorias and ?tab=tipos still resolve to the catalogo tab (activeTab mapping).',
			'8. EmptyStateCTA updated (catalogo variant; no dangling categorias/tipos references). Old CategoriasTable.tsx + TiposTable.tsx DELETED with NO remaining importers (grep to confirm). No dead code, no orphaned imports.',
			'Return verdict + findings.',
		].join('\n'),
		{ label: 'review:constraints', phase: 'Review', agentType: 'analyst', schema: FINDINGS_SCHEMA },
	),
	() => agent(
		[
			reviewCommon,
			'',
			'YOUR LENS — REACT 19 + TYPESCRIPT-STRICT + STACK CORRECTNESS:',
			'- Hooks rules: no conditionally-called hooks; useMemo/useState/useCallback dependency arrays are correct and complete (esp. catalogGroups deps, the TipoModal reset effect now including defaultCategoryKey, the page filter/group memos). Flag stale-closure or missing-dep bugs.',
			'- TypeScript strict: NO any, NO "as" casts (except a genuine type guard), NO @ts-ignore introduced. motion.tr / AnimatePresence typings resolve cleanly.',
			'- Named exports only; @/ alias used; kebab-case for the new lib file, PascalCase for the new component. No default exports.',
			'- Framer Motion is ACTUALLY used for the collapse/expand affordance (AnimatePresence on type rows + animated chevron) — not a static toggle. Default state is ALL groups EXPANDED.',
			'- No useEffect used for DATA loading (data comes from TanStack Query hooks). The modal form-reset effects are fine.',
			'- Accessibility: chevron button has aria-expanded + aria-label; icon action buttons have title/aria-label; the table remains keyboard-usable.',
			'- The new lib module catalog-grouping.ts has NO @/ or runtime imports (so tsx can import it). Flag any import that would break the node:test.',
			'Return verdict + findings.',
		].join('\n'),
		{ label: 'review:react-stack', phase: 'Review', agentType: 'analyst', schema: FINDINGS_SCHEMA },
	),
	() => agent(
		[
			reviewCommon,
			'',
			'YOUR LENS — DATA/EDGE CORRECTNESS + the unit test:',
			'- groupCatalog: orphan types (categoryKey with no matching category) are NEVER dropped — they appear under the "Sin categoría" group. Ordering honors sortOrder then key at BOTH the category and type level. An active category with zero types still renders a header (empty group).',
			'- Filter semantics are coherent and intentional: under "activos", inactive categories and inactive types are hidden; a type under a filtered-out category is hidden (not orphaned). Confirm the code matches this and the test asserts it.',
			'- Optimistic-concurrency: updatedAt is still threaded through every toggle/edit (deactivate*/update calls carry updatedAt). Flag if dropped.',
			'- The "all categories deactivated" amber warning banner is preserved in the unified tab.',
			'- The new test scripts/test-catalog-grouping.mjs genuinely imports the real module via a relative path and would FAIL if grouping regresses (open it and check the assertions are meaningful, not tautological). Confirm run-all-tests.mjs will auto-discover it.',
			'- Loading + empty + error states all still render correctly in the unified tab (combined loading; empty when zero categories; the page-level isError path unchanged).',
			'Return verdict + findings.',
		].join('\n'),
		{ label: 'review:edge', phase: 'Review', agentType: 'analyst', schema: FINDINGS_SCHEMA },
	),
])

const allFindings = reviews.filter(Boolean).flatMap((r) => (r.findings || []).map((f) => ({ ...f, lens: r.verdict })))
const blocking = allFindings.filter((f) => f.severity === 'Critical' || f.severity === 'Important')
log('Review: ' + allFindings.length + ' findings (' + blocking.length + ' Critical/Important)')

// ───────────────────────── Phase 3: Fix (conditional) ─────────────────────────
phase('Fix')

let fix = null
if (blocking.length > 0) {
	fix = await agent(
		[
			'You are the fix engineer. Resolve the confirmed Critical/Important review findings on the implemented Sentria catalog change, in the worktree.',
			'',
			GROUND_RULES,
			'',
			'FINDINGS TO FIX (JSON):',
			JSON.stringify(blocking, null, 2),
			'',
			'For each finding: read the affected file in full, apply the smallest correct fix matching existing style, and where a finding implies a grouping-logic bug, extend scripts/test-catalog-grouping.mjs with a regression assertion that fails without the fix.',
			'',
			GATES,
			'',
			'Return the structured result (same shape as the implementer): status DONE only if test+lint+build all exit 0, files changed, the three exit codes, build tail, summary, and any remaining concerns.',
		].join('\n'),
		{ label: 'fix', phase: 'Fix', agentType: 'frontend', schema: IMPL_SCHEMA },
	)
	log('Fix: status=' + (fix?.status ?? 'null') + ' test=' + (fix?.testExit) + ' lint=' + (fix?.lintExit) + ' build=' + (fix?.buildExit))
} else {
	log('Fix: skipped — no Critical/Important findings')
}

return {
	implement: impl,
	reviewVerdicts: reviews.filter(Boolean).map((r) => r.verdict),
	findings: allFindings,
	blockingCount: blocking.length,
	fix,
}
