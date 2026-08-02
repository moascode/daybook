import type { ClaimState, Group, GroupDetail, GroupInvite, GroupMember, Settlement, AccountShare, SplitClaim, TransactionShare } from '@/types/household.types'

type Raw = Record<string, unknown>

/**
 * One row from GET /transactions/splits/mine.
 *
 * `outstanding` is derived here rather than at each call site: what a claim is
 * still worth is share − settled, and computing it in three components is how
 * the review queue ended up showing the full share for a partly-paid claim.
 */
export function mapSplitClaim(r: Raw): SplitClaim {
  const shareAmount = Number(r.share_amount ?? 0)
  const settledAmount = Number(r.settled_amount ?? 0)
  return {
    id: String(r.id),
    transactionId: String(r.transaction_id),
    shareAmount,
    settledAmount,
    outstanding: Math.round((shareAmount - settledAmount) * 100) / 100,
    settledAt: r.settled_at ? String(r.settled_at) : null,
    note: String(r.note ?? ''),
    state: String(r.claim_state ?? r.status ?? 'pending') as ClaimState,
    settlementId: r.settlement_id ? String(r.settlement_id) : null,
    rejectedReason: String(r.rejected_reason ?? ''),
    rejectedAt: r.rejected_at ? String(r.rejected_at) : null,
    createdAt: String(r.created_at ?? ''),
    date: String(r.date ?? ''),
    merchant: String(r.merchant ?? ''),
    description: String(r.description ?? ''),
    transactionAmount: Number(r.transaction_amount ?? 0),
    categoryId: r.category_id ? String(r.category_id) : null,
    ownerId: String(r.owner_id ?? ''),
    ownerUsername: String(r.owner_username ?? ''),
    debtorId: String(r.debtor_id ?? ''),
    debtorUsername: String(r.debtor_username ?? ''),
  }
}

export function mapGroup(r: Raw): Group {
  return {
    id: String(r.id),
    name: String(r.name),
    createdBy: String(r.created_by),
    createdAt: String(r.created_at),
    role: r.role as 'owner' | 'member',
  }
}

export function mapMember(r: Raw): GroupMember {
  return {
    userId: String(r.user_id),
    username: String(r.username),
    role: r.role as 'owner' | 'member',
    joinedAt: String(r.joined_at),
  }
}

export function mapGroupDetail(r: Raw): GroupDetail {
  return {
    ...mapGroup(r),
    members: ((r.members as Raw[]) ?? []).map(mapMember),
  }
}

export function mapInvite(r: Raw): GroupInvite {
  return {
    id: String(r.id),
    groupId: String(r.group_id),
    groupName: String(r.group_name),
    invitedByUsername: String(r.invited_by_username),
    status: r.status as GroupInvite['status'],
    createdAt: String(r.created_at),
  }
}

export function mapSettlement(r: Raw): Settlement {
  return {
    id: String(r.id),
    groupId: String(r.group_id ?? ''),
    fromUserId: String(r.from_user),
    fromUsername: String(r.from_username),
    toUserId: String(r.to_user),
    toUsername: String(r.to_username),
    amount: Number(r.amount),
    currency: String(r.currency ?? 'MYR'),
    note: String(r.note ?? ''),
    fromTransactionId: r.from_transaction_id ? String(r.from_transaction_id) : null,
    toTransactionId: r.to_transaction_id ? String(r.to_transaction_id) : null,
    originalTransactionId: r.original_transaction_id ? String(r.original_transaction_id) : null,
    settledAt: String(r.settled_at),
    status: (String(r.status ?? 'confirmed') as Settlement['status']),
    rejectedReason: String(r.rejected_reason ?? ''),
  }
}

export function mapTransactionShare(r: Raw): TransactionShare {
  return {
    id: String(r.id),
    transactionId: String(r.transaction_id),
    userId: String(r.user_id),
    username: String(r.username),
    shareAmount: Number(r.share_amount),
    note: String(r.note ?? ''),
    settledAt: r.settled_at ? String(r.settled_at) : null,
    createdAt: String(r.created_at),
  }
}

export function mapAccountShare(r: Raw): AccountShare {
  return {
    accountId: String(r.account_id),
    groupId: String(r.group_id),
    groupName: String(r.group_name ?? ''),
    canWrite: r.can_write === 1,
    sharedAt: String(r.shared_at ?? ''),
  }
}
