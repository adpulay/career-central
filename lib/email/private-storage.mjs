import fs from 'node:fs';
import path from 'node:path';

export function privateDirectory(directory, repo) {
  const target = path.resolve(directory);
  let cursor = target;
  while (true) {
    if (fs.existsSync(cursor)) {
      if (fs.lstatSync(cursor).isSymbolicLink()) throw Error('Private storage cannot use symlinks');
      if (fs.existsSync(path.join(cursor, '.git'))) throw Error('OAuth storage must be outside all Git repositories');
    }
    if (cursor === path.dirname(cursor)) break;
    cursor = path.dirname(cursor);
  }
  const realRepo = fs.realpathSync(repo);
  if (target === realRepo || target.startsWith(realRepo + path.sep)) throw Error('OAuth storage must be outside the project');
  fs.mkdirSync(target, {recursive: true, mode: 0o700});
  const stat = fs.statSync(target);
  if (process.getuid && stat.uid !== process.getuid()) throw Error('Private storage owner mismatch');
  fs.chmodSync(target, 0o700);
  return target;
}
