import { atom, read, update } from 'claude-code'
import type { CommandInfo, Elements, EngineInterface, RenderElement, Register } from 'claude-code'

import type { Skill } from '../types'

const PANE = 'skill-picker'
const TITLE = 'Skills'
const COMMAND = 'skill-picker'
const CLAY = '#d97757'
const AMBER = '#fbbf24'

// The line this mod owns in the prompt box. It is found again by its head, so
// picking or unpicking rewrites it in place and leaves the rest of the draft.
const LINE_HEAD = 'Use these skills: '
const MANAGED = /^Use these skills: [^\n]*\n?/m

// Rows drawn under ALL SKILLS before the list asks for a search.
const MAX_ROWS = 150

const skills = atom({ plugin: 'skill-picker', key: 'skills' } as const, [], { shape: 'skills-1' })
const picks = atom({ plugin: 'skill-picker', key: 'picks' } as const, [])
const suggested = atom({ plugin: 'skill-picker', key: 'suggested' } as const, [])
const query = atom({ plugin: 'skill-picker', key: 'query' } as const, '')
const autoInsert = atom({ plugin: 'skill-picker', key: 'autoInsert' } as const, true)
const notice = atom({ plugin: 'skill-picker', key: 'notice' } as const, '')
const isLoading = atom({ plugin: 'skill-picker', key: 'isLoading' } as const, false)
const isSuggesting = atom({ plugin: 'skill-picker', key: 'isSuggesting' } as const, false)

type Kit = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button' | 'Input'>

type View = {
  project: string
  skills: Skill[]
  picks: string[]
  suggested: string[]
  query: string
  autoInsert: boolean
  notice: string
  isLoading: boolean
  isSuggesting: boolean
}

// The session's project folder, set at session.start (a reload runs it again).
let cwd = ''
// What the person typed in the search field. Kept here as well as in state so
// a redraw hands the field back exactly what was typed.
let typedQuery = ''
// Set when the prompt box refused the picks: the next message gets them instead.
let isArmed = false

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Windows paths name the same folder whatever their case or slashes.
function projectKey(path: string): string {
  const plain = path.replace(/\\/g, '/').replace(/\/+$/, '')
  return /^[a-zA-Z]:/.test(plain) ? plain.toLowerCase() : plain
}

function projectName(path: string): string {
  return path.split(/[\\/]+/).filter(Boolean).at(-1) ?? path
}

function picksFor(raw: unknown, path: string): string[] {
  if (!isRecord(raw)) return []
  const saved = raw[projectKey(path)]

  return Array.isArray(saved) ? saved.filter((n): n is string => typeof n === 'string') : []
}

function sourceLabel(source: string): string {
  if (source === 'userSettings' || source === 'user') return 'user'
  if (source === 'projectSettings') return 'project'
  if (source === 'builtin' || source === 'built-in') return 'built-in'

  return source
}

function lineOf(list: readonly string[]): string {
  return list.length === 0 ? '' : `${LINE_HEAD}${list.map(n => `/${n}`).join(', ')}`
}

function clip(text: string, room: number): string {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length <= room ? flat : `${flat.slice(0, Math.max(0, room - 3)).trimEnd()}...`
}

function matchesAll(skill: Skill, terms: readonly string[]): boolean {
  const hay = `${skill.name} ${skill.description}`.toLowerCase()

  return terms.every(t => hay.includes(t))
}

async function say($: EngineInterface, text: string) {
  await update($, notice, () => text)
}

// The skills the session lists for the model, with the one line the slash
// typeahead shows for each. Commands that are not in the listing (it can be cut
// to a token budget) are added from the typeahead's own list.
async function loadSkills($: EngineInterface): Promise<Skill[]> {
  const commands: CommandInfo[] = await $.command.list().catch(() => [])
  const described = new Map(commands.map(c => [c.name, c.description]))
  const found = new Map<string, Skill>()

  try {
    const usage = await $.session.usage({ breakdown: 'summary' })
    for (const s of usage.context.breakdown?.skills?.skillFrontmatter ?? []) {
      found.set(s.name, {
        name: s.name,
        description: described.get(s.name) ?? '',
        source: sourceLabel(s.pluginName ?? String(s.source)),
      })
    }
  } catch {
    // No breakdown in this session: the typeahead's list below stands alone.
  }

  for (const c of commands) {
    if (found.has(c.name) || c.name === COMMAND) continue
    if (c.source !== 'user' && c.source !== 'plugin') continue
    found.set(c.name, { name: c.name, description: c.description, source: sourceLabel(c.plugin ?? c.source) })
  }

  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name))
}

