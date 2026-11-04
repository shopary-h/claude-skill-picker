# Skill Picker

A Claude Code mod that keeps a **Skills** pane beside every conversation. Search the skills you have installed, pick the ones a project needs, and they are written into the prompt box for you.

- **Search** by a skill's name or by what it does; the list narrows as you type.
- **Pick** a skill by clicking its name. Picks are remembered per project folder.
- **Written for you**: picking puts one line at the top of the prompt box, `Use these skills: /one, /two`, and keeps whatever you typed under it. Unpicking rewrites the same line. A new conversation in the same project starts with the line already there.
- **Suggest for project** asks a small model which of your skills fit the folder, from its name, its top-level files and the start of its `CLAUDE.md` and `README.md`. **Add all** takes the suggestions.
- **Auto-insert** can be turned off; then **Insert into prompt** writes the line when you want it.
- If the prompt box cannot take the line at that moment, it is added to the top of your next message instead.

`/skill-picker` opens the pane again if you close it.

## Install

At the prompt of a terminal session:

```
/plugin install skill-picker --marketplace shopary-h/claude-skill-picker
```

Answer `y` to add the marketplace, then pick a scope (the user scope loads it in every session).

From a shell:

```
claude plugin install skill-picker --marketplace shopary-h/claude-skill-picker
```

In the desktop app, where `/plugin` does not run: click + next to the prompt box, then Plugins, Add marketplace with `shopary-h/claude-skill-picker`, then Add plugin.

## Checks

```
claude plugin validate .
claude plugin test .
```
