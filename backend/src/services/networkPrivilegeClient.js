'use strict';
const net = require('net');
const SOCKET_PATH = process.env.NEXA_NETWORK_EXECUTOR_SOCKET || '/run/nexa-network-executor/control.sock';

function executeNetworkOperation(payload) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: SOCKET_PATH });
    let response = '';
    const timeout = setTimeout(() => socket.destroy(new Error('Network executor timed out')), 12000);
    socket.on('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8');
      if (Buffer.byteLength(response) > 16384) socket.destroy(new Error('Network executor response is too large'));
    });
    socket.on('end', () => {
      clearTimeout(timeout);
      try {
        const result = JSON.parse(response.trim());
        if (!result.ok) throw new Error(result.error || 'Network executor rejected the request');
        resolve(result);
      } catch (error) { reject(error); }
    });
    socket.on('error', (error) => { clearTimeout(timeout); reject(error); });
  });
}

module.exports = { executeNetworkOperation };
