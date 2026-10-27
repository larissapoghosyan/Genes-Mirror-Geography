const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert'),crypto=require('crypto');
const fixture=require('./bio_zoom.cjs');
const {Node,sandbox,base,compact,walk}=fixture,root=path.join(__dirname,'..');
for(const file of ['data/bio_package.js','js/bio-route.js','js/bio-package.js'])vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox);
const payload=sandbox.window.BIO_ZOOM_PACKAGE;
assert.equal(payload.kind,'europe-to-dna');
assert.equal(payload.sha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,payload.source))).digest('hex'));
const svg=new Node('svg',fixture.svg.ownerDocument);svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
const zoom=sandbox.window.BioZoom.create(svg,{marker:sandbox.window.BIO_MARKER,helix:sandbox.window.DNAHelix});
const render=(position,extra={})=>zoom.render({...base,position,...extra});
const find=id=>walk(svg).find(n=>n.id===id);
const snapshot=n=>({attrs:n.attrs,style:n.style,text:n.textContent,children:n.children.map(snapshot)});
const serialize=n=>JSON.stringify(snapshot(n));
render(1.4);assert.equal(svg.style.visibility,'visible');assert.equal(find('bio-package-art').attrs['data-package-stage'],'0');
const scale=()=>Number(find('pkg-camera').attrs.transform.match(/scale\(([^)]*)\)/)[1]);
const opening=scale();render(1.5,{openingStart:1.5});assert.equal(scale(),opening,'Opening view should be settled before scrolling');
render(1.55,{openingStart:1.5});assert(scale()>opening,'The first title scroll should begin zooming immediately');
render(1.999,{openingStart:1.5});const titleScale=scale();
render(2,{openingStart:1.5});assert(Math.abs(scale()/titleScale-1)<.01,'Title-to-zoom handoff should have no visible camera jump');
for(const [position,expected] of [[2.32,''],[2.65,''],[3.40,''],[3.75,''],
  [4.05,'Nucleus'],[4.30,'Chromosome'],[4.60,'DNA / SNP']]){
  render(position);
  assert.equal(find('bio-stage-title').textContent,expected,
    `Only biology stages from the nucleus onward should carry a floating name at ${position}`);
  assert.equal(find('bio-stage-detail').textContent,expected?'Biological scales and condensed chromosomes are schematic':'');
}
render(2,{openingStart:1.5});
render(4.8);
assert.equal(find('bio-stage-title').textContent,'','The helix-to-ladder transition should have no floating title');
assert.equal(find('bio-stage-detail').textContent,'','The helix-to-ladder transition should have no floating detail');
render(2,{openingStart:1.5});
assert.equal(find('bio-package-art').parentNode,svg,'No rectangular artwork clip');
// Register only the opening artwork to the scientific map's geographic frame.
const readData=name=>JSON.parse(fs.readFileSync(path.join(root,'data',name),'utf8').split('=',2)[1].trim().replace(/;$/,''));
const atlas=readData('genome_atlas.js'),diagnostics=readData('study_diagnostics.js');
const [lon0,lat0]=atlas.meta.center,longitudeFactor=atlas.meta.longitude_factor;
const radius=Math.max(...atlas.samples.map(s=>Math.hypot((s.x0-lon0)*longitudeFactor,s.y0-lat0)),
  ...diagnostics.equalWeight.samples.map(s=>Math.hypot((s.lon-lon0)*longitudeFactor,s.lat-lat0)));
const routeSvg=new Node('svg',fixture.svg.ownerDocument),route=sandbox.window.BioRoute.create(routeSvg,routeSvg,payload);
const themeContext={window:{localStorage:{setItem(){}}},document:{documentElement:{dataset:{}}},URL};
vm.runInNewContext(fs.readFileSync(path.join(root,'js/themes.js'),'utf8'),themeContext);
const regions=new Map();
for(const sample of atlas.samples){
  if(!regions.has(sample.country))regions.set(sample.country,new Map());
  const counts=regions.get(sample.country);counts.set(sample.region,(counts.get(sample.region)||0)+1);
}
const countryColors=Object.fromEntries([...regions].map(([name,counts])=>
  [name,themeContext.window.STORY_THEME.regionalColors[[...counts].sort((a,b)=>b[1]-a[1])[0][0]]]));
