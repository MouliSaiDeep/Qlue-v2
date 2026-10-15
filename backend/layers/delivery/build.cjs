// SAM makefile layer build: retain only CPU Linux/arm64 native binaries.
const fs=require('node:fs'),path=require('node:path'),{execFileSync}=require('node:child_process'),{createHash}=require('node:crypto');
const target=path.resolve(process.argv[2]||'');
if(!process.argv[2]||target===path.parse(target).root||target===__dirname)throw new Error('A dedicated artifact directory is required');
const modules=path.join(target,'nodejs');fs.mkdirSync(modules,{recursive:true});
for(const name of ['package.json','package-lock.json'])fs.copyFileSync(path.join(__dirname,name),path.join(modules,name));
const npmArgs=['ci','--omit=dev','--ignore-scripts','--no-audit','--no-fund'];
if(process.platform==='win32')execFileSync('cmd.exe',['/d','/c','npm.cmd',...npmArgs],{cwd:modules,stdio:'inherit'});
else execFileSync('npm',npmArgs,{cwd:modules,stdio:'inherit'});
const bin=path.join(modules,'node_modules/onnxruntime-node/bin/napi-v6');
for(const platform of fs.readdirSync(bin)){
 const platformPath=path.join(bin,platform);
 if(platform!=='linux')fs.rmSync(platformPath,{recursive:true,force:true});
 else for(const arch of fs.readdirSync(platformPath))if(arch!=='arm64')fs.rmSync(path.join(platformPath,arch),{recursive:true,force:true});
}
const binding=fs.readFileSync(path.join(bin,'linux/arm64/onnxruntime_binding.node'));
if(binding.subarray(0,4).toString('hex')!=='7f454c46'||binding.readUInt16LE(18)!==183)throw new Error('Expected AArch64 ELF binding');
const models=path.join(target,'delivery/models');fs.mkdirSync(models,{recursive:true});
const model=fs.readFileSync(path.join(__dirname,'models/silero_vad.onnx'));
if(createHash('sha256').update(model).digest('hex')!=='6b99cbfd39246b6706f98ec13c7c50c6b299181f2474fa05cbc8046acc274396')throw new Error('Silero model hash mismatch');
for(const name of ['silero_vad.onnx','SILERO-LICENSE.txt'])fs.copyFileSync(path.join(__dirname,'models',name),path.join(models,name));
