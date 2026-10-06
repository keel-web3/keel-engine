import {createHash} from 'node:crypto';
import {dirname,relative,resolve} from 'node:path';

// Optional shared copies of exact esbuild CJS helpers. Unmatched compiler versions
// retain their own declarations; import/export getter behavior is unchanged.
const CJS_HELPERS="var __defProp = Object.defineProperty;\nvar __getOwnPropDesc = Object.getOwnPropertyDescriptor;\nvar __getOwnPropNames = Object.getOwnPropertyNames;\nvar __hasOwnProp = Object.prototype.hasOwnProperty;\nvar __export = (target, all) => {\n  for (var name in all)\n    __defProp(target, name, { get: all[name], enumerable: true });\n};\nvar __copyProps = (to, from, except, desc) => {\n  if (from && typeof from === \"object\" || typeof from === \"function\") {\n    for (let key of __getOwnPropNames(from))\n      if (!__hasOwnProp.call(to, key) && key !== except)\n        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });\n  }\n  return to;\n};\nvar __toCommonJS = (mod) => __copyProps(__defProp({}, \"__esModule\", { value: true }), mod);";
const CJS_NAMES=["__defProp","__getOwnPropDesc","__getOwnPropNames","__hasOwnProp","__export","__copyProps","__toCommonJS"];

const hash = value => createHash('sha256').update(value).digest('hex');

// Verified resources register static factories. Only the final bootstrap executes
// them, so CommonJS's getter exports retain ESM live bindings across resources.
export function createStaticModuleRuntime(namespace='__KEEL_STATIC_MODULES__',{sharedHelpers=false}={}) {
  if(!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(namespace))throw Error('Invalid static module namespace');
  const key=JSON.stringify(namespace);
  const helpers=sharedHelpers?CJS_HELPERS+"const helpers=Object.freeze({"+CJS_NAMES.join(",")+"});":"";
  return `(()=>{${helpers}const factories=new Map,cache=new Map;function define(id,factory){if(typeof id!=="string"||typeof factory!=="function"||factories.has(id))throw Error("Duplicate or invalid verified module: "+id);factories.set(id,factory)}function require(id){if(cache.has(id))return cache.get(id).exports;const factory=factories.get(id);if(!factory)throw Error("Missing verified module: "+id);const module={exports:{}};cache.set(id,module);try{factory(require,module,module.exports${sharedHelpers?",helpers":""})}catch(error){cache.delete(id);throw error}return module.exports}if(globalThis[${key}])throw Error("Verified modules already installed");globalThis[${key}]=Object.freeze({define,require})})();`;
}
export const MODULE_RUNTIME=createStaticModuleRuntime();

function sourceIdentity(input, roots, workingDir) {
  if(/^[A-Za-z][A-Za-z0-9_-]*:/.test(input)&&!/^[A-Za-z]:[\\/]/.test(input))return input;
  for(const [name,root] of Object.entries(roots)) {
    const rel=relative(root,resolve(workingDir,input)).replaceAll('\\','/');
    if(rel!==''&&!rel.startsWith('../')&&!rel.startsWith('/'))return `${name}/${rel}`;
  }
  // An outsider is rejected whether esbuild spells it absolute or relative.
  // Register its root explicitly instead of depending on a checkout path.
  throw Error('Unregistered module source root: '+input);
}

/** Iterative graph walk: bounded by nodes and edges, including cycles and deep chains. */
export function collectModuleOutputs(outputs,roots,workingDir) {
  const reachable=new Set(),pending=[...roots].reverse();
  while(pending.length){
    const path=pending.pop();if(reachable.has(path))continue;
    const output=outputs.get(path);if(!output)throw Error('Missing output '+path);
    reachable.add(path);
    for(let index=output.imports.length-1;index>=0;index--){const edge=output.imports[index];if(!edge.external)pending.push(resolve(workingDir,edge.path));}
  }
  return reachable;
}

