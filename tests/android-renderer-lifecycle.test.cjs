// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const src=path.join(__dirname,'../android/app/src/main');
const java=name=>fs.readFileSync(path.join(src,'java/com/pipiphone/app',name+'.java'),'utf8');
test('renderer loss detaches the broken view and restarts the trusted connection once',()=>{
  const handler=java('MainActivity').split('boolean onRenderProcessGone(')[1].split('@Override')[0];
  assert.match(handler,/if \(view != web\) return true/);
  assert.match(handler,/surface\.removeView\(view\);[\s\S]*view\.destroy\(\);\s*createWebView\(\)/);
  assert.match(handler,/boolean retry = !recoveringRenderer;[\s\S]*if \(retry\) connect\(null\);\s*else showError/);
  assert.match(handler,/blobDownloads\.rendererGone\(\)/);
  assert.match(java('BlobDownloads'),/void rendererGone\(\)\s*\{\s*cancel\(false\)/);
});
test('photo decoding has its own executor and the shell declares haptic feedback',()=>{
  const activity=java('MainActivity');
  assert.match(activity,/pickedImages\.execute\([\s\S]*normalizePickedImageUri/);
  assert.match(activity,/pickedImages\.shutdown\(\)/);
  assert.match(fs.readFileSync(path.join(src,'AndroidManifest.xml'),'utf8'),/android\.permission\.VIBRATE/);
});
