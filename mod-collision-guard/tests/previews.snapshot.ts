import type { Snapshot } from './previews-kit'

export const snapshot: Snapshot = {
  "enabled": {
    "true": {
      "nerd": [
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "Another open session edited this file: ",
              "color": "muted"
            },
            {
              "text": "hook-guard",
              "color": "onSurface",
              "bold": true
            },
            {
              "text": " #12",
              "color": "accent"
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "hooks/a.ts",
              "color": "secondary"
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "1 Cancel   2 Move to a worktree   3 Proceed",
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
              "text": "Another open session edited this file: ",
              "color": "muted"
            },
            {
              "text": "hook-guard",
              "color": "onSurface",
              "bold": true
            },
            {
              "text": " #12",
              "color": "accent"
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "hooks/a.ts",
              "color": "secondary"
            }
          ]
        },
        {
          "spans": [
            {
              "text": " "
            },
            {
              "text": "1 Cancel   2 Move to a worktree   3 Proceed",
              "color": "muted"
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
              "text": "Edits run without a question; they are still recorded.",
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
              "text": "Edits run without a question; they are still recorded.",
              "color": "muted"
            }
          ]
        }
      ]
    }
  }
}
