// Bound the actual built production tree, including code and both layers.
const fs=require('node:fs'),path=require('node:path');
const root=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../backend/.aws-sam/build');
const credentials=[];
function bytes(dir){return fs.readdirSync(dir,{withFileTypes:true}).reduce((n,e)=>{
 const p=path.join(dir,e.name);if(e.isDirectory())return n+bytes(p);
 if(/service[-_]account.*\.json$|^\.env$|\.(?:pem|p12|key)$/i.test(e.name))credentials.push(path.relative(root,p));
 if(e.name.endsWith('.json')){try{const value=JSON.parse(fs.readFileSync(p,'utf8'));if(value.type==='service_account'&&value.private_key)credentials.push(path.relative(root,p));}catch{}}
 return n+fs.statSync(p).size;
},0);}
const contract=require('./build-contract.cjs').contract(root);
const development=contract.layers.flatMap(layer=>['jest','sinon','aws-sdk-client-mock','pdf-lib'].filter(name=>fs.existsSync(path.join(layer.directory,'nodejs/node_modules',name))).map(name=>`${layer.name}/${name}`));
const layers=Object.fromEntries(contract.layers.map(layer=>[layer.name,bytes(layer.directory)]));
const functions=contract.functions.map(f=>({name:f.name,bytes:bytes(f.directory),layers:f.layers}));
const maximumCombinedBytes=Math.max(...functions.map(f=>f.bytes+f.layers.reduce((sum,layer)=>sum+layers[layer],0)));
// Leave room below the service's 250 MiB combined extracted-package limit.
const safetyLimit=200*1024*1024;
const report={layers,maximumCombinedBytes,safetyLimit,functions:functions.length,developmentPackages:development,credentialFiles:[...new Set(credentials)]};
console.log(JSON.stringify(report));
if(!functions.length||maximumCombinedBytes>=safetyLimit||development.length||credentials.length)process.exitCode=1;
