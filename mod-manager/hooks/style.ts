// hooks/style.ts, by v-amorim
// Shared style; every mod carries the same copy. Change values freely, keep the keys. {U+XXXX} is a Nerd Font code point.
export default {
  "colors": {
    "theme": {
      "bg": "#0D0E17",
      "surface1": "#141726",
      "surface2": "#1C2033",
      "surface3": "#252A42",
      "lifted": "#2F3654",
      "trackOff": "#4B5270",
      "border": "#242839",
      "onSurface": "#EEEEFA",
      "muted": "#9BA3C4",
      "accent": "#7386D0",
      "secondary": "#B9C6F5",
      "good": "#49EF95",
      "ok": "#A2B0EA",
      "alert": "#CA5F71",
      "warn": "#FFCB6B",
      "folder": "#86E1FC",
      "pill": "#B9C6F5",
      "addBg": "#1D3B38",
      "delBg": "#3D2737"
    },
    "syntax": {
      "command": "#7386D0",
      "option": "#FFAFAF",
      "text": "#A5CFFF",
      "variable": "#79C0FF",
      "number": "#B0C8FF",
      "operator": "#CDCFE7"
    },
    "pills": {
      "primary": "#252A42",
      "secondary": "#1C2033",
      "separator": "#3B446A",
      "readout": "#7E86A4"
    },
    "shimmer": [
      "#A2B0EA",
      "#949FCE",
      "#8993B9"
    ],
    "usage": [
      "#CED9FF",
      "#ACB9E6",
      "#CDBBE5",
      "#EA98EE",
      "#F883C9",
      "#FF6F7A"
    ],
    "statusline": {
      "pillBorder": "#3A3D4A",
      "menuBackground": "#1C1D24",
      "divergence": "#B86CB3",
      "behind": "#8A9BE0"
    },
    "models": {
      "opus": "#C3A6FF",
      "sonnet": "#79C0FF",
      "haiku": "#7CD591",
      "inherit": "#9BA3C4"
    },
    "kinds": {
      "thinking": { "hue": "#C3A6FF", "wash": "#494267" },
      "read": { "hue": "#B9C6F5", "wash": "#464C64" },
      "search": { "hue": "#A5CFFF", "wash": "#404E67" },
      "edit": { "hue": "#CED9FF", "wash": "#4C5167" },
      "shell": { "hue": "#FFCB6B", "wash": "#5B4D3B" },
      "web": { "hue": "#79C0FF", "wash": "#324A67" },
      "agent": { "hue": "#F99BD1", "wash": "#593F59" },
      "tool": { "hue": "#9BA3C4", "wash": "#3D4155" }
    }
  },
  "tags": {
    "router": {
      "color": "#F99BD1",
      "icon": "◆"
    },
    "debug": {
      "color": "#FF9C8B",
      "icon": "‼"
    },
    "interface": {
      "color": "#EEB154",
      "icon": "▪"
    },
    "writing": {
      "color": "#C3C55A",
      "icon": "≡"
    },
    "utility": {
      "color": "#7CD591",
      "icon": "☼"
    },
    "start": {
      "color": "#2AD7D7",
      "icon": "»"
    },
    "mods": {
      "color": "#5DCBFF",
      "icon": "+"
    },
    "review": {
      "color": "#D1A8FF",
      "icon": "∴"
    },
    "personal": {
      "color": "#9BA3C4",
      "icon": "●"
    }
  },
  "levels": {
    "low": { "glyph": "○", "color": "#ACB9E6" },
    "medium": { "glyph": "◐", "color": "#CDBBE5" },
    "high": { "glyph": "●", "color": "#EA98EE" },
    "xhigh": { "glyph": "◉", "color": "#F883C9" },
    "max": { "glyph": "◈", "color": "#FF6F7A" }
  },
  "statuslineMarks": {
    "branch": "⑂",
    "dirty": "●",
    "diverged": "⇅",
    "ahead": "↑",
    "behind": "↓",
    "pathSep": "›",
    "menu": "⋯",
    "close": "×"
  },
  "text": {
    "settings": "Settings",
    "actions": "Actions",
    "noSettings": "No settings.",
    "on": "On",
    "off": "Off",
    "locked": "locked",
    "editInConfig": "edit it in /config",
    "idleOnly": "available once Claude is idle",
    "runsCommand": "runs /{command}"
  },
  "marks": {
    "stage": "▸",
    "cursor": "❯",
    "bullet": "•",
    "ok": "✓",
    "warn": "!",
    "sep": "·",
    "stop": "○",
    "stopOpen": "●",
    "rail": "│",
    "rule": "─",
    "track": "━━",
    "knob": "●",
    "spinner": "⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏",
    "open": "↗",
    "strip": "▎"
  },
  "caps": {
    "left": "{U+E0B6}",
    "right": "{U+E0B4}"
  },
  "glyphs": {
    "safe": {
      "on": "[◉]",
      "off": "[○]",
      "go": "[↵]",
      "reveal": "⊞",
      "cycle": "[↻]",
      "down": "[−]",
      "up": "[+]",
      "locked": "[■]",
      "close": "[×]",
      "warn": "!",
      "ok": "✓",
      "expanded": "▾",
      "collapsed": "▸",
      "more": "▾",
      "less": "▴",
      "back": "<",
      "title": "▸",
      "gear": "⊛",
      "copy": "⧉",
      "icon": { "cost": "$", "arrow": "→" },
      "mark": {
        "thinking": "∴",
        "read": "≡",
        "search": "?",
        "edit": "±",
        "shell": "$",
        "web": "@",
        "agent": "◆",
        "tool": "•"
      }
    },
    "nerd": {
      "on": " {U+F205} ",
      "off": " {U+F204} ",
      "go": " {U+F054} ",
      "reveal": "{U+EAF7}",
      "cycle": " {U+F021} ",
      "down": " {U+F068} ",
      "up": " {U+F067} ",
      "locked": " {U+F023} ",
      "close": " {U+F00D} ",
      "warn": "{U+EA6C}",
      "ok": "{U+EAB2}",
      "expanded": "{U+EAB4}",
      "collapsed": "{U+EAB6}",
      "more": "{U+F0D7}",
      "less": "{U+F0D8}",
      "back": "{U+F053}",
      "title": "{U+F054}",
      "gear": "{U+F0493}",
      "copy": "{U+F018F}",
      "icon": {
        "settings": "{U+F1DE}",
        "actions": "{U+F0E7}",
        "wrapup": "{U+F187}",
        "features": "{U+F005}",
        "mod": "{U+F12E}",
        "installed": "{U+F487}",
        "arrow": "{U+F061}",
        "not-installed": "{U+F019}",
        "icons": "{U+F031}",
        "updates": "{U+F0AA}",
        "welcome": "{U+F135}",
        "apply": "{U+F00C}",
        "cost": "{U+F155}",
        "skill": "{U+F0D0}",
        "prompt": "{U+F075}",
        "fold": "{U+F066}",
        "files": "{U+EB86}",
        "replay": "{U+EA82}",
        "folder": "{U+EA83}",
        "folder-open": "{U+EAF7}",
        "file": "{U+EA7B}",
        "ext-ts": "{U+E628}",
        "ext-react": "{U+E625}",
        "ext-js": "{U+E781}",
        "ext-json": "{U+E60B}",
        "ext-md": "{U+E609}",
        "ext-py": "{U+E73C}",
        "ext-config": "{U+E615}",
        "ext-sh": "{U+F489}",
        "Edit": "{U+F040}",
        "MultiEdit": "{U+F040}",
        "NotebookEdit": "{U+F040}",
        "Write": "{U+F15B}",
        "Read": "{U+F02D}",
        "Bash": "{U+F120}",
        "Grep": "{U+F002}",
        "Glob": "{U+F002}",
        "Agent": "{U+EBBC}",
        "Task": "{U+EBBC}",
        "Skill": "{U+F0D0}",
        "WebFetch": "{U+F0AC}",
        "WebSearch": "{U+F0AC}",
        "TodoWrite": "{U+F0AE}",
        "tool": "{U+F0AD}",
        "menu-skills": "{U+F0D0}",
        "menu-prompts": "{U+F075}",
        "menu-filetree": "{U+EB86}",
        "menu-progress": "{U+EBBC}",
        "menu-headsup": "{U+EA6C}"
      },
      "mark": {
        "thinking": "{U+F09D1}",
        "read": "{U+F02D}",
        "search": "{U+F002}",
        "edit": "{U+F040}",
        "shell": "{U+F120}",
        "web": "{U+F0AC}",
        "agent": "{U+EBBC}",
        "tool": "{U+F0AD}"
      }
    }
  }
}
