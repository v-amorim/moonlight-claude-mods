<!-- mod-wrap-up / README.md, by v-amorim -->
<!-- Generated from the root README, plugin.json and showcase.json; edit those. -->
# mod-wrap-up

Part of [moonlight-claude-mods][doc-root].

Hands off to a fresh session, or fills `/compact` with what to keep.

## Install

Inside Claude Code:

```text
/plugin marketplace add v-amorim/moonlight-claude-mods
/plugin install mod-wrap-up@claude-mods
/reload-plugins
```

`/plugin install` asks where to install the mod. Keep Install for you (user scope) and press Enter, then press Esc to leave the plugin screen before `/reload-plugins`.

To install every mod at once, see [Install][doc-install]. For sharper icons, see [Icons and Nerd Fonts][doc-icons].

## How to open

Wrap up pill.

## See it

| Pick what stays | The filled /compact | The countdown |
| --- | --- | --- |
| ![][img-wrap-up-card] | ![][img-wrap-up-compact] | ![][img-wrap-up-countdown] |

| Carried over |
| --- |
| ![][img-wrap-up-carried] |

| Compact, start to end |
| --- |
| https://github.com/user-attachments/assets/d0d12e0a-4206-4dd2-a63c-dacc3a7200d2 |

| Auto handoff at the mark: countdown, clear, carry on |
| --- |
| https://github.com/user-attachments/assets/8f6c31b4-03c9-44c4-aebe-19d5b93c5e1e |

## Features

- **Pick what stays:** A click on Wrap up offers Handoff or Compact. Either opens a card with the session's threads, read by Haiku, and fixed items such as files in play and open tasks; a click keeps or drops each line. The Auto switch beside them turns the auto handoff on or off, and its tip says what is set now.
- **Compact:** The card writes the /compact instructions as you click and Fill prompt puts them in the prompt. You review them and press Enter.
- **Handoff:** Summarizes what stays through a hidden fork, runs /clear, and fills the handoff into the fresh prompt.
- **Session names:** The card shows the topic and proposes a /rename for the session you leave and one for the fresh session. A click keeps or skips each. Every session of one piece of work shares a topic, as `topic #hop: own work`, so /resume lists the chain under one name, in order. A name you wrote yourself is kept, never replaced, and a /rename in the `topic: work` form moves the chain to that topic.
- **Carried card:** After a carried /clear a card shows `previous <- current` and the goal that came along. Show all grows a long goal to its full text, and Show less cuts it to one line. Start fresh drops the carried handoff and starts a new ledger; the earlier one stays on disk.
- **Automatic handoff:** After each turn Sonnet keeps a ledger of decisions and tasks, plus a fresh handoff, in the background. /compact is given the handoff and the next prompt carries it. With Auto handoff at the mark on, a card counts down 5 seconds between turns at 400K tokens or 65% of the window, whichever comes first; Cancel, a typed draft or a new turn stops it. At zero the ledger is brought up to date and the chat is cleared. If the ledger has an open task, Claude continues it from the handoff; otherwise the handoff is filled into the prompt and nothing is sent. After /clear, a related first prompt carries it and an unrelated one starts a new ledger; a card offers a switch. Each session keeps its own ledger, so sessions in one folder never mix.
- **Command hooks:** On SessionStart (including the one after a compact), a small shell hook appends the event's JSON as one line to `~/.claude/mods-data/mod-wrap-up/bridge/<session id>.jsonl` (under `$CLAUDE_CONFIG_DIR` when that is set), and the mod reads the file every 250 ms. A record can hold the session id, the working folder and the transcript path. SessionEnd deletes the session's file, and SessionStart deletes files older than 7 days. The hooks need a POSIX shell (Git Bash on Windows). Without one they write nothing, and the mod falls back to what it can find on its own. Some plans block plugin hooks on these events; the mod then falls back the same way.

## Costs

Automatic handoff is off by default. With it off, the mod makes no background model call: nothing runs after a turn or after a /clear. The two calls that remain start only when you open or use the Wrap up card.

Turn Automatic handoff on (`/mod-wrap-up settings`) and the mod calls a model in more places, which spends tokens and counts against your plan quota.

