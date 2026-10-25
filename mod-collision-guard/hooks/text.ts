// mod-collision-guard / hooks/text.ts, by v-amorim
// Every string this mod shows. Edit the values to reword or translate; keep the keys and the {slots}.
export default {
  "paneTitle": "Collision guard",
  "notifyTitle": "Collision guard",
  "notifyPaused": "Edit paused: another session edited {file}",
  "paneTitleSettings": "Settings",
  "paneName": "Collision Guard",
  "settingsWaiting": "Settings panel waiting: {reason}",
  "commandDescription": "Collision Guard status; `settings` opens its panel, `clear` forgets this session's recorded edits",
  "cleared": "Recorded edits of this session forgotten",
  "statusOn": "On",
  "statusOff": "Off",
  "statusLine": "{state}, {minutes} min window. /mod-collision-guard settings opens the panel",
  "statusWatching": "Watching for edits from other sessions. {line}",
  "askHeader": "Collision",
  "choiceProceed": "Proceed",
  "choiceWorktree": "Move to a worktree",
  "choiceCancel": "Cancel",
  "question": "Another open session edited {path} {ago} ({clock}). Edit it anyway?",
  "questionUnchecked": "Collision guard could not check {path} for edits from other sessions. Edit it anyway?",
  "card": {
    "title": "Paused",
    "titleHint": "collision guard",
    "head": "Another open session edited this file:",
    "headUnchecked": "Could not check other sessions, so this edit waits for you.",
    "prompt": "#{n}",
    "moreOne": "+1 more session",
    "moreMany": "+{n} more sessions",
    "when": "{ago} · {clock}"
  },
  "tips": {
    "cancel": "stops this edit and lets you say why",
    "worktree": "refuses this edit and has Claude redo it in a worktree",
    "proceed": "lets this edit run; this file stays quiet until the other session edits it again",
    "proceedUnchecked": "lets this edit run without the check",
    "reasonSend": "sends your reason to Claude and cancels the edit",
    "reasonSkip": "cancels the edit without a reason",
    "reasonBack": "goes back to the choices, nothing is decided"
  },
  "reason": {
    "placeholder": "Why? Enter sends, Enter alone skips",
    "enter": "Enter",
    "esc": "Esc",
    "send": "send",
    "skip": "skip",
    "back": "back to the choices"
  },
  "settingSaved": "{label} saved",
  "defaultNote": "Click a setting to change it",
  "defaultNoteTail": "The mod reloads",
  "agoLessThanMinute": "less than a minute ago",
  "agoMinutes": "{minutes} min ago",
  "agoHoursMinutes": "{hours} h {minutes} min ago",
  "tipTabSettings": "shows this mod's settings",
  "tipToast": {"label":"Dismiss","text":"hides this message"}
}
