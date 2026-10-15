export interface SerialPort extends EventTarget {getInfo():{usbVendorId?:number;usbProductId?:number};open(options:object):Promise<void>;setSignals(signals:object):Promise<void>;close():Promise<void>;readable:ReadableStream<Uint8Array>;writable:WritableStream<Uint8Array>}
export interface UsbDevice {vendorId:number;productId:number;productName?:string;opened:boolean;configuration:{configurationValue:number;interfaces:{interfaceNumber:number;alternate:{endpoints:{endpointNumber:number;direction:string}[]}}[]}|null;open():Promise<void>;close():Promise<void>;selectConfiguration(n:number):Promise<void>;claimInterface(n:number):Promise<void>;transferOut(n:number,bytes:Uint8Array):Promise<{status:string;bytesWritten:number}>;transferIn(n:number,size:number):Promise<{status:string;data?:DataView}>}
export interface BrowserDevices {serial?:EventTarget&{requestPort(options:object):Promise<SerialPort>;getPorts():Promise<SerialPort[]>};usb?:EventTarget&{requestDevice(options:object):Promise<UsbDevice>;getDevices():Promise<UsbDevice[]>}}
export interface ConsoleLine {kind:'line';line:string}
export interface ConsoleFrame {kind:'frame';type:string;offset:number;data:Uint8Array}
export type DeviceEvent=ConsoleLine|ConsoleFrame;
export const CONSOLE_FILTER:{usbVendorId:number;usbProductId:number};
export const BRIDGE_FILTER:{vendorId:number;productId:number};
export function chooseConsole(nav:BrowserDevices):Promise<SerialPort>;
export function chooseBridge(nav:BrowserDevices):Promise<UsbDevice>;
export function grantedDevices(nav:BrowserDevices):Promise<{ports:SerialPort[];bridges:UsbDevice[]}>;
export function openBridge(device:UsbDevice):Promise<UsbDevice>;
export function permissionError(error:unknown):string;
export function crc32(bytes:Uint8Array):number;
export function unsupportedCommand(line:string):boolean;
export class DeviceDecoder {push(chunk:Uint8Array):DeviceEvent[]}
export type Report=Record<string,string|number|boolean>;
export interface Health {versions:Report;network:Report|null;relay:Report|null;networkError:string|null;observedAt:string}
export class ConsoleSession {
 port:SerialPort;closed:boolean;
 constructor(port:SerialPort,onDisconnect?:()=>void);
 open():Promise<this>;close():Promise<void>;
 request<T>(command:string,handler:(event:DeviceEvent)=>T|undefined,options?:{timeout?:number}):Promise<T>;
 json(command:string,required:string[],allowed?:string[]):Promise<Report>;
}
export function readHealth(session:ConsoleSession):Promise<Health>;
