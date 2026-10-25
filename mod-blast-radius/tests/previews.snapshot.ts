import type { Snapshot } from './previews-kit'

export const snapshot: Snapshot = {
  "enabled": {
    "true": {
      "frame": {
        "border": "#4b2935",
        "bg": "#1f1b2b"
      },
      "nerd": [
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "\uea6c Delete cache.db",
              "color": "alert",
              "bold": true
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "Removes the file. No undo.",
              "color": "onSurface"
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "~/app/build/cache.db",
              "color": "alert"
            },
            {
              "text": "   ",
              "color": "onSurface"
            },
            {
              "text": "3.1 MB",
              "color": "warn"
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "\ue0b6",
              "color": "surface3",
              "bg": "#1f1b2b"
            },
            {
              "text": "\ue0b6",
              "color": "#3b446a",
              "bg": "surface3"
            },
            {
              "text": "1",
              "color": "accent",
              "bg": "#3b446a",
              "bold": true
            },
            {
              "text": "\ue0b4",
              "color": "#3b446a",
              "bg": "surface3"
            },
            {
              "text": " Cancel ",
              "color": "onSurface",
              "bg": "surface3"
            },
            {
              "text": "\ue0b4",
              "color": "surface3",
              "bg": "#1f1b2b"
            },
            {
              "text": "  "
            },
            {
              "text": "\ue0b6",
              "color": "surface3",
              "bg": "#1f1b2b"
            },
            {
              "text": "\ue0b6",
              "color": "#3b446a",
              "bg": "surface3"
            },
            {
              "text": "2",
              "color": "accent",
              "bg": "#3b446a",
              "bold": true
            },
            {
              "text": "\ue0b4",
              "color": "#3b446a",
              "bg": "surface3"
            },
            {
              "text": " Details ",
              "color": "onSurface",
              "bg": "surface3"
            },
            {
              "text": "\ue0b4",
              "color": "surface3",
              "bg": "#1f1b2b"
            },
            {
              "text": "  "
            },
            {
              "text": "\ue0b6",
              "color": "surface3",
              "bg": "#1f1b2b"
            },
            {
              "text": "\ue0b6",
              "color": "#3b446a",
              "bg": "surface3"
            },
            {
              "text": "3",
              "color": "accent",
              "bg": "#3b446a",
              "bold": true
            },
            {
              "text": "\ue0b4",
              "color": "#3b446a",
              "bg": "surface3"
            },
            {
              "text": " Delete cache.db ",
              "color": "alert",
              "bg": "surface3"
            },
            {
              "text": "\ue0b4",
              "color": "surface3",
              "bg": "#1f1b2b"
            }
          ]
        }
      ],
      "safe": [
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "! Delete cache.db",
              "color": "alert",
              "bold": true
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "Removes the file. No undo.",
              "color": "onSurface"
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "~/app/build/cache.db",
              "color": "alert"
            },
            {
              "text": "   ",
              "color": "onSurface"
            },
            {
              "text": "3.1 MB",
              "color": "warn"
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": " 1 ",
              "color": "accent",
              "bg": "#3b446a",
              "bold": true
            },
            {
              "text": " Cancel ",
              "color": "onSurface",
              "bg": "surface3"
            },
            {
              "text": "  "
            },
            {
              "text": " 2 ",
              "color": "accent",
              "bg": "#3b446a",
              "bold": true
            },
            {
              "text": " Details ",
              "color": "onSurface",
              "bg": "surface3"
            },
            {
              "text": "  "
            },
            {
              "text": " 3 ",
              "color": "accent",
              "bg": "#3b446a",
              "bold": true
            },
            {
              "text": " Delete cache.db ",
              "color": "alert",
              "bg": "surface3"
            }
          ]
        }
      ]
    },
    "false": {
      "nerd": [
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "rm build/cache.db"
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "runs at once, nothing is held",
              "color": "muted"
            }
          ]
        }
      ],
      "safe": [
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "rm build/cache.db"
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "runs at once, nothing is held",
              "color": "muted"
            }
          ]
        }
      ]
    }
  }
}