assert.equal(regions.get('France').get('Western & Atlantic'),61);
assert.equal(regions.get('France').get('Iberia & Basque'),20);
const sampleFrame={width:base.width,height:base.height,atlas:{area:base.area,center:atlas.meta.center,
  longitudeFactor,scale:Math.min(base.area.w,base.area.h)*.45/radius,countryColors}};
const openingState=route.render(2,base.area,false,sampleFrame);
assert(Math.abs(openingState.camera.z/openingState.registration.scale-2)<1e-10,
  'The opening Europe map should be twice the registered geographic scale');
const routeFind=id=>walk(routeSvg).find(n=>n.id===id);
assert.equal(routeFind('pkg-country-path-ITA').attrs.fill,'#fde6a8');
assert.equal(routeFind('pkg-country-path-HUN').attrs.fill,'#fde6a8');
assert.equal(routeFind('pkg-country-path-DEU').attrs.fill,'#fde6a8');
assert.equal(routeFind('pkg-country-path-FRA').attrs.fill,'#fde6a8');
assert.equal(routeFind('pkg-country-path-ITA').attrs['stroke-opacity'],'1.000');
assert.equal(routeFind('pkg-country-path-ITA').attrs.stroke,'#ddca9d');
assert.equal(routeFind('pkg-country-path-ITA').attrs['stroke-linejoin'],'round');
assert(routeFind('pkg-country-path-ITA').attrs.d.includes('Q'),'Opening map uses rounded corners');
assert(!routeFind('pkg-regional-stripes-FRA'));
const originalHungary=routeFind('pkg-country-path-HUN').attrs.d;
const earlyTilt=route.render(2.18,base.area,false,sampleFrame);
assert(earlyTilt.mapPitch<1&&earlyTilt.mapPitch>.85,'Budapest perspective should begin gently');
const middleTilt=route.render(2.55,base.area,false,sampleFrame);
assert(middleTilt.mapPitch<earlyTilt.mapPitch&&middleTilt.mapPitch>payload.route.finalMapPitch,
  'The map should keep tilting across the Hungary-to-park approach');
assert.equal(routeFind('pkg-country-path-HUN').attrs.fill,'#fde6a8','The opening map keeps one land color');
const tilted=route.render(2.32,base.area,false,sampleFrame);
assert(tilted.mapPitch<earlyTilt.mapPitch&&tilted.mapPitch>middleTilt.mapPitch,
  'Budapest perspective should progress gradually across the approach');
assert.notEqual(routeFind('pkg-country-path-HUN').attrs.d,originalHungary,'Country paths should tilt');
assert(routeFind('pkg-country-path-HUN').attrs.d.includes('Q'),'Rounded corners should survive the tilt');
const parkTilt=route.render(2.65,base.area,false,sampleFrame);
assert(Math.abs(parkTilt.mapPitch-payload.route.finalMapPitch)<1e-8,'The park view should reach the supplied perspective');
route.render(2,base.area,false,sampleFrame);
assert.equal(routeFind('pkg-country-path-HUN').attrs.d,originalHungary,'Reverse scroll restores flat geography');
assert.equal(routeFind('pkg-country-path-HUN').attrs.fill,'#fde6a8');
const uniformSteps=[0,.15,.30,.45,.60,.75,.90,1].map(progress=>
  route.render(2.1,base.area,false,{...sampleFrame,depthProgress:progress}).camera.z);
