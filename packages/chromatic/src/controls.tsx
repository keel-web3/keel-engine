import type { ButtonHTMLAttributes, ReactNode } from 'react';

/** Uses the site's package-action theme: same hit area, cursor, focus and hover as Play. */
export function ActionButton({primary=false,className='',type='button',...props}:ButtonHTMLAttributes<HTMLButtonElement>&{primary?:boolean}) {
  return <button type={type} className={`package-action ${primary?'primary':''} ${className}`} {...props}/>;
}

/** Native radios retain arrow-key navigation; labels use the site's existing button skin. */
export function ChoiceGroup({name,label,value,options,onChange,disabled=false}:{name:string;label:string;value:string;options:{value:string;label:ReactNode}[];onChange:(value:string)=>void;disabled?:boolean}) {
  return <fieldset className="chromatic-choices" disabled={disabled}><legend>{label}</legend><div className="chromatic-options">{options.map(option=><label className={`package-action ${value===option.value?'primary':''}`} key={option.value}><input type="radio" name={name} value={option.value} checked={value===option.value} onChange={()=>onChange(option.value)}/><span>{option.label}</span></label>)}</div></fieldset>;
}
