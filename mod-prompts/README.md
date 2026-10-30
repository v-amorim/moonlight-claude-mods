<!-- mod-prompts / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
# mod-prompts

Part of [moonlight-claude-mods][doc-root].

Every prompt of the session; jump back to any of them.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-prompts@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

Prompts pill.

## See it

| Pick a prompt to read it |
| --- |
| https://github.com/user-attachments/assets/0cf0064f-0498-4f0a-85cc-18e5256cfcd3 |

## Features

- **Every prompt of the session:** A sidebar lists each prompt you sent, with the full text in a card. A button jumps the transcript back to it. A long prompt is cut short, and Show less cuts it back after Show all.
- **Chain tab:** When [mod-wrap-up](../mod-wrap-up) handed this work off across sessions, a Chain tab lists them by their /resume names, oldest first, so this session is last. Open resumes an earlier one in a new Windows Terminal window. On other systems the tab shows the `claude --resume` command to run instead. Off a chain, the tab shows this session's name and three names Haiku proposes from its prompts, as `topic #1: work`. A click renames the session, and a later wrap-up handoff continues the name as #2.
- **Command hooks:** On SessionStart, a small shell hook appends the event's JSON as one line to `~/.claude/mods-data/mod-prompts/bridge/<session id>.jsonl` (under `$CLAUDE_CONFIG_DIR` when that is set), and the mod reads the file every 250 ms. A record can hold the session id, the working folder and the transcript path. SessionEnd deletes the session's file, and SessionStart deletes files older than 7 days. The hooks need a POSIX shell (Git Bash on Windows). Without one they write nothing, and the mod falls back to what it can find on its own. Some plans block plugin hooks on these events; the mod then falls back the same way.

## Settings

Change them with `/mod-prompts settings` or the gear pill.

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
