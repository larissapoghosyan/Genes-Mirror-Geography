(() => {
  'use strict';
  const data=window.GENOME_ATLAS;if(!data)return;
  const diagnostics=window.STUDY_DIAGNOSTICS;
  const alternativeSamples=new Map((diagnostics?.equalWeight.samples||[]).map(s=>[s.id,s]));
  const alternativeGroups=new Map((diagnostics?.equalWeight.centroids||[]).map(s=>[s.pop,s]));
  const $=id=>document.getElementById(id),canvas=$('atlas-canvas');
  const displayCtx=canvas.getContext('2d');let ctx=displayCtx;
  const buffers=['a','b'].map(()=>{const canvas=document.createElement('canvas');return {canvas,ctx:canvas.getContext('2d')};});
  const backdrop=document.createElement('canvas');let backdropDirty=true;
  const sections=[...document.querySelectorAll('.act-section')],hudSteps=[...document.querySelectorAll('.hud-step')];
  const tooltip=$('sample-tooltip'),slider=$('angle-slider'),angleDisplay=$('angle-display'),navigationHint=$('map-navigation-hint');
  const reducedMotion=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const CHAPTER={person:2,cell:3,dna:4,zoom:5,snp:6,dosage:7,row:8,matrix:9,qc:10,normalize:11,pca:12,together:13,pattern:14,compass:15,regions:16,geography:17,explore:18};
  // Twelve reading beats share the existing visual states. Stops give the merged
  // sequences room to move and rest without adding another page of scrolling.
  const timelines=sections.map(section=>section.dataset.visualStops.split(',').map(stop=>stop.split(':').map(Number)));
  function visualPosition(beat,progress){
    const stops=timelines[beat-1];
    for(let i=1;i<stops.length;i++){
      const [end,to]=stops[i],[start,from]=stops[i-1];
      if(progress<=end)return from+(to-from)*(progress-start)/(end-start);
    }
    return stops.at(-1)[1];
  }
  const smoothstep=value=>{const t=Math.max(0,Math.min(1,value));return t*t*(3-2*t);};
  const revealEase=value=>window.d3Ease.sinInOut(Math.max(0,Math.min(1,value)));
  const approach=(value,target,factor)=>{
    const next=value+(target-value)*factor;
    return Math.abs(next-target)<1e-8?target:next;
  };
  const [rotCx,rotCy]=data.meta.center,lonFactor=data.meta.longitude_factor,finalAngle=data.meta.target_angle;
  const ISOLATE_POPS=new Set(['Sardinian','Basque','Spanish_North','Maltese']);
  let regionalColors={'Northern & Nordic':'#237767','Western & Atlantic':'#31669b','Iberia & Basque':'#af4a54',
    'Mediterranean':'#9c691d','Balkans & Southeast':'#5d7d37','Central & Eastern':'#7955a3'};
  const fallbackPalette={id:'margin',dark:false,sky:['#faf8f5','#faf8f5','#f5f3ef'],ink:'#292622',muted:'#716961',rule:'#bfb5ab',paper:'#fcfaf7',halo:'rgba(252,250,247,.97)',font:'Georgia, serif',
    ribbon:[[249,247,244],[224,210,194],[178,161,143],[98,77,63]]};
  let themePalette=window.STORY_THEME||fallbackPalette;
  let neutral=[88,80,72],baseColors={A:'#358775',T:'#b47c32',C:'#357bab',G:'#8662aa'};
  for(const item of [...data.samples,...data.centroids]){item.sx=null;item.sy=null;}
  function refreshFigureTheme(){
    themePalette=window.STORY_THEME||fallbackPalette;
    regionalColors=themePalette.regionalColors||regionalColors;
    neutral=themePalette.neutral||[88,80,72];baseColors=themePalette.bases||baseColors;
    for(const item of [...data.samples,...data.centroids]){
      item.color=regionalColors[item.region]||themePalette.ink;
      item.rgb=item.color.match(/\w\w/g).map(h=>parseInt(h,16));
    }
  }
  refreshFigureTheme();
  const colorFor=(item,mix)=>`rgb(${item.rgb.map((v,i)=>Math.round(neutral[i]*(1-mix)+v*mix)).join(',')})`;
  document.querySelectorAll('[data-snp-count]').forEach(el=>el.textContent=data.meta.snps_analyzed.toLocaleString());
  document.querySelectorAll('[data-correlations]').forEach(el=>el.textContent=
    `Individual r: longitude ${data.meta.r_ew.toFixed(3)} · latitude ${data.meta.r_ns.toFixed(3)}. Descriptive, after alignment.`);
  let width=window.innerWidth,height=window.innerHeight,dpr=1,figureTop=130,openingStart=1.5;
  let beat=0,scene=0,sceneDirty=true,viewFrom=1,viewTo=1,viewMix=0,pageProgress=.45,scrollBeatProgress=0,ambientTime=0,drawingPage=1;
  const scrollPlayhead={value:1};let targetStoryPosition=1,scrollInitialized=false,scrollTween=null;
  const defaultZoom=1;
  let camLon=rotCx,camLat=rotCy,camZoom=defaultZoom,targetLon=rotCx,targetLat=rotCy,targetZoom=defaultZoom;
  let renderAngle=0,manualCompassAngle=null;
  let gpsMix=0,targetGpsMix=0;
  let referenceMix=0,targetReferenceMix=0;
  let showVectors=false,centroidsOnly=false,highlightIsolates=false,focusItaly=false;
  let vectorsMix=0,centroidsMix=0,italyMix=0,isolatesMix=0,cellArtMix=0,nucleusArtMix=0;
  let hoveredSample=null,isDragging=false,lastX=0,lastY=0;
  let toyStep=0,toyResidual=1,targetToyResidual=1,toyAxis1Mix=0,toyAxis2Mix=0;
  let selectedDosage=window.BIO_MARKER?.dosage??1;
  const dosageEmphasis=[0,0,1];
  const bioZoom=window.BioZoom?.create($('bio-zoom-stage'),{marker:window.BIO_MARKER,helix:window.DNAHelix});
  // Shared framing makes the reference comparison honest and keeps every sample in view.
  const maxFlatRadius=Math.max(...data.samples.map(s=>Math.hypot((s.x0-rotCx)*lonFactor,s.y0-rotCy)),
    ...[...alternativeSamples.values()].map(s=>Math.hypot((s.lon-rotCx)*lonFactor,s.lat-rotCy)));
  const matrixCols=32,matrixRows=Math.ceil(data.samples.length/matrixCols);
  const matrixSlot=new Map(data.samples.map((sample,i)=>[sample.id,i]));
  function getRotatedLonLat(x0, y0, angleDeg) {
    const rad = (angleDeg * Math.PI) / 180;
    const dx = (x0 - rotCx) * lonFactor;
    const dy = y0 - rotCy;
    return [
      rotCx + (dx * Math.cos(rad) - dy * Math.sin(rad)) / lonFactor,
      rotCy + (dx * Math.sin(rad) + dy * Math.cos(rad))
    ];
  }
  function geneticPosition(item,angle=renderAngle,mapMix=1){
    const original=getRotatedLonLat(item.x0,item.y0,angle);
    const other=alternativeSamples.get(item.id)||alternativeGroups.get(item.pop);
    const mix=other?referenceMix*mapMix:0;
    return mix?[original[0]*(1-mix)+other.lon*mix,original[1]*(1-mix)+other.lat*mix]:original;
  }

  function plotArea() {
    if(width>900)return {cx:width*.71,cy:height*.52,w:width*.52,h:height*.74};
    const h=Math.min(height*.34,width*.85);
    return {cx:width*.5,cy:Math.max(height*.30,figureTop+h*.46),w:width*.88,h};
  }
  function scientificArea(){const a=plotArea();return width>900?a:{...a,cx:width*.43};}
  function flatScale(){const a=scientificArea();return Math.min(a.w,a.h)*.45/maxFlatRadius;}
  function flatPoint(lon,lat,mapMix=0){
    const a=scientificArea(),scale=flatScale()*(1+(camZoom-1)*mapMix);
    const centerLon=rotCx+(camLon-rotCx)*mapMix,centerLat=rotCy+(camLat-rotCy)*mapMix;
    return [a.cx+(lon-centerLon)*lonFactor*scale,a.cy-(lat-centerLat)*scale];
  }
  function insideMap(x,y){const a=scientificArea();return Math.abs(x-a.cx)<a.w*.5&&Math.abs(y-a.cy)<a.h*.46;}
  function resize(){
    const stageWidth=$('stage-wrapper').getBoundingClientRect().width;
    width=stageWidth>0?stageWidth:window.innerWidth;height=window.innerHeight;dpr=Math.min(window.devicePixelRatio||1,2);
    const openingHeight=sections[0]?.getBoundingClientRect().height||height;
    openingStart=1+Math.min(.8,height*.5/openingHeight);
    const headerBottom=document.querySelector('.apple-top-bar')?.getBoundingClientRect().bottom;
    figureTop=Math.max(130,(Number.isFinite(headerBottom)?headerBottom:0)+20);
    for(const surface of [canvas,backdrop,...buffers.map(b=>b.canvas)]){surface.width=width*dpr;surface.height=height*dpr;surface.getContext('2d').setTransform(dpr,0,0,dpr,0,0);}
    backdropDirty=true;
    sceneDirty=true;updateHint();
  }
  function updateHint(){navigationHint.textContent=scene<CHAPTER.geography?'Scroll to follow the story':width>900
    ?'Scroll left to read · Scroll over the map to zoom · Drag to pan':'Scroll to read · Use + and − to zoom';}
  function syncButtons() {
    for(let i=0;i<3;i++){
      const button=$(`btn-dosage-${i}`),active=i===selectedDosage;
      button.setAttribute('aria-pressed',String(active));button.classList.toggle('active',active);
    }
    $('btn-morph-gps').textContent = targetGpsMix>.5 ? 'Back to DNA positions' : 'Locality coordinates';
    $('btn-morph-gps').classList.toggle('active',targetGpsMix>.5);
    $('btn-toggle-vectors').classList.toggle('active',showVectors);
    for(const [id,on] of [['btn-morph-gps',targetGpsMix>.5],['btn-toggle-vectors',showVectors],['btn-toy-first',toyStep>=1],['btn-toy-second',toyStep===2]]){
      $(id).setAttribute('aria-pressed',String(on));
    }
    const useAll=targetReferenceMix>.5;
    for(const [id,on] of [['btn-reference-fixed',!useAll],['btn-reference-all',useAll]]){
      $(id).setAttribute('aria-pressed',String(on));$(id).classList.toggle('active',on);$(id).disabled=!diagnostics;
    }
    $('reference-description').textContent=useAll?'Alternative fit · frequencies and PCA learned from all 996 people.':'Original fit · all people projected into the 428-person reference space.';
    const metrics=diagnostics?.equalWeight.metrics;
    $('reference-metrics').textContent=`Longitude r = ${(useAll?metrics.r_EastWest_Longitude:data.meta.r_ew).toFixed(3)} · Latitude r = ${(useAll?metrics.r_NorthSouth_Latitude:data.meta.r_ns).toFixed(3)}`;
    $('inspection-note').textContent=focusItaly?'Italy: 219 people. In the original fit, their mean genetic position is 2.70° west and 3.49° south of their mean recorded locality. Lines show group-level coordinate differences, not migration.'
      :'Some locality coordinates are assigned proxies. The connecting lines compare positions; they are not migration routes.';
    document.querySelector('.map-zoom-controls').hidden=scene<CHAPTER.geography;
    $('btn-toy-first').classList.toggle('active',toyStep>=1);
    $('btn-toy-second').classList.toggle('active',toyStep===2);
    $('btn-toy-second').disabled=toyStep===0;
  }
  function setScene(next){
    if(next===scene)return;
    const previous=scene;scene=next;
    hoveredSample=null;tooltip.style.opacity='0';isDragging=false;
    if(scene!==CHAPTER.explore){targetGpsMix=0;referenceMix=targetReferenceMix=0;showVectors=false;highlightIsolates=false;focusItaly=false;centroidsOnly=false;}
    if(scene>=CHAPTER.geography&&previous<CHAPTER.geography){targetLon=rotCx;targetLat=rotCy;targetZoom=defaultZoom;}
    document.body.dataset.scene=String(scene);
    updateHint();syncButtons();
  }
  function setBeat(next){
    if(next===beat)return;
    beat=next;document.body.dataset.beat=String(beat);
    sections.forEach(section=>section.classList.toggle('active',Number(section.dataset.act)===beat));
    const milestone=hudSteps.filter(link=>Number(link.dataset.targetAct)<=beat).at(-1);
    hudSteps.forEach(link=>{const active=link===milestone;link.classList.toggle('active',active);if(active)link.setAttribute('aria-current','step');else link.removeAttribute('aria-current');});
    window.dispatchEvent(new CustomEvent('storyactchange',{detail:{act:beat}}));
  }
  function updateSceneFromScroll(){
    const midpoint=height*.5;sceneDirty=false;
    for(const section of sections){
      const box=section.getBoundingClientRect();
      if(box.top<=midpoint&&box.bottom>midpoint){
        const next=Number(section.dataset.act),span=box.bottom-box.top;
        const progress=Math.max(0,Math.min(1,(midpoint-box.top)/span));
        targetStoryPosition=next+progress;
        // A brief scrub catches wheel steps. Large chapter jumps remain direct.
        const responsive=next<=2||(next>=9&&next<=11);
        if(!scrollInitialized||reducedMotion||responsive||Math.abs(targetStoryPosition-scrollPlayhead.value)>3){
          scrollTween?.kill();scrollTween=null;scrollPlayhead.value=targetStoryPosition;
        }else if(window.gsap){
          scrollTween?.kill();
          scrollTween=window.gsap.to(scrollPlayhead,{value:targetStoryPosition,duration:.65,ease:'power2.out',
            overwrite:true,onComplete:()=>{scrollTween=null;}});
        }
        scrollInitialized=true;
        return;
      }
    }
  }
  function updateVisualState(dt){
    if(reducedMotion)scrollPlayhead.value=targetStoryPosition;
    else if(!scrollTween){
      scrollPlayhead.value+=(targetStoryPosition-scrollPlayhead.value)*(1-Math.exp(-dt/0.14));
      if(Math.abs(targetStoryPosition-scrollPlayhead.value)<1e-7)scrollPlayhead.value=targetStoryPosition;
    }
    const next=Math.min(sections.length,Math.max(1,Math.floor(scrollPlayhead.value)));
    const beatProgress=Math.max(0,Math.min(1,scrollPlayhead.value-next));
    scrollBeatProgress=beatProgress;
    const position=visualPosition(next,beatProgress),boundary=Math.round(position);
    const visual=Math.min(CHAPTER.explore,Math.floor(Math.abs(position-boundary)<1e-7?boundary:position));
    pageProgress=Math.max(0,Math.min(1,position-visual));
    setScene(visual);setBeat(next);viewFrom=visual;viewTo=Math.min(CHAPTER.explore,visual+1);
    // Each visual state holds its figure, then eases continuously into the next.
    const liveReveal=viewFrom===CHAPTER.compass||viewFrom===CHAPTER.regions;
    viewMix=reducedMotion?0:liveReveal?(0.25*pageProgress+0.75*revealEase(pageProgress)):revealEase((pageProgress-.45)/.55);
    document.body.dataset.visualFrom=String(viewFrom);document.body.dataset.visualTo=String(viewMix>0?viewTo:viewFrom);
    document.body.dataset.visualMix=viewMix.toFixed(5);
    $('reading-progress').style.transform=`scaleX(${((next-1+beatProgress)/sections.length).toFixed(5)})`;
  }
  window.addEventListener('resize',resize);window.addEventListener('scroll',()=>{sceneDirty=true;manualCompassAngle=null;},{passive:true});
  window.addEventListener('researchlayoutchange',resize);
  slider.addEventListener('input',event=>{manualCompassAngle=Number(event.target.value);});
  for(let i=0;i<3;i++)$(`btn-dosage-${i}`).addEventListener('click',()=>{
    selectedDosage=i;syncButtons();
    $('dosage-result').textContent=[
      'AA: zero G alleles → count 0.',
      'AG: one G allele → count 1 (Person 01’s real genotype).',
      'GG: two G alleles → count 2.'
    ][i];
  });
  $('btn-toy-first').addEventListener('click',()=>{toyStep=1;targetToyResidual=0;syncButtons();$('toy-description').textContent='PC1 captures the main direction. Projecting onto it leaves one coordinate per point.';});
  $('btn-toy-second').addEventListener('click',()=>{toyStep=2;targetToyResidual=1;syncButtons();$('toy-description').textContent='PC2 restores variation perpendicular to PC1. Two coordinates describe this two-measurement example.';});
  $('btn-morph-gps').addEventListener('click',()=>{targetGpsMix=targetGpsMix>.5?0:1;syncButtons();});
  $('btn-toggle-vectors').addEventListener('click',()=>{showVectors=!showVectors;syncButtons();});
  function selectReference(value){
    if(!diagnostics||scene!==CHAPTER.explore)return;
    targetReferenceMix=value;targetGpsMix=0;hoveredSample=null;tooltip.style.opacity='0';
    syncButtons();
  }
  $('btn-reference-fixed').addEventListener('click',()=>selectReference(0));
  $('btn-reference-all').addEventListener('click',()=>selectReference(1));
  $('btn-zoom-in').addEventListener('click',()=>{targetZoom=Math.min(4.5,targetZoom*1.22);});
  $('btn-zoom-out').addEventListener('click',()=>{targetZoom=Math.max(.75,targetZoom/1.22);});
  $('btn-zoom-fit').addEventListener('click',()=>{targetLon=rotCx;targetLat=rotCy;targetZoom=1;});
  $('btn-zoom-reset').addEventListener('click',()=>{targetLon=rotCx;targetLat=rotCy;targetZoom=defaultZoom;});
  canvas.addEventListener('wheel',event=>{
    if(scene<CHAPTER.geography||width<=900||event.clientX<width*.5||event.ctrlKey)return;
    if(Math.abs(event.deltaX||0)>Math.abs(event.deltaY))return;
    const inset=insetGeometry();
    if(event.clientX>=inset.x&&event.clientY<=inset.y+inset.h+20)return;
    if(!insideMap(event.clientX,event.clientY)||!event.deltaY)return;
    event.preventDefault();
    const unit=event.deltaMode===1?16:event.deltaMode===2?height:1;
    const delta=Math.max(-160,Math.min(160,event.deltaY*unit));
    targetZoom=Math.max(.75,Math.min(4.5,targetZoom*Math.exp(-delta*.0018)));
  },{passive:false});
  canvas.addEventListener('pointerdown',event=>{
    if(scene<CHAPTER.geography||event.pointerType==='touch'||!insideMap(event.clientX,event.clientY))return;isDragging=true;lastX=event.clientX;lastY=event.clientY;canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointerup',()=>{isDragging=false;});
  canvas.addEventListener('pointercancel',()=>{isDragging=false;});
  canvas.addEventListener('pointermove',event=>{
    if(isDragging){
      const scale=flatScale()*camZoom;
      targetLon-=(event.clientX-lastX)/(scale*lonFactor);
      targetLat=Math.max(-75,Math.min(80,targetLat+(event.clientY-lastY)/scale));
      lastX=event.clientX;lastY=event.clientY;
    }
    if(scene<CHAPTER.regions||isDragging){tooltip.style.opacity='0';hoveredSample=null;return;}
    let closest=null,distance=12;
    for(const s of data.samples){
      if(s.sx===null || (focusItaly&&s.country!=='Italy'))continue;
      const d=Math.hypot(s.sx-event.clientX,s.sy-event.clientY);if(d<distance){distance=d;closest=s;}
    }
    hoveredSample=closest;
    if(!closest){tooltip.style.opacity='0';return;}
    tooltip.style.opacity='1';tooltip.style.left=`${Math.max(10,Math.min(width-260,event.clientX+16))}px`;
    tooltip.style.top=`${Math.max(95,Math.min(height-140,event.clientY-20))}px`;
    // All displayed strings come from the local, curated atlas, not user HTML.
    const [shownLon,shownLat]=geneticPosition(closest);
    tooltip.innerHTML=`<div style="color:${closest.color};font-weight:600">${closest.country} · ${closest.pop.replaceAll('_',' ')}</div>
      <div>Sample ${closest.id}</div><div>Aligned DNA (${targetReferenceMix?'all 996':'reference'}): ${shownLat.toFixed(1)}°N, ${shownLon.toFixed(1)}°E</div>
      <div>Recorded locality: ${closest.lat.toFixed(1)}°N, ${closest.lon.toFixed(1)}°E</div>`;
  });
  canvas.addEventListener('pointerleave',()=>{tooltip.style.opacity='0';hoveredSample=null;});

  function figureColor(color,role='text'){
    if(!color||color.startsWith('rgb('))return color;
    if(Object.values(baseColors).includes(color)||Object.values(regionalColors).includes(color))return color;
    const hex=/^#([0-9a-f]{6})$/i.exec(color);
    const rgba=/^rgba\((\d+),(\d+),(\d+),([.\d]+)\)$/.exec(color);
    if(!hex&&!rgba)return color;
    let rgb=hex?hex[1].match(/../g).map(v=>parseInt(v,16)):rgba.slice(1,4).map(Number);
    const opacity=rgba?Number(rgba[4]):null;
    const brightness=(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722)/255;
    const neutralTone=Math.max(...rgb)-Math.min(...rgb)<85;
    if(neutralTone&&brightness<.95){
      const replacement=role==='line'?themePalette.rule:brightness<.5?themePalette.ink:themePalette.muted;
      rgb=replacement.slice(1).match(/../g).map(v=>parseInt(v,16));
    }
    return opacity===null?`rgb(${rgb.join(',')})`:`rgba(${rgb.join(',')},${opacity})`;
  }
  function dot(x,y,r,color,alpha=1){ctx.globalAlpha=alpha;ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);ctx.fillStyle=figureColor(color);ctx.fill();ctx.globalAlpha=1;}
  function text(label,x,y,size=12,color='#648088',align='center'){
    ctx.font=`${size}px ${themePalette.font}`;ctx.fillStyle=figureColor(color);ctx.textAlign=align;ctx.textBaseline='middle';ctx.fillText(label,x,y);
  }
  function line(x1,y1,x2,y2,color='#bed0d2',width=1){ctx.strokeStyle=figureColor(color,'line');ctx.lineWidth=width;ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
  function drawThemeBackdrop(){
    if(backdropDirty){
      const display=ctx;ctx=backdrop.getContext('2d');ctx.clearRect(0,0,width,height);
      ctx.fillStyle=themePalette.sky[0];ctx.fillRect(0,0,width,height);
      ctx=display;backdropDirty=false;
    }
    // One plain buttery-lemon background from the opening map to the genetic map.
    ctx.drawImage(backdrop,0,0,width,height);
  }

  const complements={A:'T',T:'A',C:'G',G:'C'};
  function biologyCaption(title,detail){
    ctx.save();
    if(viewMix>0&&viewMix<1)ctx.globalAlpha*=drawingPage===viewFrom?Math.max(0,1-viewMix*2):Math.max(0,viewMix*2-1);
    const a=plotArea();if(title)text(title,a.cx,a.cy-a.h*.46,width>900?19:13,'#35575f');
    if(detail)text(detail,a.cx,a.cy+a.h*.46,width>900?11:8.5);
    ctx.restore();
  }
  function drawPerson(alpha=1){
    const a=plotArea(),h=a.h*.69,cx=a.cx,cy=a.cy;
    ctx.save();ctx.globalAlpha=alpha;ctx.lineCap='round';
    const ink=ctx.createLinearGradient(cx,cy-h*.5,cx,cy+h*.5);
    ink.addColorStop(0,'#638e91');ink.addColorStop(1,'#a1b8a9');
    ctx.fillStyle=ink;ctx.beginPath();ctx.arc(cx,cy-h*.35,h*.075,0,Math.PI*2);ctx.fill();
    ctx.beginPath();ctx.moveTo(cx-h*.08,cy-h*.23);
    ctx.bezierCurveTo(cx-h*.17,cy-h*.20,cx-h*.16,cy+h*.02,cx-h*.10,cy+h*.11);
    ctx.lineTo(cx+h*.10,cy+h*.11);
    ctx.bezierCurveTo(cx+h*.16,cy+h*.02,cx+h*.17,cy-h*.20,cx+h*.08,cy-h*.23);
    ctx.closePath();ctx.fill();
    line(cx-h*.11,cy-h*.17,cx-h*.21,cy+h*.10,'#86a6a2',h*.055);
    line(cx+h*.11,cy-h*.17,cx+h*.21,cy+h*.10,'#86a6a2',h*.055);
    line(cx-h*.058,cy+h*.09,cx-h*.09,cy+h*.43,'#9cb5a9',h*.065);
    line(cx+h*.058,cy+h*.09,cx+h*.09,cy+h*.43,'#9cb5a9',h*.065);
    ctx.globalAlpha=alpha*.5;ctx.strokeStyle='#7aabb0';ctx.lineWidth=1;
    ctx.beginPath();ctx.arc(cx,cy-h*.07,h*.052,0,Math.PI*2);ctx.stroke();
    ctx.restore();
    ctx.save();ctx.globalAlpha=alpha;biologyCaption('Begin with one person.','A schematic person · a life is more than its DNA');ctx.restore();
  }
  function drawCell(alpha=1,scale=1,closeup=0){
    const a=plotArea(),r=Math.min(a.w*.32,a.h*.32)*scale,cx=a.cx,cy=a.cy;
    const art=window.BIOLOGY_ART?.cell,nucleus=window.BIOLOGY_ART?.nucleus;
    if(art&&cellArtMix>.001){
      const size=Math.min(a.w*.84,a.h*.76)*scale;
      const paint=(image,opacity)=>{
        const ratio=image.naturalWidth/image.naturalHeight,w=ratio>1?size:size*ratio,h=ratio>1?size/ratio:size;
        ctx.globalAlpha=alpha*opacity;ctx.drawImage(image,cx-w/2,cy-h/2,w,h);
      };
      ctx.save();ctx.beginPath();ctx.rect(a.cx-a.w*.48,a.cy-a.h*.405,a.w*.96,a.h*.81);ctx.clip();
      const zoom=nucleus?closeup*nucleusArtMix:0;
      paint(art,cellArtMix*(1-zoom));if(zoom>.001)paint(nucleus,cellArtMix*zoom);
      ctx.restore();
    }
    ctx.save();ctx.globalAlpha=alpha*(1-cellArtMix);
    const wash=ctx.createRadialGradient(cx-r*.25,cy-r*.25,r*.03,cx,cy,r);
    wash.addColorStop(0,'#f5faf3');wash.addColorStop(1,'#dcebe5');
    ctx.beginPath();ctx.ellipse(cx,cy,r*1.14,r, -.12,0,Math.PI*2);ctx.fillStyle=wash;ctx.fill();
    ctx.strokeStyle='#9cbab1';ctx.lineWidth=2;ctx.stroke();
    ctx.beginPath();ctx.arc(cx+r*.10,cy-r*.03,r*.43,0,Math.PI*2);ctx.fillStyle='#e2e8ef';ctx.fill();ctx.strokeStyle='#a4b6ca';ctx.stroke();
    ctx.lineCap='round';
    // Interphase DNA is chromatin, not a collection of condensed X chromosomes.
    for(let j=0;j<5;j++){
      const x=cx+r*(-.19+j*.14),y=cy-r*.24;
      ctx.beginPath();ctx.moveTo(x,y);
      ctx.bezierCurveTo(x+r*.22,y+r*.10,x-r*.18,y+r*.25,x+r*.04,y+r*.43);
      ctx.strokeStyle=j%2?'#a292b5':'#6f819c';ctx.lineWidth=Math.max(1.5,r*.015);ctx.stroke();
    }
    // Mitochondria and membrane folds establish scale without implying measured imagery.
    for(const [dx,dy,turn] of [[-.63,-.22,-.5],[.68,.22,.4],[-.38,.63,.6]]){
      ctx.save();ctx.translate(cx+dx*r,cy+dy*r);ctx.rotate(turn);
      ctx.beginPath();ctx.ellipse(0,0,r*.18,r*.08,0,0,Math.PI*2);
      ctx.fillStyle='#e9ddc3';ctx.fill();ctx.strokeStyle='#bba57c';ctx.lineWidth=1;ctx.stroke();
      ctx.beginPath();ctx.moveTo(-r*.11,0);
      for(let k=0;k<6;k++)ctx.lineTo(r*(-.1+k*.04),r*(k%2?.035:-.035));
      ctx.stroke();ctx.restore();
    }
    if(scale>.75){
      line(cx+r*.38,cy-r*.3,cx+r*.72,cy-r*.66,'#7e959b',.8);
      text('nucleus · chromatin',cx+r*.56,cy-r*.76,width>900?12:9,'#596f78');
      text('cell membrane',cx,cy+r*1.17,width>900?11:8,'#597d74');
    }
    ctx.restore();
    if(scale>.75){ctx.save();ctx.globalAlpha=alpha;biologyCaption('A cell. A nucleus. Chromosomes.',
      art&&cellArtMix>.5?'Servier Medical Art / Bioicons · CC BY 3.0':'Schematic view · not drawn to physical scale');ctx.restore();}
  }
  function drawHelix(zoom=1,alpha=1){
    const a=plotArea(),turns=1.75,baseLength=a.h*.86;
    const phase=Math.PI/2-turns*Math.PI+ambientTime*.10*(1-(zoom-1)/1.5);
    // A tall, level diagram view follows the supplied ribbon-helix reference.
    const model=window.DNAHelix.create({radius:Math.min(a.w*.20,baseLength*.155)*zoom,
      length:baseLength*zoom,pairs:19,turns,phase,tilt:0,ribbonHalfAngle:.10});
    const originY=a.cy+baseLength*zoom*.02*(zoom-1)/1.5;
    const screen=p=>[a.cx+p.x,originY+p.y];
    const scale=Math.min(zoom,1.7),primitives=[];
    const mixColor=(rear,front,t)=>`rgb(${rear.map((c,i)=>Math.round(c*(1-t)+front[i]*t)).join(',')})`;
    ctx.save();ctx.globalAlpha=alpha;ctx.lineCap='round';ctx.lineJoin='round';
    ctx.beginPath();ctx.rect(a.cx-a.w*.46,a.cy-a.h*.405,a.w*.92,a.h*.81);ctx.clip();
    ctx.globalAlpha=alpha*.28;ctx.setLineDash([4,7]);
    line(a.cx,a.cy-a.h*.405,a.cx,a.cy+a.h*.405,'#6c8586',.8);ctx.setLineDash([]);
    model.strands.forEach(strand=>{
      for(let i=1;i<strand.length;i++){
        const p=strand[i-1],q=strand[i],front=(1+(p.world.z+q.world.z)/(2*model.radius))/2;
        primitives.push({depth:(p.depth+q.depth)/2,draw:()=>{
          ctx.globalAlpha=alpha;
          const fill=mixColor(themePalette.ribbon[0],themePalette.ribbon[1],front);
          const ink=mixColor(themePalette.ribbon[2],themePalette.ribbon[3],front);
          ctx.beginPath();ctx.moveTo(...screen(p.edges[0]));ctx.lineTo(...screen(q.edges[0]));
          ctx.lineTo(...screen(q.edges[1]));ctx.lineTo(...screen(p.edges[1]));ctx.closePath();
          ctx.fillStyle=fill;ctx.fill();
          // Overpaint tiny shared-edge seams without adding transverse stripe outlines.
          ctx.strokeStyle=fill;ctx.lineWidth=.65;ctx.stroke();
          line(...screen(p.edges[0]),...screen(q.edges[0]),ink,width>900?1.35:1);
          line(...screen(p.edges[1]),...screen(q.edges[1]),ink,width>900?1.35:1);
        }});
      }
    });
    model.rungs.forEach((rung,i)=>{
      const base=['A','C','T','G'][i%4],other=complements[base];
      for(const [endpoint,letter] of [[rung.left,base],[rung.right,other]]){
        const front=Math.max(0,Math.min(1,(1+(endpoint.world.z+rung.center.world.z)/(2*model.radius))/2));
        primitives.push({depth:(endpoint.depth+rung.center.depth)/2,draw:()=>{
          ctx.globalAlpha=alpha*(.45+.50*front);
          line(...screen(rung.center),...screen(endpoint),baseColors[letter],(width>900?1.5:1)*Math.min(zoom,1.4));
        }});
      }
      const size=(width>900?13:9)*scale,span=Math.abs(rung.left.x-rung.right.x);
      // Labels belong to broad, near-facing rungs; edge-on/rear rungs retain just their geometry.
      if(rung.center.world.z>-.10*model.radius&&span>size*4.8){
        primitives.push({depth:Math.max(rung.left.depth,rung.right.depth)+model.radius*.03,draw:()=>{
          ctx.globalAlpha=alpha;
          for(const [endpoint,letter] of [[rung.left,base],[rung.right,other]]){
            const p={x:rung.center.x+.55*(endpoint.x-rung.center.x),
              y:rung.center.y+.55*(endpoint.y-rung.center.y)};
            const [x,y]=screen(p);
            ctx.font=`${size}px Inter, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
            ctx.strokeStyle=themePalette.halo;ctx.lineWidth=2.5;ctx.strokeText(letter,x,y);
            text(letter,x,y,size,baseColors[letter]);
          }
        }});
      }
    });
    // Level orthographic projection keeps rungs horizontal; opaque ribbon surfaces supply occlusion.
    primitives.sort((p,q)=>p.depth-q.depth).forEach(p=>p.draw());
    if(zoom>1.1){
      const focusW=Math.min(a.w*.82,model.radius*1.6);
      ctx.globalAlpha=alpha*Math.min(1,(zoom-1)/1.4);
      ctx.strokeStyle='#b38a46';ctx.lineWidth=1;ctx.setLineDash([5,5]);
      ctx.beginPath();ctx.roundRect(a.cx-focusW/2,a.cy-a.h*.055,focusW,a.h*.11,8);ctx.stroke();ctx.setLineDash([]);
    }
    ctx.restore();
    ctx.save();ctx.globalAlpha=alpha;
    biologyCaption('DNA · paired bases', 'Illustrative sequence · A pairs with T · C pairs with G');ctx.restore();
  }
  function drawSNP(){
    const a=plotArea(),cols=9,pitch=Math.min(a.w*.077,48),left=a.cx-pitch*4;
    const gap=Math.min(a.h*.20,95),top=a.cy-gap;
    ctx.fillStyle='rgba(190,146,69,.10)';ctx.beginPath();ctx.roundRect(left+pitch*4-pitch*.42,top-26,pitch*.84,gap*2+52,8);ctx.fill();
    const seq='ACTCAGTCA';
    for(let row=0;row<3;row++){
      text(`DNA copy ${row+1}`,left-pitch*.65,top+row*gap,width>900?11:8,'#6d858c','right');
      for(let col=0;col<cols;col++){
        const base=col===4?(row===1?'G':'A'):seq[col];
        text(base,left+pitch*col,top+row*gap,width>900?25:16,baseColors[base]);
      }
    }
    text('same position',left+pitch*4,top+gap*2+52,width>900?12:9,'#a17838');
    biologyCaption('One position can have different versions.','A or G at the highlighted site · an illustrative SNP');
  }
  function drawDosage(){
    const a=plotArea(),gap=Math.min(a.h*.25,120),top=a.cy-gap,center=a.cx;
    for(let row=0;row<3;row++){
      const bases=[['A','A'],['A','G'],['G','G']][row],y=top+row*gap;
      const emphasis=dosageEmphasis[row];
      ctx.save();ctx.globalAlpha=.48+.52*emphasis;
      ctx.fillStyle=themePalette.rule;ctx.globalAlpha=.12*emphasis;
      ctx.beginPath();ctx.roundRect(center-a.w*.33,y-gap*.32,a.w*.70,gap*.64,6);ctx.fill();
      ctx.globalAlpha=.48+.52*emphasis;
      text(bases[0],center-a.w*.24,y,width>900?32:22,baseColors[bases[0]]);
      text(bases[1],center-a.w*.12,y,width>900?32:22,baseColors[bases[1]]);
      line(center-a.w*.02,y,center+a.w*.12,y,'#bacbc9',1.2);
      text('→',center+a.w*.12,y,width>900?20:14,'#92a7a9');
      text(String(row),center+a.w*.28,y,width>900?38:28,'#356b79');
      ctx.restore();
    }
    text('two copies at one site',center-a.w*.18,top+gap*2+26,width>900?11:8.5);
    text('copies of G',center+a.w*.28,top+gap*2+26,width>900?11:8.5);
    biologyCaption('AA → 0     AG → 1     GG → 2','Worked example · we are counting the G allele');
  }
  function matrixLayout(rowCount=1){
    const a=plotArea(),cols=24;
    const gridW=Math.min(a.w*.84,620),pitch=gridW/(cols-1),rowGap=Math.min(29,a.h/15);
    const left=a.cx-gridW/2,top=a.cy-(rowCount-1)*rowGap/2;
    return{a,cols,pitch,rowGap,left,top,font:width>900?14:9};
  }
  function drawActualMatrix(rowCount=1,reveal=1,firstAlpha=1){
    const {a,cols,pitch,rowGap,left,top,font}=matrixLayout(rowCount),excerpt=data.genotype_excerpt,rows=Math.ceil(rowCount);
    const marker=window.BIO_MARKER,focusColumn=Math.max(0,Math.min(cols-1,marker?.column??0));
    const row1Focus=Math.max(0,Math.min(1,1.35-rowCount))*reveal;
    if(row1Focus>.01){
      ctx.save();
      ctx.globalAlpha=.08*row1Focus;ctx.fillStyle=figureColor('#b47c32','surface');
      ctx.fillRect(left-pitch*1.3,top-rowGap*.52,(cols-1)*pitch+pitch*1.8,rowGap*1.04);
      ctx.globalAlpha=.85*row1Focus*Math.max(.35,firstAlpha);
      ctx.strokeStyle=figureColor('#b47c32');ctx.lineWidth=1.5;
      ctx.strokeRect(left+focusColumn*pitch-pitch*.42,top-rowGap*.46,pitch*.84,rowGap*.92);
      ctx.restore();
    }
    for(let row=0;row<rows;row++){
      const alpha=Math.min(1,rowCount-row);ctx.save();ctx.globalAlpha=alpha*reveal;
      text(String(row+1).padStart(2,'0'),left-pitch*.9,top+row*rowGap,width>900?10:7,'#8ba0a5');
      for(let col=0;col<cols;col++){
        const call=excerpt.samples[row].calls[col];
        ctx.globalAlpha=alpha*(row===(marker?.row??0)&&col===focusColumn?firstAlpha:reveal);
        text(String(call),left+col*pitch,top+row*rowGap,font,call===2?'#4476a0':call===1?'#5d8b85':'#a78d70');
      }
      ctx.restore();
    }
    ctx.save();ctx.globalAlpha=reveal;
    biologyCaption(rowCount<1.01?'One person. One row.':'One person per row. One SNP per column.',
      `Actual retained calls · ${cols} columns shown · ${Math.round(rowCount)} ${rowCount<1.01?'person':'people'}`);
    ctx.restore();
  }
  function drawCohortMatrix(progress){
    const full=window.BIO_MATRIX;
    if(!full){drawActualMatrix(12);return;}
    const {a,cols,pitch,rowGap,left}=matrixLayout(12),t=revealEase(progress/.40);
    const excerptRows=new Map(data.genotype_excerpt.cohort_row_indices.map((index,row)=>[index,row]));
    const step=a.h*.72/(full.samples.length-1),top=a.cy-a.h*.36;
    for(let i=0;i<full.samples.length;i++){
      const row=excerptRows.get(i),known=row!==undefined;
      const y=known?(a.cy+(row-5.5)*rowGap)*(1-t)+(top+i*step)*t:top+i*step;
      const appear=known?1:revealEase((t-.12)/.70);
      if(appear<.001)continue;
      for(let col=0;col<cols;col++){
        const value=full.samples[i].calls[col],color=value===2?'#4476a0':value===1?'#5d8b85':'#a78d70';
        ctx.globalAlpha=t*appear;ctx.fillStyle=figureColor(color);
        ctx.fillRect(left+col*pitch-pitch*.38,y-step*.36,pitch*.76,step*.72);
        if(known&&t<.999){ctx.globalAlpha=1-t;text(String(value),left+col*pitch,y,width>900?14:9,color);}
      }
    }
    ctx.globalAlpha=1;
    biologyCaption(t<.01?'One person per row. One SNP per column.':'All 996 people. The same 24 displayed SNPs.',
      t<.01?'Twelve real rows · scroll to fill the full cohort':'One square per table entry · tan = 0, teal = 1, blue = 2');
  }
  function drawQuality(progress){
    const a=plotArea(),steps=diagnostics?.qc||[],w=a.w*.80,left=a.cx-w/2;
    const barColors=['#8da7a0','#86aab0','#7e9ca8','#8f9fa0','#327e6d'];
    const gap=a.h*.145,top=a.cy-gap*2;
    steps.forEach((step,i)=>{
      const reveal=reducedMotion?1:smoothstep(progress*7-i*.55+.35);
      const y=top+i*gap;ctx.save();ctx.globalAlpha=.25+.75*reveal;
      text(step.label,left,y,width>900?12:8.5,'#536f75','left');
      text(step.count.toLocaleString(),left+w,y,width>900?15:10,i===4?'#226d5d':'#35575f','right');
      const barY=y+(width>900?16:9),barH=width>900?10:5;
      ctx.fillStyle=themePalette.rule;ctx.globalAlpha=.25;ctx.fillRect(left,barY,w,barH);ctx.globalAlpha=1;
      ctx.globalAlpha=i===4?.88:.72;ctx.fillStyle=barColors[i]||'#8da7a0';
      ctx.fillRect(left,barY,w*step.count/steps[0].count*reveal,barH);
      ctx.restore();
    });
    biologyCaption('',`${data.meta.snps_analyzed.toLocaleString()} retained SNPs · actual filter counts`);
  }
  function drawNormalization(progress){
    const a=plotArea(),t=smoothstep((progress-.06)/.34);
    const example=diagnostics?.normalization;
    if(!example)return;
    const columnColors=['#538d83','#527fa0','#9a7d61'];
    biologyCaption('Center. Rescale. Compare.','Actual retained SNPs · one person · three columns');
    for(let i=0;i<3;i++){
      const x=a.cx+(i-1)*a.w*.29,raw=example.calls[i],z=example.values[i],p=example.frequencies[i];
      text(example.markerIds[i],x,a.cy-a.h*.30,width>900?12:8,'#60777c');
      text(String(raw),x,a.cy-a.h*.19,width>900?30:22,columnColors[i]);
      text(`p = ${p.toFixed(3)}`,x,a.cy-a.h*.10,width>900?12:8,'#60777c');
      line(x,a.cy-a.h*.09,x,a.cy+a.h*.04,'#c3d1ce',1);
      text('↓',x,a.cy,width>900?22:17,'#8ca6a5');
      const value=raw*(1-t)+z*t;
      text(value.toFixed(2),x,a.cy+a.h*.15,width>900?30:21,columnColors[i]);
    }
    text('Z = (count − 2p) / √[2p(1 − p)]',a.cx,a.cy+a.h*.34,width>900?15:10,'#52777e');
  }
  function drawProcessing(page,progress=.45){
    drawingPage=page;
    if(page===CHAPTER.person)drawPerson();
    else if(page===CHAPTER.cell)drawCell();
    else if(page===CHAPTER.dna)drawHelix();
    else if(page===CHAPTER.zoom)drawHelix(2.5);
    else if(page===CHAPTER.snp)drawSNP();
    else if(page===CHAPTER.dosage)drawDosage();
    else if(page===CHAPTER.row)drawActualMatrix();
    else if(page===CHAPTER.matrix)drawCohortMatrix(progress);
    else if(page===CHAPTER.qc)drawQuality(progress);
    else if(page===CHAPTER.normalize)drawNormalization(progress);
    else if(page===CHAPTER.pca)drawToy();
  }
  const toyRawPoints=Array.from({length:28},(_,i)=>{
    const t=(i-13.5)/13.5;return [1.15*t,.72*t+.22*Math.sin(i*2.2)+.10*Math.cos(i*.8)];
  });
  const toyMean=toyRawPoints.reduce((sum,[x,y])=>[sum[0]+x/28,sum[1]+y/28],[0,0]);
  const toyPoints=toyRawPoints.map(([x,y])=>[x-toyMean[0],y-toyMean[1]]);
  const covariance=toyPoints.reduce((s,[x,y])=>[s[0]+x*x,s[1]+x*y,s[2]+y*y],[0,0,0]);
  const toyAngle=.5*Math.atan2(2*covariance[1],covariance[0]-covariance[2]);
  function drawToy(){
    const a=plotArea(), scale=Math.min(a.w,a.h)*.30;
    const u=[Math.cos(toyAngle),Math.sin(toyAngle)],v=[-u[1],u[0]];
    const len=scale*1.55;
    if(toyAxis1Mix<.999){
      ctx.globalAlpha=1-toyAxis1Mix;
      line(a.cx-len,a.cy,a.cx+len,a.cy);line(a.cx,a.cy-len,a.cx,a.cy+len);
      text('Height',a.cx+len,a.cy+24,10);text('Arm length',a.cx,a.cy-len-25,10);
    }
    ctx.globalAlpha=toyAxis1Mix;
    line(a.cx-u[0]*len,a.cy+u[1]*len,a.cx+u[0]*len,a.cy-u[1]*len,'#3e7a83',1.6);
    text('PC1',a.cx+u[0]*len,a.cy-u[1]*len-20,11,'#306e76');
    ctx.globalAlpha=toyAxis2Mix;
    line(a.cx-v[0]*len*.7,a.cy+v[1]*len*.7,a.cx+v[0]*len*.7,a.cy-v[1]*len*.7,'#bc8b55',1.2);
    text('PC2',a.cx+v[0]*len*.7,a.cy-v[1]*len*.7-20,11,'#9b6f39');
    ctx.globalAlpha=1;
    for(const [x,y] of toyPoints){
      const along=x*u[0]+y*u[1],across=x*v[0]+y*v[1];
      const px=toyStep===0?x:along*u[0]+across*v[0]*toyResidual;
      const py=toyStep===0?y:along*u[1]+across*v[1]*toyResidual;
      if(toyStep===1)line(a.cx+x*scale,a.cy-y*scale,a.cx+px*scale,a.cy-py*scale,'rgba(90,130,138,.13)',1);
      dot(a.cx+px*scale,a.cy-py*scale,width>900?4.2:3.3,'#3e7c88',.85);
    }
    text('A simple example · not the genetic dataset',a.cx,a.cy+a.h*.43,width>900?11:9);
  }
  function drawLocalityVectors(mapMix){
    if(vectorsMix>.001){
      ctx.save();ctx.globalAlpha=vectorsMix;
      for(const c of data.centroids){
        const isIsolate=ISOLATE_POPS.has(c.pop);
        if(focusItaly&&c.country!=='Italy'||highlightIsolates&&!isIsolate)continue;
        const [lon,lat]=geneticPosition(c,renderAngle,mapMix),p1=flatPoint(lon,lat,mapMix),p2=flatPoint(c.lon,c.lat,mapMix);
        ctx.setLineDash(isIsolate?[4,3]:[]);
        line(...p1,...p2,isIsolate?'rgba(153,104,29,.85)':'rgba(65,98,111,.4)',isIsolate?1.8:1);
        ctx.setLineDash([]);dot(...p2,2.8,isIsolate?'#99681d':'rgba(65,98,111,.65)',vectorsMix);ctx.globalAlpha=vectorsMix;
      }
      ctx.restore();
    }
  }
  function drawPCAAxes(pose){
    const alt=diagnostics?.equalWeight.alignment;
    const fitMix=alt?referenceMix*pose.map:0;
    const a=scientificArea(),theta=(pose.angle*(1-fitMix)+(alt?.target_angle||0)*fitMix)*Math.PI/180;
    // Actual PC=0 origin, carried through the same similarity transform as every sample.
    const reflect=data.meta.reflection||[[1,0],[0,1]],pcCenter=data.meta.pc_center;
    const origin0=[rotCx-pcCenter[0]*reflect[0][0]*data.meta.scale/lonFactor,rotCy-pcCenter[1]*reflect[1][1]*data.meta.scale];
    let originLonLat=getRotatedLonLat(...origin0,pose.angle);
    if(fitMix){
      const [ax,ay]=alt.pc_center.map((v,i)=>-v*alt.reflection[i][i]*alt.scale);
      const angle=alt.target_angle*Math.PI/180;
      const other=[alt.center[0]+(ax*Math.cos(angle)-ay*Math.sin(angle))/alt.longitude_factor,alt.center[1]+ax*Math.sin(angle)+ay*Math.cos(angle)];
      originLonLat=originLonLat.map((v,i)=>v*(1-fitMix)+other[i]*fitMix);
    }
    const origin=flatPoint(...originLonLat,pose.map);
    const length=Math.min(a.w,a.h)*.39;
    ctx.save();ctx.globalAlpha=(1-pose.matrix)*(1-gpsMix*pose.map);
    for(const [label,dx,dy] of [['PC1',Math.cos(theta)*reflect[0][0],-Math.sin(theta)*reflect[0][0]],['PC2',-Math.sin(theta)*reflect[1][1],-Math.cos(theta)*reflect[1][1]]]){
      const ends=[-1,1].map(sign=>[origin[0]+sign*dx*length,origin[1]+sign*dy*length]);
      line(...ends[0],...ends[1],'rgba(63,83,91,.46)',.9);
      for(const sign of [-1,1]){
        const x=origin[0]+sign*dx*length,y=origin[1]+sign*dy*length;
        line(x,y,x-sign*dx*5+dy*2.3,y-sign*dy*5-dx*2.3,'#60767c',.9);
        line(x,y,x-sign*dx*5-dy*2.3,y-sign*dy*5+dx*2.3,'#60767c',.9);
      }
      // Label positive direction close to the endpoint, with a quiet paper-colored halo.
      const x=origin[0]+dx*length*.88+dy*11,y=origin[1]+dy*length*.88-dx*11;
      ctx.save();ctx.translate(x,y);let angle=Math.atan2(dy,dx);if(angle>Math.PI/2||angle<-Math.PI/2)angle+=Math.PI;ctx.rotate(angle);
      ctx.fillStyle=themePalette.halo;ctx.fillRect(-16,-8,32,16);text(label,0,0,width>900?11:9,'#425e67');ctx.restore();
    }
    ctx.restore();
  }
  const countryAliases={'Czech Republic':'Czechia','Bosnia and Herzegovina':'Bosnia-Herzegovina','The former Yugoslav Republic of Macedonia':'North Macedonia','Republic of Moldova':'Moldova'};
  const countryRegions=new Map();
  const countryRegionCounts=new Map();
  for(const sample of data.samples){
    if(!countryRegions.has(sample.country))countryRegions.set(sample.country,new Set());
    countryRegions.get(sample.country).add(sample.region);
    if(!countryRegionCounts.has(sample.country))countryRegionCounts.set(sample.country,new Map());
    const counts=countryRegionCounts.get(sample.country);
    counts.set(sample.region,(counts.get(sample.region)||0)+1);
  }
  const dominantCountryRegion=new Map([...countryRegionCounts].map(([country,counts])=>
    [country,[...counts].sort((a,b)=>b[1]-a[1])[0][0]]));
  const countryCodes=new Map((window.EUROPE_INSET||[]).map(feature=>
    [countryAliases[feature.name]||feature.name,feature.code]));
  const samplesByCountry=new Map();
  for(const sample of data.samples){
    if(!samplesByCountry.has(sample.country))samplesByCountry.set(sample.country,[]);
    samplesByCountry.get(sample.country).push(sample);
  }
  // Put each country's most central genetic sample first, then cycle among
  // countries. This keeps crowded cohorts from taking every visible label.
  for(const group of samplesByCountry.values()){
    const points=group.map(sample=>({sample,point:getRotatedLonLat(sample.x0,sample.y0,finalAngle)}));
    const mean=[points.reduce((sum,item)=>sum+item.point[0],0)/points.length,
      points.reduce((sum,item)=>sum+item.point[1],0)/points.length];
    points.sort((a,b)=>Math.hypot((a.point[0]-mean[0])*lonFactor,a.point[1]-mean[1])-
      Math.hypot((b.point[0]-mean[0])*lonFactor,b.point[1]-mean[1]));
    group.splice(0,group.length,...points.map(item=>item.sample));
  }
  const countryLabelOrder=[];
  for(let rank=0;rank<Math.max(...[...samplesByCountry.values()].map(group=>group.length));rank++)
    for(const group of samplesByCountry.values())if(group[rank])countryLabelOrder.push(group[rank]);
  let geneticDensity=null;
  function buildGeneticDensity(){
    // Only genetic PCA coordinates enter this kernel density estimate. The
    // recorded localities, inset geometry and coastline are never read here.
    const fixed=data.samples.map(sample=>getRotatedLonLat(sample.x0,sample.y0,finalAngle));
    const alternative=data.samples.map((sample,i)=>{
      const other=alternativeSamples.get(sample.id);return other?[other.lon,other.lat]:fixed[i];
    });
    const physical=[...fixed,...alternative].map(([lon,lat])=>[(lon-rotCx)*lonFactor,lat-rotCy]);
    const bounds={minX:Math.min(...physical.map(p=>p[0]))-4,maxX:Math.max(...physical.map(p=>p[0]))+4,
      minY:Math.min(...physical.map(p=>p[1]))-4,maxY:Math.max(...physical.map(p=>p[1]))+4};
    const W=320,H=260,sigma=1.75;
    const sx=sigma*(W-1)/(bounds.maxX-bounds.minX),sy=sigma*(H-1)/(bounds.maxY-bounds.minY);
    const layers=[fixed,alternative].map(points=>{
      const fields=new Map(Object.keys(regionalColors).map(region=>[region,new Float32Array(W*H)]));
      for(let i=0;i<points.length;i++){
        const sample=data.samples[i],field=fields.get(sample.region);if(!field)continue;
        const [lon,lat]=points[i],px=((lon-rotCx)*lonFactor-bounds.minX)*(W-1)/(bounds.maxX-bounds.minX),
          py=(bounds.maxY-(lat-rotCy))*(H-1)/(bounds.maxY-bounds.minY);
        const x0=Math.max(0,Math.floor(px-3*sx)),x1=Math.min(W-1,Math.ceil(px+3*sx));
        const y0=Math.max(0,Math.floor(py-3*sy)),y1=Math.min(H-1,Math.ceil(py+3*sy));
        for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
          const dx=(x-px)/sx,dy=(y-py)/sy;
          field[y*W+x]+=Math.exp(-.5*(dx*dx+dy*dy));
        }
      }
      return [...fields].map(([region,field])=>{
        const surface=document.createElement('canvas');surface.width=W;surface.height=H;
        const layerCtx=surface.getContext('2d'),pixels=layerCtx.createImageData(W,H);
        const rgb=regionalColors[region].slice(1).match(/../g).map(v=>parseInt(v,16));
        let peak=0;for(const value of field)if(value>peak)peak=value;
        const floor=peak*.055,span=Math.max(.001,peak*.55-floor);
        for(let i=0;i<field.length;i++){
          const strength=Math.max(0,Math.min(1,(field[i]-floor)/span));
          const offset=i*4;pixels.data[offset]=rgb[0];pixels.data[offset+1]=rgb[1];
          pixels.data[offset+2]=rgb[2];pixels.data[offset+3]=Math.round(56*Math.pow(strength,.7));
        }
        layerCtx.putImageData(pixels,0,0);return surface;
      });
    });
    return {bounds,layers};
  }
  function drawGeneticDensity(alpha,pose){
    if(alpha<.001)return;
    if(!geneticDensity)geneticDensity=buildGeneticDensity();
    const {bounds,layers}=geneticDensity;
    const [left,top]=flatPoint(rotCx+bounds.minX/lonFactor,rotCy+bounds.maxY,pose.map);
    const [right,bottom]=flatPoint(rotCx+bounds.maxX/lonFactor,rotCy+bounds.minY,pose.map);
    const [pivotX,pivotY]=flatPoint(rotCx,rotCy,pose.map);
    ctx.save();
    // The density was rasterized in the aligned PCA frame. Turn the raster
    // with the same PCA points before and during the compass rotation.
    ctx.translate(pivotX,pivotY);
    ctx.rotate((finalAngle-pose.angle)*Math.PI/180);
    ctx.translate(-pivotX,-pivotY);
    for(let fit=0;fit<2;fit++){
      ctx.globalAlpha=alpha*(fit?referenceMix:1-referenceMix);
      if(ctx.globalAlpha<.001)continue;
      for(const surface of layers[fit])ctx.drawImage(surface,left,top,right-left,bottom-top);
    }
    ctx.restore();
  }
  function drawCountryCodes(alpha){
    if(alpha<.001)return;
    const area=scientificArea(),occupied=new Set(),cellW=width>900?22:18,cellH=width>900?14:12;
    const maxLabels=width>900?(camZoom>2?500:280):camZoom>2?160:75;
    ctx.save();ctx.font=`600 ${width>900?8.5:7}px "JetBrains Mono", monospace`;
    ctx.textAlign='center';ctx.textBaseline='middle';ctx.lineWidth=2;
    ctx.strokeStyle='rgba(255,250,240,.86)';
    let shown=0;
    for(const sample of countryLabelOrder){
      if(shown>=maxLabels)break;
      const x=sample.sx,y=sample.sy;
      if(x===null||y===null||!Number.isFinite(x)||!Number.isFinite(y)||
        Math.abs(x-area.cx)>area.w*.5-12||Math.abs(y-area.cy)>area.h*.46-8)continue;
      const col=Math.floor(x/cellW),row=Math.floor(y/cellH),key=`${col}:${row}`;
      if(occupied.has(key))continue;occupied.add(key);
      const code=countryCodes.get(sample.country)||sample.country.slice(0,2).toUpperCase();
      const focus=(sample.country==='Italy'?1:1-.89*italyMix)*
        (ISOLATE_POPS.has(sample.pop)?1:1-.89*isolatesMix);
      ctx.globalAlpha=alpha*focus*.78;
      ctx.strokeText(code,x,y);ctx.fillStyle=sample.color;ctx.fillText(code,x,y);
      shown++;
    }
    ctx.restore();
  }
  function insetGeometry(){const w=width>900?174:104;return {x:width-w-(width>900?26:14),y:Math.max(width>900?105:112,figureTop-24),w,h:w*.77};}
  function drawEuropeInset(alpha){
    const features=window.EUROPE_INSET;if(!features||alpha<.01)return;
    const box=insetGeometry(),pad=6;
    const scale=Math.min((box.w-2*pad)/(70*.65),(box.h-2*pad)/39);
    const project=(lon,lat)=>[box.x+box.w/2+(lon-10)*.65*scale,box.y+box.h/2-(lat-53.5)*scale];
    ctx.save();ctx.globalAlpha=alpha*.46;ctx.fillStyle='#fff3dc';ctx.fillRect(box.x,box.y,box.w,box.h);
    ctx.beginPath();ctx.rect(box.x,box.y,box.w,box.h);ctx.clip();
    ctx.globalAlpha=alpha*.88;
    for(const feature of features){
      const region=dominantCountryRegion.get(countryAliases[feature.name]||feature.name);
      const polygons=feature.geometry.type==='Polygon'?[feature.geometry.coordinates]:feature.geometry.coordinates;
      ctx.beginPath();for(const polygon of polygons)for(const ring of polygon){ring.forEach(([lon,lat],i)=>{const p=project(lon,lat);i?ctx.lineTo(...p):ctx.moveTo(...p);});ctx.closePath();}
      ctx.fillStyle=regionalColors[region]||'#e3e7e3';ctx.fill('evenodd');
      ctx.globalAlpha=alpha*.16;ctx.strokeStyle='#fffaf0';ctx.lineWidth=1.35;
      ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();
      ctx.globalAlpha=alpha*.88;
    }
    if(width>900){
      for(const f of features){if(!countryRegions.has(countryAliases[f.name]||f.name)||['MT','ME','MK','BA','AL'].includes(f.code))continue;
        const [x,y]=project(f.code==='RU'?37:f.lon,f.code==='RU'?57:f.lat);
        if(x<box.x+5||x>box.x+box.w-5||y<box.y+5||y>box.y+box.h-5)continue;
        text(f.code,x,y,7,'#fffef6');
      }
    }
    ctx.restore();ctx.save();ctx.globalAlpha=alpha*.2;
    ctx.strokeStyle=themePalette.rule;ctx.lineWidth=1.15;ctx.strokeRect(box.x,box.y,box.w,box.h);
    ctx.globalAlpha=alpha*.9;
    text('Europe · regional color key',box.x+box.w/2,box.y-9,width>900?10:7.5,'#58727a');
    text(width>900?'Gray: unsampled · dots retain labels':'Gray: unsampled',box.x+box.w/2,box.y+box.h+10,width>900?8:6,'#74858a');ctx.restore();
  }
  function scientificPose(page){
    return {matrix:page===CHAPTER.together?1:0,angle:page<=CHAPTER.compass?0:finalAngle,
      map:page>=CHAPTER.geography?1:0,color:page===CHAPTER.together?.42:page>=CHAPTER.pattern?1:0};
  }
  function drawScientific(pose){
    const a=scientificArea();renderAngle=pose.angle;
    ctx.save();ctx.beginPath();ctx.rect(a.cx-a.w*.5,a.cy-a.h*.46,a.w,a.h*.92);ctx.clip();
    const densityAlpha=smoothstep((pose.color-.42)/.58)*(1-gpsMix*pose.map)*(1-pose.matrix);
    const annotationAlpha=pose.map*densityAlpha;
    drawGeneticDensity(densityAlpha*.95,pose);
    if(pose.map>.001)drawLocalityVectors(pose.map);
    if(pose.matrix<.99)drawPCAAxes(pose);
    const matW=width>900?Math.min(width*.50,640):a.w,matH=width>900?Math.min(height*.62,480):a.h*.78;
    const left=a.cx-matW/2,top=a.cy-matH/2,items=centroidsMix>.001?[...data.samples,...data.centroids]:data.samples;
    for(const s of items){
      const isGroup=!matrixSlot.has(s.id),layerAlpha=isGroup?centroidsMix:1-centroidsMix;
      if(layerAlpha<.001){s.sx=null;s.sy=null;continue;}
      const [lon,lat]=geneticPosition(s,renderAngle,pose.map);
      const localityMix=gpsMix*pose.map;
      const [gx,gy]=flatPoint(lon*(1-localityMix)+s.lon*localityMix,lat*(1-localityMix)+s.lat*localityMix,pose.map);
      const slot=matrixSlot.get(s.id)||0,mx=left+(slot%matrixCols)/(matrixCols-1)*matW,my=top+Math.floor(slot/matrixCols)/(matrixRows-1)*matH;
      const px=mx*pose.matrix+gx*(1-pose.matrix),py=my*pose.matrix+gy*(1-pose.matrix);s.sx=px;s.sy=py;
      if(!insideMap(px,py)){s.sx=null;s.sy=null;continue;}
      const focusAlpha=(s.country==='Italy'?1:1-.89*italyMix)*(ISOLATE_POPS.has(s.pop)?1:1-.89*isolatesMix);
      const hovered=hoveredSample&&s.id===hoveredSample.id;
      const glyphAlpha=smoothstep((pose.matrix-.15)/.70);
      if(glyphAlpha>.001){
        ctx.save();ctx.globalAlpha=glyphAlpha;
        ctx.font=`${width>900?10:8}px "JetBrains Mono", monospace`;ctx.textAlign='center';ctx.textBaseline='middle';
        ctx.fillStyle=figureColor(s.allele===2?'#2467ad':s.allele===1?'#617780':'#9aa9ad');ctx.fillText(String(s.allele),px,py);
        ctx.restore();
      }
      if(glyphAlpha<.999){
        const pointAlpha=(hovered||isGroup)? .95 : .88-.42*densityAlpha;
        dot(px,py,hovered?5.8:isGroup?5:width>900?2.7:2,colorFor(s,pose.color),pointAlpha*focusAlpha*layerAlpha*(1-glyphAlpha));
        if(hovered||isGroup){ctx.globalAlpha=layerAlpha;ctx.strokeStyle='#fffdf5';ctx.lineWidth=1;ctx.stroke();ctx.globalAlpha=1;}
      }
    }
    drawCountryCodes(annotationAlpha*(1-centroidsMix));
    ctx.restore();
    if(scene>=CHAPTER.regions)drawEuropeInset(pose.color);
    if(scene<CHAPTER.explore){
      const label=pose.matrix>.45?'One observed call represents each person · all retained markers determine the endpoint'
        :scene<=CHAPTER.pattern?'Actual PCA coordinates · no geographic outline':gpsMix>.5&&pose.map>.5?'Recorded localities · includes assigned proxies':pose.map>.5?targetReferenceMix?'Alternative PCA · all 996 equally weighted · country codes label samples':'Reference PCA · soft genetic density · country codes label samples':'The same genetic points · one common orientation';
      text(width>900?label:pose.matrix>.45?'One representative call per person':label,a.cx,a.cy+a.h*.49,width>900?10.5:8);
    }
  }
  function drawPage(page,progress=.45){
    if(page>=CHAPTER.together)drawScientific(scientificPose(page));else drawProcessing(page,progress);
  }
  function paintBuffer(buffer,draw,alpha=1){
    if(alpha<.0001)return;
    ctx=buffer.ctx;ctx.globalAlpha=1;ctx.clearRect(0,0,width,height);draw();
    displayCtx.globalAlpha=alpha;displayCtx.drawImage(buffer.canvas,0,0,width,height);
  }
  function paintStory(){
    const u=viewMix;
    if(bioZoom){
      const layout=matrixLayout(),position=viewFrom+pageProgress;
      // Log magnification advances at one rate through the opening scroll.
      // The source stage stops still determine what is visible at each scale.
      const openingEnd=.9272727272727272,openingPortion=.046;
      const openingDepthProgress=beat===1?
        openingPortion*Math.max(0,Math.min(1,(scrollBeatProgress-(openingStart-1))/Math.max(.01,2-openingStart))):
        beat===2?openingPortion+(1-openingPortion)*Math.min(1,scrollBeatProgress/openingEnd):null;
      const biology=bioZoom.render({position,openingStart,openingDepthProgress,area:plotArea(),width,height,
        atlasFrame:{area:scientificArea(),center:[rotCx,rotCy],longitudeFactor:lonFactor,scale:flatScale()},
        matrix:{x:layout.left+(window.BIO_MARKER?.column??0)*layout.pitch,y:layout.top,font:layout.font},
        selected:selectedDosage,reduced:reducedMotion});
      if(viewFrom===1){paintBuffer(buffers[0],()=>{});ctx=displayCtx;ctx.globalAlpha=1;return;}
      if(biology.active){
        paintBuffer(buffers[0],()=>{if(biology.handoff>0)drawActualMatrix(1,biology.rowReveal,biology.firstAlpha);});
        ctx=displayCtx;ctx.globalAlpha=1;return;
      }
    }
    if(viewFrom>=CHAPTER.together){
      const from=scientificPose(viewFrom),to=scientificPose(viewTo),pose={};
      for(const key of Object.keys(from))pose[key]=from[key]*(1-u)+to[key]*u;
      if(viewFrom===CHAPTER.compass&&manualCompassAngle!==null)pose.angle=manualCompassAngle;
      paintBuffer(buffers[0],()=>drawScientific(pose));
    }else if(viewFrom===CHAPTER.person&&u>0){
      paintBuffer(buffers[0],()=>{drawingPage=viewFrom;drawPerson(1-u);drawingPage=viewTo;drawCell(u,.15+.85*u);});
    }else if(viewFrom===CHAPTER.cell&&u>0){
      paintBuffer(buffers[0],()=>{drawingPage=viewFrom;drawCell(1-u,1+.5*u,revealEase(u));drawingPage=viewTo;drawHelix(1,u);});
    }else if(viewFrom===CHAPTER.dna){
      paintBuffer(buffers[0],()=>{drawingPage=viewFrom;drawHelix(1+1.5*u);});
    }else if(viewFrom===CHAPTER.row){
      paintBuffer(buffers[0],()=>{drawingPage=viewFrom;drawActualMatrix(1+11*u);});
    }else{
      paintBuffer(buffers[0],()=>drawPage(viewFrom,pageProgress),1-u);
      if(u>0)paintBuffer(buffers[1],()=>drawPage(viewTo,0),u);
    }
    ctx=displayCtx;ctx.globalAlpha=1;
  }
  let lastTime=0;
  function render(timestamp=0){
    const dt=Math.min(.05,lastTime?(timestamp-lastTime)/1000:1/60);lastTime=timestamp;
    if(sceneDirty)updateSceneFromScroll();updateVisualState(dt);if(!reducedMotion)ambientTime+=dt;
    const ease=reducedMotion?1:1-Math.exp(-dt*4.2),gentle=reducedMotion?1:1-Math.exp(-dt*3.0);
    dosageEmphasis.forEach((value,i)=>dosageEmphasis[i]=approach(value,selectedDosage===i?1:0,gentle));
    camLon=approach(camLon,targetLon,ease);camLat=approach(camLat,targetLat,ease);camZoom=approach(camZoom,targetZoom,ease);
    gpsMix=approach(gpsMix,targetGpsMix,ease);
    referenceMix=approach(referenceMix,targetReferenceMix,gentle);
    vectorsMix=approach(vectorsMix,showVectors||highlightIsolates?1:0,gentle);
    centroidsMix=approach(centroidsMix,centroidsOnly?1:0,gentle);
    italyMix=approach(italyMix,focusItaly?1:0,gentle);
    isolatesMix=approach(isolatesMix,highlightIsolates?1:0,gentle);
    cellArtMix=approach(cellArtMix,window.BIOLOGY_ART?.cell?1:0,gentle);
    nucleusArtMix=approach(nucleusArtMix,window.BIOLOGY_ART?.nucleus?1:0,gentle);
    toyResidual+=(targetToyResidual-toyResidual)*gentle;toyAxis1Mix+=((toyStep>=1?1:0)-toyAxis1Mix)*gentle;toyAxis2Mix+=((toyStep===2?1:0)-toyAxis2Mix)*gentle;
    ctx=displayCtx;ctx.globalAlpha=1;drawThemeBackdrop();
    for(const sample of data.samples){sample.sx=null;sample.sy=null;}
    paintStory();
    slider.value=renderAngle.toFixed(1);angleDisplay.textContent=`${renderAngle.toFixed(1)}°`;
    requestAnimationFrame(render);
  }
  resize();updateSceneFromScroll();updateVisualState(0);requestAnimationFrame(render);
})();
