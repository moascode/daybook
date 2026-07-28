import { Hono } from 'hono'
import type { AppEnv } from '../types.ts'
import { isGroupMember, isGroupOwner } from '../lib/sharing.ts'
import { newId } from '../lib.ts'

// Port of server/routes/groups.ts. Mounted behind requireAuth.
export const groups = new Hono<AppEnv>()

// ── Groups ────────────────────────────────────────────

groups.get('/groups', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT g.id, g.name, g.created_by, g.created_at, gm.role
     FROM groups g
     JOIN group_members gm ON gm.group_id = g.id AND gm.user_id = ?
     ORDER BY g.created_at ASC`,
  )
    .bind(c.get('userId'))
    .all()
  return c.json(results)
})

groups.post('/groups', async (c) => {
  const userId = c.get('userId')
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const name = String(body?.name ?? '').trim()
  if (!name) return c.json({ error: 'name is required' }, 400)

  // The server issues these as two independent statements (server/routes/
  // groups.ts:29-40). If the second fails, the group exists with no owner row —
  // unreachable by its own creator and undeletable, since every guard here is
  // `isGroupOwner`. batch() runs them as one atomic unit.
  //
  // The id is generated here rather than by the column default because a batch
  // cannot feed one statement's RETURNING into the next.
  const id = newId()
  await c.env.DB.batch([
    c.env.DB
      .prepare(
        `INSERT INTO groups (id, name, created_by, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
      )
      .bind(id, name, userId),
    c.env.DB
      .prepare(
        `INSERT INTO group_members (group_id, user_id, role, joined_at)
         VALUES (?, ?, 'owner', datetime('now'))`,
      )
      .bind(id, userId),
  ])

  // Read back so the response carries the server-generated created_at, matching
  // the shape the original returned via RETURNING *.
  const group = await c.env.DB.prepare(
    'SELECT id, name, created_by, created_at FROM groups WHERE id = ?',
  )
    .bind(id)
    .first()

  return c.json({ ...(group as object), role: 'owner' }, 201)
})

// GET /api/groups/members — all unique co-members across the caller's groups
// (for SplitDialog).
//
// ⚠️ Must stay registered BEFORE /groups/:id, or ':id' would capture the
// literal "members". Same constraint the Express version has.
groups.get('/groups/members', async (c) => {
  const userId = c.get('userId')
  const { results } = await c.env.DB.prepare(
    `SELECT DISTINCT u.id AS user_id, u.username, gm.role, gm.joined_at
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id IN (SELECT group_id FROM group_members WHERE user_id = ?)
       AND gm.user_id != ?
     ORDER BY u.username ASC`,
  )
    .bind(userId, userId)
    .all()
  return c.json(results)
})

groups.get('/groups/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  if (!(await isGroupMember(c.env.DB, userId, id))) {
    return c.json({ error: 'group not found' }, 404)
  }

  const group = await c.env.DB.prepare(
    'SELECT id, name, created_by, created_at FROM groups WHERE id = ?',
  )
    .bind(id)
    .first()
  const members = await c.env.DB.prepare(
    `SELECT gm.user_id, gm.role, gm.joined_at, u.username
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ?
     ORDER BY gm.joined_at ASC`,
  )
    .bind(id)
    .all()
  const mine = await c.env.DB.prepare(
    'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
  )
    .bind(id, userId)
    .first<{ role: string }>()

  return c.json({ ...(group as object), members: members.results, role: mine?.role ?? 'member' })
})

groups.patch('/groups/:id', async (c) => {
  const id = c.req.param('id')
  if (!(await isGroupOwner(c.env.DB, c.get('userId'), id))) {
    return c.json({ error: 'only the owner can rename a group' }, 403)
  }
  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const name = String(body?.name ?? '').trim()
  if (!name) return c.json({ error: 'name is required' }, 400)

  const row = await c.env.DB.prepare('UPDATE groups SET name = ? WHERE id = ? RETURNING *')
    .bind(name, id)
    .first()
  return c.json(row)
})

