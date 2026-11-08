// R18 gap 2 (docs/archive/design-adoption/feature-capture-inbox.md §5.3). Bank posting dates
// trail the payment date; three days covers a Friday charge posting on Monday.
// Shared by check-duplicates (import side) and GET /captures (inbox side) so
// the two directions of the same comparison can never drift apart.
export const CAPTURE_DATE_WINDOW_DAYS = 3
