import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { TextDecoder, TextEncoder } from 'node:util'

export interface RealMermaidApi {
  initialize(config: Record<string, unknown>): void
  detectType(source: string): string
  parse(source: string): Promise<{ diagramType: string }>
  render(id: string, source: string): Promise<{ svg: string }>
  getRegisteredDiagramsMetadata(): Array<{ id: string }>
}

export type MermaidWindow = Window & typeof globalThis

/**
 * Install the exact Mermaid UMD bundle shipped by this package into a jsdom
 * window. Geometry APIs are deterministic stand-ins: the compatibility suite
 * verifies that each parser and renderer completes and emits SVG, not pixel
 * layout (which belongs in the Playwright visual checks).
 */
export function installRealMermaid(window: MermaidWindow): RealMermaidApi {
  // These are browser globals in DSH Web but are not installed in a fresh
  // jsdom realm. Mermaid's newer Langium parsers use all three.
  Object.defineProperties(window, {
    TextEncoder: { value: TextEncoder, configurable: true },
    TextDecoder: { value: TextDecoder, configurable: true },
    structuredClone: { value: globalThis.structuredClone, configurable: true },
  })

  type GeometryElement = Element & {
    getBBox(): { x: number; y: number; width: number; height: number }
    getComputedTextLength(): number
  }
  const elementPrototype = window.Element.prototype as GeometryElement
  elementPrototype.getBBox = function () { return { x: 0, y: 0, width: 120, height: 40 } }
  elementPrototype.getComputedTextLength = function () { return 40 }
  elementPrototype.getBoundingClientRect = function () {
    return {
      x: 0, y: 0, width: 120, height: 40,
      top: 0, left: 0, right: 120, bottom: 40,
      toJSON: () => ({ x: 0, y: 0, width: 120, height: 40 }),
    }
  }

  // Cytoscape-backed layouts (notably mindmap) initialize a 2D canvas even
  // though this suite only asserts emitted SVG. A permissive no-op context
  // keeps the test focused on Mermaid parser/renderer compatibility.
  Object.defineProperty(window.HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    value(this: HTMLCanvasElement): CanvasRenderingContext2D {
      const base = {
        canvas: this,
        measureText: (text: string) => ({ width: text.length * 8 }),
        createLinearGradient: () => ({ addColorStop(): void {} }),
        createRadialGradient: () => ({ addColorStop(): void {} }),
        createPattern: () => null,
        getImageData: () => ({ data: new Uint8ClampedArray(4), width: 1, height: 1 }),
      }
      return new Proxy(base, {
        get(target, property) {
          if (property in target) return target[property as keyof typeof target]
          return (): void => {}
        },
        set(target, property, value) {
          Object.assign(target, { [property]: value })
          return true
        },
      }) as unknown as CanvasRenderingContext2D
    },
  })

  const script = window.document.createElement('script')
  script.textContent = readFileSync(
    resolve(import.meta.dirname, '../../node_modules/mermaid/dist/mermaid.min.js'),
    'utf8',
  )
  window.document.head.append(script)
  const mermaid = (window as Window & { mermaid?: RealMermaidApi }).mermaid
  if (mermaid === undefined) throw new Error('real Mermaid UMD did not install window.mermaid')
  return mermaid
}
