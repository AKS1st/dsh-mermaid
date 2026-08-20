import { resolve } from 'node:path'
import { chromium } from 'playwright'
import { MERMAID_SUPPORT_CASES } from '../tests/fixtures/mermaid-cases.ts'

const bundlePath = resolve(import.meta.dirname, '../node_modules/mermaid/dist/mermaid.min.js')
const CASE_TIMEOUT_MS = 15_000

async function withTimeout(promise, label) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${CASE_TIMEOUT_MS}ms`)), CASE_TIMEOUT_MS)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

async function launchBrowser() {
  const executablePath = process.env.PLAYWRIGHT_EXECUTABLE_PATH
  try {
    return {
      browser: await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) }),
      label: executablePath ?? 'Playwright Chromium',
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new Error(`Chromium could not be launched. Run \`npx playwright install chromium\`, or set PLAYWRIGHT_EXECUTABLE_PATH.\n${detail}`)
  }
}

function formatError(error) {
  if (error === null || typeof error !== 'object') return String(error)
  return [error.name, error.message, error.stack].filter(Boolean).join('\n')
}

const { browser, label } = await launchBrowser()
const failures = []
let supported = 0
let unsupported = 0

console.log(`Browser: ${label}`)
console.log(`Mermaid bundle: ${bundlePath}`)

try {
  for (const testCase of MERMAID_SUPPORT_CASES) {
    const page = await browser.newPage()
    const pageErrors = []
    page.on('pageerror', error => pageErrors.push(error))
    try {
      await page.setContent('<!doctype html><html><head></head><body></body></html>')
      await page.addScriptTag({ path: bundlePath })
      let result = await withTimeout(page.evaluate(async ({ id, source, expectedType, expectedParseType, expected }) => {
        window.mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          suppressErrorRendering: true,
          maxTextSize: 50000,
          maxEdges: 2000,
          deterministicIds: true,
          deterministicIDSeed: 'dsh-mermaid-browser-compat',
        })
        try {
          const detectedType = window.mermaid.detectType(source)
          const parsed = await window.mermaid.parse(source)
          if (expected === 'unsupported') {
            return { ok: false, error: { name: 'UnexpectedSupport', message: `detected ${detectedType}` } }
          }
          if (detectedType !== expectedType) {
            return { ok: false, error: { name: 'DetectorMismatch', message: `expected ${expectedType}, got ${detectedType}` } }
          }
          const wantedParseType = expectedParseType ?? expectedType
          if (parsed.diagramType !== wantedParseType) {
            return { ok: false, error: { name: 'ParserMismatch', message: `expected ${wantedParseType}, got ${parsed.diagramType}` } }
          }
          const { svg } = await window.mermaid.render(`compat-${id}`, source)
          if (!svg.includes('<svg') || svg.includes('Syntax error in text')) {
            return { ok: false, error: { name: 'InvalidSvg', message: svg.slice(0, 500) } }
          }
          return { ok: true, detectedType, diagramType: parsed.diagramType, svgBytes: svg.length }
        } catch (error) {
          if (expected === 'unsupported') return { ok: true, rejected: true }
          return {
            ok: false,
            error: {
              name: error?.name ?? 'Error',
              message: error?.message ?? String(error),
              stack: error?.stack,
            },
          }
        }
      }, testCase), `Mermaid case ${testCase.id}`)

      if (result.ok && pageErrors.length > 0) {
        result = {
          ok: false,
          error: {
            name: 'PageError',
            message: pageErrors.map(error => error.message).join('\n'),
            stack: pageErrors.map(error => error.stack).filter(Boolean).join('\n'),
          },
        }
      }

      if (result.ok) {
        if (testCase.expected === 'supported') supported += 1
        else unsupported += 1
        console.log(`✓ [${testCase.status}] ${testCase.id}: ${testCase.expected}`)
      } else {
        failures.push({ id: testCase.id, error: result.error })
        console.error(`✗ [${testCase.status}] ${testCase.id}: ${testCase.expected}`)
        console.error(formatError(result.error))
      }
    } catch (error) {
      failures.push({ id: testCase.id, error })
      console.error(`✗ [${testCase.status}] ${testCase.id}: harness failure`)
      console.error(formatError(error))
    } finally {
      await page.close()
    }
  }
} finally {
  await browser.close()
}

console.log(`\nSummary: ${supported} supported, ${unsupported} expected unsupported, ${failures.length} failed`)
if (failures.length > 0) process.exitCode = 1
