export type Skill = {
  name: string
  /** The one line the slash-command typeahead shows for it. */
  description: string
  /** Where it comes from: `user`, `project`, `built-in`, or the plugin's name. */
  source: string
}

declare module 'claude-code' {
  interface PluginState {
    'skill-picker': {
      skills: Shaped<Skill[]>
      /** The skills picked for the session's project folder, in pick order. */
      picks: string[]
      /** What the last "Suggest for project" answered. */
      suggested: string[]
      query: string
      autoInsert: boolean
      notice: string
      isLoading: boolean
      isSuggesting: boolean
    }
  }
}
