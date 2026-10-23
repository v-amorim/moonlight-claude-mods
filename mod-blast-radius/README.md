<!-- mod-blast-radius / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
# mod-blast-radius

Part of [moonlight-claude-mods][doc-root].

Holds a risky shell command until you choose Cancel or Run.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-blast-radius@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

Automatic.

## See it

| The hold card | The Details pane |
| --- | --- |
| ![][img-blast-radius-card] | ![][img-blast-radius-details] |

| A risky command held |
| --- |
| https://github.com/user-attachments/assets/511d4e1b-98f7-4d31-a3bf-a88f821dcc52 |

## Features

- **Hold:** A risky Bash command waits before it runs, with no timeout: rm, git reset --hard, force push, SQL DROP, production deploys, gcloud, az, databricks, chmod 777, curl into a shell, credential reads, mv over a file, > over a file and Windows deletes.
- **Your rules:** ~/.claude/mods-data/mod-blast-radius/rules.json, an array of { "pattern": "regex", "reason": "text", "flags": "i" }. Read again when the file changes. A bad entry is skipped with a note in the settings pane; the built-in checks never depend on it.
- **Pass rules:** An entry with "action": "pass" lets a matching step through without a hold, so your other hooks and permissions decide it. Each step of a command is matched on its own, so `rm a.txt && rm -rf ~` passes the first step and still holds the second. Example: { "pattern": "^\\s*rm(?!.*\\s(-[a-zA-Z]*[rR][a-zA-Z]*|--recursive)(\\s|$))\\s", "reason": "Plain rm is decided elsewhere", "action": "pass" } lets rm without -r through. Without "action", or with "hold", an entry adds a hold as before. A pass never lets these through, whatever the pattern: a target at the root, at home (~ or $HOME), in a parent folder (..) or on a whole drive; a recursive delete of a critical folder (.git, .github, .claude, .vscode, src, helpers, resources, tests, scripts, fixtures); a step that hands text to a shell (bash -c, eval, powershell -Command); and a step with a command substitution ($(...) or backticks).
- **No drawing surface:** Where nothing can show the hold (a VS Code chat panel, claude -p, an SDK session), the call is not held. The permission system asks instead, with the reason.
- **Preview:** Paths with counts and size, git status and dry runs, the commits a force push would drop. Read-only: the command itself never runs.
- **Run or Cancel:** Cancel refuses the call with a reason Claude reads. A narrow terminal draws the same report above the prompt.
- **Show all:** The card shows two rows of its sentence. Show all on the card opens the whole sentence, and Show less folds it back.
- **This session's permission checks:** The card counts the session's permission checks and how many were denied. Details ends with one cell per check (allowed, asked, denied, waiting, or made by a subagent) and the counts by file, shell and other tools. Secrets in a command are masked before anything is kept, and /clear starts the list again. The mod only watches these checks; it never changes their answer.

## Costs

By default this mod makes no model call: the held dialog shows only the rule's reason and the preview.

Turn on Explain with Haiku (`/mod-blast-radius settings`) and each held command is sent to Haiku for a plain-language explanation, so the command text leaves your machine like any prompt. That spends tokens and counts against your plan quota. It is off by default.

## Settings

Change them with `/mod-blast-radius settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Hold risky commands | on | Risky Bash waits for your choice. You pick Run or Cancel. Off, every command runs as usual |
| Explain with Haiku | off | Each held command is sent to Haiku for a plain-language explanation on the card. It spends tokens. Off (the default), no model is called and the card shows the rule's reason and the preview |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font (read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole) and safe Unicode glyphs elsewhere. nerd and safe force one |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-blast-radius-card]: https://github.com/user-attachments/assets/e127ef7b-9fdf-4213-a0ee-b2435b1aeabf
[img-blast-radius-details]: https://github.com/user-attachments/assets/f6719fe9-322e-412f-9cb0-f70e50bafa76
