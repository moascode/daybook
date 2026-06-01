import { Router } from 'express'
import { getDb } from '../db.ts'
import { isGroupOwner, isGroupMember } from '../lib/sharing.ts'

export const groupsRouter: Router = Router()

// ── Groups ────────────────────────────────────────────

groupsRouter.get('/groups', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  const rows = db
    .prepare(
      `SELECT g.id, g.name, g.created_by, g.created_at, gm.role
       FROM groups g
       JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
       ORDER BY g.created_at ASC`,
    )
    .all(userId)
  res.json(rows)
})

groupsRouter.post('/groups', (req, res) => {
  const userId = req.session.userId!
  const name = String(req.body?.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'name is required' })

  const db = getDb()
  const group = db
    .prepare(
      `INSERT INTO groups (id, name, created_by, created_at)
       VALUES (lower(hex(randomblob(16))), ?, ?, datetime('now'))
       RETURNING *`,
    )
    .get(name, userId) as { id: string; name: string; created_by: string; created_at: string }

  db.prepare(
    `INSERT INTO group_members (group_id, user_id, role, joined_at)
     VALUES (?, ?, 'owner', datetime('now'))`,
  ).run(group.id, userId)

  res.status(201).json({ ...group, role: 'owner' })
})

groupsRouter.get('/groups/:id', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  if (!isGroupMember(db, userId, req.params.id)) {
    return res.status(404).json({ error: 'group not found' })
  }
  const group = db.prepare('SELECT * FROM groups WHERE id = ?').get(req.params.id)
  const members = db
    .prepare(
      `SELECT gm.user_id, gm.role, gm.joined_at, u.username
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
       ORDER BY gm.joined_at ASC`,
    )
    .all(req.params.id)
  res.json({ ...group as object, members })
})

groupsRouter.patch('/groups/:id', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  if (!isGroupOwner(db, userId, req.params.id)) {
    return res.status(403).json({ error: 'only the owner can rename a group' })
  }
  const name = String(req.body?.name ?? '').trim()
  if (!name) return res.status(400).json({ error: 'name is required' })
  const row = db
    .prepare(`UPDATE groups SET name = ? WHERE id = ? RETURNING *`)
    .get(name, req.params.id)
  res.json(row)
})

groupsRouter.delete('/groups/:id', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  if (!isGroupOwner(db, userId, req.params.id)) {
    return res.status(403).json({ error: 'only the owner can delete a group' })
  }
  // Block deletion if outstanding account shares exist
  const shares = db
    .prepare('SELECT 1 FROM account_shares WHERE group_id = ? LIMIT 1')
    .get(req.params.id)
  if (shares) {
    return res.status(409).json({ error: 'remove all shared accounts before deleting the group' })
  }
  db.prepare('DELETE FROM groups WHERE id = ?').run(req.params.id)
  res.status(204).end()
})

// ── Members ───────────────────────────────────────────

groupsRouter.get('/groups/:id/members', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  if (!isGroupMember(db, userId, req.params.id)) {
    return res.status(404).json({ error: 'group not found' })
  }
  const members = db
    .prepare(
      `SELECT gm.user_id, gm.role, gm.joined_at, u.username
       FROM group_members gm
       JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?
       ORDER BY gm.joined_at ASC`,
    )
    .all(req.params.id)
  res.json(members)
})

groupsRouter.delete('/groups/:id/members/:userId', (req, res) => {
  const callerId = req.session.userId!
  const { id: groupId, userId: targetId } = req.params
  const db = getDb()

  const isSelf = callerId === targetId
  const callerIsOwner = isGroupOwner(db, callerId, groupId)

  if (!isSelf && !callerIsOwner) {
    return res.status(403).json({ error: 'only the owner can remove members' })
  }
  if (!isGroupMember(db, targetId, groupId)) {
    return res.status(404).json({ error: 'member not found' })
  }

  // Prevent removing the last owner
  const targetRole = (db
    .prepare('SELECT role FROM group_members WHERE group_id = ? AND user_id = ?')
    .get(groupId, targetId) as { role: string } | undefined)?.role
  if (targetRole === 'owner') {
    const ownerCount = (db
      .prepare("SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = ? AND role = 'owner'")
      .get(groupId) as { cnt: number }).cnt
    if (ownerCount <= 1) {
      return res.status(409).json({ error: 'cannot remove the last owner; transfer ownership first' })
    }
  }

  db.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?').run(groupId, targetId)
  res.status(204).end()
})

