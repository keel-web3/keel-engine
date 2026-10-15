import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createPeer,packetValid} from '../src/peer.mjs';
async function pair(t){
 let now=1;const qa=[],qb=[],offers=[],replies=[];let dropAck=false,accept=true;
 const a=await createPeer({session:123,now:()=>now,send:b=>qb.push(b),onMaster:b=>replies.push(b)});
 const b=await createPeer({session:456,now:()=>now,send:b=>{if(!(dropAck&&b[3]===2))qa.push(b);},onOffer:v=>{offers.push(v);if(accept)b.result(true,0x42);},onWithdraw:()=>b.result(false,0)});
 t.after(()=>{a.close();b.close();});
 const pump=()=>{for(let n=0;(qa.length||qb.length)&&n<100;n++){if(qa.length)a.receive(qa.shift());if(qb.length)b.receive(qb.shift());}assert.equal(qa.length+qb.length,0);};
 now=501;a.poll();b.poll();pump();
 return {a,b,offers,replies,pump,advance:n=>{now+=n;a.poll();b.poll();pump();},drop:v=>{dropAck=v;},accept:v=>{accept=v;}};
}
test('canonical peers exchange a byte only after the slave accepts it',async t=>{const p=await pair(t);assert(p.a.alive());assert(p.b.alive());p.b.arm();p.a.master(0x37);p.pump();assert.deepEqual(p.offers,[0x37]);assert.deepEqual(p.replies,[0x42]);});
test('lost ACK retransmits without duplicating the accepted byte',async t=>{const p=await pair(t);p.drop(true);p.b.arm();p.a.master(0x37);p.pump();assert.deepEqual(p.replies,[]);p.drop(false);p.advance(21);assert.deepEqual(p.offers,[0x37]);assert.deepEqual(p.replies,[0x42]);});
test('refused transfer cancels with no accepted exchange',async t=>{const p=await pair(t);p.accept(false);p.a.master(0x37);p.pump();p.advance(251);p.advance(501);assert.deepEqual(p.replies,[255]);});
test('peer liveness expires and closed state cannot be used',async t=>{let now=1;const p=await createPeer({send:()=>{},session:100,now:()=>now});t.after(()=>p.close());p.receive(Uint8Array.of(67,87,2,5,1,1));assert(p.alive());now+=2001;assert(!p.alive());p.close();assert.throws(()=>p.poll(),/closed/);});
test('reject malformed packets and byte arguments',async t=>{const p=await createPeer({send:()=>{},session:100});t.after(()=>p.close());assert(!packetValid(Uint8Array.of(67,87,2,5,1)));assert.throws(()=>p.receive(Uint8Array.of(1)),/Invalid/);assert.throws(()=>p.master(256),/byte/);});
import {createServiceCable} from '../src/service.mjs';
test('native cartridge bytes reach service once; service bytes return on cartridge clock',async t=>{
 let now=501;const q=[],r=[],received=[],replies=[];
 const service=await createServiceCable({session:789,now:()=>now,sendPacket:b=>q.push(b),sendBytes:b=>received.push(...b)});
 const cart=await createPeer({session:987,now:()=>now,send:b=>r.push(b),onMaster:b=>replies.push(b)});t.after(()=>{cart.close();service.close();});
 const pump=()=>{for(let n=0;(q.length||r.length)&&n<100;n++){if(q.length)cart.receive(q.shift());if(r.length)service.receivePacket(r.shift());}};
 now+=501;service.poll();cart.poll();pump();service.setReady(true);service.receiveBytes(Uint8Array.of(0x34,0x56));cart.master(0x12);pump();cart.master(0x78);pump();assert.deepEqual(received,[0x12,0x78]);assert.deepEqual(replies,[0x34,0x56]);
 service.setReady(false);assert.throws(()=>service.receiveBytes(Uint8Array.of(1)),/authenticated/);
});
test('service overflow closes readiness and clears queued bytes',async t=>{const c=await createServiceCable({sendPacket:()=>{},sendBytes:()=>{},capacity:2});t.after(()=>c.close());c.setReady(true);assert.throws(()=>c.receiveBytes(Uint8Array.of(1,2,3)),/buffer/);assert.throws(()=>c.receiveBytes(Uint8Array.of(4)),/authenticated/);});
test('closing from a protocol callback stops draining safely',async()=>{let p;p=await createPeer({send:()=>{},onMaster:()=>p.close()});p.master(1);assert.equal(p.alive(),false);});