const uniformSlope=(Math.log(uniformSteps.at(-1))-Math.log(uniformSteps[0]));
uniformSteps.forEach((z,i)=>assert(Math.abs(Math.log(z/uniformSteps[0])-uniformSlope*[0,.15,.30,.45,.60,.75,.90,1][i])<1e-8,
  'Opening log magnification must be proportional to scroll progress'));
for(const size of [base,compact,{...compact,width:792,area:{cx:396,cy:300,w:697,h:286}}]){
  const area=size.width>900?size.area:{...size.area,cx:size.width*.43};
  const atlasFrame={area,center:atlas.meta.center,longitudeFactor,scale:Math.min(area.w,area.h)*.45/radius};
  const state=route.render(2,size.area,false,{width:size.width,height:size.height,atlas:atlasFrame});
  const registration=state.registration;
  const point=(lon,lat)=>{
    const [x,y]=sandbox.window.BioRoute.project(lon,lat,payload.route.projection),c=Math.cos(registration.angle),s=Math.sin(registration.angle);
    return [registration.px+registration.scale*(c*x-s*y),registration.py+registration.scale*(s*x+c*y)];
  };
  const center=point(lon0,lat0),east=point(lon0+.001,lat0);
  assert(Math.abs(center[0]-area.cx)<1e-8&&Math.abs(center[1]-area.cy)<1e-8,'Opening and final map must share the geographic center');
  assert(Math.abs(east[0]-area.cx-atlasFrame.scale*longitudeFactor*.001)<1e-8&&Math.abs(east[1]-area.cy)<1e-8,'The registration retains the final map’s east direction and neutral scale');
  let previous=state.camera.z;
  for(let p=2;p<4.65;p+=.031){
    const pose=route.render(p,size.area,false,{width:size.width,height:size.height,atlas:atlasFrame});
    assert.equal(pose.registration.px,registration.px);assert.equal(pose.registration.py,registration.py);
    assert.equal(pose.registration.angle,registration.angle,'No camera pan or rotation during the dive');
    assert(pose.camera.z>=previous-1e-8,'Zoom must remain monotonic');previous=pose.camera.z;
  }
}
for(const size of [base,compact,{...compact,width:792,area:{cx:396,cy:300,w:697,h:286}}]){
  for(let p=1;p<4.65;p+=.013){
    render(p,size);
    const values=find('pkg-camera').attrs.transform.match(/translate\(([^,]+),([^)]*)\) scale\(([^)]*)\)/).slice(1).map(Number);
    if(p>=2.32)assert.equal(values[0],size.area.cx,'The eventual SNP target must not move sideways once Hungary is reached');
    else assert(values[0]>=size.area.cx-1e-8,'The opening Europe view may be positioned slightly to the right');
    assert.equal(values[1],size.area.cy,'The eventual SNP target must not move vertically during any zoom stage');
    assert(values[2]>0&&Number.isFinite(values[2]));
  }
}
for(const [stage,p] of sandbox.window.BioRoute.stops.entries()){
  if(stage===8)continue; // The final DNA view belongs to the vertical helix scene.
  render(p+.001);assert.equal(Number(find('bio-package-art').attrs['data-package-stage']),stage,'Every ZIP stage must be reachable');
  const forward=serialize(svg);render(12);render(p+.001);assert.equal(serialize(svg),forward,'Reverse scrolling changed the same route pose');
}
render(3.05);assert(Number(find('pkg-opening-anatomy').attrs.opacity)>.99);
const keptCells=find('pkg-tissue-cell-field').children.filter(n=>n.id?.startsWith('pkg-neighbor-')&&n.style.display!=='none');
assert(keptCells.length>=180&&keptCells.length<=210,'Spread about 190 cells across the field instead of all 856 repeats');
assert.equal(find('pkg-tissue-cell-field').children.length,keptCells.length+1,
  'Do not create hidden outer cell instances in the SVG tree');
