// mod-wrap-up / hooks/text.ts, by v-amorim
// Every string this mod shows. Edit the values to reword or translate; keep the keys and the {slots}.
export default {
  "label": "Wrap up",
  "paneName": "mod-wrap-up",
  "paneSettings": "Settings",
  "commandDescription": "Pick what carries over, then hand off to a fresh session; `compact` fills a /compact instead, `settings` opens its settings panel",
  "settingsWaiting": "Wrap up settings waiting: {reason}",
  "statusHint": "Click a setting to change it",
  "statusHintSaved": "The mod reloads",
  "settingSaved": "{label} saved",
  "tips": {
    "head": "offers to hand off to a fresh session, or compact this one",
    "handoff": "opens the pick card to write a handoff",
    "compact": "opens the pick card to fill a /compact",
    "autoOn": "on, counts down 5 s then clears with the handoff at {marks}, click to turn off",
    "autoOff": "off, click to hand off between turns at {marks}",
    "autoMarks": "{tokens} tokens or {percent}%",
    "autoNeedsHandoff": "off, needs Automatic handoff on in the settings",
    "thread": "keeps or drops this thread",
    "also": "keeps or drops this item",
    "name": {
      "this": "renames this session before the clear, click to skip",
      "next": "renames the fresh session after the clear, click to skip"
    },
    "go": {
      "handoff": "writes the handoff and starts a fresh session",
      "compact": "fills /compact into your prompt"
    },
    "cancel": "closes this card, changes nothing",
    "tab": "shows this mod's settings",
    "toFresh": "the handoff was already sent with your first prompt, so starting fresh only changes what the mod tracks from now on: this session starts its own ledger and the earlier one stays on disk",
    "showAll": "shows the whole goal",
    "showLess": "cuts the goal to one line",
    "toCarry": "brings the earlier work back: this session rejoins its ledger and the next prompt carries its handoff",
    "dismissAuto": "hides this card, keeps the choice"
  },
  "auto": {
    "countdown": "Context at {tokens} ({percent}%), handing off in {seconds} s",
    "updating": "Context at {tokens} ({percent}%), updating the ledger before the handoff",
    "continue": "The context was cleared to make room. Continue the open task from this handoff.",
    "noHandoff": "No handoff written yet, nothing was cleared",
    "clearFailed": "Could not run /clear at the mark, nothing was sent",
    "carried": "Carried over: {goal}",
    "carriedNoGoal": "Carried over the earlier handoff",
    "fresh": "Fresh start",
    "toFresh": "Start fresh",
    "toCarry": "Carry in",
    "showAll": "Show all",
    "showLess": "Show less"
  },
  "link": "<-",
  "writingStage": "Writing handoff",
  "choice": {
    "handoff": "Handoff",
    "compact": "Compact",
    "auto": "Auto",
    "autoCompact": "Auto handoff"
  },
  "menu": {
    "hint": "pick one, or {close} to close",
    "close": "Close",
    "tipClose": "closes this menu, changes nothing"
  },
  "card": {
    "title": "pick what stays",
    "hint": "click a line to keep or drop it",
    "threads": "Threads",
    "also": "Also keep",
    "reading": "Reading the session",
    "noThreads": "No threads found, the whole session counts",
    "names": "Rename",
    "name": {
      "this": "this session",
      "next": "next session"
    },
    "noNames": "No names proposed, nothing is renamed",
    "handoffFoot": "Writes a handoff of what stays, clears the chat and fills it into the prompt",
    "go": {
      "handoff": "Hand off",
      "compact": "Fill prompt"
    },
    "cancel": "Cancel"
  },
  "alsoKeep": {
    "files": "Files in play",
    "decisions": "Decisions",
    "tasks": "Open tasks",
    "errors": "Errors seen"
  },
  "cardOpened": "Pick what carries over above the prompt",
  "filledIn": "Handoff filled in, review it and press Enter",
  "compactFilled": "/compact filled in, review it and press Enter",
  "compactNotFilled": "Could not fill the prompt with /compact",
  "claudeWorking": "Claude is working, try again once it is idle",
  "claudeWorkingPill": "Claude is working, Wrap up is available once it is idle",
  "writing": "Writing the handoff",
  "startedWorking": "Claude started working, nothing was cleared",
  "clearFailed": "Could not run /clear, press Enter to clear and the handoff fills in after",
  "clearedNotFilled": "Cleared, but the handoff could not be filled in",
  "renameFailed": "Could not rename the session, type /rename {name}",
  "renameOldFailed": "Could not rename the earlier session to {name}",
  "forkFailures": {
    "nothingToFork": "Nothing to hand off yet, send a message first",
    "apiError": "The summary request failed",
    "emptyReply": "The model returned no handoff",
    "aborted": "The summary was interrupted"
  },
  "tipToast": {"label":"Dismiss","text":"hides this message"}
}
