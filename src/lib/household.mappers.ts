import type { Group, GroupDetail, GroupInvite, GroupMember, Settlement, AccountShare } from '@/types/household.types'

type Raw = Record<string, unknown>

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
