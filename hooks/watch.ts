// The live tier's wire: what `strata doc watch --json` prints, one JSON
// object per line, and how a roster changes as collaborators come and go.
// Pure functions: no `$`, no state.

import type { StrataPresence } from '../types'

/** One line of the watch's output, as the mod reads it. */
export type WatchEvent =
  | { event: 'snapshot'; documentId: string; documentVersion: number; title: string; markdown: string; reason: string }
  | { event: 'presence'; documentId: string; collaborators: StrataPresence[] }
  | { event: 'collaboratorJoined'; documentId: string; collaborator: StrataPresence }
  | { event: 'collaboratorLeft'; documentId: string; entityId: string; clientKind: string }
  | { event: 'comment'; documentId: string; commentId: string; change: string }
  | { event: 'suggestion'; documentId: string; suggestionId: string; change: string }
  | { event: 'status'; documentId: string; state: string; reason: string | null; attempt: number | null }
  | { event: 'error'; documentId: string; code: string; message: string }

function participantOf(value: unknown): StrataPresence | null {
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  if (typeof row.entityId !== 'string') return null
  return {
    entityId: row.entityId,
    name: typeof row.displayName === 'string' && row.displayName !== '' ? row.displayName : row.entityId,
    color: typeof row.color === 'string' ? row.color : '',
    kind: typeof row.clientKind === 'string' ? row.clientKind : row.entityType === 'agent' ? 'agent' : 'web',
  }
}

/** Parse one line of the watch's output; null for a blank line, a non-JSON line, or an event the mod does not know. */
export function parseWatchEvent(line: string): WatchEvent | null {
  const trimmed = line.trim()
  if (trimmed === '' || !trimmed.startsWith('{')) return null
  let value: unknown
  try {
    value = JSON.parse(trimmed)
  } catch {
    return null
  }
  if (typeof value !== 'object' || value === null) return null
  const row = value as Record<string, unknown>
  const documentId = typeof row.documentId === 'string' ? row.documentId : ''
  if (documentId === '') return null
  const text = (key: string): string => (typeof row[key] === 'string' ? (row[key] as string) : '')
  switch (row.event) {
    case 'snapshot':
      return {
        event: 'snapshot',
        documentId,
        documentVersion: typeof row.documentVersion === 'number' ? row.documentVersion : 0,
        title: text('title'),
        markdown: text('markdown'),
        reason: text('reason'),
      }
    case 'presence': {
      const rows = Array.isArray(row.collaborators) ? row.collaborators : []
      return {
        event: 'presence',
        documentId,
        collaborators: rows.map(participantOf).filter((one): one is StrataPresence => one !== null),
      }
    }
    case 'collaboratorJoined': {
      const collaborator = participantOf(row.collaborator)
      return collaborator === null ? null : { event: 'collaboratorJoined', documentId, collaborator }
    }
    case 'collaboratorLeft':
      return {
        event: 'collaboratorLeft',
        documentId,
        entityId: text('entityId'),
        clientKind: text('clientKind') || (row.entityType === 'agent' ? 'agent' : 'web'),
      }
    case 'comment':
      return { event: 'comment', documentId, commentId: text('commentId'), change: text('change') }
    case 'suggestion':
      return { event: 'suggestion', documentId, suggestionId: text('suggestionId'), change: text('change') }
    case 'status':
      return {
        event: 'status',
        documentId,
        state: text('state'),
        reason: typeof row.reason === 'string' ? row.reason : null,
        attempt: typeof row.attempt === 'number' ? row.attempt : null,
      }
    case 'error':
      return { event: 'error', documentId, code: text('code'), message: text('message') }
    default:
      return null
  }
}

/** The roster after one arrival: one row per person per client kind. */
export function withArrival(roster: readonly StrataPresence[], who: StrataPresence): StrataPresence[] {
  return [...roster.filter(one => !(one.entityId === who.entityId && one.kind === who.kind)), who]
}

/** The roster after one departure. */
export function withDeparture(roster: readonly StrataPresence[], entityId: string, kind: string): StrataPresence[] {
  return roster.filter(one => !(one.entityId === entityId && one.kind === kind))
}

/** The roster in a few words for a chip: `Priya (web), Ada (agent)`. */
export function describeRoster(roster: readonly StrataPresence[], width: number): string {
  if (roster.length === 0) return ''
  const names = roster.map(one => `${one.name} (${one.kind})`)
  let out = ''
  for (const [index, name] of names.entries()) {
    const next = out === '' ? name : `${out}, ${name}`
    if (next.length > width) {
      const rest = names.length - index
      return `${out}${out === '' ? '' : ', '}+${String(rest)}`
    }
    out = next
  }
  return out
}

/** Split a stream's text into whole lines, keeping the unfinished tail for the next piece. */
export function takeLines(buffer: string): { lines: string[]; rest: string } {
  const parts = buffer.split('\n')
  const rest = parts.pop() ?? ''
  return { lines: parts, rest }
}
