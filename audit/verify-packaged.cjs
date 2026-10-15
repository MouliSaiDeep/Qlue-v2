const fs=require('node:fs'),path=require('node:path');
const {contract}=require('./build-contract.cjs');
const drift=[],omittedOptional=[],layers=[];
const app=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../backend/layers/dependencies/package.json')));
const backend=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../backend/package.json')));
for(const [name,version]of Object.entries(app.dependencies||{}))if(backend.dependencies?.[name]!==version)drift.push({name,error:'ROOT_LAYER_MANIFEST_DRIFT'});
for(const layer of contract().layers) {
 const manifestPath=path.join(layer.source,'package.json');
 if(!fs.existsSync(manifestPath)){layers.push({name:layer.name,kind:'source',checked:0});continue;}
 const manifest=JSON.parse(fs.readFileSync(manifestPath));
 if(!Object.keys(manifest.dependencies||{}).length&&!fs.existsSync(path.join(layer.source,'package-lock.json'))){
  let checked=0;
  for(const name of fs.readdirSync(layer.source))if(fs.statSync(path.join(layer.source,name)).isFile()){
   const shipped=path.join(layer.directory,'nodejs',name);
   if(!fs.existsSync(shipped)||!fs.readFileSync(shipped).equals(fs.readFileSync(path.join(layer.source,name))))drift.push({layer:layer.name,name,error:'SOURCE_COPY_DRIFT'});
   checked++;
  }
  layers.push({name:layer.name,kind:'source',checked});continue;
 }
 const lock=JSON.parse(fs.readFileSync(path.join(layer.source,'package-lock.json')));
 const directory=path.join(layer.directory,'nodejs');let checked=0;
 for(const [key,entry] of Object.entries(lock.packages)) {
  if(!key||entry.dev)continue;
  const file=path.join(directory,key,'package.json');
  if(!fs.existsSync(file)&&entry.optional){omittedOptional.push(`${layer.name}/${key}`);continue;}
  if(!fs.existsSync(file)){drift.push({layer:layer.name,key,error:'MISSING'});continue;}
  checked++;const installed=JSON.parse(fs.readFileSync(file));
  if(installed.version!==entry.version)drift.push({layer:layer.name,key,expected:entry.version,actual:installed.version});
 }
 for(const [name,version]of Object.entries(manifest.dependencies||{}))if(lock.packages['node_modules/'+name]?.version!==version)drift.push({layer:layer.name,name,error:'MANIFEST_LOCK_DRIFT'});
 layers.push({name:layer.name,kind:'dependencies',checked});
}
console.log(JSON.stringify({layers,omittedOptional,drift},null,2));if(drift.length)process.exitCode=1;
