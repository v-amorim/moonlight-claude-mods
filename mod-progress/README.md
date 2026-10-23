<!-- mod-progress / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
# mod-progress

Part of [moonlight-claude-mods][doc-root].

The main session, every subagent and every agent of a workflow run: model, effort, context fill, tokens, time and gate progress, plus the background shells and monitors each one started, with their live output.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-progress@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

Progress pill.

## See it

| The pill | The panel | A shell's command and output |
| --- | --- | --- |
| ![][img-progress-pill] | ![][img-progress-panel] | ![][img-progress-shell] |

| An agent's transcript |
| --- |
| ![][img-progress-transcript] |

| Two agents running, opened from the pill |
| --- |
| https://github.com/user-attachments/assets/248259f2-7cc2-4b5c-b237-a68fc09490c4 |

## Features

- **Shell output:** A background shell shows its command and live output. A cut line wraps in full, so nothing is lost at the edge. Show all opens the whole output, and Show less folds it back.
- **Timeline:** Switch the pane from Cards to Timeline to see every agent as a lane on one clock: when it started, how long it ran and whether it is still running. A click on a lane opens it like a click on its card.
- **The gates view:** A card per loop with one cell per gate: met, waiting on evidence (checked, but its evidence still reads pending), open or dropped. A click on the card groups its gates by state, with how long each open or waiting gate has been so. The band tip counts every gate in the session and the ones waiting. Gates come from `GATES.md` files written by your own script or tool, not from the model. The rest of the mod works without them.
- **GATES.md format:** This is the mod's own plan format; nothing else has to produce it. The ledger is `GATES.md` plus every `gates/<name>.md` in `~/.claude/gates/<repo>/<session id>/`, where `<repo>` is the folder name of the session's repo (or of its working folder). Set `GATES_HOME` to read `<GATES_HOME>/<repo>/<session id>/` instead. A gate is a line `- [ ] G1: what must hold`, with an indented `EVIDENCE:` line under it. It counts as met only when its box is `[x]` and its evidence is not `pending`. A line starting `ABANDON: G1 reason` gives that gate up. A `gates/<name>.md` file also belongs to the agent of that name.
- **Command hooks:** On SessionStart, Stop, SubagentStop and StopFailure, a small shell hook appends the event's JSON as one line to `~/.claude/mods-data/mod-progress/bridge/<session id>.jsonl` (under `$CLAUDE_CONFIG_DIR` when that is set), and the mod reads the file every 250 ms. A record can hold the session id, the working folder and the transcript path, and for Stop-type events the last assistant message. SessionEnd deletes the session's file, and SessionStart deletes files older than 7 days. The hooks need a POSIX shell (Git Bash on Windows). Without one they write nothing, and the mod falls back to what it can find on its own. Some plans block plugin hooks on these events; the mod then falls back the same way.

## Settings

Change them with `/mod-progress settings` or the gear pill.

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

[img-progress-panel]: https://github.com/user-attachments/assets/cd40f976-d96c-4b20-ac20-d2403bd1d822
[img-progress-pill]: https://github.com/user-attachments/assets/3b89b0e0-f4ee-4203-965b-4c467bd466b1
[img-progress-shell]: https://github.com/user-attachments/assets/c749c7e6-db29-4000-a403-2e59d3d1db5b
[img-progress-transcript]: https://github.com/user-attachments/assets/9ed57916-9da3-4fbb-accc-08e86335ae47
