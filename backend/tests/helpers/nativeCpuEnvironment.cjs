const {TestEnvironment}=require('jest-environment-node');
// ONNX native bindings return host-realm typed arrays. Use that same realm for
// inference inputs/validation, rather than Jest VM copies of their constructors.
module.exports=class extends TestEnvironment {
 async setup(){await super.setup();this.global.Float32Array=Float32Array;this.global.BigInt64Array=BigInt64Array;}
};
