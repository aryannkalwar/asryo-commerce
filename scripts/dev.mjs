// Local preview accepts the same --port convention as framework dev servers.
const args = process.argv.slice(2);
const index = args.indexOf('--port');
if (index !== -1) {
  const port = Number(args[index+1]);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid preview port');
  process.env.PORT = String(port);
}
await import('../server.mjs');