groups.delete('/groups/:id', async (c) => {
  const id = c.req.param('id')
  if (!(await isGroupOwner(c.env.DB, c.get('userId'), id))) {
    return c.json({ error: 'only the owner can delete a group' }, 403)
  }

  // Block deletion if outstanding account shares exist.
  const shares = await c.env.DB.prepare(
    'SELECT 1 AS ok FROM account_shares WHERE group_id = ? LIMIT 1',
  )
    .bind(id)
    .first()
  if (shares) {
    return c.json({ error: 'remove all shared accounts before deleting the group' }, 409)
  }

  // B-3: block deletion while unsettled splits remain in this group.
  const unsettled = await c.env.DB.prepare(
    `SELECT 1 AS ok
     FROM transaction_splits ts
     JOIN transactions t ON t.id = ts.transaction_id
     JOIN group_members gm ON gm.user_id = ts.user_id AND gm.group_id = ?
     WHERE ts.settled_at IS NULL
     LIMIT 1`,
  )
    .bind(id)
    .first()
  if (unsettled) {
    return c.json({ error: 'settle all outstanding balances before deleting the group' }, 409)
  }

  await c.env.DB.prepare('DELETE FROM groups WHERE id = ?').bind(id).run()
  return c.body(null, 204)
})

// ── Members ───────────────────────────────────────────

groups.get('/groups/:id/members', async (c) => {
  const id = c.req.param('id')
  if (!(await isGroupMember(c.env.DB, c.get('userId'), id))) {
    return c.json({ error: 'group not found' }, 404)
  }
  const { results } = await c.env.DB.prepare(
    `SELECT gm.user_id, gm.role, gm.joined_at, u.username
     FROM group_members gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ?
     ORDER BY gm.joined_at ASC`,
  )
    .bind(id)
    .all()
  return c.json(results)
})

groups.delete('/groups/:id/members/:userId', async (c) => {
  const callerId = c.get('userId')
  const groupId = c.req.param('id')
  const targetId = c.req.param('userId')

  const isSelf = callerId === targetId
  const callerIsOwner = await isGroupOwner(c.env.DB, callerId, groupId)

  if (!isSelf && !callerIsOwner) {
    return c.json({ error: 'only the owner can remove members' }, 403)
  }
  if (!(await isGroupMember(c.env.DB, targetId, groupId))) {
    return c.json({ error: 'member not found' }, 404)
  }

  // Prevent removing the last owner.
  const target = await c.env.DB.prepare(
    'SELECT role FROM group_members WHERE group_id = ? AND user_id = ?',
  )
    .bind(groupId, targetId)
    .first<{ role: string }>()
  if (target?.role === 'owner') {
    const owners = await c.env.DB.prepare(
      "SELECT COUNT(*) AS cnt FROM group_members WHERE group_id = ? AND role = 'owner'",
    )
      .bind(groupId)
      .first<{ cnt: number }>()
    if ((owners?.cnt ?? 0) <= 1) {
      return c.json({ error: 'cannot remove the last owner; transfer ownership first' }, 409)
    }
  }

  // B-4: block removal while this member has unsettled splits in the group.
  const unsettled = await c.env.DB.prepare(
    `SELECT 1 AS ok
     FROM transaction_splits ts
     JOIN transactions t ON t.id = ts.transaction_id
     JOIN group_members gm ON gm.user_id = t.user_id AND gm.group_id = ?
     WHERE ts.user_id = ? AND ts.settled_at IS NULL
     LIMIT 1`,
  )
    .bind(groupId, targetId)
    .first()
  if (unsettled) {
    return c.json({ error: 'this member has unsettled balances in the group; settle first' }, 409)
  }

  await c.env.DB.prepare('DELETE FROM group_members WHERE group_id = ? AND user_id = ?')
    .bind(groupId, targetId)
    .run()
  return c.body(null, 204)
})

// ── Invites ───────────────────────────────────────────

