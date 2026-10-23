/* KEEL pinball kernel v1. C17, freestanding wasm32, integer-only state.
 * One ball, <=128 rails/32 bumpers/8 rotating capsules. Coordinates Q10.
 * Conservative fixed subdivisions: ball <=24 units/tick, capsule tip <=20;
 * 64 substeps bound relative travel; swept closest-approach/entry checks
 * catch endpoint grazing between them. Moving capsule swept envelopes are
 * conservative, including a two-quantum rotational arc allowance.
 */
#include <stdint.h>
#include "trig.h"
#define Q 1024
#define SUB 64
#define MAXV (24*Q)
#define MAXC 168
#define EXPORT __attribute__((visibility("default")))
typedef struct { int type,ax,ay,bx,by,radius,bounce,kick,layer,owner,side,rest,active,length; } Collider;
typedef struct { int tick,x,y,vx,vy,active,owner,layer,remx,remy,angles[8],cooldown[MAXC],eventCount,events[64],budget; } State;
static Collider colliders[MAXC]; static int nc,nf,gravity,ballRadius,drainY; static State state;
static int abs32(int n){return n<0?-n:n;}
static int clamp(int x,int a,int b){return x<a?a:x>b?b:x;}
static int clamp64(int64_t x,int a,int b){return x<a?a:x>b?b:(int)x;}
static int fraction(int64_t value,int64_t length){return value<=0?0:value>=length?65536:(int)(value*65536/length);}
static int64_t dot(int x,int y,int a,int b){return (int64_t)x*a+(int64_t)y*b;}
static uint64_t isqrt(uint64_t n){uint64_t r=0,b=(uint64_t)1<<62;while(b>n)b>>=2;while(b){if(n>=r+b){n-=r+b;r=(r>>1)+b;}else r>>=1;b>>=2;}return r;}
static int sinq(int angle){angle%=3600;if(angle<0)angle+=3600;return trig[angle];}
static int cosq(int angle){return sinq(angle+900);}
static int mul(int a,int b){return (int)((int64_t)a*b/Q);}
static void limit(void){int speed=(int)isqrt(dot(state.vx,state.vy,state.vx,state.vy));if(speed>MAXV){state.vx=(int)((int64_t)state.vx*MAXV/speed);state.vy=(int)((int64_t)state.vy*MAXV/speed);}}
EXPORT int state_ptr(void){return (int)(uintptr_t)&state;}
EXPORT int state_size(void){return sizeof(State);}
EXPORT void init(int g,int radius,int drain){nc=0;nf=0;gravity=g;ballRadius=radius;drainY=drain;int *p=(int*)&state;for(unsigned i=0;i<sizeof(State)/4;i++)p[i]=0;for(int i=0;i<MAXC;i++)state.cooldown[i]=-100;}
EXPORT void rail(int ax,int ay,int bx,int by,int bounce,int layer){colliders[nc++]=(Collider){.type=0,.ax=ax,.ay=ay,.bx=bx,.by=by,.bounce=bounce,.layer=layer};}
EXPORT void bumper(int x,int y,int radius,int kick,int layer){colliders[nc++]=(Collider){.type=1,.ax=x,.ay=y,.bx=x,.by=y,.radius=radius,.bounce=Q,.kick=kick,.layer=layer};}
EXPORT void flipper(int x,int y,int length,int radius,int rest,int active,int side,int owner,int layer){colliders[nc++]=(Collider){.type=2,.ax=x,.ay=y,.radius=radius,.bounce=850,.layer=layer,.owner=owner,.side=side,.rest=rest,.active=active,.length=length};state.angles[nf++]=rest;}
EXPORT void ball(int x,int y,int vx,int vy,int active,int owner,int layer){state.x=x;state.y=y;state.vx=vx;state.vy=vy;state.active=active;state.owner=owner;state.layer=layer;state.remx=state.remy=0;limit();}
static void event(int i){if(state.tick-state.cooldown[i]>=12){state.cooldown[i]=state.tick;if(state.eventCount<64)state.events[state.eventCount++]=i;}}
/* Returns penetrating contact. A separating ball is projected out without
 * receiving an artificial second impact. Surface velocity is from actual
 * capsule motion at its closest point, allowing catches on a held flipper. */