async function refresh($: EngineInterface) {
  await update($, isLoading, () => true)
  try {
    const list = await loadSkills($)
    await update($, skills, () => list)
  } catch {
    await say($, 'Could not read the skill list. Press Refresh to try again.')
  } finally {
    await update($, isLoading, () => false)
  }
}

// Writes the picks as one line at the top of the prompt box, replacing the line
// written before and keeping whatever the person typed under it.
async function writeDraft($: EngineInterface, list: readonly string[]) {
  const box = await $.prompt.read()
  const rest = box.text.replace(MANAGED, '')
  const line = lineOf(list)
  const text = line === '' ? rest : `${line}\n${rest}`
  if (text === box.text) return

  const filled = await $.prompt.fill({ text, mode: 'replace' })
  if (filled.isFilled) {
    isArmed = false
    if ((await read($, notice)).startsWith('The prompt box')) await say($, '')

    return
  }

  isArmed = line !== ''
  if (isArmed) {
    await say($, 'The prompt box is busy right now, so the picks will be added to the top of your next message.')
  }
}

async function savePicks($: EngineInterface, list: readonly string[]) {
  const raw = await $.store.get('projects')
  const all: Record<string, unknown> = isRecord(raw) ? { ...raw } : {}
  const key = projectKey(cwd)
  if (list.length === 0) delete all[key]
  else all[key] = [...list]
  await $.store.set('projects', all)
}

async function setPicks($: EngineInterface, fn: (list: string[]) => string[]) {
  const list = await update($, picks, fn)
  await savePicks($, list)
  if (await read($, autoInsert)) await writeDraft($, list)
}

function toggle($: EngineInterface, name: string) {
  return setPicks($, list => (list.includes(name) ? list.filter(n => n !== name) : [...list, name]))
}

async function clearPicks($: EngineInterface) {
  await setPicks($, () => [])
  await writeDraft($, [])
}

async function insertNow($: EngineInterface) {
  const list = await read($, picks)
  if (list.length === 0) {
    await say($, 'Pick at least one skill first.')

    return
  }
  await writeDraft($, list)
}

async function toggleAuto($: EngineInterface) {
  const isOn = await update($, autoInsert, x => !x)
  await $.store.set('prefs', { autoInsert: isOn })
  if (isOn) await writeDraft($, await read($, picks))
}

async function readNotes($: EngineInterface): Promise<string> {
  let notes = ''
  for (const name of ['CLAUDE.md', 'README.md']) {
    try {
      const text = await $.fs.read(`${cwd}/${name}`)
      notes += `\n--- ${name} (start)\n${text.slice(0, 3000)}\n`
    } catch {
      // Not every project has one.
    }
  }

  return notes
}

// Asks a small model which of the listed skills fit the project folder, from
// its name, its top-level entries and the start of its CLAUDE.md and README.
async function suggest($: EngineInterface) {
  if (await read($, isSuggesting)) return
  await update($, isSuggesting, () => true)
  await say($, '')

  try {
    const list = await read($, skills)
    const names = new Set(list.map(s => s.name))
    let entries = ''
    try {
      entries = (await $.fs.list(cwd))
        .slice(0, 80)
        .map(f => (f.kind === 'dir' ? `${f.name}/` : f.name))
        .join(', ')
    } catch {
      entries = '(could not list)'
    }
    const catalog = list.map(s => `- ${s.name}: ${clip(s.description, 160)}`).join('\n')
    const prompt = [
      `Project folder: ${projectName(cwd)} (${cwd})`,
      `Top-level entries: ${entries}`,
      await readNotes($),
      'Available skills:',
      catalog,
      '',
      'Pick the skills from the list above that would genuinely help with the work in this project, at most 8, best first.',
      'Answer with a JSON array of the exact skill names only, nothing else.',
    ].join('\n')

    const answer = await $.model.complete({ model: 'haiku', prompt, maxTokens: 400, timeoutMs: 60000 })
    if (!answer.isAnswered) {
      await say($, 'The suggestion did not come back. Try again in a moment.')

      return
    }

    let parsed: unknown = []
    try {
      parsed = JSON.parse(answer.text.match(/\[[\s\S]*\]/)?.[0] ?? '[]')
    } catch {
      parsed = []
    }
    const picked = Array.isArray(parsed)
      ? parsed.filter((n): n is string => typeof n === 'string' && names.has(n))
      : []
    await update($, suggested, () => [...new Set(picked)])
    await say($, picked.length === 0 ? 'No skill stood out for this project.' : '')
  } finally {
    await update($, isSuggesting, () => false)
  }
}

