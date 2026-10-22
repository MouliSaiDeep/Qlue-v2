import { GetVocabularyCommand } from '@aws-sdk/client-transcribe';
// Deployment supplies a public, versioned topic/language manifest, never PII.
export class Vocabularies {
  constructor(client,manifest={},now=()=>Date.now()){Object.assign(this,{client,manifest,now});this.cache=new Map();}
  async choose(topic,language){
    const name=this.manifest[`${topic}:${language}`];
    if(!name)return {requested:null,applied:false,reason:'BASELINE_NO_VOCABULARY'};
    if(!/^qlue-public-[a-zA-Z0-9._-]{1,160}$/.test(name))throw Error('INVALID_VOCABULARY_MANIFEST');
    const cached=this.cache.get(name);
    const result=cached&&cached.until>this.now()?cached.value:await this.client.send(new GetVocabularyCommand({VocabularyName:name}));
    this.cache.set(name,{value:result,until:this.now()+60000});
    if(result.VocabularyState!=='READY'||result.LanguageCode!==language)throw Error('VOCABULARY_NOT_READY_OR_LANGUAGE_MISMATCH');
    return {requested:name,applied:true,language,region:'us-east-1'};
  }
}
