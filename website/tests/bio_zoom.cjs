const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert');
const root=path.join(__dirname,'..');
class Node {
 constructor(tag,owner){this.tagName=tag;this.ownerDocument=owner;this.children=[];this.attrs={};this.style={};this.textContent='';}
 setAttribute(key,value){this.attrs[key]=String(value);}
 getAttribute(key){return this.attrs[key]??null;}
 appendChild(node){if(node.parentNode)node.parentNode.children=node.parentNode.children.filter(n=>n!==node);this.children.push(node);node.parentNode=this;return node;}
 get id(){return this.attrs.id;}
}
const document={createElementNS(ns,tag){return new Node(tag,this)}};
const svg=new Node('svg',document);svg.setAttribute('xmlns','http://www.w3.org/2000/svg');
const sandbox={window:{},document};
for(const file of ['data/bio_marker.js','js/helix-geometry.js','js/rotating-dna.js','js/bio-zoom.js'])vm.runInNewContext(fs.readFileSync(path.join(root,file),'utf8'),sandbox);
const {BioZoom,DNAHelix,BIO_MARKER:marker}=sandbox.window;
const zoom=BioZoom.create(svg,{marker,helix:DNAHelix});
const walk=node=>[node,...node.children.flatMap(walk)];
const find=id=>walk(svg).find(n=>n.id===id);
const atlas=JSON.parse(fs.readFileSync(path.join(root,'data/genome_atlas.js'),'utf8').split('=',2)[1].trim().replace(/;$/,''));
assert.equal(marker.sample,atlas.genotype_excerpt.samples[0].id);
assert.equal(marker.dosage,atlas.genotype_excerpt.samples[0].calls[marker.column]);
assert.equal(marker.retainedMarkerIndex,atlas.genotype_excerpt.marker_indices[marker.column]);
assert.equal(marker.marker,'rs6905097');assert.equal(marker.genotype,'AG');assert.equal(marker.column,12);
assert.equal(marker.countedAllele,'G');assert.equal(marker.otherAllele,'A');assert.equal(marker.phased,false);
const base={area:{cx:1022.4,cy:520,w:748.8,h:740},width:1440,height:1000,
 matrix:{x:712.4+marker.column*620/23,y:520,font:14},selected:marker.dosage};
const render=(position,extra={})=>zoom.render({...base,position,...extra});
assert.equal(render(1.9).active,false,'Keep the hero typographic until the biology beat starts');
assert.equal(render(2.4,{reduced:true}).state.opacity,1,'Reduced motion must show the complete person immediately');
assert.equal(walk(svg).filter(n=>n.attrs['data-autosome-pair']).length,22);
assert.equal(find('autosome-pairs').children.reduce((sum,n)=>sum+n.children.length,0),44);
let lastScale=1;
for(let p=2.45;p<=4.18;p+=.01){const s=BioZoom.pose(p);assert(s.camera[2]>=lastScale-1e-8);lastScale=s.camera[2];}
for(const dose of [0,1,2]){
 render(7.12,{selected:dose});assert.equal(find('bio-dosage-value').textContent,String(dose));
 const bases=walk(svg).filter(n=>n.attrs['data-base-site']==='9');
 for(const copy of [0,1]){
  const a=bases.find(n=>n.attrs['data-homolog']===String(copy)&&n.attrs['data-strand']==='0').textContent;
  const b=bases.find(n=>n.attrs['data-homolog']===String(copy)&&n.attrs['data-strand']==='1').textContent;
  assert.equal({A:'T',T:'A',C:'G',G:'C'}[a],b,'Each homolog must be a complementary duplex');
 }
 const count=bases.filter(n=>n.attrs['data-strand']==='0'&&n.textContent==='G').length;
 assert.equal(count,dose,'Dosage must count homologs, not the two strands of one helix');
}
const state=render(7.96,{selected:0});
assert.equal(state.badge.dosage,1,'A simulated genotype must not change the observed matrix call');
assert.equal(state.badge.x,base.matrix.x);assert.equal(state.badge.y,base.matrix.y);
assert(Math.abs(state.badge.alpha+state.firstAlpha-1)<1e-10,'Ownership transfer must not double or lose the observed glyph');
const compact={area:{cx:195,cy:300,w:343.2,h:286.24},width:390,height:844,
 matrix:{x:50.856+marker.column*(343.2*.84/23),y:300,font:9}};
for(const size of [base,compact]){
 render(7.1,size);
 const labelY=Number(find('parent-copy-2-label').attrs.y);
 const labelSize=Number(find('parent-copy-2-label').attrs['font-size']);
 const pillTop=Number(find('dosage-badge').attrs['data-y'])+Number(find('dosage-pill').attrs.y);
 assert(pillTop>labelY+labelSize/2+5,'The dosage badge must clear the second inherited-copy label');
 assert(Number(find('bio-dosage-value').attrs['font-size'])<Number(find('dosage-pill').attrs.height),
  'The numeral must fit inside the dosage badge');
 assert.equal(find('parent-copy-1-label').textContent,'Maternal homolog · G');
 assert.equal(find('parent-copy-2-label').textContent,'Paternal homolog · A');
}
const serialize=node=>`<${node.tagName}${Object.entries(node.attrs).map(([k,v])=>` ${k}="${v}"`).join('')}>${node.textContent}${node.children.map(serialize).join('')}</${node.tagName}>`;
for(const p of [2.55,3.4,3.68,4.4,5.5,6.4,7.1,7.72,7.96]){
 render(p);const forward=serialize(svg);render(9);render(p);assert.equal(serialize(svg),forward,'Reverse scrolling changed the same SVG pose');
}
render(12);assert.equal(svg.style.visibility,'hidden');render(2.4);assert.equal(svg.style.visibility,'visible');
const mobile=render(7.96,compact);assert.equal(mobile.badge.x,compact.matrix.x);assert.equal(mobile.badge.y,compact.matrix.y);
const reduced=render(7.8,{reduced:true});assert.equal(reduced.handoff,0,'Reduced motion should step directly to the matrix, not animate the camera');
assert(!walk(svg).some(n=>Object.values(n.attrs).some(v=>v.includes('NaN')||v.includes('Infinity'))));
console.log('SVG camera, 22 diploid pairs, two complementary homolog duplexes, observed marker, dosage selection, exact handoff, reverse poses, mobile and reduced motion: PASS');
module.exports={svg,zoom,render,base,compact,walk,Node,sandbox};
