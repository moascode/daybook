import { create } from 'zustand'
import type { Group, GroupInvite } from '@/types/household.types'

interface HouseholdState {
  groups: Group[]
  pendingInvites: GroupInvite[]  // inbound invites for the current user
  setGroups: (groups: Group[]) => void
  setPendingInvites: (invites: GroupInvite[]) => void
  addGroup: (group: Group) => void
  updateGroup: (id: string, updates: Partial<Group>) => void
  removeGroup: (id: string) => void
  removePendingInvite: (id: string) => void
}

export const useHouseholdStore = create<HouseholdState>((set) => ({
  groups: [],
  pendingInvites: [],

  setGroups: (groups) => set({ groups }),
  setPendingInvites: (invites) => set({ pendingInvites: invites }),

  addGroup: (group) => set((s) => ({ groups: [...s.groups, group] })),
  updateGroup: (id, updates) =>
    set((s) => ({ groups: s.groups.map((g) => (g.id === id ? { ...g, ...updates } : g)) })),
  removeGroup: (id) => set((s) => ({ groups: s.groups.filter((g) => g.id !== id) })),
  removePendingInvite: (id) =>
    set((s) => ({ pendingInvites: s.pendingInvites.filter((i) => i.id !== id) })),
}))
