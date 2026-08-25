import { useParams } from 'react-router-dom'
import { TasksPage } from '@/modules/tasks/TasksPage'

/**
 * Thin wrapper mounted at /tasks/lists/:listId — the outliner's new home
 * (R5 PR-1, docs/v2/.flow/R5-foundation-today/flow-plan.md item 8).
 *
 * FALLBACK CHOICE (documented per the plan's explicit escape hatch): this PR
 * does NOT scope TasksPage's query to `listId`. TasksPage.tsx is a 997-line
 * component and retrofitting list-scoping into its fetch/store wiring safely,
 * within this PR's budget, was judged riskier than the alternative the plan
 * names as acceptable — leaving TasksPage's fetch exactly as unscoped as it
 * is today. D-3 only requires "nothing about the outliner's behaviour
 * changes", and an unscoped outliner at a new URL is behaviour-identical to
 * the pre-R5 outliner, just addressed differently. Real list-scoping is
 * deferred to PR-3, which touches TasksPage anyway to add its designed chrome
 * (band/rail/members) — the right time to also thread `listId` through.
 *
 * `listId` is read here (not just ignored) so the route param exists and
 * TypeScript/eslint don't flag an unused destructure — it is intentionally
 * not passed to TasksPage yet.
 */
export function TasksOutlinerPage() {
  useParams<{ listId: string }>()
  return <TasksPage />
}
