<!-- mod-transcript / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
# mod-transcript

Part of [moonlight-claude-mods][doc-root].

Chat bubbles for you and Claude, each finished turn folded to one line you can open, Bash commands in shell colors.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-transcript@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

Automatic.

## See it

| Folded | Open | Copy a reply |
| --- | --- | --- |
| ![][img-transcript-folded] | ![][img-transcript-open] | ![][img-transcript-copy] |

| The colors a reply names |
| --- |
| ![][img-transcript-colors] |

| Unfolding a turn |
| --- |
| https://github.com/user-attachments/assets/187f612b-2783-4df1-8b77-57d38846460d |

## Features

- **Turn line:** Under each prompt, a line names what the turn did: tool count, file changes with lines added and removed, skills, agents and time.
- **Tool lines:** Inside an open turn, each finished tool call is one line; a click shows its full row and diff.
- **Call previews:** A tool call's preview shows its first lines. Show all opens the rest, and a line that was cut wraps in full. Show less folds it back.
- **Code colors:** Code fences in replies and the lines of a Read, Write or Edit preview are colored from your VS Code color theme: the one VS Code is set to, or the one the Code theme setting names. Without a match, the mod's own colors draw.
- **Replies:** Claude's replies draw in the mod's style: tables with header and row lines, inline code and hex colors as pills, code blocks as cards with line numbers, headings, callouts, task boxes and status tags. A code block past 12 lines shows its last 12 behind a fold. A table too wide for the window draws as Claude Code draws it.
- **Links:** A file path that exists becomes a pill that opens the file in VS Code at its line. A web link becomes a pill with a globe that opens in the browser.
- **File results:** An Edit, Write or Read result draws as a card: the file as a link pill and a copy pill on its top edge, then numbered lines with + and − marks on green and red. Past 12 lines it shows the first 12 and folds the rest behind N more lines. A result that failed, or has no diff to read, draws as Claude Code draws it.
- **Card:** An open turn draws as one tinted card with a bar down its left edge; the final reply stays outside it.
- **Copy button:** A button under each finished reply copies it as markdown, its code, plain text, its tables rebuilt as clean markdown, or its links. Pointing at a choice marks the characters it takes.
- **Command hooks:** On SessionStart, PermissionDenied and StopFailure, a small shell hook appends the event's JSON as one line to `~/.claude/mods-data/mod-transcript/bridge/<session id>.jsonl` (under `$CLAUDE_CONFIG_DIR` when that is set), and the mod reads the file every 250 ms. A record can hold the session id, the working folder and the transcript path, and for Stop-type events the last assistant message. SessionEnd deletes the session's file, and SessionStart deletes files older than 7 days. The hooks need a POSIX shell (Git Bash on Windows). Without one they write nothing, and the mod falls back to what it can find on its own. Some plans block plugin hooks on these events; the mod then falls back the same way.

## Settings

Change them with `/mod-transcript settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Fold finished turns | on | Turns start folded to one line. The line sits under its prompt. Off, they start open and the line folds them |
| Fold tool rows | on | Each tool row folds to one line. Finished rows have their own toggle. Off, tool rows draw as Claude Code draws them |
| Show times | on | Prompt send time, tool duration. Each prompt shows when you sent it, each tool line when it started and how long it took. Off, rows show no times |
| Show the latest turn in full | on | Stays open until your next prompt, with every tool row and result as Claude Code draws them. Off, finished tool calls fold right away |
| Copy button | on | On each finished reply's edge. Point at the copy button to pick reply, code, text, table or links, then click. The reply marks what the choice under the pointer copies. Off, the edge stays plain |
| Prompt numbers | on | #N before each of your prompts. It matches the number the Prompts and Heads up panels show |
| Animations | on | Fold and kind chips fade when the pointer leaves, a running command's dot blinks, and the tabs and settings fade. Off, they switch at once and the dot stays lit |
| Code theme | empty | The VS Code color theme that colors code in replies and in Read, Write and Edit previews. Empty follows the theme VS Code is set to. Otherwise type a theme's label exactly, such as Moonlight. It looks in the .vscode, .vscode-insiders and .cursor extension folders. Without a match, the mod's own colors draw |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font (read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole) and safe Unicode glyphs elsewhere. nerd and safe force one |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-transcript-colors]: https://github.com/user-attachments/assets/81943904-ff5e-4c37-9916-276958925cf1
[img-transcript-copy]: https://github.com/user-attachments/assets/d288094d-2af1-4da7-8ae8-38f140028871
[img-transcript-folded]: https://github.com/user-attachments/assets/8f89e862-2566-4bd3-ad95-57959014e88b
[img-transcript-open]: https://github.com/user-attachments/assets/7cad8bc5-02a1-4f36-8db7-4b5ad8f6ec97
