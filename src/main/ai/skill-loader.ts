// Loads the application-owned skill package from the bundled skills/ folder only.
// Paths are fixed and checked so user input can never point the loader elsewhere.

import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { PlatformRules } from '@shared/limits'

export interface SkillExample {
  situation: string
  good: string[]
  bad: string[]
}

export interface Skill {
  name: string
  version: string
  description: string
  instructions: string
  rules: PlatformRules
  examples: SkillExample[]
}

const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/
const FILES = { skill: 'SKILL.md', rules: 'platform-rules.json', examples: 'examples.json' } as const

function insideRoot(root: string, target: string): boolean {
  const r = realpathSync(root)
  const t = realpathSync(target)
  return t === r || t.startsWith(r.endsWith(sep) ? r : r + sep)
}

export function parseFrontmatter(md: string): { meta: Record<string, string>; body: string } {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(md)
  if (!m) return { meta: {}, body: md }
  const meta: Record<string, string> = {}
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line)
    if (kv) meta[kv[1]] = kv[2].trim()
  }
  return { meta, body: md.slice(m[0].length) }
}

export function loadSkill(skillsRoot: string, name = 'social-content'): Skill {
  if (!SKILL_NAME_RE.test(name)) throw new Error('Invalid skill name')
  const root = resolve(skillsRoot)
  const dir = resolve(root, name)
  if (!existsSync(dir) || !insideRoot(root, dir)) throw new Error(`Skill "${name}" not found in bundled skills folder`)

  const read = (file: string) => {
    const p = join(dir, file)
    if (!existsSync(p) || !insideRoot(dir, p)) throw new Error(`Skill file missing: ${file}`)
    return readFileSync(p, 'utf8')
  }

  const { meta, body } = parseFrontmatter(read(FILES.skill))
  const rules = JSON.parse(read(FILES.rules)) as PlatformRules
  const examples = (JSON.parse(read(FILES.examples)) as { examples: SkillExample[] }).examples ?? []
  if (!meta.version) throw new Error('SKILL.md has no version in its frontmatter')
  return {
    name: meta.name || name,
    version: meta.version,
    description: meta.description ?? '',
    instructions: body.trim(),
    rules,
    examples
  }
}
