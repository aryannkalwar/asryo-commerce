import {recoverOffsite} from '../offsite-backups.mjs';
import {resolve} from 'node:path';
const [key,destination]=process.argv.slice(2);
if(!key||!destination){console.error('Usage: node scripts/recover-offsite.mjs BACKUP_KEY NEW_PRIVATE_DIRECTORY');process.exitCode=1;}
else{
 try{console.log(JSON.stringify(await recoverOffsite(key,resolve(destination))));}
 catch{console.error('Offsite recovery failed. Check private configuration, backup key and a new destination directory.');process.exitCode=1;}
}
