/* The supplied rotating helix, adapted to the story's persistent SVG stage. */
(function(root){
  'use strict';
  const NS='http://www.w3.org/2000/svg';
  const palette={
    Y:{stick:'#d97706',ball:'#f59e0b',hi:'#facc15'},
    M:{stick:'#be123c',ball:'#e11d48',hi:'#fb7185'},
    G:{stick:'#059669',ball:'#10b981',hi:'#34d399'},
    C:{stick:'#0284c7',ball:'#0ea5e9',hi:'#38bdf8'},
    SNP_G:{stick:'#8662aa',ball:'#8662aa',hi:'#b79bcc'},
    SNP_C:{stick:'#357bab',ball:'#357bab',hi:'#8fb9d5'},
    SNP_A:{stick:'#358775',ball:'#358775',hi:'#91c4b8'},
    SNP_T:{stick:'#b47c32',ball:'#b47c32',hi:'#dec393'},
    U:{stick:'#7991a5',ball:'#9bb0be',hi:'#c2d0d8'}
  };
  const pairs=[['C','M'],['M','G'],['Y','G'],['G','Y'],['M','Y'],['M','C'],
    ['C','M'],['Y','G'],['C','Y'],['Y','C'],['M','Y'],['Y','G'],['C','G'],['Y','M']];
  const strands=[
    {layer:'mid',n:31,p:[[750,-60],[520,215],[250,455],[-50,655]],a:33,r:10.6,w:8.4,phase:1.1,dir:-1,lit:[18,30]},
    {layer:'mid',n:42,p:[[1065,-45],[1215,295],[1565,395],[1980,280]],a:24,r:8.2,w:6.6,phase:2.2,dir:1,lit:[19,31]},
    {layer:'far',n:24,p:[[235,-40],[150,110],[65,245],[-30,375]],a:20,r:6.8,w:5.4,phase:3,dir:1,lit:[2,7]},
    {layer:'far',n:22,p:[[1950,560],[1810,730],[1650,905],[1480,1100]],a:20,r:6.8,w:5.2,phase:.4,dir:-1,lit:[12,18]}
  ];
  function create(svg){
    if(!svg)return null;
    const doc=svg.ownerDocument||document;
    function el(tag,attrs,parent){
      const n=doc.createElementNS(NS,tag);
      for(const [k,v] of Object.entries(attrs))n.setAttribute(k,String(v));
      parent.appendChild(n);return n;
    }
    const stage=el('g',{id:'rotating-dna-stage',opacity:0,'pointer-events':'none'},svg);
    const layout=el('g',{id:'rotating-dna-layout'},stage);
    const background=el('g',{id:'rotating-dna-background'},layout);
    const layers={};
    for(const [name,opacity] of [['far',.12],['mid',.19]]){
      layers[name]=el('g',{id:`rotating-dna-${name}`,opacity},background);
    }
    const hero=el('g',{id:'rotating-dna-vertical', 'shape-rendering':'geometricPrecision'},layout);
    const focusPair=el('g',{id:'rotating-dna-snp-pair',opacity:0},layout);
    const pairRig=el('g',{transform:'translate(960 540)'},focusPair);
    const focusSides={};
    for(const [side,x,base,key] of [['left',-70,'G','SNP_G'],['right',70,'C','SNP_C']]){
      const color=palette[key];
      const labelX=x+(x<0?-26:26),labelY=11;
      const line=el('line',{x1:0,y1:0,x2:x,y2:0,stroke:color.stick,'stroke-width':10,'stroke-linecap':'round'},pairRig);
      const ball=el('circle',{cx:x,cy:0,r:15,fill:color.ball},pairRig);
      const hi=el('circle',{cx:x-3,cy:-3,r:9,fill:color.hi},pairRig);
      const letter=el('text',{id:side==='left'?'rotating-dna-counted-allele':'rotating-dna-complement',
        x:labelX,y:labelY,'text-anchor':'middle','font-size':32,'font-weight':700,fill:color.stick},pairRig);
      letter.textContent=base;
      focusSides[side]={line,ball,hi,letter,x:labelX,y:labelY};
    }
    function bezier(p,t){
      const u=1-t,[p0,p1,p2,p3]=p;
      const x=u*u*u*p0[0]+3*u*u*t*p1[0]+3*u*t*t*p2[0]+t*t*t*p3[0];
      const y=u*u*u*p0[1]+3*u*u*t*p1[1]+3*u*t*t*p2[1]+t*t*t*p3[1];
      const dx=3*u*u*(p1[0]-p0[0])+6*u*t*(p2[0]-p1[0])+3*t*t*(p3[0]-p2[0]);
      const dy=3*u*u*(p1[1]-p0[1])+6*u*t*(p2[1]-p1[1])+3*t*t*(p3[1]-p2[1]);
      const length=Math.hypot(dx,dy)||1;
      return {x,y,nx:-dy/length,ny:dx/length};
    }
    function staticRung(parent,cx,cy,nx,ny,theta,a,r,w,codeA,codeB,lit){
      const d=Math.cos(theta)*a,s=Math.sin(theta),ax=cx+nx*d,ay=cy+ny*d,bx=cx-nx*d,by=cy-ny*d;
      const A=lit?palette[codeA]:palette.U,B=lit?palette[codeB]:palette.U;
      const g=el('g',lit?{}:{opacity:.52},parent);
      function half(x,y,pal,scale){
        const radius=r*scale,width=w*scale;
        el('line',{x1:cx,y1:cy,x2:x,y2:y,stroke:pal.stick,'stroke-width':width,'stroke-linecap':'round'},g);
        el('circle',{cx:x,cy:y,r:radius,fill:pal.ball},g);
        el('circle',{cx:x-radius*.22,cy:y-radius*.22,r:radius*.72,fill:pal.hi},g);
      }
      if(s>=0){half(bx,by,B,1-.22*s);half(ax,ay,A,1+.22*s);}
      else{half(ax,ay,A,1+.22*s);half(bx,by,B,1-.22*s);}
    }
    strands.forEach((st,j)=>{
      const group=el('g',{},layers[st.layer]);
      for(let i=0;i<st.n;i++){
        const p=bezier(st.p,i/(st.n-1)),pair=pairs[(i+j*3)%pairs.length];
        staticRung(group,p.x,p.y,p.nx,p.ny,i*.36*st.dir+st.phase,st.a,st.r,st.w,
          pair[0],pair[1],!!st.lit&&i>=st.lit[0]&&i<=st.lit[1]);
      }
    });
    const pool=[];
    for(let i=0;i<39;i++){
      const y=-35+i*1150/38,pair=i===19?['SNP_G','SNP_C']:pairs[i%pairs.length],lit=i>=8&&i<=30;
      const g=el('g',lit?{}:{opacity:.55},hero);
      const item={i,y,A:lit?palette[pair[0]]:palette.U,B:lit?palette[pair[1]]:palette.U,flip:null,
        backBall:el('circle',{},g),backHi:el('circle',{},g),backStick:el('line',{'stroke-linecap':'round'},g),
        frontStick:el('line',{'stroke-linecap':'round'},g),frontBall:el('circle',{},g),frontHi:el('circle',{},g)};
      pool.push(item);
    }
    let currentAllele='G';
    function setAllele(allele){
      if(allele===currentAllele)return;
      currentAllele=allele;
      const partner=allele==='G'?'C':'T';
      for(const [side,base] of [['left',allele],['right',partner]]){
        const visual=focusSides[side],color=palette['SNP_'+base];
        visual.line.setAttribute('stroke',color.stick);
        visual.ball.setAttribute('fill',color.ball);
        visual.hi.setAttribute('fill',color.hi);
        if(visual.letter){visual.letter.textContent=base;visual.letter.setAttribute('fill',color.stick);}
      }
      pool[19].A=palette['SNP_'+allele];pool[19].B=palette['SNP_'+partner];pool[19].flip=null;
    }
    function update(phase){
      for(const p of pool){
        const theta=p.i*.36-phase,c=Math.cos(theta),s=Math.sin(theta),a=960+c*70,b=960-c*70;
        const frontA=s>=0,backX=frontA?b:a,frontX=frontA?a:b;
        const backScale=frontA?1-.22*s:1+.22*s,frontScale=frontA?1+.22*s:1-.22*s;
        if(p.flip!==frontA){
          p.flip=frontA;const back=frontA?p.B:p.A,front=frontA?p.A:p.B;
          p.backBall.setAttribute('fill',back.ball);p.backHi.setAttribute('fill',back.hi);p.backStick.setAttribute('stroke',back.stick);
          p.frontStick.setAttribute('stroke',front.stick);p.frontBall.setAttribute('fill',front.ball);p.frontHi.setAttribute('fill',front.hi);
        }
        for(const [which,x,scale] of [['back',backX,backScale],['front',frontX,frontScale]]){
          const radius=11.6*scale,stick=p[which+'Stick'],ball=p[which+'Ball'],hi=p[which+'Hi'];
          stick.setAttribute('x1','960');stick.setAttribute('y1',p.y);stick.setAttribute('x2',x.toFixed(1));stick.setAttribute('y2',p.y);
          stick.setAttribute('stroke-width',(9.2*scale).toFixed(1));
          ball.setAttribute('cx',x.toFixed(1));ball.setAttribute('cy',p.y);ball.setAttribute('r',radius.toFixed(1));
          hi.setAttribute('cx',(x-radius*.22).toFixed(1));hi.setAttribute('cy',(p.y-radius*.22).toFixed(1));
          hi.setAttribute('r',(radius*.72).toFixed(1));
        }
      }
    }
    let active=false,scheduled=false,phase=0,last=0;
    function tick(now){
      scheduled=false;
      if(!active){last=0;return;}
      if(last)phase+=Math.min(.05,(now-last)/1000)*2;
      last=now;update(phase);scheduled=true;root.requestAnimationFrame(tick);
    }
    function render({area,alpha,entry=1,focus=0,unwind=0,allele='G',reduced=false}){
      setAllele(allele==='A'?'A':'G');
      stage.setAttribute('opacity',Math.max(0,Math.min(1,alpha)).toFixed(4));
      stage.style.display=alpha>0?'inline':'none';
      // Zoom through the central rung, then return its scale and orientation to
      // the first homolog diagram. The fixed center prevents a camera twitch.
      const baseScale=Math.min(area.w/1460,area.h/1080)*.98;
      const scale=baseScale*Math.exp(Math.log(.34)*(1-entry)+Math.log(5.2)*focus*(1-unwind));
      layout.setAttribute('transform',`translate(${area.cx} ${area.cy}) scale(${scale}) translate(-960 -540)`);
      const reveal=Math.max(0,Math.min(1,(focus-.35)/.42));
      focusPair.setAttribute('opacity',reveal.toFixed(4));
      focusPair.setAttribute('data-counted-allele',currentAllele);
      pairRig.setAttribute('transform',`translate(960 540) rotate(${-90*unwind})`);
      for(const {letter,x,y} of Object.values(focusSides)){
        letter.setAttribute('transform',`rotate(${90*unwind} ${x} ${y})`);
      }
      hero.setAttribute('opacity',(1-.92*Math.max(0,Math.min(1,(focus-.38)/.52))).toFixed(4));
      const bgEntry=Math.max(0,Math.min(1,(entry-.6)/.4));
      const bgFocus=Math.max(0,Math.min(1,(focus-.15)/.60));
      const bgAlpha=bgEntry*bgEntry*(3-2*bgEntry)*(1-bgFocus);
      background.setAttribute('opacity',bgAlpha.toFixed(4));
      background.style.display=bgAlpha>.001?'inline':'none';
      active=alpha>.08&&focus<.9&&!reduced&&typeof root.requestAnimationFrame==='function';
      if(!active){last=0;if(alpha>.08)update(phase);}
      else if(!scheduled){scheduled=true;root.requestAnimationFrame(tick);}
    }
    update(0);render({area:{cx:0,cy:0,w:0,h:0},alpha:0});
    return {render,stage,hero,background,focusPair};
  }
  root.RotatingDNA={create};
})(typeof window==='undefined'?globalThis:window);
