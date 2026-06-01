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
  settledAt: string
}
