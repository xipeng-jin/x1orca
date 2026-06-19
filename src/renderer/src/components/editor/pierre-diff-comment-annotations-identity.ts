import type { DiffLineAnnotation } from '@pierre/diffs'
import type { DiffComment } from '../../../../shared/types'
import { getContentFingerprint } from './pierre-content-fingerprint'

function getPierreDiffCommentValueIdentity(value: unknown): string {
  if (typeof value === 'string') {
    return `string:${value.length}:${getContentFingerprint(value)}`
  }
  if (
    value === null ||
    value === undefined ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return `${typeof value}:${String(value)}`
  }
  const serialized = JSON.stringify(value) ?? ''
  return `json:${serialized.length}:${getContentFingerprint(serialized)}`
}

function getPierreDiffCommentMetadataIdentity(comment: DiffComment): string {
  return Object.entries(comment)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${getPierreDiffCommentValueIdentity(value)}`)
    .join('\u001f')
}

export function getPierreDiffCommentAnnotationsIdentity(
  annotations: readonly DiffLineAnnotation<DiffComment>[]
): string {
  return annotations
    .map(
      ({ lineNumber, metadata, side }) =>
        `${side}\u001f${lineNumber}\u001f${getPierreDiffCommentMetadataIdentity(metadata)}`
    )
    .join('\u001e')
}
