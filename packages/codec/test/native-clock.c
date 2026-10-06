#include <assert.h>
#include <stdint.h>
#include <stdio.h>
#include "../native/keel_retro_clock.h"
int main(void) {
 uint16_t ticks,step,time;unsigned count=0;kr_frame_clock c;
 for(ticks=1;ticks<=255;ticks++)for(step=1;step<=127;step=step<8?step+1:step*2+1) {
  kr_clock_reset(&c);
  for(time=0;time<3u*576u;time+=step) {
   uint16_t t=time%576u;uint8_t want=(uint8_t)(t/ticks)&7u;
   assert(kr_clock_frame(&c,t,(uint8_t)ticks,7u)==want);count++;
  }
  /* A clock may jump into a clip, run backwards, wrap or revisit the same time. */
  for(time=1000;time;time--)assert(kr_clock_frame(&c,time,(uint8_t)ticks,15u)==((time/ticks)&15u));
 }
 kr_clock_reset(&c);assert(kr_clock_frame(&c,23,0,7)==7);
 printf("frame clock: %u sampled phases plus backward/reset checks passed\n",count);return 0;
}
