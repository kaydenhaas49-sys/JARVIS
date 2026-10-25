/* Cursor-triggered lightning and accumulating damage, adapted for the Stark orb. */
(() => {
  "use strict";
  const orb=document.getElementById("jarvis-orb-canvas");
  if(!orb)return;
  const canvas=document.createElement("canvas");
  canvas.id="jarvisLightningOverlay";
  canvas.setAttribute("aria-hidden","true");
  canvas.style.cssText="position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:9999";
  document.body.appendChild(canvas);
  const ctx=canvas.getContext("2d",{alpha:true});
  if(!ctx){canvas.remove();return;}
  let dpr=1,w=0,h=0,raf=0,damageLevel=0,flashUntil=0,lastDamage=0;
  const strikes=[],scars=[];
  const reduced=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches||false;
  function resize(){
    dpr=Math.min(window.devicePixelRatio||1,1.5);w=innerWidth;h=innerHeight;
    canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);
    canvas.style.width=w+"px";canvas.style.height=h+"px";ctx.setTransform(dpr,0,0,dpr,0,0);drawSoon();
  }
  function sphere(){
    const v=document.getElementById("conversationViewport");
    const b=v?v.getBoundingClientRect():{left:0,top:0,width:w,height:h};
    const r=Math.max(w<700?70:100,Math.min(Math.min(b.width*.34,b.height*.42),430));
    return{x:b.left+b.width*.5,y:b.top+b.height*.49,r};
  }
  function path(a,b,steps,jitter){
    const dx=b.x-a.x,dy=b.y-a.y,len=Math.hypot(dx,dy)||1,nx=-dy/len,ny=dx/len,p=[a];let t=0;
    for(let i=1;i<Math.max(4,steps);i++){t=Math.min(.96,t+(.45+Math.random()*1.1)/steps);const taper=Math.pow(Math.sin(Math.PI*t),.58),off=(Math.random()-.5)*jitter*1.8*taper;p.push({x:a.x+dx*t+nx*off,y:a.y+dy*t+ny*off});}
    p.push(b);return p;
  }
  function bolt(points,progress,scale=1){
    if(progress<=0)return;const part=(points.length-1)*progress,last=Math.min(points.length-1,Math.max(1,Math.ceil(part)));
    ctx.beginPath();ctx.moveTo(points[0].x,points[0].y);
    for(let i=1;i<=last;i++){if(i===last&&part<i){const a=points[i-1],b=points[i],t=part-i+1;ctx.lineTo(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t);}else ctx.lineTo(points[i].x,points[i].y);}
    ctx.lineCap="round";ctx.lineJoin="round";
    ctx.shadowColor="#3278ff";ctx.shadowBlur=24*scale;ctx.strokeStyle="rgba(35,91,255,.32)";ctx.lineWidth=9*scale;ctx.stroke();
    ctx.shadowColor="#4dbbff";ctx.shadowBlur=10*scale;ctx.strokeStyle="rgba(83,190,255,.92)";ctx.lineWidth=2.6*scale;ctx.stroke();
    ctx.shadowColor="#e8fbff";ctx.shadowBlur=4*scale;ctx.strokeStyle="rgba(255,255,255,.99)";ctx.lineWidth=.78*scale;ctx.stroke();
  }
  function draw(now){
    raf=0;ctx.clearRect(0,0,w,h);
    for(let i=strikes.length-1;i>=0;i--){
      const s=strikes[i],ms=now-s.at,age=ms/s.duration;if(age>=1){strikes.splice(i,1);continue;}
      const lead=Math.min(1,ms/105),flicker=ms<105?1:ms<165?.94:ms<205?.38:ms<240?.88:.18,fade=Math.max(0,1-Math.max(0,age-.34)/.66);
      ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=flicker*fade;bolt(s.path,lead);
      s.branches.forEach(b=>bolt(b.path,Math.max(0,Math.min(1,(lead-b.at)/(1-b.at))),.48));
      const pulse=Math.max(0,1-ms/320);if(pulse>0){const g=ctx.createRadialGradient(s.end.x,s.end.y,0,s.end.x,s.end.y,52*pulse+2);g.addColorStop(0,"rgba(255,255,255,"+.95*pulse+")");g.addColorStop(.18,"rgba(115,222,255,"+.75*pulse+")");g.addColorStop(1,"rgba(40,104,255,0)");ctx.fillStyle=g;ctx.beginPath();ctx.arc(s.end.x,s.end.y,52*pulse+2,0,Math.PI*2);ctx.fill();}
      ctx.restore();
    }
    const b=sphere();
    for(let i=scars.length-1;i>=0;i--){
      const s=scars[i],age=(now-s.at)/1000;if(age>7){scars.splice(i,1);continue;}
      ctx.save();ctx.globalCompositeOperation="lighter";ctx.globalAlpha=Math.min(1,(7-age)/2)*s.strength*(now<flashUntil&&!reduced?(Math.random()>.22?1:.16):.7);
      const fracture=(pts,scale=1)=>{ctx.beginPath();ctx.moveTo(pts[0].x,pts[0].y);for(let p=1;p<pts.length;p++)ctx.lineTo(pts[p].x,pts[p].y);ctx.lineCap="round";ctx.lineJoin="round";ctx.strokeStyle="rgba(53,145,255,.95)";ctx.lineWidth=3.2*scale;ctx.shadowColor="#287bff";ctx.shadowBlur=13;ctx.stroke();ctx.strokeStyle="rgba(232,250,255,.98)";ctx.lineWidth=.85*scale;ctx.shadowColor="#b9f4ff";ctx.shadowBlur=4;ctx.stroke();};
      fracture(s.points);s.branches.forEach(p=>fracture(p,.48));ctx.restore();
    }
    if(now<flashUntil&&!reduced){ctx.save();ctx.globalCompositeOperation="screen";for(let i=0;i<7;i++){const y=b.y-b.r+Math.random()*b.r*2,sw=b.r*(.35+Math.random()*.95);ctx.globalAlpha=Math.random()*.2;ctx.fillStyle=i%2?"#73dfff":"#fff";ctx.fillRect(b.x-sw/2+(Math.random()-.5)*30,y,sw,1+Math.random()*3);}ctx.restore();}
    if(damageLevel>0&&now-lastDamage>6500)damageLevel=Math.max(0,damageLevel-.0025);
    if(strikes.length||scars.length||now<flashUntil||damageLevel>0)drawSoon();
  }
  function drawSoon(){if(!raf)raf=requestAnimationFrame(draw);}
  function hit(e){
    if(e.button!==0||e.detail===0||e.target?.closest?.("input,textarea,select,[contenteditable='true']"))return;
    const b=sphere(),dx=e.clientX-b.x,dy=e.clientY-b.y,d=Math.hypot(dx,dy)||1,reach=Math.min(b.r*.63,Math.max(8,d*.72));
    const end={x:b.x+dx/d*reach,y:b.y+dy/d*reach},start={x:e.clientX,y:e.clientY},len=Math.hypot(end.x-start.x,end.y-start.y)||1;
    const main=path(start,end,Math.max(12,Math.floor(len/9)),23),nx=-(end.y-start.y)/len,ny=(end.x-start.x)/len,ux=(end.x-start.x)/len,uy=(end.y-start.y)/len,branches=[];
    for(let i=0;i<3+Math.floor(Math.random()*3);i++){const at=.18+Math.random()*.66,p=main[Math.min(main.length-2,Math.floor(at*(main.length-1)))],sign=Math.random()<.5?-1:1,L=22+Math.random()*Math.min(94,len*.28),tip={x:p.x+ux*L*(.25+Math.random()*.3)+nx*sign*L,y:p.y+uy*L*(.25+Math.random()*.3)+ny*sign*L};branches.push({at,path:path(p,tip,4+Math.floor(Math.random()*4),L*.48)});}
    const angle=Math.atan2(b.y-end.y,b.x-end.x),L=Math.min(72+Math.random()*54,b.r*.68),pts=[end];let x=end.x,y=end.y;
    for(let i=0;i<7;i++){const a=angle+(Math.random()-.5)*1.25;x+=Math.cos(a)*L/7;y+=Math.sin(a)*L/7;pts.push({x,y});}
    const fractureBranches=[];for(let i=0;i<5;i++){const p=pts[1+Math.floor(Math.random()*(pts.length-2))],a=angle+(Math.random()<.5?-1:1)*(.65+Math.random()*.85);fractureBranches.push([p,{x:p.x+Math.cos(a)*(12+Math.random()*24),y:p.y+Math.sin(a)*(12+Math.random()*24)}]);}
    scars.push({points:pts,branches:fractureBranches,at:performance.now(),strength:.65+damageLevel*.35});if(scars.length>6)scars.shift();
    damageLevel=Math.min(1,damageLevel+.30);flashUntil=performance.now()+1150;lastDamage=performance.now();
    strikes.push({at:performance.now(),duration:560+Math.random()*140,path:main,branches,end});if(strikes.length>3)strikes.shift();
    orb.classList.remove("jarvis-electrical-damage");void orb.offsetWidth;orb.classList.add("jarvis-electrical-damage");
    setTimeout(()=>{if(performance.now()>=flashUntil)orb.classList.remove("jarvis-electrical-damage");},1250);drawSoon();
  }
  document.addEventListener("click",hit,{passive:true});window.addEventListener("resize",resize,{passive:true});resize();
})();