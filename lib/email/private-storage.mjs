import fs from 'node:fs';
import path from 'node:path';
import {assertWindowsPrivatePath} from './windows-private-path.mjs';

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
  if (process.platform === 'win32') assertWindowsPrivatePath(target);
  else fs.chmodSync(target, 0o700);
  return target;
}

export function assertPrivateStorageFile(file) {
  let stat;
  try {stat = fs.lstatSync(file);} catch (error) {if (error.code === 'ENOENT') return; throw error;}
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 ||
      process.getuid && stat.uid !== process.getuid()) throw Error('Unsafe private storage file');
  if (process.platform === 'win32') assertWindowsPrivatePath(file);
  else if (stat.mode & 0o077) throw Error('Private storage file permissions are too broad');
}