static int collide(int index,int ax,int ay,int bx,int by,int extra,int svx,int svy){
 Collider *c=&colliders[index];if(c->layer!=state.layer)return 0;
 int dx=bx-ax,dy=by-ay;int64_t ll=dot(dx,dy,dx,dy);
 int t=ll?fraction(dot(state.x-ax,state.y-ay,dx,dy),ll):0;
 int cx=ax+(int)((int64_t)dx*t/65536),cy=ay+(int)((int64_t)dy*t/65536),nx=state.x-cx,ny=state.y-cy;
 int radius=ballRadius+c->radius+extra,dist=(int)isqrt(dot(nx,ny,nx,ny));if(dist>=radius)return 0;
 if(dist==0){nx=-dy;ny=dx;dist=(int)isqrt(dot(nx,ny,nx,ny));if(!dist){nx=0;ny=-Q;dist=Q;}}
 nx=(int)((int64_t)nx*Q/dist);ny=(int)((int64_t)ny*Q/dist);
 state.x=cx+mul(nx,radius+radius/256+2);state.y=cy+mul(ny,radius+radius/256+2);
 int ux=(int)((int64_t)svx*t/65536),uy=(int)((int64_t)svy*t/65536);int normal=(int)(dot(state.vx-ux,state.vy-uy,nx,ny)/Q);
 if(normal<0){int impulse=mul(-normal,Q+c->bounce);if(c->type==1)impulse+=c->kick;
 state.vx+=mul(nx,impulse);state.vy+=mul(ny,impulse);limit();event(index);}
 return 1;
}
/* Swept closest approach, including endpoint grazing entirely between samples.
 * Candidates are both path endpoints, projections of both shape endpoints,
 * and line intersection. Q16 path fraction, widened products throughout. */
