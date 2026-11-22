// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs/promises');
const path=require('node:path');
const {fingerprint}=require('../lib/android-assets.cjs');
async function main(){
  const output=process.argv[2];
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,JSON.stringify(await fingerprint())+'\n');
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
