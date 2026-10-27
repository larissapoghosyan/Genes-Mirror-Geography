/* Nested SVG biology camera. Every pose is a function of the shared scroll playhead. */
(function(root){
  'use strict';
  const clamp=x=>Math.max(0,Math.min(1,x));
  const ease=x=>{const t=clamp(x);return t*t*(3-2*t);};
  const ramp=(x,a,b)=>ease((x-a)/(b-a));
  const lerp=(a,b,t)=>a+(b-a)*t;
  const colors={A:'#358775',T:'#b47c32',C:'#357bab',G:'#8662aa'};
  const rgb=Object.fromEntries(Object.entries(colors).map(([base,color])=>[base,color.slice(1).match(/../g).map(v=>parseInt(v,16))]));
  const mutedBase=(base,t)=>`rgb(${rgb[base].map((value,i)=>Math.round(lerp(value,[164,156,147][i],t))).join(',')})`;
  const complement={A:'T',T:'A',C:'G',G:'C'};
  const cameraStops=[[2,0,0,1],[2.45,0,-80,1],[3,0,-80,5],[3.2,0,-80,5],
    [3.46,5,-82.4,16],[3.72,5,-82.4,40],[3.88,3.6,-82.4,80],[4.18,3.6,-82.4,400],[8,3.6,-82.4,400]];
  function pose(position,reduced=false){
    let q=position;
    if(reduced)q=position>=6&&position<6.5?6.5:
      [1,2,3,3.5,3.8,4.4,5.8,6.5,7.2,8].filter(v=>v<=q+1e-6).at(-1)||1;
    const bounded=Math.max(2,Math.min(8,q));let camera=cameraStops[0].slice(1);
    for(let i=1;i<cameraStops.length;i++){
      const a=cameraStops[i-1],b=cameraStops[i];
      if(bounded<=b[0]){
        const t=ramp(bounded,a[0],b[0]);
        camera=[lerp(a[1],b[1],t),lerp(a[2],b[2],t),Math.exp(lerp(Math.log(a[3]),Math.log(b[3]),t))];break;
      }
    }
    return{q,camera,visible:position>=2&&position<8,
      opacity:reduced?1:ramp(q,2,2.10),person:1-ramp(q,2.48,3.22),cell:ramp(q,2.45,2.95),
      membrane:1-ramp(q,3.12,3.65),nucleus:1-ramp(q,3.50,3.9),
      chromosomes:ramp(q,2.85,3.15)*(1-ramp(q,3.82,4.3)),isolate:ramp(q,3.4,3.72),
      dna:ramp(q,3.78,4.26)*(1-ramp(q,7.30,7.64)),flat:ramp(q,4.85,5.52),
      turn:ramp(q,5.15,5.85),two:ramp(q,6.05,6.55),snp:ramp(q,6.05,6.55),
      dosage:ramp(q,6.65,7.05),observed:ramp(q,7.32,7.57),handoff:ramp(q,7.57,8)};
  }
  function create(svg,{marker,helix}){
    if(!svg||!marker||!helix)return null;
    const doc=svg.ownerDocument||document,ns='http://www.w3.org/2000/svg';
    function el(name,attrs={},parent=svg){
      const node=doc.createElementNS(ns,name);
      for(const [key,value] of Object.entries(attrs))node.setAttribute(key,String(value));
      parent.appendChild(node);return node;
    }
    const set=(node,key,value)=>node.setAttribute(key,typeof value==='number'?Number(value.toFixed(6)):String(value));
    const opacity=(node,value)=>set(node,'opacity',clamp(value));
    function label(parent,value,x,y,size=13,fill='#716961',id){
      const node=el('text',{x,y,'font-size':size,fill,'text-anchor':'middle','dominant-baseline':'central',...(id?{id}:{})},parent);
      node.textContent=value;return node;
    }
    set(svg,'font-family','Inter, Arial, sans-serif');set(svg,'pointer-events','none');
    const defs=el('defs'),clip=el('clipPath',{id:'bio-figure-clip',clipPathUnits:'userSpaceOnUse'},defs);
    const clipRect=el('rect',{},clip),viewport=el('g',{'clip-path':'url(#bio-figure-clip)'});
    const rig=el('g',{id:'camera-rig'},viewport);
    const person=el('g',{id:'layer-person',fill:'#a9bcb3',stroke:'#668b83','stroke-linecap':'round'},rig);
    el('circle',{cx:0,cy:-175,r:38,stroke:'none'},person);
    el('path',{d:'M-42,-126 C-78,-118 -80,-60 -65,26 L65,26 C80,-60 78,-118 42,-126 Z','stroke-width':1.3},person);
    el('path',{d:'M-64,-105 L-105,18 M64,-105 L105,18 M-29,20 L-44,198 M29,20 L44,198',fill:'none','stroke-width':24},person);
    el('circle',{cx:0,cy:-80,r:15,fill:'#fcfaf7',stroke:'#9c3d35','stroke-width':2},person);
    el('circle',{cx:0,cy:-80,r:23,fill:'none',stroke:'#9c3d35','stroke-opacity':.22,'stroke-width':1},person);
    const cell=el('g',{id:'layer-cell',transform:'translate(0 -80) scale(.2)'},rig);
    const membrane=el('g',{},cell);
    el('path',{d:'M-205,-70 C-160,-225 90,-230 188,-112 C300,14 158,224 -12,204 C-193,225 -280,72 -205,-70 Z',fill:'#e0ece7',stroke:'#8eaaa1','stroke-width':2},membrane);
    for(const [x,y,r] of [[-115,-110,30],[120,92,27],[-112,95,24],[130,-105,22]]){
      el('ellipse',{cx:x,cy:y,rx:r,ry:r*.45,transform:`rotate(-25 ${x} ${y})`,fill:'#e9e0c6',stroke:'#b8ac8e','stroke-width':1},membrane);
      el('path',{d:`M${x-r*.6},${y} q${r*.3},${-r*.3} ${r*.4},0 t${r*.4},0`,fill:'none',stroke:'#b8ac8e','stroke-width':1},membrane);
    }
    const nucleus=el('g',{id:'layer-nucleus',transform:'translate(25 -12)'},cell);
    const nuclearEnvelope=el('circle',{r:90,fill:'#e4e6ec',stroke:'#a0a8bc','stroke-width':1.7},nucleus);
    const chromosomes=el('g',{id:'autosome-pairs'},nucleus),pairs=[];
    const locations=[[0,0]];
    for(let row=0;row<4;row++)for(let col=0;col<6;col++)locations.push([(col-2.5)*24,(row-1.5)*34]);
    locations.splice(10,1);locations.splice(9,1);locations.splice(15,1);
    for(let i=0;i<22;i++){
      const [x,y]=locations[i],g=el('g',{'data-autosome-pair':i+1,transform:`translate(${x} ${y})`},chromosomes);
      for(const [offset,color] of [[-7,'#358775'],[7,'#8662aa']]){
        el('path',{d:`M${offset-2},-12 C${offset+4},-7 ${offset-4},-2 ${offset},1 C${offset+4},5 ${offset-2},9 ${offset+1},13`,fill:'none',stroke:color,'stroke-width':3.4,'stroke-linecap':'round'},g);
      }
      pairs.push(g);
    }
    const dna=el('g',{id:'layer-dna',transform:'translate(3.6 -82.4) scale(.0025)'},rig);
    const model=helix.create({radius:80,length:500,pairs:19,turns:1.75,phase:Math.PI/2-1.75*Math.PI,tilt:0,ribbonHalfAngle:.10});
    const duplexes=[];
    for(let copy=0;copy<2;copy++){
      const g=el('g',{id:`homolog-${copy+1}`},dna),ribbons=[],rungs=[],letters=[];
      for(let side=0;side<2;side++)for(let i=1;i<model.strands[side].length;i++){
        const p=model.strands[side][i-1],q=model.strands[side][i];
        ribbons.push({side,i,depth:(p.depth+q.depth)/2,node:el('path',{fill:'#e7ded1',stroke:'#b2a18f','stroke-width':.65},g)});
      }
      for(let i=0;i<model.rungs.length;i++){
        const rung=model.rungs[i];
        const paths=[0,1].map(()=>el('path',{fill:'none','stroke-width':1.6,'stroke-linecap':'round'},g));
        rungs.push({paths,depth:rung.center.depth});
        letters.push([label(g,'',0,0,13),label(g,'',0,0,13)]);
        letters[i].forEach((node,side)=>{
          set(node,'data-base-site',i);set(node,'data-homolog',copy);set(node,'data-strand',side);
        });
      }
      // The same offset-chord geometry and depth ordering as the accepted Canvas helix.
      const order=[...ribbons.map(r=>({depth:r.depth,nodes:[r.node]})),...rungs.map((r,i)=>({depth:r.depth,nodes:[...r.paths,...letters[i]]}))];
      order.sort((a,b)=>a.depth-b.depth).forEach(p=>p.nodes.forEach(node=>g.appendChild(node)));
      duplexes.push({g,ribbons,rungs,letters});
    }
    const snpBox=el('rect',{x:-22,y:-137,width:44,height:274,rx:7,fill:'#b47c32','fill-opacity':.08,stroke:'#b47c32','stroke-width':1},dna);
    // Package artwork can fill the whole stage; only the later dosage figure is clipped.
    let packageArt=null;
    try{packageArt=root.BioPackage?.create(svg,svg);}catch(error){console.warn('Biology artwork unavailable; using the local schematic.',error);}
    const rotatingDNA=root.RotatingDNA?.create(svg);
    const captions=el('g',{},svg),title=label(captions,'',0,0,19,'#292622','bio-stage-title');
    const detail=label(captions,'',0,0,11,'#716961','bio-stage-detail');
    const homologLabels=[label(captions,'Maternal homolog · G',0,0,11,'#716961','parent-copy-1-label'),
      label(captions,'Paternal homolog · A',0,0,11,'#716961','parent-copy-2-label')];
    const badge=el('g',{id:'dosage-badge'},viewport);
    const pill=el('rect',{id:'dosage-pill',x:-76,y:-30,width:152,height:60,rx:29,fill:'#fcfaf7',stroke:'#b47c32','stroke-width':1.2},badge);
    const badgeValue=label(badge,'',0,0,36,'#292622','bio-dosage-value');
    let lastKey='',lastResult={active:false};
    function render({position,openingStart=1.5,openingDepthProgress=null,area,width,height,matrix,selected=marker.dosage,reduced=false,atlasFrame}){
      const state=pose(position,reduced),q=state.q;
      const hero=!!packageArt&&position>=1&&position<2;
      // Use the title's remaining scroll distance for the first, gentle part of
      // the Europe zoom. The next beat continues from that exact camera pose.
      const openingShare=.08;
      const routeQ=reduced?hero?2:q:hero?
        2+openingShare*clamp((position-openingStart)/Math.max(.01,2-openingStart)):
        q>=2&&q<4.6?2+openingShare+(q-2)*(4.6-2-openingShare)/(4.6-2):q;
      if(packageArt&&position>=1&&position<8){state.visible=true;state.opacity=1;}
      const active=state.visible;
      if(!active){rotatingDNA?.render({area,alpha:0,reduced});svg.style.visibility='hidden';svg.style.opacity='0';lastKey='';return lastResult={active:false};}
      const key=[position,openingStart,openingDepthProgress,area.cx,area.cy,area.w,area.h,width,height,matrix.x,matrix.y,selected,reduced,
        atlasFrame?.scale,atlasFrame?.area.cx,atlasFrame?.area.cy,atlasFrame?.center[0],atlasFrame?.center[1],atlasFrame?.longitudeFactor].join('/');
      if(key===lastKey)return lastResult;lastKey=key;
      const k=Math.min(area.w/640,area.h/650),[x,y,zoom]=state.camera;
      set(svg,'viewBox',`0 0 ${width} ${height}`);svg.style.visibility='visible';svg.style.opacity=String(state.opacity);
      set(svg,'data-phase',q<3?'person':q<3.46?'cell':q<3.78?'chromosomes':q<5.55?'duplex':q<6.65?'snp':q<7.57?'dosage':'handoff');
      set(svg,'data-camera-scale',zoom);set(svg,'data-handoff',state.handoff);
      set(clipRect,'x',area.cx-area.w*.49);set(clipRect,'y',area.cy-area.h*.405);
      set(clipRect,'width',area.w*.98);set(clipRect,'height',area.h*.81);
      set(rig,'transform',`translate(${area.cx} ${area.cy}) scale(${k*zoom}) translate(${-x} ${-y})`);
      // Start the cover at the zoom's final framing. Scroll changes scale, never its focal position.
      let packageState;
      try{packageState=packageArt?.render(routeQ,area,reduced,{width,height,atlas:atlasFrame,
        depthProgress:reduced?null:openingDepthProgress});}
      catch(error){if(packageArt?.group)packageArt.group.style.display='none';packageArt=null;console.warn('Biology artwork failed; using the local schematic.',error);}
      const entryProgress=clamp((q-4.02)/.76);
      const dnaEntry=reduced?1:.22*entryProgress+.78*ease(entryProgress);
      const dnaReveal=reduced?1:ramp(q,4.02,4.65);
      const rotatingAlpha=rotatingDNA?reduced?(q>=4.65&&q<6.05?1:0):
        dnaReveal*(1-ramp(q,5.90,6.18)):0;
      const snpFocus=reduced?(q>=5.45?1:0):ramp(q,5.05,5.62);
      const snpUnwind=reduced?(q>=6.05?1:0):ramp(q,5.62,6.05);
      rotatingDNA?.render({area,alpha:rotatingAlpha,entry:dnaEntry,focus:snpFocus,unwind:snpUnwind,
        allele:selected===0?'A':'G',reduced});
      // The fallback duplex only takes over after the rotating helix zooms in.
      // Keeping it hidden during the chromosome handoff removes a ghost strand.
      const rigAlpha=packageArt?(q<5.90?0:1-rotatingAlpha):1-rotatingAlpha;
      opacity(rig,rigAlpha);rig.style.display=rigAlpha<.001?'none':'inline';
      // The chromosome gives way to the rotating helix, then to the homolog ladder.
      if(packageArt){state.flat=ramp(q,4.4,5.0);state.turn=ramp(q,4.4,5.0);}
      opacity(person,state.person);opacity(cell,state.cell);opacity(membrane,state.membrane);
      opacity(nuclearEnvelope,state.nucleus);opacity(chromosomes,state.chromosomes);
      pairs.forEach((node,i)=>opacity(node,i?1-.85*state.isolate:1));
      opacity(dna,state.dna);opacity(snpBox,state.snp);
      const actual=state.observed>.5,dose=actual?marker.dosage:selected;
      const genotype=dose===0?'AA':dose===1?'AG':'GG';
      // Two inherited alleles are compared across homologs. Each homolog also
      // shows its complementary base on the other strand of that same duplex.
      const alleles=[dose>=1?'G':'A',dose===2?'G':'A'];
      for(let copy=0;copy<2;copy++){
        const duplex=duplexes[copy],copyAlpha=copy?state.two:1;
        opacity(duplex.g,copyAlpha);
        if(rigAlpha<.001||copyAlpha===0||state.dna===0)continue;
        function endpoint(point,side,t){
          const flatX=(side===0?-30:30),flatY=Math.max(-228,Math.min(228,(t-.5)*864));
          const px=lerp(point.x,flatX,state.flat),py=lerp(point.y,flatY,state.flat),angle=-Math.PI/2*state.turn;
          return{x:px*Math.cos(angle)-py*Math.sin(angle),y:px*Math.sin(angle)+py*Math.cos(angle)+(copy?88:-88)*state.two};
        }
        for(const ribbon of duplex.ribbons){
          const strand=model.strands[ribbon.side],a=strand[ribbon.i-1],b=strand[ribbon.i];
          const p=endpoint(a,ribbon.side,(ribbon.i-1)/(strand.length-1)),r=endpoint(b,ribbon.side,ribbon.i/(strand.length-1));
          const thickness=lerp(1.5,2,state.flat);
          // Ribbon edges share the original cylinder; flat rails use the same endpoints.
          const edge=(vertex,index,t)=>{
            const raw=vertex.edges[index],base=endpoint(vertex,ribbon.side,t);
            return{x:base.x+(raw.x-vertex.x)*(1-state.flat),y:base.y+(raw.y-vertex.y)*(1-state.flat)};
          };
          const vertices=[edge(a,0,(ribbon.i-1)/(strand.length-1)),edge(b,0,ribbon.i/(strand.length-1)),edge(b,1,ribbon.i/(strand.length-1)),edge(a,1,(ribbon.i-1)/(strand.length-1))];
          const full=vertices.map((v,i)=>`${i?'L':'M'}${v.x.toFixed(3)},${v.y.toFixed(3)}`).join(' ')+' Z';
          set(ribbon.node,'d',state.flat>.999?`M${p.x},${p.y} L${r.x},${r.y}`:full);
          set(ribbon.node,'stroke-width',state.flat>.999?thickness:.65);
          const front=(1+(a.world.z+b.world.z)/160)/2;
          set(ribbon.node,'fill',front>.5?'#e1d2c1':'#f0ebe4');
          set(ribbon.node,'stroke',front>.5?'#715b47':'#bfb5ab');
        }
        for(let i=0;i<19;i++){
          const rung=model.rungs[i],t=i/18,ends=[endpoint(rung.left,0,t),endpoint(rung.right,1,t)];
          const center={x:(ends[0].x+ends[1].x)/2,y:(ends[0].y+ends[1].y)/2};
          const base=i===9?alleles[copy]:['A','C','T','G'][i%4],bases=[base,complement[base]];
          const outer=i<5||i>13,alpha=outer?1-state.flat:1,dim=i===9?1:1-.80*state.snp;
          const span=Math.abs(rung.left.x-rung.right.x),front=rung.center.world.z>-.10*model.radius&&span>62;
          for(let side=0;side<2;side++){
            const path=duplex.rungs[i].paths[side],point=ends[side],letter=duplex.letters[i][side];
            set(path,'d',`M${center.x},${center.y} L${point.x},${point.y}`);
            const ink=i===9?colors[bases[side]]:mutedBase(bases[side],state.snp);
            set(path,'stroke',ink);opacity(path,alpha*dim);
            letter.textContent=bases[side];set(letter,'fill',ink);
            // Keep both complementary letters readable while the separate
            // dosage badge forms below the two inherited DNA copies.
            set(letter,'x',lerp(center.x,point.x,.58));
            set(letter,'y',lerp(center.y,point.y,.58));
            opacity(letter,alpha*dim*lerp(front?1:0,1,state.flat));
            set(letter,'font-size',i===9?19:lerp(13,16,state.flat));
          }
        }
      }
      const badgeHeight=width>900?50:36,badgeWidth=width>900?134:104;
      set(pill,'x',-badgeWidth/2);set(pill,'y',-badgeHeight/2);
      set(pill,'width',badgeWidth);set(pill,'height',badgeHeight);set(pill,'rx',badgeHeight/2);
      const badgeOffset=Math.min(area.h*(width>900?.34:.33),area.h*.405-badgeHeight/2-2);
      const start={x:area.cx,y:area.cy+badgeOffset},h=state.handoff,travel=ramp(h,0,.85),transfer=ramp(h,.85,1);
      const bx=travel===1?matrix.x:lerp(start.x,matrix.x,travel),by=travel===1?matrix.y:lerp(start.y,matrix.y,travel);
      set(badge,'transform',`translate(${bx} ${by})`);
      opacity(badge,state.dosage*(1-transfer));opacity(pill,1-ramp(h,0,.65));
      badgeValue.textContent=String(dose);set(badgeValue,'font-size',lerp(width>900?34:24,matrix.font,travel));
      opacity(badgeValue,dose===marker.dosage?1:Math.abs(1-2*state.observed));
      set(badgeValue,'fill',`rgb(${[41,38,34].map((v,i)=>Math.round(lerp(v,[36,103,173][i],travel))).join(',')})`);
      set(badge,'data-x',bx);set(badge,'data-y',by);set(badge,'data-observed',actual);
      opacity(captions,hero?0:1-ramp(q,7.3,7.75));
      let heading='',note='';
      if(packageState?.alpha>.01){
        if(packageState.stage>=6){heading=packageState.name;note=packageState.note;}
      }else{
        heading='One person. A smaller scale.';
        note='Illustrative camera journey · not a physical scale measurement';
        if(q>=3&&q<3.46){heading='Inside a cell, then into its nucleus.';note='22 autosomal pairs · sex chromosomes omitted';}
        else if(q>=3.46&&q<3.78){heading='Chromosome 1. Two homologs.';note='Maternal and paternal copies · condensed schematic rods';}
        else if(q>=3.78&&q<5.18){heading='';note='';}
        else if(q>=5.18&&q<6.05){heading=`A ${alleles[0]}–${complement[alleles[0]]} base pair on one inherited copy.`;
          note='These two letters share one DNA duplex · the paternal homolog comes next';}
        else if(q>=6.05&&q<6.65){heading=selected===marker.dosage?`This person's two alleles: ${genotype}.`:`Example alleles: ${genotype}.`;
          note='Observed genotype is unphased · maternal/paternal ordering is illustrative';}
        else if(q>=6.65){heading=actual?`Recorded genotype · ${marker.genotype} = ${marker.dosage}`:
          selected===marker.dosage?`Person 01 · ${genotype} = ${dose}`:`Try ${genotype} · ${dose} copies of G`;
          note=actual?'Observed call is unphased · parental ordering is illustrative':'Worked genotype · parental phase is not measured';}
      }
      title.textContent=heading;detail.textContent=note;
      for(const [node,cy] of [[title,area.cy-area.h*.46],[detail,area.cy+area.h*.46]]){
        set(node,'x',area.cx);set(node,'y',cy);set(node,'font-size',node===title?(width>900?18:11):(width>900?10:7.5));
        set(node,'stroke','#fcfaf7');set(node,'stroke-width',packageState?.alpha>.5?(node===title?2.2:1.4):0);
        set(node,'paint-order','stroke');set(node,'stroke-linejoin','round');
      }
      homologLabels.forEach((node,i)=>{
        node.textContent=`${i?'Paternal':'Maternal'} homolog · ${alleles[i]}`;
        set(node,'x',area.cx);set(node,'y',area.cy+(i?145:-145)*k);
        set(node,'font-size',width>900?11:10);opacity(node,state.two*(1-ramp(q,6.65,7.2)));
      });
      return lastResult={active:true,handoff:h,rowReveal:h,firstAlpha:transfer,
        badge:{x:bx,y:by,dosage:dose,alpha:state.dosage*(1-transfer)},state,packageState};
    }
    return{render,svg,marker,model};
  }
  root.BioZoom={create,pose};
})(typeof window==='undefined'?globalThis:window);