groups.post('/groups/:id/invites', async (c) => {
  const callerId = c.get('userId')
  const groupId = c.req.param('id')
  if (!(await isGroupMember(c.env.DB, callerId, groupId))) {
    return c.json({ error: 'only group members can send invites' }, 403)
  }

  const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>
  const username = String(body?.username ?? '').trim().toLowerCase()
  if (!username) return c.json({ error: 'username is required' }, 400)

  const invitee = await c.env.DB.prepare('SELECT id FROM users WHERE username = ?')
    .bind(username)
    .first<{ id: string }>()
  if (!invitee) return c.json({ error: 'user not found' }, 404)
  if (invitee.id === callerId) return c.json({ error: 'cannot invite yourself' }, 400)
  if (await isGroupMember(c.env.DB, invitee.id, groupId)) {
    return c.json({ error: 'user is already a member' }, 409)
  }

  // Upsert: a declined/revoked invite is re-opened rather than duplicated
  // (group_invites has UNIQUE (group_id, invitee_id)).
  const existing = await c.env.DB.prepare(
    'SELECT id, status FROM group_invites WHERE group_id = ? AND invitee_id = ?',
  )
    .bind(groupId, invitee.id)
    .first<{ id: string; status: string }>()

  if (existing && existing.status === 'pending') {
    return c.json({ error: 'invite already pending' }, 409)
  }

  const invite = existing
    ? await c.env.DB.prepare(
        `UPDATE group_invites SET status = 'pending', invited_by = ?, created_at = datetime('now')
         WHERE id = ? RETURNING *`,
      )
        .bind(callerId, existing.id)
        .first()
    : await c.env.DB.prepare(
        `INSERT INTO group_invites (id, group_id, invitee_id, invited_by, status, created_at)
         VALUES (lower(hex(randomblob(16))), ?, ?, ?, 'pending', datetime('now'))
         RETURNING *`,
      )
        .bind(groupId, invitee.id, callerId)
        .first()

  return c.json(invite, 201)
})

