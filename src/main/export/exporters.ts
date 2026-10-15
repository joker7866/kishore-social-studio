// TXT / JSON / CSV / printable HTML exports. API keys never appear in exports:
// nothing secret is stored with drafts, and every export passes through redaction.

import { collectTexts } from '@shared/content-schema'
import { fullPackageText } from '@shared/format'
import type { DraftDetail } from '@shared/ipc-contract'
import { CONTENT_TYPES, FIELD_LABELS, PLATFORM_LABELS, PROVIDER_LABELS, contentTypeLabel, type FieldKey } from '@shared/platform-types'
import { redact, redactDeep } from '../security/redact'

export function draftToText(d: DraftDetail): string {
  const head = [
    `Kishore Social Studio — ${d.title}`,
    `Headline: ${d.headline}`,
    `Created: ${d.createdAt}   Updated: ${d.updatedAt}`,
    ''
  ]
  const body = d.packages.map((p) => {
    const meta = `(${PROVIDER_LABELS[p.provider]} · ${p.model}${p.provider === 'mock' ? ' · MOCK OUTPUT' : ''})`
    return `${fullPackageText(p.current, { includeNotes: true })}\n${meta}`
  })
  return redact([...head, ...body].join('\n\n'))
}

export function draftToJson(d: DraftDetail, appVersion: string): string {
  const out = {
    format: 'kishore-social-studio-draft',
    appVersion,
    exportedAt: new Date().toISOString(),
    draft: {
      title: d.title,
      headline: d.headline,
      input: d.input,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      packages: d.packages.map((p) => ({
        platform: p.platform,
        contentType: p.contentType,
        provider: p.provider,
        model: p.model,
        skillVersion: p.skillVersion,
        generatedAt: p.generatedAt,
        generated: p.generated,
        edited: p.edited,
        warnings: p.warnings
      }))
    }
  }
  return JSON.stringify(redactDeep(out), null, 2)
}

/**
 * Neutralise spreadsheet formulas: a cell starting with = + - @ tab or CR is
 * prefixed with an apostrophe so Excel treats it as text.
 */
export function csvSafeCell(value: string): string {
  const v = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return `"${v.replace(/"/g, '""')}"`
}

export function draftsToCsv(drafts: DraftDetail[]): string {
  const header = ['draft_id', 'draft_title', 'headline', 'platform', 'content_type', 'field', 'value', 'provider', 'model', 'edited', 'updated_at']
  const rows: string[][] = []
  for (const d of drafts) {
    for (const p of d.packages) {
      for (const { path, text } of collectTexts(p.current)) {
        rows.push([
          String(d.id),
          d.title,
          d.headline,
          PLATFORM_LABELS[p.platform],
          CONTENT_TYPES[p.contentType].label,
          path,
          text,
          p.provider,
          p.model,
          p.edited ? 'yes' : 'no',
          d.updatedAt
        ])
      }
    }
  }
  // UTF-8 BOM so Excel opens Tamil text correctly.
  return '﻿' + [header, ...rows].map((r) => r.map((c) => csvSafeCell(redact(c))).join(',')).join('\r\n')
}

export function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

const HTML_ORDER: FieldKey[] = [
  'titleOptions', 'hookOptions', 'hook', 'hook3s', 'postText', 'description', 'caption', 'thumbnailText',
  'overlayText', 'slideTexts', 'poll', 'pinnedComment', 'cta', 'interactionPrompt', 'keywords', 'hashtags'
]

/** Printable, self-contained HTML sheet (fonts embedded, no scripts). */
export function draftToHtml(d: DraftDetail, fontCss: string): string {
  const sections = d.packages
    .map((p) => {
      const pkg = p.current as unknown as Record<string, unknown>
      const rows = HTML_ORDER.filter((f) => pkg[f] !== undefined)
        .map((f) => {
          const v = pkg[f]
          let html: string
          if (f === 'titleOptions' || f === 'hookOptions') {
            html = `<ol>${(v as string[])
              .map((t, i) => `<li${i === (p.current.recommendedIndex ?? 0) ? ' class="rec"' : ''}>${escapeHtml(t)}</li>`)
              .join('')}</ol>`
          } else if (f === 'hashtags') {
            const h = v as { recommended: string[]; expanded: string[] }
            html = `<div>${escapeHtml(h.recommended.join(' '))}</div>${h.expanded.length ? `<div class="muted">${escapeHtml(h.expanded.join(' '))}</div>` : ''}`
          } else if (f === 'poll') {
            const pl = v as { question: string; choices: string[] }
            html = `<div>${escapeHtml(pl.question)}</div><ul>${pl.choices.map((c) => `<li>${escapeHtml(c)}</li>`).join('')}</ul>`
          } else if (Array.isArray(v)) {
            html = `<ol>${(v as string[]).map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ol>`
          } else {
            html = `<div class="pre">${escapeHtml(String(v))}</div>`
          }
          return `<tr><th>${escapeHtml(FIELD_LABELS[f])}</th><td>${html}</td></tr>`
        })
        .join('')
      const notes = p.current.missingInfoNotes.length
        ? `<p class="note"><b>Editor note — missing information:</b> ${p.current.missingInfoNotes.map(escapeHtml).join(' · ')}</p>`
        : ''
      const mock = p.provider === 'mock' ? '<span class="mock">MOCK OUTPUT</span>' : ''
      return `<section><h2>${escapeHtml(contentTypeLabel(p.contentType))} ${mock}</h2><table>${rows}</table>${notes}
        <p class="meta">${escapeHtml(PROVIDER_LABELS[p.provider])} · ${escapeHtml(p.model)} · skill ${escapeHtml(p.skillVersion)}</p></section>`
    })
    .join('\n')

  return redact(`<!doctype html>
<html lang="ta"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:;">
<title>${escapeHtml(d.title)}</title>
<style>
${fontCss}
body { font-family: 'Noto Sans Tamil', 'Nirmala UI', sans-serif; color: #0B1F3A; margin: 24px; line-height: 1.55; }
header { border-bottom: 3px solid #1E5AA8; margin-bottom: 16px; }
h1 { font-size: 20px; margin: 0 0 4px; } h2 { font-size: 16px; color: #1E5AA8; margin: 20px 0 8px; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th { text-align: left; width: 160px; vertical-align: top; padding: 6px; background: #EEF3FA; }
td { padding: 6px; border-bottom: 1px solid #DDE5F0; }
.pre { white-space: pre-wrap; } .muted, .meta { color: #5B6B82; font-size: 12px; }
li.rec { font-weight: 700; } .note { font-size: 12px; background: #FFF6E0; padding: 6px; }
.mock { background: #B45309; color: #fff; font-size: 11px; padding: 2px 6px; border-radius: 4px; }
section { page-break-inside: avoid; }
</style></head>
<body><header><h1>${escapeHtml(d.title)}</h1>
<div class="muted">${escapeHtml(d.headline)}</div>
<div class="muted">Updated ${escapeHtml(d.updatedAt)}</div></header>
${sections}
</body></html>`)
}
