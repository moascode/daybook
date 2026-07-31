export interface Group {
  id: string
  name: string
  createdBy: string
  createdAt: string
  role: 'owner' | 'member'
}

export interface GroupMember {
  userId: string
  username: string
  role: 'owner' | 'member'
  joinedAt: string
}

export interface GroupDetail extends Group {
  members: GroupMember[]
}

export interface GroupInvite {
  id: string
  groupId: string
  groupName: string
  invitedByUsername: string
  status: 'pending' | 'accepted' | 'declined' | 'revoked'
  createdAt: string
}

export interface AccountShare {
  accountId: string
  groupId: string
  groupName: string
  canWrite: boolean
  sharedAt: string
}

export interface TransactionShare {
  id: string
  transactionId: string
  userId: string
  username: string
  shareAmount: number
  note: string
  settledAt: string | null
  createdAt: string
}

/**
 * The state a split claim is actually in — derived server-side, not the raw
 * `transaction_splits.status` column.
 *
 * The two differ for a claimed-but-unconfirmed split, which stays 'pending' in
 * the column on purpose (worker/routes/settlements.ts:262) because a partial
 * payment leaves the rest of the split owed. Grouping the UI by the raw column
 * would show such a claim as untouched and invite paying it twice.
 */
export type ClaimState = 'pending' | 'approved' | 'awaiting_confirmation' | 'settled' | 'rejected'

/**
 * One split claim, from either side. Replaces the two ad-hoc snake_case row
 * shapes that ClaimsToReview and BalanceBreakdown each declared for the same
 * endpoint.
 */
export interface SplitClaim {
  id: string
  transactionId: string
  shareAmount: number
  settledAmount: number
  outstanding: number          // shareAmount − settledAmount
  settledAt: string | null
  note: string                 // the payer's explanation, addressed to the recipient
  state: ClaimState
  settlementId: string | null  // set only while state === 'awaiting_confirmation'
  rejectedReason: string
  rejectedAt: string | null
  createdAt: string
  date: string
  merchant: string
  description: string
  transactionAmount: number
  categoryId: string | null
  ownerId: string              // the payer — the one owed
  ownerUsername: string
  debtorId: string             // the one who owes
  debtorUsername: string
}

export interface GroupBalance {
  fromUserId: string
  fromUsername: string
  toUserId: string
  toUsername: string
  amount: number
}

export interface Settlement {
  id: string
  groupId: string
  fromUserId: string
  fromUsername: string
  toUserId: string
  toUsername: string
  amount: number
  currency: string
  note: string
  fromTransactionId: string | null
  toTransactionId: string | null
  originalTransactionId: string | null
  settledAt: string
  // 'awaiting_confirmation' until the creditor says the money arrived, then
  // 'confirmed'. 'rejected' if they say it never did. Rows that predate the
  // handshake default to 'confirmed' (migration 0010).
  status: 'awaiting_confirmation' | 'confirmed' | 'rejected'
  rejectedReason: string
}
