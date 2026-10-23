/* KEEL shared pinball arena. Retains the Q10/Q16 contact foundation, now one
 * body set with owner actuators, ball interactions and spatial broadphase.
 * Coordinates and velocity are integer Q10; angles integer tenths of degrees. */
#include <stdint.h>
#include "trig.h"
#define Q 1024
#define SUB 16
#define MAXV (18*Q)
#define NB 128
#define NP 100
#define NR 256
#define NC 2048
#define NF 256
#define NE 512
#define CELL (1024*Q)
#define SIDE 64
#define GRID (SIDE*SIDE*4*4)
#define LINKS 32768
#define EXPORT __attribute__((visibility("default")))
typedef struct {int x,y,vx,vy,active,owner,team,arena,layer,radius,remx,remy,budget,lastHit,elevation,rampi,rampExit,rampDirection;} Ball;
typedef struct {int type,ax,ay,bx,by,radius,bounce,kick,layer,arena,owner,side,rest,active,length,fi,enabled,elevation,elevationB;} Collider;
typedef struct {int ax,ay,bx,by,width,from,to,z0,z1,arena,bidirectional;} Ramp;
typedef struct {int type,a,b,collider,energy,x,y,z;} Event;
typedef struct {int tick,nb,nc,nf,eventCount,pairChecks,staticChecks,budget;Ball balls[NB];int angles[NF];Event events[NE];} State;
static State world;
static Collider colliders[NC];
static Ramp ramps[NR];static int nr;
static int heads[GRID],linkNext[LINKS],linkCollider[LINKS],nl;
static int seen[NC],stamp,oldAngle[NF],nextAngle[NF],flipperCollider[NF],held[NP];
static int oldX[NB],oldY[NB],pairHead[GRID],pairNext[NB],pairTouched[NB],pairTouchedCount;
static Ball *body;
static int bi;
static int abs32(int n){return n<0?-n:n;}
static int clamp(int x,int a,int b){return x<a?a:x>b?b:x;}
static int mul(int a,int b){return (int)((int64_t)a*b/Q);}
static int64_t dot(int x,int y,int a,int b){return (int64_t)x*a+(int64_t)y*b;}
static uint64_t isqrt(uint64_t n){uint64_t r=0,b=(uint64_t)1<<62;while(b>n)b>>=2;while(b){if(n>=r+b){n-=r+b;r=(r>>1)+b;}else r>>=1;b>>=2;}return r;}
static int fraction(int64_t value,int64_t length){return value<=0?0:value>=length?65536:(int)(value*65536/length);}
static int sinq(int a){a%=3600;if(a<0)a+=3600;return trig[a];}
static int cosq(int a){return sinq(a+900);}
static void limit(Ball*b){int s=(int)isqrt(dot(b->vx,b->vy,b->vx,b->vy));if(s>MAXV){b->vx=(int)((int64_t)b->vx*MAXV/s);b->vy=(int)((int64_t)b->vy*MAXV/s);}}
static int grid(int arena,int layer,int x,int y){if(arena<0||arena>3||layer<0||layer>3||x<0||y<0||x>=SIDE||y>=SIDE)return -1;return ((arena*4+layer)*SIDE+y)*SIDE+x;}
static void event(int type,int a,int b,int collider,int energy){
 for(int i=world.eventCount-1;i>=0;i--){Event*e=&world.events[i];if(e->type==type&&e->a==a&&e->b==b&&e->collider==collider){if(energy>e->energy){e->energy=energy;e->x=world.balls[a].x;e->y=world.balls[a].y;e->z=world.balls[a].elevation;}return;}}
 if(world.eventCount<NE)world.events[world.eventCount++]=(Event){type,a,b,collider,energy,world.balls[a].x,world.balls[a].y,world.balls[a].elevation};else world.budget++;
}
EXPORT int state_ptr(void){return (int)(uintptr_t)&world;}
EXPORT int state_size(void){return sizeof(State);}
EXPORT int input_ptr(void){return (int)(uintptr_t)&held;}
EXPORT int trig_ptr(void){return (int)(uintptr_t)&trig;}
EXPORT void init(void){int*p=(int*)&world;for(unsigned i=0;i<sizeof(State)/4;i++)p[i]=0;for(int i=0;i<NP;i++)held[i]=0;for(int i=0;i<NC;i++)seen[i]=0;stamp=0;nr=0;pairTouchedCount=0;for(int i=0;i<GRID;i++)pairHead[i]=-1;}
EXPORT int rail(int ax,int ay,int bx,int by,int radius,int bounce,int layer,int arena,int elevation){int i=world.nc++;colliders[i]=(Collider){.type=0,.ax=ax,.ay=ay,.bx=bx,.by=by,.radius=radius,.bounce=bounce,.layer=layer,.arena=arena,.fi=-1,.enabled=1,.elevation=elevation,.elevationB=elevation};return i;}
EXPORT void rail_end_elevation(int i,int elevation){if(i>=0&&i<world.nc&&colliders[i].type==0)colliders[i].elevationB=elevation;}
EXPORT int bumper(int x,int y,int radius,int kick,int layer,int arena,int elevation){int i=world.nc++;colliders[i]=(Collider){.type=1,.ax=x,.ay=y,.bx=x,.by=y,.radius=radius,.bounce=Q,.kick=kick,.layer=layer,.arena=arena,.fi=-1,.enabled=1,.elevation=elevation};return i;}
EXPORT int flipper(int x,int y,int length,int radius,int rest,int active,int side,int owner,int layer,int arena,int elevation){int i=world.nc++,f=world.nf++;colliders[i]=(Collider){.type=2,.ax=x,.ay=y,.radius=radius,.bounce=850,.layer=layer,.arena=arena,.owner=owner,.side=side,.rest=rest,.active=active,.length=length,.fi=f,.enabled=1,.elevation=elevation};world.angles[f]=rest;flipperCollider[f]=i;return i;}
EXPORT void enabled(int i,int on){if(i>=0&&i<world.nc)colliders[i].enabled=on;}
EXPORT void lease(int i,int owner){if(i>=0&&i<world.nc&&colliders[i].type==2)colliders[i].owner=owner;}
EXPORT void add_ball(int x,int y,int vx,int vy,int active,int owner,int team,int arena,int layer,int radius){int i=world.nb++;world.balls[i]=(Ball){x,y,vx,vy,active,owner,team,arena,layer,radius,0,0,0,-100,0,-1,0,0};limit(&world.balls[i]);}
EXPORT void set_ball(int i,int x,int y,int vx,int vy,int active,int arena,int layer){if(i<0||i>=world.nb)return;Ball*b=&world.balls[i];b->x=x;b->y=y;b->vx=vx;b->vy=vy;b->active=active;b->arena=arena;b->layer=layer;b->remx=b->remy=0;b->rampi=-1;b->rampDirection=0;limit(b);}
EXPORT void elevation(int i,int z){if(i>=0&&i<world.nb)world.balls[i].elevation=z;}
EXPORT int ramp(int ax,int ay,int bx,int by,int width,int from,int to,int z0,int z1,int arena,int bidirectional){int i=nr++;ramps[i]=(Ramp){ax,ay,bx,by,width,from,to,z0,z1,arena,bidirectional};return i;}
EXPORT void force(int i,int vx,int vy){if(i<0||i>=world.nb)return;world.balls[i].vx+=vx;world.balls[i].vy+=vy;limit(&world.balls[i]);}
EXPORT int index_world(void){
 for(int i=0;i<GRID;i++)heads[i]=-1;nl=0;
 for(int i=0;i<world.nc;i++){Collider*c=&colliders[i];int r=c->radius+48*Q;int ax=c->ax,bx=c->bx,ay=c->ay,by=c->by;
  if(c->type==2){r+=c->length;bx=ax;by=ay;}
  int x0=clamp(((ax<bx?ax:bx)-r)/CELL,0,SIDE-1),x1=clamp(((ax>bx?ax:bx)+r)/CELL,0,SIDE-1);
  int y0=clamp(((ay<by?ay:by)-r)/CELL,0,SIDE-1),y1=clamp(((ay>by?ay:by)+r)/CELL,0,SIDE-1);
  for(int y=y0;y<=y1;y++)for(int x=x0;x<=x1;x++){if(nl>=LINKS)return 0;int g=grid(c->arena,c->layer,x,y);if(g<0)return 0;linkCollider[nl]=i;linkNext[nl]=heads[g];heads[g]=nl++;}
 }
 return 1;
}
static int sweep(int x,int y,int ex,int ey,int ax,int ay,int bx,int by,int radius){
 int dx=ex-x,dy=ey-y,sx=bx-ax,sy=by-ay;int64_t ll=dot(dx,dy,dx,dy),sl=dot(sx,sy,sx,sy);int ts[5]={0,65536,0,0,0};
 if(ll){ts[2]=fraction(dot(ax-x,ay-y,dx,dy),ll);ts[3]=fraction(dot(bx-x,by-y,dx,dy),ll);}
 int64_t cross=(int64_t)dx*sy-(int64_t)dy*sx;
 if(cross){int64_t t=((int64_t)(ax-x)*sy-(int64_t)(ay-y)*sx)*65536/cross;int64_t u=((int64_t)(ax-x)*dy-(int64_t)(ay-y)*dx)*65536/cross;if(t>=0&&t<=65536&&u>=0&&u<=65536)ts[4]=(int)t;}
 int best=-1;
 for(int i=0;i<5;i++){int t=ts[i],px=x+(int)((int64_t)dx*t/65536),py=y+(int)((int64_t)dy*t/65536),u=sl?fraction(dot(px-ax,py-ay,sx,sy),sl):0;int nx=px-ax-(int)((int64_t)sx*u/65536),ny=py-ay-(int)((int64_t)sy*u/65536);if(dot(nx,ny,nx,ny)<(int64_t)radius*radius&&(best<0||t<best))best=t;}
 if(best>=0){int lo=0,hi=best;for(int i=0;i<16&&lo<hi;i++){int t=(lo+hi)/2,px=x+(int)((int64_t)dx*t/65536),py=y+(int)((int64_t)dy*t/65536),u=sl?fraction(dot(px-ax,py-ay,sx,sy),sl):0;int nx=px-ax-(int)((int64_t)sx*u/65536),ny=py-ay-(int)((int64_t)sy*u/65536);if(dot(nx,ny,nx,ny)<(int64_t)radius*radius)hi=t;else lo=t+1;}best=hi;}
 return best;
}
static int collide(int index,int ax,int ay,int bx,int by,int extra,int svx,int svy){
 Collider*c=&colliders[index];if(!c->enabled||c->layer!=body->layer||c->arena!=body->arena)return 0;
 int dx=bx-ax,dy=by-ay;int64_t ll=dot(dx,dy,dx,dy);int t=ll?fraction(dot(body->x-ax,body->y-ay,dx,dy),ll):0;
 int height=c->elevation;if(c->type==0)height+=(int)((int64_t)(c->elevationB-c->elevation)*t/65536);if(abs32(height-body->elevation)>body->radius+c->radius)return 0;world.staticChecks++;
 int cx=ax+(int)((int64_t)dx*t/65536),cy=ay+(int)((int64_t)dy*t/65536),nx=body->x-cx,ny=body->y-cy;
 int radius=body->radius+c->radius+extra,z=body->elevation-height;radius=(int)isqrt((uint64_t)((int64_t)radius*radius-(int64_t)z*z));int dist=(int)isqrt(dot(nx,ny,nx,ny));if(dist>=radius)return 0;
 if(dist==0){nx=-dy;ny=dx;dist=(int)isqrt(dot(nx,ny,nx,ny));if(!dist){nx=0;ny=-Q;dist=Q;}}
 nx=(int)((int64_t)nx*Q/dist);ny=(int)((int64_t)ny*Q/dist);
 body->x=cx+mul(nx,radius+radius/256+2);body->y=cy+mul(ny,radius+radius/256+2);
 int ux=(int)((int64_t)svx*t/65536),uy=(int)((int64_t)svy*t/65536),normal=(int)(dot(body->vx-ux,body->vy-uy,nx,ny)/Q);
 if(normal<0){int impulse=mul(-normal,Q+c->bounce);if(c->type==1)impulse+=c->kick;body->vx+=mul(nx,impulse);body->vy+=mul(ny,impulse);limit(body);event(c->type,bi,-1,index,-normal);}
 return 1;
}
static void static_contacts(int sub){
 int candidates[128],n=0;stamp++;if(stamp>=0x7fffff00){for(int i=0;i<NC;i++)seen[i]=0;stamp=1;}
 int g=grid(body->arena,body->layer,body->x/CELL,body->y/CELL);
 if(g>=0)for(int k=heads[g];k>=0;k=linkNext[k]){int c=linkCollider[k];if(seen[c]==stamp)continue;seen[c]=stamp;if(n<128)candidates[n++]=c;else{body->budget=1;world.budget++;}}
 for(int i=1;i<n;i++){int v=candidates[i],j=i;while(j>0&&candidates[j-1]>v){candidates[j]=candidates[j-1];j--;}candidates[j]=v;}
 for(int pass=0;pass<4;pass++){int contacts=0;
  for(int k=0;k<n;k++){int i=candidates[k];Collider*c=&colliders[i];if(!c->enabled)continue;int bx=c->bx,by=c->by,svx=0,svy=0,obx=bx,oby=by;
   if(c->type==2){int f=c->fi,a=oldAngle[f]+(nextAngle[f]-oldAngle[f])*sub/SUB,pa=oldAngle[f]+(nextAngle[f]-oldAngle[f])*(sub-1)/SUB;bx=c->ax+mul(cosq(a),c->length);by=c->ay+mul(sinq(a),c->length);obx=c->ax+mul(cosq(pa),c->length);oby=c->ay+mul(sinq(pa),c->length);svx=(bx-obx)*SUB;svy=(by-oby)*SUB;}
   int hit=collide(i,c->ax,c->ay,bx,by,0,svx,svy);
   int height=c->elevation;if(c->type==0){int hx=bx-c->ax,hy=by-c->ay;int64_t hl=dot(hx,hy,hx,hy);int ht=hl?fraction(dot(body->x-c->ax,body->y-c->ay,hx,hy),hl):0;height+=(int)((int64_t)(c->elevationB-c->elevation)*ht/65536);}
   if(!hit&&pass==0&&c->layer==body->layer&&c->arena==body->arena&&abs32(height-body->elevation)<=body->radius+c->radius){int radius=body->radius+c->radius+(c->type==2?2:0),z=body->elevation-height;radius=(int)isqrt((uint64_t)((int64_t)radius*radius-(int64_t)z*z));int t=sweep(oldX[bi],oldY[bi],body->x,body->y,c->ax,c->ay,bx,by,radius);
    int sax=c->ax,say=c->ay,sbx=bx,sby=by;
    if(c->type==2){int old=sweep(oldX[bi],oldY[bi],body->x,body->y,c->ax,c->ay,obx,oby,radius);if(old>=0&&(t<0||old<t)){t=old;sbx=obx;sby=oby;}int tip=sweep(oldX[bi],oldY[bi],body->x,body->y,obx,oby,bx,by,radius);if(tip>=0&&(t<0||tip<t)){t=tip;sax=obx;say=oby;sbx=bx;sby=by;}}
    if(t>=0){int ex=body->x,ey=body->y;body->x=oldX[bi]+(int)((int64_t)(ex-oldX[bi])*t/65536);body->y=oldY[bi]+(int)((int64_t)(ey-oldY[bi])*t/65536);hit=collide(i,sax,say,sbx,sby,c->type==2?2:0,svx,svy);if(!hit){body->x=ex;body->y=ey;}}
   }
   contacts+=hit;
  }
  if(!contacts)break;
  if(pass==3){body->budget=1;world.budget++;}
 }
}
static void pair(int a,int b){
 Ball*p=&world.balls[a],*q=&world.balls[b];if(!q->active||p->arena!=q->arena||p->layer!=q->layer||abs32(p->elevation-q->elevation)>p->radius+q->radius)return;world.pairChecks++;
 int dx=p->x-q->x,dy=p->y-q->y,r=p->radius+q->radius,z=p->elevation-q->elevation;r=(int)isqrt((uint64_t)((int64_t)r*r-(int64_t)z*z));int d=(int)isqrt(dot(dx,dy,dx,dy));
 if(d>=r){int t=sweep(oldX[a]-oldX[b],oldY[a]-oldY[b],dx,dy,0,0,0,0,r);if(t<0)return;
  p->x=oldX[a]+(int)((int64_t)(p->x-oldX[a])*t/65536);p->y=oldY[a]+(int)((int64_t)(p->y-oldY[a])*t/65536);
  q->x=oldX[b]+(int)((int64_t)(q->x-oldX[b])*t/65536);q->y=oldY[b]+(int)((int64_t)(q->y-oldY[b])*t/65536);dx=p->x-q->x;dy=p->y-q->y;d=(int)isqrt(dot(dx,dy,dx,dy));}
 if(!d){dx=(a<b?-Q:Q);dy=0;d=Q;}
 int nx=(int)((int64_t)dx*Q/d),ny=(int)((int64_t)dy*Q/d),over=(r-d+4)/2;
 p->x+=mul(nx,over);p->y+=mul(ny,over);q->x-=mul(nx,over);q->y-=mul(ny,over);
 int normal=(int)(dot(p->vx-q->vx,p->vy-q->vy,nx,ny)/Q);if(normal>=0)return;
 int impulse=mul(-normal,962);p->vx+=mul(nx,impulse);p->vy+=mul(ny,impulse);q->vx-=mul(nx,impulse);q->vy-=mul(ny,impulse);limit(p);limit(q);event(3,a,b,-1,-normal);
}
static void update_ramp(Ball*b){
 for(int i=0;i<nr;i++){Ramp*r=&ramps[i];if(r->arena!=b->arena)continue;int already=b->rampi==i;if(!already&&b->rampi>=0)continue;
  int dx=r->bx-r->ax,dy=r->by-r->ay;int64_t ll=dot(dx,dy,dx,dy),along=dot(b->x-r->ax,b->y-r->ay,dx,dy);int t=along<0?-1:along>ll?65537:fraction(along,ll);
  int ct=clamp(t,0,65536),nx=b->x-r->ax-(int)((int64_t)dx*ct/65536),ny=b->y-r->ay-(int)((int64_t)dy*ct/65536),half=r->width/2-b->radius;
  int inWidth=dot(nx,ny,nx,ny)<=(int64_t)half*half;
  if(already){
   if(t<0||t>65536||!inWidth){int finished=inWidth&&((t>65536&&b->rampDirection==1)||(t<0&&b->rampDirection==-1));b->rampExit=(i+1)*(finished?1:-1);b->rampi=-1;b->rampDirection=0;b->elevation=t<32768?r->z0:r->z1;b->layer=t<32768?r->from:r->to;return;}
  }else{if(!inWidth||t<0||t>65536)continue;int forward=b->layer==r->from&&abs32(b->elevation-r->z0)<=b->radius+4*Q&&t<8192&&dot(b->vx,b->vy,dx,dy)>0,back=r->bidirectional&&b->layer==r->to&&abs32(b->elevation-r->z1)<=b->radius+4*Q&&t>57344&&dot(b->vx,b->vy,dx,dy)<0;if(!forward&&!back)continue;b->rampi=i;b->rampDirection=forward?1:-1;}
  b->elevation=r->z0+(int)((int64_t)(r->z1-r->z0)*ct/65536);b->layer=ct<32768?r->from:r->to;return;
 }
}
EXPORT void step(void){
 world.tick++;world.eventCount=world.pairChecks=world.staticChecks=world.budget=0;
 for(int i=0;i<world.nc;i++){Collider*c=&colliders[i];if(c->type!=2)continue;int f=c->fi;oldAngle[f]=world.angles[f];int on=c->owner>=0&&c->owner<NP&&(held[c->owner]&c->side);int target=on?c->active:c->rest;nextAngle[f]=oldAngle[f]+clamp(target-oldAngle[f],on?-70:-45,on?70:45);}
 for(int i=0;i<world.nb;i++)world.balls[i].budget=world.balls[i].rampExit=0;
 for(int sub=1;sub<=SUB;sub++){
  for(int i=0;i<world.nb;i++){Ball*b=&world.balls[i];oldX[i]=b->x;oldY[i]=b->y;if(!b->active)continue;b->remx+=b->vx;b->remy+=b->vy;b->x+=b->remx/SUB;b->y+=b->remy/SUB;b->remx%=SUB;b->remy%=SUB;update_ramp(b);body=b;bi=i;static_contacts(sub);}
  for(int g=0;g<pairTouchedCount;g++)pairHead[pairTouched[g]]=-1;pairTouchedCount=0;
  for(int i=world.nb-1;i>=0;i--){Ball*b=&world.balls[i];if(!b->active){pairNext[i]=-1;continue;}int g=grid(b->arena,b->layer,b->x/CELL,b->y/CELL);if(g<0){pairNext[i]=-1;continue;}if(pairHead[g]==-1)pairTouched[pairTouchedCount++]=g;pairNext[i]=pairHead[g];pairHead[g]=i;}
  for(int i=0;i<world.nb;i++){Ball*b=&world.balls[i];if(!b->active)continue;int cx=b->x/CELL,cy=b->y/CELL;for(int yy=cy-1;yy<=cy+1;yy++)for(int xx=cx-1;xx<=cx+1;xx++){int g=grid(b->arena,b->layer,xx,yy);if(g<0)continue;for(int j=pairHead[g];j>=0;j=pairNext[j])if(j>i)pair(i,j);}}
 }
 for(int i=0;i<world.nf;i++)world.angles[i]=nextAngle[i];
}
EXPORT int tip_x(int f){if(f<0||f>=world.nf)return 0;Collider*c=&colliders[flipperCollider[f]];return c->ax+mul(cosq(world.angles[f]),c->length);}
EXPORT int tip_y(int f){if(f<0||f>=world.nf)return 0;Collider*c=&colliders[flipperCollider[f]];return c->ay+mul(sinq(world.angles[f]),c->length);}