// ── Invites ───────────────────────────────────────────

groupsRouter.post('/groups/:id/invites', (req, res) => {
  const callerId = req.session.userId!
  const db = getDb()
  if (!isGroupMember(db, callerId, req.params.id)) {
    return res.status(403).json({ error: 'only group members can send invites' })
  }

  const username = String(req.body?.username ?? '').trim().toLowerCase()
  if (!username) return res.status(400).json({ error: 'username is required' })

  const invitee = db
    .prepare('SELECT id FROM users WHERE username = ?')
    .get(username) as { id: string } | undefined
  if (!invitee) return res.status(404).json({ error: 'user not found' })
  if (invitee.id === callerId) {
    return res.status(400).json({ error: 'cannot invite yourself' })
  }
  if (isGroupMember(db, invitee.id, req.params.id)) {
    return res.status(409).json({ error: 'user is already a member' })
  }

  // Upsert: if a declined/revoked invite exists, re-invite
  const existing = db
    .prepare("SELECT id, status FROM group_invites WHERE group_id = ? AND invitee_id = ?")
    .get(req.params.id, invitee.id) as { id: string; status: string } | undefined

  if (existing && existing.status === 'pending') {
    return res.status(409).json({ error: 'invite already pending' })
  }

  let invite: unknown
  if (existing) {
    invite = db
      .prepare(
        `UPDATE group_invites SET status = 'pending', invited_by = ?, created_at = datetime('now')
         WHERE id = ? RETURNING *`,
      )
      .get(callerId, existing.id)
  } else {
    invite = db
      .prepare(
        `INSERT INTO group_invites (id, group_id, invitee_id, invited_by, status, created_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, 'pending', datetime('now'))
         RETURNING *`,
      )
      .get(req.params.id, invitee.id, callerId)
  }

  res.status(201).json(invite)
})

// GET /api/invites — my inbound pending invites
groupsRouter.get('/invites', (req, res) => {
  const userId = req.session.userId!
  const rows = getDb()
    .prepare(
      `SELECT gi.id, gi.group_id, gi.status, gi.created_at,
              g.name AS group_name,
              u.username AS invited_by_username
       FROM group_invites gi
       JOIN groups g ON g.id = gi.group_id
       JOIN users u ON u.id = gi.invited_by
       WHERE gi.invitee_id = ? AND gi.status = 'pending'
       ORDER BY gi.created_at DESC`,
    )
    .all(userId)
  res.json(rows)
})

groupsRouter.post('/invites/:id/accept', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  const invite = db
    .prepare("SELECT * FROM group_invites WHERE id = ? AND invitee_id = ? AND status = 'pending'")
    .get(req.params.id, userId) as { id: string; group_id: string } | undefined
  if (!invite) return res.status(404).json({ error: 'invite not found' })

  db.prepare("UPDATE group_invites SET status = 'accepted' WHERE id = ?").run(invite.id)
  db
    .prepare(
      `INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at)
       VALUES (?, ?, 'member', datetime('now'))`,
    )
    .run(invite.group_id, userId)

  res.json({ ok: true })
})

groupsRouter.post('/invites/:id/decline', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  const invite = db
    .prepare("SELECT id FROM group_invites WHERE id = ? AND invitee_id = ? AND status = 'pending'")
    .get(req.params.id, userId)
  if (!invite) return res.status(404).json({ error: 'invite not found' })
  db.prepare("UPDATE group_invites SET status = 'declined' WHERE id = ?").run(req.params.id)
  res.json({ ok: true })
})

