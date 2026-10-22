import test from 'node:test';
import assert from 'node:assert/strict';
import {Vocabularies} from '../src/vocabulary.mjs';

test('unconfigured vocabulary is an explicit baseline without a cloud lookup',async()=>{
  const v=new Vocabularies({send:async()=>{throw Error('unexpected lookup');}});
  assert.deepEqual(await v.choose('general','en-IN'),{requested:null,applied:false,reason:'BASELINE_NO_VOCABULARY'});
});
test('versioned public vocabulary is used only after READY and language verification, with bounded caching',async()=>{
  let calls=0,now=0;
  const v=new Vocabularies({send:async()=>{calls++;return {VocabularyState:'READY',LanguageCode:'en-IN'};}},
    {'technical:en-IN':'qlue-public-technical-en-IN-v1'},()=>now);
  assert.equal((await v.choose('technical','en-IN')).applied,true);
  await v.choose('technical','en-IN');assert.equal(calls,1);
  now=60001;await v.choose('technical','en-IN');assert.equal(calls,2);
});
test('configured unavailable, wrong-language and private-name vocabularies fail explicitly',async()=>{
  for(const state of [{VocabularyState:'PENDING',LanguageCode:'en-IN'},{VocabularyState:'READY',LanguageCode:'en-US'}]){
    const v=new Vocabularies({send:async()=>state},{'technical:en-IN':'qlue-public-technical-en-IN-v1'});
    await assert.rejects(()=>v.choose('technical','en-IN'),/NOT_READY_OR_LANGUAGE_MISMATCH/);
  }
  const v=new Vocabularies({send:async()=>{throw Error('unexpected lookup');}},{'technical:en-IN':'candidate-private-vocabulary'});
  await assert.rejects(()=>v.choose('technical','en-IN'),/INVALID_VOCABULARY_MANIFEST/);
});