const previousWidth=sandbox.window.innerWidth;
sandbox.window.innerWidth=390;
const mobileSvg=new Node('svg',fixture.svg.ownerDocument);
sandbox.window.BioRoute.create(mobileSvg,mobileSvg,payload);
sandbox.window.innerWidth=previousWidth;
const mobileCells=walk(mobileSvg).find(n=>n.id==='pkg-tissue-cell-field').children.filter(n=>n.id?.startsWith('pkg-neighbor-'));
assert(mobileCells.length>=130&&mobileCells.length<=155,'Narrow screens should draw fewer spread-out cells');
render(3.7);assert.equal(find('pkg-tissue-surface').style.display,'inline',
  'The spread-out cell field should remain visible long enough to read');
render(3.85);assert(Number(find('pkg-tissue-surface').attrs.opacity)>0&&Number(find('pkg-tissue-surface').attrs.opacity)<1,
  'The surrounding cells should fade as the focal cell and nucleus take over');
render(4.0);assert.equal(find('pkg-tissue-surface').style.display,'none',
  'Cull the surrounding cells before the chromosome close-up');
render(4.08);
const entryScale=Number(find('rotating-dna-layout').attrs.transform.match(/scale\(([^)]*)\)/)[1]);
assert(Number(find('rotating-dna-stage').attrs.opacity)>0,'DNA must appear as the chromosome begins to fade');
assert.equal(find('rotating-dna-background').style.display,'none',
  'Draw only the focused helix while the chromosome is still on screen');
render(4.68);
assert(Number(find('rotating-dna-stage').attrs.opacity)>0,'Vertical helix should crossfade into the chromosome approach');
assert(find('rotating-dna-vertical').children.length===39,'Use the supplied 39-rung rotating strand');
assert(find('rotating-dna-background').children.length===2,'Keep only peripheral faded strands behind the hero');
assert.equal(find('rotating-dna-background').style.display,'inline',
  'Bring back the faint peripheral strands after the chromosome handoff');
assert(!find('rotating-dna-bokeh'),'Remove the central blurred strand remnant');
assert.equal(find('camera-rig').attrs.opacity,'0','No fallback strand may ghost beneath the chromosome handoff');
assert.equal(find('camera-rig').style.display,'none','Do not paint the fallback duplex behind the chromosome');
const arrivedScale=Number(find('rotating-dna-layout').attrs.transform.match(/scale\(([^)]*)\)/)[1]);
assert(arrivedScale>entryScale*2,'The DNA should zoom in while the chromosome fades');
render(4.8);
const settledScale=Number(find('rotating-dna-layout').attrs.transform.match(/scale\(([^)]*)\)/)[1]);
assert(settledScale>arrivedScale,'Magnification should continue gently after the chromosome fades');
assert.equal(find('rotating-dna-stage').attrs.opacity,'1.0000','The DNA remains fully visible while zooming');
assert.equal(find('pkg-L5').style.display,'none','Old sideways package helix must stay hidden');
assert.equal(find('rotating-dna-layout').attrs.transform.includes('rotate'),false,'Hero DNA must stay vertical');
render(5.15);assert.equal(Number(find('rotating-dna-stage').attrs.opacity),1);
render(5.05);
const beforeFocusScale=Number(find('rotating-dna-layout').attrs.transform.match(/scale\(([^)]*)\)/)[1]);
render(5.62);
const closeScale=Number(find('rotating-dna-layout').attrs.transform.match(/scale\(([^)]*)\)/)[1]);
assert(closeScale>beforeFocusScale*4,'Scroll should zoom deep into the highlighted SNP rung');
assert.equal(find('rotating-dna-counted-allele').textContent,'G');
assert.equal(find('rotating-dna-snp-pair').attrs['data-counted-allele'],'G');
assert.equal(find('rotating-dna-complement').textContent,'C','The zoom must show both bases of the first duplex');
render(5.62,{selected:0});assert.equal(find('rotating-dna-counted-allele').textContent,'A',
  'An optional AA example should stay consistent when scrolling backward');
