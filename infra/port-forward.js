#!/usr/bin/env node
// Daybook port-forward: TCP proxy from port 80 → port 3001.
// Runs as root (via LaunchDaemon) so it can bind port 80.
// No dependencies — uses Node.js built-in `net` module only.
// Listens on both IPv4 (0.0.0.0) and IPv6 (::) so iOS/macOS
// Happy Eyeballs works regardless of which address family is tried first.
'use strict';

const net  = require('net');
const PORT_IN  = parseInt(process.env.PORT_IN  || '80',   10);
const PORT_OUT = parseInt(process.env.PORT_OUT || '3001', 10);

function makeServer(family) {
  const server = net.createServer(socket => {
    const proxy = net.connect(PORT_OUT, '127.0.0.1', () => {
      socket.pipe(proxy);
      proxy.pipe(socket);
    });
    proxy.on('error', () => socket.destroy());
    socket.on('error', () => proxy.destroy());
  });

  const host = family === 6 ? '::' : '0.0.0.0';
  server.listen(PORT_IN, host, () => {
    process.stdout.write(`daybook port-forward (IPv${family}): :${PORT_IN} → :${PORT_OUT}\n`);
  });
  server.on('error', err => {
    // Log but don't crash — the other family's server still works.
    process.stderr.write(`daybook port-forward (IPv${family}) error: ${err.message}\n`);
  });
  return server;
}

const v4 = makeServer(4);
const v6 = makeServer(6);

process.on('SIGTERM', () => {
  v4.close();
  v6.close();
  setTimeout(() => process.exit(0), 500);
});
