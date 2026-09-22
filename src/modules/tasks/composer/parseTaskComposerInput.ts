export interface TaskComposerList {
  id: string
  name: string
}

export interface TaskComposerCoMember {
  id: string
  username: string
}

export interface ParsedTaskDraft {
  content: string
  listId: string | null
  priority: 'high' | 'med' | 'low' | null
  assigneeId: string | null
  dueDate: string | null
  dueTime: string | null
}

const HASH_TOKEN_RE = /#(\S+)/g
const AT_TOKEN_RE = /@(\S+)/g
const PRIORITY_RE = /!(high|med|low)\b/i
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
const DATE_WORD_RE = /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i
// "9am", "9:30pm" — hour first, optional minutes, mandatory meridiem.
const AMPM_TIME_RE = /\b(1[0-2]|0?[1-9])(?::([0-5][0-9]))?\s?(am|pm)\b/i
// "14:00", "9:30" — 24h clock, colon mandatory (bare "9" is never a time on its own).
const TIME_24H_RE = /\b([01]?\d|2[0-3]):([0-5]\d)\b/

/**
 * `days` from today, using LOCAL date parts — never `toISOString()` (CLAUDE.md
 * §3 Tests trap: UTC and Malaysian local dates disagree for part of the day).
 */
function isoDatePlus(days: number): string {
  const d = new Date()
  d.setDate(d.getDate() + days)
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
}

/**
 * Resolves a due-date word to an ISO date. "today" and "tomorrow" are
 * relative offsets; a weekday name resolves to its NEXT occurrence, where
 * "next" includes today itself if today already is that weekday (matching
 * the offset-based convention `isoDatePlus` callers use elsewhere in Tasks).
 */
function resolveDateWord(word: string): string {
  const lower = word.toLowerCase()
  if (lower === 'today') return isoDatePlus(0)
  if (lower === 'tomorrow') return isoDatePlus(1)
  const targetDow = WEEKDAY_NAMES.indexOf(lower)
  if (targetDow === -1) return isoDatePlus(0)
  const todayDow = new Date().getDay()
  const diff = (targetDow - todayDow + 7) % 7
  return isoDatePlus(diff)
}

/** Finds the first #list / @username token whose stripped name matches a known entry (case-insensitive). Unmatched tokens are left untouched — they stay literal text in the caller's residual string. */
function findFirstTaggedMatch<T extends { id: string }>(
  text: string,
  tokenRe: RegExp,
  entries: T[],
  nameOf: (entry: T) => string,
): { id: string; matchedText: string } | null {
  tokenRe.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = tokenRe.exec(text)) !== null) {
    const name = match[1]
    const entry = entries.find((e) => nameOf(e).toLowerCase() === name.toLowerCase())
    if (entry) return { id: entry.id, matchedText: match[0] }
  }
  return null
}

/** The best clock-time token: am/pm form tried first (it is unambiguous), then bare 24h `HH:MM`. Returns 24h `HH:MM` plus the exact matched substring to strip. */
function extractTime(text: string): { time: string; matchedText: string } | null {
  const ampm = AMPM_TIME_RE.exec(text)
  if (ampm) {
    let hour = parseInt(ampm[1], 10)
    const minute = ampm[2] ? parseInt(ampm[2], 10) : 0
    const meridiem = ampm[3].toLowerCase()
    if (meridiem === 'pm' && hour !== 12) hour += 12
    if (meridiem === 'am' && hour === 12) hour = 0
    return { time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`, matchedText: ampm[0] }
  }

  const clock = TIME_24H_RE.exec(text)
  if (clock) {
    const hour = parseInt(clock[1], 10)
    const minute = clock[2]
    return { time: `${String(hour).padStart(2, '0')}:${minute}`, matchedText: clock[0] }
  }

  return null
}

function stripFirst(text: string, matchedText: string | null): string {
  if (!matchedText) return text
  const index = text.indexOf(matchedText)
  if (index === -1) return text
  return text.slice(0, index) + text.slice(index + matchedText.length)
}

/**
 * Pure, rules-only parser for the Tasks composer (D-11): pulls `#list`,
 * `!priority`, `@assignee`, a due-date word (today/tomorrow/weekday) and a
 * trailing clock time out of free text, leaving the rest as `content`.
 * Mirrors `src/modules/wallet/composer/parseComposerInput.ts`'s conventions.
 * Never throws — any unexpected input falls back to a draft holding the
 * original text verbatim with every other field null.
 */
export function parseTaskComposerInput(
  text: string,
  lists: TaskComposerList[],
  coMembers: TaskComposerCoMember[],
): ParsedTaskDraft {
  try {
    let residual = text

    const listMatch = findFirstTaggedMatch(residual, new RegExp(HASH_TOKEN_RE.source, 'g'), lists, (l) => l.name)
    const listId = listMatch?.id ?? null
    residual = stripFirst(residual, listMatch?.matchedText ?? null)

    const priorityMatch = PRIORITY_RE.exec(residual)
    const priority = (priorityMatch?.[1].toLowerCase() as 'high' | 'med' | 'low' | undefined) ?? null
    residual = stripFirst(residual, priorityMatch?.[0] ?? null)

    const assigneeMatch = findFirstTaggedMatch(
      residual,
      new RegExp(AT_TOKEN_RE.source, 'g'),
      coMembers,
      (m) => m.username,
    )
    const assigneeId = assigneeMatch?.id ?? null
    residual = stripFirst(residual, assigneeMatch?.matchedText ?? null)

    const dateWordMatch = DATE_WORD_RE.exec(residual)
    const dueDate = dateWordMatch ? resolveDateWord(dateWordMatch[1]) : null
    residual = stripFirst(residual, dateWordMatch?.[0] ?? null)

    const timeResult = extractTime(residual)
    const dueTime = timeResult?.time ?? null
    residual = stripFirst(residual, timeResult?.matchedText ?? null)

    const content = residual.replace(/\s+/g, ' ').trim()

    return { content, listId, priority, assigneeId, dueDate, dueTime }
  } catch {
    return { content: text, listId: null, priority: null, assigneeId: null, dueDate: null, dueTime: null }
  }
}