assert.equal(find('rotating-dna-complement').textContent,'T');
render(5.62);
render(6.05);
assert(Math.abs(Number(find('rotating-dna-layout').attrs.transform.match(/scale\(([^)]*)\)/)[1])-beforeFocusScale)<.01,
  'The focused pair must return to the first homolog diagram’s scale');
assert(find('rotating-dna-snp-pair').children[0].attrs.transform.includes('rotate(-90)'),
  'The marked pair should turn into the ladder orientation');
render(6.2);assert.equal(find('rotating-dna-stage').style.display,'none','Hand off to the homolog and SNP diagram');
render(6.4);
const site=(copy,side)=>walk(svg).find(n=>n.attrs['data-base-site']==='9'&&
  n.attrs['data-homolog']===String(copy)&&n.attrs['data-strand']===String(side)).textContent;
assert.equal(site(0,0)+site(0,1),'GC','The observed first copy is a G–C duplex');
assert.equal(site(1,0)+site(1,1),'AT','The observed second copy is A–T: genotype AG');
render(6.4,{selected:2});assert.equal(site(1,0)+site(1,1),'GC',
  'GG appears only after explicitly selecting the optional example');
render(5.9,{reduced:true});assert.equal(find('rotating-dna-stage').style.display,'inline',
  'Reduced motion should offer a still G–C close-up');
render(6.4,{reduced:true});assert.equal(find('rotating-dna-stage').style.display,'none',
  'Reduced motion should step directly to two homologs');
let queued;
sandbox.window.requestAnimationFrame=callback=>{queued=callback;};
const motionSvg=new Node('svg',fixture.svg.ownerDocument);
const motion=sandbox.window.RotatingDNA.create(motionSvg);
motion.render({area:base.area,alpha:1});
const frontBall=motion.hero.children[0].children[4],initialX=frontBall.attrs.cx;
queued(1000);queued(1050);
assert.notEqual(frontBall.attrs.cx,initialX,'The supplied axial rotation must advance while visible');
motion.render({area:base.area,alpha:0});
const stopped=queued;stopped(1100);
assert.equal(motion.stage.style.display,'none','The rotation stops when the helix leaves the story');
delete sandbox.window.requestAnimationFrame;
render(4.8);assert.equal(find('bio-package-art').style.display,'none','Cull the whole geographic package at DNA depth');
assert(!walk(svg).some(n=>['script','iframe','foreignObject'].includes(n.tagName)));
assert(!walk(svg).some(n=>'tabindex' in n.attrs),'Decorative artwork must not add hidden keyboard targets');
const ids=new Set(walk(svg).map(n=>n.id).filter(Boolean));assert.equal(ids.size,walk(svg).filter(n=>n.id).length);
for(const n of walk(svg))for(const value of Object.values(n.attrs)){
  for(const m of value.matchAll(/url\(#([^)]*)\)/g))assert(ids.has(m[1]),'Broken pattern/filter reference: '+m[1]);
  if(n.attrs.href?.startsWith('#'))assert(ids.has(n.attrs.href.slice(1)),'Broken SVG use reference');
}
for(const size of [base,compact,{...compact,width:792,area:{cx:396,cy:300,w:697,h:286}}]){
  for(const p of sandbox.window.BioRoute.stops)render(p+.001,size);
  const call=render(7.96,size);assert.equal(call.badge.x,size.matrix.x);assert.equal(call.badge.y,size.matrix.y);assert.equal(call.badge.dosage,1);
}
render(5.6);assert.equal(find('bio-package-art').style.display,'none');
render(18);assert.equal(svg.style.visibility,'hidden','No introductory map may cover the final scientific atlas');
assert(!walk(svg).some(n=>Object.values(n.attrs).some(v=>/NaN|Infinity/.test(v))));
console.log('ZIP source, nine route stages, anatomy, culling, scoped patterns, reverse/mobile poses and scientific handoff: PASS');
module.exports={svg,zoom,render,base,compact,walk,find};
