// SPDX-License-Identifier: GPL-3.0-only
// Host adapter for the unmodified Shiny Relay CWL2 core. No networking or firmware writes.
#include "cwl_proto.h"
#include <stdlib.h>
#include <string.h>
typedef struct {uint8_t kind,len,data[6];} Event;
typedef struct {CwlState_t core;Event queue[128];unsigned head,count;int overflow;} Peer;
static void event(Peer*p,int kind,const uint8_t*data,int len){if(p->count==128){p->overflow=1;return;}Event*e=&p->queue[(p->head+p->count++)%128];e->kind=kind;e->len=len;if(len)memcpy(e->data,data,len);}
static void send(void*ctx,const uint8_t*b){event(ctx,1,b,6);}
static void reply(void*ctx,uint8_t b){event(ctx,2,&b,1);}
static void offer(void*ctx,uint8_t b){event(ctx,3,&b,1);}
static void drop(void*ctx){event(ctx,4,NULL,0);}
static void withdraw(void*ctx){event(ctx,5,NULL,0);}
Peer* peer_new(unsigned session,unsigned now){Peer*p=calloc(1,sizeof(*p));if(!p)return NULL;CwlHost_t h={.ctx=p,.send=send,.master_reply=reply,.slave_offer=offer,.master_dropped=drop,.slave_withdraw=withdraw};Cwl_Init(&p->core,&h,now);Cwl_SetSession(&p->core,session);Cwl_SetStandingOffers(&p->core,true);return p;}
void peer_free(Peer*p){free(p);}
void peer_poll(Peer*p,unsigned now){Cwl_Poll(&p->core,now);}
int peer_receive(Peer*p,const uint8_t*b,unsigned n,unsigned now){return Cwl_OnPacket(&p->core,b,n,now);}
void peer_arm(Peer*p,unsigned now){Cwl_OnLocalArmed(&p->core,now);}
void peer_disarm(Peer*p,unsigned now){Cwl_OnLocalDisarm(&p->core,now);}
void peer_master(Peer*p,unsigned b,unsigned now){Cwl_OnLocalMaster(&p->core,b,now);}
void peer_result(Peer*p,int done,unsigned sent,unsigned now){Cwl_OnLocalSlaveResult(&p->core,done,sent,now);}
void peer_abandon(Peer*p,unsigned now){Cwl_OnLocalMasterAbandon(&p->core,now);}
int peer_alive(Peer*p,unsigned now){return Cwl_PeerAlive(&p->core,now);}
Event* peer_event(Peer*p){return p->count?&p->queue[p->head]:NULL;}
void peer_pop(Peer*p){if(p->count){p->count--;p->head=(p->head+1)%128;}}
int peer_overflow(Peer*p){return p->overflow;}
