const fs=require('fs'),vm=require('vm'),assert=require('assert');
const atlas=JSON.parse(fs.readFileSync(require('path').join(__dirname,'../data/genome_atlas.js'),'utf8').split('=',2)[1].trim().replace(/;$/,''));
const inset=JSON.parse(fs.readFileSync(require('path').join(__dirname,'../data/europe_inset.js'),'utf8').split('=',2)[1].trim().replace(/;$/,''));
const diagnostics=JSON.parse(fs.readFileSync(require('path').join(__dirname,'../data/study_diagnostics.js'),'utf8').split('=',2)[1].trim().replace(/;$/,''));
const preserved=JSON.stringify(atlas.samples.map(s=>[s.id,s.pc1,s.pc2,s.x0,s.y0,s.rotLon,s.rotLat,s.lon,s.lat]));
const html=fs.readFileSync(require('path').join(__dirname,'../index.html'),'utf8');
const records=[...html.matchAll(/<section\b([^>]+)>/g)].map(m=>Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]]))).filter(a=>a['data-act']);
const timelines=records.map(r=>r['data-visual-stops'].split(',').map(stop=>stop.split(':').map(Number)));
const actEvents=[];
const surface={width:1440,height:1000};
const composites=[];
function makeContext(){return new Proxy({arcs:[],glyphs:[],marks:[],rects:[],stack:[],globalAlpha:1}, {get(t,k){
 if(k in t)return t[k];
 if(k==='save')return ()=>{t.stack.push({globalAlpha:t.globalAlpha,font:t.font,fillStyle:t.fillStyle})};
 if(k==='restore')return ()=>{Object.assign(t,t.stack.pop()||{})};
 if(k==='createLinearGradient'||k==='createRadialGradient')return ()=>({addColorStop(){}});
 if(k==='createImageData')return (w,h)=>({data:new Uint8ClampedArray(w*h*4)});
 if(k==='clearRect')return ()=>{t.arcs=[];t.glyphs=[];t.marks=[];t.rects=[]};
 if(k==='fillRect')return (x,y,w,h)=>{t.rects.push({x,y,w,h,color:t.fillStyle,alpha:t.globalAlpha})};
 if(k==='fillText')return (label,x,y)=>{t.glyphs.push({label,x,y,color:t.fillStyle,alpha:t.globalAlpha,font:t.font})};
 if(k==='fill')return ()=>{t.marks.push({color:t.fillStyle,alpha:t.globalAlpha})};
 if(k==='arc')return (...args)=>{t.arcs.push(args)};
 if(k==='drawImage')return surface=>{composites.push({id:surface.id,alpha:t.globalAlpha})};
 return ()=>{};
},set(t,k,v){t[k]=v;return true;}});}
const ctx=makeContext();
let chosenScene=1,scrollProgress=.40,nextFrame,clock=0,stageWidth=1440;const listeners={};const elements=new Map();let svgId=0;
function element(id,dataset={}){
 if(elements.has(id))return elements.get(id);
 const classes=new Set();const e={id,dataset,style:{},attrs:{},listeners:{},hidden:false,value:0,children:[],textContent:'',
  classList:{toggle(k,v){if(v===undefined)v=!classes.has(k);v?classes.add(k):classes.delete(k)},add(k){classes.add(k)},remove(k){classes.delete(k)},contains(k){return classes.has(k)}},
  addEventListener(k,fn){this.listeners[k]=fn},setAttribute(k,v){this.attrs[k]=v;if(k==='id'){this.id=v;elements.set(v,this)}},removeAttribute(k){delete this.attrs[k]},focus(){document.activeElement=this},querySelectorAll(){return [element('btn-close-math'),element('science-last-link')]},
  appendChild(node){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(n=>n!==node);this.children.push(node);node.parentNode=this;return node;},
  setPointerCapture(){},getBoundingClientRect(){if(id==='stage-wrapper')return{width:stageWidth};const n=Number(this.dataset.act),top=(n-chosenScene)*1100+sandbox.window.innerHeight*.5-scrollProgress*1100;return{top,bottom:top+1100}},
  getContext(){return id==='atlas-canvas'?ctx:(this.ctx||(this.ctx=makeContext()))}};elements.set(id,e);return e;
}
const sections=records.map(record=>element(record.id,{act:record['data-act'],visualStops:record['data-visual-stops']}));
const hud=[...html.matchAll(/class="hud-step[^"]*" data-target-act="(\d+)"/g)].map(m=>element(`hud-${m[1]}`,{targetAct:m[1]}));
const chips=['europe','all','uk','med'].map(n=>element(`chip-${n}`,{tour:n}));
const stored=new Map();
let canvasId=0;
const document={documentElement:element('html'),readyState:'complete',body:{dataset:{},style:{}},createElement:()=>element(`transition-layer-${canvasId++}`),createElementNS(ns,name){const n=element(`svg-node-${svgId++}`);n.tagName=name;return n;},getElementById:id=>element(id),querySelector:q=>element(q),
 querySelectorAll:q=>q==='.act-section'?sections:q==='.hud-step'?hud:q==='.voyager-chip'?chips:q.startsWith('body >')?[element('story'),element('header')]:[]};
const sandbox={console,Math,URL,CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail}},document,window:{GENOME_ATLAS:atlas,EUROPE_INSET:inset,STUDY_DIAGNOSTICS:diagnostics,innerWidth:1440,innerHeight:1000,devicePixelRatio:1,
 location:{href:'http://localhost/index.html?review=1#act-17'},localStorage:{getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v)},history:{replaceState(a,b,url){sandbox.window.location.href=url}},
 dispatchEvent(event){if(event.type==='storyactchange')actEvents.push(event.detail.act);listeners[event.type]?.(event)},matchMedia:()=>({matches:process.env.REDUCED_MOTION==='1'}),addEventListener(k,fn){listeners[k]=fn}},requestAnimationFrame:fn=>{nextFrame=fn}};
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../js/themes.js'),'utf8'),sandbox);
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../vendor/d3-ease-sine.js'),'utf8'),sandbox);
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../js/helix-geometry.js'),'utf8'),sandbox);
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../data/bio_marker.js'),'utf8'),sandbox);
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../data/bio_matrix.js'),'utf8'),sandbox);
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../data/bio_package.js'),'utf8'),sandbox);
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../js/bio-route.js'),'utf8'),sandbox);
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../js/bio-package.js'),'utf8'),sandbox);
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../js/rotating-dna.js'),'utf8'),sandbox);
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../js/bio-zoom.js'),'utf8'),sandbox);
Object.defineProperty(atlas,'coastline',{get(){throw Error('The points-only renderer must not access coastline overlay data')}});
vm.runInNewContext(fs.readFileSync(require('path').join(__dirname,'../js/app.js'),'utf8'),sandbox);
function frames(n=90){for(let i=0;i<n;i++){clock+=1000/60;nextFrame(clock)}clock+=1000/60;nextFrame(clock)}
// Address the existing scientific visual states through the actual 12-beat DOM.
function locationFor(position){
 for(let b=0;b<timelines.length;b++){
  const stops=timelines[b];
  for(let i=1;i<stops.length;i++){
   const [p0,v0]=stops[i-1],[p1,v1]=stops[i];
   if(v1>v0&&position>=v0&&position<v1)return{beat:b+1,progress:p0+(position-v0)/(v1-v0)*(p1-p0)};
  }
 }
 return{beat:12,progress:.4};
}
function seekVisual(position){const target=locationFor(position);chosenScene=target.beat;scrollProgress=target.progress;listeners.scroll();return target;}
function go(n,progress=.40){const target=seekVisual(n+progress);frames(190);assert.equal(document.body.dataset.scene,String(n));assert.equal(document.body.dataset.beat,String(target.beat));}
function click(id){element(id).listeners.click({});frames(90)}
function shot(){}
const reduced=process.env.REDUCED_MOTION==='1';
const active=()=>element('transition-layer-0').ctx;
const backdrop=element('transition-layer-2');
frames(1);
assert.equal(backdrop.ctx.arcs.length,0,'Keep the background free of decorative shapes');
assert.equal(backdrop.ctx.rects.length,1);
assert.equal(backdrop.ctx.rects[0].color,'#fff6e5','Use the plain buttery-lemon background');
seekVisual(1.5);frames(100);
const introScale=()=>Number(element('pkg-camera').attrs.transform.match(/scale\(([^)]*)\)/)[1]);
const initialIntroScale=introScale();seekVisual(1.51);frames(1);
if(!reduced)assert(introScale()>initialIntroScale,'The opening camera should respond on the first scroll frames');
if(!reduced){
  const progress=[0,.15,.30,.45,.60,.75,.90];
  const magnifications=progress.map(p=>{chosenScene=2;scrollProgress=p;listeners.scroll();frames(1);return introScale();});
  const first=Math.log(magnifications[0]),step=Math.log(magnifications[1])-first;
  progress.forEach((p,i)=>assert(Math.abs(Math.log(magnifications[i])-first-step*(p/.15))<1e-8,
    'Opening zoom should advance evenly for equal scroll distances'));
}
const svgNodes=()=>[...new Set(elements.values())];
function svgAlpha(node){let alpha=1;while(node){if(node.style.visibility==='hidden'||node.style.display==='none')return 0;alpha*=Number(node.attrs.opacity??1)*Number(node.style.opacity??1);node=node.parentNode;}return alpha;}
const svgGlyphs=()=>svgNodes().filter(n=>n.tagName==='text'&&svgAlpha(n)>.1).map(n=>({label:n.textContent,alpha:svgAlpha(n),font:`${n.attrs['font-size']}px Georgia`}));
const letters=()=>[...active().glyphs,...svgGlyphs()].filter(g=>/^[ACTG]$/.test(g.label)&&g.alpha>.1);
const numerals=()=>active().glyphs.filter(g=>/^[012]$/.test(g.label)&&g.alpha>.1);
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
assert.equal(ids.length,new Set(ids).size,'Duplicate HTML IDs');
for(const match of html.matchAll(/href="#([^"]+)"/g))assert(ids.includes(match[1]),'Broken story anchor');
assert.equal([...html.matchAll(/data-act="/g)].length,12);
assert.deepEqual(records.map(r=>Number(r['data-act'])),Array.from({length:12},(_,i)=>i+1));
for(let b=0;b<timelines.length;b++){
 const stops=timelines[b];assert.equal(stops[0][0],0);assert.equal(stops.at(-1)[0],1);
 if(b)assert.equal(timelines[b-1].at(-1)[1],stops[0][1],'Beat boundary jumps to a different visual');
 for(let i=1;i<stops.length;i++){assert(stops[i][0]>stops[i-1][0]);assert(stops[i][1]>=stops[i-1][1]);}
}
const shortcuts=html.match(/<nav class="reviewer-jumps"[\s\S]*?<\/nav>/)[0];
assert(html.includes('href="#act-2"'));assert(!shortcuts.includes('href="#act-10"'));
assert(!html.includes('Skip to interactive map')&&!html.includes('Skip to the interactive map'));
assert(shortcuts.includes('genes_mirror_geography_replication.html'));
assert(records[9]['data-visual-stops'].startsWith('0:15'),'The PCA act must reach the live real-data rotation controls');
assert.equal(records[8]['data-visual-stops'],'0:14,1:15','The raw PCA cloud needs its own reading beat');
assert.equal(timelines[10][0][1],16);assert(timelines[10].some(stop=>stop[1]===17),'Color reveal and geography must share one beat');
assert(!/data-theme-option|theme-select|data-map-toggle|btn-toggle-map|nature-image|nature-scene/.test(html),'Retired image or controls remain');
assert.equal(sandbox.window.STORY_THEME.id,'margin');
assert.equal(document.documentElement.dataset.theme,'margin');
assert(!/showEuropeOutline|outlineMix|EUROPE_MASK/.test(fs.readFileSync(require('path').join(__dirname,'../js/app.js'),'utf8')));
// A molecular story precedes numeric data; no button or old timer changes its page.
go(2);assert.equal(letters().length,0);assert.equal(numerals().length,0);
go(4,.7);if(!reduced)assert(Number(element('rotating-dna-stage').attrs.opacity)>.5,
  'The vertical rotating helix must appear before the SNP diagram');
const zoomEvents=actEvents.length;
go(3);assert.equal(svgNodes().filter(n=>n.attrs['data-autosome-pair']).length,22);assert.equal(element('bio-zoom-stage').style.visibility,'visible');
go(4);assert.equal(element('pkg-L5').style.display,'none');assert.equal(numerals().length,0);
assert.equal(actEvents.length,zoomEvents,'Person, cell and DNA must stay in one reading beat');
assert(!html.includes('data-visual-cue')&&!html.includes('live-scale-readout'),
  'The biology illustration should not expose stage buttons or a scale dashboard');
go(5,.8);assert(letters().some(g=>g.label==='G'&&parseFloat(g.font)>=10));
assert(letters().some(g=>g.label==='C'),'The zoom should show G paired with C in one duplex');
go(6);assert.equal(svgNodes().find(n=>n.attrs['data-base-site']===9&&n.attrs['data-homolog']===0&&n.attrs['data-strand']===0).textContent,'G');
assert.equal(svgNodes().find(n=>n.attrs['data-base-site']===9&&n.attrs['data-homolog']===1&&n.attrs['data-strand']===0).textContent,'A');
for(const copy of [0,1]){
 const bases=svgNodes().filter(n=>n.attrs['data-base-site']===9&&n.attrs['data-homolog']===copy);
 assert.equal(bases.find(n=>n.attrs['data-strand']===0).textContent,copy?'A':'G');
 assert.equal(bases.find(n=>n.attrs['data-strand']===1).textContent,copy?'T':'C');
}
go(7);assert.equal(element('bio-dosage-value').textContent,'1');assert.equal(numerals().length,0);
for(const dosage of [0,1,2]){
 click(`btn-dosage-${dosage}`);
 assert(element('dosage-result').textContent.includes(`count ${dosage}`));
 assert.equal(element(`btn-dosage-${dosage}`).attrs['aria-pressed'],'true');
 for(let i=0;i<3;i++)assert.equal(element(`btn-dosage-${i}`).attrs['aria-pressed'],String(i===dosage));
 assert.equal(element('bio-dosage-value').textContent,String(dosage),'SVG badge must follow the selected genotype');
}
if(!reduced){
 go(7,.96);const focus=numerals()[sandbox.window.BIO_MARKER.column];
 assert.equal(focus.label,'1');assert.equal(element('bio-dosage-value').textContent,'1');
 assert(Math.abs(Number(element('dosage-badge').attrs['data-x'])-focus.x)<1e-5);
 assert(Math.abs(Number(element('dosage-badge').attrs['data-y'])-focus.y)<1e-5,'SVG and Canvas must share the middle-cell endpoint');
}
go(8);assert.deepEqual(numerals().map(g=>Number(g.label)),atlas.genotype_excerpt.samples[0].calls.slice(0,24));assert.equal(letters().length,0);
assert(composites.slice(-3).some(c=>c.id===backdrop.id),'The plain background must persist after the SVG finishes');
assert.equal(element('bio-zoom-stage').style.visibility,'hidden');
go(9,.0);assert.equal(numerals().length,12*24);assert.equal(letters().length,0);
assert.deepEqual(numerals().map(g=>Number(g.label)),atlas.genotype_excerpt.samples.flatMap(r=>r.calls.slice(0,24)));
// Re-enter stages in both directions and after skips. No stale helix or numeric matrix may survive.
for(const page of [4,9,5,8,6,9,4,8,9]){go(page,page===9?0:.40);if([8,9].includes(page))assert.equal(letters().length,0);if([4,5].includes(page))assert.equal(numerals().length,0);}
frames(220);assert.equal(numerals().length,288);assert.equal(letters().length,0,'An old timer rebuilt the helix on the matrix page');
go(9,.40);assert.equal(numerals().length,0);assert(active().glyphs.some(g=>g.label==='All 996 people. The same 24 displayed SNPs.'));
assert.equal(active().rects.filter(r=>r.alpha>.1).length,996*24,'Every real cohort call must appear in the matrix overview');
assert.equal(sandbox.window.BIO_MATRIX.samples.length,996);
for(let j=0;j<12;j++)assert.deepEqual(sandbox.window.BIO_MATRIX.samples[atlas.genotype_excerpt.cohort_row_indices[j]].calls,atlas.genotype_excerpt.samples[j].calls.slice(0,24));
if(process.env.BIOLOGY_ONLY==='1'){console.log('SVG-to-Canvas integration, genotype choices, exact middle-column endpoint, actual excerpts and all 23,904 cohort tiles: PASS');process.exit(0);}
go(10,.40);assert(active().glyphs.some(g=>g.label.includes('46,213')));
go(11,.40);for(const value of diagnostics.normalization.values.slice(0,3))assert(active().glyphs.some(g=>g.label===value.toFixed(2)));
for(const step of diagnostics.qc){go(10,.40);assert(active().glyphs.some(g=>g.label===step.count.toLocaleString()));}
for(let i=0;i<32;i++){const p=diagnostics.normalization.frequencies[i];assert(Math.abs((diagnostics.normalization.calls[i]-2*p)/Math.sqrt(2*p*(1-p))-diagnostics.normalization.values[i])<1e-6);}
go(12);assert(element('btn-toy-second').disabled);click('btn-toy-first');assert(!element('btn-toy-second').disabled);click('btn-toy-second');
go(13);assert.equal(numerals().length,996);assert.equal(letters().length,0);
const grid=atlas.samples.map(s=>[s.sx,s.sy]);frames(180);assert.deepEqual(atlas.samples.map(s=>[s.sx,s.sy]),grid,'The matrix changed without scrolling');
go(14);assert(active().glyphs.some(g=>g.label==='PC1'));assert(active().glyphs.some(g=>g.label==='PC2'));assert(!active().glyphs.some(g=>g.label.includes('regional color key')));const raw=atlas.samples.map(s=>[s.sx,s.sy]);assert.equal(active().arcs.filter(a=>a[2]===2.7).length,996);
assert(active().marks.some(m=>m.color==='rgb(35,119,103)')&&active().marks.some(m=>m.color==='rgb(49,102,155)'),
  'The raw point cloud should already show sampled regional colors');
seekVisual(15.01);frames(1);if(!reduced)assert(Number(document.body.dataset.visualMix)>0,'Compass turning should begin with the first scroll frames');
const [cx,cy]=atlas.meta.center,factor=atlas.meta.longitude_factor;
const radius=Math.max(...atlas.samples.map(s=>Math.hypot((s.x0-cx)*factor,s.y0-cy)),
 ...diagnostics.equalWeight.samples.map(s=>Math.hypot((s.lon-cx)*factor,s.lat-cy)));
const scale=Math.min(1440*.52,1000*.74)*.45/radius;
atlas.samples.forEach((s,i)=>{assert(Math.hypot(raw[i][0]-(1440*.71+(s.x0-cx)*factor*scale),raw[i][1]-(520-(s.y0-cy)*scale))<1e-8)});
if(!reduced){
 go(13,.725);const halfway=atlas.samples.map(s=>[s.sx,s.sy]);
 assert.equal(numerals().length,996,'Numerals should remain visible midway through the collapse');
 assert.equal(active().arcs.filter(a=>a[2]===2.7).length,996,'Dots should emerge while numerals are still visible');
 atlas.samples.forEach((s,i)=>{assert(Math.hypot(s.sx-(grid[i][0]+raw[i][0])/2,s.sy-(grid[i][1]+raw[i][1])/2)<1e-8)});
 go(18);go(13,.725);assert.deepEqual(atlas.samples.map(s=>[s.sx,s.sy]),halfway,'Reverse scrolling changed the same scroll pose');
 go(8,.725);assert.equal(numerals().length,7*24);go(9,0);assert.equal(numerals().length,288);
 // A wheel-sized jump settles over frames; reversing during the catch-up does not queue a replay.
 go(13,.40);seekVisual(13.90);frames(1);
 const first=Number(document.body.dataset.visualMix);
 assert(first>0&&first<.1,'The scroll visual jumped directly to its endpoint');
 frames(10);const forward=Number(document.body.dataset.visualMix);assert(forward>first&&forward<1);
 seekVisual(13.40);frames(0);
 const reversed=Number(document.body.dataset.visualMix);assert(reversed>0&&reversed<forward);
 frames(190);assert.equal(Number(document.body.dataset.visualMix),0);
 assert.deepEqual(atlas.samples.map(s=>[s.sx,s.sy]),grid,'Settled reverse scrub changed the matrix');
}
assert(/id="angle-slider"/.test(html),'The compass slider must remain available');
assert(!/id="(?:btn-autorotate|btn-reveal-regions|region-legend)"/.test(html),'Remove the compass button and region-key panel');
go(15,.10);const compassStart=atlas.samples.map(s=>[s.sx,s.sy]);
const slider=element('angle-slider');slider.value='-80';slider.listeners.input({target:slider});frames(2);
assert.equal(element('angle-display').textContent,'-80.0°','Dragging the slider must update the angle readout');
assert(Math.max(...atlas.samples.map((s,i)=>Math.hypot(s.sx-compassStart[i][0],s.sy-compassStart[i][1])))>1,'Dragging the slider must rotate the point cloud');
go(15,.10);assert(Math.max(...atlas.samples.map((s,i)=>Math.hypot(s.sx-compassStart[i][0],s.sy-compassStart[i][1])))<1e-6,'Scrolling must return the slider to the scroll-controlled angle');
go(15,.80);const compassForward=atlas.samples.map(s=>[s.sx,s.sy]);
assert(Math.max(...compassForward.map((p,i)=>Math.hypot(p[0]-compassStart[i][0],p[1]-compassStart[i][1])))>1,'Scroll must rotate the point cloud');
assert(Number(slider.value)<-1,'The slider must follow the scroll-driven rotation');
go(15,.10);assert(Math.max(...atlas.samples.map((s,i)=>Math.hypot(s.sx-compassStart[i][0],s.sy-compassStart[i][1])))<1e-6,'Reverse scroll must return the same coordinates');
go(16);frames(100);const before=atlas.samples.map(s=>[s.sx,s.sy]);frames(60);
const maxMove=Math.max(...atlas.samples.map((s,i)=>Math.hypot(s.sx-before[i][0],s.sy-before[i][1])));assert(maxMove<1e-8);
go(17);frames(200);
function expectedFlat(s,zoom=1,lon=s.rotLon,lat=s.rotLat){return[1440*.71+(lon-cx)*factor*scale*zoom,520-(lat-cy)*scale*zoom]}
function assertFlat(zoom=1,locality=false){for(const s of atlas.samples){const p=expectedFlat(s,zoom,locality?s.lon:s.rotLon,locality?s.lat:s.rotLat);assert(s.sx!==null,'Default flat view clipped a person');assert(Math.hypot(s.sx-p[0],s.sy-p[1])<.001,'Flat map moved a scientific point')}}
assert(active().glyphs.some(g=>g.label.includes('regional color key')));assertFlat();
assert(active().glyphs.some(g=>g.label==='IT')&&active().glyphs.some(g=>g.label==='GB'),
  'Country codes from recorded metadata should appear on the final genetic map');
const colors=Object.values(sandbox.window.STORY_THEME.regionalColors);assert(atlas.samples.every(sample=>colors.includes(sample.color)));
const inspectionControls=html.slice(html.indexOf('<section class="act-section" id="act-12"')).match(/<div class="control-buttons">([\s\S]*?)<\/div>/)[1];
assert.deepEqual([...inspectionControls.matchAll(/id="([^"]+)"/g)].map(match=>match[1]),['btn-morph-gps','btn-toggle-vectors']);
assert(!/class="voyager-grid"/.test(html),'Remove the extra map tour controls');
go(18);
assert(!active().glyphs.some(g=>String(g.label).includes('country codes label samples')||String(g.label).includes('soft genetic density')),
  'The last map view should have no explanatory footer caption');
click('btn-morph-gps');frames(180);assertFlat(1,true);click('btn-morph-gps');frames(180);assertFlat();
click('btn-toggle-vectors');assert.equal(element('btn-toggle-vectors').attrs['aria-pressed'],'true');
click('btn-toggle-vectors');assert.equal(element('btn-toggle-vectors').attrs['aria-pressed'],'false');
click('btn-zoom-fit');frames(180);assertFlat(1);
click('btn-zoom-reset');frames(180);assertFlat();
// Sensitivity changes endpoints to the recomputed fit, without changing sample IDs or metadata.
click('btn-reference-all');frames(500);
assert(element('btn-reference-all').attrs['aria-pressed']==='true');
assert(element('reference-metrics').textContent.includes('0.812'));
const alternatives=new Map(diagnostics.equalWeight.samples.map(s=>[s.id,s]));
assert.equal(alternatives.size,atlas.samples.length);
for(const s of atlas.samples){const a=alternatives.get(s.id),p=expectedFlat(s,1,a.lon,a.lat);assert(s.sx!==null,'Alternative default view clipped a person');assert(Math.hypot(s.sx-p[0],s.sy-p[1])<.001,'Wrong alternative PCA endpoint');}
click('btn-morph-gps');frames(250);assertFlat(1,true);
click('btn-reference-fixed');frames(500);assertFlat();
click('btn-reference-all');frames(250);go(14);frames(250);go(18);frames(250);assertFlat();
assert(element('btn-reference-fixed').attrs['aria-pressed']==='true');
// A split workspace must resize the actual canvas and preserve the PCA shape.
const fullPositions=atlas.samples.map(sample=>[sample.sx,sample.sy]);
stageWidth=792;listeners.researchlayoutchange();frames(200);
const compactHeight=Math.min(1000*.34,792*.85),compactScale=Math.min(792*.88,compactHeight)*.45/radius;
for(let i=0;i<atlas.samples.length;i++){
 const sample=atlas.samples[i],ratio=compactScale/scale;
 assert(sample.sx!==null,'Split-screen framing clipped a person');
 assert(Math.hypot(sample.sx-(792*.43+(fullPositions[i][0]-1440*.71)*ratio),sample.sy-(300+(fullPositions[i][1]-520)*ratio))<.001,'Split-screen distorted the PCA shape');
}
stageWidth=1440;listeners.researchlayoutchange();frames(200);assertFlat();
const beforePan=atlas.samples.map(s=>[s.sx,s.sy]);
element('atlas-canvas').listeners.pointerdown({clientX:1050,clientY:500,pointerType:'mouse',pointerId:1});
element('atlas-canvas').listeners.pointermove({clientX:1080,clientY:520});element('atlas-canvas').listeners.pointerup();frames(180);
for(let i=0;i<atlas.samples.length;i++){const s=atlas.samples[i];if(s.sx!==null)assert(Math.hypot(s.sx-beforePan[i][0]-30,s.sy-beforePan[i][1]-20)<.001,'Pan distorted the cloud')}
click('btn-zoom-reset');frames(180);assertFlat();
function wheel(x,y,extra={}){let prevented=false;element('atlas-canvas').listeners.wheel({clientX:x,clientY:y,deltaX:0,deltaY:-90,deltaMode:0,preventDefault(){prevented=true},...extra});return prevented}
assert(!wheel(150,500));assert(wheel(1050,500));assert(!wheel(1050,500,{ctrlKey:true}));
sandbox.window.innerWidth=390;sandbox.window.innerHeight=844;stageWidth=390;listeners.resize();assert(!wheel(250,240));
for(const page of [2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18]){go(page);assert.equal(document.body.dataset.scene,String(page));}
assert.equal(JSON.stringify(atlas.samples.map(s=>[s.id,s.pc1,s.pc2,s.x0,s.y0,s.rotLon,s.rotLat,s.lon,s.lat])),preserved);
console.log(JSON.stringify({chapters:12,svgCameraAndHandoff:'PASS',all996ObservedMatrixRows:'PASS',continuousMergedBeats:'PASS',interactiveDosage:'PASS',reviewerJumps:'PASS',activeTheme:'Margin',openingImageRemoved:'PASS',coastlineOverlayRemoved:'PASS',personToDNAtoSNPs:'PASS',realRowAndMatrixCalls:'PASS',noStaleHelixOrMatrix:'PASS',scrollPoseReversibility:reduced?'reduced-motion instant':'PASS',QCAndNormalization:'PASS',referenceSensitivity:'PASS',splitCanvasFraming:'PASS',all996ScientificCoordinatesPreserved:true,regionColorPixelShift:maxMove,flatProjectionAndLocality:'PASS',zoomAndPan:'PASS',desktopAndMobile:'PASS',reducedMotion:reduced},null,2));
