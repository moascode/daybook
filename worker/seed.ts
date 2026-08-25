// Port of server/seed.ts to D1. The category and settings data is identical —
// keep the two lists in sync until Phase 7 retires the server copy.
//
// The only structural change: better-sqlite3's `db.transaction(fn)` becomes
// `db.batch([...])`. D1 has no interactive transactions, but it does run a
// batch as a single atomic unit, which is all this needed — there are no reads
// between the writes and nothing conditional. This is the "easy" conversion
// class described in docs/option-2-workers-d1-plan.md §5.5.

interface SeedCategory {
  name: string
  icon: string
  color: string
  type: 'income' | 'expense' | 'both'
}

// Mirrors src/db/seed.ts so each new user gets the same default categories the
// client used in the PGlite era.
const EXPENSE_CATEGORIES: SeedCategory[] = [
  { name: 'Food & Drink', icon: 'utensils', color: '#ef4444', type: 'expense' },
  { name: 'Transport', icon: 'car', color: '#f97316', type: 'expense' },
  { name: 'Shopping', icon: 'shopping-bag', color: '#eab308', type: 'expense' },
  { name: 'Bills & Utilities', icon: 'zap', color: '#84cc16', type: 'expense' },
  { name: 'Health', icon: 'heart-pulse', color: '#22c55e', type: 'expense' },
  { name: 'Entertainment', icon: 'gamepad-2', color: '#14b8a6', type: 'expense' },
  { name: 'Travel', icon: 'plane', color: '#06b6d4', type: 'expense' },
  { name: 'Education', icon: 'graduation-cap', color: '#3b82f6', type: 'expense' },
  { name: 'Personal Care', icon: 'sparkles', color: '#8b5cf6', type: 'expense' },
  { name: 'Other', icon: 'tag', color: '#6b7280', type: 'expense' },
]

const INCOME_CATEGORIES: SeedCategory[] = [
  { name: 'Salary', icon: 'banknote', color: '#1D9E75', type: 'income' },
  { name: 'Freelance', icon: 'laptop', color: '#10b981', type: 'income' },
  { name: 'Investment', icon: 'trending-up', color: '#059669', type: 'income' },
  { name: 'Gift', icon: 'gift', color: '#34d399', type: 'income' },
  { name: 'Other Income', icon: 'plus-circle', color: '#6ee7b7', type: 'income' },
]

interface SeedTaskList {
  name: string
  color: string
}

// docs/v2/tasks/01-data-model.md §3 — matches the proposal's sidebar. Keep in
// sync with server/seed.ts.
const DEFAULT_TASK_LISTS: SeedTaskList[] = [
  { name: 'Household', color: '#2F6FEB' },
  { name: 'Work', color: '#8b5cf6' },
  { name: 'Errands', color: '#f97316' },
  { name: 'Someday', color: '#6b7280' },
]

/** Seed the default categories + task lists + settings for a freshly created user. */
export async function seedUserDefaults(db: D1Database, userId: string): Promise<void> {
  const all = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]

  const insertCategory = db.prepare(
    'INSERT INTO categories (user_id, name, icon, color, type) VALUES (?, ?, ?, ?, ?)',
  )
  const insertTaskList = db.prepare(
    'INSERT INTO task_lists (user_id, name, color, sort_order) VALUES (?, ?, ?, ?)',
  )
  const insertSetting = db.prepare(
    'INSERT INTO settings (user_id, key, value) VALUES (?, ?, ?) ON CONFLICT (user_id, key) DO NOTHING',
  )

  // 22 statements, fixed size — well inside the batch limits S2 measured
  // (5,000 statements / 1.3 MB in a single batch, ~10× real-world headroom).
  await db.batch([
    ...all.map((c) => insertCategory.bind(userId, c.name, c.icon, c.color, c.type)),
    ...DEFAULT_TASK_LISTS.map((l, i) => insertTaskList.bind(userId, l.name, l.color, i)),
    insertSetting.bind(userId, 'default_currency', 'MYR'),
    insertSetting.bind(userId, 'theme', 'light'),
    insertSetting.bind(userId, 'hide_completed', '0'),
  ])
}
