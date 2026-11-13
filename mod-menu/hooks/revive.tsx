// hooks/revive.tsx, by v-amorim
import type { RenderElement } from 'claude-code'

type Node = { type?: string; props?: Record<string, unknown>; children?: unknown[] }
type ClientProps = { key: string; module: string; props: Record<string, never>; height?: number; width?: number }

// A readout another mod drew hidden, drawn again here: its Clients are new ones from the surface modules copied into this mod.
export function revive({ Client }: { Client: (props: any) => RenderElement }, node: unknown): unknown {
  if (Array.isArray(node)) return node.map(each => revive({ Client }, each))
  if (!node || typeof node !== 'object') return node
  const { type, props, children } = node as Node
  if (type === 'Client') {
    const { key, module, props: own, height, width } = props as unknown as ClientProps
    const size = { ...(height === undefined ? {} : { height }), ...(width === undefined ? {} : { width }) }
    // The validator wants each module path as a literal.
    if (module.endsWith('meter.tsx')) return <Client key={key} {...size} module="./meter.tsx" props={own} />
    if (module.endsWith('choice.tsx')) return <Client key={key} {...size} module="./choice.tsx" props={own} />

    return <Client key={key} {...size} module="./entry.tsx" props={own} />
  }

  return children ? { ...node, children: children.map(each => revive({ Client }, each)) } : node
}
