import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import { api } from '../lib/api'
import { Card, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select'

interface HistoryItem {
  id: string
  action: 'created' | 'updated' | 'deleted' | 'error'
  zoho_event_id: string | null
  zoho_event_title: string | null
  google_calendar_id: string | null
  detail: string | null
  synced_at: string
}

interface HistoryResponse {
  items: HistoryItem[]
  total: number
  page: number
}

const ACTION_COLORS: Record<string, string> = {
  created: 'text-green-600',
  updated: 'text-blue-600',
  deleted: 'text-muted-foreground',
  error: 'text-destructive',
}

export function History() {
  const [page, setPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('all')
  const LIMIT = 50

  const { data, isLoading } = useQuery<HistoryResponse>({
    queryKey: ['history', page, actionFilter],
    queryFn: () => {
      const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) })
      if (actionFilter !== 'all') params.set('action', actionFilter)
      return api.get(`/history?${params}`).then(r => r.data)
    },
  })

  const totalPages = data ? Math.ceil(data.total / LIMIT) : 1

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Sync History</h1>
        <Select value={actionFilter} onValueChange={(v) => { setActionFilter(v); setPage(1) }}>
          <SelectTrigger className="w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="created">Created</SelectItem>
            <SelectItem value="updated">Updated</SelectItem>
            <SelectItem value="deleted">Deleted</SelectItem>
            <SelectItem value="error">Errors</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Card>
        <CardContent className="pt-4">
          {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
          {!isLoading && data?.items.length === 0 && (
            <p className="text-sm text-muted-foreground">No sync history yet.</p>
          )}
          <ul className="divide-y">
            {data?.items.map((item) => (
              <li key={item.id} className="py-3 flex items-start gap-3">
                <span className={`text-sm font-medium capitalize w-16 shrink-0 ${ACTION_COLORS[item.action]}`}>
                  {item.action}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">
                    {item.google_calendar_id ?? '—'}
                  </p>
                  {item.detail && (
                    <p className="text-xs text-destructive truncate">{item.detail}</p>
                  )}
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(item.synced_at), { addSuffix: true })}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(p => p - 1)}
          >
            ← Prev
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(p => p + 1)}
          >
            Next →
          </Button>
        </div>
      )}
    </div>
  )
}
