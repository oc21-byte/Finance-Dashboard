import http from 'node:http'

// Bind addresses for the API. `app.listen(port)` with no host accepts connections on
// the unspecified address (`::` / `0.0.0.0`), which is every interface on the machine —
// including public Wi-Fi. These two are loopback only: this computer, nothing else.
//
// Both are required. Node 17+ resolves the name "localhost" to IPv6 `::1` first, while
// the Vite proxy and some clients use `127.0.0.1`. Binding just one of them makes the
// other spelling fail with ECONNREFUSED. Binding the unspecified `::` would also accept
// LAN traffic, so it is not a substitute.
export const LOOPBACK_HOSTS = ['127.0.0.1', '::1']

// IPv6 is optional on some machines. These codes mean "::1" is not a usable address,
// not that the port is taken. Anything else (EADDRINUSE in particular) is fatal.
const IPV6_UNAVAILABLE = new Set(['EADDRNOTAVAIL', 'EAFNOSUPPORT', 'EINVAL'])

function listenOnce(handler, port, host) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler)
    const onError = (err) => {
      server.removeListener('error', onError)
      reject(err)
    }
    server.on('error', onError)
    server.listen(port, host, () => {
      server.removeListener('error', onError)
      resolve(server)
    })
  })
}

/**
 * Listen on IPv4 loopback, then on IPv6 loopback at the same port.
 * Returns the servers that bound. IPv4 failure rejects; a missing IPv6 stack is skipped.
 * `port` 0 is allowed: IPv6 reuses the port the OS assigned to IPv4.
 */
export async function listenLoopback(handler, port) {
  const v4 = await listenOnce(handler, port, '127.0.0.1')
  const boundPort = v4.address().port
  try {
    const v6 = await listenOnce(handler, boundPort, '::1')
    return [v4, v6]
  } catch (err) {
    if (IPV6_UNAVAILABLE.has(err.code)) {
      console.warn(`IPv6 loopback (::1) is not available (${err.code}); listening on 127.0.0.1 only`)
      return [v4]
    }
    await new Promise((resolve) => v4.close(resolve))
    throw err
  }
}
