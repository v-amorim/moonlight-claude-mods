// mod-progress / hooks/marks.ts, by v-amorim
// This mod's glyphs and limits, kept out of the shared style.ts; {U+XXXX} is a Nerd code point, one cell like every glyph.
export default {
  "glyphs": {
    "safe": {
      "gaugeIcon": "▦",
      "gaugeFull": "■",
      "gaugeEmpty": "■",
      "gateMet": "■",
      "gateOpen": "■",
      "gateDropped": "×",
      "agentDot": "●",
      "laneSpan": "━",
      "laneIdle": "·"
    },
    "nerd": {
      "gaugeIcon": "{U+F035B}",
      "gaugeFull": "{U+F0C8}",
      "gaugeEmpty": "{U+F0C8}",
      "gateMet": "{U+F0C8}",
      "gateOpen": "{U+F0C8}",
      "gateDropped": "{U+F00D}",
      "agentDot": "●",
      "laneSpan": "━",
      "laneIdle": "·"
    }
  },
  "gaugeCells": 5,
  "gaugeFrom": [0, 10, 39, 59, 79, 90],
  "windows": {
    "default": 200000,
    "oneMillion": 1000000
  }
}
