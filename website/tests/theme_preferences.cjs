const vm=require('vm'),fs=require('fs'),assert=require('assert'),path=require('path');
const source=fs.readFileSync(path.join(__dirname,'../js/themes.js'),'utf8');
function boot(href,blocked=false){
 let saved='prism';
 const document={documentElement:{dataset:{}}};
 const window={location:{href},localStorage:{setItem(k,v){if(blocked)throw Error('storage disabled');saved=v}},history:{replaceState(a,b,url){window.location.href=url}}};
 vm.runInNewContext(source,{URL,document,window});return{document,window,get saved(){return saved}};
}
for(const previous of ['air','dawn','cobalt','night','cabinet','monolith','index','__proto__','margin']){
 const state=boot(`https://example.org/?review=1&theme=${previous}#act-17`);
 assert.equal(state.window.STORY_THEME.id,'margin');assert.equal(state.saved,'margin');
 assert.equal(state.document.documentElement.dataset.theme,'margin');
 assert.equal(state.window.location.href,'https://example.org/?review=1#act-17');
 assert.equal(state.window.STORY_THEMES,undefined,'The comparison selector API must be retired');
 assert(Object.isFrozen(state.window.STORY_THEME));
}
assert.equal(boot('https://example.org/?theme=air',true).window.STORY_THEME.id,'margin');
const palette=boot('https://example.org/').window.STORY_THEME;
assert.equal(Object.keys(palette.regionalColors).length,6);
const luminance=color=>color.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);
for(const bg of palette.sky){for(const role of ['ink','muted'])assert(contrast(palette[role],bg)>=4.5);for(const color of Object.values(palette.regionalColors))assert(contrast(color,bg)>=3);}
console.log('Margin fixed across old bookmarks, saved preferences and blocked storage; regional palette and text contrast: PASS');
