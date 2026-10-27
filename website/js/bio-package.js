/* Adapt the active Europe-to-DNA package to the scroll renderer. */
(function(root){
  'use strict';
  const payload=root.BIO_ZOOM_PACKAGE;
  root.BioPackage={
    create(svg,parent,source=payload){
      if(source?.kind!=='europe-to-dna'||!root.BioRoute)return null;
      return root.BioRoute.create(svg,parent,source);
    },
    stops:root.BioRoute?.stops||[],
    names:payload?.route?.names||[]
  };
})(typeof window==='undefined'?globalThis:window);
