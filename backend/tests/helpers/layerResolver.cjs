const fs=require('fs'),path=require('path');
const root=process.env.QLUE_TEST_BUILD_ROOT?path.resolve(process.env.QLUE_TEST_BUILD_ROOT):path.resolve(__dirname,'../../.aws-sam/build');
const layer=path.join(root,'AppDependenciesLayer/nodejs');
const delivery=path.join(root,'DeliveryRuntimeLayer/nodejs');
module.exports=(request,options)=>{
 if(!request.startsWith('.')&&!path.isAbsolute(request)&&!request.startsWith('node:')) {
   const name=request.startsWith('@')?request.split('/').slice(0,2).join('/'):request.split('/')[0];
   if(fs.existsSync(path.join(layer,'node_modules',name,'package.json')))return options.defaultResolver(request,{...options,basedir:layer});
   if(fs.existsSync(path.join(delivery,'node_modules',name,'package.json'))) {
     if(name==='onnxruntime-node'&&process.arch!=='arm64') {
       // ARM64 ELF cannot load on a Windows/x64 test host. Use the same pinned
       // host binding for logic tests; native CI/smoke exercises shipped ELF.
       const shipped=JSON.parse(fs.readFileSync(path.join(delivery,'node_modules',name,'package.json')));
       const host=options.defaultResolver(name+'/package.json',options);
       if(JSON.parse(fs.readFileSync(host)).version!==shipped.version)throw Error('Host/native runtime version drift');
       return options.defaultResolver(request,options);
     }
     return options.defaultResolver(request,{...options,basedir:delivery});
   }
 }
 return options.defaultResolver(request,options);
};
