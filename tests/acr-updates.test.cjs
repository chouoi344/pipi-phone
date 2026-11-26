// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {createHash}=require('node:crypto');
const {getRelease,ACR_REPOSITORY}=require('../lib/updates.cjs');
const repository='chouoi344/pipi-phone';
const indexUrl='https://'+ACR_REPOSITORY.split('/')[0]+'/v2/'+repository+'/manifests/';
const authUrl='https://dockerauth.cn-hangzhou.aliyuncs.com/auth';
const mediaType='application/vnd.oci.image.manifest.v1+json';
const scope='repository:'+repository+':pull';
const challenge='Bearer realm="'+authUrl+'",service="registry.aliyuncs.com:cn-hangzhou:26842",scope="'+scope+'"';
const platformDigests={amd64:'sha256:'+'a'.repeat(64),arm64:'sha256:'+'b'.repeat(64)};
const index={schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:Object.entries(platformDigests).map(([architecture,digest])=>({mediaType,digest,platform:{os:'linux',architecture}}))};
const rawIndex=Buffer.from(JSON.stringify(index,null,2)+'\n');
const canonicalImage=raw=>'ghcr.io/'+repository+'@sha256:'+createHash('sha256').update(raw).digest('hex');
const image=canonicalImage(rawIndex);
const record={version:'0.13.25',image,publishedAt:'2026-11-25T00:00:00Z',notes:'国内更新'};
const fixedUrl=indexUrl+'channel-v'+record.version;

function manifest(value=record,sourceIndex=rawIndex.toString('base64')){
  return Response.json({schemaVersion:2,mediaType,annotations:{'io.pipi-phone.release':JSON.stringify(value),'io.pipi-phone.source-index':sourceIndex}});
}

test('ACR discovers from latest, verifies the fixed record and only sends the pull token to the repository',async()=>{
  const requests=[];
  const release=await getRelease({repository,fetchImpl:async(url,options)=>{
    requests.push(url);
    assert.equal(options.redirect,'manual');
    if(url.startsWith(authUrl+'?')){
      assert.equal(new URL(url).searchParams.get('scope'),scope);
      assert.equal(options.headers.Authorization,undefined);
      return Response.json({token:'local-test-token'});
    }
    if(!options.headers.Authorization)return new Response(null,{status:401,headers:{'www-authenticate':challenge}});
    assert.equal(options.headers.Authorization,'Bearer local-test-token');
    return manifest();
  }});
  assert.deepEqual(requests.map(x=>x.split('?')[0]),[indexUrl+'channel-latest',authUrl,indexUrl+'channel-latest',fixedUrl]);
  assert.equal(release.version,record.version);
  assert.equal(release.image,image);
  assert.deepEqual(release.platformDigests,platformDigests);
});

test('ACR confirmation reads only the chosen immutable version and rejects changed digests',async()=>{
  let calls=0;
  const query={repository,version:record.version,fetchImpl:async url=>{
    ++calls;assert.equal(url,fixedUrl);return manifest();
  }};
  assert.equal((await getRelease({...query,expectedImage:image})).image,image);
  await assert.rejects(getRelease({...query,expectedImage:canonicalImage(Buffer.from('changed'))}),{code:'UPDATE_CHANGED'});
  assert.equal(calls,2);
});

test('malformed ACR records, changed latest pin, and unexpected token authorities cannot downgrade to another source',async()=>{
  for(const response of [
    ()=>manifest({...record,image:'evil.test/'+repository+'@sha256:'+'a'.repeat(64)}),
    ()=>manifest({...record,version:'0.1.0-beta'}),
    ()=>Response.json({schemaVersion:2,mediaType,annotations:{'io.pipi-phone.release':'broken'}}),
    ()=>new Response(null,{status:401,headers:{'www-authenticate':challenge.replace(authUrl,'https://other.example/auth')}}),
    ()=>new Response(null,{status:401,headers:{'www-authenticate':challenge.replace(':pull"',':push"')}})
  ]){
    const calls=[];
    await assert.rejects(getRelease({repository,fetchImpl:async url=>{calls.push(url);return response();}}),{code:'UPDATE_INVALID_FEED'});
    assert.deepEqual(calls,[indexUrl+'channel-latest']);
  }
  const changed=Buffer.concat([rawIndex,Buffer.from(' ')]);
  await assert.rejects(getRelease({repository,fetchImpl:async url=>url===fixedUrl?manifest({...record,image:canonicalImage(changed)},changed.toString('base64')):manifest()}),{code:'UPDATE_CHANGED'});
  await assert.rejects(getRelease({repository,fetchImpl:async url=>url===fixedUrl?new Response(null,{status:404}):manifest()}),{code:'UPDATE_INVALID_FEED'});
});

test('ACR verifies exact original index bytes, requires one valid image descriptor per supported Linux platform',async()=>{
  const cases=[
    [record,Buffer.from(JSON.stringify(index)).toString('base64')],
    [record,rawIndex.toString('base64')+'!'],
    [record,'x'.repeat(65537)],
    ...[
      null,
      {...index,mediaType},
      {...index,manifests:index.manifests.slice(0,1)},
      {...index,manifests:[...index.manifests,index.manifests[0]]},
      {...index,manifests:[index.manifests[0],{...index.manifests[1],digest:'sha256:bad'}]}
    ].map(value=>{
      const raw=Buffer.from(JSON.stringify(value));
      return [{...record,image:canonicalImage(raw)},raw.toString('base64')];
    })
  ];
  for(const [candidate,encoded] of cases){
    const calls=[];
    await assert.rejects(getRelease({repository,version:record.version,fetchImpl:async url=>{calls.push(url);return manifest(candidate,encoded);}}),{code:'UPDATE_INVALID_FEED'});
    assert.deepEqual(calls,[fixedUrl]);
  }
});

test('old releases and unreachable ACR use the existing GitHub version channel and attachment verification',async()=>{
  for(const offline of [false,true]){
    const requests=[];
    const release=await getRelease({repository,version:record.version,expectedImage:image,fetchImpl:async url=>{
      requests.push(url);
      if(url===fixedUrl){
        if(offline)throw new TypeError('fetch failed');
        return new Response(null,{status:404});
      }
      return Response.json(url.startsWith('https://raw.')?record:{version:record.version,image});
    }});
    assert.equal(release.image,image);
    assert.deepEqual(requests,[fixedUrl,'https://raw.githubusercontent.com/'+repository+'/update-channel/versions/v'+record.version+'.json','https://github.com/'+repository+'/releases/download/v'+record.version+'/update.json']);
  }
});
