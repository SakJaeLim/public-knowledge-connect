import { fileURLToPath } from 'node:url';
console.log(JSON.stringify({ mcpServers: { 'public-knowledge-connect': {
  command: process.execPath, args: [fileURLToPath(new URL('../src/mcp.js', import.meta.url))],
} } }, null, 2));
