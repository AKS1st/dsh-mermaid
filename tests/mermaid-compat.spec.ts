import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { isSupportedCase, MERMAID_SUPPORT_CASES } from './fixtures/mermaid-cases.ts'
import { installRealMermaid, type MermaidWindow, type RealMermaidApi } from './helpers/real-mermaid.ts'

const INTERNAL_DETECTORS = new Set(['error', '---'])

function createMermaid(): { dom: JSDOM; mermaid: RealMermaidApi } {
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', {
    pretendToBeVisual: true,
    runScripts: 'dangerously',
    url: 'http://localhost/',
  })
  const mermaid = installRealMermaid(dom.window as unknown as MermaidWindow)
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    suppressErrorRendering: true,
    maxTextSize: 50000,
    maxEdges: 2000,
    deterministicIds: true,
    deterministicIDSeed: 'dsh-mermaid-compat',
  })
  return { dom, mermaid }
}

describe('real Mermaid compatibility matrix', () => {
  for (const testCase of MERMAID_SUPPORT_CASES) {
    it(`[${testCase.status}] ${testCase.id}: ${testCase.expected}`, async () => {
      const { dom, mermaid } = createMermaid()

      try {
        if (testCase.expected === 'unsupported') {
          expect(() => mermaid.detectType(testCase.source)).toThrow()
          await expect(mermaid.parse(testCase.source)).rejects.toBeDefined()
          return
        }

        expect(mermaid.detectType(testCase.source)).toBe(testCase.expectedType)
        await expect(mermaid.parse(testCase.source)).resolves.toMatchObject({
          diagramType: testCase.expectedParseType ?? testCase.expectedType,
        })
        if (testCase.renderInJsdom !== false) {
          const result = await mermaid.render(`compat-${testCase.id}`, testCase.source)
          expect(result.svg).toContain('<svg')
          expect(result.svg).not.toContain('Syntax error in text')
        }
      } finally {
        dom.window.close()
      }
    })
  }

  it('catalog covers every diagram detector registered by the bundled Mermaid', async () => {
    const { dom, mermaid } = createMermaid()
    try {
      await mermaid.parse('flowchart TD\n  A --> B')
      const registered = mermaid.getRegisteredDiagramsMetadata()
        .map(({ id }) => id)
        .filter(id => !INTERNAL_DETECTORS.has(id))
        .sort()
      const supportedCases = MERMAID_SUPPORT_CASES.filter(isSupportedCase)
      const covered = supportedCases
        .map(testCase => testCase.expectedType)
        .sort()

      expect(new Set(MERMAID_SUPPORT_CASES.map(testCase => testCase.id)).size)
        .toBe(MERMAID_SUPPORT_CASES.length)
      expect(new Set(covered).size).toBe(covered.length)
      expect(covered).toEqual(registered)
    } finally {
      dom.window.close()
    }
  })
})
