import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  BookOpen,
  CheckSquare,
  Wallet,
  Upload,
  BarChart3,
  Users,
  Settings as SettingsIcon,
  Keyboard,
  Rocket,
  ArrowRight,
  ArrowRightLeft,
} from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * In-app user guide — the single source of truth for user-facing docs. Rendered
 * as native components (no markdown dependency) to stay within the approved
 * stack. When the app's behaviour changes, update the relevant section below.
 */

// ── Small presentational helpers ─────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-line-strong bg-surface-sunken px-1.5 py-0.5 text-[11px] font-medium text-fg-muted">
      {children}
    </kbd>
  )
}

function DeepLink({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate()
  return (
    <button
      onClick={() => navigate(to)}
      className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-brand-50 px-3 py-1.5 text-xs font-medium text-brand-700 transition-colors hover:bg-brand-100"
    >
      {label}
      <ArrowRight className="h-3.5 w-3.5" />
    </button>
  )
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm leading-relaxed text-fg-muted">{children}</p>
}

function UL({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-fg-muted">{children}</ul>
}

// ── Section definitions ──────────────────────────────────

interface Section {
  id: string
  title: string
  icon: React.ReactNode
  body: React.ReactNode
}

const SECTIONS: Section[] = [
  {
    id: 'getting-started',
    title: 'Getting Started',
    icon: <Rocket className="h-4 w-4" />,
    body: (
      <div className="space-y-3">
        <P>
          Daybook keeps your <strong>tasks</strong> and your <strong>money</strong> in one place. It
          runs on your own hardware; any device on your network can sign in, and each account&apos;s
          data is private unless you deliberately share it.
        </P>
        <UL>
          <li><strong>New here?</strong> Choose <em>Create account</em>, pick a username and a password (at least 6 characters).</li>
          <li><strong>Returning?</strong> Enter your username and password and choose <em>Sign in</em>.</li>
          <li>The left <strong>sidebar</strong> navigates between Tasks, Wallet, and Settings. On a phone it becomes a slide-in drawer.</li>
          <li>The first time a module is empty, a dismissible <strong>Welcome card</strong> gives you a quick tip.</li>
        </UL>
      </div>
    ),
  },
  {
    id: 'tasks',
    title: 'Tasks',
    icon: <CheckSquare className="h-4 w-4" />,
    body: (
      <div className="space-y-3">
        <P>
          The Tasks page is an <strong>outliner</strong>: an infinitely nestable bulleted list. Every
          bullet can have children.
        </P>
        <UL>
          <li>Press <Kbd>Enter</Kbd> (or <em>New task</em>) to add an item; click any bullet to edit it inline.</li>
          <li><Kbd>Tab</Kbd> indents, <Kbd>Shift</Kbd>+<Kbd>Tab</Kbd> outdents; <Kbd>Backspace</Kbd> on an empty line deletes it.</li>
          <li>Each bullet has an expandable <strong>note</strong>. Completed tasks show struck-through; toggle <em>Hide done</em> to filter them.</li>
          <li>Give a task a <strong>due date</strong>, then use <em>Sort by due date</em> to reorder.</li>
          <li>Click a bullet&apos;s dot to <strong>zoom in</strong> (focus on its subtree); the breadcrumb takes you back.</li>
          <li><strong>Drag &amp; drop</strong> to reorder or re-nest. <strong>Search</strong> (<Kbd>⌘F</Kbd>) across all text and notes.</li>
          <li><em>Select</em> mode lets you multi-select and bulk-delete; every delete is reversible via the <strong>Undo</strong> toast.</li>
          <li>Save any bullet as a <strong>Template</strong> and re-apply it later.</li>
        </UL>
        <DeepLink to="/tasks" label="Open Tasks" />
      </div>
    ),
  },
  {
    id: 'wallet',
    title: 'Accounts & Transactions',
    icon: <Wallet className="h-4 w-4" />,
    body: (
      <div className="space-y-3">
        <P>
          <strong>Accounts</strong> hold your money. Each shows a live balance:{' '}
          <em>opening balance + income − expenses</em>. Transfers move money between accounts and
          don&apos;t count as income or expense. Deleting an account also deletes its transactions
          (Daybook confirms first). The Accounts page also shows your <strong>Total Net Worth</strong>.
        </P>
        <P>
          <strong>Transactions</strong> are your day-to-day ledger, grouped by day with per-day totals.
          Add one with a type (Expense / Income / Transfer), date, amount, account, merchant,
          category, and one or more <strong>tags</strong>. For a transfer, pick a second
          &ldquo;To&rdquo; account (category and tags are hidden). <em>Save &amp; Add Another</em>
          keeps the form open for rapid entry. Deleting a single transaction offers an <strong>Undo</strong> toast.
        </P>
        <P>
          Use the <strong>filter bar</strong> to narrow by date range, type, category, account, and
          tag, plus free-text search — active filters appear as removable chips.
        </P>
        <DeepLink to="/wallet" label="Open Transactions" />
      </div>
    ),
  },
  {
    id: 'csv',
    title: 'CSV Import',
    icon: <Upload className="h-4 w-4" />,
    body: (
      <div className="space-y-3">
        <P>Bring in bank transactions via a step-by-step flow:</P>
        <UL>
          <li><strong>Upload</strong> a CSV (you need at least one account first).</li>
          <li><strong>Map Columns</strong> — Daybook auto-detects date, amount, and description/merchant; adjust if needed.</li>
          <li><strong>Review Import</strong> — edit rows and exclude any you don&apos;t want. <strong>Duplicates</strong> (already-imported rows) are detected and pre-excluded.</li>
          <li><strong>Confirm</strong>, then see a summary of imported vs. skipped rows.</li>
        </UL>
        <P>
          Duplicate detection fingerprints each row (date + amount + merchant), so re-importing the
          same statement won&apos;t create doubles.
        </P>
        <DeepLink to="/wallet/import" label="Open CSV Import" />
      </div>
    ),
  },
  {
    id: 'transfers',
    title: 'Credit Cards & Transfers',
    icon: <ArrowRightLeft className="h-4 w-4" />,
    body: (
      <div className="space-y-3">
        <P>
          A payment between your own accounts — e.g. paying a credit card from your bank — is{' '}
          <strong>one transfer</strong>, not an expense plus an income. Record the card{' '}
          <em>purchases</em> as expenses on the card account; record the <em>payment</em> as a
          transfer from the bank to the card. Transfers are excluded from income and expense
          totals, so nothing is double-counted.
        </P>
        <UL>
          <li>
            <strong>Import as transfer</strong> — in the CSV review step, set a row&apos;s Type to{' '}
            <em>Transfer</em> and pick the destination account. The row imports as a single
            transfer instead of an expense or income.
          </li>
          <li>
            <strong>Link as transfer</strong> — already imported both sides? Edit either row:
            Daybook checks automatically for the matching opposite leg (same amount, another
            account, within a few days) and offers to merge the two rows into one transfer. If
            nothing matches automatically, a <em>Link as transfer…</em> button still lets you
            search by hand. Re-importing either statement later still detects the merged rows as
            duplicates.
          </li>
          <li>
            <strong>New Transaction → Transfer</strong> also checks for this automatically: if
            an unlinked expense or income already matches the accounts, amount and date you've
            entered, a suggestion appears to link it instead of adding a second, duplicate row.
          </li>
        </UL>
        <P>
          If the two legs differ in amount (a fee or FX spread), they can&apos;t be linked as a
          single transfer — record them separately instead.
        </P>
        <DeepLink to="/wallet" label="Open Wallet" />
      </div>
    ),
  },
  {
    id: 'planning',
    title: 'Planning & Analysis',
    icon: <BarChart3 className="h-4 w-4" />,
    body: (
      <div className="space-y-3">
        <UL>
          <li><strong>Dashboard</strong> — over a date range: upcoming bills, cash flow by week, spending by category and by account, and top merchants.</li>
          <li><strong>Budgets</strong> — set a monthly limit per category and track how much you&apos;ve spent.</li>
          <li><strong>Goals</strong> — a savings target tied to an account; progress tracks that account&apos;s balance.</li>
          <li><strong>Recurring</strong> — repeating transactions (weekly/monthly) that <em>auto-post</em> when due, on your own accounts.</li>
          <li><strong>Reports</strong> — year-on-year comparison and a custom date range.</li>
          <li><strong>Export</strong> — download your (filtered) transactions as a backup.</li>
        </UL>
        <DeepLink to="/wallet/dashboard" label="Open Dashboard" />
      </div>
    ),
  },
  {
    id: 'sharing',
    title: 'Sharing (Households)',
    icon: <Users className="h-4 w-4" />,
    body: (
      <div className="space-y-3">
        <P>
          Sharing is <strong>opt-in</strong>. Manage it under <em>Settings → Sharing</em>; shared data
          lives under <em>Wallet → Shared</em>.
        </P>
        <UL>
          <li><strong>Groups</strong> — create a group and <strong>invite</strong> people by username; they accept or decline.</li>
          <li><strong>Shared accounts</strong> — share an account with a group as read-only or with write access. Ownership stays with you.</li>
          <li><strong>Split a transaction</strong> — <em>Keep as-is</em> (they owe it all), <em>Split equally</em>, or <em>Custom</em> amounts. Shares rescale if you edit the amount.</li>
          <li><strong>Settle up</strong> — records real ledger transactions on both sides; settlements can be undone.</li>
        </UL>
        <P>Non-members never see your shared accounts or splits.</P>
        <DeepLink to="/settings/sharing" label="Open Sharing settings" />
      </div>
    ),
  },
  {
    id: 'settings',
    title: 'Settings',
    icon: <SettingsIcon className="h-4 w-4" />,
    body: (
      <div className="space-y-3">
        <UL>
          <li><strong>Account</strong> — sign out.</li>
          <li><strong>Appearance</strong> — choose a theme: Light, Dark, or System (follows your device). The sun/moon button in the top bar flips between light and dark in one click.</li>
          <li><strong>Finance</strong> — currency is Malaysian Ringgit (MYR); Daybook is single-currency for now.</li>
          <li><strong>Sharing</strong> — the household features above.</li>
        </UL>
        <DeepLink to="/settings" label="Open Settings" />
      </div>
    ),
  },
  {
    id: 'shortcuts',
    title: 'Keyboard Shortcuts',
    icon: <Keyboard className="h-4 w-4" />,
    body: (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wide text-fg-faint">
              <th className="py-2 pr-4 font-medium">Key</th>
              <th className="py-2 font-medium">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line-subtle">
            {[
              [<Kbd key="k">Enter</Kbd>, 'New sibling task below'],
              [<Kbd key="k">Tab</Kbd>, 'Indent (make child)'],
              [<><Kbd>Shift</Kbd> + <Kbd>Tab</Kbd></>, 'Outdent'],
              [<Kbd key="k">Backspace</Kbd>, 'Delete an empty task and move up'],
              [<><Kbd>⌘</Kbd> / <Kbd>Ctrl</Kbd> + <Kbd>F</Kbd></>, 'Focus the task search box'],
              [<Kbd key="k">Esc</Kbd>, 'Clear the task search'],
            ].map(([key, action], i) => (
              <tr key={i}>
                <td className="whitespace-nowrap py-2.5 pr-4">{key}</td>
                <td className="py-2.5 text-fg-muted">{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    ),
  },
]

// ── Page ─────────────────────────────────────────────────

export function HelpPage() {
  const [activeId, setActiveId] = useState(SECTIONS[0].id)
  const sectionRefs = useRef<Record<string, HTMLElement | null>>({})

  // Scroll-spy: highlight the TOC entry for the section nearest the top.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        if (visible[0]) setActiveId(visible[0].target.id)
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 },
    )
    Object.values(sectionRefs.current).forEach((el) => el && observer.observe(el))
    return () => observer.disconnect()
  }, [])

  const scrollTo = (id: string) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setActiveId(id)
  }

  return (
    <div className="mx-auto max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-500 text-fg-on-accent">
          <BookOpen className="h-5 w-5" />
        </div>
        <div>
          <h1 className="text-lg font-bold text-fg">Help &amp; Guide</h1>
          <p className="text-sm text-fg-subtle">Everything you can do in Daybook.</p>
        </div>
      </div>

      {/* Mobile TOC — quick jump */}
      <div className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            onClick={() => scrollTo(s.id)}
            className={cn(
              'whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
              activeId === s.id
                ? 'border-brand-400 bg-brand-50 text-brand-700'
                : 'border-line text-fg-subtle hover:bg-surface-sunken',
            )}
          >
            {s.title}
          </button>
        ))}
      </div>

      <div className="flex gap-8">
        {/* Sticky TOC — desktop */}
        <nav className="sticky top-2 hidden h-fit w-52 shrink-0 lg:block">
          <ul className="space-y-0.5">
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => scrollTo(s.id)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors',
                    activeId === s.id
                      ? 'bg-brand-50 text-brand-700'
                      : 'text-fg-subtle hover:bg-surface-sunken hover:text-fg',
                  )}
                >
                  <span className="shrink-0">{s.icon}</span>
                  {s.title}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        {/* Content */}
        <div className="min-w-0 flex-1 space-y-8">
          {SECTIONS.map((s) => (
            <section
              key={s.id}
              id={s.id}
              ref={(el) => { sectionRefs.current[s.id] = el }}
              className="scroll-mt-4 rounded-xl border border-line bg-surface p-5"
            >
              <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-fg">
                <span className="text-brand-500">{s.icon}</span>
                {s.title}
              </h2>
              {s.body}
            </section>
          ))}

          <p className="pb-4 text-center text-xs text-fg-faint">
            Daybook — home-network release. AI assistance and cloud hosting are planned for later.
          </p>
        </div>
      </div>
    </div>
  )
}
