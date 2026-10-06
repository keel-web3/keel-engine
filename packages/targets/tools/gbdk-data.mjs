/** GBDK data-only compiler adapter. Leave code and nonliteral tables to C.
 * Convert only the generator's complete, single uint8_t array translation unit.
 * Explicit array sizes include C's implicit zero padding. MBC numbering belongs
 * to the generator; this helper neither selects a mapper nor changes data. */
export function gbdkData(source) {
 const m=/^#pragma bank (\d+)\s*\n#include <gb\/gb\.h>\s*\n(?:BANKREF\((\w+)\)\s*)?const uint8_t (\w+)\[(\d+)\]=\{([\d,\s]*)\};\s*$/.exec(source);
 if(!m)return null;
 const [,bank,bankref,name,length,values]=m,size=Number(length);
 if(bankref&&bankref!==name)return null;
 const bytes=values.trim()?values.split(',').filter(v=>v.trim()).map(Number):[];
 if(!Number.isSafeInteger(size)||size<1||bytes.length>size||bytes.some(v=>!Number.isInteger(v)||v<0||v>255))throw new Error(`invalid byte table ${name}`);
 const data=new Uint8Array(size);data.set(bytes);
 return {name,data,source(binaryPath) {
  // Assembler strings have no portable escape convention; refuse ambiguous paths.
  if(/["\r\n\\]/.test(binaryPath))throw new Error('unsupported binary include path');
  // INCBIN already creates BANKREF's identical __bank_ symbol and function.
  return `#pragma bank ${bank}\n#include <gb/gb.h>\n#include <gbdk/incbin.h>\nINCBIN(${name}, "${binaryPath}")\n`;
 }};
}
