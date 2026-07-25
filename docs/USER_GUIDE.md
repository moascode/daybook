<!--
  This guide is mirrored in-app at /help (src/modules/help/HelpPage.tsx).
  When the app's behaviour changes, update BOTH this file and that page so the
  written guide and the in-app guide stay in sync.
-->

# Daybook — User Guide

Daybook is your personal **productivity + finance** app. It keeps two things in
one place:

- **Tasks** — a Workflowy-style outliner for everything you need to do.
- **Wallet** — accounts, transactions, budgets, goals, and reports for your money.

Everything runs on your own hardware (a small Node server + SQLite database on
your home network). Any device on your WiFi can sign in. The primary currency
is **Malaysian Ringgit (MYR)**.

---

## 1. Getting Started

### Signing in

When you first open Daybook you'll see the **Sign in** screen.

- **New here?** Choose **Create account**, pick a username and a password
  (at least 6 characters), confirm the password, and you're in.
- **Returning?** Enter your username and password and choose **Sign in**.

Each account has its own private data. Nothing you enter is visible to other
users unless you deliberately share it (see [Sharing](#6-sharing-households)).

> Use the eye icon in the password field to show/hide what you're typing.

### Finding your way around

The left **sidebar** is your main navigation:

| Item | What it is |
|---|---|
| **Tasks** | The outliner. |
| **Wallet** | Expands into all the money pages (see below). |
| **Settings** | Preferences, sign out, and Sharing. |

The Wallet section groups its pages by how often you use them:

- **Daily** — Transactions, Dashboard, Accounts, Shared
- **Planning** — Budgets, Goals, Recurring
- **Analyse** — Reports
- **Data** — Import CSV

On a phone the sidebar becomes a slide-in drawer — tap the menu button to open it.

### First-run welcome cards

The first time a module is empty, Daybook shows a short **Welcome card** with
orientation tips. Dismiss it once and it stays dismissed for your account.

---

## 2. Tasks

The Tasks page is an **outliner**: an infinitely nestable bulleted list, like
Workflowy. Everything is a bullet, and any bullet can have children.

### Adding and editing

- Click **New task** (or press **Enter** on an existing line) to add an item.
- Click any bullet's text to edit it inline.
- Press **Enter** at the end of a line to create a new sibling below.
- Press **Tab** to indent (make it a child of the line above); **Shift+Tab** to
  outdent.
- Press **Backspace** on an empty line to delete it and move up.

### Notes

Each bullet can hold an expandable **note** — a longer free-text field beneath
the line. Use the note icon on a bullet to show or hide it.

### Completing tasks

- Toggle a task complete/incomplete from its row. Completed tasks show with a
  strikethrough.
- Use **Hide done / Show done** in the toolbar to hide or reveal completed items.

### Due dates and sorting

- Give a task a **due date** from its row menu.
- Toggle **Sort by due date** in the toolbar to order the current list by
  due date instead of your manual order. Toggle it off to return to your
  arrangement.

### Zooming in (focus mode)

Click a bullet's dot to **zoom in** — that task becomes the temporary "root" and
its children fill the screen. A breadcrumb at the top shows the path back; click
the **Home** icon (or any crumb) to zoom back out. Your zoom position is
remembered.

### Reordering (drag & drop)

Drag a bullet to reorder it within its list or to move it under another bullet.

### Searching

Use the search box (or press **⌘F / Ctrl+F**) to search across all task text and
notes. Matching text is highlighted, and each result shows its location path.
Click a result to jump straight to it. Press **Esc** to clear the search.

### Selecting and bulk-deleting

Click **Select** to enter multi-select mode:

- Tick tasks to select them. Selecting a parent selects its whole subtree.
- Click **Delete N** to remove them all at once.
- Click **Cancel** to leave select mode without deleting.

### Undo

Deletes (single or bulk) are **instantly reversible**. After a delete, a toast
appears with an **Undo** button for a few seconds — click it to restore the task
(and its children).

### Templates

Reuse common structures:

- From a task's menu, choose **Save as template** and give it a name.
- Click **Templates** in the toolbar to browse saved templates, **Apply** one
  (it's inserted into the current list), or **Delete** ones you no longer need.

### Task keyboard shortcuts

| Key | Action |
|---|---|
| **Enter** | New sibling below |
| **Tab** | Indent (make child) |
| **Shift+Tab** | Outdent |
| **Backspace** (on empty line) | Delete and move up |
| **⌘F / Ctrl+F** | Focus the search box |
| **Esc** (in search) | Clear the search |

---

## 3. Wallet — Accounts & Transactions

### Accounts

Open **Wallet → Accounts** to manage where your money lives.

- Click **Add Account** to create one. Give it a **name**, a **type**
  (cash, card, e-wallet, bank, investment, or other), an **opening balance**,
  and pick a colour/icon.
- Each account card shows its **current balance**, calculated as:

  > **Balance = opening balance + income − expenses**
  >
  > Transfers move money between accounts but do **not** count as income or
  > expense.

- Edit or delete an account from its card. **Deleting an account also deletes
  all of its transactions** — Daybook asks you to confirm first.

The Accounts page also shows your **Total Net Worth** — the sum of all account
balances.

### Transactions

**Wallet → Transactions** is your day-to-day ledger, grouped by day with a
running total for each day.

**Adding a transaction** — click **Add Transaction** and fill in:

- **Type** — Expense, Income, or Transfer.
- **Date** — defaults to today.
- **Amount** — always entered as a positive number; the type decides the direction.
- **Account** — which account it belongs to.
- **Merchant** and an optional **Description**.
- **Category** — pick one (hidden for transfers).
- **Tags** — add one or more free-text tags for your own grouping.

**Transfers** — choose the **Transfer** type and a second **To Account** appears.
A transfer moves money from one account to another; it isn't categorised and
doesn't affect income/expense totals.

**Save & Add Another** — when adding (not editing), this saves the current entry
and keeps the form open — clearing the amount/merchant/description/tags but
keeping the date, account, and type — so you can enter a run of transactions
quickly.

**Editing / deleting** — click a transaction to edit it. Deleting a single
transaction offers an **Undo** toast, so a mistaken delete is easy to reverse.

### Filtering & searching transactions

Use the filter bar to narrow the list by **date range, type, category, account,
and tag**, plus a free-text search box. Active filters show as removable chips;
clear them individually or all at once.

---

## 4. Wallet — CSV Import

Bring in transactions from your bank via **Wallet → Import CSV**. It's a
step-by-step flow:

1. **Upload** your CSV file (you'll need at least one account first).
2. **Map Columns** — Daybook tries to auto-detect the date, amount, and
   description/merchant columns; adjust the mapping if needed.
3. **Review Import** — see every row before committing. Daybook detects
   **duplicates** (rows you've already imported) and pre-excludes them. Edit or
   deselect any row you don't want.
4. **Confirm** — the selected rows are imported.
5. **Import Complete** — a summary shows how many were imported vs. skipped.
   Jump to **View Transactions** or **Import Another**.

Duplicate detection uses a fingerprint of each row (date + amount + merchant), so
re-importing the same statement won't create doubles.

---

## 5. Wallet — Planning & Analysis

### Dashboard

**Wallet → Dashboard** gives you an at-a-glance picture over a date range
(e.g. this month / last month / custom):

- **Upcoming Bills** — a heads-up on recurring items coming due.
- **Cash Flow by Week** — income vs. expense bars.
- **Spending by Category** — a breakdown chart.
- **Spending by Account** — where the money went.
- **Top Merchants** — who you paid most.

### Budgets

**Wallet → Budgets** lets you cap spending per category:

- Click **Add Budget**, pick a **category** and a monthly **limit**.
- Each budget shows how much of the limit you've spent this month.

### Goals

**Wallet → Goals** tracks savings targets:

- Click **Add Goal**, give it a **name**, a **target amount**, and the **account**
  that holds the savings.
- Progress is tracked against that account's balance.

### Recurring

**Wallet → Recurring** handles repeating transactions (subscriptions, salary,
rent…):

- Click **Add Recurring** and set the **amount, merchant, type, category,
  account**, and **frequency** (weekly or monthly), plus the next due date.
- Rules **post automatically** when they come due, creating a real transaction on
  the chosen account. (Because they auto-post, recurring rules can only target
  your own accounts, not accounts shared with you.)

### Reports

**Wallet → Reports** offers deeper analysis:

- **Year-on-year comparison** of income/spending.
- A **custom date range** view — pick start and end dates and **Apply**.

### Exporting

You can export your transactions (filtered to your current view) to a file — a
handy backup and a way to take your data elsewhere.

---

## 6. Sharing (Households)

Daybook lets a household share accounts and split expenses. Sharing is **opt-in**
— nothing is shared until you set it up. Manage it under **Settings → Sharing**;
the shared data itself lives under **Wallet → Shared**.

### Groups

- In **Settings → Sharing**, click **New Group**, name it (e.g. "Rodriguez
  Family"), and create it.
- **Invite** people by **username**. They see a pending invite (a badge appears
  next to Settings) and can **accept** or **decline**.
- A group has an **owner** and **members**.

### Shared accounts

Share one of your accounts with a group so members can see it. You choose
**read-only** or **can-write** (members can add/edit transactions). **Ownership
stays with you** — sharing grants visibility, not ownership.

### Splitting a transaction

On a transaction, open **Split** to divide it with a group member:

- **Keep as-is** — the other person owes the full amount.
- **Split equally** — each pays half.
- **Custom** — enter exact amounts for each person.

Splits track who owes whom. If you later edit the transaction's amount, the
shares rescale automatically.

### Settling up

When balances build up between two people, use **Settle Up** (from **Wallet →
Shared**):

- Daybook shows who owes whom and how much.
- Choose the account to pay from (or deposit into) and confirm.
- Settling records **real ledger transactions** on both sides so each person's
  balance stays accurate.
- Made a mistake? Settlements can be **undone** from the Shared page.

Non-members never see your shared accounts or splits — visibility is scoped to
the groups you belong to.

---

## 7. Settings

**Settings** (bottom of the sidebar) covers:

- **Account** — **Sign out** here.
- **Appearance** — choose a **Theme**: Light or System (follow OS). *(A full dark
  theme is still in progress.)*
- **Finance** — currency is fixed to **Malaysian Ringgit (MYR)** for now.
- **Sharing** — the household features described above.

---

## 8. Tips & Good-to-Know

- **Your data lives on your hardware.** There's no cloud account; back up by
  exporting periodically.
- **Undo has your back.** Task deletes and single-transaction deletes both offer
  an Undo toast.
- **Money math is consistent:** transfers never count as income or expense, so
  your totals and net worth stay honest.
- **One currency for now:** everything is MYR; a per-account currency picker is
  intentionally not offered.

---

*This guide reflects the app as currently shipped (home-network, multi-user
release with household sharing). AI-assisted features and cloud hosting are
planned for later phases and are not part of the app today.*
