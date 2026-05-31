#!/usr/bin/env node
// Daybook port-forward: TCP proxy from port 80 → port 3001.
// Runs as root (via LaunchDaemon) so it can bind port 80.
// No dependencies — uses Node.js built-in `net` module only.
'use strict';

const net  = require('net');
const PORT_IN  = parseInt(process.env.PORT_IN  || '80',   10);
const PORT_OUT = parseInt(process.env.PORT_OUT || '3001', 10);

const server = net.createServer(socket => {
  const proxy = net.connect(PORT_OUT, '127.0.0.1', () => {
    socket.pipe(proxy);
    proxy.pipe(socket);
  });
  proxy.on('error', () => socket.destroy());
  socket.on('error', () => proxy.destroy());
});

server.listen(PORT_IN, '0.0.0.0', () => {
  process.stdout.write(`daybook port-forward: :${PORT_IN} → :${PORT_OUT}\n`);
});

process.on('SIGTERM', () => server.close(() => process.exit(0)));
