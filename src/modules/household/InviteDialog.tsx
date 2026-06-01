import { useState, useCallback } from 'react'
import { Search, UserPlus, X } from 'lucide-react'
import { Modal } from '@/components/ui/Modal'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Input'
import { api } from '@/lib/api'

interface InviteDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  groupId: string
  groupName: string
  onInvited: () => void
}

export function InviteDialog({ open, onOpenChange, groupId, groupName, onInvited }: InviteDialogProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<{ id: string; username: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [sending, setSending] = useState<string | null>(null)
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null)

  const search = useCallback(async (q: string) => {
    if (!q.trim()) { setResults([]); return }
    setLoading(true)
    try {
      const data = await api.get<{ id: string; username: string }[]>(`/users/search?q=${encodeURIComponent(q)}`)
      setResults(data)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleInput = (val: string) => {
    setQuery(val)
    setMessage(null)
    const t = setTimeout(() => search(val), 300)
    return () => clearTimeout(t)
  }

  const handleInvite = async (username: string) => {
    setSending(username)
    setMessage(null)
    try {
      await api.post(`/groups/${groupId}/invites`, { username })
      setMessage({ text: `Invite sent to ${username}`, ok: true })
      onInvited()
    } catch {
      setMessage({ text: `Failed to invite ${username}`, ok: false })
    } finally {
      setSending(null)
    }
  }

  const handleClose = () => {
    setQuery('')
    setResults([])
    setMessage(null)
    onOpenChange(false)
  }

  return (
    <Modal open={open} onOpenChange={handleClose} title={`Invite to ${groupName}`}>
      <div className="space-y-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
          <Input
            className="pl-9"
            placeholder="Search by username…"
            value={query}
            onChange={(e) => handleInput(e.target.value)}
          />
        </div>

        {message && (
          <p className={`text-sm ${message.ok ? 'text-green-600' : 'text-red-600'}`}>{message.text}</p>
        )}

        {loading && <p className="text-sm text-gray-500">Searching…</p>}

        {results.length > 0 && (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200">
            {results.map((u) => (
              <li key={u.id} className="flex items-center justify-between px-4 py-2">
                <span className="text-sm font-medium text-gray-800">{u.username}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => handleInvite(u.username)}
                  disabled={sending === u.username}
                >
                  <UserPlus className="h-3.5 w-3.5 mr-1" />
                  {sending === u.username ? 'Sending…' : 'Invite'}
                </Button>
              </li>
            ))}
          </ul>
        )}

        {query && !loading && results.length === 0 && (
          <p className="text-sm text-gray-400">No users found matching "{query}"</p>
        )}

        <div className="flex justify-end pt-1">
          <Button variant="secondary" onClick={handleClose}>
            <X className="h-3.5 w-3.5 mr-1" />
            Close
          </Button>
        </div>
      </div>
    </Modal>
  )
}
