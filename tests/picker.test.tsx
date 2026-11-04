import { expect, mock, test } from 'claude-code/testing'
import type { CommandInfo, On } from 'claude-code'

const PANE = {
  plugin: 'skill-picker',
  component: 'Pane',
  requestId: 'skill-picker',
  props: {
    title: 'Skills',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 200 },
    view: {},
  },
} as const

const LISTED = [
  { name: 'castkit-v1', source: 'userSettings', tokens: 10 },
  { name: 'scenecraft-v1', source: 'userSettings', tokens: 10 },
  { name: 'figma:figma-use', source: 'plugin', pluginName: 'figma', tokens: 10 },
]

const COMMANDS: CommandInfo[] = [
  { name: 'castkit-v1', description: 'Character builder for Nano Banana Pro', source: 'user' },
  { name: 'scenecraft-v1', description: 'Scene plate builder for environments', source: 'user' },
  { name: 'figma:figma-use', description: 'Run Figma plugin code', source: 'plugin', plugin: 'figma' },
  { name: 'shotcaller-v1', description: 'Seedance video director', source: 'user' },
  { name: 'compact', description: 'Compact the conversation', source: 'builtin' },
  { name: 'skill-picker', description: 'Open the Skills pane', source: 'plugin', plugin: 'skill-picker' },
]

function world(on: On, entries: Record<string, unknown> = {}, canFill = true) {
  mock.store(on, entries)
  const clock = mock.clock(on, { now: 1_000_000 })
  const box = { text: '', cursor: 0 }
  const submitted: string[] = []

  on('command.list', () => ({ value: COMMANDS }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      rateLimits: [],
      context: {
        tokens: 0,
        window: 200000,
        breakdown: { skills: { totalSkills: 3, includedSkills: 3, tokens: 30, skillFrontmatter: LISTED } } as never,
      },
    },
  }))
  on('command.register', () => ({ value: { command: 'skill-picker' } }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('prompt.read', () => ({ value: { ...box } }))
  on('prompt.fill', (_$, e) => {
    if (!canFill) return { isFilled: false, refusal: 'dialog' }
    box.text = e.mode === 'append' ? box.text + e.text : e.text
    box.cursor = box.text.length

    return { isFilled: true }
  })
  on('prompt.submit', (_$, e) => {
    submitted.push(e.text)

    return { text: e.text }
  })

  return { box, clock, submitted }
}

for (const surface of ['terminal', 'desktop'] as const) {
  test(`lists, searches and picks skills into the prompt box (${surface})`, async ($, on) => {
    const { box } = world(on)
    await $.session.start({ cwd: 'G:\\Work\\Film', surface, isInteractive: true })
    const ui = await $.ui.mount({ ...PANE, surface })

    // Skills from the listing and the user's own commands; no built-ins, not itself.
    expect(await ui.find({ key: 'all-castkit-v1' })).toBeDefined()
    expect(await ui.find({ key: 'all-shotcaller-v1' })).toBeDefined()
    expect(await ui.find({ key: 'all-figma:figma-use' })).toBeDefined()
    expect(await ui.find({ key: 'all-compact' })).toBeUndefined()
    expect(await ui.find({ key: 'all-skill-picker' })).toBeUndefined()
    expect(await ui.find({ type: 'Text', text: /Film · 0 picked · 4 installed/ })).toBeDefined()

    // Search matches the name or the description.
    await ui.input({ key: 'search', text: 'environments', kind: 'change' })
    expect(await ui.find({ key: 'all-scenecraft-v1' })).toBeDefined()
    expect(await ui.find({ key: 'all-castkit-v1' })).toBeUndefined()

    // Picking writes the line into the box, keeping what was typed under it.
    box.text = 'make a rooftop plate'
    await ui.press({ key: 'all-scenecraft-v1' })
    expect(box.text).toBe('Use these skills: /scenecraft-v1\nmake a rooftop plate')
    expect(await ui.find({ key: 'pick-scenecraft-v1' })).toBeDefined()

    await ui.input({ key: 'search', text: '', kind: 'change' })
    await ui.press({ key: 'all-castkit-v1' })
    expect(box.text).toBe('Use these skills: /scenecraft-v1, /castkit-v1\nmake a rooftop plate')

    // Unpicking rewrites the same line; Clear takes it out.
    await ui.press({ key: 'pick-scenecraft-v1' })
    expect(box.text).toBe('Use these skills: /castkit-v1\nmake a rooftop plate')
    await ui.press({ key: 'clear' })
    expect(box.text).toBe('make a rooftop plate')
    expect(await ui.find({ key: 'pick-castkit-v1' })).toBeUndefined()
    await ui.unmount()
  })
}

test('picks are kept per project and fill a new conversation', async ($, on) => {
  const { box, clock } = world(on, { projects: { 'g:/work/film': ['castkit-v1', 'shotcaller-v1'] } })
  await $.session.start({ cwd: 'G:\\Work\\Film\\', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  expect(await ui.find({ key: 'pick-castkit-v1' })).toBeDefined()
  expect(await ui.find({ key: 'pick-shotcaller-v1' })).toBeDefined()
  await clock.advance(1500)
  expect(box.text).toBe('Use these skills: /castkit-v1, /shotcaller-v1\n')

  // Another project starts with nothing picked.
  await ui.unmount()
  await $.session.start({ cwd: 'G:\\Other', surface: 'desktop', isInteractive: true })
  const other = await $.ui.mount({ ...PANE, surface: 'desktop' })
  expect(await other.find({ key: 'pick-castkit-v1' })).toBeUndefined()
  await other.unmount()
})

test('with auto-insert off, picks wait for the Insert button', async ($, on) => {
  const { box } = world(on, { prefs: { autoInsert: false } })
  await $.session.start({ cwd: 'G:\\Work\\Film', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'all-castkit-v1' })
  expect(box.text).toBe('')
  await ui.press({ key: 'insert' })
  expect(box.text).toBe('Use these skills: /castkit-v1\n')
  await ui.unmount()
})

test('a box that refuses the line hands it to the next message', async ($, on) => {
  const { submitted } = world(on, {}, false)
  await $.session.start({ cwd: 'G:\\Work\\Film', surface: 'desktop', isInteractive: true })
  const ui = await $.ui.mount({ ...PANE, surface: 'desktop' })

  await ui.press({ key: 'all-castkit-v1' })
  expect(await ui.find({ type: 'Text', text: /next message/ })).toBeDefined()
  await $.prompt.submit({ text: 'design the hero' } as never)
  expect(submitted.at(-1)).toBe('Use these skills: /castkit-v1\ndesign the hero')
  await ui.unmount()
})