/** Content independent names + real static factories; never eval or network. */
export async function packageModularOutputs({result,transform,compact,typescript:ts,roots,workingDir,entryIds,rootEntryIds,boundaryIds=new Map(),namespace='__KEEL_STATIC_MODULES__',modulePrefix='keel.shared',publicationGroupBy,sharedHelpers=false}) {
  if(!result.metafile||!result.outputFiles)throw Error('Module build needs metadata and bytes');
  createStaticModuleRuntime(namespace,{sharedHelpers});
  if(!/^[a-z][a-z0-9.-]*$/.test(modulePrefix))throw Error('Invalid module identity prefix');
  const outputs=new Map(Object.entries(result.metafile.outputs).map(([p,o])=>[resolve(workingDir,p),o]));
  const rootsToKeep=[...outputs].filter(([path,output])=>!rootEntryIds||rootEntryIds.includes(entryIds.get(resolve(workingDir,output.entryPoint??'')))).map(([path])=>path);
  const reachable=collectModuleOutputs(outputs,rootsToKeep,workingDir);
  if(!reachable.size)throw Error('No executable root modules');
  const outToId=new Map(),descriptions=new Map(),moduleIds=new Set();
  for(const [path,output] of Object.entries(result.metafile.outputs)) {
    const key=resolve(workingDir,path);
    if(!reachable.has(key))continue;
    // Re-export barrels can have zero body bytes but still identify a distinct
    // linkage chunk; dropping them would collapse unrelated chunks to one id.
    const sources=Object.keys(output.inputs)
      .map(p=>sourceIdentity(p,roots,workingDir)).sort();
    // The explicit entry facade remains its public identity when its body moves
    // into a shared chunk. Other chunks are named by source membership, never bytes.
    const explicit=output.entryPoint&&entryIds.get(resolve(workingDir,output.entryPoint));
    const boundary=Object.keys(output.inputs).filter(p=>output.inputs[p].bytesInOutput>0)
      .map(p=>boundaryIds.get(resolve(workingDir,p))).filter(Boolean).sort();
    const id=explicit??(boundary.length===1?boundary[0]:`${modulePrefix}.${hash(JSON.stringify(sources)).slice(0,16)}`);
    if(moduleIds.has(id))throw Error('Module identity collision: '+id);moduleIds.add(id);
    outToId.set(key,id);descriptions.set(key,{id,sources,output});
  }
  const resources=[];
  for(const file of result.outputFiles) {
    const key=resolve(file.path),description=descriptions.get(key);
    if(!reachable.has(key))continue;
    if(!description)throw Error('Module output metadata missing: '+file.path);
    const {id,output,sources}=description;
    if(output.imports.some(p=>p.kind==='dynamic-import'))throw Error('Dynamic module imports are unsupported');
    const aliases=new Map(output.imports.filter(p=>!p.external).map(p=>{
      const imported=resolve(workingDir,p.path),target=outToId.get(imported);
      if(!target)throw Error('Unresolved emitted module import: '+p.path);
      return [relative(dirname(key),imported).replaceAll('\\','/'),target];
    }));
    const aliasTargets=new Set(aliases.values());
    const external=output.imports.filter(p=>p.external);
    if(external.length)throw Error('Unverified external module imports: '+external.map(p=>p.path).join(', '));
    // Replace esbuild's content-named paths before lowering. Otherwise generated
    // CJS variable names contain those hashes, changing a consumer's minified
    // bytes when only an imported module body changed.
    const emitted=Buffer.from(file.contents).toString('utf8'),esmEdits=[];
    const esm=ts.createSourceFile('verified-module.mjs',emitted,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    for(const node of esm.statements)if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node))&&node.moduleSpecifier) {
      const literal=node.moduleSpecifier;
      if(!ts.isStringLiteral(literal))throw Error('Non-static module specifier');
      const target=aliases.get(literal.text.replace(/^\.\//,''));
      if(!target)throw Error('Undeclared emitted module import: '+literal.text);
      esmEdits.push([literal.getStart(esm),literal.end,JSON.stringify(target)]);
    }
    const loweredInput=applyEdits(emitted,esmEdits);
    const transformed=await transform(loweredInput,{
      format:'cjs',target:'es2022',minify:false,legalComments:'none',charset:'utf8'});
    // Rewrite generated require AST nodes, never matching strings in object
    // data, shaders or text. A non-static require fails closed.
    const dependencies=new Set(),edits=[];
    const tree=ts.createSourceFile('verified-module.js',transformed.code,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
    const visit=node=>{
      if(ts.isCallExpression(node)&&ts.isIdentifier(node.expression)&&node.expression.text==='require') {
        if(node.arguments.length!==1||!ts.isStringLiteral(node.arguments[0]))throw Error('Dynamic module requires are unsupported');
        const literal=node.arguments[0];
        const target=aliasTargets.has(literal.text)?literal.text:undefined;
        if(!target)throw Error('Undeclared module require: '+literal.text);
        dependencies.add(target);edits.push([literal.getStart(tree),literal.end,JSON.stringify(target)]);
      }
      ts.forEachChild(node,visit);
    };
    visit(tree);
    let code=applyEdits(transformed.code,edits);
    const shared=sharedHelpers?shareCommonJsHelpers(code,ts):null;
    if(shared)code=shared.code;
    const bytes=Buffer.from(await compact(`globalThis[${JSON.stringify(namespace)}].define(${JSON.stringify(id)},function(require,module,exports${shared?","+shared.parameter:""}){${code}\n});`));
    resources.push({id,path:`${id}.js`,bytes,dependencies:[...dependencies].sort(),sources,
      exports:output.exports.slice().sort(),sha256:hash(bytes),
      linkageOnly: Object.values(output.inputs).every(input=>input.bytesInOutput === 0)});
  }
  return (publicationGroupBy ? groupModuleResources(resources,publicationGroupBy) : resources).sort((a,b)=>a.id.localeCompare(b.id));
}

/** Hoist only exact generated declarations; never user identifiers or data text. */
export function shareCommonJsHelpers(source,ts) {
 const tree=ts.createSourceFile('module.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const expected=ts.createSourceFile('helpers.js',CJS_HELPERS,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS);
 const canonical=new Map(expected.statements.filter(ts.isVariableStatement).map(n=>[n.declarationList.declarations[0].name.text,n.getText(expected)]));
 const edits=[],names=[];
 for(const node of tree.statements){
  if(ts.isExpressionStatement(node)&&ts.isStringLiteral(node.expression))continue;
  if(!ts.isVariableStatement(node)||node.declarationList.declarations.length!==1)break;
  const name=node.declarationList.declarations[0].name;
  if(!ts.isIdentifier(name)||!canonical.has(name.text))break;
  if(node.getText(tree)!==canonical.get(name.text))break;
  edits.push([node.getStart(tree),node.end,'']);names.push(name.text);
 }
 if(!names.length)return null;
 const identifiers=new Set();function visit(n){if(ts.isIdentifier(n))identifiers.add(n.text);ts.forEachChild(n,visit)}visit(tree);
 let parameter='__keelSharedHelpers';while(identifiers.has(parameter))parameter+='_';
 return {parameter,code:'var '+names.map(n=>n+'='+parameter+'.'+n).join(',')+';'+applyEdits(source,edits)};
}

function applyEdits(source,edits) {
  const chunks=[];let cursor=0;
  for(const [start,end,value] of edits){chunks.push(source.slice(cursor,start),value);cursor=end;}
  chunks.push(source.slice(cursor));return chunks.join('');
}

export function assertModuleRevision(previous,next) {
  const old=new Map(previous.map(r=>[r.id,r])),fresh=new Map(next.map(r=>[r.id,r]));
  if(old.size!==previous.length||fresh.size!==next.length)throw Error('Duplicate module handles');
  if(old.size!==fresh.size||[...old.keys()].some(id=>!fresh.has(id)))throw Error('Module handles changed; requires an explicit compatibility migration');
  const changed=[];
  for(const [id,prior] of old) {
    const current=fresh.get(id);
    if(JSON.stringify(prior.exports)!==JSON.stringify(current.exports)||JSON.stringify(prior.dependencies)!==JSON.stringify(current.dependencies)||JSON.stringify(prior.modules)!==JSON.stringify(current.modules))throw Error('Module interface changed: '+id);
    if(prior.sha256!==current.sha256)changed.push(id);
  }
  return changed;
}

/** Pack explicitly selected publication units, preserving every runtime factory ID and live getter.
 * The caller owns domain/ownership boundaries. Revision granularity is the selected publication unit.
 * Resource dependencies name the verified unit; factory requires keep their original module IDs. */
export function groupModuleResources(resources, groupBy) {
  const ids = new Set(resources.map(r=>r.id));
  if (ids.size !== resources.length) throw Error('Duplicate module handles');
  const groups = new Map(), targets = new Map();
  for (const r of resources) {
    const group = groupBy(r);
    if (group === undefined || group === null) continue;
    if (!/^[a-z][a-z0-9.-]*$/.test(group) || ids.has(group)) throw Error('Invalid linkage group handle: '+group);
    const members = groups.get(group) ?? []; members.push(r); groups.set(group,members); targets.set(r.id,group);
  }
  // Singleton units retain their existing handle and create no bookkeeping.
  for (const [id,members] of groups) if (members.length < 2) { groups.delete(id); targets.delete(members[0].id); }
  const dependenciesOf = (dependencies, self) => [...new Set(dependencies.map(id=>targets.get(id)??id))].filter(id=>id!==self).sort();
  const kept = resources.filter(r=>!targets.has(r.id)).map(r=>({...r,dependencies:dependenciesOf(r.dependencies,r.id)}));
  for (const [id,members] of groups) {
    members.sort((a,b)=>a.id.localeCompare(b.id));
    const bytes = Buffer.concat(members.map(r=>Buffer.concat([r.bytes,Buffer.from('\n')])));
    kept.push({id,path:id+'.js',bytes,sha256:hash(bytes),linkageOnly:members.every(r=>r.linkageOnly),
      sources:[...new Set(members.flatMap(r=>r.sources))].sort(),
      dependencies:dependenciesOf(members.flatMap(r=>r.dependencies),id),
      exports:[],
      modules:members.flatMap(r=>r.modules??[{id:r.id,exports:r.exports}])});
  }
  const keptIds = new Set(kept.map(r=>r.id));
  for (const r of kept) for (const id of r.dependencies) if (!keptIds.has(id)) throw Error('Unknown module dependency: '+id);
  return kept;
}
