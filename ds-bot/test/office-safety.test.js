import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, test } from 'node:test'
import { deflateSync } from 'node:zlib'
import { Package } from '../src/office/package.js'
import { contactSheet, decodePng, encodePng } from '../src/office/png.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const CLI = join(ROOT, 'office.js')
const SAMPLE = join(ROOT, 'test', 'fixtures', 'office', 'sample.docx')

function unpacked(t) {
  const root = mkdtempSync(join(tmpdir(), 'office-safety-'))
  t.after(() => rmSync(root, { recursive: true, force: true }))
  const dir = join(root, 'unpacked')
  Package.open(SAMPLE).unpack(dir)
  return { root, dir }
}

describe('Office directory inputs', () => {
  test('the selected root can be a directory alias', t => {
    const { root, dir } = unpacked(t)
    const alias = join(root, 'selected')
    symlinkSync(dir, alias, process.platform === 'win32' ? 'junction' : 'dir')
    const loaded = Package.loadDir(alias)
    assert.deepEqual(loaded.get('word/document.xml'), Package.loadDir(dir).get('word/document.xml'))
  })

  for (const cyclic of [false, true]) {
    test(`directory input refuses an ${cyclic ? 'internal cycle' : 'external directory link'}`, t => {
      const { root, dir } = unpacked(t)
      const outside = join(root, 'outside')
      mkdirSync(outside)
      const privateFile = join(outside, 'private.txt')
      writeFileSync(privateFile, 'not a package member')
      symlinkSync(cyclic ? dir : outside, join(dir, 'linked'), process.platform === 'win32' ? 'junction' : 'dir')
      assert.throws(() => Package.loadDir(dir), { code: 'package', message: /linked is a link/ })
      const out = join(root, 'packed.docx')
      for (const args of [['pack', dir, out], ['check', dir], ['docx', 'read', dir]]) {
        assert.throws(() => execFileSync(process.execPath, [CLI, ...args, '--json'], { encoding: 'utf8' }), error => {
          const result = JSON.parse(error.stdout)
          return error.status === 2 && result.ok === false && result.error.code === 'package' && /linked is a link/.test(result.error.message)
        })
      }
      assert.equal(existsSync(out), false)
      assert.equal(readFileSync(privateFile, 'utf8'), 'not a package member')
    })
  }

  test('directory input refuses a linked file', t => {
    const { root, dir } = unpacked(t)
    const outside = join(root, 'outside.txt')
    writeFileSync(outside, 'not a package member')
    try { symlinkSync(outside, join(dir, 'linked.txt'), 'file') }
    catch (error) {
      if (process.platform === 'win32' && error.code === 'EPERM') { t.skip('file symlinks require Windows privileges'); return }
      throw error
    }
    assert.throws(() => Package.loadDir(dir), { code: 'package', message: /linked.txt is a link/ })
    assert.equal(readFileSync(outside, 'utf8'), 'not a package member')
  })
})

// Small synthetic PNGs keep chunk CRCs valid while varying the scanline payload.
function pngChunk(type, data) {
  const buf = Buffer.alloc(data.length + 12)
  buf.writeUInt32BE(data.length)
  buf.write(type, 4, 'latin1')
  data.copy(buf, 8)
  let crc = 0xffffffff
  for (const byte of buf.subarray(4, data.length + 8)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  buf.writeUInt32BE((crc ^ 0xffffffff) >>> 0, data.length + 8)
  return buf
}

function pngRows(width, height, raw, { color = 2, palette } = {}) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width); ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8; ihdr[9] = color
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'), pngChunk('IHDR', ihdr),
    ...(palette ? [pngChunk('PLTE', palette)] : []),
    pngChunk('IDAT', deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ])
}