static int sweep(int x,int y,int ex,int ey,int ax,int ay,int bx,int by,int radius){
 int dx=ex-x,dy=ey-y,sx=bx-ax,sy=by-ay;int64_t ll=dot(dx,dy,dx,dy),sl=dot(sx,sy,sx,sy);int ts[5]={0,65536,0,0,0};
 if(ll){ts[2]=fraction(dot(ax-x,ay-y,dx,dy),ll);ts[3]=fraction(dot(bx-x,by-y,dx,dy),ll);}
 int64_t cross=(int64_t)dx*sy-(int64_t)dy*sx;
 if(cross){int64_t t=((int64_t)(ax-x)*sy-(int64_t)(ay-y)*sx)*65536/cross;int64_t u=((int64_t)(ax-x)*dy-(int64_t)(ay-y)*dx)*65536/cross;if(t>=0&&t<=65536&&u>=0&&u<=65536)ts[4]=(int)t;}
 int best=-1;
 for(int i=0;i<5;i++){int t=ts[i],px=x+(int)((int64_t)dx*t/65536),py=y+(int)((int64_t)dy*t/65536);int u=sl?fraction(dot(px-ax,py-ay,sx,sy),sl):0;int nx=px-ax-(int)((int64_t)sx*u/65536),ny=py-ay-(int)((int64_t)sy*u/65536);if(dot(nx,ny,nx,ny)<(int64_t)radius*radius&&(best<0||t<best))best=t;}
 if(best>=0){int lo=0,hi=best;for(int i=0;i<16&&lo<hi;i++){int t=(lo+hi)/2,px=x+(int)((int64_t)dx*t/65536),py=y+(int)((int64_t)dy*t/65536);int u=sl?fraction(dot(px-ax,py-ay,sx,sy),sl):0;int nx=px-ax-(int)((int64_t)sx*u/65536),ny=py-ay-(int)((int64_t)sy*u/65536);if(dot(nx,ny,nx,ny)<(int64_t)radius*radius)hi=t;else lo=t+1;}best=hi;}
 return best;
}
EXPORT void step(int input){
 state.tick++;state.eventCount=0;state.budget=0;for(int i=0;i<64;i++)state.events[i]=0;
 int old[8],next[8],fi=0;
 for(int i=0;i<nc;i++)if(colliders[i].type==2){Collider*c=&colliders[i];old[fi]=state.angles[fi];int held=(input&c->side)&&c->owner==state.owner;int target=held?c->active:c->rest;int speed=held?70:45;next[fi]=old[fi]+clamp(target-old[fi],-speed,speed);fi++;}
 if(state.active){state.vy+=gravity;limit();
 for(int sub=1;sub<=SUB;sub++){
  int safeX=state.x,safeY=state.y;
  state.remx+=state.vx;state.remy+=state.vy;state.x+=state.remx/SUB;state.y+=state.remy/SUB;state.remx%=SUB;state.remy%=SUB;
  int contacts=0;
  for(int pass=0;pass<8;pass++){
   contacts=0;fi=0;
   for(int i=0;i<nc;i++){Collider*c=&colliders[i];int bx=c->bx,by=c->by,obx=bx,oby=by,svx=0,svy=0;
    if(c->type==2){int a=old[fi]+(next[fi]-old[fi])*sub/SUB;int pa=old[fi]+(next[fi]-old[fi])*(sub-1)/SUB;bx=c->ax+mul(cosq(a),c->length);by=c->ay+mul(sinq(a),c->length);svx=(mul(cosq(a),c->length)-mul(cosq(pa),c->length))*SUB;svy=(mul(sinq(a),c->length)-mul(sinq(pa),c->length))*SUB;obx=bx-svx/SUB;oby=by-svy/SUB;fi++;}
    int hit=collide(i,c->ax,c->ay,bx,by,0,svx,svy);
    if(!hit&&pass==0&&c->layer==state.layer){
     int radius=ballRadius+c->radius+(c->type==2?2:0);int best=sweep(safeX,safeY,state.x,state.y,c->ax,c->ay,bx,by,radius),sax=c->ax,say=c->ay,sbx=bx,sby=by;
     if(c->type==2){int t=sweep(safeX,safeY,state.x,state.y,c->ax,c->ay,obx,oby,radius);if(t>=0&&(best<0||t<best)){best=t;sbx=obx;sby=oby;}t=sweep(safeX,safeY,state.x,state.y,obx,oby,bx,by,radius);if(t>=0&&(best<0||t<best)){best=t;sax=obx;say=oby;sbx=bx;sby=by;}}
     if(best>=0){int endX=state.x,endY=state.y;state.x=safeX+(int)((int64_t)(state.x-safeX)*best/65536);state.y=safeY+(int)((int64_t)(state.y-safeY)*best/65536);hit=collide(i,sax,say,sbx,sby,c->type==2?2:0,svx,svy);if(!hit){state.x=endX;state.y=endY;}}
    }
    contacts+=hit;
   }
   if(!contacts)break;
  }
  if(contacts){state.x=safeX;state.y=safeY;state.vx=state.vy=state.remx=state.remy=0;state.budget=1;for(int j=0;j<nf;j++)next[j]=old[j]+(next[j]-old[j])*(sub-1)/SUB;break;}
  if(state.y-ballRadius>drainY){state.active=0;break;}
 }
 }
 for(int i=0;i<nf;i++)state.angles[i]=next[i];
}
EXPORT int tip_x(int index){int fi=0;for(int i=0;i<nc;i++)if(colliders[i].type==2){if(fi==index)return colliders[i].ax+mul(cosq(state.angles[fi]),colliders[i].length);fi++;}return 0;}
EXPORT int tip_y(int index){int fi=0;for(int i=0;i<nc;i++)if(colliders[i].type==2){if(fi==index)return colliders[i].ay+mul(sinq(state.angles[fi]),colliders[i].length);fi++;}return 0;}
