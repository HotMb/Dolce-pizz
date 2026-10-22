// Lets node:test run the TypeScript sources directly: their relative imports omit ".ts" (bundler style).
import {registerHooks} from 'node:module';
registerHooks({resolve(specifier,context,next){
 try{return next(specifier,context);}
 catch(error){if(error?.code==='ERR_MODULE_NOT_FOUND'&&/^\.{1,2}\//.test(specifier))return next(`${specifier}.ts`,context);throw error;}
}});