// DELETE /api/invites/:id — revoke (inviter or group owner)
groupsRouter.delete('/invites/:id', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  const invite = db
    .prepare("SELECT * FROM group_invites WHERE id = ? AND status = 'pending'")
    .get(req.params.id) as { id: string; group_id: string; invited_by: string } | undefined
  if (!invite) return res.status(404).json({ error: 'invite not found' })
  if (invite.invited_by !== userId && !isGroupOwner(db, userId, invite.group_id)) {
    return res.status(403).json({ error: 'only the inviter or owner can revoke' })
  }
  db.prepare("UPDATE group_invites SET status = 'revoked' WHERE id = ?").run(req.params.id)
  res.status(204).end()
})

// ── User search (for invite UI) ───────────────────────

groupsRouter.get('/users/search', (req, res) => {
  const q = String(req.query.q ?? '').trim().toLowerCase()
  if (!q || q.length < 1) return res.json([])
  const rows = getDb()
    .prepare(
      `SELECT id, username FROM users
       WHERE username LIKE ? AND id != ?
       LIMIT 10`,
    )
    .all(`${q}%`, req.session.userId!)
  res.json(rows)
})

// ── Group balances ────────────────────────────────────

groupsRouter.get('/groups/:id/balances', (req, res) => {
  const userId = req.session.userId!
  const db = getDb()
  if (!isGroupMember(db, userId, req.params.id)) {
    return res.status(404).json({ error: 'group not found' })
  }

  // For each member pair in the group, compute net outstanding unsettled shares.
  // A positive balance means `fromUser` owes `toUser` (original transaction owner).
  const shares = db
    .prepare(
      `SELECT ts.user_id AS debtor_id, t.user_id AS creditor_id,
              SUM(ts.share_amount) AS total_owed
       FROM transaction_shares ts
       JOIN transactions t ON t.id = ts.transaction_id
       JOIN group_members gm_d ON gm_d.user_id = ts.user_id AND gm_d.group_id = ?
       JOIN group_members gm_c ON gm_c.user_id = t.user_id AND gm_c.group_id = ?
       WHERE ts.settled_at IS NULL AND ts.user_id != t.user_id
       GROUP BY ts.user_id, t.user_id`,
    )
    .all(req.params.id, req.params.id) as { debtor_id: string; creditor_id: string; total_owed: number }[]

  // Net the bidirectional amounts into a single direction
  type NetBalance = { fromUserId: string; toUserId: string; amount: number }
  const netMap = new Map<string, number>()
  for (const row of shares) {
    const fwd = `${row.debtor_id}:${row.creditor_id}`
    const rev = `${row.creditor_id}:${row.debtor_id}`
    if (netMap.has(rev)) {
      netMap.set(rev, (netMap.get(rev) ?? 0) - row.total_owed)
    } else {
      netMap.set(fwd, (netMap.get(fwd) ?? 0) + row.total_owed)
    }
  }

  // Collect members for username lookup
  const members = db
    .prepare(
      `SELECT gm.user_id, u.username
       FROM group_members gm JOIN users u ON u.id = gm.user_id
       WHERE gm.group_id = ?`,
    )
    .all(req.params.id) as { user_id: string; username: string }[]
  const usernameMap = new Map(members.map((m) => [m.user_id, m.username]))

  const balances: (NetBalance & { fromUsername: string; toUsername: string })[] = []
  for (const [key, amount] of netMap) {
    if (Math.abs(amount) < 0.005) continue
    const [a, b] = key.split(':')
    if (amount > 0) {
      balances.push({ fromUserId: a, toUserId: b, amount, fromUsername: usernameMap.get(a) ?? a, toUsername: usernameMap.get(b) ?? b })
    } else {
      balances.push({ fromUserId: b, toUserId: a, amount: -amount, fromUsername: usernameMap.get(b) ?? b, toUsername: usernameMap.get(a) ?? a })
    }
  }

  res.json(balances)
})
