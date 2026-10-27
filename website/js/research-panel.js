/* A non-modal notebook workspace. Scrolling in either document stays independent. */
(() => {
  'use strict';
  const $=id=>document.getElementById(id),panel=$('science-dialog');
  if(!panel)return;
  const narrative=$('btn-narrative-mode'),split=$('btn-research-mode'),grip=$('research-resizer');
  const follow=$('research-follow'),fullscreen=$('btn-research-fullscreen'),status=$('notebook-loading'),external=$('notebook-external');
  const sections=[...document.querySelectorAll('.act-section')];
  const tabs=['research','code'].map(id=>({id,button:$(`tab-${id}`),pane:$(`notebook-${id}`),frame:$(`frame-${id}`),lastAnchor:null,loaded:false}));
  let open=false,full=false,active='research',act=Number(document.body.dataset.beat)||1,width=45,drag=null,pending=null,resizeFrame=0;
  const boundDocuments=new WeakSet();
  try{const saved=Number(window.localStorage.getItem('dna-research-width'));if(saved>=32&&saved<=62)width=saved;}catch{}
  const compact=()=>window.innerWidth<=1100;
  const sectionFor=id=>sections.find(section=>Number(section.dataset.act)===id)||sections[0];
  function capture(){
    const midpoint=window.innerHeight/2;
    const section=sections.find(s=>{const b=s.getBoundingClientRect();return b.top<=midpoint&&b.bottom>midpoint;});
    if(!section)return null;
    const b=section.getBoundingClientRect();return {section,progress:(midpoint-b.top)/(b.bottom-b.top)};
  }
  function restore(anchor){
    if(!anchor)return;
    const b=anchor.section.getBoundingClientRect(),delta=b.top+anchor.progress*(b.bottom-b.top)-window.innerHeight/2;
    if(Math.abs(delta)>.5)window.scrollTo({top:window.scrollY+delta,behavior:'instant'});
  }
  function relayout(anchor){
    document.documentElement.style.setProperty('--research-width',`${width}vw`);
    const small=compact();grip.hidden=!open||small||full;
    for(const id of ['story','stage-wrapper'])$(id).inert=open&&(small||full);
    grip.setAttribute('aria-valuenow',String(Math.round(width)));
    grip.setAttribute('aria-valuetext',`${Math.round(width)} percent research, ${Math.round(100-width)} percent narrative`);
    restore(anchor);
    window.dispatchEvent(new CustomEvent('researchlayoutchange'));
  }
  function destination(tab){
    const section=sectionFor(act),anchor=section?.dataset[tab.id==='research'?'notebookAnchor':'codeAnchor']||'';
    const url=new URL(tab.frame.dataset.notebookSrc,document.baseURI||window.location.href);
    // Some nbconvert IDs contain literal percent escapes. Encode the complete ID
    // once so browser fragment decoding reproduces that literal DOM ID exactly.
    url.hash=encodeURIComponent(anchor);return {url,anchor};
  }
  function scrollFrame(tab,anchor,url){
    try{
      const target=tab.frame.contentDocument?.getElementById(anchor);
      if(!target)return false;
      tab.frame.contentWindow.history.replaceState(null,'',url.href);
      target.scrollIntoView({block:'start',behavior:'auto'});return true;
    }catch{return false;}
  }
  function navigate(force=false){
    if(!open)return;
    const tab=tabs.find(t=>t.id===active),{url,anchor}=destination(tab);
    external.href=url.href;
    if(!force&&tab.lastAnchor===anchor)return;
    tab.lastAnchor=anchor;
    if(tab.loaded&&scrollFrame(tab,anchor,url)){status.hidden=true;return;}
    status.hidden=false;status.textContent='Loading the notebook…';tab.frame.src=url.href;
  }
  function selectTab(id,focusTab=false){
    if(!tabs.some(tab=>tab.id===id))return;
    active=id;
    for(const tab of tabs){const selected=tab.id===id;tab.button.setAttribute('aria-selected',String(selected));tab.button.tabIndex=selected?0:-1;tab.pane.hidden=!selected;}
    if(focusTab)tabs.find(tab=>tab.id===id).button.focus();
    const tab=tabs.find(t=>t.id===id);
    if(follow.checked||!tab.loaded)navigate(true);
    else{external.href=tab.frame.src||destination(tab).url.href;status.hidden=true;}
  }
  function setFullscreen(value){
    if(!open)return;
    finishDrag();const anchor=capture();full=value;
    document.body.classList.toggle('research-fullscreen',full);
    fullscreen.textContent=full?'Split view':'Full screen';
    fullscreen.setAttribute('aria-pressed',String(full));
    relayout(anchor);fullscreen.focus();
  }
  function setMode(value,tabId){
    if(!value){finishDrag();full=false;}
    const anchor=capture();
    if(anchor)act=Number(anchor.section.dataset.act);
    open=value;document.body.classList.toggle('research-split',open);panel.hidden=!open;
    document.body.classList.toggle('research-fullscreen',open&&full);
    fullscreen.textContent=full?'Split view':'Full screen';
    fullscreen.setAttribute('aria-pressed',String(full));
    narrative.setAttribute('aria-pressed',String(!open));split.setAttribute('aria-pressed',String(open));split.setAttribute('aria-expanded',String(open));
    narrative.classList.toggle('active',!open);split.classList.toggle('active',open);
    relayout(anchor);
    if(open){if(tabId)selectTab(tabId);else navigate(true);tabs.find(tab=>tab.id===active).button.focus();}
    else narrative.focus();
  }
  function setWidth(value,anchor){
    width=Math.max(32,Math.min(62,value));relayout(anchor);
    try{window.localStorage.setItem('dna-research-width',String(width));}catch{}
  }
  narrative.addEventListener('click',()=>setMode(false));
  split.addEventListener('click',()=>setMode(true));
  fullscreen.addEventListener('click',()=>setFullscreen(!full));
  $('btn-close-research').addEventListener('click',()=>setMode(false));
  follow.addEventListener('change',()=>{if(follow.checked&&!full)navigate(true);});
  tabs.forEach((tab,i)=>{
    tab.button.addEventListener('click',()=>selectTab(tab.id));
    tab.button.addEventListener('keydown',event=>{
      let next;
      if(['ArrowRight','ArrowLeft'].includes(event.key))next=(i+1)%tabs.length;
      else if(event.key==='Home')next=0;
      else if(event.key==='End')next=tabs.length-1;
      else return;
      event.preventDefault();selectTab(tabs[next].id,true);
    });
    tab.frame.addEventListener('load',()=>{
      tab.loaded=true;
      try{
        const doc=tab.frame.contentDocument;
        if(doc&&!doc.getElementById('split-notebook-style')){
          const style=doc.createElement('style');style.id='split-notebook-style';
          style.textContent='html{scroll-behavior:auto}body{background:#fcfaf7!important;color:#292622}main{margin:0!important;padding:12px 16px!important;border:0!important;border-radius:0!important;max-width:none!important}.notebook-nav,.nb-reader-nav-peek{display:none!important}.jp-RenderedHTMLCommon{font-size:14px!important;line-height:1.75!important}.jp-RenderedHTMLCommon h1,.jp-RenderedHTMLCommon h2,.jp-RenderedHTMLCommon h3{color:#292622!important;scroll-margin-top:18px!important;font-family:Georgia,serif}.jp-RenderedHTMLCommon h1{font-size:1.8rem}.jp-RenderedHTMLCommon h2{font-size:1.4rem}.jp-InputArea-editor,.jp-OutputArea-output{overflow-x:auto}img{max-width:100%;height:auto}';
          doc.head.appendChild(style);
        }
        if(doc&&!boundDocuments.has(doc)){
          boundDocuments.add(doc);
          doc.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();full?setFullscreen(false):setMode(false);}});
          doc.addEventListener('click',event=>{
            const link=event.target.closest?.('a[href]');if(!link||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
            if(link.classList?.contains('atlas-return')){event.preventDefault();setMode(false);return;}
            const url=new URL(link.href,doc.baseURI),other=tabs.find(t=>new URL(t.frame.dataset.notebookSrc,document.baseURI).pathname===url.pathname);
            if(other&&other.id!==active){event.preventDefault();selectTab(other.id,true);}
          });
        }
      }catch{/* File URLs may block parent access; the frame fragment and external link still work. */}
      if(open&&tab.id===active){
        const {url,anchor}=destination(tab),requested=tab.lastAnchor||anchor;
        url.hash=encodeURIComponent(requested);scrollFrame(tab,requested,url);status.hidden=true;
      }
    });
    tab.frame.addEventListener('error',()=>{if(tab.id===active){status.hidden=false;status.textContent='The embedded notebook could not load. Use “Open notebook in a new tab” below.';}});
  });
  window.addEventListener('storyactchange',event=>{
    act=Number(event.detail.act)||1;if(open&&follow.checked&&!full)navigate();
  });
  window.addEventListener('resize',()=>{if(compact())finishDrag();relayout(capture());});
  window.addEventListener('keydown',event=>{if(open&&event.key==='Escape'){event.preventDefault();full?setFullscreen(false):setMode(false);}});
  document.querySelectorAll('[data-open-research]').forEach(link=>link.addEventListener('click',event=>{
    if(event.ctrlKey||event.metaKey||event.shiftKey||event.altKey||event.button>0)return;
    event.preventDefault();setMode(true,link.dataset.openResearch);
  }));
  document.querySelectorAll('.hud-step,.site-wordmark').forEach(link=>link.addEventListener('click',()=>{if(open&&compact())setMode(false);}));
  function flushResize(){
    resizeFrame=0;if(pending===null)return;
    const value=pending;pending=null;setWidth(value,drag?.anchor||capture());
  }
  function finishDrag(){
    if(!drag)return;
    if(resizeFrame)window.cancelAnimationFrame?.(resizeFrame);
    flushResize();const pointerId=drag.pointerId;drag=null;
    if(grip.hasPointerCapture?.(pointerId))grip.releasePointerCapture(pointerId);
    document.body.classList.remove('research-resizing');
  }
  grip.addEventListener('pointerdown',event=>{
    if(!open||compact()||event.button!==0)return;
    event.preventDefault();drag={pointerId:event.pointerId,anchor:capture()};grip.setPointerCapture(event.pointerId);document.body.classList.add('research-resizing');
  });
  grip.addEventListener('pointermove',event=>{
    if(!drag)return;pending=(window.innerWidth-event.clientX)/window.innerWidth*100;
    if(!resizeFrame)resizeFrame=requestAnimationFrame(flushResize);
  });
  grip.addEventListener('pointerup',finishDrag);grip.addEventListener('pointercancel',finishDrag);
  grip.addEventListener('lostpointercapture',finishDrag);
  grip.addEventListener('dblclick',()=>setWidth(45,capture()));
  grip.addEventListener('keydown',event=>{
    let value;
    if(event.key==='ArrowLeft')value=width+(event.shiftKey?5:2);
    else if(event.key==='ArrowRight')value=width-(event.shiftKey?5:2);
    else if(event.key==='Home')value=32;
    else if(event.key==='End')value=62;
    else return;
    event.preventDefault();setWidth(value,capture());
  });
  relayout(null);
})();
