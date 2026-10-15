// Plain-text formatting of packages, shared by "copy full package" and TXT export.
// Editor-only notes (missing info, source refs, feedback) are never included in
// publishable text.

import type { ContentPackage } from './content-schema'
import { CONTENT_TYPES, FIELD_LABELS, contentTypeLabel, type FieldKey } from './platform-types'

export function recommendedTitle(pkg: ContentPackage): string | undefined {
  const list = pkg.titleOptions ?? pkg.hookOptions
  if (!list?.length) return pkg.hook
  return list[pkg.recommendedIndex ?? 0] ?? list[0]
}

export function hashtagLine(pkg: ContentPackage, includeExpanded = false): string {
  if (!pkg.hashtags) return ''
  return [...pkg.hashtags.recommended, ...(includeExpanded ? pkg.hashtags.expanded : [])].join(' ')
}

/** The ready-to-paste publishable text for one package. */
export function publishableText(pkg: ContentPackage): string {
  const spec = CONTENT_TYPES[pkg.contentType]
  const parts: string[] = []
  const title = recommendedTitle(pkg)
  if (spec.required.includes('titleOptions') && title) parts.push(title)
  if (spec.required.includes('hookOptions') && title) parts.push(title)
  if (pkg.hook && !spec.required.includes('hookOptions')) parts.push(pkg.hook)
  if (pkg.postText) parts.push(pkg.postText)
  if (pkg.description) parts.push(pkg.description)
  if (pkg.caption) parts.push(pkg.caption)
  if (pkg.slideTexts?.length) parts.push(pkg.slideTexts.map((s, i) => `${i + 1}. ${s}`).join('\n'))
  if (pkg.poll) parts.push(`${pkg.poll.question}\n${pkg.poll.choices.map((c) => `• ${c}`).join('\n')}`)
  if (pkg.overlayText && pkg.contentType === 'ig_story') parts.push(pkg.overlayText)
  if (pkg.interactionPrompt) parts.push(pkg.interactionPrompt)
  const tags = hashtagLine(pkg)
  if (tags) parts.push(tags)
  return parts.join('\n\n')
}

const ORDER: FieldKey[] = [
  'titleOptions',
  'hookOptions',
  'hook',
  'hook3s',
  'postText',
  'description',
  'caption',
  'thumbnailText',
  'overlayText',
  'slideTexts',
  'poll',
  'pinnedComment',
  'cta',
  'interactionPrompt',
  'keywords',
  'hashtags'
]

/** Every field with labels — used for the TXT export and the "full package" view. */
export function fullPackageText(pkg: ContentPackage, opts: { includeNotes?: boolean } = {}): string {
  const lines: string[] = [`=== ${contentTypeLabel(pkg.contentType)} ===`]
  for (const f of ORDER) {
    const v = (pkg as unknown as Record<string, unknown>)[f]
    if (v === undefined) continue
    const label = FIELD_LABELS[f]
    if (f === 'titleOptions' || f === 'hookOptions') {
      const list = v as string[]
      lines.push(`${label}:`)
      list.forEach((t, i) => lines.push(`  ${i + 1}. ${t}${i === (pkg.recommendedIndex ?? 0) ? '  (recommended)' : ''}`))
    } else if (f === 'hashtags') {
      const h = v as { recommended: string[]; expanded: string[] }
      lines.push(`Hashtags: ${h.recommended.join(' ')}`)
      if (h.expanded.length) lines.push(`More hashtags: ${h.expanded.join(' ')}`)
    } else if (f === 'poll') {
      const p = v as { question: string; choices: string[] }
      lines.push(`Poll: ${p.question}`)
      p.choices.forEach((c) => lines.push(`  • ${c}`))
    } else if (f === 'keywords') {
      lines.push(`${label}: ${(v as string[]).join(', ')}`)
    } else if (f === 'slideTexts') {
      lines.push(`${label}:`)
      ;(v as string[]).forEach((s, i) => lines.push(`  ${i + 1}. ${s}`))
    } else {
      lines.push(`${label}:`, String(v))
    }
  }
  if (opts.includeNotes) {
    if (pkg.missingInfoNotes.length) lines.push('', '[Editor note — missing information]', ...pkg.missingInfoNotes.map((n) => `- ${n}`))
    if (pkg.sourceRefs.length) lines.push('', '[Editor note — sources]', ...pkg.sourceRefs.map((n) => `- ${n}`))
  }
  return lines.join('\n')
}
