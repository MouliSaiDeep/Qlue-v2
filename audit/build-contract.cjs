// Resolve every locally attached layer from the canonical SAM contract.
const fs=require('node:fs'),path=require('node:path');
const yaml=require('../backend/node_modules/js-yaml');
function contract(root=path.resolve(__dirname,'../backend/.aws-sam/build')) {
 const raw=fs.readFileSync(path.resolve(__dirname,'../backend/template.yaml'),'utf8');
 const names=[...new Set(raw.match(/![A-Za-z]+/g))];
 const tags=names.flatMap(tag=>['scalar','sequence','mapping'].map(kind=>new yaml.Type(tag,{kind,construct:data=>({[tag.slice(1)]:data})})));
 const schema=yaml.Schema.create(yaml.DEFAULT_SAFE_SCHEMA,tags);
 const source=yaml.load(raw,{schema});
 const refs=value=>!value?[]:Array.isArray(value)?value.flatMap(refs):typeof value==='object'?Object.entries(value).flatMap(([k,v])=>k==='Ref'?[v]:refs(v)):[];
 const resources=source.Resources;
 const functions=Object.entries(resources).filter(([,r])=>['AWS::Serverless::Function','AWS::Lambda::Function'].includes(r.Type)).map(([name,r])=>{
  const layers=[...new Set([...refs(source.Globals?.Function?.Layers),...refs(r.Properties?.Layers)])];
  for(const layer of layers)if(!['AWS::Serverless::LayerVersion','AWS::Lambda::LayerVersion'].includes(resources[layer]?.Type))throw Error('External/unresolved layer: '+layer);
  return {name,layers,directory:path.join(root,name)};
 });
 const layers=[...new Set(functions.flatMap(f=>f.layers))].map(name=>({name,directory:path.join(root,name),source:path.resolve(__dirname,'../backend',resources[name].Properties.ContentUri)}));
 return {root,functions,layers};
}
module.exports={contract};
