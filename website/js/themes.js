/* Margin / Daylight is the site's design palette. */
(() => {
  'use strict';
  const regions=['Northern & Nordic','Western & Atlantic','Iberia & Basque','Mediterranean','Balkans & Southeast','Central & Eastern'];
  const colors=['#237767','#31669b','#af4a54','#9c691d','#5d7d37','#7955a3'];
  window.STORY_THEME=Object.freeze({
    id:'margin',name:'Margin · Daylight biology',dark:false,
    sky:['#fff6e5','#fff6e5','#fff6e5'],ink:'#213d50',muted:'#4e6572',rule:'#b7cdc8',paper:'#fffbf2',halo:'rgba(255,251,242,.97)',
    neutral:[62,82,94],font:'Inter, Arial, sans-serif',ribbon:[[249,247,244],[224,210,194],[178,161,143],[98,77,63]],
    bases:{A:'#358775',T:'#b47c32',C:'#357bab',G:'#8662aa'},
    regionalColors:Object.freeze(Object.fromEntries(regions.map((region,i)=>[region,colors[i]])))
  });
  document.documentElement.dataset.theme='margin';
  // Old bookmarks and saved comparison choices cannot change the selected design.
  try{window.localStorage.setItem('dna-story-theme','margin');}catch{}
  try{
    const url=new URL(window.location.href);
    if(url.searchParams.has('theme')){url.searchParams.delete('theme');window.history.replaceState(null,'',url.href);}
  }catch{}
})();
