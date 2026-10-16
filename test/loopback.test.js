import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import express from 'express'
import { LOOPBACK_HOSTS, listenLoopback } from '../server/loopback.js'

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer()
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address()
      probe.close(() => resolve(port))
    })
    probe.on('error', reject)
  })
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume()
      res.on('end', () => resolve(res.statusCode))
    })
    // A filtered LAN address can drop the packet instead of refusing it. Fail fast
    // so a reachable server cannot hide behind a hang.
    req.setTimeout(1500, () => {
      req.destroy(Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }))
    })
    req.on('error', reject)
  })
}

function lanIPv4() {
  return Object.values(os.networkInterfaces())
    .flat()
    .find((info) => info && info.family === 'IPv4' && !info.internal)?.address ?? null
}

test('the API bind list is loopback only', () => {
  assert.deepEqual(LOOPBACK_HOSTS, ['127.0.0.1', '::1'])
})

test('listenLoopback accepts this machine and refuses a LAN address', async () => {
  const app = express()
  app.get('/api/ping', (_req, res) => res.json({ ok: true }))

  const port = await freePort()
  const servers = await listenLoopback(app, port)
  try {
    const addresses = servers.map((server) => server.address())
    assert.ok(addresses.length >= 1)
    for (const addr of addresses) {
      assert.ok(addr.address === '127.0.0.1' || addr.address === '::1', `bound ${addr.address}`)
      assert.equal(addr.port, port)
    }
    assert.ok(addresses.some((addr) => addr.address === '127.0.0.1'))

    assert.equal(await get(`http://127.0.0.1:${port}/api/ping`), 200)
    if (addresses.some((addr) => addr.address === '::1')) {
      assert.equal(await get(`http://[::1]:${port}/api/ping`), 200)
    }

    const lan = lanIPv4()
    if (lan) {
      await assert.rejects(get(`http://${lan}:${port}/api/ping`), { code: 'ECONNREFUSED' })
    }
  } finally {
    await Promise.all(servers.map((server) => new Promise((resolve) => server.close(resolve))))
  }
})
