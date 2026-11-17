import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export function isEntrypoint(url: string) {
  return !!process.argv[1] && fileURLToPath(url) === resolve(process.argv[1]);
}