// GET /api/invites — my inbound pending invites.
groups.get('/invites', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT gi.id, gi.group_id, gi.status, gi.created_at,
            g.name AS group_name,
            u.username AS invited_by_username
     FROM group_invites gi
     JOIN groups g ON g.id = gi.group_id
     JOIN users u ON u.id = gi.invited_by
     WHERE gi.invitee_id = ? AND gi.status = 'pending'
     ORDER BY gi.created_at DESC`,
  )
    .bind(c.get('userId'))
    .all()
  return c.json(results)
})

groups.post('/invites/:id/accept', async (c) => {
  const userId = c.get('userId')
  const invite = await c.env.DB.prepare(
    "SELECT * FROM group_invites WHERE id = ? AND invitee_id = ? AND status = 'pending'",
  )
    .bind(c.req.param('id'), userId)
    .first<{ id: string; group_id: string }>()
  if (!invite) return c.json({ error: 'invite not found' }, 404)

  // Marking the invite accepted without adding the membership would strand the
  // user: the invite is gone from their inbox and they are not in the group,
  // with no way to recover. batch() makes the pair atomic — the server runs them
  // as two independent statements.
  await c.env.DB.batch([
    c.env.DB.prepare("UPDATE group_invites SET status = 'accepted' WHERE id = ?").bind(invite.id),
    c.env.DB
      .prepare(
        `INSERT OR IGNORE INTO group_members (group_id, user_id, role, joined_at)
         VALUES (?, ?, 'member', datetime('now'))`,
      )
      .bind(invite.group_id, userId),
  ])

  return c.json({ ok: true })
})

groups.post('/invites/:id/decline', async (c) => {
  const id = c.req.param('id')
  const invite = await c.env.DB.prepare(
    "SELECT id FROM group_invites WHERE id = ? AND invitee_id = ? AND status = 'pending'",
  )
    .bind(id, c.get('userId'))
    .first()
  if (!invite) return c.json({ error: 'invite not found' }, 404)

  await c.env.DB.prepare("UPDATE group_invites SET status = 'declined' WHERE id = ?")
    .bind(id)
    .run()
  return c.json({ ok: true })
})

// DELETE /api/invites/:id — revoke (inviter or group owner).
groups.delete('/invites/:id', async (c) => {
  const userId = c.get('userId')
  const id = c.req.param('id')
  const invite = await c.env.DB.prepare(
    "SELECT * FROM group_invites WHERE id = ? AND status = 'pending'",
  )
    .bind(id)
    .first<{ id: string; group_id: string; invited_by: string }>()
  if (!invite) return c.json({ error: 'invite not found' }, 404)

  if (invite.invited_by !== userId && !(await isGroupOwner(c.env.DB, userId, invite.group_id))) {
    return c.json({ error: 'only the inviter or owner can revoke' }, 403)
  }

  await c.env.DB.prepare("UPDATE group_invites SET status = 'revoked' WHERE id = ?").bind(id).run()
  return c.body(null, 204)
})

// ── User search (for invite UI) ───────────────────────

groups.get('/users/search', async (c) => {
  const q = String(c.req.query('q') ?? '').trim().toLowerCase()
  if (!q || q.length < 2) return c.json([])

  const { results } = await c.env.DB.prepare(
    `SELECT id, username FROM users
     WHERE username LIKE ? AND id != ?
     LIMIT 10`,
  )
    .bind(`${q}%`, c.get('userId'))
    .all()
  return c.json(results)
})

// ── Group balances ────────────────────────────────────

groups.get('/groups/:id/balances', async (c) => {
  const id = c.req.param('id')
  if (!(await isGroupMember(c.env.DB, c.get('userId'), id))) {
    return c.json({ error: 'group not found' }, 404)
  }

  // Net outstanding unsettled splits per debtor/creditor pair. A positive
  // balance means `fromUser` owes `toUser` (the original transaction owner).
  const { results: shares } = await c.env.DB.prepare(
    `SELECT ts.user_id AS debtor_id, t.user_id AS creditor_id,
            SUM(ts.share_amount - ts.settled_amount) AS total_owed
     FROM transaction_splits ts
     JOIN transactions t ON t.id = ts.transaction_id
     JOIN group_members gm_d ON gm_d.user_id = ts.user_id AND gm_d.group_id = ?
     JOIN group_members gm_c ON gm_c.user_id = t.user_id AND gm_c.group_id = ?
     WHERE ts.settled_at IS NULL AND ts.user_id != t.user_id
       AND ts.status IN ('pending', 'awaiting_confirmation')
     GROUP BY ts.user_id, t.user_id`,
  )
    .bind(id, id)
    .all<{ debtor_id: string; creditor_id: string; total_owed: number }>()

  // Net the bidirectional amounts into a single direction.
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

  const { results: members } = await c.env.DB.prepare(
    `SELECT gm.user_id, u.username
     FROM group_members gm JOIN users u ON u.id = gm.user_id
     WHERE gm.group_id = ?`,
  )
    .bind(id)
    .all<{ user_id: string; username: string }>()
  const usernameMap = new Map(members.map((m) => [m.user_id, m.username]))

  const balances: (NetBalance & { fromUsername: string; toUsername: string })[] = []
  for (const [key, amount] of netMap) {
    // Sub-half-cent residue is rounding noise, not a debt.
    if (Math.abs(amount) < 0.005) continue
    const [a, b] = key.split(':')
    if (amount > 0) {
      balances.push({
        fromUserId: a,
        toUserId: b,
        amount,
        fromUsername: usernameMap.get(a) ?? a,
        toUsername: usernameMap.get(b) ?? b,
      })
    } else {
      balances.push({
        fromUserId: b,
        toUserId: a,
        amount: -amount,
        fromUsername: usernameMap.get(b) ?? b,
        toUsername: usernameMap.get(a) ?? a,
      })
    }
  }

  return c.json(balances)
})