describe('Office PNG input sizes', () => {
  for (const [width, height] of [[0, 1], [1, 0], [0x80000000, 1]]) {
    test(`refuses invalid dimensions ${width} by ${height}`, () => {
      assert.throws(() => decodePng(pngRows(width, height, Buffer.alloc(0))), { code: 'png', message: /invalid PNG dimensions/ })
    })
  }

  test('refuses oversized declared images before allocating their pixels', () => {
    assert.throws(() => decodePng(pngRows(1000000, 1000000, Buffer.alloc(0))), { code: 'png', message: /exceeds 256 MiB/ })
    assert.throws(() => decodePng(pngRows(8192, 8193, Buffer.alloc(0), { color: 0 })), { code: 'png', message: /exceeds 256 MiB/ })
  })

  for (const [height, raw] of [[1, [0, 255, 0, 0]], [2, [0, 255, 0, 0, 0, 255, 0, 0, 0, 0, 255]]]) {
    test(`refuses a truncated ${height}-row image instead of filling missing pixels`, () => {
      assert.throws(() => decodePng(pngRows(2, height, Buffer.from(raw))), { code: 'png', message: /scanline size/ })
    })
  }

  test('bounds inflation to the declared scanline length', () => {
    assert.throws(() => decodePng(pngRows(1, 1, Buffer.alloc(100000))), { code: 'png', message: /inflates past its declared dimensions/ })
  })

  test('sheet refuses a truncated PNG without producing a contact sheet', t => {
    const root = mkdtempSync(join(tmpdir(), 'office-safety-'))
    t.after(() => rmSync(root, { recursive: true, force: true }))
    const input = join(root, 'short.png'), output = join(root, 'contact.png')
    const corrupt = pngRows(2, 1, Buffer.from([0, 255, 0, 0]))
    writeFileSync(input, corrupt)
    assert.throws(() => execFileSync(process.execPath, [CLI, 'sheet', input, '-o', output, '--json'], { encoding: 'utf8' }), error => {
      const result = JSON.parse(error.stdout)
      return error.status === 2 && result.ok === false && result.error.code === 'png'
    })
    assert.equal(existsSync(output), false)
    assert.deepEqual(readFileSync(input), corrupt)
  })

  test('refuses truncated chunk headers and IHDR bodies', () => {
    const signature = Buffer.from('89504e470d0a1a0a', 'hex')
    assert.throws(() => decodePng(Buffer.alloc(4)), { code: 'png' })
    assert.throws(() => decodePng(Buffer.concat([signature, Buffer.alloc(4)])), { code: 'png', message: /truncated PNG chunk/ })
    assert.throws(() => decodePng(Buffer.concat([signature, pngChunk('IHDR', Buffer.alloc(8))])), { code: 'png', message: /invalid PNG IHDR/ })
    const truncated = pngRows(1, 1, Buffer.from([0, 255, 0, 0])).subarray(0, 20)
    assert.throws(() => decodePng(truncated), { code: 'png', message: /truncated PNG IHDR chunk/ })
  })

  for (const [color, values, expected, palette] of [
    [0, [80], [80, 80, 80, 255]],
    [2, [255, 0, 0], [255, 0, 0, 255]],
    [3, [0], [0, 255, 0, 255], [0, 255, 0]],
    [4, [80, 128], [80, 80, 80, 128]],
    [6, [255, 0, 0, 128], [255, 0, 0, 128]],
  ]) {
    test(`decodes complete scanlines for color type ${color}`, () => {
      const options = { color, palette: palette && Buffer.from(palette) }
      const image = decodePng(pngRows(1, 1, Buffer.from([0, ...values]), options))
      assert.deepEqual([...image.data], expected)
    })
  }

  test('complete multi-row PNGs still compose and round-trip through a contact sheet', () => {
    const image = decodePng(pngRows(1, 2, Buffer.from([0, 255, 0, 0, 0, 0, 255, 0])))
    const sheet = contactSheet([image, image], { cols: 2, width: 1 })
    const decoded = decodePng(encodePng(sheet))
    assert.equal(decoded.width, 2)
    assert.equal(decoded.height, 12)
    assert.deepEqual([...decoded.data.subarray(0, 16)], [255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255])
  })
})
