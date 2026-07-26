import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, normalize } from 'node:path';

const root = fileURLToPath(new URL('./fixtures/', import.meta.url));
const server = createServer(async (req, res) => {
  try {
    const path = normalize(join(root, req.url === '/' ? 'page.html' : (req.url ?? '')));
    if (!path.startsWith(root)) throw new Error('forbidden');
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(body);
  } catch {
    res.writeHead(404);
    res.end('not found');
  }
});
server.listen(8787, () => console.log('fixture server on :8787'));
