// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const path=require('node:path');
process.env.PIPI_ANDROID_OUTPUT_ROOT=path.resolve(__dirname,'../outputs/integrated-optimization/batch-b/android');
process.env.PIPI_ANDROID_APPLICATION_ID='com.pipiphone.app.integratedqa';
require('./build-standalone-android.cjs').build().catch(error=>{console.error(error);process.exitCode=1;});
