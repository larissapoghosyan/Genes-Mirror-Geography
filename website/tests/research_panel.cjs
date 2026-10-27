const assert=require('assert'),fs=require('fs'),vm=require('vm'),path=require('path');
const root=path.join(__dirname,'..'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const records=[...html.matchAll(/<section\b([^>]+)>/g)].map(m=>Object.fromEntries([...m[1].matchAll(/([\w-]+)="([^"]*)"/g)].map(a=>[a[1],a[2]]))).filter(a=>a['data-act']);
assert.equal(records.length,12);
const notebookFiles={research:'genes_mirror_geography_replication.html',code:'genes_mirror_geography_math_code.html'};
const notebookIDs={};
for(const [tab,file] of Object.entries(notebookFiles)){
 notebookIDs[tab]=new Set([...fs.readFileSync(path.join(root,'../research',file),'utf8').matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
 for(const record of records)assert(notebookIDs[tab].has(record[tab==='research'?'data-notebook-anchor':'data-code-anchor']),'A synchronized anchor is missing from the actual notebook');
}
assert.equal(records[4]['data-notebook-anchor'],'2.-Genotypes-and-marker-quality-control');
assert(!/aria-modal|math-drawer-backdrop|btn-open-math/.test(html));
const elements=new Map(),events=new Map(),store=new Map(),queue=new Map();let nextID=0;
function node(id){
 if(elements.has(id))return elements.get(id);
 const classes=new Set(),listeners=new Map(),attrs={};
 const element={id,dataset:{},attrs,hidden:false,style:{},listeners,checked:false,
  classList:{add:k=>classes.add(k),remove:k=>classes.delete(k),contains:k=>classes.has(k),toggle(k,on){if(on===undefined)on=!classes.has(k);on?classes.add(k):classes.delete(k)}},
  addEventListener(type,fn){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(fn)},setAttribute(k,v){attrs[k]=v},focus(){document.activeElement=this},
  setPointerCapture(id){this.capture=id},hasPointerCapture(id){return this.capture===id},releasePointerCapture(){this.capture=null;emit(this,'lostpointercapture')},
  getBoundingClientRect(){const span=document.body.classList.contains('research-split')?1400:1100;const top=(Number(this.dataset.act)-1)*span-window.scrollY;return {top,bottom:top+span}},
  querySelector(){return {textContent:`Chapter ${this.dataset.act}`}}};elements.set(id,element);return element;
}
const sections=records.map(record=>{const section=node(record.id);section.dataset={act:record['data-act'],notebookAnchor:record['data-notebook-anchor'],codeAnchor:record['data-code-anchor']};return section});
const document={baseURI:'https://example.org/website/index.html',body:node('body'),documentElement:node('html'),getElementById:node,querySelectorAll:q=>q==='.act-section'?sections:[]};
document.body.dataset.beat='5';document.documentElement.style.setProperty=(k,v)=>{document.documentElement.style[k]=v};
const window={innerWidth:1440,innerHeight:1000,scrollY:4340,location:{href:document.baseURI},localStorage:{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)},
 addEventListener(type,fn){if(!events.has(type))events.set(type,[]);events.get(type).push(fn)},dispatchEvent(event){for(const fn of events.get(event.type)||[])fn(event)},scrollTo(opts){this.scrollY=opts.top},cancelAnimationFrame(id){queue.delete(id)}};
for(const tab of ['research','code'])node(`frame-${tab}`).dataset.notebookSrc=`../research/${notebookFiles[tab]}`;
node('science-dialog').hidden=true;node('research-resizer').hidden=true;
const sandbox={window,document,URL,WeakSet,CustomEvent:class{constructor(type,opts){this.type=type;this.detail=opts?.detail}},requestAnimationFrame(fn){const id=++nextID;queue.set(id,fn);return id}};
function emit(element,type,extra={}){const event={type,target:element,button:0,preventDefault(){this.prevented=true},...extra};for(const fn of element.listeners.get(type)||[])fn(event);return event}
function click(id){return emit(node(id),'click')}
function go(act){const span=document.body.classList.contains('research-split')?1400:1100;window.scrollY=(act-1)*span+.4*span-500;document.body.dataset.beat=String(act);window.dispatchEvent({type:'storyactchange',detail:{act}})}
function load(tab){
 const frame=node(`frame-${tab}`),scrolled=[],styles=new Map(),listeners=new Map();
 frame.contentDocument={baseURI:`https://example.org/research/${notebookFiles[tab]}`,getElementById(id){return styles.get(id)||(notebookIDs[tab].has(id)?{scrollIntoView(){scrolled.push(id)}}:null)},createElement(){return{}},head:{appendChild(style){styles.set(style.id,style)}},addEventListener(k,fn){listeners.set(k,fn)}};
 frame.contentWindow={history:{replaceState(a,b,url){frame.historyURL=url}}};emit(frame,'load');return{scrolled,listeners};
}
vm.runInNewContext(fs.readFileSync(path.join(root,'js/research-panel.js'),'utf8'),sandbox);
assert.equal(node('frame-research').src,undefined,'Do not load the 7 MB notebook before the panel is requested');
assert(node('science-dialog').hidden);
click('btn-research-mode');assert(!node('science-dialog').hidden);assert(document.body.classList.contains('research-split'));
assert.equal(document.documentElement.style['--research-width'],'45vw');assert.equal(window.scrollY,5660,'Opening the panel must keep Act 5 at the same progress');
assert.equal(document.body.style.overflow,undefined,'Desktop reading must stay non-modal');assert(!node('story').inert);
assert.equal(new URL(node('frame-research').src).hash,'#2.-Genotypes-and-marker-quality-control');
const research=load('research');assert.equal(research.scrolled.at(-1),records[4]['data-notebook-anchor']);
assert.equal(node('notebook-loading').hidden,true);
assert(research.listeners.has('keydown'),'Embedded notebook should respond to Escape');
assert(node('frame-research').contentDocument.getElementById('split-notebook-style').textContent.includes('.notebook-nav,.nb-reader-nav-peek{display:none'),'Embedded reader header and hover trigger should be removed');
go(6);assert.equal(research.scrolled.at(-1),records[4]['data-notebook-anchor'],'Notebook must keep its reading position by default');
node('research-follow').checked=true;emit(node('research-follow'),'change');assert.equal(research.scrolled.at(-1),records[5]['data-notebook-anchor']);
click('tab-code');const codeURL=new URL(node('frame-code').src);assert.equal(decodeURIComponent(codeURL.hash.slice(1)),records[5]['data-code-anchor'],'Literal percent escapes in nbconvert IDs must survive the fragment');
const code=load('code');assert.equal(code.scrolled.at(-1),records[5]['data-code-anchor']);
const count=code.scrolled.length;node('research-follow').checked=false;go(10);assert.equal(code.scrolled.length,count,'Manual reading must not be pulled away when sync is off');
node('research-follow').checked=true;emit(node('research-follow'),'change');assert.equal(code.scrolled.at(-1),records[9]['data-code-anchor']);
let key=emit(node('tab-code'),'keydown',{key:'Home'});assert(key.prevented);assert.equal(document.activeElement.id,'tab-research');assert.equal(node('tab-research').attrs['aria-selected'],'true');
const grip=node('research-resizer');emit(grip,'keydown',{key:'ArrowLeft'});assert.equal(grip.attrs['aria-valuenow'],'47');
click('btn-research-fullscreen');assert(document.body.classList.contains('research-fullscreen'));assert(grip.hidden);assert(node('story').inert);assert.equal(node('btn-research-fullscreen').attrs['aria-pressed'],'true');
go(11);assert.equal(code.scrolled.at(-1),records[9]['data-code-anchor'],'Fullscreen notebook must stay at the current reading position');
code.listeners.get('keydown')({key:'Escape',preventDefault(){}});assert(!document.body.classList.contains('research-fullscreen'));assert(!grip.hidden);assert(!node('story').inert);
emit(grip,'keydown',{key:'End'});assert.equal(grip.attrs['aria-valuenow'],'62');emit(grip,'dblclick');assert.equal(grip.attrs['aria-valuenow'],'45');
emit(grip,'pointerdown',{pointerId:1});emit(grip,'pointermove',{pointerId:1,clientX:720});
assert.equal(grip.attrs['aria-valuenow'],'45','Pointer resizing should be batched to a frame');
for(const [id,fn] of [...queue]){queue.delete(id);fn()}
assert.equal(grip.attrs['aria-valuenow'],'50');emit(grip,'pointerup',{pointerId:1});assert(!document.body.classList.contains('research-resizing'));
click('btn-narrative-mode');assert(node('science-dialog').hidden);assert.equal(document.activeElement.id,'btn-narrative-mode');assert.equal(node('story').inert,false);
go(5);assert.equal(window.scrollY,4340);click('btn-research-mode');assert.equal(grip.attrs['aria-valuenow'],'50','Reopening should retain the chosen split width');
window.innerWidth=390;window.dispatchEvent({type:'resize'});assert(grip.hidden);assert(node('story').inert);assert(node('stage-wrapper').inert);
code.listeners.get('keydown')({key:'Escape',preventDefault(){}});assert(node('science-dialog').hidden);assert(!node('story').inert);
assert.equal(document.activeElement.id,'btn-narrative-mode');
click('btn-research-mode');const returnProgress=(window.scrollY+window.innerHeight/2)/1400;let returned=false;
code.listeners.get('click')({target:{closest(){return{classList:{contains:cls=>cls==='atlas-return'}}}},preventDefault(){returned=true}});
assert(returned);assert(node('science-dialog').hidden);assert(!node('story').inert);assert(Math.abs((window.scrollY+window.innerHeight/2)/1100-returnProgress)<1e-10,'Return to Atlas must preserve the current act and its progress across the layout change');
console.log('All 24 real notebook anchors, lazy loading, reader header removal, optional story sync, full screen, resize, scroll preservation and compact return: PASS');