| When | Model | Turn it off |
| --- | --- | --- |
| After each turn (or every few turns, set by Update every (turns)), the automatic handoff updates the ledger and handoff from the turns since the last update, up to 150,000 characters | Sonnet at low effort | Automatic handoff off (the default) |
| The first prompt after a /clear that is not a slash command, a "related?" check against the ledger | Sonnet at low effort, a reply of at most 100 tokens | Automatic handoff off (the default) |
| Opening the Wrap up card splits the session into threads | Haiku | Read the threads off |
| Handoff in the card writes the summary | Your session's model through a fork; Sonnet when there is nothing to fork yet | Does not run unless you click it |

The Sonnet calls are pinned to Sonnet. When Sonnet is blocked or unavailable for you (the call is refused, or answers forbidden or not found), the mod retries once with your session's model, so it spends that model's tokens instead.

With Auto handoff at the mark on, the countdown first runs one more ledger update if turns are waiting. Set Automatic handoff to off and only the Wrap up pill hands off. Change settings with `/mod-wrap-up settings`.

The ledger holds the handoff text. It is one JSON file per session chain, written under `~/.claude/mods-data/mod-wrap-up/chains/`. When `CLAUDE_CONFIG_DIR` is set, the folder is `$CLAUDE_CONFIG_DIR/mods-data/mod-wrap-up/` instead. The mod never prunes these files, so delete old ones by hand.

With Automatic handoff on, the mod also publishes the absolute paths that the chain's open tasks and decisions in force name, as the plugin state `pending` (at most 3000 paths, republished each time the ledger changes and at session start). mod-blast-radius reads it so a file the work still needs never skips its card. Home, folders above it and drive roots are never published. Neither mod needs the other.

## Settings

Change them with `/mod-wrap-up settings` or the gear pill.

| Setting | Default | What it does |
| --- | --- | --- |
| Animations | on | Entries shimmer while they wait. Hover colors also fade. Off, everything draws still |
| Handoff length (words) | `400` | Most words the handoff may use. A hard cap on the message the model writes |
| Read the threads | on | Haiku finds up to four threads. You keep or drop each one when the card opens. Off, the card shows only the fixed items and the whole session counts |
| Automatic handoff | off | Keeps a handoff ready each turn. After a turn, Sonnet updates a ledger of decisions and tasks and a fresh handoff in the background. /compact is given the handoff, and the next prompt after a compaction or a related /clear carries it. Off (the default), the mod makes no background model call and only the Wrap up pill hands off |
| Update every (turns) | `1` | Turns between handoff updates. At least 1 |
| Auto handoff at the mark | off | Clears and hands off at the mark. Once either mark below is reached, a 5 second countdown card appears between turns. Unless you cancel, type a draft or start a turn, the ledger is brought up to date, the chat is cleared and Claude continues the open task from the handoff (with no open task, the handoff is filled into the prompt instead). Meant for sessions with Claude Code's own auto-compact off. Needs Automatic handoff on |
| Hand off at (%) | `65` | Context % that starts the countdown. Guards small windows; the token mark comes first on large ones |
| Hand off at (tokens) | `400000` | Tokens that start the countdown. Whichever mark comes first, tokens or percent, starts it |
| Icons | `auto` | auto picks Nerd Font or safe glyphs. It uses Nerd Font icons when the terminal's font is a Nerd Font (read from Windows Terminal, iTerm2, VS Code, Ghostty, kitty, WezTerm, Alacritty, GNOME Terminal or Konsole) and safe Unicode glyphs elsewhere. nerd and safe force one |

## License

Made by [Vinicius Amorim][doc-author], [MIT license][doc-license].

[doc-author]: https://github.com/v-amorim
[doc-icons]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#icons-and-nerd-fonts
[doc-install]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md#install
[doc-license]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/LICENSE
[doc-root]: https://github.com/v-amorim/moonlight-claude-mods/blob/main/README.md

[img-wrap-up-card]: https://github.com/user-attachments/assets/60f54de5-ff21-49a1-9ac3-a50802ed9a9c
[img-wrap-up-carried]: https://github.com/user-attachments/assets/e764b001-861a-4f2e-ae8a-3e521b8b94b7
[img-wrap-up-compact]: https://github.com/user-attachments/assets/94846065-3657-4f7a-b662-64f91bd70e4a
[img-wrap-up-countdown]: https://github.com/user-attachments/assets/07e15d22-8ba3-4a0c-ad39-e8fc9f919a19
