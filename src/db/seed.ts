import type { PGlite } from '@electric-sql/pglite'
import { generateId } from '@/lib/utils'

interface SeedCategory {
  name: string
  icon: string
  color: string
  type: 'income' | 'expense' | 'both'
}

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

export async function seedCategories(db: PGlite): Promise<void> {
  const all = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]

  const values = all
    .map((c) => {
      const id = generateId()
      return `('${id}', '${c.name}', '${c.icon}', '${c.color}', '${c.type}')`
    })
    .join(',\n    ')

  await db.exec(`
    INSERT INTO categories (id, name, icon, color, type)
    VALUES ${values};
  `)
}
