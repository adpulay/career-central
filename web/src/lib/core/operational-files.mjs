// Fixed-owner local JSON IO. No recovery or initialization occurs during reads.
import fs from 'node:fs';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
export const ioError=code=>Object.assign(Error(code),{code});
export function checkPath(file,{allowMissing=true}={}){
 if(typeof file!=='string'||file.split(/[\\/]/).includes('..'))throw ioError('UNSAFE_OPERATIONAL_PATH');
 const full=path.resolve(file),parts=full.slice(path.parse(full).root.length).split(path.sep);let cursor=path.parse(full).root;
 for(let i=0;i<parts.length;i++){cursor=path.join(cursor,parts[i]);if(/^(?:\.git|\.aws|\.codex|\.env|oauth|credentials?|secrets?|tokens?|msal-cache.*)$/i.test(parts[i]))throw ioError('UNSAFE_OPERATIONAL_PATH');try{const s=fs.lstatSync(cursor);if(s.isSymbolicLink()||i<parts.length-1&&!s.isDirectory()||i===parts.length-1&&!s.isDirectory()&&(!s.isFile()||s.nlink!==1))throw ioError('UNSAFE_OPERATIONAL_PATH');}catch(e){if(e.code==='ENOENT'&&allowMissing)return full;throw e;}}
 return full;
}
export function ownedPath(root,kind,{create=false}={}){
 if(!path.isAbsolute(root))throw ioError('UNSAFE_OPERATIONAL_PATH');
 checkPath(root,{allowMissing:false});if(!fs.statSync(root).isDirectory())throw ioError('UNSAFE_OPERATIONAL_PATH');
 const file=path.join(root,'data',...(kind==='mailbox'?['application-automation','ledger.json']:['scheduled-jobs.json']));
 if(!['mailbox','worker'].includes(kind))throw ioError('UNSUPPORTED_STORE');checkPath(file);
 if(create){fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});checkPath(file);}return file;
}
function readOwnedBytes(file){
 checkPath(file);let fd;
 try{fd=fs.openSync(file,fs.constants.O_RDONLY|(fs.constants.O_NOFOLLOW||0));const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.nlink!==1||stat.size>8*1024*1024)throw ioError('UNSAFE_OPERATIONAL_FILE');const bytes=fs.readFileSync(fd);if(bytes.length>8*1024*1024)throw ioError('UNSAFE_OPERATIONAL_FILE');return bytes;}catch(e){if(e.code==='ENOENT')return undefined;throw e;}finally{if(fd!==undefined)fs.closeSync(fd);}
}
export function readOwnedJson(file){const bytes=readOwnedBytes(file);if(bytes===undefined)return undefined;try{return JSON.parse(bytes.toString('utf8'));}catch{throw ioError('INVALID_OPERATIONAL_JSON');}}
export function fileDigest(file){const bytes=readOwnedBytes(file);return bytes===undefined?null:createHash('sha256').update(bytes).digest('hex');}
export function atomicWriteOwnedJson(file,value,{expectedDigest,phaseHook}={}){
 checkPath(file);fs.mkdirSync(path.dirname(file),{recursive:true,mode:0o700});checkPath(file);
 const text=JSON.stringify(value,null,2)+'\n';if(Buffer.byteLength(text)>8*1024*1024)throw ioError('OPERATIONAL_FILE_TOO_LARGE');
 const tmp=file+`.tmp-${process.pid}-${randomUUID()}`;let fd,stamp,renamed=false;
 try{
  if(expectedDigest!==undefined&&fileDigest(file)!==expectedDigest)throw ioError('SOURCE_REVISION_CONFLICT');
  fd=fs.openSync(tmp,'wx',0o600);fs.writeFileSync(fd,text);fs.fsyncSync(fd);stamp=fs.fstatSync(fd);fs.closeSync(fd);fd=undefined;
  phaseHook?.('prepared');checkPath(file);
  if(expectedDigest!==undefined&&fileDigest(file)!==expectedDigest)throw ioError('SOURCE_REVISION_CONFLICT');
  checkPath(tmp,{allowMissing:false});const tempStat=fs.lstatSync(tmp);if(!tempStat.isFile()||tempStat.dev!==stamp.dev||tempStat.ino!==stamp.ino||fileDigest(tmp)!==createHash('sha256').update(text).digest('hex'))throw ioError('UNSAFE_OPERATIONAL_TEMP');
  fs.renameSync(tmp,file);renamed=true;phaseHook?.('committed');
  let dir;try{dir=fs.openSync(path.dirname(file),fs.constants.O_RDONLY);fs.fsyncSync(dir);}catch(e){if(!['EINVAL','ENOTSUP','EISDIR','EPERM','ENOSYS'].includes(e.code))throw e;}finally{if(dir!==undefined)fs.closeSync(dir);}
  return {committed:true};
 }catch(e){if(renamed)throw ioError('OPERATION_COMMIT_UNCERTAIN');throw e;}finally{if(fd!==undefined)fs.closeSync(fd);try{fs.unlinkSync(tmp);}catch{/* Explicit recovery handles leftover temp files. */}}
}
