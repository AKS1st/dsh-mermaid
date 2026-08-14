import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { serveDistFile } from '../src/index.ts'
import { DEFAULT_CONFIG, validateConfig } from '../src/protocol.ts'

/** A minimal node:http ServerResponse recording status + body. */
class FakeResponse {
  status = 0
  headers: Record<string, string> = {}
  body = ''
  writeHead(status: number, headers: Record<string, string>): this {
    this.status = status
    this.headers = headers
    return this
  }
  end(body: string | Buffer = ''): this {
    this.body = body.toString()
    return this
  }
}

describe('dsh-mermaid host', () => {
  it('serves the mermaid UMD build with a JS content type', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mermaid-'))
    await writeFile(join(root, 'mermaid.min.js'), 'export{}')
    const res = new FakeResponse()
    await serveDistFile(root, '/mermaid.min.js', res as never)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('text/javascript')
    expect(res.body).toBe('export{}')
  })

  it('serves the source map with a JSON content type', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mermaid-'))
    await writeFile(join(root, 'mermaid.min.js.map'), '{}')
    const res = new FakeResponse()
    await serveDistFile(root, '/mermaid.min.js.map', res as never)
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('application/json')
  })

  it('rejects traversal outside the dist root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mermaid-'))
    await mkdir(join(root, 'dist'))
    const res = new FakeResponse()
    await serveDistFile(root, '/../secret', res as never)
    expect(res.status).toBe(403)
  })

  it('404s for files the route does not serve', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mermaid-'))
    const res = new FakeResponse()
    await serveDistFile(root, '/chunks/x.mjs', res as never)
    expect(res.status).toBe(404)
  })

  it('404s on a missing bundle instead of SPA-falling-back', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-mermaid-'))
    const res = new FakeResponse()
    await serveDistFile(root, '/mermaid.min.js', res as never)
    expect(res.status).toBe(404)
  })
})

describe('dsh-mermaid config validation', () => {
  it('defaults when config is absent', () => {
    expect(validateConfig(undefined)).toEqual(DEFAULT_CONFIG)
  })

  it('merges valid overrides', () => {
    expect(validateConfig({ theme: 'dark', maxEdges: 4000 })).toEqual({
      theme: 'dark',
      maxTextSize: 50000,
      maxEdges: 4000,
      securityLevel: 'strict',
    })
  })

  it('rejects an unknown theme', () => {
    expect(() => validateConfig({ theme: 'rainbow' })).toThrow('invalid theme')
  })

  it('rejects a non-positive maxTextSize', () => {
    expect(() => validateConfig({ maxTextSize: 0 })).toThrow('invalid maxTextSize')
  })

  it('rejects a loose security level', () => {
    expect(() => validateConfig({ securityLevel: 'loose' })).toThrow('only "strict"')
  })
})
