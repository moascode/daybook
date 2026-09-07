import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { visibleAccountIds } from '../lib/sharing.ts'

// Global search (R17 §1). Mounted on protectedApi — every result is scoped to
// what this user can already see.
//
// No search infrastructure: LIKE over the indexed columns is enough at this
// data size, exactly as the spec says. FTS5 is available in D1 if it ever
// isn't, but adding it now would be machinery for a table with hundreds of
// rows, not millions.
export const search = new Hono<AppEnv>()

const LIMIT_PER_GROUP = 6
const MIN_QUERY = 2

export type SearchGroup = 'transactions' | 'tasks' | 'accounts'

export interface SearchHit {
  group: SearchGroup
  id: string
  title: string
  subtitle: string
  url: string
}

/** Escapes LIKE's own wildcards so a literal % or _ searches for itself. */
function likeTerm(q: string): string {
  return `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`
}

search.get('/search', async (c) => {
  const q = (c.req.query('q') ?? '').trim()
  const scope = (c.req.query('scope') ?? 'all') as SearchGroup | 'all'
  if (q.length < MIN_QUERY) return c.json({ hits: [], query: q })

  const userId = c.get('userId')
  const term = likeTerm(q)
  const wants = (g: SearchGroup) => scope === 'all' || scope === g

  // Transactions are the one group that can span accounts shared IN from
  // someone else, so they are scoped by visibleAccountIds rather than by
  // user_id — the same rule the transaction list itself uses. Tasks and
  // accounts are owned outright.
  const visible = wants('transactions') ? [...(await visibleAccountIds(c.env.DB, userId))] : []

  const statements = []
  if (wants('transactions') && visible.length > 0) {
    const placeholders = visible.map(() => '?').join(', ')
    statements.push({
      group: 'transactions' as const,
      stmt: c.env.DB.prepare(
        `SELECT t.id AS id, t.merchant AS a, t.description AS b, t.date AS c, t.amount AS d
           FROM transactions t
          WHERE t.account_id IN (${placeholders})
            AND (t.merchant LIKE ? ESCAPE '\\' OR t.description LIKE ? ESCAPE '\\')
          ORDER BY t.date DESC
          LIMIT ${LIMIT_PER_GROUP}`,
      ).bind(...visible, term, term),
    })
  }
  if (wants('tasks')) {
    statements.push({
      group: 'tasks' as const,
      stmt: c.env.DB.prepare(
        `SELECT id, content AS a, note AS b, due_date AS c, is_completed AS d
           FROM tasks
          WHERE user_id = ?
            AND (content LIKE ? ESCAPE '\\' OR note LIKE ? ESCAPE '\\')
          ORDER BY is_completed ASC, updated_at DESC
          LIMIT ${LIMIT_PER_GROUP}`,
      ).bind(userId, term, term),
    })
  }
  if (wants('accounts')) {
    statements.push({
      group: 'accounts' as const,
      stmt: c.env.DB.prepare(
        `SELECT id, name AS a, description AS b, type AS c, 0 AS d
           FROM accounts
          WHERE user_id = ?
            AND (name LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')
          ORDER BY name
          LIMIT ${LIMIT_PER_GROUP}`,
      ).bind(userId, term, term),
    })
  }

  if (statements.length === 0) return c.json({ hits: [], query: q })

  const results = await c.env.DB.batch<{ id: string; a: string; b: string; c: string; d: number }>(
    statements.map((s) => s.stmt),
  )

  const hits: SearchHit[] = []
  statements.forEach((s, i) => {
    for (const row of results[i].results) {
      if (s.group === 'transactions') {
        hits.push({
          group: 'transactions',
          id: row.id,
          title: row.a || '(no merchant)',
          subtitle: `${row.c} · RM${Number(row.d).toFixed(2)}${row.b ? ` · ${row.b}` : ''}`,
          url: '/wallet',
        })
      } else if (s.group === 'tasks') {
        hits.push({
          group: 'tasks',
          id: row.id,
          title: row.a || '(untitled)',
          subtitle: [Number(row.d) === 1 ? 'Completed' : null, row.c ? `Due ${row.c}` : null, row.b || null]
            .filter(Boolean)
            .join(' · '),
          url: Number(row.d) === 1 ? '/tasks/completed' : '/tasks/all',
        })
      } else {
        hits.push({
          group: 'accounts',
          id: row.id,
          title: row.a,
          subtitle: [row.c, row.b || null].filter(Boolean).join(' · '),
          url: '/wallet/accounts',
        })
      }
    }
  })

  return c.json({ hits, query: q })
})
