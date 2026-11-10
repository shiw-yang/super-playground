import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOCS = join(ROOT, 'docs')
const NUMBERED = /^(\d{3})-[a-z0-9-]+\.md$/
/** Local-only working material, excluded from git and not shipped; it is not part of the checked set. */
const LOCAL_ONLY = ['docs/agent-roadmap/']
/** Entry documents the structure in docs/README.md relies on. */
const ENTRY_DOCS = [
  'AGENTS.md',
  'docs/README.md',
  'docs/architecture.md',
  'docs/development.md',
  'docs/testing.md',
  'docs/subsystems/README.md',
  'docs/cookbook/README.md',
  'docs/user/index.md',
  'docs/i18n/README.md',
  'docs/defensive-patterns/README.md',
  '.agents/notes/README.md',
]
const roots = ['README.md', 'SETUP.md', 'AGENTS.md']
const markdown = (directory: string): string[] => readdirSync(directory, { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile() && entry.name.endsWith('.md'))
  .map(entry => relative(ROOT, join(entry.parentPath, entry.name)))
const notes = markdown(join(ROOT, '.agents', 'notes'))
const docs = markdown(DOCS).filter(path => !LOCAL_ONLY.some(prefix => path.startsWith(prefix))).sort()
/** Every shipped markdown document: root entries, the docs tree and the design notes. */
const documents = [...roots, ...docs, ...notes]
const numbered = readdirSync(DOCS).filter(name => NUMBERED.test(name)).sort()
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8')
/** Document text without code: links and prose inside code blocks are examples, not links or prose. */
const content = (path: string): string => read(path).replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
/** Relative link targets of a document, without external links and anchors. */
function targets(file: string): string[] {
  return [...content(file).matchAll(/\]\(([^)]+)\)/g)].flatMap(match => {
    const target = match[1]!.trim().replace(/^<|>$/g, '').split(/\s+/)[0]!.split('#')[0]
    return target && !/^[a-z]+:/i.test(target) ? [target] : []
  })
}
/**
 * Read a two-column table under `## <heading>` of a document; return the repo-relative file paths of its first column.
 * Bare filenames inherit the directory of the preceding path in the same cell.
 */
function table(path: string, heading: string): string[] {
  const lines = read(path).split('\n')
  const start = lines.indexOf(`## ${heading}`)
  if (start < 0) return []
  const end = lines.findIndex((line, index) => index > start && line.startsWith('## '))
  // The first two rows are the header and its separator.
  const rows = lines.slice(start, end < 0 ? undefined : end).filter(line => line.startsWith('| ')).slice(2)
  return rows.flatMap(row => {
    let directory = ''
    return [...row.split('|')[1]!.matchAll(/`([^`]+)`/g)].map(([, name]) => {
      if (!name!.includes('/')) return join(directory, name!)
      directory = dirname(name!)
      return name!
    })
  })
}
const files = (directory: string): string[] => readdirSync(join(ROOT, directory), { recursive: true, withFileTypes: true })
  .filter(entry => entry.isFile()).map(entry => relative(ROOT, join(entry.parentPath, entry.name)))
/** The anchor GitHub assigns to a heading: lowercased, punctuation removed, spaces replaced by hyphens. */
const slug = (text: string): string => text.trim()
  .replace(/`([^`]*)`/g, '$1').replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
  .toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').replace(/\s+/g, '-')
const headings = (path: string): string[] => [...read(path).matchAll(/^#{1,6}\s+(.+)$/gm)].map(match => slug(match[1]!))
/** Anchors of a document's local links, each with the file it points at (itself for a bare `#…`). */
function anchorTargets(file: string): Array<{ path: string; anchor: string }> {
  return [...content(file).matchAll(/\]\(([^)]+)\)/g)].flatMap(match => {
    const raw = match[1]!.trim().replace(/^<|>$/g, '').split(/\s+/)[0]!
    if (/^[a-z]+:/i.test(raw)) return []
    const [path, anchor] = raw.split('#')
    if (!anchor || (path && !path.endsWith('.md'))) return []
    return [{ path: path || file, anchor }]
  })
}

describe('documentation', () => {
  it('keeps the entry documents the structure relies on', () => {
    expect(ENTRY_DOCS.filter(path => !existsSync(join(ROOT, path)))).toEqual([])
  })
  it('numbers documents consecutively from 000', () => {
    expect(numbered.map(name => name.slice(0, 3))).toEqual(numbered.map((_, index) => String(index).padStart(3, '0')))
  })
  it('links numbered documents only to earlier numbered documents', () => {
    const violations = numbered.flatMap(name => targets(join('docs', name)).flatMap(target => {
      const linked = resolve(ROOT, 'docs', target)
      if (!linked.endsWith('.md')) return []
      const basename = linked.slice(linked.lastIndexOf('/') + 1)
      const number = NUMBERED.exec(basename)?.[1]
      // A reference document or a file outside docs/ is an entry, not part of the ordered sequence.
      if (dirname(linked) !== DOCS || number === undefined) return []
      return number < name.slice(0, 3) ? [] : [`docs/${name} → ${target}`]
    }))
    expect(violations).toEqual([])
  })
  it('resolves every local link in every shipped document', () => {
    const missing = documents.flatMap(file => targets(file).filter(target => !existsSync(resolve(dirname(join(ROOT, file)), target))).map(target => `${file} → ${target}`))
    expect(missing).toEqual([])
  })
  it('resolves every anchor to a heading in its target document', () => {
    const missing = documents.flatMap(file => anchorTargets(file).flatMap(({ path, anchor }) => {
      const target = relative(ROOT, resolve(dirname(join(ROOT, file)), path))
      return existsSync(join(ROOT, target)) && !headings(target).includes(anchor) ? [`${file} → ${path}#${anchor}`] : []
    }))
    expect(missing).toEqual([])
  })
  it('links every shipped document from the documentation index', () => {
    const index = 'docs/README.md'
    const indexed = new Set(targets(index).map(target => relative(ROOT, resolve(DOCS, target))))
    const missing = docs.filter(path => path !== index && !indexed.has(path))
    expect(missing).toEqual([])
  })
  it('leaves no merge conflict markers in any document', () => {
    expect(documents.filter(path => /^(<{7}|>{7}) /m.test(read(path)))).toEqual([])
  })
  it('writes documentation prose in English', () => {
    const chinese = /[\u4e00-\u9fff]/
    expect(documents.filter(path => chinese.test(content(path)))).toEqual([])
  })
  it('lists every module of src in the module table of 007 Architecture, and only files that exist', () => {
    const modules = table('docs/007-architecture.md', 'Modules')
    expect(files('src').filter(path => !modules.includes(path))).toEqual([])
    expect(modules.filter(path => !existsSync(join(ROOT, path)))).toEqual([])
  })
  it('lists every test in the test catalog of docs/testing.md, and only files that exist', () => {
    const catalog = table('docs/testing.md', 'Test catalog')
    expect(files('tests').filter(path => /\.spec\.tsx?$/.test(path) && !catalog.includes(path))).toEqual([])
    expect(catalog.filter(path => !existsSync(join(ROOT, path)))).toEqual([])
  })
})