function section(ui: Kit, label: string, count: number): RenderElement {
  const { Box, Text } = ui

  return (
    <Box flexDirection="row" justifyContent="space-between">
      <Text dimColor bold>
        {label}
      </Text>
      <Text dimColor bold>
        {count}
      </Text>
    </Box>
  )
}

function mark(ui: Kit, isOn: boolean): RenderElement {
  const { Text } = ui

  return isOn ? <Text color={CLAY}>●</Text> : <Text dimColor>○</Text>
}

// One skill: the mark, its name as the button that picks or unpicks it, and
// the start of what it does, cut to the room left on the line.
function row($: EngineInterface, ui: Kit, skill: Skill, isPicked: boolean, width: number, prefix: string): RenderElement {
  const { Box, Button, Text } = ui
  const room = width - skill.name.length - 6
  const desc = room > 10 && skill.description !== '' ? clip(skill.description, room) : ''

  return (
    <Box flexDirection="row" columnGap={1}>
      {mark(ui, isPicked)}
      <Button key={`${prefix}-${skill.name}`} plain label={skill.name} onPress={() => toggle($, skill.name)} />
      {desc !== '' && <Text dimColor>{desc}</Text>}
    </Box>
  )
}

function body($: EngineInterface, ui: Kit, v: View, columns: number): RenderElement {
  const { Box, Text, Button, Input } = ui
  const terms = v.query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  const shown = v.skills.filter(s => matchesAll(s, terms))
  const pickedSet = new Set(v.picks)
  const known = new Map(v.skills.map(s => [s.name, s]))
  const suggestions = v.suggested.filter(n => !pickedSet.has(n))
  const width = Math.max(24, columns)
  const skillOf = (name: string): Skill => known.get(name) ?? { name, description: '', source: '' }

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text color={CLAY} bold>
          SKILLS
        </Text>
        <Text dimColor>
          {`${v.project} · ${v.picks.length} picked · ${v.skills.length} installed`}
        </Text>
      </Box>

      <Input
        key="search"
        placeholder="Search by name or what it does"
        submitLabel="search"
        value={typedQuery}
        onInput={value => {
          typedQuery = value
          void update($, query, () => value)
        }}
        onSubmit={value => {
          typedQuery = value
          void update($, query, () => value)
        }}
      />

      <Box flexDirection="row" columnGap={1} flexWrap="wrap">
        <Button key="insert" label="Insert into prompt" variant="primary" onPress={() => insertNow($)} />
        <Button
          key="suggest"
          label={v.isSuggesting ? 'Suggesting...' : 'Suggest for project'}
          onPress={() => suggest($)}
        />
        <Button key="clear" label="Clear" onPress={() => clearPicks($)} />
        <Button key="refresh" label={v.isLoading ? 'Loading...' : 'Refresh'} onPress={() => refresh($)} />
      </Box>

      <Box flexDirection="row" columnGap={1}>
        {mark(ui, v.autoInsert)}
        <Button
          key="auto"
          plain
          label={`Auto-insert picks into the prompt box: ${v.autoInsert ? 'On' : 'Off'}`}
          onPress={() => toggleAuto($)}
        />
      </Box>

      {v.notice !== '' && (
        <Box flexDirection="row" justifyContent="space-between" columnGap={1}>
          <Text color={AMBER} wrap="wrap">
            {v.notice}
          </Text>
          <Button key="notice-close" plain dimColor label="✕" onPress={() => say($, '')} />
        </Box>
      )}

      {v.picks.length > 0 && (
        <Box flexDirection="column">
          {section(ui, 'PICKED FOR THIS PROJECT', v.picks.length)}
          {v.picks.map(name => row($, ui, skillOf(name), true, width, 'pick'))}
        </Box>
      )}

      {suggestions.length > 0 && (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text dimColor bold>
              {`SUGGESTED · ${suggestions.length}`}
            </Text>
            <Button
              key="add-suggested"
              plain
              label="Add all"
              onPress={() => setPicks($, list => [...list, ...suggestions.filter(n => !list.includes(n))])}
            />
          </Box>
          {suggestions.map(name => row($, ui, skillOf(name), false, width, 'sug'))}
        </Box>
      )}

      <Box flexDirection="column">
        {section(ui, terms.length > 0 ? 'MATCHES' : 'ALL SKILLS', shown.length)}
        {v.isLoading && v.skills.length === 0 && <Text dimColor>Reading your skills...</Text>}
        {!v.isLoading && shown.length === 0 && (
          <Text dimColor>{terms.length > 0 ? 'No skill matches that search.' : 'No skills found. Press Refresh.'}</Text>
        )}
        {shown.slice(0, MAX_ROWS).map(s => row($, ui, s, pickedSet.has(s.name), width, 'all'))}
        {shown.length > MAX_ROWS && (
          <Text dimColor>{`Showing ${MAX_ROWS} of ${shown.length}. Search to narrow the list.`}</Text>
        )}
      </Box>
    </Box>
  )
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const started = await next(e)
    cwd = e.cwd

    const prefs = await $.store.get('prefs')
    const isAuto = !(isRecord(prefs) && prefs.autoInsert === false)
    const saved = picksFor(await $.store.get('projects'), cwd)
    await update($, autoInsert, () => isAuto)
    await update($, picks, () => saved)
    await update($, suggested, () => [])
    await refresh($)

    await $.command.register({
      name: COMMAND,
      description: 'Open the Skills pane: search your skills and pick the ones this project needs',
    })
    void $.ui.open({ id: PANE, title: TITLE })

    // A new conversation in a project with picks starts with them in the box,
    // once the box is there to take them.
    if (isAuto && saved.length > 0) {
      $.clock.after(1500, () => {
        void (async () => {
          const box = await $.prompt.read()
          if (!MANAGED.test(box.text)) await writeDraft($, await read($, picks))
        })()
      })
    }

    return started
  })

  on('command.run', { command: COMMAND }, async $ => {
    await $.ui.open({ id: PANE, title: TITLE, focus: true })

    return { text: 'Opened the Skills pane.' }
  })

  // When the box could not take the picks, they ride on the next message.
  on('prompt.submit', async ($, e, next) => {
    if (!isArmed || e.command !== undefined || e.isMeta === true) return next(e)
    isArmed = false
    const line = lineOf(await read($, picks))
    if (line === '' || MANAGED.test(e.text)) return next(e)

    return next({ ...e, text: `${line}\n${e.text}` })
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const view: View = {
      project: projectName(cwd),
      skills: await read($, skills),
      picks: await read($, picks),
      suggested: await read($, suggested),
      query: await read($, query),
      autoInsert: await read($, autoInsert),
      notice: await read($, notice),
      isLoading: await read($, isLoading),
      isSuggesting: await read($, isSuggesting),
    }

    if (e.surface === 'mobile') {
      const { Box, Text } = $.ui.resolve(e)

      return (
        <Box flexDirection="column" gap={1}>
          <Text color={CLAY} bold>
            SKILLS
          </Text>
          {view.picks.length === 0 ? (
            <Text dimColor>No skills picked for this project.</Text>
          ) : (
            view.picks.map(name => <Text>{`● /${name}`}</Text>)
          )}
          <Text dimColor>Open the pane on your computer to search and pick skills.</Text>
        </Box>
      )
    }

    const kit: Kit = $.ui.resolve(e)

    return body($, kit, view, e.props.bodyColumns)
  })
}
