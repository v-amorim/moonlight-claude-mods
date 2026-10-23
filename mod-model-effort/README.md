<!-- mod-model-effort / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
# mod-model-effort

Part of [moonlight-claude-mods][doc-root].

Shows the model and effort level; a click changes either.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-model-effort@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

The model pill.

## See it

| The model panel |
| --- |
| ![][img-model-effort-panel] |

| Effort on hover, models on click |
| --- |
| https://github.com/user-attachments/assets/bc90d5e3-6bf5-4981-8bdd-410abb7465c8 |

## Features

- **Model and effort:** A pill shows the model and the effort level of the session. A click changes either one.
- **Reply speed:** Hover the pill to see the last reply's speed: how long the first token took and the tokens per second after it. Only the main session's replies count.
- **Command hooks:** On SessionStart, PostModelSwitch and ConfigChange, a small shell hook appends the event's JSON as one line to `~/.claude/mods-data/mod-model-effort/bridge/<session id>.jsonl` (under `$CLAUDE_CONFIG_DIR` when that is set), and the mod reads the file every 250 ms. A record can hold the session id, the working folder and the transcript path. SessionEnd deletes the session's file, and SessionStart deletes files older than 7 days. The hooks need a POSIX shell (Git Bash on Windows). Without one they write nothing, and the mod falls back to what it can find on its own. Some plans block plugin hooks on these events; the mod then falls back the same way.

## Settings

Change them with `/mod-model-effort settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font (read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole) and safe Unicode glyphs elsewhere. nerd and safe force one |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-model-effort-panel]: https://github.com/user-attachments/assets/296723ee-5481-4212-a954-c81aa20f1d05
