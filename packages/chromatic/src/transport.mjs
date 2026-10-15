/** Web Serial / WebUSB adapters. Choosers run directly from the user's click. */
export const CONSOLE_FILTER = {usbVendorId: 0x374e, usbProductId: 0x0101};
export const BRIDGE_FILTER = {vendorId: 0x33aa, productId: 0x0120};
export function chooseConsole(nav) {
  if (!nav.serial?.requestPort) throw new Error('Web Serial is unavailable. Open this page in desktop Chrome or Edge.');
  return nav.serial.requestPort({filters: [CONSOLE_FILTER]});
}
export function chooseBridge(nav) {
  if (!nav.usb?.requestDevice) throw new Error('WebUSB is unavailable. Open this page in desktop Chrome or Edge.');
  return nav.usb.requestDevice({filters: [BRIDGE_FILTER]});
}
export async function grantedDevices(nav) {
  const [ports, bridges] = await Promise.all([nav.serial?.getPorts?.() ?? [], nav.usb?.getDevices?.() ?? []]);
  return {ports: ports.filter(p => {if(p.connected===false)return false;const i = p.getInfo(); return i.usbVendorId === CONSOLE_FILTER.usbVendorId && i.usbProductId === CONSOLE_FILTER.usbProductId;}), bridges: bridges.filter(d => d.vendorId === BRIDGE_FILTER.vendorId && d.productId === BRIDGE_FILTER.productId)};
}
// A permission grant can outlive the handle. A delayed open must not leave a hidden owner.
async function openedWithin(open,close,label){
 let expired=false,timer;
 const work=Promise.resolve().then(open).then(async value=>{if(expired){await close().catch(()=>{});throw new Error(label+' opened after its deadline and was released.');}return value;});
 try{return await Promise.race([work,new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;reject(new Error(label+' did not open. Close other Chromatic tabs or device tools, then reconnect here.'));},10000);})]);}finally{clearTimeout(timer);}
}
export async function openBridge(device) {
  if (device.vendorId !== BRIDGE_FILTER.vendorId || device.productId !== BRIDGE_FILTER.productId) throw new Error('Choose the Chromatic GWU2X bridge.');
  await openedWithin(()=>device.open(),()=>device.close(),'USB bridge');
  try {
    if (device.configuration?.configurationValue !== 1) await device.selectConfiguration(1);
    const endpoints = device.configuration.interfaces.find(i => i.interfaceNumber === 0)?.alternate?.endpoints ?? [];
    for (const [number, direction] of [[2, 'out'], [1, 'in'], [3, 'in']]) if (!endpoints.some(e => e.endpointNumber === number && e.direction === direction)) throw new Error('The USB bridge endpoints do not match the published GWU2X interface.');
    await openedWithin(()=>device.claimInterface(0),()=>device.close(),'USB bridge interface');
    return device;
  } catch (e) {await device.close().catch(() => {}); throw e;}
}
export function permissionError(error) {
  if (error?.name === 'NotFoundError') return 'No device selected. Nothing was connected.';
  if (error?.name === 'SecurityError' || error?.name === 'NotAllowedError') return 'Device permission was denied or blocked by this browser. Open this page directly in desktop Chrome or Edge and choose the device.';
  return error?.message || String(error);
}
export function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) {c ^= byte; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ ((c & 1) ? 0xedb88320 : 0);}
  return (c ^ 0xffffffff) >>> 0;
}
/** The device can split a binary frame anywhere, including inside the magic. */
export class DeviceDecoder {
  constructor() {this.bytes = new Uint8Array();}
  push(chunk) {
    const joined = new Uint8Array(this.bytes.length + chunk.length); joined.set(this.bytes); joined.set(chunk, this.bytes.length); this.bytes = joined;
    const events = [];
    while (this.bytes.length) {
      const b = this.bytes; let magic = -1; const nl = b.indexOf(10);
      for (let i = 0; i <= b.length - 4; i++) if (b[i] === 0xa5 && b[i + 1] === 67 && b[i + 2] === 66 && b[i + 3] === 85) {magic = i; break;}
      if (magic >= 0 && (nl < 0 || magic < nl)) {
        if (magic) {this.bytes = b.slice(magic); continue;}
        if (b.length < 11) break;
        const view = new DataView(b.buffer, b.byteOffset, b.byteLength), n = view.getUint16(9, true);
        if (!n || n > 1024) throw new Error('Invalid cartridge frame length.');
        if (b.length < 15 + n) break;
        if (crc32(b.subarray(4, 11 + n)) !== view.getUint32(11 + n, true)) throw new Error('Cartridge frame CRC mismatch. Backup rejected.');
        events.push({kind: 'frame', type: String.fromCharCode(b[4]), offset: view.getUint32(5, true), data: b.slice(11, 11 + n)});
        this.bytes = b.slice(15 + n); continue;
      }
      if (nl < 0) {if (b.length > 16384) throw new Error('Console response exceeded its size limit.'); break;}
      const line = new TextDecoder().decode(b.slice(0, nl)).replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
      this.bytes = b.slice(nl + 1); if (line) events.push({kind: 'line', line});
    }
    return events;
  }
}
const READ_COMMAND = /^(?:fwversion|cwl status|cwl relay status|cart usb (?:status|info|read (?:rom|sav) \d+ \d+(?: skipblank)?))$/;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
export function unsupportedCommand(line) {return /(?:unrecognized|unknown|not found|not registered|unsupported)\s+(?:command|cmd)|command\s+(?:not found|not recognized|unknown)/i.test(line);}
export class ConsoleSession {
  constructor(port, onDisconnect = () => {}) {this.port = port; this.onDisconnect = onDisconnect; this.decoder = new DeviceDecoder(); this.pending = null; this.closed = true; this.reader = null; this.lastRx = 0;}
  async open() {
    const i = this.port.getInfo();
    if (i.usbVendorId !== CONSOLE_FILTER.usbVendorId || i.usbProductId !== CONSOLE_FILTER.usbProductId) throw new Error('Choose the Chromatic console, not another serial device.');
    await openedWithin(()=>this.port.open({baudRate:115200,dataBits:8,stopBits:1,parity:'none',flowControl:'none',bufferSize:65536}),()=>this.port.close(),'Console');
    this.closed = false;
    try {await this.port.setSignals({dataTerminalReady:false}); await this.port.setSignals({requestToSend:false}); await this.port.setSignals({dataTerminalReady:false}); if (!this.port.readable || !this.port.writable) throw new Error('The console has no data stream.'); this.reader = this.port.readable.getReader(); this.pumping = this.pump();}
    catch (e) {await this.close(); throw e;}
    return this;
  }
  async pump() {
    try {
      let breaks = 0;
      while (!this.closed) {
        let item;
        try {item = await this.reader.read();} catch (e) {
          if (!this.closed && /^(Break|Framing|Parity|BufferOverrun)Error$/.test(e.name) && this.port.readable && breaks++ < 20 && (!this.pending || !this.pending.command.startsWith('cart usb read '))) {this.reader.releaseLock(); this.reader = this.port.readable.getReader(); this.decoder = new DeviceDecoder(); continue;}
          throw e;
        }
        if (item.done) break;
        if (!item.value) continue;
        this.lastRx = Date.now();
        for (const event of this.decoder.push(item.value)) {
          const p = this.pending; if (!p) continue;
          if (event.kind === 'line' && unsupportedCommand(event.line)) {p.reject(new Error('This firmware does not support ' + p.command + '.')); continue;}
          const result = p.handle(event); if (result !== undefined) p.resolve(result);
        }
      }
    } catch (e) {this.pending?.reject(e);} finally {
      this.reader?.releaseLock(); this.reader = null;
      if (!this.closed) {this.closed = true; this.pending?.reject(new Error('Chromatic disconnected. No operation was verified.')); try {await this.port.close();} catch {} this.onDisconnect();}
    }
  }
  send(text) {
    const write = async () => {if (this.closed) throw new Error('Connect the console first.'); const writer = this.port.writable.getWriter(); try {await writer.write(new TextEncoder().encode(text));} finally {writer.releaseLock();}};
    // A device can answer before the OS write promise settles. Serialize writes even
    // when the next request starts immediately after that response.
    this.sending = (this.sending ?? Promise.resolve()).then(write); return this.sending;
  }
  request(command, handle, {timeout = 8000} = {}) {
    if (!READ_COMMAND.test(command)) throw new Error('This adapter only permits documented read commands.');
    if (this.closed) throw new Error('Connect the console first.');
    if (this.pending) throw new Error('Another console operation is running.');
    return new Promise((resolve, reject) => {
      let timer,retry; const job = {command, handle, resolve: v => finish(resolve, v), reject: e => finish(reject, e)};
      const finish = (fn, value) => {clearTimeout(timer); clearInterval(retry); if (this.pending === job) this.pending = null; fn(value);};
      this.pending = job;
      timer = setTimeout(() => {job.reject(new Error('The Chromatic did not complete the command. Reconnect before trying again.')); void this.close();}, timeout);
      // The console sleeps. Wake before every command; do not toggle reset/boot pins.
      const sendRequest=async () => {if(this.pending!==job)return;await this.send('\r\n'); await delay(150); if (this.pending !== job) return; await this.send('\r\n'); await delay(50); if (this.pending !== job) return; await this.send(command + '\r\n');};
      const send=()=>void sendRequest().catch(e=>{job.reject(e);void this.close();});send();
      // USB open can restart the MCU. These two status queries are idempotent and
      // may arrive before its console registers commands. Re-wake within one deadline.
      if(command==='fwversion'||command==='cart usb status')retry=setInterval(send,1500);
    });
  }
  async json(command, required, allowed = required) {
    return this.request(command, event => {
      if (event.kind !== 'line') return;
      const start = event.line.indexOf('{'), end = event.line.lastIndexOf('}'); if (start < 0 || end < start) return;
      let value; try {value = JSON.parse(event.line.slice(start, end + 1));} catch {return;}
      if (!required.every(k => Object.hasOwn(value, k))) return;
      // Never expose or retain pairing tickets, passwords, MACs, or raw responses.
      return Object.fromEntries(allowed.filter(k => ['string', 'number', 'boolean'].includes(typeof value[k])).map(k => [k, typeof value[k] === 'string' ? value[k].slice(0, 128) : value[k]]));
    });
  }
  async close() {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      const wasOpen = !this.closed; this.closed = true; this.pending?.reject(new Error('Console closed.'));
      // Give received bytes a brief quiet period before canceling the OS stream.
      const end = Date.now() + 1000; while (Date.now() - this.lastRx < 100 && Date.now() < end) await delay(50);
      try {await this.reader?.cancel(); await this.pumping;} catch {}
      try {await this.port.close();} catch {} if (wasOpen) this.onDisconnect();
    })(); return this.closing;
  }
}
export async function readHealth(session) {
  const versions = await session.json('fwversion', ['mcu', 'fpga'], ['mcu', 'fpga', 'chromatic']);
  let network = null, relay = null, networkError = null;
  try {network = await session.json('cwl status', ['enabled', 'wifi', 'ip', 'status'], ['enabled', 'power', 'status', 'ssid', 'wifi', 'ip']); relay = await session.json('cwl relay status', ['text', 'state'], ['text', 'state', 'partner', 'path']);}
  catch (e) {networkError = e.message;}
  return {versions, network, relay, networkError, observedAt: new Date().toISOString()};
}
