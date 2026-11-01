import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./dist/', import.meta.url));
const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
};

const server = createServer(async (request, response) => {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' });
    response.end('Method not allowed.');
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  } catch {
    response.writeHead(400);
    response.end('Invalid address.');
    return;
  }

  const target = resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  const insideRoot = target.startsWith(resolve(root) + sep);
  if (!insideRoot) {
    response.writeHead(404);
    response.end('File not found.');
    return;
  }

  try {
    const body = await readFile(target);
    response.writeHead(200, {
      'Content-Type': types[extname(target)] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500);
    response.end('Could not open this file.');
  }
});

server.on('error', (error) => {
  console.error(error.code === 'EADDRINUSE'
    ? 'Port 8000 is already in use. Stop the other server and try again.'
    : 'Could not start the local server: ' + error.message);
  process.exitCode = 1;
});

server.listen(8000, '127.0.0.1', () => {
  console.log('Particle Chamber: http://127.0.0.1:8000');
  console.log('Press Ctrl+C to stop.');
});
