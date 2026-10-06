/** Build-time private names shared across modules. Public properties and literals
 * are never renamed. Consistent names improve dictionary compression. Terser
 * remains responsible for lexical binding, reserved words and collision checks. */
export function createSharedIdentifierMangler() {
 const alphabet='abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ$_0123456789';
 return {get(index){
  if(!Number.isSafeInteger(index)||index<0)throw new RangeError('Invalid private identifier index');
  let name='',base=54;index++;
  do{index--;name+=alphabet[index%base];index=Math.floor(index/base);base=64;}while(index>0);
  return name;
 }};
}
